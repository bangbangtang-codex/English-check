import * as React from "react";
import * as XLSX from "xlsx";
import Dexie, { Table } from "dexie";

export type Mode = "eng2cn" | "cn2eng" | "listening" | "usage" | "ipa";
export type Option = { key: string; label: string; correct: boolean };
export type UsageItem = { q: string; options: string[]; answer: number; explain?: string };
type Grade = "again" | "hard" | "good" | "easy";

// ===== 数据模型 =====
type CardRecord = {
  id: string;
  term: string;
  norm_term: string;
  cn?: string;
  cn_digest: string;
  ipa?: string;
  tags: string[];
  source_file: string;
  created_at: string;
  updated_at: string;
  notes?: string;
};

type ReviewRecord = {
  card_id: string;
  reps: number;
  lapses: number;
  ease: number;
  interval: number;
  stability?: number;
  difficulty?: number;
  last_review?: string;
  next_review: string;
  total_correct: number;
  total_attempts: number;
  avg_seconds: number;
};

type LogRecord = {
  id?: number;
  ts: string;
  card_id: string;
  mode: Mode;
  result: Grade;
  seconds: number;
  correct: boolean;
  meta?: any;
};

type ImportRecord = {
  id?: number;
  file_name: string;
  imported_at: string;
  new_count: number;
  updated_count: number;
  skipped_count: number;
  conflict_count: number;
  sha256?: string;
  notes?: string;
};

type ParsedRow = {
  term: string;
  cn?: string;
  ipa?: string;
  tags: string[];
  notes?: string;
  normTerm: string;
  cnDigest: string;
};

type ImportReport = {
  fileName: string;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  conflictCount: number;
  preview: ParsedRow[];
  warnings: string[];
};

type SessionMode = "mixed" | Mode;

type SessionItem = {
  card: CardRecord;
  review: ReviewRecord;
  mode: Mode;
};

type QuestionPayload = {
  item: SessionItem;
  prompt: string;
  mode: Mode;
  options: Option[];
  expects?: string;
  allowInput: boolean;
};

type PlanMetrics = {
  due: number;
  learning: number;
  newCount: number;
  totalCards: number;
};

type TrendPoint = {
  label: string;
  attempts: number;
  correct: number;
  seconds: number;
  dueCount: number;
};

type StatsSummary = {
  range: string;
  attempts: number;
  correct: number;
  accuracy: number;
  seconds: number;
};

// ===== Dexie 实例 =====
class FlashcardDB extends Dexie {
  cards!: Table<CardRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  logs!: Table<LogRecord, number>;
  importLog!: Table<ImportRecord, number>;

  constructor() {
    super("flashcard_srs_db");
    this.version(1).stores({
      cards: "id, norm_term, [norm_term+cn_digest], source_file, updated_at, tags",
      reviews: "card_id, next_review, reps, interval",
      logs: "++id, ts, card_id, mode, result, correct",
      importLog: "++id, imported_at, file_name",
    });
  }
}

const db = new FlashcardDB();

// ===== 工具函数 =====
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistractors<T>(all: T[], n: number, exclude: (x: T) => boolean): T[] {
  const pool = all.filter((x) => !exclude(x));
  return shuffle(pool).slice(0, Math.max(0, Math.min(n, pool.length)));
}

function speak(text: string) {
  if (!text) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch (err) {
    console.warn("speech synthesis not available", err);
  }
}

function canonicalTerm(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9 '\-/]/g, "")
    .trim();
}

function canonicalCn(cn?: string): string {
  if (!cn) return "";
  return cn.trim().replace(/[\s\u3000]+/g, " ").slice(0, 120);
}

function digestCn(cn?: string): string {
  const base = canonicalCn(cn);
  return base.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, "").slice(0, 40);
}

