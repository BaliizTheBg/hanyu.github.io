// Pinyin answers: check what the learner typed against the expected pinyin, and
// turn "ni3 hao3" into "nǐ hǎo" for display.
//
// Accepted input: tone marks (nǐ hǎo) or numbers (ni3 hao3), with or without spaces,
// any case, ü typed as ü / v / u:, erhua as nǎr / nar3 / na3r, neutral tone as no
// number, 5 or 0. For 一 and 不 both the changed tone (yí, bú) and the normal tone
// (yī, bù) are right.

const MARKS = {
  ā: "a1", á: "a2", ǎ: "a3", à: "a4", ē: "e1", é: "e2", ě: "e3", è: "e4",
  ī: "i1", í: "i2", ǐ: "i3", ì: "i4", ō: "o1", ó: "o2", ǒ: "o3", ò: "o4",
  ū: "u1", ú: "u2", ǔ: "u3", ù: "u4", ǖ: "v1", ǘ: "v2", ǚ: "v3", ǜ: "v4",
  ń: "n2", ň: "n3", ǹ: "n4", ü: "v",
};
const TONED = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", v: "ǖǘǚǜ",
};

/** "ni3 hao3" -> [{letters:'ni', tone:3}, {letters:'hao', tone:3}] */
export function syllables(numbered) {
  return numbered.trim().split(/\s+/).map((s) => {
    const m = s.match(/^([a-z]+?)([0-5])?$/);
    if (!m) throw new Error(`bad numbered syllable: ${s}`);
    return { letters: normalizeLetters(m[1]), tone: m[2] ? Number(m[2]) % 5 || 5 : 5 };
  });
}

// ü after j, q, x, y is written u: treat jv / ju the same
function normalizeLetters(s) {
  return s.replace(/u:/g, "v").replace(/ü/g, "v").replace(/([jqxy])v/g, "$1u");
}

/** One syllable with its tone mark, e.g. ('hao', 3) -> 'hǎo'. */
function markSyllable(letters, tone) {
  const s = letters.replace(/v/g, "ü");
  if (tone === 5) return s;
  const base = s.replace(/ü/g, "v");
  let i = base.search(/[ae]/);
  if (i < 0) i = base.indexOf("ou");
  if (i < 0) {
    for (let k = base.length - 1; k >= 0; k--) {
      if ("iouv".includes(base[k])) {
        i = k;
        break;
      }
    }
  }
  if (i < 0) return s;
  return s.slice(0, i) + TONED[base[i]][tone - 1] + s.slice(i + 1);
}

/** "ni3 hao3" -> "nǐ hǎo" (syllables of one word are joined: "xue2 sheng5" -> "xuésheng" only if joined=true) */
export function toMarks(numbered, { joined = false } = {}) {
  return syllables(numbered)
    .map((x, i) => (joined && i > 0 && /^[aeo]/.test(x.letters) ? "'" : "") + markSyllable(x.letters, x.tone))
    .join(joined ? "" : " ");
}

/** Read typed input into letters + the tones it gives at letter positions. */
function readInput(input) {
  const letters = [];
  const tones = []; // [{at: letter index, tone}]
  for (const ch of input.normalize("NFC").toLowerCase()) {
    if (MARKS[ch]) {
      const [l, t] = [MARKS[ch][0], MARKS[ch].slice(1)];
      letters.push(l);
      if (t) tones.push({ at: letters.length - 1, tone: Number(t), mark: true }); // written on the letter: its place is clear
    } else if (ch >= "a" && ch <= "z") {
      letters.push(ch);
    } else if (ch === ":" && letters.at(-1) === "u") {
      letters[letters.length - 1] = "v";
    } else if (ch >= "0" && ch <= "5" && letters.length) {
      tones.push({ at: letters.length - 1, tone: Number(ch) % 5 || 5 });
    }
    // spaces, apostrophes, hyphens, punctuation: ignored
  }
  return { letters: normalizeLetters(letters.join("")), tones };
}

