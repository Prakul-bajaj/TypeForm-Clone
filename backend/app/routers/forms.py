"""Creator-facing form management: list / create / rename / duplicate / delete / publish."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas, services
from ..constants import DEFAULT_SETTINGS, DEFAULT_THEME
from ..database import get_db
from ..deps import current_user

router = APIRouter(prefix="/api/forms", tags=["forms"])


@router.get("", response_model=list[schemas.FormSummary])
def list_forms(db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    forms = db.scalars(
        select(models.Form).where(models.Form.owner_id == user.id).order_by(models.Form.updated_at.desc())
    ).all()
    counts = services.response_counts(db, [f.id for f in forms])
    db.commit()
    return [schemas.FormSummary(**services.form_summary(f, counts.get(f.id, 0))) for f in forms]


@router.post("", response_model=schemas.FormDetail, status_code=201)
def create_form(payload: schemas.FormCreate, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = models.Form(
        owner_id=user.id,
        title=payload.title.strip() or "Untitled form",
        theme=dict(DEFAULT_THEME),
        settings=schemas.Settings().model_dump(),
    )
    db.add(form)
    db.flush()
    q = services.new_question(form, "short_text")
    q.position = 0
    db.add(q)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)


@router.get("/{form_id}", response_model=schemas.FormDetail)
def get_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return services.form_detail(db, services.get_form_or_404(db, form_id, user))


@router.patch("/{form_id}", response_model=schemas.FormDetail)
def update_form(form_id: int, payload: schemas.FormPatch, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    changed_live_content = False
    if payload.title is not None:
        form.title = payload.title.strip() or form.title  # the name is internal: not a "publishable" edit
    # compare against the *normalised* stored value, so older rows (missing newer keys) don't look changed
    current_theme = schemas.Theme(**{**DEFAULT_THEME, **(form.theme or {})}).model_dump()
    current_settings = schemas.Settings(**(form.settings or {})).model_dump()
    if payload.theme is not None and payload.theme.model_dump() != current_theme:
        form.theme = payload.theme.model_dump()
        changed_live_content = True
    if payload.settings is not None and payload.settings.model_dump() != current_settings:
        form.settings = payload.settings.model_dump()
        changed_live_content = True
    if changed_live_content:
        services.touch(form)
    else:
        form.updated_at = services.now()
    db.commit()
    return services.form_detail(db, form)


@router.delete("/{form_id}", status_code=204)
def delete_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    services.delete_uploads(db, models.Upload.form_id == form.id)  # files of every response
    db.delete(form)
    db.commit()
    services.remove_pending_files(db)


@router.post("/{form_id}/duplicate", response_model=schemas.FormDetail, status_code=201)
def duplicate_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    src = services.get_form_or_404(db, form_id, user)
    copy = models.Form(
        owner_id=src.owner_id,
        title=f"{src.title} (copy)"[:200],
        theme=dict(src.theme or DEFAULT_THEME),
        settings=dict(src.settings or {}),
    )
    db.add(copy)
    db.flush()

    id_map: dict[int, models.Question] = {}
    for q in services.sorted_questions(src):
        nq = models.Question(
            form_id=copy.id,
            position=q.position,
            type=q.type,
            title=q.title,
            description=q.description,
            required=q.required,
            properties=dict(q.properties or {}),
            choices=[models.Choice(position=c.position, label=c.label) for c in q.choices],
        )
        db.add(nq)
        id_map[q.id] = nq
    db.flush()
    for r in src.logic_rules:
        db.add(
            models.LogicRule(
                form_id=copy.id,
                source_question_id=id_map[r.source_question_id].id,
                position=r.position,
                operator=r.operator,
                value=r.value,
                destination_type=r.destination_type,
                destination_question_id=id_map[r.destination_question_id].id if r.destination_question_id else None,
            )
        )
    db.commit()
    db.refresh(copy)
    return services.form_detail(db, copy)


@router.post("/{form_id}/publish", response_model=schemas.FormDetail)
def publish_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Validate → snapshot an immutable revision → flip the form to published (one transaction)."""
    form = services.get_form_or_404(db, form_id, user)
    problems = services.publish_problems(form)
    if problems:
        raise HTTPException(422, detail={"message": "Fix these issues before publishing", "errors": problems})
    last = services.live_revision(db, form)
    db.add(
        models.FormRevision(
            form_id=form.id,
            version=(last.version + 1) if last else 1,
            draft_version=form.draft_version,
            document=services.build_document(form),
        )
    )
    form.status = "published"
    form.published_at = services.now()
    form.published_draft_version = form.draft_version
    db.commit()
    return services.form_detail(db, form)


@router.post("/{form_id}/unpublish", response_model=schemas.FormDetail)
def unpublish_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    form.status = "draft"
    db.commit()
    return services.form_detail(db, form)


@router.get("/{form_id}/preview", response_model=schemas.PublicForm)
def preview_form(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """The *draft* rendered exactly like the public runtime does (no views counted, no submit)."""
    form = services.get_form_or_404(db, form_id, user)
    doc = services.build_document(form)
    return schemas.PublicForm(public_id=form.public_id, preview=True, **doc)
