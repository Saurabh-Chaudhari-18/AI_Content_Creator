"""Media uploads: tenancy-guarded, magic-byte validated, EXIF-stripped.

The file's EXTENSION and Content-Type header are attacker-controlled; the
actual bytes are validated. Photos are re-encoded to drop EXIF (GPS, device
serials) before anything can reference them. Adding or removing media
changes the post's content, so the content hash is recomputed and any
approval invalidated — the tamper chain stays truthful.
"""
import io
import logging
import os
import uuid as uuid_mod
from typing import Optional
from uuid import UUID

import filetype
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import (
    ALLOWED_IMAGE_EXTENSIONS, ALLOWED_IMAGE_MIMES,
    ALLOWED_VIDEO_EXTENSIONS, ALLOWED_VIDEO_MIMES,
)
from app.core.dependencies import client_ip, get_current_user, get_post_access
from app.core.security import compute_content_hash
from app.db.session import get_db
from app.models import (
    ApprovalAction, ApprovalLog, Brand, MediaType, OperationType,
    Post, PostMedia, PostStatus, UsageLog, User, WorkspaceMember,
)
from app.schemas.schemas import MediaUploadResponse, MessageResponse
from app.services.storage import get_storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/media", tags=["Media"])


def _strip_exif(data: bytes, ext: str) -> bytes:
    """Re-encode an image without metadata. GIFs skipped (animation would
    flatten; GIF carries no EXIF). Best-effort — failure keeps the original."""
    if ext == ".gif":
        return data
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        if fmt == "JPEG" and img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        clean = io.BytesIO()
        img.save(clean, format=fmt)  # no exif kwarg = metadata dropped
        return clean.getvalue()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"[Media] EXIF strip failed: {exc}")
        return data


async def _invalidate_if_approved(post: Post, user: User, db: AsyncSession, reason: str) -> None:
    from app.api.v1.posts import cancel_open_jobs  # local import avoids cycle at module load

    prev_status = post.status
    new_hash = compute_content_hash(post.caption, [str(m.id) for m in post.media])
    if new_hash == post.content_hash:
        return
    post.content_hash = new_hash
    post.version_number += 1
    if prev_status in (PostStatus.APPROVED, PostStatus.SCHEDULED):
        post.status = PostStatus.DRAFT
        db.add(ApprovalLog(
            post_id=post.id, user_id=user.id, action=ApprovalAction.INVALIDATED,
            content_hash_at_action=new_hash, rejection_reason=reason,
        ))
        if prev_status == PostStatus.SCHEDULED:
            await cancel_open_jobs(post, db, "Cancelled: " + reason)
            post.scheduled_at = None


@router.post("/upload", response_model=MediaUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    post_id: Optional[UUID] = Form(None),
    alt_text: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    filename = file.filename or "media"
    ext = os.path.splitext(filename)[1].lower()

    if ext in ALLOWED_IMAGE_EXTENSIONS:
        media_type = MediaType.IMAGE
        max_bytes = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024
        allowed_mimes = ALLOWED_IMAGE_MIMES
    elif ext in ALLOWED_VIDEO_EXTENSIONS:
        media_type = MediaType.VIDEO
        max_bytes = settings.MAX_VIDEO_SIZE_MB * 1024 * 1024
        allowed_mimes = ALLOWED_VIDEO_MIMES
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Unsupported file format. Upload JPG, PNG, WEBP, GIF, MP4, MOV or WEBM.")

    # TENANT ISOLATION: the target post must be in the caller's workspace.
    post = None
    if post_id:
        post = await get_post_access(post_id, db, user)
        if post.status in (PostStatus.PUBLISHING, PostStatus.PUBLISHED, PostStatus.PARTIALLY_PUBLISHED):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Media cannot be added to a published or publishing post.")

    # Read with a hard size cap (chunked — never trust Content-Length).
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                detail=f"File exceeds the {max_bytes // (1024 * 1024)}MB limit.")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    # Magic-byte validation: actual bytes, not the extension.
    kind = filetype.guess(data[:8192])
    if kind is None or kind.mime not in allowed_mimes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content does not match an allowed media type.",
        )

    if media_type == MediaType.IMAGE:
        data = _strip_exif(data, ext)

    storage_key = f"media/{uuid_mod.uuid4().hex}{ext}"
    get_storage().save(storage_key, data)

    media_id = uuid_mod.uuid4()
    if post:
        db.add(PostMedia(
            id=media_id, post_id=post.id, storage_key=storage_key,
            media_type=media_type, alt_text=alt_text,
            sort_order=len(post.media),
            meta={"original_filename": filename, "file_size": len(data), "mime": kind.mime},
        ))
        await db.flush()
        await db.refresh(post, ["media"])
        await _invalidate_if_approved(post, user, db, "Media added after approval; reset to draft.")

        brand = await db.scalar(select(Brand).where(Brand.id == post.brand_id))
        db.add(UsageLog(workspace_id=brand.workspace_id, user_id=user.id,
                        operation=OperationType.MEDIA_UPLOADED,
                        meta={"post_id": str(post.id), "bytes": len(data)}))
        await db.commit()

    return MediaUploadResponse(
        id=media_id,
        media_url=get_storage().display_url(storage_key),
        media_type=media_type.value,
        metadata={"original_filename": filename, "file_size": len(data), "mime": kind.mime},
    )


@router.delete("/{media_id}", response_model=MessageResponse)
async def delete_media(media_id: UUID, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    # TENANT ISOLATION: only members of the owning workspace.
    item = await db.scalar(
        select(PostMedia)
        .join(Post, Post.id == PostMedia.post_id)
        .join(Brand, Brand.id == Post.brand_id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Brand.workspace_id)
        .where(PostMedia.id == media_id, WorkspaceMember.user_id == user.id)
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found.")

    post = await get_post_access(item.post_id, db, user)
    if post.status in (PostStatus.PUBLISHING, PostStatus.PUBLISHED, PostStatus.PARTIALLY_PUBLISHED):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Media cannot be removed from a published or publishing post.")

    get_storage().delete(item.storage_key)
    await db.delete(item)
    await db.flush()
    await db.refresh(post, ["media"])
    await _invalidate_if_approved(post, user, db, "Media removed after approval; reset to draft.")
    await db.commit()
    return MessageResponse(message="Media deleted.")
