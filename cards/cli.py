"""Command line interface for the vocabulary SRS."""
from __future__ import annotations

import argparse
import csv
import json
import sys
import textwrap
from datetime import datetime
from pathlib import Path
from typing import List

from . import database, importer, scheduler, sm2, stats
from .config import CONFIG
from .utils import dumps_json, ensure_directory, timestamp_now


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Vocabulary spaced-repetition toolkit",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("init-db", help="Initialise the SQLite database")

    import_parser = sub.add_parser("import", help="Import Excel/CSV file")
    import_parser.add_argument("path", help="Path to file")

    practice_parser = sub.add_parser("practice", help="Run an interactive study session")
    practice_parser.add_argument("--limit", type=int, default=CONFIG.default_session_size)

    stats_parser = sub.add_parser("stats", help="Show recent performance stats")
    stats_parser.add_argument("--days", type=int, default=7)

    export_parser = sub.add_parser("export-wrongs", help="Export recent wrong answers to CSV")
    export_parser.add_argument("--days", type=int, default=CONFIG.wrong_export_days)
    export_parser.add_argument("--output", type=str, default="exports/wrong_answers.csv")

    sub.add_parser("list-imports", help="Show import history")

    return parser


def command_init_db(args: argparse.Namespace) -> None:
    database.init_db()
    print(f"Database initialised at {CONFIG.database_path}")


def command_import(args: argparse.Namespace) -> None:
    database.init_db()
    result = importer.import_file(args.path)
    print(
        f"Imported {args.path}: created={result.created} updated={result.updated} "
        f"skipped={result.skipped} conflicts={result.conflicts}"
    )
    if result.conflict_rows:
        print("Conflicts detected:")
        for row in result.conflict_rows:
            print(dumps_json(row.__dict__))


def command_practice(args: argparse.Namespace) -> None:
    database.init_db()
    now = timestamp_now()
    with database.connect() as conn:
        session = scheduler.pick_session(conn, args.limit, now)
        if not session:
            print("No cards due or new. Import some vocabulary first.")
            return
        print(f"Starting session with {len(session)} cards. Enter 'q' to quit early.")
        for index, scheduled in enumerate(session, start=1):
            card = scheduled.card
            review = scheduled.review
            mode = scheduled.mode
            print("-" * 60)
            print(f"[{index}/{len(session)}] Mode: {mode} | Next due: {review.next_review.date()}")
            question, answer = _build_prompt(card, mode)
            print(f"Q: {question}")
            input("Press Enter to reveal answer...")
            print(f"A: {answer}")
            grade = _prompt_grade()
            if grade == "q":
                print("Session aborted by user.")
                break
            seconds = float(input("Seconds spent (approx): ") or 0)
            correct = grade in {"good", "easy", "correct"}
            outcome = sm2.update(
                sm2.ReviewState(
                    reps=review.reps,
                    lapses=review.lapses,
                    ease=review.ease,
                    interval=review.interval,
                ),
                grade,
                timestamp_now(),
            )
            total_attempts = review.total_attempts + 1
            total_correct = review.total_correct + (1 if correct else 0)
            avg_seconds = _calculate_avg(review.avg_seconds, review.total_attempts, seconds)
            database.update_review(
                conn,
                card.id,
                reps=outcome.reps,
                lapses=outcome.lapses,
                ease=outcome.ease,
                interval=outcome.interval,
                last_review=timestamp_now(),
                next_review=outcome.next_review,
                total_correct=total_correct,
                total_attempts=total_attempts,
                avg_seconds=avg_seconds,
            )
            database.log_practice(
                conn,
                database.LogEntry(
                    ts=timestamp_now(),
                    card_id=card.id,
                    mode=mode,
                    result=grade,
                    seconds=seconds,
                    meta={"question": question, "answer": answer},
                ),
            )
    print("Session complete.")


def _calculate_avg(previous: float | None, count: int, new_value: float) -> float:
    if previous is None or count == 0:
        return new_value
    return ((previous * count) + new_value) / (count + 1)


def _build_prompt(card: database.Card, mode: str) -> tuple[str, str]:
    if mode == "eng2cn":
        return (card.term, card.cn or "(no Chinese translation)")
    if mode == "cn2eng":
        return (card.cn or "(no Chinese translation)", card.term)
    if mode == "ipa":
        return (card.term, card.ipa or "(no IPA provided)")
    return (card.term, card.cn or card.ipa or "(no data)")


def _prompt_grade() -> str:
    while True:
        grade = input("Grade (again/hard/good/easy) or 'q' to quit: ").strip().lower()
        if grade in {"again", "hard", "good", "easy", "q"}:
            return grade
        print("Invalid input. Please enter again/hard/good/easy or q.")


def command_stats(args: argparse.Namespace) -> None:
    database.init_db()
    with database.connect() as conn:
        accuracy = stats.accuracy_over_range(conn, args.days)
        due = stats.daily_due_counts(conn, args.days)
        total_seconds = stats.total_learning_time(conn, args.days)
    print("Accuracy (last {days} days): {correct}/{total} -> {accuracy:.1%}".format(**accuracy, days=args.days))
    print("Total study time: {:.1f} minutes".format(total_seconds / 60))
    print("Due cards by day:")
    for day, count in due:
        print(f"  {day}: {count}")


def command_export_wrongs(args: argparse.Namespace) -> None:
    database.init_db()
    ensure_directory(args.output)
    with database.connect() as conn:
        rows = database.fetch_recent_wrong(conn, args.days)
    if not rows:
        print("No wrong answers found for export.")
        return
    with Path(args.output).open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["ts", "term", "cn", "ipa", "mode", "result", "seconds", "notes"])
        for card, log in rows:
            writer.writerow([
                log.ts.strftime(database.ISO_FMT),
                card.term,
                card.cn or "",
                card.ipa or "",
                log.mode,
                log.result,
                f"{log.seconds:.1f}",
                card.notes or "",
            ])
    print(f"Exported {len(rows)} rows to {args.output}")


def command_list_imports(args: argparse.Namespace) -> None:
    database.init_db()
    with database.connect() as conn:
        rows = conn.execute(
            "SELECT ts, file_name, summary, stats FROM import_log ORDER BY ts DESC LIMIT 20"
        ).fetchall()
    if not rows:
        print("No imports recorded yet.")
        return
    for row in rows:
        print(f"{row['ts']} - {row['file_name']} - {row['summary']} - {row['stats']}")


def main(argv: List[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 1
    handlers = {
        "init-db": command_init_db,
        "import": command_import,
        "practice": command_practice,
        "stats": command_stats,
        "export-wrongs": command_export_wrongs,
        "list-imports": command_list_imports,
    }
    handler = handlers[args.command]
    handler(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
