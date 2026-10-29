// Exams: a different paper every time (from a seed), with a score per section.
// - Hanyu: on a book (or some lessons), built from the lesson words and the lesson texts.
// - HSK: on one or more HSK levels, built from the words of those levels (no HSK sentences
//   in the app yet, so only word questions: listening, vocabulary, writing).
//
// Every item is built so that only one answer is right:
// - sentence meanings never offer two lines that say the same thing or look almost alike;
// - "choose the reply" only uses who/what/where/how-many… questions, and the wrong replies
//   answer a different kind of question (a place for a "what", a number for a "who"…);
// - fill-in-the-blank shows the English of the sentence, so a word that would also fit
//   grammatically is still wrong in meaning;
// - word order accepts the book's order, and also the time word moved in front of / after
//   the subject (中午你… / 你中午…);
// - measure words only offer wrong ones that really don't go with the noun.

import { charsOf } from "./lexicon.js";
import { makeQuestion, distractors, sameCoreMeaning, shuffle, revealOf } from "./questions.js";
import { checkPinyin, toMarks, syllables } from "./pinyin.js";

export const EXAM_SECTIONS = [
  { id: "listening", title: "Listening", parts: [["hear-word", 5], ["hear-sentence", 5], ["hear-reply", 5]] },
  { id: "vocabulary", title: "Vocabulary", parts: [["pinyin-to-hanzi", 5], ["tones", 5], ["measure-word", 5]] },
  { id: "reading", title: "Reading and grammar", parts: [["fill-blank", 5], ["word-order", 5], ["read-sentence", 5]] },
  { id: "writing", title: "Writing", parts: [["type-pinyin", 5], ["dictation", 10]] },
];

// HSK paper: word questions only, 50 items
export const HSK_SECTIONS = [
  { id: "listening", title: "Listening", parts: [["hear-word", 10]] },
  { id: "vocabulary", title: "Vocabulary", parts: [["read-word", 10], ["recall-word", 5], ["pinyin-to-hanzi", 5], ["tones", 5]] },
  { id: "writing", title: "Writing", parts: [["type-pinyin", 5], ["dictation", 10]] },
];

export const INSTRUCTIONS = {
  "read-word": "Choose what this word means.",
  "recall-word": "Choose the characters for this meaning.",
  "hear-word": "Listen and choose the characters you hear.",
  "hear-sentence": "Listen to the sentence and choose what it means.",
  "hear-reply": "Listen to the question and choose the right answer.",
  "pinyin-to-hanzi": "Choose the characters for this pinyin.",
  tones: "Choose the right pinyin, with the right tones.",
  "measure-word": "Choose the right measure word.",
  "fill-blank": "Choose the word that completes the sentence.",
  "word-order": "Put the words in order to make the sentence.",
  "read-sentence": "Read the sentence and choose what it means.",
  "type-pinyin": "Type the pinyin, with tones.",
  dictation: "Listen, write the characters on paper, then check yourself.",
};

// Kinds of questions, by the question word they use (first match wins).
const QUESTION_KINDS = [
  ["price", /多少钱|怎么卖/], ["day", /星期几/], ["country", /哪国/], ["which", /哪(个|辆|位)/],
  ["place", /哪儿|哪里/], ["who", /谁/], ["name", /名字|贵姓/], ["color", /颜色/], ["or", /还是/],
  ["quantity", /几|多少/], ["how", /怎么样/], ["what", /什么/],
];
// Replies that fit almost any question: never offered as a wrong answer, never asked for.
export const GENERIC_REPLIES = new Set(["不知道", "不是", "是", "对", "好", "很好", "谢谢", "谢谢您", "不客气", "没什么", "没关系", "对不起"]);
const TIME_WORDS = new Set(["中午", "下午", "上午", "今天", "明天", "昨天", "最近"]);
// Fill-in-the-blank only hides content words: little words (不, 很, 也, 吗…) are often
// not visible in a natural English translation, so the blank would be ambiguous.
// Measure words are not blanked either (一个/一家公司 are both right): they have their own part.
const BLANK_POS = new Set(["名", "动", "形", "代", "数"]);
// Words that translate the same in many sentences ("It's…"): never offered against each other.
const NEAR_PAIRS = [["这", "那"], ["这儿", "那儿"], ["这些", "那些"]];
const nearPair = (a, b) => NEAR_PAIRS.some((p) => p.includes(a) && p.includes(b));
const PRONOUNS = new Set(["我", "你", "他", "她", "我们", "你们", "他们", "您"]);
const NUMERAL = /^[零一二两三四五六七八九十百千万]+$/;

