// The review log is the source of truth: every card can be rebuilt by replaying
// the answers in time order. That makes backup and syncing two devices simple:
// take the union of both logs (each answer has a unique id) and replay it.

import { applyAnswer, newCard, cardId } from "./cards.js";
import { dayNumber } from "./time.js";

export const EXPORT_FORMAT = "hanyu-progress";
export const EXPORT_VERSION = 1;

const byTime = (a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Union of two review logs, without duplicates, in time order. */
export function mergeReviews(a, b) {
  const all = new Map();
  for (const r of [...a, ...b]) all.set(r.id, r);
  return [...all.values()].sort(byTime);
}

/**
 * Rebuild every card from the log.
 * @param reviews  log rows {id, key, skill, grade, time}
 * @param optsAt   (time) => scheduling options at that time (retention, exam cap)
 */
export function replay(reviews, optsAt, dayStartHour = 4) {
  const cards = new Map();
  const days = new Set();
  for (const r of [...reviews].sort(byTime)) {
    const id = cardId(r.key, r.skill);
    cards.set(id, applyAnswer(cards.get(id) ?? newCard(r.key, r.skill), r.grade, r.time, optsAt(r.time)));
    days.add(dayNumber(r.time, dayStartHour));
  }
  return { cards, activeDays: [...days].sort((x, y) => x - y) };
}

/** The backup file: settings + the whole review log (cards are rebuilt on import). */
export function buildExport({ deviceId, settings, reviews, now }) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    deviceId,
    settings,
    reviews,
  };
}

/** Throws a readable error if `data` is not a Hanyu backup this version can read. */
export function checkExport(data) {
  if (!data || data.format !== EXPORT_FORMAT) throw new Error("This file is not a Hanyu progress file.");
  if (data.version > EXPORT_VERSION) throw new Error("This file comes from a newer version of Hanyu. Update the app first.");
  if (!Array.isArray(data.reviews)) throw new Error("The file has no review history.");
  for (const r of data.reviews) {
    if (typeof r.id !== "string" || typeof r.key !== "string" || typeof r.skill !== "string" || !(r.grade >= 1 && r.grade <= 4) || !Number.isFinite(r.time)) {
      throw new Error("The file is damaged (a review row is invalid).");
    }
  }
  return data;
}
