"""Tkinter-based graphical interface for the vocabulary SRS."""
from __future__ import annotations

import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk
from typing import List, Optional

from . import database, importer, prompts, scheduler, sm2
from .config import CONFIG
from .utils import timestamp_now


class FlashcardApp(tk.Tk):
    """Main application window for practising vocabulary cards."""

    def __init__(self) -> None:
        super().__init__()
        database.init_db()
        self.title("Quiz GPT Flashcards (Python)")
        self.geometry("960x640")
        self.minsize(820, 520)

        self.session_cards: List[scheduler.ScheduledCard] = []
        self.current_index: int = -1
        self.question_revealed = False
        self.card_start_time: Optional[datetime] = None
        self.current_question: str = ""
        self.current_answer: str = ""

        self._build_ui()
        self.refresh_dashboard()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        self.style = ttk.Style(self)
        if "Azure" not in self.style.theme_names():
            try:
                self.style.theme_use("clam")
            except tk.TclError:
                pass
        self.style.configure("Title.TLabel", font=("Segoe UI", 16, "bold"))
        self.style.configure("Subtitle.TLabel", font=("Segoe UI", 11))
        self.style.configure("Question.TLabel", font=("Segoe UI", 24, "bold"))
        self.style.configure("Answer.TLabel", font=("Segoe UI", 18))
        self.style.configure("Stats.TLabel", font=("Segoe UI", 12))
        self.style.configure("Mode.TLabel", font=("Segoe UI", 11, "bold"))

        container = ttk.Frame(self, padding=20)
        container.pack(fill=tk.BOTH, expand=True)

        # Header section with controls
        header = ttk.Frame(container)
        header.pack(fill=tk.X)

        ttk.Label(header, text="学习面板", style="Title.TLabel").pack(side=tk.LEFT)

        ttk.Button(header, text="导入文件", command=self.on_import).pack(side=tk.RIGHT, padx=(8, 0))
        self.session_size_var = tk.IntVar(value=CONFIG.default_session_size)
        size_frame = ttk.Frame(header)
        size_frame.pack(side=tk.RIGHT)
        ttk.Label(size_frame, text="本次题量", style="Subtitle.TLabel").pack(side=tk.TOP, anchor=tk.E)
        ttk.Spinbox(
            size_frame,
            from_=1,
            to=500,
            width=6,
            textvariable=self.session_size_var,
        ).pack(side=tk.TOP, anchor=tk.E)
        ttk.Button(header, text="开始练习", command=self.start_session).pack(side=tk.RIGHT, padx=8)

        # Dashboard stats
        stats_frame = ttk.Frame(container)
        stats_frame.pack(fill=tk.X, pady=20)

        self.due_var = tk.StringVar()
        self.learning_var = tk.StringVar()
        self.new_var = tk.StringVar()
        self.total_var = tk.StringVar()
        self.accuracy_var = tk.StringVar()

        for idx, (title, var) in enumerate(
            [
                ("到期复习", self.due_var),
                ("短期复习", self.learning_var),
                ("新词数量", self.new_var),
                ("词汇总数", self.total_var),
                ("近7天正确率", self.accuracy_var),
            ]
        ):
            card = ttk.Frame(stats_frame, padding=12, relief=tk.GROOVE)
            card.grid(row=0, column=idx, padx=8, sticky="nsew")
            ttk.Label(card, text=title, style="Subtitle.TLabel").pack(anchor=tk.W)
            ttk.Label(card, textvariable=var, style="Question.TLabel").pack(anchor=tk.W)

        for idx in range(5):
            stats_frame.columnconfigure(idx, weight=1)

        # Practice area
        practice_frame = ttk.Frame(container)
        practice_frame.pack(fill=tk.BOTH, expand=True)

        top_row = ttk.Frame(practice_frame)
        top_row.pack(fill=tk.X)

        self.mode_var = tk.StringVar()
        ttk.Label(top_row, textvariable=self.mode_var, style="Mode.TLabel").pack(side=tk.LEFT)

        self.progress_var = tk.DoubleVar(value=0)
        progress_bar = ttk.Progressbar(top_row, variable=self.progress_var, maximum=1.0)
        progress_bar.pack(side=tk.RIGHT, fill=tk.X, expand=True, padx=(12, 0))

        self.question_label = ttk.Label(
            practice_frame,
            text="点击“开始练习”以生成题目",
            wraplength=800,
            style="Question.TLabel",
            anchor=tk.CENTER,
            justify=tk.CENTER,
        )
        self.question_label.pack(fill=tk.BOTH, expand=True, pady=20)

        self.answer_label = ttk.Label(
            practice_frame,
            text="",
            wraplength=800,
            style="Answer.TLabel",
            anchor=tk.CENTER,
            justify=tk.CENTER,
            foreground="#1a73e8",
        )
        self.answer_label.pack(fill=tk.X, pady=10)

        controls = ttk.Frame(practice_frame)
        controls.pack(pady=10)

        self.show_button = ttk.Button(controls, text="显示答案", command=self.reveal_answer, state=tk.DISABLED)
        self.show_button.pack(side=tk.LEFT, padx=6)

        self.grade_buttons: dict[str, ttk.Button] = {}
        for label, grade in [
            ("重学", "again"),
            ("较难", "hard"),
            ("良好", "good"),
            ("容易", "easy"),
        ]:
            btn = ttk.Button(
                controls,
                text=label,
                command=lambda g=grade: self.submit_grade(g),
                state=tk.DISABLED,
            )
            btn.pack(side=tk.LEFT, padx=6)
            self.grade_buttons[grade] = btn

        self.status_var = tk.StringVar()
        ttk.Label(practice_frame, textvariable=self.status_var, style="Stats.TLabel").pack(anchor=tk.CENTER, pady=(12, 0))

    # ------------------------------------------------------------------
    # Dashboard
    # ------------------------------------------------------------------
    def refresh_dashboard(self) -> None:
        now = timestamp_now()
        with database.connect() as conn:
            due_count = conn.execute(
                "SELECT COUNT(*) FROM reviews WHERE next_review <= ?",
                (now.strftime(database.ISO_FMT),),
            ).fetchone()[0]
            learning_count = conn.execute(
                "SELECT COUNT(*) FROM reviews WHERE next_review > ? AND next_review <= ?",
                (
                    now.strftime(database.ISO_FMT),
                    (now + CONFIG.learning_short_interval).strftime(database.ISO_FMT),
                ),
            ).fetchone()[0]
            new_count = conn.execute("SELECT COUNT(*) FROM reviews WHERE reps = 0").fetchone()[0]
            total_cards = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
            accuracy_row = conn.execute(
                """
                SELECT SUM(CASE WHEN result IN ('good','easy','correct') THEN 1 ELSE 0 END) AS correct,
                       COUNT(*) AS total
                FROM logs
                WHERE ts >= datetime('now', '-7 days')
                """
            ).fetchone()

        correct = accuracy_row["correct"] or 0
        total = accuracy_row["total"] or 0
        accuracy = f"{correct}/{total} ({(correct / total * 100):.0f}%)" if total else "暂无数据"

        self.due_var.set(str(due_count))
        self.learning_var.set(str(learning_count))
        self.new_var.set(str(new_count))
        self.total_var.set(str(total_cards))
        self.accuracy_var.set(accuracy)

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------
    def start_session(self) -> None:
        limit = max(1, self.session_size_var.get())
        now = timestamp_now()
        with database.connect() as conn:
            session = scheduler.pick_session(conn, limit, now)
        if not session:
            messagebox.showinfo("提示", "当前没有需要复习或学习的新词，请先导入词表。")
            return
        self.session_cards = session
        self.current_index = -1
        self.progress_var.set(0)
        self.status_var.set(f"共 {len(session)} 题，祝你学习愉快！")
        self.next_card()

    def next_card(self) -> None:
        self.current_index += 1
        if self.current_index >= len(self.session_cards):
            self.question_label.config(text="本次练习完成！🎉")
            self.answer_label.config(text="")
            self.mode_var.set("")
            self.show_button.config(state=tk.DISABLED)
            for btn in self.grade_buttons.values():
                btn.config(state=tk.DISABLED)
            self.progress_var.set(1.0)
            self.status_var.set("可以再次点击“开始练习”开启新的 session。")
            self.refresh_dashboard()
            return

        scheduled = self.session_cards[self.current_index]
        question, answer = prompts.build_prompt(scheduled.card, scheduled.mode)
        self.current_question = question
        self.current_answer = answer
        self.question_label.config(text=question)
        self.answer_label.config(text="")
        self.mode_var.set(f"模式：{self._mode_label(scheduled.mode)}  |  下一次复习：{scheduled.review.next_review.date()}")
        self.show_button.config(state=tk.NORMAL)
        for btn in self.grade_buttons.values():
            btn.config(state=tk.DISABLED)
        self.progress_var.set((self.current_index) / max(1, len(self.session_cards)))
        self.status_var.set(f"正在进行第 {self.current_index + 1}/{len(self.session_cards)} 题")
        self.question_revealed = False
        self.card_start_time = timestamp_now()

    def reveal_answer(self) -> None:
        if self.current_index < 0 or self.current_index >= len(self.session_cards):
            return
        self.answer_label.config(text=self.current_answer)
        for btn in self.grade_buttons.values():
            btn.config(state=tk.NORMAL)
        self.show_button.config(state=tk.DISABLED)
        self.question_revealed = True

    def submit_grade(self, grade: str) -> None:
        if not self.question_revealed:
            messagebox.showinfo("提示", "请先点击“显示答案”。")
            return
        if self.current_index < 0 or self.current_index >= len(self.session_cards):
            return
        scheduled = self.session_cards[self.current_index]
        now_dt = timestamp_now()
        seconds = 0.0
        if self.card_start_time is not None:
            seconds = max(0.0, (now_dt - self.card_start_time).total_seconds())
        correct = grade in {"good", "easy", "correct"}

        outcome = sm2.update(
            sm2.ReviewState(
                reps=scheduled.review.reps,
                lapses=scheduled.review.lapses,
                ease=scheduled.review.ease,
                interval=scheduled.review.interval,
            ),
            grade,
            now_dt,
        )

        total_attempts = scheduled.review.total_attempts + 1
        total_correct = scheduled.review.total_correct + (1 if correct else 0)
        previous_avg = scheduled.review.avg_seconds or 0.0
        if scheduled.review.total_attempts == 0:
            avg_seconds = seconds
        else:
            avg_seconds = ((previous_avg * scheduled.review.total_attempts) + seconds) / (
                scheduled.review.total_attempts + 1
            )

        with database.connect() as conn:
            database.update_review(
                conn,
                scheduled.card.id,
                reps=outcome.reps,
                lapses=outcome.lapses,
                ease=outcome.ease,
                interval=outcome.interval,
                last_review=now_dt,
                next_review=outcome.next_review,
                total_correct=total_correct,
                total_attempts=total_attempts,
                avg_seconds=avg_seconds,
            )
            database.log_practice(
                conn,
                database.LogEntry(
                    ts=now_dt,
                    card_id=scheduled.card.id,
                    mode=scheduled.mode,
                    result=grade,
                    seconds=seconds,
                    meta={"question": self.current_question, "answer": self.current_answer},
                ),
            )

        scheduled.review.reps = outcome.reps
        scheduled.review.lapses = outcome.lapses
        scheduled.review.ease = outcome.ease
        scheduled.review.interval = outcome.interval
        scheduled.review.next_review = outcome.next_review
        scheduled.review.total_attempts = total_attempts
        scheduled.review.total_correct = total_correct
        scheduled.review.avg_seconds = avg_seconds

        self.status_var.set(f"记录成功：{grade}，用时 {seconds:.1f} 秒")
        self.next_card()

    # ------------------------------------------------------------------
    # Misc helpers
    # ------------------------------------------------------------------
    def on_import(self) -> None:
        file_path = filedialog.askopenfilename(
            title="选择要导入的 Excel/CSV 文件",
            filetypes=[
                ("Excel 文件", "*.xlsx *.xls"),
                ("CSV 文件", "*.csv"),
                ("所有文件", "*.*"),
            ],
        )
        if not file_path:
            return
        try:
            result = importer.import_file(file_path)
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("导入失败", f"无法导入文件：{exc}")
            return
        summary = (
            f"新建 {result.created} 条\n"
            f"更新 {result.updated} 条\n"
            f"跳过 {result.skipped} 条\n"
            f"冲突 {result.conflicts} 条"
        )
        if result.conflict_rows:
            summary += "\n请查看命令行日志以处理冲突。"
        messagebox.showinfo("导入完成", summary)
        self.refresh_dashboard()

    def _mode_label(self, mode: str) -> str:
        mapping = {
            "eng2cn": "英→中",
            "cn2eng": "中→英",
            "ipa": "发音",
        }
        return mapping.get(mode, mode)


def main() -> None:
    app = FlashcardApp()
    app.mainloop()


if __name__ == "__main__":
    main()
