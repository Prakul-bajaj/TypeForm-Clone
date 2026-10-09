"""Password hashing and signed login tokens.

* Passwords: PBKDF2-HMAC-SHA256 from the standard library (no compiled dependency, works on any
  Python build). Stored as ``pbkdf2_sha256$<iterations>$<salt>$<hash>`` so the work factor can be
  raised later without breaking old hashes.
* Tokens: short JWTs (HS256) carrying the user id in ``sub`` plus an expiry.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from .config import PASSWORD_ITERATIONS, SECRET_KEY, TOKEN_EXPIRE_DAYS

_ALGO = "pbkdf2_sha256"
_JWT_ALG = "HS256"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(password: str, iterations: int | None = None) -> str:
    iterations = iterations or PASSWORD_ITERATIONS
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{_ALGO}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. Also burns the same CPU time when the user doesn't exist (stored=None)."""
    if not stored:
        hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"x" * 16, PASSWORD_ITERATIONS)
        return False
    try:
        algo, iters, salt, digest = stored.split("$")
        if algo != _ALGO:
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt), int(iters))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def create_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=TOKEN_EXPIRE_DAYS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=_JWT_ALG)


def decode_token(token: str) -> int | None:
    """Return the user id, or None if the token is invalid / expired / tampered with."""
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[_JWT_ALG], options={"require": ["exp", "sub"]})
        return int(data["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None
