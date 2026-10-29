// Turns a card (word × skill) into a question the screen can show, and checks the answer.
//
//   meaning    see 你好            -> pick the meaning among 4
//   listening  hear nǐ hǎo         -> pick the characters among 4 (sound-alikes)
//   recall     see "hello"         -> pick the characters among 4 (look-alikes)
//   pinyin     see 你好            -> type the pinyin with tones
//   write      hear the word       -> write it on paper, then mark yourself
//
// Wrong choices are chosen to be tempting but never ambiguous: two words that mean
// the same thing (二 / 两) are never offered together for meaning or recall, and two
// words that sound exactly the same (他 / 她) are never offered together for listening.

import { charsOf } from "./lexicon.js";
import { checkPinyin, syllables, toMarks, toneOf } from "./pinyin.js";

// Characters often confused by learners (only those present in the dictionary are used).
export const LOOKALIKES = [
  "人入八", "大太天夫犬", "人大个", "日目白百自", "己已巳", "王玉主五", "午牛年", "土士", "未末来", "买卖",
  "问间门们", "找我", "贵员", "今会令", "几九儿", "千干", "万方", "东车", "见贝", "刀力办",
  "么公", "七匕比", "这文", "他她也", "姐妹", "喝渴", "请情", "识只", "吗妈马码玛", "十千",
  "二三", "口回", "小少", "生先", "们门", "上下", "左右", "期朋", "汉没", "饭钱",
].map((g) => new Set(g));

/** Deterministic random numbers (mulberry32), so a question can be replayed exactly. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- when are two words "the same answer"? ----------

// The separate meanings of a gloss: "Hello! How are you?" → hello · how are you.
// "to rain" counts as "rain" (雨 / 下雨 must never be offered against each other).
const coreOf = (en) =>
  en.toLowerCase().replace(/\(.*?\)/g, "").split(/[;,!?]/).map((x) => x.trim().replace(/^to /, "")).filter(Boolean);
// Same meaning, or one is a kind of the other: "student" / "university student", "phone" / "mobile phone".
const sameItem = (x, y) => x === y || x.endsWith(" " + y) || y.endsWith(" " + x);
const parenOf = (en) => (en.match(/\(.*?\)/g) ?? []).join(" ").toLowerCase();

/** True if some sense of `a` and some sense of `b` mean the same ("two" / "two", "Chinese" / "Chinese (language)"). */
export function sameMeaning(a, b) {
  for (const sa of a.senses) {
    for (const sb of b.senses) {
      const ca = coreOf(sa.en);
      if (!coreOf(sb.en).some((x) => ca.some((y) => sameItem(x, y)))) continue;
      const pa = parenOf(sa.en);
      const pb = parenOf(sb.en);
      if (pa && pb && pa !== pb) continue; // "you (singular)" vs "you (plural)": different
      return true;
    }
  }
  return false;
}

/** Looser: any shared meaning at all, even "you (singular)" / "you (honorific)". */
export function sameCoreMeaning(a, b) {
  return a.senses.some((sa) => b.senses.some((sb) => coreOf(sa.en).some((x) => coreOf(sb.en).some((y) => sameItem(x, y)))));
}

export const sameSound = (a, b) => a.variants.some((x) => b.variants.includes(x));

// ---------- similarity scores ----------

function charSimilarity(a, b, chars) {
  if (a === b) return 1;
  if (LOOKALIKES.some((g) => g.has(a) && g.has(b))) return 0.9;
  const pa = new Set([...(chars[a]?.components ?? []), chars[a]?.radical].filter(Boolean));
  const pb = new Set([...(chars[b]?.components ?? []), chars[b]?.radical].filter(Boolean));
  if (!pa.size || !pb.size) return 0;
  const shared = [...pa].filter((x) => pb.has(x)).length;
  return (0.6 * shared) / new Set([...pa, ...pb]).size;
}

function looksAlike(a, b, chars) {
  const ca = charsOf(a.hanzi);
  const cb = charsOf(b.hanzi);
  let score = ca.length === cb.length ? 1 : -0.5 * Math.abs(ca.length - cb.length);
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) score += charSimilarity(ca[i], cb[i], chars);
  score += 0.5 * ca.filter((c) => cb.includes(c)).length; // shares a character anywhere
  return score;
}

const INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
const splitSyllable = (s) => {
  const ini = INITIALS.find((i) => s.startsWith(i)) ?? "";
  return [ini, s.slice(ini.length)];
};

function soundsAlike(a, b) {
  const sa = syllables(a.numbered);
  const sb = syllables(b.numbered);
  let score = sa.length === sb.length ? 1 : -0.7 * Math.abs(sa.length - sb.length);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i].letters === sb[i].letters) score += 1; // same syllable, other tone: 买 / 卖
    else {
      const [ia, fa] = splitSyllable(sa[i].letters);
      const [ib, fb] = splitSyllable(sb[i].letters);
      if (ia === ib) score += 0.4;
      if (fa === fb) score += 0.4;
    }
  }
  return score;
}

function meaningAlike(a, b) {
  const pa = new Set(a.senses.flatMap((s) => s.pos));
  const pos = b.senses.some((s) => s.pos.some((p) => pa.has(p))) ? 1 : 0;
  return pos + 0.5 * (1 - Math.min(15, Math.abs(a.lesson - b.lesson)) / 15);
}

// ---------- choosing wrong answers ----------

const OUTSIDE_BOOKS = 1000; // lesson of a word that is in no book (see lexicon.js)
const MAX_CANDIDATES = 400;

/**
 * Up to `n` wrong answers for `word`. Candidates come from the lessons up to `maxLesson`
 * (widened to the whole dictionary if too few), proper nouns only with proper nouns.
 */
