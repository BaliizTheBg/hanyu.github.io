// Conversation mode: each dialogue of the book becomes a unit you climb level by level.
//
//   listen    hear the whole dialogue, line by line, with pinyin and translation
//   shadow    repeat each line right after the voice (you mark yourself)
//   reply     you are one of the speakers: hear the other's line, choose what you answer
//   build     put the words of your lines in order
//   roleplay  the app plays the others; you see the English of your line and say it in Chinese
//   vary      the same role-play with details changed (another drink, place, country, colour…)
//
// The classroom phrases (book pp.12-15) are two more units: what the teacher says (listen,
// shadow, meaning) and what students say (listen, shadow, meaning, build, roleplay).

import { makeSegmenter, makeOrderItem, checkOrder, questionKind, overlap, GENERIC_REPLIES } from "./exam.js";
import { shuffle } from "./questions.js";

export const LEVELS = {
  listen: { skill: "dlg-listen", title: "Listen and understand", pass: 0 },
  shadow: { skill: "dlg-shadow", title: "Repeat after the voice", pass: 0.8 },
  reply: { skill: "dlg-reply", title: "Choose your reply", pass: 0.8 },
  meaning: { skill: "dlg-meaning", title: "What does it mean?", pass: 0.8 },
  build: { skill: "dlg-build", title: "Build your sentences", pass: 0.8 },
  roleplay: { skill: "dlg-roleplay", title: "Play your role", pass: 0.8 },
  vary: { skill: "dlg-vary", title: "Change the details", pass: 0.8 },
};
const DIALOGUE_LEVELS = ["listen", "shadow", "reply", "build", "roleplay", "vary"];
const CLASSROOM = {
  teacher: { label: "老师", pinyin: "Lǎoshī", title: { zh: "教师课堂用语", pinyin: "Jiàoshī kètáng yòngyǔ", en: "Classroom Chinese: what the teacher says", fr: "En classe : ce que dit le professeur" }, levels: ["listen", "shadow", "meaning"] },
  student: { label: "学生", pinyin: "Xuésheng", title: { zh: "学生课堂用语", pinyin: "Xuésheng kètáng yòngyǔ", en: "Classroom Chinese: what students say", fr: "En classe : ce que disent les étudiants" }, levels: ["listen", "shadow", "meaning", "build", "roleplay"] },
};
// Characters too common to show that two lines are about the same thing.
const COMMON = new Set("我你他她您们是的了吗呢吧不也很一个这那都有在去啊");
const ANSWERED = new Set(["shadow", "reply", "meaning", "build", "say"]);

// the word splitter is built once per dictionary
const segmenters = new WeakMap();
function segmenterOf(lexicon) {
  if (!segmenters.has(lexicon)) segmenters.set(lexicon, makeSegmenter(lexicon));
  return segmenters.get(lexicon);
}

const isCJK = (c) => c >= "一" && c <= "鿿";
const cjk = (s) => [...s].filter(isCJK).join("");
const linesOf = (unit) => unit.items.filter((it) => it.type === "line");

/** All conversation units of a book pack (texts.json): its dialogues, then the classroom phrases. */
export function listUnits(texts) {
  const pack = texts.pack;
  const units = [];
  for (const L of texts.lessons) {
    for (const P of L.parts) {
      const lines = P.items.filter((it) => it.type === "line");
      const labels = [...new Set(lines.map((l) => l.speaker))];
      if (lines.length < 2 || labels.length < 2) continue;
      const speakers = labels.map((label, voice) => ({ label, pinyin: lines.find((l) => l.speaker === label).speakerPinyin, voice }));
      units.push({
        id: `${pack}:${L.lesson}.${P.part}`,
        kind: "dialogue",
        lesson: L.lesson,
        part: P.part,
        title: P.title ?? { zh: L.zh, pinyin: L.pinyin, en: L.en, fr: L.fr },
        speakers,
        items: P.items.map((it) => (it.type === "line" ? { ...it, speak: it.speak ?? it.zh, voice: labels.indexOf(it.speaker) } : { ...it })),
        levels: DIALOGUE_LEVELS,
      });
    }
  }
  for (const who of ["teacher", "student"]) {
    const c = CLASSROOM[who];
    const phrases = texts.classroom?.[who] ?? [];
    if (!phrases.length) continue;
    units.push({
      id: `${pack}:classroom-${who}`,
      kind: "phrases",
      lesson: 0,
      title: c.title,
      speakers: [{ label: c.label, pinyin: c.pinyin, voice: 0 }],
      items: phrases.map((p) => ({ type: "line", speaker: c.label, speakerPinyin: c.pinyin, zh: p.zh, pinyin: p.pinyin, en: p.en, fr: p.fr, speak: p.speak, numbered: p.numbered, orders: p.orders, voice: 0 })),
      levels: c.levels,
    });
  }
  return units;
}

