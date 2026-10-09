/** Client mirror of backend/app/logic.py — keeps jumps instant. The server replays the same rules. */
import type { AnswerValue, RuntimeQuestion } from "./types";

export const END = "end";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const num = (v: unknown) => {
  const n = Number(v);
  return v === "" || v === null || Number.isNaN(n) ? null : n;
};

export function isAnswered(v: AnswerValue): boolean {
  return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
}

export function evaluate(rule: { operator: string; value: string }, answer: AnswerValue): boolean {
  const op = rule.operator;
  if (op === "always") return true;
  if (op === "is_answered") return isAnswered(answer);
  if (!isAnswered(answer) && typeof answer !== "boolean") return op === "not_equals";

  const expected = rule.value ?? "";
  if (typeof answer === "boolean") {
    const got = answer ? "yes" : "no";
    if (op === "equals") return got === norm(expected);
    if (op === "not_equals") return got !== norm(expected);
    return false;
  }
  if (Array.isArray(answer)) {
    const set = new Set(answer.map(norm));
    if (op === "equals" || op === "contains") return set.has(norm(expected));
    if (op === "not_equals") return !set.has(norm(expected));
    return false;
  }
  if (typeof answer === "number") {
    const e = num(expected);
    if (e === null) return op === "not_equals";
    switch (op) {
      case "equals": return answer === e;
      case "not_equals": return answer !== e;
      case "greater_than": return answer > e;
      case "less_than": return answer < e;
      default: return false;
    }
  }
  const got = norm(answer);
  const exp = norm(expected);
  switch (op) {
    case "equals": return got === exp;
    case "not_equals": return got !== exp;
    case "contains": return got.includes(exp);
    case "greater_than":
    case "less_than": {
      const a = num(answer), e = num(expected);
      if (a === null || e === null) return false;
      return op === "greater_than" ? a > e : a < e;
    }
    default: return false;
  }
}

/** Index of the next question, or -1 for the ending screen. */
export function nextIndex(questions: RuntimeQuestion[], index: number, answer: AnswerValue): number {
  const q = questions[index];
  for (const rule of q.logic) {
    if (evaluate(rule, answer)) {
      if (rule.destination === END) return -1;
      const j = questions.findIndex((x) => x.ref === rule.destination);
      if (j > index) return j; // forward-only; anything else falls through
    }
  }
  return index + 1 < questions.length ? index + 1 : -1;
}
