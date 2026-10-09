"""Question + logic editing (the builder's command layer)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas, services
from ..constants import CHOICE_TYPES
from ..database import get_db
from ..deps import current_user

router = APIRouter(prefix="/api/forms/{form_id}", tags=["questions"])

NUMERIC_OPS = ("greater_than", "less_than")


def _get_question(form: models.Form, question_id: int) -> models.Question:
    for q in form.questions:
        if q.id == question_id:
            return q
    raise HTTPException(404, "Question not found")


def _drop_invalid_rules(db: Session, form: models.Form) -> None:
    """Branching is forward-only: delete rules whose destination is no longer after the source."""
    pos = {q.id: q.position for q in form.questions}
    for r in list(form.logic_rules):
        if r.source_question_id not in pos:
            form.logic_rules.remove(r)
        elif r.destination_type == "question" and (
            r.destination_question_id not in pos or pos[r.destination_question_id] <= pos[r.source_question_id]
        ):
            form.logic_rules.remove(r)


@router.post("/questions", response_model=schemas.FormDetail, status_code=201)
def add_question(form_id: int, payload: schemas.QuestionCreate, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    questions = services.sorted_questions(form)
    index = len(questions)
    if payload.after_id is not None:
        index = questions.index(_get_question(form, payload.after_id)) + 1
    q = services.new_question(form, payload.type)
    questions.insert(index, q)
    services.renumber(questions)
    services.touch(form)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)


@router.patch("/questions/{question_id}", response_model=schemas.QuestionOut)
def update_question(form_id: int, question_id: int, payload: schemas.QuestionPatch, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    q = _get_question(form, question_id)

    if payload.type is not None and payload.type != q.type:
        q.type = payload.type
        q.properties = services.default_properties(q.type)
        # rules were written for the old answer type
        for r in [r for r in form.logic_rules if r.source_question_id == q.id]:
            form.logic_rules.remove(r)
        if q.type in CHOICE_TYPES:
            if not q.choices:
                q.choices = [models.Choice(position=i, label=f"Choice {i + 1}") for i in range(3)]
        else:
            q.choices = []
    if payload.title is not None:
        q.title = payload.title
    if payload.description is not None:
        q.description = payload.description
    if payload.required is not None:
        q.required = payload.required
    if payload.properties is not None:
        q.properties = services.clean_properties(q.type, payload.properties)
    if payload.choices is not None:
        if q.type not in CHOICE_TYPES:
            raise HTTPException(422, "This question type has no choices")
        existing = {c.id: c for c in q.choices}
        kept: list[models.Choice] = []
        for i, item in enumerate(payload.choices):
            c = existing.pop(item.id, None) if item.id is not None else None
            if c is None:
                c = models.Choice(label=item.label)
            elif c.label != item.label:
                # keep logic rules pointing at the renamed choice working
                for r in form.logic_rules:
                    if r.source_question_id == q.id and r.value == c.label:
                        r.value = item.label
                c.label = item.label
            c.position = i
            kept.append(c)
        q.choices = kept  # delete-orphan removes the dropped ones
    services.touch(form)
    db.commit()
    db.refresh(q)
    return schemas.QuestionOut.model_validate(q)


@router.delete("/questions/{question_id}", response_model=schemas.FormDetail)
def delete_question(form_id: int, question_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    q = _get_question(form, question_id)
    remaining = [x for x in services.sorted_questions(form) if x.id != q.id]
    for r in [r for r in form.logic_rules if q.id in (r.source_question_id, r.destination_question_id)]:
        form.logic_rules.remove(r)
    form.questions.remove(q)
    services.renumber(remaining)
    services.touch(form)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)


@router.post("/questions/{question_id}/duplicate", response_model=schemas.FormDetail, status_code=201)
def duplicate_question(form_id: int, question_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    src = _get_question(form, question_id)
    questions = services.sorted_questions(form)
    copy = models.Question(
        position=len(questions),
        type=src.type,
        title=src.title,
        description=src.description,
        required=src.required,
        properties=dict(src.properties or {}),
        choices=[models.Choice(position=c.position, label=c.label) for c in src.choices],
    )
    form.questions.append(copy)
    questions.insert(questions.index(src) + 1, copy)
    services.renumber(questions)
    services.touch(form)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)


@router.put("/questions/order", response_model=schemas.FormDetail)
def reorder_questions(form_id: int, payload: schemas.QuestionOrder, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Commit ONE semantic move (the drag overlay lives in the client until drop)."""
    form = services.get_form_or_404(db, form_id, user)
    by_id = {q.id: q for q in form.questions}
    if sorted(payload.question_ids) != sorted(by_id) or len(set(payload.question_ids)) != len(payload.question_ids):
        raise HTTPException(422, "question_ids must list every question exactly once")
    services.renumber([by_id[i] for i in payload.question_ids])
    _drop_invalid_rules(db, form)
    services.touch(form)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)


@router.put("/logic", response_model=schemas.FormDetail)
def replace_logic(form_id: int, payload: schemas.LogicReplace, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    by_id = {q.id: q for q in form.questions}
    new_rules: list[models.LogicRule] = []
    for i, r in enumerate(payload.rules):
        src = by_id.get(r.source_question_id)
        if not src:
            raise HTTPException(422, f"Rule {i + 1}: unknown source question")
        if src.type == "file_upload" and r.operator not in ("always", "is_answered"):
            raise HTTPException(422, f"Rule {i + 1}: file questions can only be checked with 'is answered'")
        if r.operator in NUMERIC_OPS and src.type not in ("number", "rating"):
            raise HTTPException(422, f"Rule {i + 1}: '{r.operator}' only works on number and rating questions")
        if r.operator not in ("always", "is_answered") and r.value.strip() == "":
            raise HTTPException(422, f"Rule {i + 1}: choose a value to compare with")
        dest_id = None
        if r.destination_type == "question":
            dest = by_id.get(r.destination_question_id or -1)
            if not dest:
                raise HTTPException(422, f"Rule {i + 1}: choose where to jump to")
            if dest.position <= src.position:
                raise HTTPException(422, f"Rule {i + 1}: you can only jump forward to a later question")
            dest_id = dest.id
        new_rules.append(
            models.LogicRule(
                form_id=form.id,
                source_question_id=src.id,
                position=i,
                operator=r.operator,
                value="" if r.operator in ("always", "is_answered") else r.value,
                destination_type=r.destination_type,
                destination_question_id=dest_id,
            )
        )
    form.logic_rules = new_rules
    services.touch(form)
    db.commit()
    db.refresh(form)
    return services.form_detail(db, form)
