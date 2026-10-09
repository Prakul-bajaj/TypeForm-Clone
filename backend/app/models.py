"""SQLAlchemy ORM models — the relational schema.

forms ─┬─< questions ─┬─< choices
       │              └─< logic_rules (source question → destination question | end)
       ├─< form_revisions   (immutable snapshots created on publish)
       ├─< responses ─< answers      (status: completed | partial)
       └─< uploads                   (files attached to answers)
users ──< custom_themes               (saved themes) and users ──< uploads (background images)
users ──< forms        (users.password_hash: PBKDF2; login issues a signed token)
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

_ALPHABET = string.ascii_letters + string.digits


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_public_id() -> str:
    """Short, non-sequential id used in the shareable link (/to/AbC123xy)."""
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def new_ref() -> str:
    """Stable question reference that survives reordering and revisions."""
    return "q_" + uuid.uuid4().hex[:10]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # None only for legacy rows
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    forms: Mapped[list[Form]] = relationship(back_populates="owner")


class Form(Base):
    __tablename__ = "forms"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(16), unique=True, index=True, default=new_public_id)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Untitled form")
    status: Mapped[str] = mapped_column(String(12), default="draft")  # draft | published
    theme: Mapped[dict] = mapped_column(JSON, default=dict)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    # Bumped on every edit; compared to the live revision to show "Publish changes".
    draft_version: Mapped[int] = mapped_column(Integer, default=1)
    # draft_version captured at the last publish (None = never published)
    published_draft_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    owner: Mapped[User] = relationship(back_populates="forms")
    questions: Mapped[list[Question]] = relationship(
        back_populates="form", cascade="all, delete-orphan", order_by="Question.position"
    )
    logic_rules: Mapped[list[LogicRule]] = relationship(
        back_populates="form", cascade="all, delete-orphan", order_by="LogicRule.position"
    )
    revisions: Mapped[list[FormRevision]] = relationship(
        back_populates="form", cascade="all, delete-orphan", order_by="FormRevision.version"
    )
    responses: Mapped[list[Response]] = relationship(back_populates="form", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (Index("ix_questions_form_position", "form_id", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(32), unique=True, default=new_ref)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    # Type-specific settings: rating {steps}, number {min,max}, choice {allow_multiple}, ...
    properties: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    form: Mapped[Form] = relationship(back_populates="questions")
    choices: Mapped[list[Choice]] = relationship(
        back_populates="question", cascade="all, delete-orphan", order_by="Choice.position"
    )


class Choice(Base):
    __tablename__ = "choices"

    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String(500))

    question: Mapped[Question] = relationship(back_populates="choices")


class LogicRule(Base):
    """Basic branching: IF <source question> <operator> <value> THEN jump to <destination>.

    Rules of one source question are evaluated in `position` order; the first match wins.
    No match → continue to the next question. Destinations are forward-only (no loops).
    """

    __tablename__ = "logic_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), index=True)
    source_question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    operator: Mapped[str] = mapped_column(String(24))
    value: Mapped[str] = mapped_column(Text, default="")
    destination_type: Mapped[str] = mapped_column(String(10), default="question")  # question | end
    destination_question_id: Mapped[int | None] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), nullable=True
    )

    form: Mapped[Form] = relationship(back_populates="logic_rules")


class FormRevision(Base):
    """Immutable snapshot of the form definition taken at publish time.

    The public link always serves the newest revision of a *published* form, so the
    creator can keep editing the draft without touching what respondents see.
    """

    __tablename__ = "form_revisions"
    __table_args__ = (UniqueConstraint("form_id", "version", name="uq_revision_form_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    draft_version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    form: Mapped[Form] = relationship(back_populates="revisions")


class Response(Base):
    __tablename__ = "responses"
    __table_args__ = (
        Index("ix_responses_form_submitted", "form_id", "submitted_at"),
        UniqueConstraint("form_id", "idempotency_key", name="uq_response_idempotency"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(40), unique=True, default=lambda: "resp_" + uuid.uuid4().hex[:16])
    form_id: Mapped[int] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"))
    revision_id: Mapped[int | None] = mapped_column(ForeignKey("form_revisions.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="completed")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)

    form: Mapped[Form] = relationship(back_populates="responses")
    answers: Mapped[list[Answer]] = relationship(
        back_populates="response", cascade="all, delete-orphan", order_by="Answer.id"
    )


class Answer(Base):
    """One answer. `question_ref` + title/type are copied from the revision so the
    response stays readable even after the question is edited or deleted."""

    __tablename__ = "answers"
    __table_args__ = (
        UniqueConstraint("response_id", "question_ref", name="uq_answer_response_question"),
        Index("ix_answers_question_ref", "question_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id", ondelete="CASCADE"), index=True)
    question_ref: Mapped[str] = mapped_column(String(32))
    question_type: Mapped[str] = mapped_column(String(24))
    question_title: Mapped[str] = mapped_column(Text, default="")
    value: Mapped[object] = mapped_column(JSON, nullable=True)

    response: Mapped[Response] = relationship(back_populates="answers")


class Upload(Base):
    """A file stored on disk.

    kind="answer":      a respondent's file for a file_upload question (form_id set; response_id set on submit)
    kind="background":  a creator's theme background image (owner_id set, served publicly by token)
    """

    __tablename__ = "uploads"

    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(40), unique=True, default=lambda: "f_" + uuid.uuid4().hex[:20])
    kind: Mapped[str] = mapped_column(String(12), default="answer")
    form_id: Mapped[int | None] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), nullable=True, index=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    response_id: Mapped[int | None] = mapped_column(ForeignKey("responses.id", ondelete="SET NULL"), nullable=True, index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(300))  # relative to UPLOAD_DIR
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class CustomTheme(Base):
    """A theme the creator saved to reuse on other forms."""

    __tablename__ = "custom_themes"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    theme: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
