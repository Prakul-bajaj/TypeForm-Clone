"""Business logic shared by the routers: serialisation, snapshots, publish checks."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, schemas
from .config import DEFAULT_UPLOAD_MB, MAX_UPLOAD_MB
from .constants import CHOICE_TYPES, DEFAULT_SETTINGS, DEFAULT_THEME
from .logic import END


# ───────────────────────── helpers ─────────────────────────
def now() -> datetime:
    """Naive UTC (SQLite has no tz support; everything stored is UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_form_or_404(db: Session, form_id: int, user: models.User) -> models.Form:
    """Fetch a form that belongs to ``user``. Someone else's form looks exactly like a missing one."""
    form = db.get(models.Form, form_id)
    if not form or form.owner_id != user.id:
        raise HTTPException(404, "Form not found")
    return form


def touch(form: models.Form) -> None:
    """Record that the draft changed (drives the 'Publish changes' state)."""
    form.draft_version += 1
    form.updated_at = now()


def sorted_questions(form: models.Form) -> list[models.Question]:
    return sorted(form.questions, key=lambda q: q.position)


def renumber(questions: list[models.Question]) -> None:
    for i, q in enumerate(questions):
        q.position = i


def live_revision(db: Session, form: models.Form) -> models.FormRevision | None:
    return db.scalar(
        select(models.FormRevision)
        .where(models.FormRevision.form_id == form.id)
        .order_by(models.FormRevision.version.desc())
        .limit(1)
    )


def default_properties(qtype: str) -> dict:
    return {
        "rating": {"steps": 5, "shape": "star"},
        "multiple_choice": {"allow_multiple": False},
        "number": {},
        "file_upload": {"max_size_mb": DEFAULT_UPLOAD_MB},
    }.get(qtype, {})


def clean_properties(qtype: str, props: dict) -> dict:
    """Keep only the keys that make sense for the type, coerced to safe values."""
    out: dict = {}
    if qtype == "rating":
        try:
            steps = int(props.get("steps", 5))
        except (TypeError, ValueError):
            steps = 5
        out["steps"] = max(3, min(10, steps))
        out["shape"] = props.get("shape") if props.get("shape") in ("star", "heart", "number") else "star"
    elif qtype == "number":
        for k in ("min", "max"):
            v = props.get(k)
            try:
                out[k] = float(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                out[k] = None
        if out.get("min") is not None and out.get("max") is not None and out["min"] > out["max"]:
            out["min"], out["max"] = out["max"], out["min"]
        out = {k: v for k, v in out.items() if v is not None}
    elif qtype == "multiple_choice":
        out["allow_multiple"] = bool(props.get("allow_multiple", False))
    elif qtype == "file_upload":
        try:
            mb = int(props.get("max_size_mb", DEFAULT_UPLOAD_MB))
        except (TypeError, ValueError):
            mb = DEFAULT_UPLOAD_MB
        out["max_size_mb"] = max(1, min(MAX_UPLOAD_MB, mb))
    elif qtype in ("short_text", "long_text"):
        ml = props.get("max_length")
        if isinstance(ml, (int, float)) and not isinstance(ml, bool) and ml > 0:
            out["max_length"] = int(ml)
        if isinstance(props.get("placeholder"), str):
            out["placeholder"] = props["placeholder"][:200]
    return out


def new_question(form: models.Form, qtype: str) -> models.Question:
    q = models.Question(
        type=qtype, title="", description="", required=False,
        position=len(form.questions), properties=default_properties(qtype),
    )
    form.questions.append(q)  # SQLAlchemy 2.0: the forward collection cascades the object into the session
    if qtype in CHOICE_TYPES:
        q.choices = [models.Choice(position=i, label=f"Choice {i + 1}") for i in range(3)]
    return q


# ───────────────────────── serialisation ─────────────────────────
def response_counts(db: Session, form_ids: list[int]) -> dict[int, int]:
    if not form_ids:
        return {}
    rows = db.execute(
        select(models.Response.form_id, func.count(models.Response.id))
        .where(models.Response.form_id.in_(form_ids), models.Response.status == "completed")
        .group_by(models.Response.form_id)
    ).all()
    return dict(rows)


def form_summary(form: models.Form, count: int) -> dict:
    return {
        "id": form.id,
        "public_id": form.public_id,
        "title": form.title,
        "status": form.status,
        "response_count": count,
        "question_count": len(form.questions),
        "view_count": form.view_count,
        "has_unpublished_changes": form.status == "published"
        and form.published_draft_version != form.draft_version,
        "created_at": form.created_at,
        "updated_at": form.updated_at,
        "published_at": form.published_at,
    }


def form_detail(db: Session, form: models.Form) -> schemas.FormDetail:
    count = response_counts(db, [form.id]).get(form.id, 0)
    return schemas.FormDetail(
        **form_summary(form, count),
        draft_version=form.draft_version,
        theme=schemas.Theme(**{**DEFAULT_THEME, **(form.theme or {})}),
        settings=schemas.Settings(**(form.settings or {})),
        questions=[schemas.QuestionOut.model_validate(q) for q in sorted_questions(form)],
        logic=[schemas.LogicRuleOut.model_validate(r) for r in form.logic_rules],
    )


def build_document(form: models.Form) -> dict:
    """The canonical, self-contained form definition the public runtime consumes."""
    questions = sorted_questions(form)
    ref_by_id = {q.id: q.ref for q in questions}
    rules_by_source: dict[int, list[models.LogicRule]] = {}
    for r in sorted(form.logic_rules, key=lambda r: r.position):
        rules_by_source.setdefault(r.source_question_id, []).append(r)
    return {
        "title": form.title,
        "theme": {**DEFAULT_THEME, **(form.theme or {})},
        "settings": schemas.Settings(**(form.settings or {})).model_dump(),
        "questions": [
            {
                "ref": q.ref,
                "type": q.type,
                "title": q.title,
                "description": q.description,
                "required": q.required,
                "properties": q.properties or {},
                "choices": [{"label": c.label} for c in q.choices],
                "logic": [
                    {
                        "operator": r.operator,
                        "value": r.value,
                        "destination": END
                        if r.destination_type == "end"
                        else ref_by_id.get(r.destination_question_id, END),
                    }
                    for r in rules_by_source.get(q.id, [])
                ],
            }
            for q in questions
        ],
    }


def publish_problems(form: models.Form) -> list[dict]:
    problems: list[dict] = []
    questions = sorted_questions(form)
    if not questions:
        return [{"message": "Add at least one question before publishing"}]
    for i, q in enumerate(questions, start=1):
        if not q.title.strip():
            problems.append({"question_id": q.id, "message": f"Question {i} has no title"})
        if q.type in CHOICE_TYPES:
            labels = [c.label.strip() for c in q.choices]
            if not labels:
                problems.append({"question_id": q.id, "message": f"Question {i} needs at least one choice"})
            elif any(not l for l in labels):
                problems.append({"question_id": q.id, "message": f"Question {i} has an empty choice"})
            elif len(set(l.casefold() for l in labels)) != len(labels):
                problems.append({"question_id": q.id, "message": f"Question {i} has duplicate choices"})
    by_id = {q.id: q for q in questions}
    for r in form.logic_rules:
        src = by_id.get(r.source_question_id)
        if src and src.type in CHOICE_TYPES and r.operator in ("equals", "not_equals", "contains"):
            if r.value not in [c.label for c in src.choices]:
                idx = questions.index(src) + 1
                problems.append(
                    {"question_id": src.id, "message": f"A logic rule on question {idx} uses a choice that no longer exists"}
                )
    return problems


def delete_uploads(db: Session, *conditions) -> None:
    """Delete upload rows matching ``conditions`` and (after commit succeeds) their files on disk."""
    from . import storage

    rows = db.scalars(select(models.Upload).where(*conditions)).all()
    paths = [u.path for u in rows]
    for u in rows:
        db.delete(u)
    db.info.setdefault("files_to_remove", []).extend(paths)


def remove_pending_files(db: Session) -> None:
    """Call right after ``db.commit()``: unlink files whose rows were deleted."""
    from . import storage

    storage.remove_files(db.info.pop("files_to_remove", []))
