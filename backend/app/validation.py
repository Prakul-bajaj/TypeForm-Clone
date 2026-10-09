"""Authoritative server-side answer validation (the client repeats the same rules for UX)."""
from __future__ import annotations

import math
from typing import Any

from email_validator import EmailNotValidError, validate_email

MSG_REQUIRED = "Please fill this in"
MSG_CHOICE_REQUIRED = "Oops! Please make a selection"
MSG_EMAIL = "Hmm... that email address looks invalid"
MSG_NUMBER = "Numbers only please!"
MSG_FILE = "Please upload a file"

MAX_SHORT = 500
MAX_LONG = 20000


class AnswerError(ValueError):
    pass


def _empty(v: Any) -> bool:
    return v is None or v == "" or v == []


def validate_answer(q: dict, value: Any) -> Any:
    """Return the normalised value (None if unanswered) or raise AnswerError."""
    t = q["type"]
    props = q.get("properties") or {}
    required = bool(q.get("required"))

    if isinstance(value, str):
        value = value.strip()
    if _empty(value):
        if required:
            raise AnswerError(
                MSG_CHOICE_REQUIRED if t in ("multiple_choice", "dropdown", "yes_no", "rating")
                else MSG_FILE if t == "file_upload" else MSG_REQUIRED
            )
        return None

    if t in ("short_text", "long_text"):
        if not isinstance(value, str):
            raise AnswerError("Text expected")
        limit = props.get("max_length") or (MAX_SHORT if t == "short_text" else MAX_LONG)
        if len(value) > limit:
            raise AnswerError(f"Please keep this under {limit} characters")
        return value

    if t == "email":
        if not isinstance(value, str):
            raise AnswerError(MSG_EMAIL)
        try:
            validate_email(value, check_deliverability=False)
        except EmailNotValidError:
            raise AnswerError(MSG_EMAIL) from None
        return value

    if t == "number":
        if isinstance(value, bool):
            raise AnswerError(MSG_NUMBER)
        try:
            num = float(value)
        except (TypeError, ValueError):
            raise AnswerError(MSG_NUMBER) from None
        if not math.isfinite(num):
            raise AnswerError(MSG_NUMBER)
        lo, hi = props.get("min"), props.get("max")
        if lo is not None and num < lo:
            raise AnswerError(f"Please enter a number of at least {lo:g}")
        if hi is not None and num > hi:
            raise AnswerError(f"Please enter a number no greater than {hi:g}")
        return int(num) if num.is_integer() else num

    if t == "yes_no":
        if not isinstance(value, bool):
            raise AnswerError("Please choose Yes or No")
        return value

    if t == "rating":
        steps = int(props.get("steps", 5))
        if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
            raise AnswerError("Please pick a rating")
        if not 1 <= int(value) <= steps:
            raise AnswerError(f"Please pick a rating between 1 and {steps}")
        return int(value)

    if t in ("multiple_choice", "dropdown"):
        labels = [c["label"] for c in q.get("choices", [])]
        multi = bool(props.get("allow_multiple")) and t == "multiple_choice"
        if multi:
            if isinstance(value, str):
                value = [value]
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                raise AnswerError("Invalid selection")
            if any(v not in labels for v in value):
                raise AnswerError("That option doesn't exist")
            # keep original option order, drop duplicates
            return [l for l in labels if l in set(value)]
        if isinstance(value, list):
            if len(value) != 1:
                raise AnswerError("Please select one option")
            value = value[0]
        if not isinstance(value, str) or value not in labels:
            raise AnswerError("That option doesn't exist")
        return value

    if t == "file_upload":
        # {"file_id": "...", "name": "...", "size": 123} — the id is checked against the uploads table by the router
        if not isinstance(value, dict) or not isinstance(value.get("file_id"), str) or not value["file_id"]:
            raise AnswerError(MSG_FILE)
        return {"file_id": value["file_id"], "name": str(value.get("name", "file"))[:255], "size": int(value.get("size") or 0)}

    raise AnswerError("Unsupported question type")
