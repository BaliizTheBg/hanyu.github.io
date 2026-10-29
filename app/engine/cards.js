// A card is the memory of one skill of one word. This file turns an answer into
// the card's next state and its next due date.

import { nextMemory, intervalDays, AGAIN, HARD, GOOD } from "./fsrs.js";
import { SKILLS } from "./skills.js";
import { DAY, MINUTE } from "./time.js";

export const NEW = 0;
export const LEARNING = 1; // answered, last answer wrong, never graduated
export const REVIEW = 2; // last answer right
export const RELEARNING = 3; // was known, then forgotten

export const cardId = (key, skill) => `${key}#${skill}`;

export function newCard(key, skill) {
  // s = stability (days), d = difficulty (1..10), first/last = time of first/last answer
  return { id: cardId(key, skill), key, skill, state: NEW, due: 0, s: 0, d: 0, reps: 0, lapses: 0, first: 0, last: 0 };
}

/**
 * Grade of an answer. A self-marked answer (dictation) gives its grade directly.
 * Otherwise: wrong = AGAIN, right but slow = HARD, right = GOOD.
 */
export function gradeOf({ correct, ms = 0, selfGrade = null }, skill) {
  if (selfGrade) return selfGrade;
  if (!correct) return AGAIN;
  const slow = SKILLS[skill]?.slowMs ?? Infinity;
  return ms > slow ? HARD : GOOD;
}

/**
 * Apply one answer to a card. Pure: returns a new card.
 * opts.retention: target chance of remembering (0.9)
 * opts.maxIntervalDays: cap (used before an exam so everything comes back in time)
 * opts.retryMinutes: when a wrong card is due again
 */
export function applyAnswer(card, grade, time, opts = {}) {
  const { retention = 0.9, maxIntervalDays = 36_500, retryMinutes = 10, weights } = opts;
  const isNew = card.state === NEW;
  const elapsed = isNew ? 0 : (time - card.last) / DAY;
  const mem = nextMemory(isNew ? null : { s: card.s, d: card.d }, grade, elapsed, weights);
  const next = { ...card, s: mem.s, d: mem.d, reps: card.reps + 1, first: card.first || time, last: time };
  if (grade === AGAIN) {
    const wasKnown = card.state === REVIEW || card.state === RELEARNING;
    next.lapses = card.lapses + (card.state === REVIEW ? 1 : 0);
    next.state = wasKnown ? RELEARNING : LEARNING;
    next.due = time + retryMinutes * MINUTE;
  } else {
    const days = Math.min(Math.max(1, Math.round(intervalDays(mem.s, retention))), Math.max(1, maxIntervalDays));
    next.state = REVIEW;
    next.due = time + days * DAY;
  }
  return next;
}

export { AGAIN, HARD, GOOD };
