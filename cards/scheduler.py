"""Question selection logic for practice sessions."""
from __future__ import annotations

import random
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import List, Sequence

from . import database
from .config import CONFIG


@dataclass
class ScheduledCard:
    card: database.Card
    review: database.Review
    mode: str


QUESTION_MODES = ("eng2cn", "cn2eng", "ipa")


def pick_session(conn: sqlite3.Connection, size: int, now: datetime) -> List[ScheduledCard]:
    due_reviews = database.fetch_reviews(
        conn,
        where="next_review <= ?",
        params=(now.strftime(database.ISO_FMT),),
    )
    due_cards = _attach_cards(conn, due_reviews)

    learning_reviews = database.fetch_reviews(
        conn,
        where="next_review > ? AND next_review <= ?",
        params=(
            now.strftime(database.ISO_FMT),
            (now + CONFIG.learning_short_interval).strftime(database.ISO_FMT),
        ),
    )
    learning_cards = _attach_cards(conn, learning_reviews)

    new_reviews = database.fetch_reviews(
        conn,
        where="reps = 0",
    )
    new_cards = _attach_cards(conn, new_reviews)

    review_quota = int(size * CONFIG.review_ratio)
    learning_quota = int(size * CONFIG.learning_ratio)
    new_quota = max(0, size - review_quota - learning_quota)

    session: List[ScheduledCard] = []
    session.extend(due_cards[:review_quota])
    session.extend(learning_cards[:learning_quota])

    random.shuffle(new_cards)
    session.extend(new_cards[:new_quota])

    if len(session) < size:
        remaining = size - len(session)
        pool = due_cards[review_quota:] + learning_cards[learning_quota:] + new_cards[new_quota:]
        random.shuffle(pool)
        session.extend(pool[:remaining])

    for item in session:
        item.mode = random.choice(QUESTION_MODES)
    return session


def _attach_cards(conn: sqlite3.Connection, reviews: Sequence[database.Review]) -> List[ScheduledCard]:
    results: List[ScheduledCard] = []
    for review in reviews:
        card_row = conn.execute("SELECT * FROM cards WHERE id=?", (review.card_id,)).fetchone()
        if not card_row:
            continue
        card = database.Card(
            id=card_row["id"],
            term=card_row["term"],
            cn=card_row["cn"],
            ipa=card_row["ipa"],
            tags=card_row["tags"].split(",") if card_row["tags"] else [],
            source_file=card_row["source_file"],
            created_at=datetime.strptime(card_row["created_at"], database.ISO_FMT),
            updated_at=datetime.strptime(card_row["updated_at"], database.ISO_FMT),
            notes=card_row["notes"],
            normalized_term=card_row["normalized_term"],
            meaning_key=card_row["meaning_key"],
        )
        results.append(ScheduledCard(card=card, review=review, mode="eng2cn"))
    return results
