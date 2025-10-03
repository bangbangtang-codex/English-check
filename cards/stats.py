"""Reporting helpers."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from . import database


def accuracy_over_range(conn: database.sqlite3.Connection, days: int) -> Dict[str, float]:
    query = """
        SELECT result, COUNT(*) AS cnt
        FROM logs
        WHERE ts >= datetime('now', ?)
        GROUP BY result
    """
    rows = conn.execute(query, (f"-{days} days",)).fetchall()
    total = sum(row["cnt"] for row in rows)
    correct = sum(row["cnt"] for row in rows if row["result"] in {"good", "easy", "correct"})
    return {"total": total, "correct": correct, "accuracy": (correct / total) if total else 0.0}


def daily_due_counts(conn: database.sqlite3.Connection, days: int) -> List[Tuple[str, int]]:
    query = """
        SELECT date(next_review) AS day, COUNT(*) AS cnt
        FROM reviews
        WHERE next_review <= date('now', ?)
        GROUP BY day
        ORDER BY day DESC
        LIMIT ?
    """
    rows = conn.execute(query, (f"+{days} days", days)).fetchall()
    return [(row["day"], row["cnt"]) for row in rows]


def total_learning_time(conn: database.sqlite3.Connection, days: int) -> float:
    query = """
        SELECT SUM(seconds) AS total
        FROM logs
        WHERE ts >= datetime('now', ?)
    """
    row = conn.execute(query, (f"-{days} days",)).fetchone()
    return row["total"] or 0.0
