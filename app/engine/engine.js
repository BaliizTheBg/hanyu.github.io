// The memory engine: one object the app talks to. It keeps the cards in memory for
// speed and writes every answer to the on-device store immediately, so quitting
// in the middle of a session never loses anything.

import { applyAnswer, newCard, cardId, gradeOf, NEW, REVIEW, RELEARNING } from "./cards.js";
import { CORE_SKILLS, CONVERSATION_SKILLS } from "./skills.js";
import { wordStatus, wordStrength, recallChance, firstSeen, streakDays, dailyNewQuota, examIntervalCap } from "./progress.js";
import { planSession, planDictation, Session } from "./session.js";
import { shuffle } from "./questions.js";
import { mergeReviews, replay, buildExport, checkExport } from "./sync.js";
import { scoreExam } from "./exam.js";
import { LEVELS, scoreLevel } from "./conversation.js";
import { dayNumber, endOfStudyDay, DAY } from "./time.js";
import { missedWords } from "./missed.js";

export const DEFAULT_SETTINGS = Object.freeze({
  retention: 0.9, // target chance of remembering at each review
  dayStartHour: 4, // a study day runs from 4 am to 4 am
  newPerDay: 20, // used when no exam date is set
  examDate: null, // 'YYYY-MM-DD'
  reserveDays: 1, // days before the exam kept for review only
  warmup: 10, // weakest cards asked first in each session
  voice: null, // the chosen voice's name (null = the best one installed, see voice.js)
  speechRate: 1, // normal reading speed (slow = 60% of it)
  planBooks: ["hj-1a"], // the books the daily plan covers (1A, 1B or both), chosen in Me
});

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Array.from({ length: 32 }, () => ((Math.random() * 16) | 0).toString(16)).join("");

/**
 * @param store  openIdbStore() in the app, createMemoryStore() in tests
 * @param path   ordered words to learn: [{key, lesson, pack}] (see path.js)
 * @param now    clock (injected so tests can travel in time)
 */
