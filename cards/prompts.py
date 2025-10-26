"""Helpers for presenting flashcard prompts."""
from __future__ import annotations

from typing import Tuple

from . import database


def build_prompt(card: database.Card, mode: str) -> Tuple[str, str]:
    """Return a (question, answer) pair for a given card and mode."""
    if mode == "eng2cn":
        return (card.term, card.cn or "(no Chinese translation)")
    if mode == "cn2eng":
        return (card.cn or "(no Chinese translation)", card.term)
    if mode == "ipa":
        return (card.term, card.ipa or "(no IPA provided)")
    raise ValueError(f"Unknown practice mode: {mode}")
