"""FastAPI application factory."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect
from sqlalchemy.exc import DataError, IntegrityError

from app.api.v1.router import api_v1_router
from app.config import settings
from app.core.middleware import RequestIDMiddleware, SecurityHeadersMiddleware
from app.core.observability import init_error_reporting
from app.services.features import PLAN_FEATURE_HEADER, PLAN_RESTRICTION_HEADER
from app.services.storage import LOCAL_UPLOAD_DIR

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The schema is owned by Alembic migrations (alembic upgrade head) —
    # metadata.create_all never alters existing tables and silently drifts.
    # It is used ONLY as a convenience for brand-new local dev databases.
    if settings.ENVIRONMENT == "development":
        try:
            import app.models  # noqa: F401 — register all tables
            from app.db.base import Base
            from app.db.session import get_async_engine

            def _create_all_if_unmigrated(sync_conn) -> None:
                # A database Alembic already manages must only change through
                # migrations: creating a new model's table here would make
                # the migration that adds it fail with "already exists".
                if not inspect(sync_conn).has_table("alembic_version"):
                    Base.metadata.create_all(sync_conn)

            async with get_async_engine().begin() as conn:
                await conn.run_sync(_create_all_if_unmigrated)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Dev create_all skipped (database unreachable?): {exc}")
    # Features and platform settings are defined in code; make the database match so
    # the admin panel shows exactly the features that exist. Skipped under
    # test: the test suite owns the event loop the database engine binds to.
    if settings.ENVIRONMENT != "test":
        try:
            from app.db.session import get_async_engine
            from app.services.features import sync_feature_registry
            from app.services.platform_settings import sync_settings_registry

            async with get_async_engine().begin() as conn:
                await conn.run_sync(sync_feature_registry)
                await conn.run_sync(sync_settings_registry)
        except Exception:  # noqa: BLE001 — a missing table means migrations have not run yet
            logger.exception("Feature / settings registry sync failed. Run `python -m alembic upgrade head`.")
    logger.info(f"startup environment={settings.ENVIRONMENT}")
    yield
    # Close pooled database connections cleanly (both pools). Skipped under
    # test for the same reason as above; the test fixture does it itself.
    if settings.ENVIRONMENT != "test":
        from app.db.session import get_admin_async_engine, get_async_engine

        await get_admin_async_engine().dispose()
        await get_async_engine().dispose()
    logger.info("shutdown")


def create_app() -> FastAPI:
    init_error_reporting("api")
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
        # The interactive docs map the entire attack surface — hidden in production.
        docs_url="/docs" if not settings.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not settings.is_production else None,
    )

    # Safety net under the Pydantic validators: a value the schema missed
    # (too long, wrong shape) must surface as a client error, never a 500
    # with a stack trace. The DB message itself is NOT echoed to the client.
    @app.exception_handler(DataError)
    async def _data_error(request: Request, exc: DataError):
        logger.warning("DataError on %s %s: %s", request.method, request.url.path, exc.orig)
        return JSONResponse(status_code=422, content={"detail": "A field value is invalid or too long."})

    @app.exception_handler(IntegrityError)
    async def _integrity_error(request: Request, exc: IntegrityError):
        logger.warning("IntegrityError on %s %s: %s", request.method, request.url.path, exc.orig)
        return JSONResponse(status_code=409, content={"detail": "The request conflicts with existing data."})

    # Middleware added first runs innermost; CORS is added last = outermost.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,  # exact origins — NEVER "*" with credentials
        allow_credentials=True,                  # the HttpOnly refresh cookie
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", settings.CSRF_HEADER_NAME],
        # Lets the web app tell "not in your plan" apart from any other 403.
        expose_headers=[PLAN_RESTRICTION_HEADER, PLAN_FEATURE_HEADER],
    )

    # Local-dev media serving; S3/R2 serves media in staging/production.
    if settings.STORAGE_BACKEND == "local":
        os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)
        app.mount("/static/uploads", StaticFiles(directory=LOCAL_UPLOAD_DIR), name="uploads")

    app.include_router(api_v1_router, prefix="/api/v1")
    return app


app = create_app()
