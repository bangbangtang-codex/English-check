"""SQLite persistence layer for the vocabulary SRS."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

from .config import CONFIG

ISO_FMT = "%Y-%m-%dT%H:%M:%S"


@dataclass
class Card:
    id: str
    term: str
    cn: Optional[str]
    ipa: Optional[str]
    tags: List[str]
    source_file: str
    created_at: datetime
    updated_at: datetime
    notes: Optional[str]
    normalized_term: str
    meaning_key: str


@dataclass
class Review:
    card_id: str
    reps: int
    lapses: int
    ease: float
    interval: int
    stability: Optional[float]
    difficulty: Optional[float]
    last_review: Optional[datetime]
    next_review: datetime
    total_correct: int
    total_attempts: int
    avg_seconds: Optional[float]


@dataclass
class LogEntry:
    ts: datetime
    card_id: str
    mode: str
    result: str
    seconds: float
    meta: Dict[str, Any]


@contextmanager
def connect(db_path: Optional[str] = None) -> Iterator[sqlite3.Connection]:
    path = Path(db_path or CONFIG.database_path)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.commit()
        conn.close()


def init_db(db_path: Optional[str] = None) -> None:
    with connect(db_path) as conn:
        cur = conn.cursor()
        cur.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                term TEXT NOT NULL,
                cn TEXT,
                ipa TEXT,
                tags TEXT,
                source_file TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                notes TEXT,
                normalized_term TEXT NOT NULL,
                meaning_key TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_meaning
                ON cards (normalized_term, meaning_key);

            CREATE TABLE IF NOT EXISTS reviews (
                card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
                reps INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                ease REAL NOT NULL DEFAULT 2.5,
                interval INTEGER NOT NULL DEFAULT 0,
                stability REAL,
                difficulty REAL,
                last_review TEXT,
                next_review TEXT NOT NULL,
                total_correct INTEGER NOT NULL DEFAULT 0,
                total_attempts INTEGER NOT NULL DEFAULT 0,
                avg_seconds REAL
            );

            CREATE INDEX IF NOT EXISTS idx_reviews_next_review
                ON reviews (next_review);

            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                mode TEXT NOT NULL,
                result TEXT NOT NULL,
                seconds REAL NOT NULL,
                meta TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_logs_recent
                ON logs (ts DESC);

            CREATE TABLE IF NOT EXISTS import_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                file_name TEXT NOT NULL,
                summary TEXT NOT NULL,
                stats TEXT NOT NULL
            );
            """
        )


def upsert_card(conn: sqlite3.Connection, card: Card) -> None:
    conn.execute(
        """
        INSERT INTO cards (
            id, term, cn, ipa, tags, source_file, created_at, updated_at,
            notes, normalized_term, meaning_key
        ) VALUES (:id, :term, :cn, :ipa, :tags, :source_file, :created_at, :updated_at,
            :notes, :normalized_term, :meaning_key)
        ON CONFLICT(id) DO UPDATE SET
            term=excluded.term,
            cn=excluded.cn,
            ipa=excluded.ipa,
            tags=excluded.tags,
            source_file=excluded.source_file,
            updated_at=excluded.updated_at,
            notes=excluded.notes,
            normalized_term=excluded.normalized_term,
            meaning_key=excluded.meaning_key
        """,
        {
            **card.__dict__,
            "tags": ",".join(card.tags),
            "created_at": card.created_at.strftime(ISO_FMT),
            "updated_at": card.updated_at.strftime(ISO_FMT),
        },
    )


def ensure_review(conn: sqlite3.Connection, card_id: str, next_review: datetime) -> None:
    conn.execute(
        """
        INSERT INTO reviews (card_id, next_review)
        VALUES (:card_id, :next_review)
        ON CONFLICT(card_id) DO UPDATE SET
            next_review=excluded.next_review
        """,
        {"card_id": card_id, "next_review": next_review.strftime(ISO_FMT)},
    )


def log_practice(conn: sqlite3.Connection, entry: LogEntry) -> None:
    conn.execute(
        """
        INSERT INTO logs (ts, card_id, mode, result, seconds, meta)
        VALUES (:ts, :card_id, :mode, :result, :seconds, :meta)
        """,
        {
            "ts": entry.ts.strftime(ISO_FMT),
            "card_id": entry.card_id,
            "mode": entry.mode,
            "result": entry.result,
            "seconds": entry.seconds,
            "meta": json.dumps(entry.meta, ensure_ascii=False),
        },
    )


