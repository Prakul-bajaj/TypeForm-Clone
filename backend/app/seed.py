"""First-run demo data: one published form with branching + responses, one draft form."""
from __future__ import annotations

import random
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models, schemas, services
from .config import DEMO_USER_EMAIL, DEMO_USER_NAME, DEMO_USER_PASSWORD
from .constants import DEFAULT_THEME
from .security import hash_password
from .submission import process_submission


def _add_question(form, qtype, title, *, description="", required=False, props=None, choices=None):
    q = services.new_question(form, qtype)
    q.title, q.description, q.required = title, description, required
    if props is not None:
        q.properties = services.clean_properties(qtype, props)
    if choices is not None:
        q.choices = [models.Choice(position=i, label=l) for i, l in enumerate(choices)]
    q.position = len(form.questions) - 1
    return q


def seed_if_empty(db: Session) -> None:
    """Create the demo account (+ sample forms) on a brand-new database.

    Login:  creator@example.com / demo1234
    """
    demo = db.scalar(select(models.User).where(models.User.email == DEMO_USER_EMAIL))
    if demo is not None:
        if demo.password_hash is None:  # database from the pre-auth version: let the old forms be reached
            demo.password_hash = hash_password(DEMO_USER_PASSWORD)
            db.commit()
        return
    if db.scalar(select(models.User.id).limit(1)) is not None:
        return  # real people already signed up: don't add a demo account next to them
    user = models.User(name=DEMO_USER_NAME, email=DEMO_USER_EMAIL, password_hash=hash_password(DEMO_USER_PASSWORD))
    db.add(user)
    db.flush()

    # ── 1. Published customer-feedback form (with a branch) ──────────────────
    form = models.Form(
        owner_id=user.id,
        title="Customer Feedback",
        theme=dict(DEFAULT_THEME),
        settings=schemas.Settings(
            welcome=schemas.Welcome(
                enabled=True,
                title="We'd love your feedback",
                description="Takes about a minute. Your answers help us build a better product.",
                button_text="Let's go",
            ),
            ending=schemas.Ending(
                title="Thank you!",
                description="We read every response. Have a great day.",
            ),
        ).model_dump(),
    )
    db.add(form)
    db.flush()
    q_name = _add_question(form, "short_text", "Hi! What's your name?", required=True, props={"placeholder": "Type your answer here..."})
    q_email = _add_question(form, "email", "Great to meet you. What's your email address?", description="We'll only use it to follow up on your feedback.", required=True)
    q_src = _add_question(form, "dropdown", "How did you hear about us?", choices=["Search engine", "A friend", "Social media", "Blog or article", "Other"])
    q_rate = _add_question(form, "rating", "How would you rate your experience so far?", required=True, props={"steps": 5, "shape": "star"})
    q_feat = _add_question(form, "multiple_choice", "Which features do you use most?", description="Choose as many as you like.",
                           props={"allow_multiple": True}, choices=["Form builder", "Logic jumps", "Results & reports", "Integrations"])
    q_rec = _add_question(form, "yes_no", "Would you recommend us to a friend?", required=True)
    q_imp = _add_question(form, "long_text", "Sorry to hear that. What could we do better?", description="Be as honest as you like, we can take it.")
    q_team = _add_question(form, "number", "Roughly how many people are on your team?", props={"min": 1, "max": 100000})
    db.add_all([q_name, q_email, q_src, q_rate, q_feat, q_rec, q_imp, q_team])
    db.flush()
    # yes → skip the "what could we do better?" question
    form.logic_rules = [
        models.LogicRule(form_id=form.id, source_question_id=q_rec.id, position=0, operator="equals",
                         value="yes", destination_type="question", destination_question_id=q_team.id)
    ]
    db.flush()

    rev = models.FormRevision(form_id=form.id, version=1, draft_version=form.draft_version, document=services.build_document(form))
    db.add(rev)
    db.flush()
    form.status, form.published_at, form.published_draft_version = "published", services.now(), form.draft_version
    form.view_count = 31

    rnd = random.Random(7)
    names = ["Ava Johnson", "Liam Chen", "Noah Patel", "Mia Rossi", "Ethan Kim", "Sofia Garcia", "Lucas Meyer",
             "Isla Brown", "Arjun Mehta", "Zoe Williams", "Omar Haddad", "Chloe Dubois", "Kenji Sato", "Priya Nair"]
    comments = ["Needs a dark mode.", "Exports are a bit slow for big forms.", "More question types please!",
                "Pricing page is confusing.", "Loved it overall, but the mobile builder is cramped."]
    for i, name in enumerate(names):
        happy = rnd.random() < 0.65
        answers = {
            q_name.ref: name,
            q_email.ref: name.lower().replace(" ", ".") + "@example.com",
            q_src.ref: rnd.choice(["Search engine", "A friend", "Social media", "Blog or article", "Other"]),
            q_rate.ref: rnd.choice([4, 5, 5, 4, 3]) if happy else rnd.choice([1, 2, 3]),
            q_feat.ref: rnd.sample(["Form builder", "Logic jumps", "Results & reports", "Integrations"], k=rnd.randint(1, 3)),
            q_rec.ref: happy,
            q_imp.ref: rnd.choice(comments),
            q_team.ref: rnd.choice([1, 3, 5, 12, 40, 250]) if rnd.random() < 0.8 else None,
        }
        processed, errors = process_submission(services_questions(form), answers)
        assert not errors, errors
        when = services.now() - timedelta(days=13 - i, hours=rnd.randint(0, 20), minutes=rnd.randint(0, 59))
        duration = rnd.randint(38, 190)
        db.add(models.Response(
            form_id=form.id, revision_id=rev.id, submitted_at=when, started_at=when - timedelta(seconds=duration),
            duration_seconds=float(duration),
            answers=[models.Answer(question_ref=q["ref"], question_type=q["type"], question_title=q["title"], value=v)
                     for q, v in processed],
        ))

    # a few people who started but never finished (drives "completion rate" and drop-off in the results)
    for i, upto in enumerate([1, 1, 2, 4, 6]):
        first = [(q_name, "Casey Morgan"), (q_email, "casey@example.com"), (q_src, "A friend"),
                 (q_rate, 3), (q_feat, ["Form builder"]), (q_rec, False)][:upto]
        db.add(models.Response(
            form_id=form.id, revision_id=rev.id, status="partial",
            submitted_at=services.now() - timedelta(days=i, hours=2), started_at=services.now() - timedelta(days=i, hours=2, minutes=1),
            answers=[models.Answer(question_ref=q.ref, question_type=q.type, question_title=q.title, value=v) for q, v in first],
        ))

    # ── 2. A draft form so the list shows both states ────────────────────────
    draft = models.Form(owner_id=user.id, title="Event Registration", theme=dict(DEFAULT_THEME),
                        settings=schemas.Settings().model_dump())
    db.add(draft)
    db.flush()
    db.add_all([
        _add_question(draft, "short_text", "What's your full name?", required=True),
        _add_question(draft, "email", "Where should we send your ticket?", required=True),
        _add_question(draft, "multiple_choice", "Which sessions will you attend?", props={"allow_multiple": True},
                      choices=["Keynote", "Workshop A", "Workshop B", "Networking dinner"]),
    ])
    db.commit()


def services_questions(form: models.Form) -> list[dict]:
    return services.build_document(form)["questions"]
