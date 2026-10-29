// FSRS-5 spacing algorithm (open algorithm by the open-spaced-repetition project).
// Pure math: given a memory state {s: stability in days, d: difficulty 1..10} and a
// grade, it returns the next memory state. No dates, no storage.

export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;

// Default FSRS-5 parameters. They can be personalised later from the review log.
export const DEFAULT_WEIGHTS = Object.freeze([
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]);

const DECAY = -0.5;
const FACTOR = 19 / 81;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Probability of remembering after `elapsedDays` with stability `s`. Equals 0.9 when elapsed = s. */
export function retrievability(elapsedDays, s) {
  if (s <= 0) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / s, DECAY);
}

/** Days until the chance of remembering drops to `retention`. */
export function intervalDays(s, retention = 0.9) {
  return (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
}

export function initStability(grade, w = DEFAULT_WEIGHTS) {
  return Math.max(w[grade - 1], 0.1);
}

export function initDifficulty(grade, w = DEFAULT_WEIGHTS) {
  return clamp(w[4] - Math.exp(w[5] * (grade - 1)) + 1, 1, 10);
}

export function nextDifficulty(d, grade, w = DEFAULT_WEIGHTS) {
  const delta = -w[6] * (grade - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(w[7] * initDifficulty(EASY, w) + (1 - w[7]) * damped, 1, 10);
}

function stabilityAfterRecall(d, s, r, grade, w) {
  const hard = grade === HARD ? w[15] : 1;
  const easy = grade === EASY ? w[16] : 1;
  return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hard * easy + 1);
}

function stabilityAfterForget(d, s, r, w) {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  return Math.min(sf, s);
}

function stabilityShortTerm(s, grade, w) {
  return s * Math.exp(w[17] * (grade - 3 + w[18]));
}

/**
 * Next memory state.
 * @param {{s:number,d:number}|null} memory  null for a card never answered
 * @param {number} grade  AGAIN..EASY
 * @param {number} elapsedDays  days since the previous answer (ignored for a new card)
 */
export function nextMemory(memory, grade, elapsedDays, w = DEFAULT_WEIGHTS) {
  if (!memory) return { s: initStability(grade, w), d: initDifficulty(grade, w) };
  const { s, d } = memory;
  const d2 = nextDifficulty(d, grade, w);
  if (elapsedDays < 1) {
    // answered again the same day: short-term formula
    return { s: Math.max(0.1, stabilityShortTerm(s, grade, w)), d: d2 };
  }
  const r = retrievability(elapsedDays, s);
  const s2 = grade === AGAIN ? stabilityAfterForget(d, s, r, w) : stabilityAfterRecall(d, s, r, grade, w);
  return { s: Math.max(0.1, s2), d: d2 };
}
