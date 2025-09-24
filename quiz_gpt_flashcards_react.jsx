import * as React from "react";
import * as XLSX from "xlsx";

// ===== Types =====
export type Card = { term: string; cn?: string; ipa?: string };
export type Mode = "eng2cn" | "cn2eng" | "listening" | "usage" | "ipa";
export type Option = { key: string; label: string; correct: boolean };
export type UsageItem = { q: string; options: string[]; answer: number; explain?: string };

// ===== Utils =====
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
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch {}
}

// ===== Datasets =====
// 7.29.xlsx → 英/中卡片（用于词义/听力）
const sampleData729: Card[] = [
  { term: "controversial", cn: "有争议的", ipa: "/ˌkɒntrəˈvɜːʃəl/" },
  { term: "gravel", cn: "砾石；碎石", ipa: "/ˈɡrævəl/" },
  { term: "prudent", cn: "谨慎的；审慎的", ipa: "/ˈpruːd(ə)nt/" },
  { term: "homie", cn: "老友；老铁（俚）", ipa: "/ˈhoʊmi/" },
  { term: "queue", cn: "队列；排队；（v.）排队", ipa: "/kjuː/" },
  { term: "cable", cn: "电缆；有线电视", ipa: "/ˈkeɪb(ə)l/" },
  { term: "cable car", cn: "缆车", ipa: "/ˈkeɪb(ə)l kɑːr/" },
  { term: "till", cn: "直到、收银台", ipa: "/tɪl/" },
  { term: "tuition", cn: "学费；（英）个别辅导", ipa: "/tjuːˈɪʃ(ə)n/" },
  { term: "One out of five：指在一个满分或总数为五的系统里，得到了“一”。", cn: "五分之一；（五级评分中）得一分" },
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
  { term: "hint", cn: "暗示；提示；少量", ipa: "/hɪnt/" }
];

// 8.27.xlsx 核心词（根据你上传的表提取，并补齐 IPA）
const sampleData827: Card[] = [
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
  { term: "therapy", cn: "治疗；疗法", ipa: "/ˈθerəpi/" }
];

// 8.28.xlsx · 新词库（带中文+部分 IPA）
const sampleData828: Card[] = [
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
  { term: "fertility", cn: "生育力；生育率", ipa: "/fərˈtɪləti/" }
];

