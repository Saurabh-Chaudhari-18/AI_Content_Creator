"""Approval certificates: the signed-in views and the public verify check.

Plan: docs/approval_reminders_certificate_plan.md §3. The certificate is
written by the approval itself (posts.approve_post, public_approval.decide);
these routes only read it.

The public check returns the minimum that proves a certificate is genuine
(R3): no content, no contact details, no IP or device. Unknown numbers and
workspaces that switched verification off get the same 404, and misses are
counted for the existing link-guessing alert.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import client_ip, get_current_user, get_post_access, get_workspace_member
from app.core.rate_limit import public_link_rate_limit, record_invalid_token, workspace_rate_limit
from app.db.session import get_db
from app.models import ApprovalCertificate, Brand, Post, User, Workspace
from app.services import certificates
from app.services.storage import get_storage

router = APIRouter(tags=["Certificates"])
public_router = APIRouter(prefix="/public/certificates", tags=["Public certificates"])

_PUBLIC_HEADERS = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"}
NOT_FOUND = "We couldn't find a certificate with that number."


# ── Schemas ────────────────────────────────────────────────────────────
class CertificateMedia(BaseModel):
    media_type: str
    order: int
    alt_text: Optional[str] = None
    url: Optional[str] = None      # None once the post (and its files) is deleted


class PublishedEntry(BaseModel):
    platform: str
    account_name: Optional[str] = None
    status: str
    url: Optional[str] = None
    published_at: Optional[str] = None
    matched_fingerprint: bool


class CertificateResponse(BaseModel):
    id: str                        # "K7Q2-M9XD-4TPA"
    post_id: Optional[UUID] = None
    fingerprint: str
    version: int
    approved_at: str
    issued_at: str
    status: str                    # current | superseded | post_deleted
    superseded_by: Optional[str] = None
    verification_enabled: bool
    content: dict                  # title, caption, hashtags, cta, platforms[]
    media: list[CertificateMedia]
    approval: dict                 # brand, submitter, approver, link, reminders, deadline
    trail: list[dict]
    published: list[PublishedEntry]


class PublicCertificateResponse(BaseModel):
    valid: bool = True
    id: str
    status: str                    # current | superseded | post_deleted
    agency_name: str
    brand_name: str
    version: int
    approved_at: str
    approved_by: str
    approver_kind: str             # manager | client
    fingerprint: str
    published: list[dict]          # [{platform, published_at}] — completed only, no links


# ── Building ───────────────────────────────────────────────────────────
async def _response(db, cert: ApprovalCertificate, workspace: Workspace) -> CertificateResponse:
    snap = cert.snapshot
    standing = await certificates.standing(db, cert)
    live_files = standing["status"] != "post_deleted"
    storage = get_storage()
    return CertificateResponse(
        id=certificates.display_id(cert.public_id), post_id=cert.post_id, fingerprint=cert.content_hash,
        version=cert.version, approved_at=cert.approved_at.isoformat(), issued_at=cert.created_at.isoformat(),
        status=standing["status"], superseded_by=standing["superseded_by"],
        verification_enabled=workspace.certificate_verification_enabled,
        content={k: snap.get(k) for k in ("title", "caption", "hashtags", "cta", "platforms")},
        media=[CertificateMedia(media_type=m["media_type"], order=m["order"], alt_text=m.get("alt_text"),
                                url=storage.display_url(m["storage_key"]) if live_files else None)
               for m in snap.get("media", [])],
        approval={k: snap.get(k) for k in (
            "brand_name", "workspace_name", "submitted_by", "submitted_at", "due_at", "approver",
            "assigned_name", "acted_by_assignee", "link", "reminders", "backfilled")},
        trail=snap.get("trail", []),
        published=[PublishedEntry(**p) for p in standing["published"]],
    )


# ── Signed-in ──────────────────────────────────────────────────────────
@router.get("/posts/{post_id}/certificate", response_model=CertificateResponse,
            dependencies=[Depends(workspace_rate_limit)])
async def post_certificate(post_id: UUID, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    """The post's latest certificate (issued now for posts approved before
    certificates existed, if their content still matches)."""
    post: Post = await get_post_access(post_id, db, user)
    brand = await db.get(Brand, post.brand_id)
    workspace = await db.get(Workspace, brand.workspace_id)
    cert = await certificates.latest_for_post(db, post, brand, workspace)
    if cert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This post has no approval certificate yet.")
    return await _response(db, cert, workspace)


@router.get("/certificates/{certificate_id}", response_model=CertificateResponse,
            dependencies=[Depends(workspace_rate_limit)])
async def certificate_by_id(certificate_id: str, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Any certificate of the caller's own workspaces, also after its post
    was deleted. Another workspace's number answers 404, like an unknown one."""
    public_id = certificates.normalise_id(certificate_id)
    cert = await db.scalar(select(ApprovalCertificate).where(ApprovalCertificate.public_id == public_id)) \
        if public_id else None
    if cert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    try:
        await get_workspace_member(cert.workspace_id, db, user)
    except HTTPException:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND) from None
    return await _response(db, cert, await db.get(Workspace, cert.workspace_id))


# ── Public ─────────────────────────────────────────────────────────────
@public_router.get("/{certificate_id}", response_model=PublicCertificateResponse)
async def verify(certificate_id: str, request: Request, response: Response, db=Depends(get_db),
                 _limit=Depends(public_link_rate_limit)):
    public_id = certificates.normalise_id(certificate_id)
    cert = await db.scalar(select(ApprovalCertificate).where(ApprovalCertificate.public_id == public_id)) \
        if public_id else None
    workspace = await db.get(Workspace, cert.workspace_id) if cert else None
    if cert is None or workspace is None or not workspace.certificate_verification_enabled:
        await record_invalid_token(client_ip(request))
        return JSONResponse(status_code=404, content={"detail": NOT_FOUND, "code": "not_found"},
                            headers=_PUBLIC_HEADERS)
    standing = await certificates.standing(db, cert)
    snap = cert.snapshot
    for key, value in _PUBLIC_HEADERS.items():
        response.headers[key] = value
    return PublicCertificateResponse(
        id=certificates.display_id(cert.public_id), status=standing["status"],
        agency_name=snap.get("workspace_name") or workspace.name, brand_name=snap.get("brand_name") or "",
        version=cert.version, approved_at=cert.approved_at.isoformat(),
        approved_by=(snap.get("approver") or {}).get("name") or "",
        approver_kind=(snap.get("approver") or {}).get("kind") or "manager",
        fingerprint=cert.content_hash,
        published=[{"platform": p["platform"], "published_at": p["published_at"]}
                   for p in standing["published"] if p["status"] == "completed"],
    )
