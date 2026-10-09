"""Sign up / log in / who am I."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import current_user
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=schemas.AuthOut, status_code=201)
def signup(payload: schemas.SignupIn, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(models.User.id).where(models.User.email == email)):
        raise HTTPException(409, "An account with this email already exists. Try logging in instead.")
    user = models.User(name=payload.name.strip(), email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    return schemas.AuthOut(token=create_token(user.id), user=user)


@router.post("/login", response_model=schemas.AuthOut)
def login(payload: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(models.User).where(models.User.email == payload.email.strip().lower()))
    # One generic message for "no such user" and "wrong password" so emails can't be probed.
    if not verify_password(payload.password, user.password_hash if user else None):
        raise HTTPException(401, "Incorrect email or password")
    return schemas.AuthOut(token=create_token(user.id), user=user)


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(current_user)):
    return user