/** Tone number of a marked syllable: 'hǎo' -> 3, 'ma' -> 5. */
export function toneOf(marked) {
  for (const ch of marked.normalize("NFC")) {
    const t = MARKS[ch]?.slice(1);
    if (t) return Number(t);
  }
  return 5;
}

/** Tones accepted for a syllable: as printed, plus the normal tone of 一 / 不. */
function allowedTones({ letters, tone }) {
  const ok = new Set([tone]);
  if (letters === "yi" && (tone === 2 || tone === 4)) ok.add(1);
  if (letters === "bu" && tone === 2) ok.add(4);
  return ok;
}

/**
 * @param fullTones  for each syllable, the tones its character has when it is not light
 *                   (accepted on a light syllable, with a note): e.g. 谢谢 [[4],[4]]
 */
function compare(input, numbered, fullTones = null) {
  const exp = syllables(numbered);
  const expLetters = exp.map((x) => x.letters).join("");
  if (input.letters !== expLetters) {
    return { variant: numbered, lettersOk: false, syllables: exp.map((x) => ({ expected: markSyllable(x.letters, x.tone), toneOk: false })) };
  }
  // letter index -> syllable index
  const owner = [];
  exp.forEach((x, i) => {
    for (let k = 0; k < x.letters.length; k++) owner.push(i);
  });
  const given = new Array(exp.length).fill(null);
  let from = 0; // first syllable not yet followed by a typed tone
  for (const t of input.tones) {
    let at = owner[Math.min(t.at, owner.length - 1)];
    // one tone typed after a whole word ("mama" + ā for māma): the syllables it follows that
    // have no tone of their own form a run; if only one of them takes a full tone in the
    // answer (the others are light), that is the syllable the learner meant
    const run = exp.slice(from, at + 1).map((x, k) => ({ x, i: from + k })).filter(({ i }) => given[i] === null);
    if (run.length > 1 && t.tone !== 5 && !t.mark) {
      const full = run.filter(({ x }) => x.tone !== 5);
      if (full.length === 1) at = full[0].i;
    }
    given[at] = t.tone;
    from = Math.max(from, owner[Math.min(t.at, owner.length - 1)] + 1);
  }
  const result = exp.map((x, i) => {
    const t = given[i] ?? 5;
    const full = x.tone === 5 && t !== 5 && (fullTones?.[i] ?? []).includes(t);
    return { expected: markSyllable(x.letters, x.tone), given: given[i], toneOk: allowedTones(x).has(t) || full, ...(full && { light: true }) };
  });
  return { variant: numbered, lettersOk: true, syllables: result };
}

/**
 * Check a typed pinyin answer.
 * @param input      what the learner typed
 * @param variants   accepted answers, numbered ("ni3 hao3"); the first one is shown as the answer
 * @param fullTones  optional, per variant: see compare(). A light syllable typed with its
 *                   full tone (xièxiè for xièxie) is right, with `lightTone: true` for a note.
 * @returns {correct, reason: 'ok'|'tones-missing'|'tone'|'spelling'|'empty', expected, syllables, lightTone?}
 *   syllables: [{expected:'hǎo', toneOk, light?}] for the closest accepted answer
 */
export function checkPinyin(input, variants, fullTones = null) {
  const read = readInput(input ?? "");
  const expected = toMarks(variants[0]);
  if (!read.letters) return { correct: false, reason: "empty", expected, syllables: [] };
  const results = variants.map((v, i) => compare(read, v, fullTones?.[i]));
  const matching = results.filter((r) => r.lettersOk);
  if (!matching.length) return { correct: false, reason: "spelling", expected, syllables: results[0].syllables };
  const best = matching.reduce((a, b) => (b.syllables.filter((s) => s.toneOk).length > a.syllables.filter((s) => s.toneOk).length ? b : a));
  const correct = best.syllables.every((s) => s.toneOk);
  let reason = "ok";
  if (!correct) reason = read.tones.length === 0 ? "tones-missing" : "tone";
  const lightTone = correct && best.syllables.some((s) => s.light);
  return { correct, reason, expected: correct ? toMarks(best.variant) : expected, syllables: best.syllables, ...(lightTone && { lightTone }) };
}
