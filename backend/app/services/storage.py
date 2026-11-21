"""Media storage — local disk for development, S3/R2 for real publishing.

post_media rows store a storage KEY, never a signed URL, so the approval
content-hash can't be invalidated by URL rotation. URLs are resolved here:
- display URL: what the frontend shows
- publish URL: a PUBLICLY FETCHABLE, time-limited URL for Meta's
  ingest-by-URL APIs (presigned S3 GET). Local storage cannot provide one,
  which is stated explicitly instead of failing deep inside an adapter.
"""
import logging
import os
from functools import lru_cache

from app.config import settings
from app.core.exceptions import PermanentPublishError

logger = logging.getLogger(__name__)

LOCAL_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "uploads"
)


class LocalStorage:
    """Development backend: files on disk, served at /static/uploads."""

    def __init__(self) -> None:
        os.makedirs(LOCAL_UPLOAD_DIR, exist_ok=True)

    def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    def delete(self, key: str) -> None:
        path = self._path(key)
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass

    def display_url(self, key: str) -> str:
        return f"/static/uploads/{key}"

    def publish_url(self, key: str) -> str:
        raise PermanentPublishError(
            "Local storage cannot provide a publicly fetchable media URL. "
            "Meta downloads media by URL — configure STORAGE_BACKEND=s3 "
            "(S3/R2/MinIO with public reachability) for real publishing."
        )

    def _path(self, key: str) -> str:
        # keys are server-generated UUID names; basename guard regardless
        safe = os.path.normpath(key).lstrip(os.sep).replace("..", "")
        return os.path.join(LOCAL_UPLOAD_DIR, safe)


class S3Storage:
    """S3-compatible backend (AWS S3, Cloudflare R2, MinIO)."""

    def __init__(self) -> None:
        import boto3  # imported lazily: not needed for local dev

        self._client = boto3.client(
            "s3",
            region_name=settings.S3_REGION or None,
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None,
        )
        self._bucket = settings.S3_BUCKET

    def save(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ACL="private")

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except Exception:  # noqa: BLE001
            pass

    def display_url(self, key: str) -> str:
        return self._presign(key, settings.S3_PRESIGN_EXPIRY_SECONDS)

    def publish_url(self, key: str) -> str:
        # Bucket stays private; Meta fetches through a time-limited link.
        return self._presign(key, settings.S3_PRESIGN_EXPIRY_SECONDS)

    def _presign(self, key: str, expires: int) -> str:
        return self._client.generate_presigned_url(
            "get_object", Params={"Bucket": self._bucket, "Key": key}, ExpiresIn=expires
        )


@lru_cache
def get_storage():
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()


async def delete_unreferenced_files(db, keys: list[str]) -> None:
    """Remove stored files AFTER the rows pointing at them are committed.

    Called once the database change is final, so a failed or slow delete can
    never leave a post pointing at a missing photo; the worst case is an
    orphaned file. A key some other row still uses is kept. Never raises:
    the customer's delete already succeeded.
    """
    if not keys:
        return
    from sqlalchemy import select
    from starlette.concurrency import run_in_threadpool

    from app.models import PostMedia

    still_used = set((await db.execute(
        select(PostMedia.storage_key).where(PostMedia.storage_key.in_(keys))
    )).scalars())
    storage = get_storage()
    for key in keys:
        if key in still_used:
            continue
        try:
            await run_in_threadpool(storage.delete, key)
        except Exception:  # noqa: BLE001
            logger.warning("could not delete stored file %s", key)