export function distractors(word, skill, { lexicon, rng = Math.random, maxLesson = word.lesson, n = 3 }) {
  const all = [...lexicon.words.values()].filter((w) => w.key !== word.key && w.hanzi !== word.hanzi);
  const allowed = (w) => {
    if (skill === "listening") return !sameSound(w, word);
    return !sameMeaning(w, word);
  };
  const score = (w) => {
    const base = skill === "listening" ? soundsAlike(word, w) : skill === "recall" ? looksAlike(word, w, lexicon.chars) : meaningAlike(word, w);
    return base + (w.kind === word.kind ? 1 : -2) + rng() * 0.6;
  };
  // up to the learner's lesson, and at least up to this word's lesson (a 1B lesson studied
  // while the daily plan is on 1A still gets 1B wrong answers)
  let near = all.filter((w) => w.lesson <= Math.max(maxLesson, word.lesson));
  // a word from the HSK list only (no book): wrong answers from its own HSK level
  if (word.lesson >= OUTSIDE_BOOKS && word.hsk) {
    const level = near.filter((w) => w.hsk === word.hsk);
    if (level.length >= 20) near = level;
  }
  // a big level (HSK 6: 1,800 words): a random part of it is enough, and keeps each question fast
  if (near.length > MAX_CANDIDATES) near = shuffle(near, rng).slice(0, MAX_CANDIDATES);
  let pool = near.filter(allowed);
  if (pool.length < n) pool = all.filter(allowed);
  const picked = [];
  for (const w of pool.map((w) => ({ w, s: score(w) })).sort((x, y) => y.s - x.s)) {
    // the wrong answers must also differ from each other
    if (picked.some((p) => p.hanzi === w.w.hanzi || (skill === "meaning" && sameMeaning(p, w.w)))) continue;
    picked.push(w.w);
    if (picked.length === n) break;
  }
  return picked;
}

export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- the question ----------

const meaningLabel = (w) => ({
  en: w.senses.map((s) => s.en).join(" / "),
  fr: w.senses.map((s) => s.fr).filter(Boolean).join(" / "),
});

/** Everything shown after answering: the full card of the word. */
export function revealOf(word, lexicon) {
  return {
    key: word.key,
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    speak: word.speak,
    senses: word.senses.map(({ en, fr, pos }) => ({ en, fr, pos })),
    // each tip: its text, and its parts with the pinyin of the Chinese in it ([text, pinyin|null])
    tips: [...new Map(word.senses.filter((s) => s.tip).map((s) => [s.tip, { text: s.tip, parts: s.tipParts ?? [[s.tip, null]] }])).values()],
    characters: charsOf(word.hanzi).map((c) => ({ char: c, pinyin: lexicon.chars[c]?.pinyin ?? [], note: lexicon.chars[c]?.note ?? "" })),
  };
}

/**
 * For each accepted variant, the normal tones of the character behind each syllable
 * (so 谢谢 typed xièxiè is accepted, with a note that the book writes it light).
 * Only when syllables and characters line up one to one (not with erhua).
 */
function fullTonesOf(word, lexicon) {
  const withOptional = charsOf(word.hanzi);
  const without = charsOf(word.hanzi.replace(/\(.*?\)/g, ""));
  return word.variants.map((v) => {
    const n = v.split(" ").length;
    const chars = withOptional.length === n ? withOptional : without.length === n ? without : null;
    return chars ? chars.map((c) => (lexicon.chars[c]?.pinyin ?? []).map(toneOf)) : null;
  });
}

/**
 * Build the question for a session item {key, skill}.
 * opts: {lexicon, rng, maxLesson}  maxLesson = highest lesson the learner has reached
 * (wrong answers are taken from what they know when possible).
 */
export function makeQuestion({ key, skill }, { lexicon, rng = Math.random, maxLesson } = {}) {
  const word = lexicon.words.get(key);
  if (!word) throw new Error(`unknown word: ${key}`);
  const reveal = revealOf(word, lexicon);
  const base = { key, skill, reveal };
  const ml = Math.max(maxLesson ?? word.lesson, word.lesson);

  if (skill === "pinyin") {
    return { ...base, kind: "typed", prompt: { hanzi: word.hanzi }, accept: word.variants, fullTones: fullTonesOf(word, lexicon) };
  }
  if (skill === "write") {
    return { ...base, kind: "self", prompt: { speak: word.speak } };
  }
  const wrong = distractors(word, skill, { lexicon, rng, maxLesson: ml });
  const options = shuffle([word, ...wrong], rng);
  const answerIndex = options.indexOf(word);
  if (skill === "meaning") {
    return { ...base, kind: "choice", prompt: { hanzi: word.hanzi }, choices: options.map((w) => ({ key: w.key, ...meaningLabel(w) })), answerIndex };
  }
  const choices = options.map((w) => ({ key: w.key, hanzi: w.hanzi }));
  if (skill === "listening") return { ...base, kind: "choice", prompt: { speak: word.speak }, choices, answerIndex };
  if (skill === "recall") return { ...base, kind: "choice", prompt: meaningLabel(word), choices, answerIndex };
  throw new Error(`unknown skill: ${skill}`);
}

/**
 * Check an answer. choice: the index picked; typed: the text; self: {selfGrade}.
 * Returns {correct, ...details} — pass it (with ms) to session.answer().
 */
export function checkAnswer(question, answer) {
  if (question.kind === "choice") {
    return { correct: answer === question.answerIndex, correctIndex: question.answerIndex };
  }
  if (question.kind === "typed") return checkPinyin(String(answer ?? ""), question.accept, question.fullTones);
  if (question.kind === "self") return { correct: answer.selfGrade > 1, selfGrade: answer.selfGrade };
  throw new Error(`unknown question kind: ${question.kind}`);
}

export { toMarks };
