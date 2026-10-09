"""Shared FastAPI dependencies."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .security import decode_token

# auto_error=False so we can return our own 401 message; also adds the "Authorize" button to /docs.
_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    """The logged-in creator, or 401. Used by every creator-facing endpoint (public ones don't need it)."""
    user_id = decode_token(creds.credentials) if creds else None
    user = db.get(models.User, user_id) if user_id else None
    if not user:
        raise HTTPException(401, "Please log in to continue", headers={"WWW-Authenticate": "Bearer"})
    return user