function parseTags(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[\s,;/]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function mergeTags(...parts: string[][]): string[] {
  const set = new Set<string>();
  parts.forEach((arr) => arr.forEach((tag) => set.add(tag)));
  return Array.from(set);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getNowIso(): string {
  return new Date().toISOString();
}

async function computeSHA256(buffer: ArrayBuffer): Promise<string | undefined> {
  try {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = Array.from(new Uint8Array(hashBuffer));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.warn("sha256 unavailable", err);
    return undefined;
  }
}

function formatDateShort(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DAILY_PLAN = {
  total: 100,
  dueRatio: 0.6,
  learningRatio: 0.25,
  newRatio: 0.15,
};

const gradeValue: Record<Grade, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

function sm2Update(review: ReviewRecord, grade: Grade): { ease: number; interval: number; reps: number; lapses: number; next_review: string; last_review: string } {
  const now = new Date();
  let ease = review.ease || 2.5;
  let interval = review.interval || 0;
  let reps = review.reps || 0;
  let lapses = review.lapses || 0;

  const value = gradeValue[grade];
  if (grade === "again") {
    lapses += 1;
    reps += 1;
    ease = Math.max(1.3, ease - 0.2);
    interval = 1;
  } else {
    ease = Math.max(1.3, ease + 0.1 - (5 - value) * (0.08 + (5 - value) * 0.02));
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.max(1, Math.round(interval * ease));
    reps += 1;
  }

  const next = addDays(now, interval);
  return {
    ease,
    interval,
    reps,
    lapses,
    last_review: now.toISOString(),
    next_review: next.toISOString(),
  };
}

function uniqueParsedRows(rows: ParsedRow[]): ParsedRow[] {
  const map = new Map<string, ParsedRow>();
  rows.forEach((row) => {
    const key = `${row.normTerm}|${row.cnDigest}`;
    if (!map.has(key)) map.set(key, row);
    else {
      const prev = map.get(key)!;
      const mergedTags = mergeTags(prev.tags, row.tags);
      map.set(key, {
        ...prev,
        cn: row.cn && !prev.cn ? row.cn : prev.cn,
        ipa: row.ipa && !prev.ipa ? row.ipa : prev.ipa,
        tags: mergedTags,
        notes: row.notes || prev.notes,
      });
    }
  });
  return Array.from(map.values());
}

async function parseRowsFromSheet(sheet: XLSX.WorkSheet): Promise<ParsedRow[]> {
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const parsed: ParsedRow[] = [];
  for (const row of raw) {
    if (!row) continue;
    const term = (row[0] ?? "").toString().trim();
    const cn = (row[1] ?? "").toString().trim();
    const ipa = (row[2] ?? "").toString().trim();
    const tagsRaw = (row[3] ?? "").toString().trim();
    const notes = (row[4] ?? "").toString().trim();
    if (!term) continue;
    const isHeader = /\b(word|english|term)\b/i.test(term) || /中文|释义|meaning|IPA|音标/i.test(cn + " " + ipa + " " + tagsRaw);
    if (isHeader) continue;
    const normTerm = canonicalTerm(term);
    if (!normTerm) continue;
    parsed.push({
      term: term.trim(),
      cn: cn || undefined,
      ipa: ipa || undefined,
      tags: parseTags(tagsRaw),
      notes: notes || undefined,
      normTerm,
      cnDigest: digestCn(cn),
    });
  }
  return uniqueParsedRows(parsed);
}

async function importParsedRows(rows: ParsedRow[], fileName: string, fileHash?: string): Promise<ImportReport> {
  if (rows.length === 0) {
    return { fileName, newCount: 0, updatedCount: 0, skippedCount: 0, conflictCount: 0, preview: [], warnings: ["未识别到有效数据"] };
  }

  const normTerms = Array.from(new Set(rows.map((r) => r.normTerm)));
  const existingCards = await db.cards.where("norm_term").anyOf(normTerms).toArray();
  const grouped = new Map<string, CardRecord[]>();
  existingCards.forEach((card) => {
    const arr = grouped.get(card.norm_term) || [];
    arr.push(card);
    grouped.set(card.norm_term, arr);
  });

  const nowIso = getNowIso();
  let newCount = 0;
  let updatedCount = 0;
  let conflictCount = 0;

  await db.transaction("rw", db.cards, db.reviews, async () => {
    for (const row of rows) {
      const sameTermCards = grouped.get(row.normTerm) || [];
      const exact = sameTermCards.find((c) => c.cn_digest === row.cnDigest);
      if (exact) {
        const mergedTags = mergeTags(exact.tags || [], row.tags);
        const updated: Partial<CardRecord> = {
          cn: row.cn || exact.cn,
          ipa: row.ipa || exact.ipa,
          tags: mergedTags,
          notes: row.notes || exact.notes,
          updated_at: nowIso,
        };
        await db.cards.update(exact.id, updated);
        updatedCount += 1;
      } else {
        const polysemy = sameTermCards.length > 0;
        if (polysemy) conflictCount += 1;
        const id = crypto.randomUUID();
        const newCard: CardRecord = {
          id,
          term: row.term,
          norm_term: row.normTerm,
          cn: row.cn,
          cn_digest: row.cnDigest,
          ipa: row.ipa,
          tags: polysemy ? mergeTags(row.tags, ["polysemy"]) : row.tags,
          source_file: fileName,
          created_at: nowIso,
          updated_at: nowIso,
          notes: row.notes,
        };
        await db.cards.add(newCard);
        const review: ReviewRecord = {
          card_id: id,
          reps: 0,
          lapses: 0,
          ease: 2.5,
          interval: 0,
          stability: undefined,
          difficulty: undefined,
          last_review: undefined,
          next_review: nowIso,
          total_correct: 0,
          total_attempts: 0,
          avg_seconds: 0,
        };
        await db.reviews.add(review);
        sameTermCards.push(newCard);
        grouped.set(row.normTerm, sameTermCards);
        newCount += 1;
      }
    }
  });

  await db.importLog.add({
    file_name: fileName,
    imported_at: nowIso,
    new_count: newCount,
    updated_count: updatedCount,
    skipped_count: 0,
    conflict_count: conflictCount,
    sha256: fileHash,
  });

  return {
    fileName,
    newCount,
    updatedCount,
    skippedCount: 0,
    conflictCount,
    preview: rows.slice(0, 20),
    warnings: [],
  };
}

async function computePlanMetrics(): Promise<PlanMetrics> {
  const nowIso = getNowIso();
  const [due, learning, newCount, totalCards] = await Promise.all([
    db.reviews.where("next_review").belowOrEqual(nowIso).count(),
    db.reviews.filter((r) => r.reps > 0 && r.interval <= 2).count(),
    db.reviews.where("reps").equals(0).count(),
    db.cards.count(),
  ]);
  return { due, learning, newCount, totalCards };
}

async function loadRecentMistakes(): Promise<{ term: string; cn?: string; ts: string; grade: Grade; mode: Mode }[]> {
  const since = addDays(new Date(), -7).toISOString();
  const logs = await db.logs.where("ts").above(since).and((l) => !l.correct).reverse().limit(100).toArray();
  if (logs.length === 0) return [];
  const ids = Array.from(new Set(logs.map((l) => l.card_id)));
  const cards = await db.cards.bulkGet(ids);
  const cardMap = new Map<string, CardRecord>();
  cards.forEach((c) => {
    if (c) cardMap.set(c.id, c);
  });
  return logs.map((log) => {
    const card = cardMap.get(log.card_id);
    return {
      term: card?.term || "",
      cn: card?.cn,
      ts: log.ts,
      grade: log.result,
      mode: log.mode,
    };
  });
}

async function loadStats(): Promise<{ summaries: StatsSummary[]; trend: TrendPoint[] }> {
  const now = new Date();
  const ninetyDaysAgo = addDays(now, -90).toISOString();
  const logs = await db.logs.where("ts").above(ninetyDaysAgo).toArray();
  const durations = [7, 30, 90];
  const summaries: StatsSummary[] = durations.map((d) => {
    const startIso = addDays(now, -d).toISOString();
    const slice = logs.filter((l) => l.ts >= startIso);
    const attempts = slice.length;
    const correct = slice.filter((l) => l.correct).length;
    const seconds = slice.reduce((sum, l) => sum + (l.seconds || 0), 0);
    const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
    return { range: `${d} 天`, attempts, correct, accuracy, seconds };
  });

  const trend: TrendPoint[] = [];
  const allReviews = await db.reviews.toArray();
  for (let i = 6; i >= 0; i--) {
    const dayStart = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -i);
    const dayEnd = addDays(dayStart, 1);
    const dayLogs = logs.filter((l) => l.ts >= dayStart.toISOString() && l.ts < dayEnd.toISOString());
    const attempts = dayLogs.length;
    const correct = dayLogs.filter((l) => l.correct).length;
    const seconds = dayLogs.reduce((sum, l) => sum + (l.seconds || 0), 0);
    const dueCount = allReviews.filter((r) => r.next_review <= dayEnd.toISOString()).length;
    trend.push({
      label: `${dayStart.getMonth() + 1}/${dayStart.getDate()}`,
      attempts,
      correct,
      seconds,
      dueCount,
    });
  }
  return { summaries, trend };
}

function chooseModeForCard(card: CardRecord, preferred: SessionMode): Mode {
  const available: Mode[] = [];
  if (card.cn) {
    available.push("eng2cn");
    available.push("cn2eng");
  } else {
    available.push("eng2cn");
  }
  if (card.ipa) available.push("ipa");
  if (card.term) available.push("listening");
  if (preferred !== "mixed") {
    if (available.includes(preferred)) return preferred;
  }
  return shuffle(available)[0] || "eng2cn";
}

function buildQuestion(item: SessionItem, allCards: CardRecord[]): QuestionPayload {
  const card = item.card;
  const mode = item.mode;
  if (mode === "cn2eng" && card.cn) {
    return {
      item,
      prompt: card.cn,
      mode,
      options: [],
      expects: card.term,
      allowInput: true,
    };
  }
  if ((mode === "eng2cn" || mode === "listening") && card.cn) {
    const distractors = pickDistractors(allCards, 3, (c) => c.id === card.id || !c.cn);
    const opts: Option[] = shuffle([
      { key: "A", label: card.cn, correct: true },
      ...distractors.map((d, i) => ({ key: String.fromCharCode(66 + i), label: d.cn || "", correct: false })),
    ]);
    return {
      item,
      prompt: card.term,
      mode,
      options: opts,
      allowInput: false,
    };
  }
  if (mode === "ipa" && card.ipa) {
    const distract = pickDistractors(allCards.filter((c) => !!c.ipa), 3, (c) => c.id === card.id);
    const opts: Option[] = shuffle([
      { key: "A", label: card.ipa, correct: true },
      ...distract.map((d, i) => ({ key: String.fromCharCode(66 + i), label: d.ipa || "", correct: false })),
    ]);
    return {
      item,
      prompt: card.term,
      mode,
      options: opts,
      allowInput: false,
    };
  }
  // fallback
  const fallback: SessionItem = { ...item, mode: "eng2cn" };
  return buildQuestion(fallback, allCards);
}

async function buildSessionQueue(sessionSize: number, preferred: SessionMode, allCards: CardRecord[]): Promise<SessionItem[]> {
  const nowIso = getNowIso();
  const dueQuota = Math.round(sessionSize * DAILY_PLAN.dueRatio);
  const learningQuota = Math.round(sessionSize * DAILY_PLAN.learningRatio);
  const newQuota = Math.max(0, sessionSize - dueQuota - learningQuota);

  const dueReviews = await db.reviews.where("next_review").belowOrEqual(nowIso).toArray();
  dueReviews.sort((a, b) => (a.next_review > b.next_review ? 1 : -1));
  const learningReviews = await db.reviews
    .filter((r) => r.reps > 0 && r.interval <= 2 && r.next_review > nowIso)
    .toArray();
  const newReviews = await db.reviews.where("reps").equals(0).toArray();

  const selectedReviews: ReviewRecord[] = [];
  selectedReviews.push(...dueReviews.slice(0, dueQuota));
  selectedReviews.push(...shuffle(learningReviews).slice(0, learningQuota));
  const newSlice = shuffle(newReviews).slice(0, newQuota);
  selectedReviews.push(...newSlice);

  if (selectedReviews.length < sessionSize) {
    const extra = dueReviews.slice(dueQuota).concat(learningReviews.slice(learningQuota)).concat(newReviews.slice(newQuota));
    selectedReviews.push(...extra.slice(0, sessionSize - selectedReviews.length));
  }

  const cardIds = Array.from(new Set(selectedReviews.map((r) => r.card_id)));
  const cards = await db.cards.bulkGet(cardIds);
  const cardMap = new Map<string, CardRecord>();
  cards.forEach((c) => {
    if (c) cardMap.set(c.id, c);
  });

  const sessionItems: SessionItem[] = [];
  selectedReviews.forEach((review) => {
    const card = cardMap.get(review.card_id);
    if (!card) return;
    const mode = chooseModeForCard(card, preferred);
    sessionItems.push({ card, review, mode });
  });
  return sessionItems;
}

async function exportMistakesCSV(): Promise<void> {
  const mistakes = await loadRecentMistakes();
  if (mistakes.length === 0) {
    alert("最近 7 天没有错题记录。");
    return;
  }
  const rows = [["term", "cn", "ts", "grade", "mode"]];
  mistakes.forEach((m) => {
    rows.push([m.term, m.cn || "", m.ts, m.grade, m.mode]);
  });
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mistakes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== 示例数据（用于快速体验） =====
type SimpleCard = { term: string; cn?: string; ipa?: string; tags?: string[]; notes?: string };
const sampleData729: SimpleCard[] = [
  { term: "controversial", cn: "有争议的", ipa: "/ˌkɒntrəˈvɜːʃəl/" },
  { term: "gravel", cn: "砾石；碎石", ipa: "/ˈɡrævəl/" },
  { term: "prudent", cn: "谨慎的；审慎的", ipa: "/ˈpruːd(ə)nt/" },
  { term: "homie", cn: "老友；老铁（俚）", ipa: "/ˈhoʊmi/" },
  { term: "queue", cn: "队列；排队；（v.）排队", ipa: "/kjuː/" },
  { term: "cable", cn: "电缆；有线电视", ipa: "/ˈkeɪb(ə)l/" },
  { term: "cable car", cn: "缆车", ipa: "/ˈkeɪb(ə)l kɑːr/" },
  { term: "till", cn: "直到、收银台", ipa: "/tɪl/" },
  { term: "tuition", cn: "学费；（英）个别辅导", ipa: "/tjuːˈɪʃ(ə)n/" },
  { term: "commemorate", cn: "纪念；缅怀", ipa: "/kəˈmeməreɪt/" },
  { term: "impulsive", cn: "冲动的", ipa: "/ɪmˈpʌlsɪv/" },
  { term: "game console", cn: "游戏主机", ipa: "/ˈɡeɪm ˌkɒnsoʊl/" },
  { term: "grid", cn: "网格；电网", ipa: "/ɡrɪd/" },
  { term: "yacht", cn: "游艇", ipa: "/jɒt/" },
  { term: "peek", cn: "偷看；瞥一眼", ipa: "/piːk/" },
  { term: "hustle", cn: "忙碌奔波；（美俚）拼；推搡", ipa: "/ˈhʌs(ə)l/" },
  { term: "indicator", cn: "指示物；指标；（车）转向灯", ipa: "/ˈɪndɪˌkeɪtər/" },
  { term: "relapse", cn: "复发；故态复萌", ipa: "/ˈriːlæps/" },
  { term: "lag", cn: "滞后；延迟", ipa: "/læɡ/" },
  { term: "impulse", cn: "冲动；脉冲", ipa: "/ˈɪmpʌls/" },
  { term: "deficit", cn: "赤字；逆差；亏损", ipa: "/ˈdefɪsɪt/" },
  { term: "revert", cn: "恢复（到原状）；回到（话题/旧做法）", ipa: "/rɪˈvɜːrt/" },
  { term: "hint", cn: "暗示；提示；少量", ipa: "/hɪnt/" },
];

const sampleData827: SimpleCard[] = [
  { term: "irritate", cn: "惹恼；刺激（皮肤/眼睛）", ipa: "/ˈɪrɪteɪt/" },
  { term: "for the sake of", cn: "为了…的缘故；出于…的考虑", ipa: "/fɔː(r) ðə seɪk əv/" },
  { term: "binge", cn: "（n./v.）狂吃；狂看；放纵", ipa: "/bɪndʒ/" },
  { term: "grab a bite", cn: "随便吃点东西", ipa: "/ɡræb ə baɪt/" },
  { term: "discipline", cn: "纪律；自律；（v.）训练；惩戒；（n.）学科", ipa: "/ˈdɪsəplɪn/" },
  { term: "grill", cn: "烧烤；（非正式）严厉盘问", ipa: "/ɡrɪl/" },
  { term: "neat", cn: "整洁的；（口）很棒的；（酒）纯的（不加冰水）", ipa: "/niːt/" },
  { term: "get rid of", cn: "摆脱；去除；清除", ipa: "/ɡet rɪd əv/" },
  { term: "tickle", cn: "挠痒；逗乐", ipa: "/ˈtɪk(ə)l/" },
  { term: "bias", cn: "偏见；偏差；偏向", ipa: "/ˈbaɪəs/" },
  { term: "therapy", cn: "治疗；疗法", ipa: "/ˈθerəpi/" },
];

const sampleData828: SimpleCard[] = [
  { term: "soak", cn: "浸泡；浸湿；（口）敲竹杠", ipa: "/soʊk/" },
  { term: "electric doorbell", cn: "电门铃", ipa: "/ɪˈlektrɪk ˈdɔːrbel/" },
  { term: "electronic toilet", cn: "智能马桶", ipa: "/ɪˌlekˈtrɒnɪk ˈtɔɪlət/" },
  { term: "take turns", cn: "轮流（做某事）", ipa: "/teɪk tɜːrnz/" },
  { term: "ancestor", cn: "祖先", ipa: "/ˈæn.sestər/" },
  { term: "calorie", cn: "卡路里；热量单位", ipa: "/ˈkæl.ə.ri/" },
  { term: "powder", cn: "粉末；粉状物；（v.）撒粉", ipa: "/ˈpaʊdər/" },
  { term: "illustrate", cn: "说明；阐明；（给书）配插图", ipa: "/ˈɪləstreɪt/" },
  { term: "sickle", cn: "镰刀", ipa: "/ˈsɪkəl/" },
  { term: "in seven stages", cn: "分七个阶段；七个步骤" },
  { term: "alternative", cn: "可替代的；替代方案", ipa: "/ɔːlˈtɜːnətɪv/" },
  { term: "sugar", cn: "糖；蔗糖", ipa: "/ˈʃʊɡər/" },
  { term: "crop", cn: "作物；庄稼；（v.）裁剪（图片）", ipa: "/krɑːp/" },
  { term: "by the means of two ways", cn: "通过两种方式（更自然写法：in two ways/by two means）" },
  { term: "specialized vehicle", cn: "专用车辆", ipa: "/ˈspeʃəlaɪzd ˈviːɪkl/" },
  { term: "dormitory", cn: "宿舍", ipa: "/ˈdɔːrmətɔːri/" },
  { term: "crush", cn: "压碎；迷恋（have a crush on）", ipa: "/krʃ/" },
  { term: "purifying", cn: "净化的；起净化作用的", ipa: "/ˈpjʊrɪfaɪɪŋ/" },
  { term: "purified", cn: "被净化的；纯化的", ipa: "/ˈpjʊrɪfaɪd/" },
  { term: "purify", cn: "净化；提纯", ipa: "/ˈpjʊrɪfaɪ/" },
  { term: "separate from", cn: "与…分开；把…分离", ipa: "/ˈsepəreɪt frɒm/" },
  { term: "take into the last phase", cn: "进入最后阶段（更自然：move into the final phase）" },
  { term: "finalise", cn: "最终确定；敲定（英式；美式 finalize）", ipa: "/ˈfaɪnəlaɪz/" },
  { term: "repetitive", cn: "重复的；反复的（常令人厌）", ipa: "/rɪˈpetətɪv/" },
  { term: "a dedicated chinese drill section", cn: "一个专门的中文练习部分" },
  { term: "drill", cn: "钻头；训练；（语言）操练", ipa: "/drɪl/" },
  { term: "dedicated", cn: "专用的；（人）尽心尽力的", ipa: "/ˈdedɪkeɪtɪd/" },
  { term: "radical", cn: "激进的；根本的", ipa: "/ˈrædɪkəl/" },
  { term: "familiar", cn: "熟悉的（be familiar with）", ipa: "/fəˈmɪljər/" },
  { term: "shame", cn: "羞耻；遗憾；可惜", ipa: "/ʃeɪm/" },
  { term: "tedious", cn: "乏味的；冗长的", ipa: "/ˈtiːdiəs/" },
  { term: "pajamas", cn: "睡衣（美式；英式 pyjamas）", ipa: "/pəˈdʒɑːməz/" },
  { term: "private", cn: "私人的；保密的", ipa: "/ˈpraɪvət/" },
  { term: "latency", cn: "延迟；时延", ipa: "/ˈleɪtənsi/" },
  { term: "lottery", cn: "彩票；抽签", ipa: "/ˈlɑːtəri/" },
  { term: "resident", cn: "居民；住院医生（美）", ipa: "/ˈrezɪdənt/" },
  { term: "eligible to progress", cn: "有资格晋级/进入下一轮" },
  { term: "rival", cn: "对手；竞争者", ipa: "/ˈraɪvəl/" },
  { term: "legacy", cn: "遗产；遗留；旧系统", ipa: "/ˈleɡəsi/" },
  { term: "sedentary", cn: "久坐不动的；缺乏运动的", ipa: "/ˈsednteri/" },
  { term: "fertility", cn: "生育力；生育率", ipa: "/fərˈtɪləti/" },
];

const usageData: UsageItem[] = [
  { q: "Please ___ the beans overnight.", options: ["soak", "soaks", "soaked", "to soaking"], answer: 0, explain: "祈使句用动词原形：soak the beans overnight." },
  { q: "The towel quickly ___ the spill.", options: ["soaked up", "soak up", "soaks up", "was soak up"], answer: 0, explain: "soak up=吸收；过去时态与副词搭配更自然。" },
  { q: "We ___ doing the dishes.", options: ["take turns", "take turn", "took turns for", "are take turns"], answer: 0, explain: "固定搭配 take turns (doing sth)。" },
  { q: "She traced her ___ back to the 18th century.", options: ["ancestors", "ancestor", "ancestry", "ancestral"], answer: 2, explain: "trace one's ancestry back to... 最地道；ancestors 也可。" },
  { q: "This snack is low in ___.", options: ["calorie", "calories", "caloric", "caloried"], answer: 1, explain: "low in + 复数名词：calories。" },
  { q: "Add two scoops of protein ___.", options: ["powder", "powders", "powdered", "powdery"], answer: 0, explain: "名词作宾语：protein powder。" },
  { q: "To ___ my point, let me show a chart.", options: ["illustrate", "illustration", "illustrated", "illustrating"], answer: 0, explain: "to + 动词原形：to illustrate my point。" },
  { q: "The farmer cut wheat with a ___.", options: ["sickle", "cycle", "circle", "saw"], answer: 0, explain: "sickle=镰刀。" },
  { q: "We need an ___ to plastic bags.", options: ["alternative", "alternative for", "alternate", "alternatively"], answer: 0, explain: "an alternative to sth。" },
  { q: "You can ___ the photo to 1:1.", options: ["crop", "harvest", "cut off", "clipping"], answer: 0, explain: "crop=裁剪（图片）。" },
  { q: "Freshmen are required to live in the ___.", options: ["dormitory", "dorm", "dormitories", "dorms"], answer: 0, explain: "正式场合常用 dormitory。" },
  { q: "We need to ___ the itinerary by Friday.", options: ["finalise", "finalizing", "finalised", "be finalised"], answer: 0, explain: "动词原形：to finalise。" },
  { q: "The job is boring and ___.", options: ["repeat", "repetition", "repetitive", "repeatedly"], answer: 2, explain: "repetitive=乏味重复的。" },
  { q: "Are you ___ this software?", options: ["familiar of", "familiar with", "familiar to", "familiar on"], answer: 1, explain: "be familiar with。" },
  { q: "It's a ___ you can't come.", options: ["shamed", "shame", "ashamed", "same"], answer: 1, explain: "固定句式：It's a shame (that)..." },
  { q: "The process is long and ___.", options: ["tedious", "tedium", "tiring", "bored"], answer: 0, explain: "tedious=冗长乏味。" },
  { q: "He answered the door in his ___.", options: ["pajamas", "pajama", "pajamases", "pyjama"], answer: 0, explain: "美式 pajamas。" },
  { q: "Please keep this information ___.", options: ["private", "privacy", "privately", "privy"], answer: 0, explain: "keep sth private。" },
  { q: "High network ___ causes video lag.", options: ["latency", "lateness", "delay", "late"], answer: 0, explain: "latency=时延。" },
  { q: "She hopes to ___ the lottery one day.", options: ["win", "hit", "earn", "draw"], answer: 0, explain: "win the lottery。" },
  { q: "Local ___ protested the plan.", options: ["residents", "resident", "residency", "residence"], answer: 0, explain: "居民：residents。" },
  { q: "Top teams are ___ to the next round.", options: ["eligible to progress", "eligible for progress", "able to eligible", "eligible progress"], answer: 0, explain: "be eligible to progress。" },
  { q: "Our main ___ is launching a similar product.", options: ["rival", "rivalry", "competitor", "opponent"], answer: 0, explain: "rival=竞争者。" },
  { q: "We need to migrate from a ___ system.", options: ["legacy", "legible", "legal", "legend"], answer: 0, explain: "legacy system=遗留系统。" },
  { q: "Sitting all day leads to a ___ lifestyle.", options: ["sedentary", "sedatively", "sedative", "sedentaryness"], answer: 0, explain: "sedentary lifestyle。" },
  { q: "The country's ___ rate has fallen.", options: ["fertility", "fertilization", "fertile", "fertilize"], answer: 0, explain: "fertility rate。" },
  { q: "The lab uses a ___ for transporting chemicals.", options: ["specialized vehicle", "special vehicle", "specifically vehicle", "vehicle specialized"], answer: 0, explain: "a specialized vehicle for..." },
  { q: "Keep raw meat ___ cooked food.", options: ["separate from", "separate to", "separated with", "separating of"], answer: 0, explain: "separate A from B。" },
  { q: "___ water is safe to drink.", options: ["Purified", "Purifying", "Purify", "Been purified"], answer: 0, explain: "Purified water。" },
  { q: "We do ten-minute listening ___ every morning.", options: ["drills", "drilling", "drill", "drilled"], answer: 0, explain: "listening drills。" },
  { q: "She has a ___ on her classmate.", options: ["crush", "crushing", "crushes", "crush on"], answer: 0, explain: "have a crush on sb。" },
  { q: "“通过两种方式”最自然的英语是？", options: ["by the means of two ways", "in two ways", "by two ways", "by two means"], answer: 1, explain: "in two ways 最常用。" },
  { q: "The process unfolds ___.", options: ["in seven stages", "by seven stages", "with seven stages", "at seven stages"], answer: 0, explain: "in seven stages。" },
];

function sampleToParsed(data: SimpleCard[], _source: string): ParsedRow[] {
  return data.map((item) => ({
    term: item.term,
    cn: item.cn,
    ipa: item.ipa,
    tags: item.tags || [],
    notes: item.notes,
    normTerm: canonicalTerm(item.term),
    cnDigest: digestCn(item.cn),
  }));
}

// ===== 主组件 =====
export default function QuizGPTFlashcards() {
  const [allCards, setAllCards] = React.useState<CardRecord[]>([]);
  const [plan, setPlan] = React.useState<PlanMetrics>({ due: 0, learning: 0, newCount: 0, totalCards: 0 });
  const [importReport, setImportReport] = React.useState<ImportReport | null>(null);
  const [importHistory, setImportHistory] = React.useState<ImportRecord[]>([]);
  const [recentMistakes, setRecentMistakes] = React.useState<{ term: string; cn?: string; ts: string; grade: Grade; mode: Mode }[]>([]);
  const [sessionQueue, setSessionQueue] = React.useState<SessionItem[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [question, setQuestion] = React.useState<QuestionPayload | null>(null);
  const [reveal, setReveal] = React.useState(false);
  const [selectedOption, setSelectedOption] = React.useState<Option | null>(null);
  const [input, setInput] = React.useState("");
  const [result, setResult] = React.useState<"correct" | "incorrect" | null>(null);
  const [questionStart, setQuestionStart] = React.useState<number>(Date.now());
  const [sessionAttempts, setSessionAttempts] = React.useState(0);
  const [sessionCorrect, setSessionCorrect] = React.useState(0);
  const [sessionMistakes, setSessionMistakes] = React.useState<{ term: string; cn?: string }[]>([]);
  const [sessionSize, setSessionSize] = React.useState(40);
  const [sessionMode, setSessionMode] = React.useState<SessionMode>("mixed");
  const [loadingSession, setLoadingSession] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [view, setView] = React.useState<"practice" | "stats" | "usage" | "imports">("practice");
  const [stats, setStats] = React.useState<{ summaries: StatsSummary[]; trend: TrendPoint[] } | null>(null);
  const [usageIndex, setUsageIndex] = React.useState(0);
  const [usageReveal, setUsageReveal] = React.useState(false);
  const [usageAttempts, setUsageAttempts] = React.useState(0);
  const [usageCorrect, setUsageCorrect] = React.useState(0);

  const refreshAll = React.useCallback(async () => {
    const cards = await db.cards.toArray();
    cards.sort((a, b) => a.term.localeCompare(b.term));
    setAllCards(cards);
    setPlan(await computePlanMetrics());
    setRecentMistakes(await loadRecentMistakes());
    const history = await db.importLog.orderBy("imported_at").reverse().limit(20).toArray();
    setImportHistory(history);
  }, []);

  React.useEffect(() => {
    refreshAll().catch((err) => console.error(err));
  }, [refreshAll]);

  React.useEffect(() => {
    if (!sessionQueue.length) {
      setQuestion(null);
      return;
    }
    const idx = Math.min(currentIndex, sessionQueue.length - 1);
    if (idx !== currentIndex) {
      setCurrentIndex(idx);
      return;
    }
    const item = sessionQueue[idx];
    const q = buildQuestion(item, allCards);
    setQuestion(q);
    setReveal(false);
    setSelectedOption(null);
    setInput("");
    setResult(null);
    setQuestionStart(Date.now());
    if (q.mode === "listening") speak(item.card.term);
  }, [sessionQueue, currentIndex, allCards]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!question || reveal) return;
      if (!question.allowInput) {
        const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };
        if (map[e.key] != null) {
          const opt = question.options[map[e.key]];
          if (opt) onOptionSelect(opt);
        }
      } else if (question.allowInput && e.key === "Enter") {
        onSubmitInput();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question, reveal]);

  React.useEffect(() => {
    if (view === "stats") {
      loadStats().then(setStats).catch((err) => console.error(err));
    }
    if (view === "imports") {
      db.importLog.orderBy("imported_at").reverse().limit(50).toArray().then(setImportHistory);
    }
  }, [view]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = await parseRowsFromSheet(sheet);
      const hash = await computeSHA256(buffer);
      const report = await importParsedRows(rows, file.name, hash);
      setImportReport(report);
      await refreshAll();
    } catch (err) {
      console.error(err);
      alert("读取或导入文件失败，请确认格式为 .xlsx/.xls/.csv 且前3列为 英文/中文/IPA。");
    } finally {
      setImporting(false);
    }
  }

  async function seedSample(data: SimpleCard[], label: string) {
    const parsed = sampleToParsed(data, label);
    const report = await importParsedRows(parsed, `sample-${label}`, undefined);
    setImportReport(report);
    await refreshAll();
  }

  async function startSession() {
    try {
      setLoadingSession(true);
      const cards = allCards.length ? allCards : await db.cards.toArray();
      if (cards.length === 0) {
        alert("请先导入词库再开始练习。");
        return;
      }
      const queue = await buildSessionQueue(sessionSize, sessionMode, cards);
      if (queue.length === 0) {
        alert("暂无可练习的卡片，请稍后再试或调整配额。");
        return;
      }
      setSessionQueue(queue);
      setCurrentIndex(0);
      setSessionAttempts(0);
      setSessionCorrect(0);
      setSessionMistakes([]);
    } catch (err) {
      console.error(err);
      alert("生成练习任务失败，请稍后重试。");
    } finally {
      setLoadingSession(false);
    }
  }

  function pushMistake(card: CardRecord) {
    setSessionMistakes((prev) => [...prev, { term: card.term, cn: card.cn }].slice(-30));
  }

  function onOptionSelect(option: Option) {
    if (!question || reveal) return;
    setSelectedOption(option);
    const correct = option.correct;
    setResult(correct ? "correct" : "incorrect");
    if (!correct) pushMistake(question.item.card);
    setReveal(true);
  }

  function onSubmitInput() {
    if (!question || reveal) return;
    const expected = question.expects?.trim().toLowerCase() || "";
    const ans = input.trim().toLowerCase();
    const correct = ans === expected;
    setResult(correct ? "correct" : "incorrect");
    if (!correct) pushMistake(question.item.card);
    setReveal(true);
  }

  function revealAnswer() {
    if (!question || reveal) return;
    pushMistake(question.item.card);
    setResult("incorrect");
    setReveal(true);
  }

  async function applyGrade(grade: Grade) {
    if (!question) return;
    if (!reveal) {
      alert("请先作答或显示答案，再选择反馈等级。");
      return;
    }
    try {
      const review = question.item.review;
      const update = sm2Update(review, grade);
      const correct = result === "correct";
      const attempts = review.total_attempts + 1;
      const correctCount = review.total_correct + (correct ? 1 : 0);
      const seconds = (Date.now() - questionStart) / 1000;
      const avgSeconds = ((review.avg_seconds || 0) * review.total_attempts + seconds) / attempts;

      const newReview: ReviewRecord = {
        ...review,
        ...update,
        total_attempts: attempts,
        total_correct: correctCount,
        avg_seconds: avgSeconds,
      };

      await db.transaction("rw", db.reviews, db.logs, async () => {
        await db.reviews.update(review.card_id, {
          ease: newReview.ease,
          interval: newReview.interval,
          lapses: newReview.lapses,
          reps: newReview.reps,
          last_review: newReview.last_review,
          next_review: newReview.next_review,
          total_attempts: newReview.total_attempts,
          total_correct: newReview.total_correct,
          avg_seconds: newReview.avg_seconds,
        });
        await db.logs.add({
          ts: getNowIso(),
          card_id: review.card_id,
          mode: question.mode,
          result: grade,
          seconds,
          correct,
          meta: { prompt: question.prompt },
        });
      });

      setSessionAttempts((v) => v + 1);
      if (correct) setSessionCorrect((v) => v + 1);

      setSessionQueue((prev) => {
        if (!prev[currentIndex]) return prev;
        const next = [...prev];
        const currentItem = { ...next[currentIndex], review: newReview };
        next.splice(currentIndex, 1);
        if (grade === "again") {
          const insertIndex = Math.min(currentIndex + 3, next.length);
          next.splice(insertIndex, 0, currentItem);
        }
        const newIndex = next.length === 0 ? 0 : Math.min(currentIndex, next.length - 1);
        setCurrentIndex(newIndex);
        return next;
      });

      setReveal(false);
      setSelectedOption(null);
      setInput("");
      setResult(null);
      await refreshAll();
    } catch (err) {
      console.error(err);
      alert("记录结果时出现问题，请重试。");
    }
  }

  function currentProgress() {
    const remaining = sessionQueue.length;
    const total = sessionAttempts + remaining;
    if (total === 0) return { current: 0, total: 0 };
    return { current: Math.min(sessionAttempts + 1, total), total };
  }

  function usageAnswer(idx: number) {
    if (usageReveal) return;
    const item = usageData[usageIndex];
    const correct = idx === item.answer;
    setUsageAttempts((v) => v + 1);
    if (correct) setUsageCorrect((v) => v + 1);
    setUsageReveal(true);
  }

  function usageNext() {
    setUsageIndex((idx) => (idx + 1) % usageData.length);
    setUsageReveal(false);
  }

  const progress = currentProgress();

  return (
    <div className="w-full min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Flashcards · SRS 练习</h1>
            <p className="text-sm text-gray-500">导入每日词表 → 自动去重入库 → 根据 SM-2 间隔重复出题 → 记录错题与统计。</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            <button className={`px-3 py-1.5 rounded-full border ${view === "practice" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => setView("practice")}>练习</button>
            <button className={`px-3 py-1.5 rounded-full border ${view === "stats" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => setView("stats")}>统计</button>
            <button className={`px-3 py-1.5 rounded-full border ${view === "imports" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => setView("imports")}>导入记录</button>
            <button className={`px-3 py-1.5 rounded-full border ${view === "usage" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => setView("usage")}>用法题</button>
          </nav>
        </header>

        {view === "practice" && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-3">
                <div className="text-xs text-gray-500">导入词表</div>
                <label className="block">
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
                  <span className={`inline-flex items-center justify-center w-full px-3 py-2 rounded-xl border ${importing ? "bg-gray-100" : "bg-gray-900 text-white cursor-pointer"}`}>
                    {importing ? "导入中..." : "上传 Excel/CSV"}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <button className="px-3 py-2 rounded-xl border" onClick={() => seedSample(sampleData729, "2023-07-29")}>示例 7.29</button>
                  <button className="px-3 py-2 rounded-xl border" onClick={() => seedSample(sampleData827, "2023-08-27")}>示例 8.27</button>
                  <button className="px-3 py-2 rounded-xl border" onClick={() => seedSample(sampleData828, "2023-08-28")}>示例 8.28</button>
                  <button className="px-3 py-2 rounded-xl border" onClick={exportMistakesCSV}>错题导出 (7 天)</button>
                </div>
                {importReport && (
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>最新导入：{importReport.fileName}</div>
                    <div className="text-green-600">新建 {importReport.newCount}</div>
                    <div className="text-blue-600">更新 {importReport.updatedCount}</div>
                    <div className="text-orange-500">多义/并行 {importReport.conflictCount}</div>
                    {importReport.warnings.map((w, idx) => (
                      <div key={idx} className="text-red-500">{w}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-3">
                <div className="text-xs text-gray-500">学习计划</div>
                <div className="text-2xl font-semibold">到期 {plan.due} · 学习中 {plan.learning} · 新词 {plan.newCount}</div>
                <div className="text-sm text-gray-500">总词条：{plan.totalCards}</div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <span>题量</span>
                    <input type="number" min={10} max={200} value={sessionSize} onChange={(e) => setSessionSize(Number(e.target.value) || 40)} className="w-20 px-2 py-1 rounded-lg border" />
                  </label>
                  <label className="flex items-center gap-2">
                    <span>模式</span>
                    <select value={sessionMode} onChange={(e) => setSessionMode(e.target.value as SessionMode)} className="px-2 py-1 rounded-lg border">
                      <option value="mixed">混合</option>
                      <option value="eng2cn">英→中</option>
                      <option value="cn2eng">中→英</option>
                      <option value="listening">听力</option>
                      <option value="ipa">音标</option>
                    </select>
                  </label>
                </div>
                <button className="px-4 py-2 rounded-xl border bg-gray-900 text-white" onClick={startSession} disabled={loadingSession}>
                  {loadingSession ? "生成题目..." : "开始今日练习"}
                </button>
              </div>

              <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-2">
                <div className="text-xs text-gray-500">练习进度</div>
                <div className="text-sm">当前 {progress.current} / {progress.total}</div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gray-900"
                    style={{ width: `${progress.total === 0 ? 0 : Math.min(100, Math.round((progress.current / progress.total) * 100))}%` }}
                  />
                </div>
                <div className="text-sm">本轮正确 {sessionCorrect} / 尝试 {sessionAttempts}</div>
              </div>

              <div className="p-4 bg-white rounded-2xl border shadow-sm space-y-2">
                <div className="text-xs text-gray-500">最近错题</div>
                <div className="space-y-1 max-h-32 overflow-y-auto text-sm">
                  {recentMistakes.length === 0 && <div className="text-gray-400">最近 7 天无错题。</div>}
                  {recentMistakes.slice(0, 8).map((m, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="font-medium">{m.term}</span>
                      <span className="text-gray-500">{formatDateShort(m.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <main className="bg-white border rounded-3xl shadow-sm p-6 md:p-8">
              {!question ? (
                <div className="text-center text-gray-500">点击“开始今日练习”即可生成到期复习、新词引入与巩固题的混合任务。</div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>模式：{question.mode === "eng2cn" ? "英→中" : question.mode === "cn2eng" ? "中→英" : question.mode === "ipa" ? "音标" : question.mode === "listening" ? "听力" : question.mode}</span>
                    <span>来源：{question.item.card.source_file}</span>
                  </div>

                  <div className="text-2xl md:text-3xl font-semibold leading-relaxed">
                    {question.mode === "cn2eng" ? question.prompt : question.prompt}
                  </div>

                  {question.allowInput ? (
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="请输入英文拼写" className="w-full md:w-2/3 px-4 py-3 rounded-2xl border focus:outline-none focus:ring-2 focus:ring-gray-900" onKeyDown={(e) => { if (e.key === "Enter") onSubmitInput(); }} />
                      <button className="px-4 py-3 rounded-2xl border" onClick={onSubmitInput}>提交</button>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-3">
                      {question.options.slice(0, 4).map((opt, idx) => {
                        const isSelected = selectedOption?.key === opt.key;
                        const state = reveal ? (opt.correct ? "border-emerald-500 bg-emerald-50" : isSelected ? "border-red-500 bg-red-50" : "") : isSelected ? "border-gray-900" : "";
                        return (
                          <button key={idx} className={`text-left px-4 py-3 rounded-2xl border hover:bg-gray-50 ${state}`} disabled={reveal} onClick={() => onOptionSelect(opt)}>
                            <div className="text-xs text-gray-500">选项 {idx + 1}</div>
                            <div className="text-base">{opt.label || "（无释义）"}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {reveal && (
                    <div className="p-4 bg-gray-100 border rounded-2xl space-y-1">
                      <div className="text-sm text-gray-500">正确答案</div>
                      <div className="text-lg">
                        <div><span className="font-semibold">{question.item.card.term}</span><span className="mx-2">→</span><span>{question.item.card.cn || "（无中文释义）"}</span></div>
                        {question.item.card.ipa && <div className="text-gray-600">IPA: <span className="font-mono">{question.item.card.ipa}</span></div>}
                        {question.item.card.notes && <div className="text-gray-600">备注：{question.item.card.notes}</div>}
                      </div>
                      <div className={`text-sm ${result === "correct" ? "text-emerald-600" : "text-red-500"}`}>
                        {result === "correct" ? "回答正确" : "回答不正确"}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-gray-500">快捷键：选项题按 1/2/3/4；拼写题回车提交。</div>
                    <div className="flex flex-wrap gap-2">
                      {!reveal && <button className="px-4 py-2 rounded-2xl border" onClick={revealAnswer}>显示答案</button>}
                      <button className="px-4 py-2 rounded-2xl border" onClick={() => applyGrade("again")}>Again</button>
                      <button className="px-4 py-2 rounded-2xl border" onClick={() => applyGrade("hard")}>Hard</button>
                      <button className="px-4 py-2 rounded-2xl border" onClick={() => applyGrade("good")}>Good</button>
                      <button className="px-4 py-2 rounded-2xl border" onClick={() => applyGrade("easy")}>Easy</button>
                    </div>
                  </div>
                </div>
              )}
            </main>

            {sessionMistakes.length > 0 && (
              <section className="p-4 bg-white border rounded-2xl shadow-sm">
                <div className="text-sm text-gray-500 mb-2">本轮错题（最近 30 条）</div>
                <div className="grid md:grid-cols-2 gap-2 text-sm">
                  {sessionMistakes.slice(-12).map((m, idx) => (
                    <div key={idx} className="px-3 py-2 rounded-xl bg-gray-50 border">
                      <span className="font-medium">{m.term}</span>
                      <span className="mx-2">→</span>
                      <span className="text-gray-700">{m.cn || ""}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {view === "stats" && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-6 bg-white border rounded-3xl shadow-sm">
              <div className="text-lg font-semibold mb-4">复习概览</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                {stats?.summaries.map((s, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-2xl border">
                    <div className="text-xs text-gray-500">{s.range}</div>
                    <div className="text-2xl font-semibold">{s.accuracy}%</div>
                    <div className="text-gray-600 mt-1">{s.correct}/{s.attempts} 正确 · {Math.round(s.seconds)} 秒</div>
                  </div>
                )) || <div className="text-gray-500">暂无数据</div>}
              </div>
            </div>
            <div className="p-6 bg-white border rounded-3xl shadow-sm">
              <div className="text-lg font-semibold mb-4">近 7 天趋势</div>
              <div className="space-y-3 text-sm">
                {stats?.trend.map((t, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{t.label}</span>
                      <span>到期 {t.dueCount} · 答题 {t.attempts}</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-900" style={{ width: `${Math.min(100, t.attempts ? Math.round((t.correct / Math.max(1, t.attempts)) * 100) : 0)}%` }} />
                    </div>
                    <div className="text-gray-600">正确 {t.correct} · 耗时 {Math.round(t.seconds)} 秒</div>
                  </div>
                )) || <div className="text-gray-500">暂无趋势数据</div>}
              </div>
            </div>
          </section>
        )}

        {view === "imports" && (
          <section className="p-6 bg-white border rounded-3xl shadow-sm">
            <div className="text-lg font-semibold mb-4">导入历史</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-2 pr-4">时间</th>
                    <th className="py-2 pr-4">文件</th>
                    <th className="py-2 pr-4">新建</th>
                    <th className="py-2 pr-4">更新</th>
                    <th className="py-2 pr-4">多义</th>
                    <th className="py-2 pr-4">摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.length === 0 && (
                    <tr>
                      <td className="py-3 text-gray-500" colSpan={6}>暂无导入记录</td>
                    </tr>
                  )}
                  {importHistory.map((log) => (
                    <tr key={log.id} className="border-t">
                      <td className="py-2 pr-4">{formatDateShort(log.imported_at)}</td>
                      <td className="py-2 pr-4">{log.file_name}</td>
                      <td className="py-2 pr-4 text-green-600">{log.new_count}</td>
                      <td className="py-2 pr-4 text-blue-600">{log.updated_count}</td>
                      <td className="py-2 pr-4 text-orange-500">{log.conflict_count}</td>
                      <td className="py-2 pr-4 break-words">{log.sha256?.slice(0, 16) || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {view === "usage" && (
          <section className="p-6 bg-white border rounded-3xl shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">用法题训练</div>
                <div className="text-2xl font-semibold">{usageAttempts ? Math.round((usageCorrect / usageAttempts) * 100) : 100}% 准确率</div>
              </div>
              <div className="text-sm text-gray-500">已做 {usageAttempts} 题</div>
            </div>
            <div className="text-xl md:text-2xl font-semibold">{usageData[usageIndex]?.q}</div>
            <div className="grid md:grid-cols-2 gap-3">
              {usageData[usageIndex]?.options.map((opt, idx) => {
                const isCorrect = idx === usageData[usageIndex].answer;
                const state = usageReveal ? (isCorrect ? "border-emerald-500 bg-emerald-50" : "border-red-400 bg-red-50") : "";
                return (
                  <button key={idx} className={`text-left px-4 py-3 rounded-2xl border hover:bg-gray-50 ${state}`} onClick={() => usageAnswer(idx)} disabled={usageReveal}>
                    <div className="text-xs text-gray-500">选项 {idx + 1}</div>
                    <div className="text-base">{opt}</div>
                  </button>
                );
              })}
            </div>
            {usageReveal && (
              <div className="p-4 bg-gray-100 border rounded-2xl text-sm text-gray-600">
                <div>正确答案：{usageData[usageIndex].options[usageData[usageIndex].answer]}</div>
                {usageData[usageIndex].explain && <div className="mt-1">{usageData[usageIndex].explain}</div>}
              </div>
            )}
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded-2xl border" onClick={usageNext}>下一题</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
