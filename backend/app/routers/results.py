"""Responses table, single response, per-question summary and CSV export."""
from __future__ import annotations

import csv
import io
import statistics
from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas, services
from ..constants import CHOICE_TYPES
from ..database import get_db
from ..logic import END, next_ref
from ..deps import current_user

router = APIRouter(prefix="/api/forms/{form_id}", tags=["results"])


def _columns(db: Session, form: models.Form) -> list[dict]:
    """Table columns = current questions, then any question that only exists in old answers."""
    cols = [{"ref": q.ref, "type": q.type, "title": q.title or "Untitled question", "removed": False}
            for q in services.sorted_questions(form)]
    known = {c["ref"] for c in cols}
    rows = db.execute(
        select(models.Answer.question_ref, models.Answer.question_type, models.Answer.question_title)
        .join(models.Response)
        .where(models.Response.form_id == form.id)
        .distinct()
    ).all()
    for ref, qtype, title in rows:
        if ref not in known:
            known.add(ref)
            cols.append({"ref": ref, "type": qtype, "title": title or "Untitled question", "removed": True})
    return cols


@router.get("/responses", response_model=schemas.ResponsePage)
def list_responses(
    form_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: Literal["all", "completed", "partial"] = Query("all"),
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    form = services.get_form_or_404(db, form_id, user)
    conds = [models.Response.form_id == form.id]
    if status != "all":
        conds.append(models.Response.status == status)
    total = db.scalar(select(func.count(models.Response.id)).where(*conds)) or 0
    items = db.scalars(
        select(models.Response)
        .where(*conds)
        .options(selectinload(models.Response.answers))
        .order_by(models.Response.submitted_at.desc(), models.Response.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return schemas.ResponsePage(
        items=[schemas.ResponseOut.model_validate(r) for r in items],
        total=total,
        page=page,
        page_size=page_size,
        columns=_columns(db, form),
    )


@router.get("/responses/{response_id}", response_model=schemas.ResponseOut)
def get_response(form_id: int, response_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    r = db.scalar(
        select(models.Response)
        .where(models.Response.id == response_id, models.Response.form_id == form.id)
        .options(selectinload(models.Response.answers))
    )
    if not r:
        raise HTTPException(404, "Response not found")
    return schemas.ResponseOut.model_validate(r)


@router.delete("/responses/{response_id}", status_code=204)
def delete_response(form_id: int, response_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    r = db.scalar(select(models.Response).where(models.Response.id == response_id, models.Response.form_id == form.id))
    if not r:
        raise HTTPException(404, "Response not found")
    services.delete_uploads(db, models.Upload.response_id == r.id)
    db.delete(r)
    db.commit()
    services.remove_pending_files(db)


def _fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return "; ".join(str(v) for v in value)
    if isinstance(value, dict):  # file answer
        return str(value.get("name", "file"))
    return str(value)


@router.get("/responses.csv")
def export_csv(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    cols = _columns(db, form)
    responses = db.scalars(
        select(models.Response)
        .where(models.Response.form_id == form.id)
        .options(selectinload(models.Response.answers))
        .order_by(models.Response.submitted_at.desc())
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Response ID", "Status", "Submitted / last activity (UTC)", *[c["title"] for c in cols]])
    for r in responses:  # completed and partial responses (see the Status column)
        by_ref = {a.question_ref: a.value for a in r.answers}
        w.writerow([r.token, r.status, r.submitted_at.strftime("%Y-%m-%d %H:%M:%S"), *[_fmt(by_ref.get(c["ref"])) for c in cols]])
    name = "".join(ch if ch.isalnum() else "_" for ch in form.title).strip("_") or "form"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{name}_responses.csv"'},
    )


def _option(label: str, count: int, base: int) -> dict:
    return {"label": label, "count": count, "percent": round(count * 100 / base, 1) if base else 0}


def _stopped_at(db: Session, form: models.Form) -> dict[str, int]:
    """For every partial response: the question the respondent was looking at when they left.

    That is "the question after the last one they answered", following the branching rules of the
    revision they were shown (a final question answered but never submitted counts for itself).
    """
    partials = db.scalars(
        select(models.Response)
        .where(models.Response.form_id == form.id, models.Response.status == "partial")
        .options(selectinload(models.Response.answers))
    ).all()
    docs: dict[int, list[dict]] = {}
    out: Counter = Counter()
    for r in partials:
        if r.revision_id not in docs:
            rev = db.get(models.FormRevision, r.revision_id) if r.revision_id else None
            docs[r.revision_id] = rev.document["questions"] if rev else []
        qs = docs[r.revision_id]
        index = {q["ref"]: i for i, q in enumerate(qs)}
        answered = [(index[a.question_ref], a) for a in r.answers if a.question_ref in index]
        if not answered:
            continue
        i, a = max(answered, key=lambda x: x[0])
        nxt = next_ref(qs, i, a.value)
        out[qs[i]["ref"] if nxt == END else nxt] += 1
    return dict(out)


@router.get("/summary")
def summary(form_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    form = services.get_form_or_404(db, form_id, user)
    done = (models.Response.form_id == form.id, models.Response.status == "completed")
    total = db.scalar(select(func.count(models.Response.id)).where(*done)) or 0
    partial = db.scalar(
        select(func.count(models.Response.id)).where(models.Response.form_id == form.id, models.Response.status == "partial")
    ) or 0
    avg_duration = db.scalar(
        select(func.avg(models.Response.duration_seconds)).where(*done, models.Response.duration_seconds.is_not(None))
    )
    answers = db.execute(
        select(models.Answer.question_ref, models.Answer.value, models.Response.submitted_at)
        .join(models.Response)
        .where(*done)  # per-question stats describe completed responses only
        .order_by(models.Response.submitted_at.desc(), models.Response.id.desc())
    ).all()
    by_ref: dict[str, list] = {}
    for ref, value, _ts in answers:  # newest first
        by_ref.setdefault(ref, []).append(value)

    questions = []
    cols = _columns(db, form)
    qmap = {q.ref: q for q in form.questions}
    stopped = _stopped_at(db, form)
    for position, col in enumerate(cols, start=1):
        values = by_ref.get(col["ref"], [])
        given = [v for v in values if v is not None]
        item = {
            "ref": col["ref"],
            "type": col["type"],
            "title": col["title"],
            "removed": col["removed"],
            "shown": len(values),  # respondents who reached this question
            "answered": len(given),
            "skipped": len(values) - len(given),
            "abandoned": stopped.get(col["ref"], 0),  # partial responses that stopped on this question
        }
        q = qmap.get(col["ref"])
        t = col["type"]
        if t in CHOICE_TYPES:
            flat = [x for v in given for x in (v if isinstance(v, list) else [v])]
            counts = Counter(flat)
            labels = [c.label for c in q.choices] if q else []
            labels += [l for l in counts if l not in labels]  # choices deleted since
            item["options"] = [_option(l, counts.get(l, 0), len(given)) for l in labels]
        elif t == "yes_no":
            counts = Counter(bool(v) for v in given)
            item["options"] = [_option("Yes", counts.get(True, 0), len(given)), _option("No", counts.get(False, 0), len(given))]
        elif t == "rating":
            steps = int((q.properties or {}).get("steps", 5)) if q else max([int(v) for v in given] + [5])
            counts = Counter(int(v) for v in given)
            item["options"] = [_option(str(i), counts.get(i, 0), len(given)) for i in range(1, steps + 1)]
            item["average"] = round(sum(int(v) for v in given) / len(given), 2) if given else None
        elif t == "number":
            nums = [float(v) for v in given]
            item["stats"] = (
                {"average": round(statistics.fmean(nums), 2), "median": statistics.median(nums), "min": min(nums), "max": max(nums)}
                if nums else None
            )
        elif t == "file_upload":
            item["files"] = [{"name": v.get("name", "file"), "size": v.get("size", 0)} for v in given[:5] if isinstance(v, dict)]
        else:  # short_text, long_text, email → latest answers
            item["recent"] = [str(v) for v in given[:5]]
        questions.append(item)

    return {
        "total_responses": total,
        "partial_responses": partial,
        "starts": total + partial,  # people who answered at least one question
        "views": form.view_count,
        # Typeform's definition: submissions ÷ starts
        "completion_rate": round(total * 100 / (total + partial), 1) if (total + partial) else None,
        "average_duration_seconds": round(avg_duration, 1) if avg_duration else None,
        "questions": questions,
    }
