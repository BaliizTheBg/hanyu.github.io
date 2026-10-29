// Read-only views on the cards: is a word new / learning / mastered, streak,
// exam countdown and how many new words to learn per day.

import { CORE_SKILLS } from "./skills.js";
import { NEW, REVIEW, cardId } from "./cards.js";
import { retrievability } from "./fsrs.js";
import { DAY, dayNumber, dayNumberOfDate } from "./time.js";

/** 'new' (never answered), 'mastered' (last answer right in all 4 core skills), else 'learning'. */
export function wordStatus(cards, key) {
  const cs = CORE_SKILLS.map((s) => cards.get(cardId(key, s)));
  if (cs.every((c) => !c || c.state === NEW)) return "new";
  if (cs.every((c) => c && c.state === REVIEW)) return "mastered";
  return "learning";
}

/** Chance (0..1) of remembering this card right now. 0 for a card never answered. */
export function recallChance(card, now) {
  if (!card || card.state === NEW) return 0;
  return retrievability((now - card.last) / DAY, card.s);
}

/** Lowest recall chance over the 4 core skills of a word (its weakest point). */
export function wordStrength(cards, key, now) {
  return Math.min(...CORE_SKILLS.map((s) => recallChance(cards.get(cardId(key, s)), now)));
}

/** Time of the first answer on any core skill of the word (0 if never). */
export function firstSeen(cards, key) {
  const t = CORE_SKILLS.map((s) => cards.get(cardId(key, s))?.first || 0).filter(Boolean);
  return t.length ? Math.min(...t) : 0;
}

/** Consecutive study days with at least one answer, ending today (or yesterday if not studied yet today). */
export function streakDays(activeDays, now, dayStartHour = 4) {
  const days = new Set(activeDays);
  let d = dayNumber(now, dayStartHour);
  if (!days.has(d)) d -= 1;
  let n = 0;
  while (days.has(d)) {
    n += 1;
    d -= 1;
  }
  return n;
}

/** Whole study days from today to the exam day (0 = exam is today, negative = passed, null = no exam). */
export function examDaysLeft(examDate, now, dayStartHour = 4) {
  if (!examDate) return null;
  return dayNumberOfDate(examDate) - dayNumber(now, dayStartHour);
}

/** Longest allowed interval so every reviewed card comes back before the exam. */
export function examIntervalCap(examDate, now, dayStartHour = 4) {
  const left = examDaysLeft(examDate, now, dayStartHour);
  if (left === null || left < 1) return 36_500;
  return Math.max(1, left - 1);
}

/**
 * New words per day. With an exam date, all unseen words are spread over the days
 * before the exam, keeping `reserveDays` (the last day) for review only.
 */
export function dailyNewQuota({ unseen, examDate = null, now, dayStartHour = 4, reserveDays = 1, defaultPerDay = 20 }) {
  const daysLeft = examDaysLeft(examDate, now, dayStartHour);
  if (daysLeft === null || daysLeft < 0) {
    return { daysLeft, studyDays: null, newPerDay: Math.min(defaultPerDay, unseen) };
  }
  if (daysLeft === 0) return { daysLeft, studyDays: 0, newPerDay: 0 };
  const studyDays = Math.max(1, daysLeft - reserveDays);
  return { daysLeft, studyDays, newPerDay: Math.ceil(unseen / studyDays) };
}
