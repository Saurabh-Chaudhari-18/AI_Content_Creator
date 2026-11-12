"""Admin: the Smart Template library.

caption_templates is one global table shared by every customer, which is
why customers can only read it. This is where its content is managed.
Templates are switched off, not deleted.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin.common import admin_audit, like, not_found
from app.core.dependencies import require_super_admin
from app.db.session import get_admin_db
from app.models import AuditAction, CaptionTemplate, TemplateCategory, User
from app.schemas.admin import AdminTemplateCreate, AdminTemplateUpdate
from app.schemas.schemas import CaptionTemplateResponse

router = APIRouter(prefix="/templates")

_FIELDS = ("industry", "category", "title", "template_text", "suggested_hashtags", "suggested_cta", "is_active")


def _plain(value):
    return value.value if isinstance(value, TemplateCategory) else value


@router.get("", response_model=list[CaptionTemplateResponse])
async def list_templates(
    search: str | None = Query(None, max_length=200),
    active: bool | None = Query(None, description="omit to see switched-off templates too"),
    db: AsyncSession = Depends(get_admin_db),
):
    stmt = select(CaptionTemplate)
    if search and search.strip():
        pattern = like(search)
        stmt = stmt.where(CaptionTemplate.title.ilike(pattern) | CaptionTemplate.template_text.ilike(pattern)
                          | CaptionTemplate.industry.ilike(pattern))
    if active is not None:
        stmt = stmt.where(CaptionTemplate.is_active.is_(active))
    rows = await db.execute(stmt.order_by(CaptionTemplate.industry, CaptionTemplate.category, CaptionTemplate.title))
    return [CaptionTemplateResponse.model_validate(t) for t in rows.scalars().all()]


@router.post("", response_model=CaptionTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(req: AdminTemplateCreate, request: Request,
                          db: AsyncSession = Depends(get_admin_db),
                          admin: User = Depends(require_super_admin)):
    template = CaptionTemplate(
        industry=req.industry.strip().lower(), category=req.category, title=req.title.strip(),
        template_text=req.template_text, suggested_hashtags=req.suggested_hashtags,
        suggested_cta=req.suggested_cta, is_active=True,
    )
    db.add(template)
    await db.flush()
    admin_audit(db, admin, request, action=AuditAction.CREATE, entity_type="CaptionTemplate",
                entity_id=template.id, reason=req.reason,
                changes={"after": {"title": template.title, "industry": template.industry,
                                   "category": template.category.value}})
    await db.commit()
    return CaptionTemplateResponse.model_validate(template)


@router.patch("/{template_id}", response_model=CaptionTemplateResponse)
async def update_template(template_id: UUID, req: AdminTemplateUpdate, request: Request,
                          db: AsyncSession = Depends(get_admin_db),
                          admin: User = Depends(require_super_admin)):
    """Edit a template, or switch it off (`is_active: false`) so customers
    no longer see it. Posts already written from it are not affected."""
    template = await db.scalar(select(CaptionTemplate).where(CaptionTemplate.id == template_id))
    if template is None:
        raise not_found("Template")
    before, after = {}, {}
    for field in _FIELDS:
        new = getattr(req, field)
        if new is None:
            continue
        if field == "industry":
            new = new.strip().lower()
        if new != getattr(template, field):
            before[field], after[field] = _plain(getattr(template, field)), _plain(new)
            setattr(template, field, new)
    if after:
        admin_audit(db, admin, request, action=AuditAction.UPDATE, entity_type="CaptionTemplate",
                    entity_id=template.id, reason=req.reason, changes={"before": before, "after": after})
        await db.commit()
    return CaptionTemplateResponse.model_validate(template)
