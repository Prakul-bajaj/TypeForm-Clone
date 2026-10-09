"""Public respondent API — no authentication."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response as HttpResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas, services
from ..database import get_db
from ..submission import process_submission
from ..validation import AnswerError, validate_answer

router = APIRouter(prefix="/api/public/forms", tags=["public"])


def _published(db: Session, public_id: str) -> tuple[models.Form, models.FormRevision]:
    form = db.scalar(select(models.Form).where(models.Form.public_id == public_id))
    if not form or form.status != "published":
        raise HTTPException(404, "This form is not available")
    rev = services.live_revision(db, form)
    if not rev:  # pragma: no cover - published forms always have a revision
        raise HTTPException(404, "This form is not available")
    return form, rev


@router.get("/{public_id}", response_model=schemas.PublicForm)
def get_public_form(public_id: str, track: bool = Query(True), db: Session = Depends(get_db)):
    form, rev = _published(db, public_id)
    if track:
        form.view_count += 1
        db.commit()
    return schemas.PublicForm(public_id=form.public_id, **rev.document)


def _find_by_key(db: Session, form: models.Form, key: str | None) -> models.Response | None:
    if not key:
        return None
    return db.scalar(
        select(models.Response).where(models.Response.form_id == form.id, models.Response.idempotency_key == key)
    )


def _started(value: datetime | None, now: datetime) -> datetime | None:
    """Client-reported start time as naive UTC, or None when it looks wrong (future / older than a day)."""
    if not value:
        return None
    if value.tzinfo:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value if 0 <= (now - value).total_seconds() < 86400 else None


def _store_answers(db: Session, form: models.Form, response: models.Response, pairs: list, strict: bool):
    """Replace the response's answers with ``pairs`` [(question dict, value)] and attach uploaded files.

    strict=True  (final submit): an unknown/foreign file id is an error for that question.
    strict=False (progress save): such answers are simply dropped.
    Returns (errors, kept_pairs).
    """
    response.answers.clear()
    db.flush()  # delete the old rows first so the (response, question) unique key never collides
    errors: list[dict] = []
    kept: list = []
    for q, value in pairs:
        if q["type"] == "file_upload" and value:
            up = db.scalar(select(models.Upload).where(
                models.Upload.token == value["file_id"], models.Upload.form_id == form.id,
                models.Upload.kind == "answer",
                or_(models.Upload.response_id.is_(None), models.Upload.response_id == response.id)))
            if not up:
                if strict:
                    errors.append({"ref": q["ref"], "message": "That upload didn't go through. Please upload the file again."})
                continue
            up.response_id = response.id
            value = {"file_id": up.token, "name": up.original_name, "size": up.size}  # trust the DB, not the client
        kept.append((q, value))
    used = {v["file_id"] for q, v in kept if q["type"] == "file_upload" and v}
    # files the respondent removed/replaced meanwhile are no longer needed
    services.delete_uploads(db, models.Upload.response_id == response.id, models.Upload.token.not_in(used))
    for q, value in kept:
        response.answers.append(
            models.Answer(question_ref=q["ref"], question_type=q["type"], question_title=q["title"], value=value)
        )
    return errors, kept


@router.post("/{public_id}/responses", response_model=schemas.SubmitOut, status_code=201)
def submit_response(public_id: str, payload: schemas.SubmitIn, request: Request, db: Session = Depends(get_db)):
    form, rev = _published(db, public_id)
    return _submit(db, form, rev, payload, request)


def _submit(db: Session, form: models.Form, rev: models.FormRevision, payload: schemas.SubmitIn, request: Request, retry: bool = True):

    # Idempotency: a retried POST (double click, flaky network) returns the first result.
    existing = _find_by_key(db, form, payload.idempotency_key)
    if existing and existing.status == "completed":
        return schemas.SubmitOut(response_id=existing.token, submitted_at=existing.submitted_at)

    questions = rev.document["questions"]
    raw = {a.ref: a.value for a in payload.answers}
    processed, errors = process_submission(questions, raw)
    if errors:
        raise HTTPException(422, detail={"message": "Some answers need your attention", "errors": errors})

    submitted = services.now()
    started = _started(payload.started_at, submitted) or (existing.started_at if existing else None)
    duration = round((submitted - started).total_seconds(), 1) if started else None

    if existing:  # the respondent already sent progress → this partial response becomes the final one
        response = existing
        response.revision_id = rev.id
    else:
        response = models.Response(
            form_id=form.id,
            revision_id=rev.id,
            idempotency_key=payload.idempotency_key,
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        )
        db.add(response)
    response.status = "completed"
    response.started_at = started
    response.submitted_at = submitted
    response.duration_seconds = duration

    try:
        db.flush()
        file_errors, _ = _store_answers(db, form, response, processed, strict=True)
        if file_errors:
            db.rollback()
            raise HTTPException(422, detail={"message": "Some answers need your attention", "errors": file_errors})
        db.commit()
    except IntegrityError:  # concurrent duplicate with the same idempotency key
        db.rollback()
        dup = _find_by_key(db, form, payload.idempotency_key)
        if dup is not None and dup.status == "partial" and retry:
            return _submit(db, form, rev, payload, request, retry=False)  # a progress save won the race: upgrade it
        if not dup or dup.status != "completed":
            raise HTTPException(409, "Please try submitting again")
        response = dup
    services.remove_pending_files(db)
    return schemas.SubmitOut(response_id=response.token, submitted_at=response.submitted_at)


@router.post("/{public_id}/progress", status_code=204)
def save_progress(public_id: str, payload: schemas.ProgressIn, request: Request, db: Session = Depends(get_db)):
    """Record what a respondent has answered so far, so abandoned forms show up as *partial* responses.

    Lenient on purpose: required-ness is not enforced (they're mid-way), and answers that don't validate are skipped.
    The same idempotency key is later used by the final submit, which turns this row into a completed response.
    """
    form, rev = _published(db, public_id)
    existing = _find_by_key(db, form, payload.idempotency_key)
    if existing and existing.status == "completed":
        return HttpResponse(status_code=204)

    by_ref = {q["ref"]: q for q in rev.document["questions"]}
    pairs = []
    for a in payload.answers:
        q = by_ref.get(a.ref)
        if not q:
            continue
        try:
            value = validate_answer({**q, "required": False}, a.value)
        except AnswerError:
            continue
        if value is not None:
            pairs.append((q, value))
    if not pairs:
        return HttpResponse(status_code=204)

    now = services.now()
    if existing:
        response = existing
    else:
        response = models.Response(
            form_id=form.id,
            revision_id=rev.id,
            status="partial",
            idempotency_key=payload.idempotency_key,
            user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        )
        db.add(response)
    response.started_at = _started(payload.started_at, now) or response.started_at
    response.submitted_at = now  # for a partial response this means "last activity"
    try:
        db.flush()
        _store_answers(db, form, response, pairs, strict=False)
        db.commit()
    except IntegrityError:  # two progress saves raced to create the same row; the next one will update it
        db.rollback()
    services.remove_pending_files(db)
    return HttpResponse(status_code=204)