// 8.28 用法题（精选 28 题）
const usageData: UsageItem[] = [
  // soak / soak up
  { q: "Please ___ the beans overnight.", options: ["soak", "soaks", "soaked", "to soaking"], answer: 0, explain: "祈使句用动词原形：soak the beans overnight." },
  { q: "The towel quickly ___ the spill.", options: ["soaked up", "soak up", "soaks up", "was soak up"], answer: 0, explain: "soak up=吸收；过去时态与副词搭配更自然。" },

  // take turns (doing)
  { q: "We ___ doing the dishes.", options: ["take turns", "take turn", "took turns for", "are take turns"], answer: 0, explain: "固定搭配 take turns (doing sth)。" },

  // ancestor / ancestry
  { q: "She traced her ___ back to the 18th century.", options: ["ancestors", "ancestor", "ancestry", "ancestral"], answer: 2, explain: "trace one's ancestry back to... 最地道；ancestors 也可，但常说 ancestry（家世、血统）。" },

  // calorie
  { q: "This snack is low in ___.", options: ["calorie", "calories", "caloric", "caloried"], answer: 1, explain: "low in + 复数名词：calories。" },

  // powder
  { q: "Add two scoops of protein ___.", options: ["powder", "powders", "powdered", "powdery"], answer: 0, explain: "名词作宾语：protein powder；powdered 是形容词。" },

  // illustrate
  { q: "To ___ my point, let me show a chart.", options: ["illustrate", "illustration", "illustrated", "illustrating"], answer: 0, explain: "to + 动词原形：to illustrate my point。" },

  // sickle
  { q: "The farmer cut wheat with a ___.", options: ["sickle", "cycle", "circle", "saw"], answer: 0, explain: "sickle=镰刀。" },

  // alternative (to)
  { q: "We need an ___ to plastic bags.", options: ["alternative", "alternative for", "alternate", "alternatively"], answer: 0, explain: "an alternative to sth。" },

  // crop (v.)
  { q: "You can ___ the photo to 1:1.", options: ["crop", "harvest", "cut off", "clipping"], answer: 0, explain: "图像编辑术语：crop（裁剪）。" },

  // dormitory
  { q: "Freshmen are required to live in the ___.", options: ["dormitory", "dorm", "dormitories", "dorms"], answer: 0, explain: "正式场合常用 dormitory（也可简写 dorm）。" },

  // finalise / finalize
  { q: "We need to ___ the itinerary by Friday.", options: ["finalise", "finalizing", "finalised", "be finalised"], answer: 0, explain: "动词原形：to finalise（英式）；美式写作 finalize 亦可。" },

  // repetitive
  { q: "The job is boring and ___.", options: ["repeat", "repetition", "repetitive", "repeatedly"], answer: 2, explain: "形容词：repetitive（重复乏味的）。" },

  // familiar with
  { q: "Are you ___ this software?", options: ["familiar of", "familiar with", "familiar to", "familiar on"], answer: 1, explain: "be familiar with。" },

  // shame
  { q: "It's a ___ you can't come.", options: ["shamed", "shame", "ashamed", "same"], answer: 1, explain: "固定句式：It's a shame (that)..." },

  // tedious
  { q: "The process is long and ___.", options: ["tedious", "tedium", "tiring", "bored"], answer: 0, explain: "tedious=冗长乏味。" },

  // pajamas
  { q: "He answered the door in his ___.", options: ["pajamas", "pajama", "pajamases", "pyjama"], answer: 0, explain: "美式：pajamas（复数形态名词）。英式：pyjamas。" },

  // private
  { q: "Please keep this information ___.", options: ["private", "privacy", "privately", "privy"], answer: 0, explain: "keep sth private。privacy 是名词。" },

  // latency
  { q: "High network ___ causes video lag.", options: ["latency", "lateness", "delay", "late"], answer: 0, explain: "技术语：network latency（时延）。" },

  // lottery
  { q: "She hopes to ___ the lottery one day.", options: ["win", "hit", "earn", "draw"], answer: 0, explain: "固定搭配：win the lottery。" },

  // residents
  { q: "Local ___ protested the plan.", options: ["residents", "resident", "residency", "residence"], answer: 0, explain: "住民本身：residents。" },

  // eligible to progress
  { q: "Top teams are ___ to the next round.", options: ["eligible to progress", "eligible for progress", "able to eligible", "eligible progress"], answer: 0, explain: "be eligible to progress (to...)。" },

  // rival
  { q: "Our main ___ is launching a similar product.", options: ["rival", "rivalry", "competitor", "opponent"], answer: 0, explain: "此处作可数名词：main rival/competitor；题设答案选 rival。" },

  // legacy system
  { q: "We need to migrate from a ___ system.", options: ["legacy", "legible", "legal", "legend"], answer: 0, explain: "legacy system=旧系统/遗留系统。" },

  // sedentary
  { q: "Sitting all day leads to a ___ lifestyle.", options: ["sedentary", "sedatively", "sedative", "sedentaryness"], answer: 0, explain: "sedentary lifestyle=久坐不动的生活方式。" },

  // fertility rate
  { q: "The country's ___ rate has fallen.", options: ["fertility", "fertilization", "fertile", "fertilize"], answer: 0, explain: "fertility rate=生育率。" },

  // specialized vehicle
  { q: "The lab uses a ___ for transporting chemicals.", options: ["specialized vehicle", "special vehicle", "specifically vehicle", "vehicle specialized"], answer: 0, explain: "搭配：a specialized vehicle for..." },

  // separate from
  { q: "Keep raw meat ___ cooked food.", options: ["separate from", "separate to", "separated with", "separating of"], answer: 0, explain: "separate A from B。" },

  // purified / purify
  { q: "___ water is safe to drink.", options: ["Purified", "Purifying", "Purify", "Been purified"], answer: 0, explain: "形容词：purified water；动词：purify water。" },

  // drill (n.)
  { q: "We do ten-minute listening ___ every morning.", options: ["drills", "drilling", "drill", "drilled"], answer: 0, explain: "listening drills（操练）。" },

  // crush (n.)
  { q: "She has a ___ on her classmate.", options: ["crush", "crushing", "crushes", "crush on"], answer: 0, explain: "have a crush on sb（迷恋）。" },

  // 表达更自然：in two ways
  { q: "“通过两种方式”最自然的英语是？", options: ["by the means of two ways", "in two ways", "by two ways", "by two means"], answer: 1, explain: "最常用 in two ways；by two means 也可。" },

  // in seven stages
  { q: "The process unfolds ___.", options: ["in seven stages", "by seven stages", "with seven stages", "at seven stages"], answer: 0, explain: "in + number + stages。" }
];

