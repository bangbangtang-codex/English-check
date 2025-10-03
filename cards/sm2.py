"""SM-2 scheduling algorithm implementation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class ReviewState:
    reps: int
    lapses: int
    ease: float
    interval: int


@dataclass
class ReviewOutcome:
    reps: int
    lapses: int
    ease: float
    interval: int
    next_review: datetime


EASE_MIN = 1.3


def update(state: ReviewState, grade: str, now: datetime) -> ReviewOutcome:
    grade_map = {
        "again": 0,
        "incorrect": 0,
        "hard": 3,
        "good": 4,
        "easy": 5,
        "correct": 4,
    }
    numeric = grade_map.get(grade.lower())
    if numeric is None:
        raise ValueError(f"Unsupported grade: {grade}")

    ease = state.ease
    reps = state.reps
    lapses = state.lapses
    interval = state.interval

    if numeric < 3:
        lapses += 1
        reps += 1
        ease = max(EASE_MIN, ease - 0.2)
        interval = 1
        next_review = now + timedelta(days=interval)
    else:
        reps += 1
        ease = max(
            EASE_MIN,
            ease + 0.1 - (5 - numeric) * (0.08 + (5 - numeric) * 0.02),
        )
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 6
        else:
            interval = round(interval * ease)
        next_review = now + timedelta(days=interval)

    return ReviewOutcome(
        reps=reps,
        lapses=lapses,
        ease=ease,
        interval=interval,
        next_review=next_review,
    )
