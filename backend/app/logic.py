"""Branching engine.

The form is a directed graph: by default question N → question N+1; logic rules add
"jump" edges.  The same algorithm exists client-side (frontend/lib/logic.ts) for
instant transitions; the server re-runs it so that it — not the browser — decides
which answers are required / accepted.
"""
from __future__ import annotations

from typing import Any

END = "end"


def _norm(v: Any) -> str:
    return str(v).strip().casefold()


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def is_answered(value: Any) -> bool:
    return value is not None and value != "" and value != []


def evaluate(rule: dict, answer: Any) -> bool:
    op = rule["operator"]
    if op == "always":
        return True
    if op == "is_answered":
        return is_answered(answer)
    if not is_answered(answer) and not isinstance(answer, bool):
        # Nothing was answered: only "not equals" can hold.
        return op == "not_equals"

    expected = rule.get("value", "")
    if isinstance(answer, bool):
        got = "yes" if answer else "no"
        if op == "equals":
            return got == _norm(expected)
        if op == "not_equals":
            return got != _norm(expected)
        return False

    if isinstance(answer, list):  # multiple selection
        members = {_norm(a) for a in answer}
        if op in ("equals", "contains"):
            return _norm(expected) in members
        if op == "not_equals":
            return _norm(expected) not in members
        return False

    if isinstance(answer, (int, float)):
        a, e = float(answer), _num(expected)
        if e is None:
            return op == "not_equals"
        return {
            "equals": a == e,
            "not_equals": a != e,
            "greater_than": a > e,
            "less_than": a < e,
        }.get(op, False)

    got = _norm(answer)
    exp = _norm(expected)
    if op == "equals":
        return got == exp
    if op == "not_equals":
        return got != exp
    if op == "contains":
        return exp in got
    if op in ("greater_than", "less_than"):
        a, e = _num(answer), _num(expected)
        if a is None or e is None:
            return False
        return a > e if op == "greater_than" else a < e
    return False


def next_ref(questions: list[dict], index: int, answer: Any) -> str:
    """Ref of the question shown after `questions[index]` (or END)."""
    q = questions[index]
    for rule in q.get("logic", []):
        if evaluate(rule, answer):
            return END if rule["destination"] == END else rule["destination"]
    return questions[index + 1]["ref"] if index + 1 < len(questions) else END
