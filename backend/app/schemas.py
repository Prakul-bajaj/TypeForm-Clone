"""Pydantic request/response models."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer, field_validator

from .constants import DEFAULT_SETTINGS, DEFAULT_THEME, OPERATORS, QUESTION_TYPES

QuestionType = Literal[
    "short_text", "long_text", "multiple_choice", "dropdown", "email", "number", "yes_no", "rating", "file_upload"
]
Operator = Literal["equals", "not_equals", "contains", "greater_than", "less_than", "is_answered", "always"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

assert set(QuestionType.__args__) == set(QUESTION_TYPES)  # type: ignore[attr-defined]
assert set(Operator.__args__) == set(OPERATORS)  # type: ignore[attr-defined]


def _utc_iso(v: datetime) -> str:
    # SQLite hands back naive datetimes — they are always UTC in this app.
    return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ───────────────────────── theme / settings ─────────────────────────
class Theme(BaseModel):
    name: str = DEFAULT_THEME["name"]
    font: Literal["Karla", "Inter", "Playfair Display", "Space Grotesk", "Georgia", "Verdana", "Courier New"] = "Karla"
    background: str = DEFAULT_THEME["background"]
    question_color: str = DEFAULT_THEME["question_color"]
    answer_color: str = DEFAULT_THEME["answer_color"]
    button_color: str = DEFAULT_THEME["button_color"]
    button_text_color: str = DEFAULT_THEME["button_text_color"]
    # optional picture behind the questions + how much to darken it (keeps text readable)
    background_image: str = Field("", max_length=500)
    background_overlay: int = Field(0, ge=0, le=80)

    @field_validator("background_image")
    @classmethod
    def _bg_url(cls, v: str) -> str:
        v = v.strip()
        if v and not (v.startswith("/api/public/assets/") or v.startswith("https://") or v.startswith("http://")):
            raise ValueError("background image must be an uploaded image or an http(s) URL")
        return v

    @field_validator("background", "question_color", "answer_color", "button_color", "button_text_color")
    @classmethod
    def _hex(cls, v: str) -> str:
        if not HEX.match(v):
            raise ValueError("must be a #RRGGBB colour")
        return v


class Welcome(BaseModel):
    enabled: bool = False
    title: str = Field(DEFAULT_SETTINGS["welcome"]["title"], max_length=200)
    description: str = Field(DEFAULT_SETTINGS["welcome"]["description"], max_length=1000)
    button_text: str = Field(DEFAULT_SETTINGS["welcome"]["button_text"], max_length=40)


class Ending(BaseModel):
    title: str = Field(DEFAULT_SETTINGS["ending"]["title"], max_length=200)
    description: str = Field(DEFAULT_SETTINGS["ending"]["description"], max_length=1000)
    button_text: str = Field("", max_length=40)
    button_link: str = Field("", max_length=500)

    @field_validator("button_link")
    @classmethod
    def _link(cls, v: str) -> str:
        if v and not re.match(r"^https?://", v):
            raise ValueError("must start with http:// or https://")
        return v


class Settings(BaseModel):
    show_progress_bar: bool = True
    show_question_numbers: bool = True
    welcome: Welcome = Welcome()
    ending: Ending = Ending()


# ───────────────────────── questions / logic ─────────────────────────
class ChoiceOut(ORM):
    id: int
    label: str


class ChoiceIn(BaseModel):
    id: int | None = None
    label: Annotated[str, Field(max_length=500)]


class QuestionOut(ORM):
    id: int
    ref: str
    position: int
    type: QuestionType
    title: str
    description: str
    required: bool
    properties: dict[str, Any]
    choices: list[ChoiceOut]


class QuestionCreate(BaseModel):
    type: QuestionType = "short_text"
    after_id: int | None = None  # insert after this question (default: append)


class QuestionPatch(BaseModel):
    type: QuestionType | None = None
    title: str | None = Field(None, max_length=1000)
    description: str | None = Field(None, max_length=2000)
    required: bool | None = None
    properties: dict[str, Any] | None = None
    choices: list[ChoiceIn] | None = Field(None, max_length=100)


class QuestionOrder(BaseModel):
    question_ids: list[int]


class LogicRuleIn(BaseModel):
    source_question_id: int
    operator: Operator
    value: str = Field("", max_length=500)
    destination_type: Literal["question", "end"] = "question"
    destination_question_id: int | None = None


class LogicRuleOut(ORM):
    id: int
    source_question_id: int
    operator: Operator
    value: str
    destination_type: Literal["question", "end"]
    destination_question_id: int | None


class LogicReplace(BaseModel):
    rules: list[LogicRuleIn] = Field(max_length=200)


# ───────────────────────── forms ─────────────────────────
class FormCreate(BaseModel):
    title: str = Field("Untitled form", min_length=1, max_length=200)


class FormPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    theme: Theme | None = None
    settings: Settings | None = None


class FormSummary(ORM):
    id: int
    public_id: str
    title: str
    status: Literal["draft", "published"]
    response_count: int = 0
    question_count: int = 0
    view_count: int = 0
    has_unpublished_changes: bool = False
    created_at: UTCDateTime
    updated_at: UTCDateTime
    published_at: UTCDateTime | None = None


class FormDetail(FormSummary):
    draft_version: int
    theme: Theme
    settings: Settings
    questions: list[QuestionOut]
    logic: list[LogicRuleOut]


# ───────────────────────── public runtime ─────────────────────────
class PublicChoice(BaseModel):
    label: str


class PublicLogic(BaseModel):
    operator: Operator
    value: str = ""
    destination: str  # a question ref or "end"


class PublicQuestion(BaseModel):
    ref: str
    type: QuestionType
    title: str
    description: str = ""
    required: bool = False
    properties: dict[str, Any] = {}
    choices: list[PublicChoice] = []
    logic: list[PublicLogic] = []


class PublicForm(BaseModel):
    public_id: str
    title: str
    theme: Theme
    settings: Settings
    questions: list[PublicQuestion]
    preview: bool = False


class AnswerIn(BaseModel):
    ref: str
    value: Any = None


class SubmitIn(BaseModel):
    answers: list[AnswerIn] = Field(max_length=500)
    started_at: datetime | None = None
    idempotency_key: str | None = Field(None, max_length=64)


class ProgressIn(BaseModel):
    """Answers collected so far (sent while the respondent is still filling the form in)."""
    idempotency_key: str = Field(min_length=8, max_length=64)
    answers: list[AnswerIn] = Field(max_length=500)
    started_at: datetime | None = None


class UploadOut(BaseModel):
    file_id: str
    name: str
    size: int
    content_type: str


class CustomThemeIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    theme: Theme


class CustomThemeOut(ORM):
    id: int
    name: str
    theme: Theme


class SubmitOut(BaseModel):
    response_id: str
    submitted_at: UTCDateTime


# ───────────────────────── results ─────────────────────────
class AnswerOut(ORM):
    question_ref: str
    question_type: str
    question_title: str
    value: Any = None


class ResponseOut(ORM):
    id: int
    token: str
    status: str
    submitted_at: UTCDateTime
    started_at: UTCDateTime | None = None
    duration_seconds: float | None = None
    answers: list[AnswerOut]


class ResponsePage(BaseModel):
    items: list[ResponseOut]
    total: int
    page: int
    page_size: int
    columns: list[dict[str, Any]]  # [{ref,type,title}] — table headers


# ───────────────────────── auth ─────────────────────────
class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please enter your name")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class UserOut(ORM):
    id: int
    name: str
    email: str


class AuthOut(BaseModel):
    token: str
    user: UserOut