def record_import(
    conn: sqlite3.Connection,
    file_name: str,
    summary: str,
    stats: Dict[str, Any],
) -> None:
    conn.execute(
        """
        INSERT INTO import_log (ts, file_name, summary, stats)
        VALUES (:ts, :file_name, :summary, :stats)
        """,
        {
            "ts": datetime.utcnow().strftime(ISO_FMT),
            "file_name": file_name,
            "summary": summary,
            "stats": json.dumps(stats, ensure_ascii=False),
        },
    )


def fetch_cards(
    conn: sqlite3.Connection,
    where: str = "",
    params: Sequence[Any] | None = None,
) -> List[Card]:
    query = "SELECT * FROM cards"
    if where:
        query += f" WHERE {where}"
    rows = conn.execute(query, params or ()).fetchall()
    cards: List[Card] = []
    for row in rows:
        cards.append(
            Card(
                id=row["id"],
                term=row["term"],
                cn=row["cn"],
                ipa=row["ipa"],
                tags=row["tags"].split(",") if row["tags"] else [],
                source_file=row["source_file"],
                created_at=datetime.strptime(row["created_at"], ISO_FMT),
                updated_at=datetime.strptime(row["updated_at"], ISO_FMT),
                notes=row["notes"],
                normalized_term=row["normalized_term"],
                meaning_key=row["meaning_key"],
            )
        )
    return cards


def fetch_reviews(
    conn: sqlite3.Connection,
    where: str = "",
    params: Sequence[Any] | None = None,
    limit: Optional[int] = None,
) -> List[Review]:
    query = "SELECT * FROM reviews"
    if where:
        query += f" WHERE {where}"
    query += " ORDER BY next_review"
    if limit is not None:
        query += f" LIMIT {limit}"
    rows = conn.execute(query, params or ()).fetchall()
    results: List[Review] = []
    for row in rows:
        results.append(
            Review(
                card_id=row["card_id"],
                reps=row["reps"],
                lapses=row["lapses"],
                ease=row["ease"],
                interval=row["interval"],
                stability=row["stability"],
                difficulty=row["difficulty"],
                last_review=datetime.strptime(row["last_review"], ISO_FMT)
                if row["last_review"]
                else None,
                next_review=datetime.strptime(row["next_review"], ISO_FMT),
                total_correct=row["total_correct"],
                total_attempts=row["total_attempts"],
                avg_seconds=row["avg_seconds"],
            )
        )
    return results


def update_review(
    conn: sqlite3.Connection,
    card_id: str,
    *,
    reps: int,
    lapses: int,
    ease: float,
    interval: int,
    last_review: datetime,
    next_review: datetime,
    total_correct: int,
    total_attempts: int,
    avg_seconds: Optional[float],
) -> None:
    conn.execute(
        """
        UPDATE reviews
        SET reps=:reps,
            lapses=:lapses,
            ease=:ease,
            interval=:interval,
            last_review=:last_review,
            next_review=:next_review,
            total_correct=:total_correct,
            total_attempts=:total_attempts,
            avg_seconds=:avg_seconds
        WHERE card_id=:card_id
        """,
        {
            "card_id": card_id,
            "reps": reps,
            "lapses": lapses,
            "ease": ease,
            "interval": interval,
            "last_review": last_review.strftime(ISO_FMT),
            "next_review": next_review.strftime(ISO_FMT),
            "total_correct": total_correct,
            "total_attempts": total_attempts,
            "avg_seconds": avg_seconds,
        },
    )


def fetch_recent_wrong(conn: sqlite3.Connection, days: int) -> List[Tuple[Card, LogEntry]]:
    query = """
        SELECT c.*, l.ts, l.mode, l.result, l.seconds, l.meta
        FROM logs l
        JOIN cards c ON c.id = l.card_id
        WHERE l.result IN ('again', 'incorrect', 'hard')
          AND l.ts >= datetime('now', ?)
        ORDER BY l.ts DESC
    """
    rows = conn.execute(query, (f"-{days} days",)).fetchall()
    results: List[Tuple[Card, LogEntry]] = []
    for row in rows:
        card = Card(
            id=row["id"],
            term=row["term"],
            cn=row["cn"],
            ipa=row["ipa"],
            tags=row["tags"].split(",") if row["tags"] else [],
            source_file=row["source_file"],
            created_at=datetime.strptime(row["created_at"], ISO_FMT),
            updated_at=datetime.strptime(row["updated_at"], ISO_FMT),
            notes=row["notes"],
            normalized_term=row["normalized_term"],
            meaning_key=row["meaning_key"],
        )
        entry = LogEntry(
            ts=datetime.strptime(row["ts"], ISO_FMT),
            card_id=row["id"],
            mode=row["mode"],
            result=row["result"],
            seconds=row["seconds"],
            meta=json.loads(row["meta"]) if row["meta"] else {},
        )
        results.append((card, entry))
    return results
