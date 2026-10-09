"""Runtime configuration (overridable through environment variables)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'typeform_clone.db'}")

# Origins allowed to call the API from a browser (the Next.js dev server by default).
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

# Seed a demo creator + sample form the very first time the database is empty.
SEED_DEMO = os.getenv("SEED_DEMO", "1") != "0"

# ── Authentication ───────────────────────────────────────────────────────────
# Secret used to sign login tokens. CHANGE IT in production (any long random string):
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-change-me-in-production-0123456789")
TOKEN_EXPIRE_DAYS = int(os.getenv("TOKEN_EXPIRE_DAYS", "7"))
# PBKDF2 work factor for password hashing (OWASP 2023 recommends >= 600k for SHA-256).
PASSWORD_ITERATIONS = int(os.getenv("PASSWORD_ITERATIONS", "600000"))

# Demo account created together with the demo data (only when SEED_DEMO=1).
DEMO_USER_NAME = "Demo Creator"
DEMO_USER_EMAIL = "creator@example.com"
DEMO_USER_PASSWORD = "demo1234"

# ── File uploads ─────────────────────────────────────────────────────────────
# Where uploaded files are stored on disk (never served directly; always through the API).
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
# Hard ceiling for one answer file; each question can choose a smaller limit in the builder.
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))
DEFAULT_UPLOAD_MB = 10
# Size limit for theme background images.
MAX_BACKGROUND_MB = int(os.getenv("MAX_BACKGROUND_MB", "5"))
