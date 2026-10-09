/** Client-side validation: instant feedback. The server applies the same rules authoritatively. */
import type { AnswerValue, RuntimeQuestion } from "./types";
import { isAnswered } from "./logic";

export const MSG = {
  required: "Please fill this in",
  choice: "Oops! Please make a selection",
  email: "Hmm... that email address looks invalid",
  number: "Numbers only please!",
  file: "Please upload a file",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns an error message, or null when the answer is acceptable. */
export function validateAnswer(q: RuntimeQuestion, value: AnswerValue): string | null {
  const v = typeof value === "string" ? value.trim() : value;
  if (!isAnswered(v) && typeof v !== "boolean") {
    if (!q.required) return null;
    if (q.type === "file_upload") return MSG.file;
    return ["multiple_choice", "dropdown", "yes_no", "rating"].includes(q.type) ? MSG.choice : MSG.required;
  }
  switch (q.type) {
    case "short_text":
    case "long_text": {
      const max = q.properties.max_length as number | undefined;
      if (max && String(v).length > max) return `Please keep this under ${max} characters`;
      return null;
    }
    case "email":
      return EMAIL.test(String(v)) ? null : MSG.email;
    case "number": {
      const n = Number(v);
      if (typeof v === "boolean" || String(v) === "" || !Number.isFinite(n)) return MSG.number;
      const { min, max } = q.properties as { min?: number; max?: number };
      if (min !== undefined && min !== null && n < min) return `Please enter a number of at least ${min}`;
      if (max !== undefined && max !== null && n > max) return `Please enter a number no greater than ${max}`;
      return null;
    }
    default:
      return null;
  }
}
