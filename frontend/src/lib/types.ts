export type QuestionType =
  | "short_text"
  | "long_text"
  | "multiple_choice"
  | "dropdown"
  | "email"
  | "number"
  | "yes_no"
  | "rating"
  | "file_upload";

export type Operator =
  | "equals"
  | "not_equals"
  | "contains"
  | "greater_than"
  | "less_than"
  | "is_answered"
  | "always";

export interface Theme {
  name: string;
  font: "Karla" | "Inter" | "Playfair Display" | "Space Grotesk" | "Georgia" | "Verdana" | "Courier New";
  background: string;
  question_color: string;
  answer_color: string;
  button_color: string;
  button_text_color: string;
  /** "" | uploaded image ("/api/public/assets/…") | http(s) URL */
  background_image: string;
  /** 0–80: how much to darken the image so text stays readable */
  background_overlay: number;
}

export interface CustomTheme {
  id: number;
  name: string;
  theme: Theme;
}

/** The answer of a file_upload question. */
export interface FileAnswer {
  file_id: string;
  name: string;
  size: number;
}

export interface Settings {
  show_progress_bar: boolean;
  show_question_numbers: boolean;
  welcome: { enabled: boolean; title: string; description: string; button_text: string };
  ending: { title: string; description: string; button_text: string; button_link: string };
}

export interface Choice {
  id: number | null; // null until the server has assigned one
  key: string; // stable client-side React key
  label: string;
}

export interface Question {
  id: number;
  ref: string;
  position: number;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  properties: Record<string, any>;
  choices: Choice[];
}

export interface LogicRule {
  id?: number;
  source_question_id: number;
  operator: Operator;
  value: string;
  destination_type: "question" | "end";
  destination_question_id: number | null;
}

export interface FormSummary {
  id: number;
  public_id: string;
  title: string;
  status: "draft" | "published";
  response_count: number;
  question_count: number;
  view_count: number;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface FormDetail extends FormSummary {
  draft_version: number;
  theme: Theme;
  settings: Settings;
  questions: Question[];
  logic: LogicRule[];
}

/* ───── public runtime shapes (what the respondent player consumes) ───── */
export interface RuntimeLogic {
  operator: Operator;
  value: string;
  destination: string; // question ref | "end"
}
export interface RuntimeQuestion {
  ref: string;
  type: QuestionType;
  title: string;
  description: string;
  required: boolean;
  properties: Record<string, any>;
  choices: { label: string }[];
  logic: RuntimeLogic[];
}
export interface RuntimeForm {
  public_id: string;
  title: string;
  theme: Theme;
  settings: Settings;
  questions: RuntimeQuestion[];
  preview?: boolean;
}

export type AnswerValue = string | number | boolean | string[] | FileAnswer | null | undefined;

/* ───── results ───── */
export interface AnswerRow {
  question_ref: string;
  question_type: QuestionType;
  question_title: string;
  value: AnswerValue;
}
export interface ResponseRow {
  id: number;
  token: string;
  status: string;
  submitted_at: string;
  started_at: string | null;
  duration_seconds: number | null;
  answers: AnswerRow[];
}
export interface ResponseColumn {
  ref: string;
  type: QuestionType;
  title: string;
  removed: boolean;
}
export interface ResponsePage {
  items: ResponseRow[];
  total: number;
  page: number;
  page_size: number;
  columns: ResponseColumn[];
}
export interface SummaryOption {
  label: string;
  count: number;
  percent: number;
}
export interface SummaryQuestion {
  ref: string;
  type: QuestionType;
  title: string;
  removed: boolean;
  shown: number;
  answered: number;
  skipped: number;
  /** partial responses that stopped on this question */
  abandoned?: number;
  options?: SummaryOption[];
  average?: number | null;
  stats?: { average: number; median: number; min: number; max: number } | null;
  recent?: string[];
  files?: { name: string; size: number }[];
}
export interface Summary {
  total_responses: number;
  partial_responses: number;
  starts: number;
  views: number;
  completion_rate: number | null;
  average_duration_seconds: number | null;
  questions: SummaryQuestion[];
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}
