"""Public, no-login email endpoints.

"Stop these reminders": a client taps the link at the bottom of a reminder
email. The token is signed (never stored) and can do exactly one thing:
switch that contact's reminder emails off. It arrives in the POST body from
the page at /email/stop#<token>, so it never appears in server logs.

Plan: docs/approval_reminders_certificate_plan.md §10.
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.dependencies import client_ip
from app.core.rate_limit import public_link_rate_limit, record_invalid_token
from app.db.session import get_db
from app.models import AuditAction, Brand, BrandContact, Workspace
from app.services import email as mailer
from app.services.approval_links import utcnow
from app.services.audit import record_audit_event

router = APIRouter(prefix="/public/email", tags=["Public email"])

_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"}


class StopRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class StopResponse(BaseModel):
    stopped: bool = True
    agency_name: str
    brand_name: str


@router.post("/stop", response_model=StopResponse)
async def stop_reminders(req: StopRequest, request: Request, db=Depends(get_db),
                         _limit=Depends(public_link_rate_limit)):
    contact_id = mailer.read_opt_out_token(req.token)
    contact = await db.get(BrandContact, contact_id) if contact_id else None
    if contact is None:
        await record_invalid_token(client_ip(request))
        return JSONResponse(status_code=404, headers=_HEADERS,
                            content={"detail": "This link is not valid.", "code": "not_valid"})
    brand = await db.get(Brand, contact.brand_id)
    workspace = await db.get(Workspace, contact.workspace_id)
    if contact.email_opt_out_at is None:      # a second tap changes nothing
        contact.email_opt_out_at = utcnow()
        record_audit_event(
            db, action=AuditAction.CONTACT_CHANGE, entity_type="BrandContact", entity_id=contact.id,
            workspace_id=contact.workspace_id, user_id=None, user_email="",
            user_name="Client (email link)", ip_address=client_ip(request),
            changes={"after": {"email_reminders": "stopped by the client"}},
        )
        await db.commit()
    return JSONResponse(headers=_HEADERS, content=StopResponse(
        agency_name=workspace.name if workspace else "", brand_name=brand.name if brand else "").model_dump())
