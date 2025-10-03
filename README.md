# Vocabulary SRS Toolkit (Python)

This project provides a fully local spaced-repetition workflow for English vocabulary study. It ingests your daily Excel/CSV sheets, normalises and de-duplicates the entries, schedules reviews with the SM-2 algorithm, records practice logs, and surfaces analytics plus exportable error reports — all without any cloud services.

## Features

- **Import pipeline**: Drag-and-drop friendly Excel (`.xlsx`) or CSV files with `term/cn/ipa` columns. The importer normalises terms, merges duplicates, and logs the outcome.
- **Persistent storage**: Data is stored in a local SQLite database (`cards.db`) with tables for `cards`, `reviews`, `logs`, and `import_log`.
- **Scheduling**: Implements the classic SM-2 algorithm, supporting again/hard/good/easy grades and automatic next-review calculations.
- **Session orchestration**: CLI `practice` mode prioritises due reviews, short-interval learning cards, and new vocabulary per configurable ratios.
- **Analytics & exports**: Show accuracy trends, due counts, total study time, and export a 7-day “错题本” to CSV.

## Requirements

- Python **3.13** or newer.
- `pip` for dependency installation.

Install dependencies (ideally inside a virtual environment):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

Initialise the database:

```bash
python -m cards.cli init-db
```

Import a vocabulary sheet:

```bash
python -m cards.cli import path/to/2025-09-24.xlsx
```

Start a study session (defaults to 100 cards per session):

```bash
python -m cards.cli practice --limit 40
```

During a session, press Enter to reveal the answer, then grade yourself with `again/hard/good/easy`. The system logs each attempt, updates review spacing, and records time spent.

Show recent statistics:

```bash
python -m cards.cli stats --days 14
```

Export the last 7 days of wrong answers to CSV:

```bash
python -m cards.cli export-wrongs --days 7 --output exports/wrong_answers.csv
```

List the most recent import runs:

```bash
python -m cards.cli list-imports
```

## Data schema

The SQLite database follows the schema described in the product specification:

- `cards`: Stores each unique vocabulary item with timestamps, tags, notes, and provenance.
- `reviews`: Tracks SM-2 state (`reps/lapses/ease/interval/next_review`, etc.).
- `logs`: Records per-question practice metadata (mode, grade, duration).
- `import_log`: Audits each import with summary statistics.

## Configuration

Environment variables let you tweak defaults:

| Variable | Description | Default |
| --- | --- | --- |
| `CARDS_DB` | Path to SQLite database | `cards.db` |
| `CARDS_SESSION_SIZE` | Default practice session length | `100` |
| `CARDS_REVIEW_RATIO` | Portion of session reserved for due reviews | `0.6` |
| `CARDS_LEARNING_RATIO` | Portion of session for short-interval learning cards | `0.25` |
| `CARDS_NEW_RATIO` | Portion for brand-new cards | `0.15` |
| `CARDS_REST_INTERVAL` | Questions per block before recommending a break | `20` |
| `CARDS_WRONG_EXPORT_DAYS` | Default lookback for 错题本 export | `7` |

## Project structure

```
cards/
  cli.py          # command line interface
  config.py       # configuration and ratios
  database.py     # SQLite schema and helpers
  importer.py     # Excel/CSV ingestion
  scheduler.py    # session card selection
  sm2.py          # SM-2 algorithm implementation
  stats.py        # reporting utilities
  utils.py        # shared helpers
requirements.txt
README.md
```

## Tests

This environment does not ship with a preconfigured test runner. You can still manually validate the workflow:

1. `python -m cards.cli init-db`
2. `python -m cards.cli import sample.csv`
3. `python -m cards.cli practice --limit 5`
4. `python -m cards.cli stats`
5. `python -m cards.cli export-wrongs`

These commands verify database migrations, import deduplication, scheduling, review updates, and reporting.