const isCJK = (c) => c >= "一" && c <= "鿿";
const cjkOf = (s) => [...s].filter(isCJK).join("");
const normEn = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const plainWord = (w) => w.kind === "word" && !/[…(（]/.test(w.hanzi);

/** Kind of a question word question (price, day, place…); null for any other line. */
export function questionKind(zh) {
  if (!/[？?]\s*$/.test(zh)) return null;
  return QUESTION_KINDS.find(([, re]) => re.test(zh))?.[0] ?? null;
}

/** Overlap of the characters of two lines (0..1). */
export function overlap(a, b) {
  const A = new Set(cjkOf(a));
  const B = new Set(cjkOf(b));
  const inter = [...A].filter((c) => B.has(c)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

/** All spoken lines of the chosen lessons, each knowing the line that answers it. */
export function linesOf(texts, lessons) {
  const out = [];
  for (const L of texts.lessons) {
    if (lessons && !lessons.includes(L.lesson)) continue;
    for (const P of L.parts) {
      P.items.forEach((it, i) => {
        if (it.type !== "line") return;
        const next = P.items[i + 1];
        out.push({ ...it, lesson: L.lesson, part: P.part, reply: next?.type === "line" && next.speaker !== it.speaker ? next : null });
      });
    }
  }
  return out;
}

/**
 * Splits Chinese text into dictionary words (longest match). Characters that are not in
 * the dictionary stay together (黑板 is one piece, not 黑 + 板).
 */
export function makeSegmenter(lexicon) {
  const forms = new Map();
  let maxLen = 1;
  for (const w of lexicon.words.values()) {
    for (const f of [w.speak, w.hanzi.replace(/\(.*?\)/g, "")]) {
      if (!f || [...f].some((c) => !isCJK(c))) continue;
      if (!forms.has(f) || w.kind === "word") forms.set(f, w.key);
      maxLen = Math.max(maxLen, f.length);
    }
  }
  return (text) => {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (!isCJK(text[i])) {
        out.push({ text: text[i], key: null, punct: true });
        i += 1;
        continue;
      }
      let len = Math.min(maxLen, text.length - i);
      while (len > 1 && !forms.has(text.slice(i, i + len))) len -= 1;
      const t = text.slice(i, i + len);
      const prev = out.at(-1);
      const unknown = !forms.has(t);
      if (unknown && prev && !prev.key && !prev.punct) prev.text += t;
      else out.push({ text: t, key: forms.get(t) ?? null });
      i += len;
    }
    return out;
  };
}

/**
 * Word-order item for one sentence without punctuation inside: tiles in a shuffled order,
 * and the accepted answers (the sentence, the time word moved around the subject, and the
 * other correct orders listed for it in the pack: `also`, from the line's `orders`).
 * Returns null if the sentence is too short/long or can't be shuffled.
 */
export function makeOrderItem(body, segment, rng, { min = 4, max = 8, also = [] } = {}) {
  if (!body || [...body].some((c) => !isCJK(c))) return null;
  // a number is one tile: 二十一 split into 二 / 十 / 一 could also be built as 十二一 or 一十二
  const tokens = [];
  for (const { text } of segment(body)) {
    if (NUMERAL.test(text) && NUMERAL.test(tokens.at(-1) ?? "")) tokens[tokens.length - 1] += text;
    else tokens.push(text);
  }
  if (tokens.length < min || tokens.length > max) return null;
  const accept = [tokens.join("")];
  if ((TIME_WORDS.has(tokens[0]) && PRONOUNS.has(tokens[1])) || (PRONOUNS.has(tokens[0]) && TIME_WORDS.has(tokens[1]))) {
    accept.push([tokens[1], tokens[0], ...tokens.slice(2)].join(""));
  }
  const sameChars = (a) => [...a].sort().join("") === [...body].sort().join("");
  for (const a of also ?? []) if (sameChars(a) && !accept.includes(a)) accept.push(a);
  let order = shuffle(tokens.map((_, i) => i), rng);
  for (let k = 0; k < 10 && accept.includes(order.map((i) => tokens[i]).join("")); k++) order = shuffle(order, rng);
  if (accept.includes(order.map((i) => tokens[i]).join(""))) return null;
  return { tiles: order.map((i) => tokens[i]), accept };
}

/** Check a word-order answer: the tile indexes in the order the learner put them. */
export function checkOrder(item, indexes) {
  const text = (indexes ?? []).map((i) => item.tiles[i]).join("");
  return { correct: item.accept.includes(text), expected: item.accept[0] };
}

const sentenceReveal = (line) => ({ zh: line.zh, pinyin: line.pinyin, en: line.en, fr: line.fr, lesson: line.lesson });

// ---------- one builder per part; each returns an item or null (not enough material) ----------

function sentenceChoices(line, pool, rng) {
  const wrong = shuffle(pool, rng)
    .filter((o) => cjkOf(o.zh) !== cjkOf(line.zh) && normEn(o.en) !== normEn(line.en) && overlap(o.zh, line.zh) < 0.6)
    .sort((a, b) => Math.abs(cjkOf(a.zh).length - cjkOf(line.zh).length) - Math.abs(cjkOf(b.zh).length - cjkOf(line.zh).length));
  const picked = [];
  for (const o of wrong) {
    if (picked.some((p) => normEn(p.en) === normEn(o.en) || cjkOf(p.zh) === cjkOf(o.zh))) continue;
    picked.push(o);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  const options = shuffle([line, ...picked], rng);
  return { choices: options.map((o) => ({ en: o.en, fr: o.fr })), answerIndex: options.indexOf(line) };
}

const BUILDERS = {
  "hear-word": (ctx) => wordItem(ctx, "listening", (w) => plainWord(w)),
  "read-word": (ctx) => wordItem(ctx, "meaning", (w) => plainWord(w)),
  "recall-word": (ctx) => wordItem(ctx, "recall", (w) => plainWord(w)),
  "type-pinyin": (ctx) => wordItem(ctx, "pinyin", (w) => plainWord(w)),
  // a word with a same-sounding twin (支 / 只 …) can't be dictated without context
  dictation: (ctx) => wordItem(ctx, "write", (w) => plainWord(w) && !ctx.homophones.has(w.key)),

  "pinyin-to-hanzi": (ctx) => {
    const w = takeWord(ctx, (x) => plainWord(x));
    if (!w) return null;
    const wrong = distractors(w, "listening", { lexicon: ctx.lexicon, rng: ctx.rng, maxLesson: ctx.maxLesson });
    if (wrong.length < 3) return null;
    const options = shuffle([w, ...wrong], ctx.rng);
    return { kind: "choice", prompt: { pinyin: toMarks(w.variants[0], { joined: true }) }, choices: options.map((o) => ({ key: o.key, hanzi: o.hanzi })), answerIndex: options.indexOf(w), reveal: revealOf(w, ctx.lexicon) };
  },

  tones: (ctx) => {
    const w = takeWord(ctx, (x) => plainWord(x) && syllables(x.variants[0]).length <= 3 && syllables(x.variants[0]).some((s) => s.tone !== 5));
    if (!w) return null;
    const syl = syllables(w.variants[0]);
    // every way to change the tones of the toned syllables, closest first
    let options = [syl];
    syl.forEach((s, i) => {
      if (s.tone === 5) return;
      options = options.flatMap((o) => [1, 2, 3, 4].map((t) => o.map((x, k) => (k === i ? { ...x, tone: t } : x))));
    });
    const asText = (o) => o.map((x) => x.letters + x.tone).join(" ");
    const changed = (o) => o.filter((x, i) => x.tone !== syl[i].tone).length;
    const wrong = shuffle(options, ctx.rng)
      .filter((o) => changed(o) > 0 && !checkPinyin(asText(o), w.variants).correct)
      .sort((a, b) => changed(a) - changed(b));
    const labels = new Set([toMarks(w.variants[0], { joined: true })]);
    const picked = [];
    for (const o of wrong) {
      const label = toMarks(asText(o), { joined: true });
      if (labels.has(label)) continue;
      labels.add(label);
      picked.push(label);
      if (picked.length === 3) break;
    }
    if (picked.length < 3) return null;
    const right = toMarks(w.variants[0], { joined: true });
    const choices = shuffle([right, ...picked], ctx.rng);
    return { kind: "choice", prompt: { hanzi: w.hanzi }, choices: choices.map((pinyin) => ({ pinyin })), answerIndex: choices.indexOf(right), reveal: revealOf(w, ctx.lexicon) };
  },

  "measure-word": (ctx) => {
    const byHanzi = new Map([...ctx.lexicon.words.values()].map((w) => [w.hanzi, w]));
    const pairs = shuffle(ctx.measureWords?.pairs ?? [], ctx.rng).filter((p) => {
      const n = byHanzi.get(p.noun);
      return n && n.lesson <= ctx.maxLesson && !ctx.usedNouns.has(p.noun);
    });
    const p = pairs[0];
    if (!p) return null;
    ctx.usedNouns.add(p.noun);
    const right = p.measures[0];
    // 个 is never offered as a wrong answer: in speech it goes with almost anything
    const wrong = shuffle(ctx.measureWords.measures.filter((m) => !p.measures.includes(m) && m !== "个"), ctx.rng).slice(0, 3);
    const number = ["一", "两", "三", "五"][Math.floor(ctx.rng() * 4)];
    const choices = shuffle([right, ...wrong], ctx.rng);
    const noun = byHanzi.get(p.noun);
    return {
      kind: "choice",
      prompt: { before: number, after: p.noun },
      choices: choices.map((hanzi) => ({ hanzi })),
      answerIndex: choices.indexOf(right),
      accepted: p.measures, // other measure words that also go with this noun
      reveal: { ...revealOf(noun, ctx.lexicon), example: `${number}${right}${p.noun}` },
    };
  },

  "hear-sentence": (ctx) => {
    const line = takeLine(ctx, (l) => cjkOf(l.zh).length >= 4 && !/\d/.test(l.zh));
    if (!line) return null;
    const c = sentenceChoices(line, ctx.lines, ctx.rng);
    return c && { kind: "choice", prompt: { speak: line.speak ?? line.zh }, ...c, reveal: sentenceReveal(line) };
  },

  "read-sentence": (ctx) => {
    const line = takeLine(ctx, (l) => cjkOf(l.zh).length >= 4);
    if (!line) return null;
    const c = sentenceChoices(line, ctx.lines, ctx.rng);
    return c && { kind: "choice", prompt: { zh: line.zh }, ...c, reveal: sentenceReveal(line) };
  },

  "hear-reply": (ctx) => {
    const generic = (r) => cjkOf(r.zh).length < 3 || GENERIC_REPLIES.has(cjkOf(r.zh));
    const pairs = ctx.lines.filter((l) => l.reply && questionKind(l.zh) && !generic(l.reply));
    const q = takeLine(ctx, (l) => pairs.includes(l));
    if (!q) return null;
    const kind = questionKind(q.zh);
    // wrong replies answer another kind of question, from another lesson (another topic)
    const wrong = shuffle(pairs.filter((p) => questionKind(p.zh) !== kind && p.lesson !== q.lesson && cjkOf(p.reply.zh) !== cjkOf(q.reply.zh)), ctx.rng);
    const picked = [];
    for (const p of wrong) {
      if (picked.some((x) => cjkOf(x.zh) === cjkOf(p.reply.zh) || questionKind(x.from) === questionKind(p.zh))) continue;
      picked.push({ ...p.reply, from: p.zh });
      if (picked.length === 3) break;
    }
    if (picked.length < 3) return null;
    const options = shuffle([q.reply, ...picked], ctx.rng);
    return {
      kind: "choice",
      prompt: { speak: q.speak ?? q.zh },
      choices: options.map((o) => ({ zh: o.zh, pinyin: o.pinyin })),
      answerIndex: options.indexOf(q.reply),
      reveal: { question: sentenceReveal(q), answer: sentenceReveal({ ...q.reply, lesson: q.lesson }) },
    };
  },

  "fill-blank": (ctx) => {
    for (let tries = 0; tries < 20; tries++) {
      const line = takeLine(ctx, (l) => cjkOf(l.zh).length >= 4 && !/\d/.test(l.zh));
      if (!line) return null;
      const tokens = ctx.segment(line.zh);
      const candidates = tokens
        .map((t, i) => ({ t, i, w: t.key && ctx.lexicon.words.get(t.key) }))
        .filter(({ t, w }) => w && plainWord(w) && w.lesson <= ctx.maxLesson && tokens.filter((x) => x.text === t.text).length === 1)
        .filter(({ w }) => w.senses.some((s) => s.pos.some((p) => BLANK_POS.has(p))));
      if (!candidates.length) continue;
      const { t, i, w } = candidates[Math.floor(ctx.rng() * candidates.length)];
      const pos = new Set(w.senses.flatMap((s) => s.pos));
      const pool = [...ctx.lexicon.words.values()]
        // stricter than elsewhere: 你 / 您 both fit "Welcome, Professor Wang", so not offered together
        .filter((o) => plainWord(o) && o.key !== w.key && o.lesson <= ctx.maxLesson && !line.zh.includes(o.speak) && !sameCoreMeaning(o, w) && !nearPair(o.speak, t.text))
        .map((o) => ({ o, s: (o.senses.some((s) => s.pos.some((p) => pos.has(p))) ? 1 : 0) + (charsOf(o.speak).length === charsOf(t.text).length ? 1 : 0) + ctx.rng() }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.o);
      const picked = [];
      for (const o of pool) {
        if (picked.some((p) => sameCoreMeaning(p, o) || p.speak === o.speak)) continue;
        picked.push(o);
        if (picked.length === 3) break;
      }
      if (picked.length < 3) continue;
      const options = shuffle([{ key: w.key, hanzi: t.text }, ...picked.map((o) => ({ key: o.key, hanzi: o.speak }))], ctx.rng);
      return {
        kind: "choice",
        prompt: { before: tokens.slice(0, i).map((x) => x.text).join(""), after: tokens.slice(i + 1).map((x) => x.text).join(""), en: line.en, fr: line.fr },
        choices: options,
        answerIndex: options.findIndex((o) => o.key === w.key),
        reveal: { ...sentenceReveal(line), word: revealOf(w, ctx.lexicon) },
      };
    }
    return null;
  },

  "word-order": (ctx) => {
    for (let tries = 0; tries < 30; tries++) {
      const line = takeLine(ctx, (l) => !/\d/.test(l.zh));
      if (!line) return null;
      const body = line.zh.replace(/[。？！?!.]+$/, "");
      const o = makeOrderItem(body, ctx.segment, ctx.rng, { also: line.orders }); // one sentence, 4 to 8 words
      if (!o) continue;
      return {
        kind: "order",
        prompt: { tiles: o.tiles, en: line.en, fr: line.fr, end: line.zh.slice(body.length) },
        accept: o.accept,
        reveal: sentenceReveal(line),
      };
    }
    return null;
  },
};

function takeWord(ctx, ok) {
  const w = ctx.words.find((x) => !ctx.usedWords.has(x.key) && ok(x));
  if (w) ctx.usedWords.add(w.key);
  return w ?? null;
}

function wordItem(ctx, skill, ok) {
  const w = takeWord(ctx, ok);
  if (!w) return null;
  const q = makeQuestion({ key: w.key, skill }, { lexicon: ctx.lexicon, rng: ctx.rng, maxLesson: ctx.maxLesson });
  const { key, skill: s, ...rest } = q;
  return { ...rest, record: { key, skill: s } };
}

function takeLine(ctx, ok) {
  const l = ctx.lines.find((x) => !ctx.usedLines.has(x) && ok(x));
  if (l) ctx.usedLines.add(l);
  return l ?? null;
}

/**
 * Build an exam.
 * @param lexicon, texts, measureWords   data (buildLexicon, texts.json, measure-words.json)
 * @param rng        seededRandom(seed): the same seed gives the same paper
 * @param lessons    lessons covered (default: all)
 * @param keys       words covered instead of lessons (HSK exam), with `levels` kept as its label
 * @param prefer     word keys to use first (e.g. engine.weakest()), so the exam checks weak points
 */
export function buildExam({ lexicon, texts = { lessons: [] }, measureWords, rng, seed = null, lessons = null, keys = null, levels = null, prefer = [], sections = keys ? HSK_SECTIONS : EXAM_SECTIONS }) {
  const lines = keys ? [] : linesOf(texts, lessons);
  const inScope = keys
    ? [...new Set(keys)].map((k) => lexicon.words.get(k)).filter(Boolean)
    : [...lexicon.words.values()].filter((w) => !lessons || lessons.includes(w.lesson));
  const scope = new Set(inScope);
  // how many words share each sound: a word whose sound another word has is a homophone
  const sounds = new Map();
  for (const w of lexicon.words.values()) for (const v of new Set(w.variants)) sounds.set(v, (sounds.get(v) ?? 0) + 1);
  const preferred = [...new Set(prefer)].map((k) => lexicon.words.get(k)).filter((w) => w && scope.has(w));
  const pref = new Set(preferred);
  const ctx = {
    lexicon, rng, measureWords,
    maxLesson: Math.max(...inScope.map((w) => w.lesson), 1),
    words: [...shuffle(preferred, rng), ...shuffle(inScope.filter((w) => !pref.has(w)), rng)],
    lines: shuffle(lines, rng),
    segment: makeSegmenter(lexicon),
    homophones: new Set(inScope.filter((w) => w.variants.some((v) => sounds.get(v) > 1)).map((w) => w.key)),
    usedWords: new Set(), usedLines: new Set(), usedNouns: new Set(),
  };
  const items = [];
  for (const section of sections) {
    for (const [type, count] of section.parts) {
      for (let n = 0; n < count; n++) {
        // a word that can't make this question (支 with two accepted tones…): the next one is tried
        let item = null;
        for (let tries = 0; tries < 5 && !item; tries++) item = BUILDERS[type](ctx);
        if (item) items.push({ section: section.id, type, instruction: INSTRUCTIONS[type], ...item });
      }
    }
  }
  return { seed, lessons, levels, items };
}

/** Check one exam answer: choice = index, typed = text, self = {selfGrade}, order = tile indexes. */
export function checkExamAnswer(item, answer) {
  if (item.kind === "order") return checkOrder({ tiles: item.prompt.tiles, accept: item.accept }, answer);
  if (item.kind === "choice") return { correct: answer === item.answerIndex, correctIndex: item.answerIndex };
  if (item.kind === "typed") return checkPinyin(String(answer ?? ""), item.accept, item.fullTones);
  if (item.kind === "self") return { correct: (answer?.selfGrade ?? 1) > 1, selfGrade: answer?.selfGrade ?? 1 };
  throw new Error(`unknown item kind: ${item.kind}`);
}

/** Score: overall and per section. results[i] = checkExamAnswer(...) or null if skipped. */
export function scoreExam(exam, results) {
  const sections = {};
  let correct = 0;
  let total = 0;
  let skipped = 0;
  exam.items.forEach((it, i) => {
    // a question with sound skipped ("can't listen now"): not in the score at all
    if (results[i]?.skipped) return void (skipped += 1);
    total += 1;
    const s = (sections[it.section] ??= { correct: 0, total: 0 });
    s.total += 1;
    if (results[i]?.correct) {
      s.correct += 1;
      correct += 1;
    }
  });
  return { correct, total, skipped, percent: total ? Math.round((100 * correct) / total) : 0, sections };
}
