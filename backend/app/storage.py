"""Tiny file store: write an upload stream to disk with a size cap, delete files, sniff images."""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import AsyncIterator

from fastapi import HTTPException

from .config import UPLOAD_DIR

_CONTROL = re.compile(r"[\x00-\x1f\x7f/\\]")


def safe_filename(name: str | None) -> str:
    """Keep only a harmless display name (the file itself is stored under a random name)."""
    name = _CONTROL.sub("_", (name or "").strip())[-150:].strip(" .")
    return name or "file"


async def save_stream(stream: AsyncIterator[bytes], subdir: str, max_bytes: int) -> tuple[str, int, bytes]:
    """Write the stream to UPLOAD_DIR/subdir/<random>. Returns (relative path, size, first bytes).

    Raises 413 as soon as the limit is exceeded (and removes the partial file).
    """
    folder = UPLOAD_DIR / subdir
    folder.mkdir(parents=True, exist_ok=True)
    rel = f"{subdir}/{uuid.uuid4().hex}"
    target = UPLOAD_DIR / rel
    size, head = 0, b""
    try:
        with open(target, "wb") as fh:
            async for chunk in stream:
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"That file is too large (limit {max_bytes // (1024 * 1024)} MB)")
                if len(head) < 16:
                    head += chunk[: 16 - len(head)]
                fh.write(chunk)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(400, "The file is empty")
    return rel, size, head


def full_path(rel: str) -> Path:
    p = (UPLOAD_DIR / rel).resolve()
    if UPLOAD_DIR.resolve() not in p.parents:  # never leave the upload folder
        raise HTTPException(404, "File not found")
    return p


def remove_files(rels: list[str]) -> None:
    for rel in rels:
        try:
            full_path(rel).unlink(missing_ok=True)
        except HTTPException:
            pass


def sniff_image(head: bytes) -> str | None:
    """Content type from magic bytes (we never trust the client's header for images)."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None