// ===== Component =====
export default function QuizGPTFlashcards() {
  const [cards, setCards] = React.useState<Card[]>(sampleData729);
  const [mode, setMode] = React.useState<Mode | null>(null);
  const [current, setCurrent] = React.useState<number>(0);
  const [options, setOptions] = React.useState<Option[]>([]);
  const [reveal, setReveal] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [correctCount, setCorrectCount] = React.useState(0);
  const [attempted, setAttempted] = React.useState(0);
  const [mistakes, setMistakes] = React.useState<Card[]>([]);
  const [shuffleOn, setShuffleOn] = React.useState(true);

  const total = mode === "usage" ? usageData.length : Math.max(1, cards.length);

  // Dev sanity check (pseudo test cases)
  React.useEffect(() => {
    console.log("[Self-test] dataset sizes", {
      sampleData729: sampleData729.length,
      sampleData827: sampleData827.length,
      sampleData828: sampleData828.length,
      usageData: usageData.length,
    });
  }, []);

  React.useEffect(() => {
    if (!mode) return;

    if (mode === "usage") {
      const u = usageData[current];
      const opts: Option[] = u?.options.slice(0, 4).map((label, i) => ({ key: String.fromCharCode(65 + i), label, correct: i === u.answer })) || [];
      setOptions(opts);
      setReveal(false); setInput("");
      return;
    }

    if (cards.length === 0) return;
    const card = cards[current];
    if (!card) return;

    if (mode === "eng2cn" || mode === "listening") {
      const distractors = pickDistractors(cards, 3, (c) => c === card || !c.cn).filter((d) => !!d.cn);
      const opts: Option[] = [
        { key: "A", label: card.cn || "（无中文释义）", correct: true },
        ...distractors.map((d, i) => ({ key: String.fromCharCode(66 + i), label: d.cn || "", correct: false })),
      ];
      setOptions(shuffle(opts));
      setReveal(false); setInput("");
      if (mode === "listening" && card.term) speak(card.term);
    } else if (mode === "ipa") {
      // IPA 选择题：给英文词，选正确的音标
      const candidates = cards.filter((c) => !!c.ipa && c !== card);
      const distract = shuffle(candidates).slice(0, 3);
      const opts: Option[] = shuffle([
        { key: "A", label: card.ipa || "（无音标）", correct: true },
        ...distract.map((d, i) => ({ key: String.fromCharCode(66 + i), label: d.ipa || "", correct: false })),
      ]);
      setOptions(opts); setReveal(false); setInput("");
    } else if (mode === "cn2eng") {
      setOptions([]); setReveal(false); setInput("");
    }
  }, [mode, current, cards]);

  function lengthForMode() { return mode === "usage" ? usageData.length : cards.length; }

  function loadFromSheet(sheet: XLSX.WorkSheet) {
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const parsed: Card[] = [];
    for (const r of rows) {
      if (!r) continue;
      const a = (r[0] ?? "").toString().trim();
      const b = (r[1] ?? "").toString().trim();
      const c = (r[2] ?? "").toString().trim(); // 第三列尝试作为 IPA
      if (!a) continue;
      const isHeader = /\b(parcel|word|english|term)\b/i.test(a) || /中文|释义|meaning|IPA|音标/i.test(b + " " + c);
      if (isHeader) continue;
      parsed.push({ term: a, cn: b || undefined, ipa: c || undefined });
    }
    if (parsed.length === 0) return false;
    const dataset = shuffleOn ? shuffle(parsed) : parsed;
    setCards(dataset); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);
    return true;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    try {
      const wb = XLSX.read(data, { type: "array" });
      const first = wb.SheetNames[0];
      const sheet = wb.Sheets[first];
      const ok = loadFromSheet(sheet);
      if (!ok) alert("解析失败：请确认前2-3列为 英文/中文/[可选IPA] 。");
    } catch (err) {
      console.error(err);
      alert("读取文件失败，请上传 .xlsx/.xls/.csv");
    }
  }

  function next() {
    const len = lengthForMode();
    const nextIndex = (current + 1) % (len || 1);
    setCurrent(nextIndex);
  }

  function onAnswer(option?: Option) {
    let isCorrect = false;

    if (mode === "eng2cn" || mode === "listening" || mode === "usage" || mode === "ipa") {
      if (!option) return;
      isCorrect = option.correct;
    } else if (mode === "cn2eng") {
      const card = cards[current];
      const expected = card.term.trim().toLowerCase();
      const ans = input.trim().toLowerCase();
      isCorrect = ans === expected;
    }

    setAttempted((v) => v + 1);
    if (isCorrect) setCorrectCount((v) => v + 1);
    else {
      if (mode === "usage") {
        const u = usageData[current];
        setMistakes((m) => [...m, { term: u?.q || "", cn: u ? u.options[u.answer] : "" }]);
      } else {
        const c = cards[current];
        setMistakes((m) => [...m, { term: c?.term || "", cn: c?.cn ? `${c.cn}${c.ipa ? ` ${c.ipa}` : ""}` : (c?.ipa || "") }]);
      }
    }
    setReveal(true);
  }

  // Keyboard shortcuts
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!mode) return;
      if (mode === "eng2cn" || mode === "listening" || mode === "usage" || mode === "ipa") {
        const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };
        if (map[e.key] != null) {
          const idx = map[e.key];
          const opt = options[idx];
          if (opt) onAnswer(opt);
        }
      } else if (mode === "cn2eng") {
        if (e.key === "Enter") onAnswer();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, options, input, current]);

  const card = cards[current];
  const accuracy = attempted ? Math.round((correctCount / attempted) * 100) : 100;

  // ===== UI =====
  return (
    <div className="w-full min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-semibold">QuizGPT · Flashcards</h1>
          <div className="flex flex-wrap items-center gap-2">
            <label className="px-3 py-2 rounded-xl border bg-white shadow-sm cursor-pointer">
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              上传词表（英文/中文/可选IPA）
            </label>
            <button className="px-3 py-2 rounded-xl border bg-white shadow-sm" onClick={() => { setCards(shuffleOn ? shuffle(sampleData729) : sampleData729); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]); }}>使用示例（7.29 词义/听力）</button>
            <button className="px-3 py-2 rounded-xl border bg-white shadow-sm" onClick={() => { setCards(shuffleOn ? shuffle(sampleData827) : sampleData827); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]); }}>使用示例（8.27 词义/读音）</button>
            <button className="px-3 py-2 rounded-xl border bg-white shadow-sm" onClick={() => { setMode("usage"); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]); }}>使用示例（用法题）</button>
            <button className="px-3 py-2 rounded-xl border bg-white shadow-sm" onClick={() => { setCards(shuffleOn ? shuffle(sampleData828) : sampleData828); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]); }}>使用示例（8.28 词义/读音）</button>
          </div>
        </header>

        <section className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-xs text-gray-500 mb-1">模式</div>
            <div className="flex flex-wrap gap-2">
              <button className={`px-3 py-1.5 rounded-full border ${mode === "eng2cn" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => { setMode("eng2cn"); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);} }>英 → 中</button>
              <button className={`px-3 py-1.5 rounded-full border ${mode === "cn2eng" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => { setMode("cn2eng"); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);} }>中 → 英（拼写）</button>
              <button className={`px-3 py-1.5 rounded-full border ${mode === "listening" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => { setMode("listening"); if (cards[current]?.term) speak(cards[current].term); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);} }>听力（TTS）</button>
              <button className={`px-3 py-1.5 rounded-full border ${mode === "ipa" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => { setMode("ipa"); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);} }>发音（选音标）</button>
              <button className={`px-3 py-1.5 rounded-full border ${mode === "usage" ? "bg-gray-900 text-white" : "bg-white"}`} onClick={() => { setMode("usage"); setCurrent(0); setAttempted(0); setCorrectCount(0); setMistakes([]);} }>用法（句子）</button>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-xs text-gray-500 mb-1">进度</div>
            <div className="text-sm">{current + 1} / {total}</div>
            <div className="mt-2 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gray-900" style={{ width: `${((current + 1) / total) * 100}%` }} />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white shadow-sm border">
            <div className="text-xs text-gray-500 mb-1">得分</div>
            <div className="text-sm">正确 {correctCount} / 尝试 {attempted}（准确率 {accuracy}%）</div>
            <div className="mt-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={shuffleOn} onChange={(e) => setShuffleOn(e.target.checked)} /> 随机顺序
              </label>
              <button className="px-3 py-1.5 rounded-full border" onClick={() => { const arr = shuffleOn ? shuffle(cards) : [...cards]; setCards(arr); setCurrent(0); }}>重排卡片</button>
            </div>
          </div>
        </section>

        {/* QUIZ CARD */}
        <main className="rounded-3xl bg-white border shadow-sm p-6 md:p-8">
          {!mode ? (
            <div className="text-center text-gray-600">选择一个模式开始：英→中 / 中→英 / 听力 / 发音（音标） / 用法（句子）。</div>
          ) : (
            <div className="space-y-6">
              <div className="text-sm text-gray-500">当前题目</div>

              {mode === "usage" ? (
                <div className="text-xl md:text-2xl font-semibold leading-relaxed">{usageData[current]?.q || ""}</div>
              ) : mode === "eng2cn" || mode === "listening" || mode === "ipa" ? (
                <div className="flex items-center gap-3">
                  <div className="text-2xl md:text-3xl font-semibold">{card?.term || ""}</div>
                  {mode === "listening" && (
                    <button className="px-3 py-1.5 rounded-full border" onClick={() => speak(card?.term || "")}>▶ 朗读</button>
                  )}
                </div>
              ) : (
                <div className="text-2xl md:text-3xl font-semibold">{card?.cn || "（无中文释义，直接拼写英文）"}</div>
              )}

              {/* Options or input */}
              {mode === "eng2cn" || mode === "listening" || mode === "usage" || mode === "ipa" ? (
                <div className="grid md:grid-cols-2 gap-3">
                  {options.slice(0, 4).map((opt, idx) => {
                    const state = reveal ? (opt.correct ? "border-emerald-500 bg-emerald-50" : "border-red-400 bg-red-50") : "";
                    return (
                      <button key={idx} className={`text-left px-4 py-3 rounded-2xl border hover:bg-gray-50 ${state}`} onClick={() => onAnswer(opt)} disabled={reveal}>
                        <div className="text-sm text-gray-500">{idx + 1}</div>
                        <div className="text-base">{opt.label || "（无中文释义）"}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="请输入英文拼写，回车提交" className="w-full md:w-2/3 px-4 py-3 rounded-2xl border focus:outline-none focus:ring-2 focus:ring-gray-900" onKeyDown={(e) => { if (e.key === "Enter") onAnswer(); }} />
                  <button className="px-4 py-3 rounded-2xl border" onClick={() => onAnswer()}>提交</button>
                </div>
              )}

              {/* Reveal */}
              {reveal && (
                <div className="p-4 rounded-2xl bg-gray-100 border">
                  <div className="text-sm text-gray-500 mb-1">正确答案</div>
                  <div className="text-lg space-y-1">
                    {mode === "usage" ? (
                      <>
                        <div className="font-semibold">{usageData[current]?.q}</div>
                        <div>→ {usageData[current]?.options[usageData[current]?.answer || 0]}</div>
                        {usageData[current]?.explain && (<div className="text-sm text-gray-600 mt-1">{usageData[current]?.explain}</div>)}
                      </>
                    ) : mode === "eng2cn" || mode === "listening" || mode === "ipa" ? (
                      <>
                        <div><span className="font-semibold">{card?.term}</span><span className="mx-2">→</span><span>{card?.cn || "（无中文释义）"}</span></div>
                        {card?.ipa && <div className="text-gray-600">IPA: <span className="font-mono">{card.ipa}</span></div>}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{card?.cn || "（无中文释义）"}</span>
                        <span className="mx-2">→</span>
                        <span>{card?.term}</span>
                        {card?.ipa && <div className="text-gray-600">IPA: <span className="font-mono">{card.ipa}</span></div>}
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-500">快捷键：选项题按 1/2/3/4；拼写题回车提交。</div>
                <div className="flex gap-2">
                  <button className="px-4 py-2 rounded-2xl border" onClick={() => { if (!reveal && mode === "usage") { const u = usageData[current]; setMistakes((m) => [...m, { term: u?.q || "", cn: u ? u.options[u.answer] : "" }]); } else if (!reveal) { const c = cards[current]; setMistakes((m) => [...m, { term: c?.term || "", cn: c?.cn || "" }]); } setReveal(true); }}>显示答案</button>
                  <button className="px-4 py-2 rounded-2xl border" onClick={next}>下一题</button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Mistakes */}
        <section className="mt-6">
          {mistakes.length > 0 && (
            <div className="p-4 rounded-2xl bg-white border shadow-sm">
              <div className="text-sm text-gray-500 mb-2">错题本（{mistakes.length}）</div>
              <div className="grid md:grid-cols-2 gap-2">
                {mistakes.slice(-12).map((m, i) => (
                  <div key={i} className="px-3 py-2 rounded-xl bg-gray-50 border">
                    <span className="font-medium">{m.term}</span>
                    <span className="mx-2">→</span>
                    <span className="text-gray-700">{m.cn || ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Help */}
        <footer className="mt-8 text-sm text-gray-500 leading-6">
          <div className="font-medium text-gray-700 mb-1">使用说明</div>
          <ol className="list-decimal ml-5 space-y-1">
            <li>支持上传 <code>.xlsx/.csv</code>（前2-3列=英文/中文/可选IPA）。</li>
            <li>“听力（TTS）”可朗读单词；“发音（音标）”模式会就 IPA 进行四选一测试。</li>
            <li>示例按钮可一键载入 7.29 / 8.27 / 8.28 的样例词库进行练习。</li>
            <li>“用法（句子）”题库已结合你 8.26/8.27/8.28 的词，练搭配与语法。</li>
          </ol>
        </footer>
      </div>
    </div>
  );
}
