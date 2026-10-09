"""Turn raw respondent input into validated answers by replaying the form's flow."""
from __future__ import annotations

from typing import Any

from .logic import next_ref
from .validation import AnswerError, validate_answer


def process_submission(questions: list[dict], raw: dict[str, Any]):
    """Walk the questions exactly as the respondent did (following branching).

    Returns ([(question, normalised_value)], [{"ref", "message"}]).  Only questions on
    the walked path are validated/stored; answers to other questions are discarded.
    """
    by_ref = {q["ref"]: i for i, q in enumerate(questions)}
    out: list[tuple[dict, Any]] = []
    errors: list[dict] = []
    i: int | None = 0 if questions else None
    while i is not None and len(out) <= len(questions):
        q = questions[i]
        try:
            value = validate_answer(q, raw.get(q["ref"]))
        except AnswerError as exc:
            errors.append({"ref": q["ref"], "message": str(exc)})
            value = None
        out.append((q, value))
        j = by_ref.get(next_ref(questions, i, value))
        i = j if j is not None and j > i else None  # END / backward jump stop the walk
    return out, errors
