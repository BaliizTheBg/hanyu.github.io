// "Words I keep missing": every word answered wrong goes on the list (study, dictation, exams,
// word quiz: any word question, not dialogues). It leaves the list once it is cleared: answered
// right on CLEAR_DAYS different days after the day of the miss, with no miss in between (the
// retries of the same session don't count). A new miss puts it back and starts the count again.
// Worked out from the review log, so it syncs with the progress.

import { CONVERSATION_SKILLS } from "./skills.js";
import { dayNumber } from "./time.js";

export const CLEAR_DAYS = 2;

/**
 * @param reviews  review log rows {key, skill, grade, time}
 * @returns [{key, misses, lastMiss, skill, rightDays}] still on the list, the most missed first
 *   (skill = the skill of the last miss; rightDays = days right since then, 0..CLEAR_DAYS-1)
 */
export function missedWords(reviews, { dayStartHour = 4 } = {}) {
  const words = new Map();
  // answers saved at the same moment (an exam) are read in a fixed order: the same on every device
  for (const r of [...reviews].sort((a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id)))) {
    if (CONVERSATION_SKILLS.includes(r.skill)) continue;
    const w = words.get(r.key);
    if (r.grade <= 1) {
      words.set(r.key, { key: r.key, misses: (w?.misses ?? 0) + 1, lastMiss: r.time, missDay: dayNumber(r.time, dayStartHour), skill: r.skill, days: new Set(), cleared: false });
      continue;
    }
    if (!w || w.cleared) continue;
    const day = dayNumber(r.time, dayStartHour);
    if (day > w.missDay) w.days.add(day);
    if (w.days.size >= CLEAR_DAYS) w.cleared = true;
  }
  return [...words.values()]
    .filter((w) => !w.cleared)
    .sort((a, b) => b.misses - a.misses || b.lastMiss - a.lastMiss)
    .map(({ key, misses, lastMiss, skill, days }) => ({ key, misses, lastMiss, skill, rightDays: days.size }));
}