/** The speaker with the most lines (default role). */
export function defaultRole(unit) {
  const count = new Map();
  for (const l of linesOf(unit)) count.set(l.speaker, (count.get(l.speaker) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------- the "change the details" level ----------

// a word as a whole word in pinyin or English ("tea" not inside "teacher"), any case
const asWord = (word) => new RegExp(`(?<![\\p{L}\\p{M}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{M}])`, "giu");
const keepCase = (found, repl) => (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase() ? repl[0].toUpperCase() + repl.slice(1) : repl);
const countWord = (text, word) => (text.match(asWord(word)) ?? []).length;
const replaceWord = (text, word, repl) => text.replace(asWord(word), (found) => keepCase(found, repl));

/** Positions where a Chinese word starts and ends as whole words (茶 in 茶叶 doesn't count). */
function wholeWordAt(zh, word, segment) {
  const starts = new Set();
  const ends = new Set();
  let pos = 0;
  for (const t of segment(zh)) {
    starts.add(pos);
    pos += t.text.length;
    ends.add(pos);
  }
  const hits = [];
  for (let i = zh.indexOf(word); i >= 0; i = zh.indexOf(word, i + 1)) if (starts.has(i) && ends.has(i + word.length)) hits.push(i);
  return hits;
}

/**
 * Swaps for one run of a dialogue: up to `max` words, each from a different class, replaced
 * everywhere in the dialogue (Chinese, pinyin, English) by a word of the same class that the
 * dialogue doesn't already use. A swap is only kept when every line it touches can be fully updated.
 */
export function planSwaps(unit, substitutions, segment, rng, { max = 2, role = null } = {}) {
  const lines = linesOf(unit);
  const allZh = lines.map((l) => l.zh).join("");
  const times = (l, w) => wholeWordAt(l.zh, w.zh, segment).length;
  // a word can be swapped out when it is in the dialogue, none of its tied words is
  // (去邮局寄信 → 去银行寄信 would make no sense), and every line that has it says it as often
  // in pinyin and in English as in Chinese, so all three change together
  const canGo = (w) => {
    const touched = lines.filter((l) => times(l, w));
    return touched.length > 0 && !(w.with ?? []).some((t) => allZh.includes(t)) &&
      touched.every((l) => countWord(l.en, w.en) === times(l, w) && countWord(l.pinyin, w.pinyin) === times(l, w));
  };
  const yours = (w) => lines.some((l) => l.speaker === role && times(l, w));
  const classes = [];
  for (const [cls, members] of Object.entries(substitutions.classes)) {
    const into = members.filter((m) => !allZh.includes(m.zh) && !(m.not ?? []).some((t) => allZh.includes(t)));
    const out = members.filter(canGo);
    if (out.length && into.length) classes.push({ cls, out, into });
  }
  // words in your own lines first, so the change is something you say
  return shuffle(classes, rng)
    .sort((a, b) => b.out.some(yours) - a.out.some(yours))
    .slice(0, max)
    .map(({ cls, out, into }) => ({ cls, from: shuffle(out, rng).sort((a, b) => yours(b) - yours(a))[0], to: into[Math.floor(rng() * into.length)] }));
}

function swapIn(zh, from, to, segment) {
  for (const i of wholeWordAt(zh, from.zh, segment).reverse()) zh = zh.slice(0, i) + to.zh + zh.slice(i + from.zh.length);
  return zh;
}

function applySwaps(line, swaps, segment) {
  let { zh, pinyin, en, speak } = line;
  let changed = false;
  for (const { from, to } of swaps) {
    if (!wholeWordAt(zh, from.zh, segment).length) continue;
    zh = swapIn(zh, from, to, segment);
    speak = swapIn(speak, from, to, segment);
    pinyin = replaceWord(pinyin, from.pinyin, to.pinyin);
    en = replaceWord(en, from.en, to.en);
    changed = true;
  }
  if (!changed) return line;
  // French and numbered pinyin are not rewritten: dropped for changed lines
  return { ...line, zh, pinyin, en, speak, fr: null, numbered: undefined, varied: true };
}

// ---------- the "choose your reply" level ----------

// Wrong replies are answers to "question word" questions of other lessons (什么, 哪儿, 多少…),
// chosen so that none of them could also be a fair reply:
//   to a question word question: answers to another kind of question
//   to a yes/no question or "…呢？": answers of any kind
//   to anything else (hello, thanks, a statement): answers about a price, a day, a quantity or a colour
// and in every case:
//   never a kind the line hints at: after "六块。" a reply like "来五个吧。" (I'll take five) or
//   "蓝的。" (the blue one) would make sense, so neither is offered;
//   never an exchange on the same subject (shopping, food, days, names): after "你吃什么？",
//   "来杯茶吧！" (from "tea or coffee?") would make sense too.
const SAME_KIND = { what: "what", which: "what" }; // "what do you want" ≈ "which one do you want"
const AFTER_STATEMENT = new Set(["price", "day", "quantity", "color"]);
const CUES = [
  { re: /钱|块|毛|元|贵|便宜|买|卖|换/, kinds: ["price", "quantity", "color", "which", "what"], subject: true },
  { re: /吃|喝|要|来|茶|咖啡|饭/, kinds: ["quantity", "what", "which", "price", "or"], subject: true },
  { re: /今天|明天|昨天|星期/, kinds: ["day"], subject: true },
  { re: /叫|姓|名字|你好|您好|认识/, kinds: ["name", "country"], subject: true },
  { re: /去|在|住|回|到/, kinds: ["place"] },
  { re: /国|人/, kinds: ["country"] },
  { re: /颜色|的/, kinds: ["color", "which"] },
  { re: /谁|老师|朋友/, kinds: ["who"] },
  { re: /这|那|是/, kinds: ["what", "which", "who"] },
  { re: /有|忙|难|好|累|大|小|多|重|新|旧|身体|工作|怎么样|还是/, kinds: ["how", "or", "quantity"] },
];
const hinted = (zh) => new Set(CUES.filter((c) => c.re.test(zh)).flatMap((c) => c.kinds));
const sameSubject = (a, b) => CUES.some((c) => c.subject && c.re.test(a) && c.re.test(b));
const isQuestion = (zh) => /[？?]\s*$/.test(zh);

function topicChars(s) {
  return new Set([...cjk(s)].filter((c) => !COMMON.has(c)));
}

/** Answers to question word questions, in other dialogues: [{reply, from, kind, lesson}]. */
function replyPool(units) {
  const pool = [];
  for (const u of units) {
    if (u.kind !== "dialogue") continue;
    u.items.forEach((it, i) => {
      const prev = u.items[i - 1];
      if (it.type !== "line" || prev?.type !== "line" || prev.speaker === it.speaker) return;
      const kind = questionKind(prev.zh);
      if (kind) pool.push({ reply: it, from: prev, kind, lesson: u.lesson });
    });
  }
  return pool;
}

/** The 4 choices for one turn, or null when this turn can't be asked without ambiguity. */
function replyChoices(answer, prompt, pool, rng) {
  if (isQuestion(answer.zh) && !isQuestion(prompt.zh)) return null; // a new topic: anything could come next
  const kind = questionKind(prompt.zh);
  const hints = hinted(prompt.zh);
  const fits = kind ? (k) => (SAME_KIND[k] ?? k) !== (SAME_KIND[kind] ?? kind) : isQuestion(prompt.zh) ? () => true : (k) => AFTER_STATEMENT.has(k);
  const allowed = (k) => fits(k) && !hints.has(k);
  const avoid = new Set([...topicChars(prompt.zh), ...topicChars(answer.zh)]);
  const len = cjk(answer.zh).length;
  const ok = ({ reply, from, kind: k }) => {
    const t = cjk(reply.zh);
    return allowed(k) && t.length >= 2 && t !== cjk(answer.zh) && !GENERIC_REPLIES.has(t) && !/[\d/…(（]/.test(reply.zh) &&
      ![...topicChars(reply.zh)].some((c) => avoid.has(c)) && overlap(from.zh, prompt.zh) < 0.5 && !sameSubject(prompt.zh, from.zh + reply.zh);
  };
  const picked = [];
  for (const { reply } of shuffle(pool.filter(ok), rng).sort((a, b) => Math.abs(cjk(a.reply.zh).length - len) - Math.abs(cjk(b.reply.zh).length - len))) {
    if (picked.some((p) => cjk(p.zh) === cjk(reply.zh) || [...topicChars(reply.zh)].some((c) => topicChars(p.zh).has(c)))) continue;
    picked.push(reply);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  const options = shuffle([answer, ...picked], rng);
  return { choices: options.map((o) => ({ zh: o.zh, pinyin: o.pinyin })), answerIndex: options.indexOf(answer) };
}

function meaningChoices(line, pool, rng) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const picked = [];
  for (const l of shuffle(pool, rng)) {
    if (norm(l.en) === norm(line.en) || picked.some((p) => norm(p.en) === norm(l.en))) continue;
    picked.push(l);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  const options = shuffle([line, ...picked], rng);
  return { choices: options.map((o) => ({ en: o.en, fr: o.fr })), answerIndex: options.indexOf(line) };
}

// ---------- building a level ----------

/**
 * The steps of one level of one unit, for the chosen role.
 * ctx: {lexicon, units (all units, for wrong replies), substitutions, rng, maxLesson}
 * Step types: scene · line (listen) · shadow · reply · meaning · build · say.
 * An empty `steps` means the level doesn't apply to this role (e.g. no line long enough to build).
 */
export function buildLevel(unit, level, { role = defaultRole(unit), lexicon, units = [], substitutions = null, rng = Math.random, maxLesson = unit.lesson } = {}) {
  if (!unit.levels.includes(level)) throw new Error(`level ${level} not available for ${unit.id}`);
  const segment = (level === "build" || level === "vary") && segmenterOf(lexicon);
  const lines = linesOf(unit);
  const script = { unitId: unit.id, level, role, title: LEVELS[level].title, pass: LEVELS[level].pass, steps: [] };
  const S = script.steps;

  if (level === "listen") {
    for (const it of unit.items) S.push(it.type === "scene" ? { type: "scene", zh: it.zh, en: it.en, fr: it.fr } : { type: "line", ...it });
  } else if (level === "shadow") {
    for (const l of lines) S.push({ ...l, type: "shadow" });
  } else if (level === "meaning") {
    const others = units.filter((u) => u.id !== unit.id).flatMap(linesOf);
    for (const l of lines) {
      const c = meaningChoices(l, lines.length >= 4 ? lines.filter((x) => x !== l) : others, rng);
      if (c) S.push({ type: "meaning", line: l, prompt: { speak: l.speak, voice: l.voice }, ...c });
    }
  } else if (level === "reply") {
    const all = replyPool(units).filter((p) => p.lesson !== unit.lesson);
    const known = all.filter((p) => p.lesson <= Math.max(maxLesson, unit.lesson));
    const pool = known.length >= 20 ? known : all; // early lessons: not enough yet, take from the whole book
    unit.items.forEach((it, i) => {
      const prev = unit.items[i - 1];
      if (it.type !== "line" || it.speaker !== role || prev?.type !== "line" || prev.speaker === role) return;
      const c = replyChoices(it, prev, pool, rng);
      const k = lines.indexOf(it);
      if (c) S.push({ type: "reply", line: it, prompt: { ...prev }, context: lines.slice(Math.max(0, k - 3), k), ...c });
    });
  } else if (level === "build") {
    for (const l of lines.filter((x) => x.speaker === role)) {
      if (/[\d/…]/.test(l.zh)) continue;
      for (const sentence of l.zh.split(/[，。？！、；]/).filter(Boolean)) {
        const o = makeOrderItem(sentence, segment, rng, { min: 3, max: 9, also: l.orders });
        if (o) S.push({ type: "build", line: l, sentence, tiles: o.tiles, accept: o.accept });
      }
    }
  } else if (level === "roleplay" || level === "vary") {
    let items = unit.items;
    if (level === "vary") {
      if (!substitutions) return script;
      const swaps = planSwaps(unit, substitutions, segment, rng, { role });
      items = unit.items.map((it) => (it.type === "line" ? applySwaps(it, swaps, segment) : it));
      if (!items.some((it) => it.type === "line" && it.varied && it.speaker === role)) return script; // nothing changes in your lines
      script.changes = swaps.map(({ cls, from, to }) => ({ kind: cls, from: { zh: from.zh, en: from.en }, to: { zh: to.zh, en: to.en } }));
    }
    for (const it of items) {
      if (it.type === "scene") S.push({ type: "scene", zh: it.zh, en: it.en, fr: it.fr });
      else if (it.speaker === role) S.push({ type: "say", line: it, prompt: { en: it.en, fr: it.fr } });
      else S.push({ type: "line", ...it });
    }
  }
  return script;
}

/** Levels of a unit that have something to do for this role. */
export function levelsFor(unit, role, ctx) {
  return unit.levels.filter((lv) => buildLevel(unit, lv, { ...ctx, role }).steps.length > 0);
}

/**
 * Check one step's answer.
 * reply / meaning: choice index · build: tile indexes · shadow / say: {selfGrade: 1 (not yet) | 3 (got it)}
 */
export function checkStep(step, answer) {
  if (step.type === "reply" || step.type === "meaning") return { correct: answer === step.answerIndex, correctIndex: step.answerIndex };
  if (step.type === "build") return checkOrder(step, answer);
  if (step.type === "shadow" || step.type === "say") return { correct: (answer?.selfGrade ?? 1) > 1, selfGrade: answer?.selfGrade ?? 1 };
  return { correct: true }; // line, scene: nothing to answer
}

/** Score of a finished level. results[i] = checkStep(...) for each step (null if skipped). */
export function scoreLevel(script, results) {
  const asked = script.steps.map((s, i) => [s, results[i]]).filter(([s]) => ANSWERED.has(s.type));
  if (!asked.length) return { answered: 0, correct: 0, score: 1, passed: true };
  const correct = asked.filter(([, r]) => r?.correct).length;
  const score = correct / asked.length;
  return { answered: asked.length, correct, score, passed: score >= script.pass };
}
