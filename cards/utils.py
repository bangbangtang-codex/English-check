"""Utility helpers."""
from __future__ import annotations

import hashlib
import json
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Sequence

ISO_FMT = "%Y-%m-%dT%H:%M:%S"


WORD_RE = re.compile(r"[^a-z0-9]+")


def normalize_term(term: str) -> str:
    cleaned = term.strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.strip()
    cleaned = cleaned.rstrip(".,;:!?")
    return cleaned


def meaning_key(term: str, cn: str | None) -> str:
    base = normalize_term(term)
    if cn:
        cn_clean = re.sub(r"\s+", " ", cn.strip())
        digest = hashlib.sha1(cn_clean.encode("utf-8")).hexdigest()[:10]
        return f"{base}:{digest}"
    return base


def generate_id(term: str, cn: str | None, ipa: str | None) -> str:
    payload = "|".join(filter(None, [normalize_term(term), cn or "", ipa or ""]))
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def parse_tags(value: str | None) -> List[str]:
    if not value:
        return []
    if isinstance(value, str):
        items = [item.strip() for item in re.split(r"[,;/]", value) if item.strip()]
        return items
    return list(value)


def timestamp_now() -> datetime:
    return datetime.utcnow()


def weighted_sample(items: Sequence[str], k: int) -> List[str]:
    items = list(items)
    if k >= len(items):
        return items
    return random.sample(items, k)


def ensure_directory(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def dumps_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)
