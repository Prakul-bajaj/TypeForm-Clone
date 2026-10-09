"""Custom themes a creator saves once and re-applies to any of their forms."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import current_user

router = APIRouter(prefix="/api/themes", tags=["themes"])
MAX_THEMES_PER_USER = 30


@router.get("", response_model=list[schemas.CustomThemeOut])
def list_themes(db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return db.scalars(
        select(models.CustomTheme).where(models.CustomTheme.owner_id == user.id).order_by(models.CustomTheme.id.desc())
    ).all()


@router.post("", response_model=schemas.CustomThemeOut, status_code=201)
def save_theme(payload: schemas.CustomThemeIn, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    count = db.scalar(select(func.count(models.CustomTheme.id)).where(models.CustomTheme.owner_id == user.id)) or 0
    if count >= MAX_THEMES_PER_USER:
        raise HTTPException(422, f"You can save up to {MAX_THEMES_PER_USER} themes. Delete one first.")
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Please name your theme")
    theme = payload.theme.model_copy(update={"name": name})
    row = models.CustomTheme(owner_id=user.id, name=name, theme=theme.model_dump())
    db.add(row)
    db.commit()
    return row


@router.delete("/{theme_id}", status_code=204)
def delete_theme(theme_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    row = db.get(models.CustomTheme, theme_id)
    if not row or row.owner_id != user.id:
        raise HTTPException(404, "Theme not found")
    db.delete(row)
    db.commit()
