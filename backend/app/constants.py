"""Single source of truth for question types and defaults (mirrored in frontend/lib/types.ts)."""

QUESTION_TYPES = (
    "short_text",
    "long_text",
    "multiple_choice",
    "dropdown",
    "email",
    "number",
    "yes_no",
    "rating",
    "file_upload",
)
CHOICE_TYPES = ("multiple_choice", "dropdown")
OPERATORS = ("equals", "not_equals", "contains", "greater_than", "less_than", "is_answered", "always")

DEFAULT_THEME = {
    "name": "Classic",
    "font": "Karla",
    "background": "#FFFFFF",
    "question_color": "#262627",
    "answer_color": "#0445AF",
    "button_color": "#0445AF",
    "button_text_color": "#FFFFFF",
    "background_image": "",
    "background_overlay": 0,
}

DEFAULT_SETTINGS = {
    "show_progress_bar": True,
    "show_question_numbers": True,
    "welcome": {
        "enabled": False,
        "title": "Welcome!",
        "description": "This will only take a minute.",
        "button_text": "Start",
    },
    "ending": {
        "title": "Thanks for completing this form!",
        "description": "Your response has been recorded.",
        "button_text": "",
        "button_link": "",
    },
}

DEFAULT_QUESTION_TITLE = "Your question here"
