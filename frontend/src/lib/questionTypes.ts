import type { QuestionType } from "./types";

export interface QuestionTypeMeta {
  type: QuestionType;
  label: string;
  description: string;
  color: string; // badge background
  group: "Contact info" | "Text" | "Choice" | "Rating & numbers" | "Files";
  letter: string;
}

export const QUESTION_TYPES: QuestionTypeMeta[] = [
  { type: "email", label: "Email", description: "Collect a valid email address", color: "#E8A33D", group: "Contact info", letter: "@" },
  { type: "short_text", label: "Short Text", description: "A single line of text", color: "#4B9CD3", group: "Text", letter: "Aa" },
  { type: "long_text", label: "Long Text", description: "Paragraph-length answers", color: "#3E8EDE", group: "Text", letter: "¶" },
  { type: "multiple_choice", label: "Multiple Choice", description: "Pick one or several options", color: "#8E6BD0", group: "Choice", letter: "☰" },
  { type: "dropdown", label: "Dropdown", description: "Searchable list of options", color: "#B565C4", group: "Choice", letter: "▾" },
  { type: "yes_no", label: "Yes/No", description: "A simple two-way choice", color: "#E0577F", group: "Choice", letter: "✓" },
  { type: "rating", label: "Rating", description: "Star, heart or number scale", color: "#E8A33D", group: "Rating & numbers", letter: "★" },
  { type: "number", label: "Number", description: "Numeric input with min / max", color: "#2FA37A", group: "Rating & numbers", letter: "#" },
  { type: "file_upload", label: "File Upload", description: "Let people attach a file", color: "#5C6BC0", group: "Files", letter: "↑" },
];

export const TYPE_BY_ID = Object.fromEntries(QUESTION_TYPES.map((t) => [t.type, t])) as Record<QuestionType, QuestionTypeMeta>;

/** Shown in the picker but not buildable yet. */
export const COMING_SOON_TYPES = [
  { label: "Payment", description: "Collect payments with Stripe" },
  { label: "Date", description: "Pick a date" },
  { label: "Phone Number", description: "Validated phone numbers" },
];

export const GROUPS = ["Contact info", "Text", "Choice", "Rating & numbers", "Files"] as const;

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  greater_than: "is greater than",
  less_than: "is less than",
  is_answered: "is answered",
  always: "(always) — all other cases",
};

export function operatorsFor(type: QuestionType): string[] {
  switch (type) {
    case "file_upload":
      return ["is_answered", "always"];
    case "number":
    case "rating":
      return ["equals", "not_equals", "greater_than", "less_than", "is_answered", "always"];
    case "multiple_choice":
      return ["equals", "not_equals", "is_answered", "always"];
    case "dropdown":
    case "yes_no":
      return ["equals", "not_equals", "is_answered", "always"];
    default:
      return ["equals", "not_equals", "contains", "is_answered", "always"];
  }
}