export async function createEngine({ store, path: startPath, now = () => Date.now() }) {
  let path = startPath; // changes when the learner moves on to the next book (setPath)
  let settings = { ...DEFAULT_SETTINGS, ...((await store.getMeta("settings")) ?? {}) };
  let deviceId = await store.getMeta("deviceId");
  if (!deviceId) {
    deviceId = uid();
    await store.setMeta("deviceId", deviceId);
  }
  let activeDays = (await store.getMeta("activeDays")) ?? [];
  let exams = (await store.getMeta("exams")) ?? [];
  // "start over": answers and exams from before this time are gone, on every synced device
  let resetAt = (await store.getMeta("resetAt")) ?? 0;
  const cards = new Map((await store.loadCards()).map((c) => [c.id, c]));

  const optsAt = (time) => ({
    retention: settings.retention,
    maxIntervalDays: examIntervalCap(settings.examDate, time, settings.dayStartHour),
  });

  // changes to the progress run one after the other: an answer given while a sync is
  // merging waits for the merge, instead of being wiped by it
  let queue = Promise.resolve();
  const oneAtATime = (fn) => (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => {});
    return run;
  };

  let missedCache = null; // "words to fix" (missed.js), worked out again after any change
  const answer = oneAtATime(async (key, skill, result, { mode = "practice" } = {}) => {
    missedCache = null;
    const time = now();
    const grade = gradeOf(result, skill);
    const card = applyAnswer(cards.get(cardId(key, skill)) ?? newCard(key, skill), grade, time, optsAt(time));
    const review = { id: `${deviceId}-${uid()}`, deviceId, key, skill, grade, time, ms: result.ms ?? null, mode };
    const meta = {};
    const day = dayNumber(time, settings.dayStartHour);
    if (!activeDays.includes(day)) meta.activeDays = [...activeDays, day].sort((a, b) => a - b);
    await store.commit(card, review, meta);
    missedCache = null; // (again: a list read during the write is not kept)
    cards.set(card.id, card);
    if (meta.activeDays) activeDays = meta.activeDays;
    return { card, grade };
  });

  const saveExam = oneAtATime(async (summary) => {
    exams = [...exams, summary];
    await store.setMeta("exams", exams);
  });

  function plan() {
    const t = now();
    const unseen = path.filter((p) => wordStatus(cards, p.key) === "new").length;
    const q = dailyNewQuota({ unseen, examDate: settings.examDate, now: t, dayStartHour: settings.dayStartHour, reserveDays: settings.reserveDays, defaultPerDay: settings.newPerDay });
    const startOfToday = endOfStudyDay(t, settings.dayStartHour) - DAY;
    const introducedToday = path.filter((p) => firstSeen(cards, p.key) >= startOfToday).length;
    // the quota is fixed for the day: computed on the words still unseen this morning
    const morning = dailyNewQuota({ unseen: unseen + introducedToday, examDate: settings.examDate, now: t, dayStartHour: settings.dayStartHour, reserveDays: settings.reserveDays, defaultPerDay: settings.newPerDay });
    return { ...q, newPerDay: morning.newPerDay, unseen, introducedToday, newLeftToday: Math.max(0, morning.newPerDay - introducedToday) };
  }

  return {
    get deviceId() {
      return deviceId;
    },
    get settings() {
      return { ...settings };
    },
    get path() {
      return path;
    },

    /** The words to learn change (another book chosen); progress is kept per word. */
    setPath(newPath) {
      path = newPath;
    },

    async setSettings(patch) {
      settings = { ...settings, ...patch };
      missedCache = null; // the study day may have changed
      await store.setMeta("settings", settings);
      return { ...settings };
    },

    /** The card of one word × skill (a blank one if never answered). */
    card(key, skill) {
      return cards.get(cardId(key, skill)) ?? newCard(key, skill);
    },

    status: (key) => wordStatus(cards, key),

    answer,

    plan,

    /**
     * A normal session: warm-up, due reviews, and today's new words (or `newCount`).
     * `words`: another word list than the daily plan's (a lesson of a book not in the plan).
     */
    session({ newCount, lessons = null, maxReviews = 300, words = path } = {}) {
      const items = planSession({
        path: words, cards, now: now(), lessons, maxReviews,
        newCount: newCount ?? plan().newLeftToday,
        warmup: settings.warmup, dayStartHour: settings.dayStartHour,
      });
      return new Session(items, (k, s, r) => answer(k, s, r, { mode: "session" }));
    },

    /** A dictation session (self-marked). */
    dictation({ count = 20, lessons = null, words = path } = {}) {
      const items = planDictation({ path: words, cards, now: now(), count, lessons, dayStartHour: settings.dayStartHour });
      return new Session(items, (k, s, r) => answer(k, s, r, { mode: "dictation" }));
    },

    /**
     * Teacher mode: like the teacher in class, `count` words drawn at random from a list
     * (e.g. HSK 1 words 1-200: pathFromHsk(hsk).filter(w => w.n <= 200).map(w => w.key)),
     * each asked once in a random way among `skills` (["write"] = a dictation).
     * The answers count for the words like any other answer.
     */
    teacher({ keys, count = 20, skills = CORE_SKILLS, rng = Math.random }) {
      const items = shuffle([...new Set(keys)], rng)
        .slice(0, count)
        .map((key) => ({ type: "ask", key, skill: skills[Math.floor(rng() * skills.length)], reason: "teacher" }));
      return new Session(items, (k, s, r) => answer(k, s, r, { mode: "teacher" }));
    },

    /** "Words I keep missing": every word still on the list (see missed.js), the most missed first. */
    async missed() {
      // kept between screens; any new answer, import or reset works it out again
      missedCache ??= missedWords(await store.allReviews(), { dayStartHour: settings.dayStartHour });
      return missedCache;
    },

    /**
     * Practice the missed words: each asked once, in the skill it was last missed in
     * (a word missed in a dictation is dictated again). `count` words at most, the most missed first.
     */
    async missedPractice({ count = 20, keep = () => true } = {}) {
      const items = (await this.missed()).filter((w) => keep(w.key)).slice(0, count)
        .map((w) => ({ type: "ask", key: w.key, skill: [...CORE_SKILLS, "write"].includes(w.skill) ? w.skill : "meaning", reason: "missed" }));
      return new Session(items, (k, s, r) => answer(k, s, r, { mode: "missed" }));
    },

    /** Every word of the path with its status and strength (for the word wall). */
    words() {
      const t = now();
      return path.map((p) => ({ ...p, status: wordStatus(cards, p.key), strength: wordStrength(cards, p.key, t) }));
    },

    /** Highest lesson the learner has started (wrong choices are taken up to there). */
    reachedLesson() {
      return Math.max(1, ...path.filter((p) => wordStatus(cards, p.key) !== "new").map((p) => p.lesson ?? 1));
    },

    /** The `n` weakest cards already studied. */
    weakest(n = 20) {
      const t = now();
      return [...cards.values()]
        .filter((c) => c.state !== NEW && CORE_SKILLS.includes(c.skill))
        .map((c) => ({ key: c.key, skill: c.skill, chance: recallChance(c, t), lapses: c.lapses }))
        .sort((a, b) => a.chance - b.chance)
        .slice(0, n);
    },

    async stats() {
      const t = now();
      const counts = { new: 0, learning: 0, mastered: 0 };
      for (const p of path) counts[wordStatus(cards, p.key)] += 1;
      const end = endOfStudyDay(t, settings.dayStartHour);
      const dueToday = [...cards.values()].filter((c) => c.state !== NEW && CORE_SKILLS.includes(c.skill) && c.due <= end).length;
      const today = (await store.reviewsSince(end - DAY)).filter((r) => !CONVERSATION_SKILLS.includes(r.skill)); // word answers only
      return {
        total: path.length,
        ...counts,
        dueToday,
        answersToday: today.length,
        correctToday: today.filter((r) => r.grade > 1).length,
        streak: streakDays(activeDays, t, settings.dayStartHour),
      };
    },

    /**
     * Save a finished mock exam. Word items (hear a word, type pinyin, dictation) also count
     * as answers for that word, so a word missed in the exam comes back in the sessions.
     * results[i] = checkExamAnswer(...) (optionally with .ms), null if skipped.
     */
    async recordExam(exam, results) {
      for (let i = 0; i < exam.items.length; i++) {
        const it = exam.items[i];
        const r = results[i];
        if (!it.record || !r || r.skipped) continue;
        const res = it.record.skill === "write" ? { selfGrade: r.selfGrade } : { correct: r.correct, ms: r.ms };
        await answer(it.record.key, it.record.skill, res, { mode: "exam" });
      }
      const summary = { id: `${deviceId}-${uid()}`, time: now(), seed: exam.seed, lessons: exam.lessons, ...(exam.levels ? { levels: exam.levels } : {}), ...scoreExam(exam, results) };
      if (summary.total) await saveExam(summary); // every question skipped: no score to keep
      return summary;
    },

    /**
     * Save a finished conversation level. Each level of each dialogue is one card
     * ("dlg:<unit id>" × level skill): passed = a right answer, so it comes back for review
     * later; not passed = a wrong one, to try again. results[i] = checkStep(...) per step.
     */
    async recordLevel(script, results) {
      if (!script.steps.length) throw new Error(`nothing to play in ${script.unitId} ${script.level}`);
      const score = scoreLevel(script, results);
      // steps with sound skipped ("can't listen now"): the level is not saved, passed or not
      if (results.some((r) => r?.skipped)) return { ...score, skipped: true };
      const { card } = await answer(`dlg:${script.unitId}`, LEVELS[script.level].skill, { correct: score.passed }, { mode: "conversation" });
      return { ...score, due: card.due };
    },

    /**
     * The levels of one dialogue (or the ones available for a role: pass levelsFor(...)),
     * each with: passed (ever passed), open (first level, or the one before is passed),
     * due (passed, and time to play it again today), tries.
     */
    conversationProgress(unit, levels = unit.levels) {
      const end = endOfStudyDay(now(), settings.dayStartHour);
      let open = true;
      return levels.map((level) => {
        const c = cards.get(cardId(`dlg:${unit.id}`, LEVELS[level].skill));
        const passed = !!c && (c.state === REVIEW || c.state === RELEARNING);
        const row = { level, title: LEVELS[level].title, passed, open, due: passed && c.due <= end, tries: c?.reps ?? 0 };
        open = passed;
        return row;
      });
    },

    /** Past mock exams, oldest first. */
    examHistory() {
      return exams.map((e) => ({ ...e }));
    },

    /** Backup / transfer file (plain object, ready for JSON.stringify). */
    async exportData() {
      return { ...buildExport({ deviceId, settings, reviews: await store.allReviews(), now: now() }), exams, resetAt };
    },

    /**
     * Merge a backup (or another device's file) into this device: union of the two
     * review logs, then every card is rebuilt. Importing the same file twice changes nothing.
     */
    importData: oneAtATime(async (data, { takeSettings = false, fillGoals = false } = {}) => {
      missedCache = null;
      checkExport(data);
      // the latest "start over" wins, from whichever device it came
      resetAt = Math.max(resetAt, Number(data.resetAt) || 0);
      const merged = mergeReviews(await store.allReviews(), data.reviews).filter((r) => r.time > resetAt);
      if (takeSettings && data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
      // a progress file added by hand (Me) also brings the learner's goals when this device has
      // not set its own: the exam date and the books of the daily plan (the voice stays per device)
      else if (fillGoals && data.settings) {
        const goals = {};
        if (!settings.examDate && data.settings.examDate) goals.examDate = data.settings.examDate;
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (same(settings.planBooks, DEFAULT_SETTINGS.planBooks) && Array.isArray(data.settings.planBooks) && !same(data.settings.planBooks, settings.planBooks)) goals.planBooks = data.settings.planBooks;
        settings = { ...settings, ...goals };
      }
      const rebuilt = replay(merged, optsAt, settings.dayStartHour);
      const examById = new Map([...exams, ...(Array.isArray(data.exams) ? data.exams : [])].map((e) => [e.id, e]));
      exams = [...examById.values()].filter((e) => e.time > resetAt).sort((a, b) => a.time - b.time);
      await store.replaceAll({ cards: [...rebuilt.cards.values()], reviews: merged, meta: { activeDays: rebuilt.activeDays, settings, exams, resetAt } });
      cards.clear();
      for (const [id, c] of rebuilt.cards) cards.set(id, c);
      activeDays = rebuilt.activeDays;
      missedCache = null; // (also at the end: a list read during the import is not kept)
      return { reviews: merged.length, cards: cards.size };
    }),

    /**
     * Start over: every answer, word level, streak and exam score is erased. Settings stay.
     * The reset time travels with sync, so the other devices drop their older answers too.
     */
    reset: oneAtATime(async () => {
      resetAt = now();
      missedCache = null;
      exams = [];
      activeDays = [];
      cards.clear();
      await store.replaceAll({ cards: [], reviews: [], meta: { activeDays, exams, resetAt } });
      missedCache = null;
      return { resetAt };
    }),
  };
}
