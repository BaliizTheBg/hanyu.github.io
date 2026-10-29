// A study session: an ordered queue of items. Builds the queue (warm-up, reviews,
// new words) and runs it, bringing mistakes back 3 cards later, then 10, then at the end.

import { CORE_SKILLS, SOUND_SKILLS } from "./skills.js";
import { NEW, AGAIN } from "./cards.js";
import { wordStatus, recallChance } from "./progress.js";
import { endOfStudyDay } from "./time.js";

// Where each step of a new word lands in the new-word stream (word i starts at 3*i),
// so the four questions about a word are spread out instead of asked in a row.
const NEW_WORD_OFFSETS = { intro: 0, meaning: 4, listening: 8, pinyin: 13, recall: 19 };

/** Avoid two items about the same word in a row, without asking a new word before its intro. */
function spreadOut(items) {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    if (out[i].key !== out[i - 1].key) continue;
    const introduced = new Set(out.slice(0, i).filter((x) => x.type === "intro").map((x) => x.key));
    for (let j = i + 1; j < out.length; j++) {
      const c = out[j];
      if (c.key === out[i - 1].key) continue;
      if (c.type === "intro" || c.reason !== "new" || introduced.has(c.key)) {
        out.splice(i, 0, ...out.splice(j, 1));
        break;
      }
    }
  }
  return out;
}

function inScope(path, lessons) {
  if (!lessons) return null;
  return new Set(path.filter((p) => lessons.includes(p.lesson)).map((p) => p.key));
}

/** Cards due by the end of today for these skills, weakest first. */
function dueCards(cards, now, { skills, scope, dayStartHour }) {
  const end = endOfStudyDay(now, dayStartHour);
  return [...cards.values()]
    .filter((c) => skills.includes(c.skill) && c.state !== NEW && c.due <= end && (!scope || scope.has(c.key)))
    .sort((a, b) => recallChance(a, now) - recallChance(b, now) || a.due - b.due);
}

/**
 * Queue for a normal session.
 * - warm-up: the `warmup` weakest due cards first (yesterday's struggles)
 * - then new words (intro card + 4 questions, spread out) mixed with the other due cards
 */
export function planSession({ path, cards, now, newCount = 0, maxReviews = 300, warmup = 10, lessons = null, dayStartHour = 4 }) {
  const scope = inScope(path, lessons);
  const due = dueCards(cards, now, { skills: CORE_SKILLS, scope, dayStartHour })
    .slice(0, maxReviews)
    .map((c) => ({ type: "ask", key: c.key, skill: c.skill, reason: "review" }));

  const fresh = path.filter((p) => (!scope || scope.has(p.key)) && wordStatus(cards, p.key) === "new").slice(0, newCount);
  const stream = [];
  fresh.forEach((p, i) => {
    stream.push({ t: 3 * i, i, item: { type: "intro", key: p.key } });
    for (const skill of CORE_SKILLS) {
      stream.push({ t: 3 * i + NEW_WORD_OFFSETS[skill], i, item: { type: "ask", key: p.key, skill, reason: "new" } });
    }
  });
  stream.sort((a, b) => a.t - b.t || a.i - b.i);

  const items = due.slice(0, warmup);
  const reviews = due.slice(warmup);
  const news = stream.map((x) => x.item);
  while (reviews.length || news.length) {
    for (let k = 0; k < 2 && news.length; k++) items.push(news.shift());
    if (reviews.length) items.push(reviews.shift());
  }
  return spreadOut(items);
}

/**
 * Queue for a dictation session (hear the word, write it on paper, mark yourself):
 * due dictation cards first, then words already started but never dictated, in path order.
 */
export function planDictation({ path, cards, now, count = 20, lessons = null, dayStartHour = 4 }) {
  const scope = inScope(path, lessons);
  const due = dueCards(cards, now, { skills: ["write"], scope, dayStartHour }).map((c) => c.key);
  const dueSet = new Set(due);
  const fresh = path
    .filter((p) => (!scope || scope.has(p.key)) && !dueSet.has(p.key))
    .filter((p) => !cards.has(`${p.key}#write`) && wordStatus(cards, p.key) !== "new")
    .map((p) => p.key);
  return [...due, ...fresh].slice(0, count).map((key) => ({ type: "ask", key, skill: "write", reason: "dictation" }));
}

/**
 * Runs a queue. `answerFn(key, skill, result)` records the answer and returns {card, grade}.
 * A question missed `maxMisses` times in one session is not brought back again in that
 * session (it is already due in the next one), so a session always ends.
 */
export class Session {
  constructor(items, answerFn, { gaps = [3, 10], maxMisses = 3 } = {}) {
    this.queue = items.map((x) => ({ ...x }));
    this.pos = 0;
    this.answerFn = answerFn;
    this.gaps = gaps;
    this.maxMisses = maxMisses;
    this.stats = { asked: 0, correct: 0, streak: 0, bestStreak: 0 };
  }

  get current() {
    return this.queue[this.pos] ?? null;
  }

  get done() {
    return this.pos >= this.queue.length;
  }

  get remaining() {
    return this.queue.length - this.pos;
  }

  /** Move past an intro card (a new word being shown, nothing to answer). */
  next() {
    if (this.current?.type !== "intro") throw new Error("the current item is a question: call answer()");
    this.pos += 1;
  }

  /** Answer the current question. result = {correct, ms} or {selfGrade} for dictation. */
  async answer(result) {
    const item = this.current;
    if (!item || item.type !== "ask") throw new Error("no question to answer");
    const out = await this.answerFn(item.key, item.skill, result);
    const correct = out.grade > AGAIN;
    const s = this.stats;
    s.asked += 1;
    if (correct) {
      s.correct += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.streak = 0;
    }
    this.pos += 1;
    const misses = (item.misses ?? 0) + (correct ? 0 : 1);
    if (!correct) {
      if (misses < this.maxMisses) this.#insert({ ...item, retry: 0, misses }, this.gaps[0]);
    } else if (item.retry === 0) this.#insert({ ...item, retry: 1 }, this.gaps[1]);
    else if (item.retry === 1) this.queue.push({ ...item, retry: 2 });
    return { ...out, correct };
  }

  /**
   * "Can't listen now": the questions that need sound (the current one included) leave this
   * session. They are not answered, so nothing counts as wrong and they stay due for later.
   * @returns how many questions were left out
   */
  dropSound() {
    const before = this.queue.length;
    this.queue = [...this.queue.slice(0, this.pos), ...this.queue.slice(this.pos).filter((x) => !(x.type === "ask" && SOUND_SKILLS.includes(x.skill)))];
    return before - this.queue.length;
  }

  #insert(item, gap) {
    this.queue.splice(Math.min(this.pos + gap, this.queue.length), 0, item);
  }
}
