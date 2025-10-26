"""Application configuration constants.

The defaults can be overridden via environment variables when running the CLI.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class AppConfig:
    """Static configuration for the spaced-repetition system."""

    database_path: str = os.getenv("CARDS_DB", "cards.db")
    default_session_size: int = int(os.getenv("CARDS_SESSION_SIZE", "100"))
    review_ratio: float = float(os.getenv("CARDS_REVIEW_RATIO", "0.6"))
    learning_ratio: float = float(os.getenv("CARDS_LEARNING_RATIO", "0.25"))
    new_ratio: float = float(os.getenv("CARDS_NEW_RATIO", "0.15"))
    rest_interval: int = int(os.getenv("CARDS_REST_INTERVAL", "20"))
    wrong_export_days: int = int(os.getenv("CARDS_WRONG_EXPORT_DAYS", "7"))
    learning_short_interval_minutes: int = int(
        os.getenv("CARDS_LEARNING_SHORT_INTERVAL_MIN", "10")
    )

    @property
    def learning_short_interval(self) -> timedelta:
        return timedelta(minutes=self.learning_short_interval_minutes)


CONFIG = AppConfig()
