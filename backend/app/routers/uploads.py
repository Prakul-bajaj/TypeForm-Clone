"""File handling.

* respondents upload an answer file          POST   /api/public/forms/{public_id}/upload?ref=<question>&filename=<name>
* respondents drop a file they picked        DELETE /api/public/forms/{public_id}/upload/{file_id}
* creators download a response's file        GET    /api/forms/{form_id}/files/{file_id}           (login required)
* creators upload a theme background image   POST   /api/forms/{form_id}/background?filename=…      (login required)
* anyone loads a background image            GET    /api/public/assets/{token}

The request body *is* the file (raw bytes) — no multipart parser / extra dependency needed.
Files are stored under random names; downloads are always sent as attachments so an uploaded
.html/.svg can never run in our origin.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas, services, storage
from ..config import DEFAULT_UPLOAD_MB, MAX_BACKGROUND_MB, MAX_UPLOAD_MB
from ..database import get_db
from ..deps import current_user
from .public import _published

router = APIRouter(tags=["uploads"])


def _declared_length(request: Request) -> int | None:
    try:
        return int(request.headers.get("content-length", ""))
    except ValueError:
        return None


# ───────────────────────── respondent ─────────────────────────
@router.post("/api/public/forms/{public_id}/upload", response_model=schemas.UploadOut, status_code=201)
async def upload_answer_file(
    public_id: str,
    request: Request,
    ref: str = Query(..., max_length=32),
    filename: str = Query("file", max_length=300),
    db: Session = Depends(get_db),
):
    form, rev = _published(db, public_id)
    q = next((x for x in rev.document["questions"] if x["ref"] == ref), None)
    if not q or q["type"] != "file_upload":
        raise HTTPException(404, "This question doesn't accept files")
    limit_mb = min(MAX_UPLOAD_MB, int((q.get("properties") or {}).get("max_size_mb", DEFAULT_UPLOAD_MB)))
    limit = limit_mb * 1024 * 1024
    declared = _declared_length(request)
    if declared is not None and declared > limit:
        raise HTTPException(413, f"That file is too large (limit {limit_mb} MB)")

    rel, size, _head = await storage.save_stream(request.stream(), f"answers/{form.id}", limit)
    up = models.Upload(
        kind="answer",
        form_id=form.id,
        original_name=storage.safe_filename(filename),
        content_type=(request.headers.get("content-type") or "application/octet-stream")[:100],
        size=size,
        path=rel,
    )
    db.add(up)
    db.commit()
    return schemas.UploadOut(file_id=up.token, name=up.original_name, size=up.size, content_type=up.content_type)


@router.delete("/api/public/forms/{public_id}/upload/{file_id}", status_code=204)
def discard_answer_file(public_id: str, file_id: str, db: Session = Depends(get_db)):
    """A respondent removed the file again before submitting. Only unattached files can be discarded."""
    form, _rev = _published(db, public_id)
    up = db.scalar(select(models.Upload).where(
        models.Upload.token == file_id, models.Upload.form_id == form.id,
        models.Upload.kind == "answer", models.Upload.response_id.is_(None)))
    if up:
        services.delete_uploads(db, models.Upload.id == up.id)
        db.commit()
        services.remove_pending_files(db)


# ───────────────────────── creator ─────────────────────────
@router.get("/api/forms/{form_id}/files/{file_id}")
def download_answer_file(form_id: int, file_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    up = db.scalar(select(models.Upload).where(
        models.Upload.token == file_id, models.Upload.form_id == form.id, models.Upload.kind == "answer"))
    if not up:
        raise HTTPException(404, "File not found")
    return FileResponse(
        storage.full_path(up.path),
        media_type="application/octet-stream",  # never let the browser render uploads
        filename=up.original_name,               # → Content-Disposition: attachment
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.post("/api/forms/{form_id}/background", response_model=dict, status_code=201)
async def upload_background(
    form_id: int,
    request: Request,
    filename: str = Query("background", max_length=300),
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    services.get_form_or_404(db, form_id, user)
    limit = MAX_BACKGROUND_MB * 1024 * 1024
    declared = _declared_length(request)
    if declared is not None and declared > limit:
        raise HTTPException(413, f"Please use an image under {MAX_BACKGROUND_MB} MB")
    rel, size, head = await storage.save_stream(request.stream(), f"backgrounds/{user.id}", limit)
    ctype = storage.sniff_image(head)
    if not ctype:
        storage.remove_files([rel])
        raise HTTPException(415, "Please upload a PNG, JPEG, GIF or WebP image")
    up = models.Upload(kind="background", owner_id=user.id, original_name=storage.safe_filename(filename),
                       content_type=ctype, size=size, path=rel)
    db.add(up)
    db.commit()
    return {"url": f"/api/public/assets/{up.token}", "name": up.original_name, "size": up.size}


# ───────────────────────── public images ─────────────────────────
@router.get("/api/public/assets/{token}")
def get_asset(token: str, db: Session = Depends(get_db)):
    up = db.scalar(select(models.Upload).where(models.Upload.token == token, models.Upload.kind == "background"))
    if not up:
        raise HTTPException(404, "Image not found")
    return FileResponse(
        storage.full_path(up.path),
        media_type=up.content_type,  # sniffed from the bytes at upload time (png/jpeg/gif/webp only)
        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )
