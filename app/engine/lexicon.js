// The master dictionary the questions are built from: one entry per word `key`,
// gathering every sense the packs teach for it, plus the character notes.

// Words that are in no book (HSK words) come after every book lesson: they are only
// offered as wrong answers once the learner works outside the book.
const OUTSIDE_BOOKS = 1000;

/**
 * @param packs       vocab.json objects and/or data/open/hsk-2025.json, books first in book order,
 *                    the HSK list last (e.g. [hj1a, hj1b, hsk]). A later book adds the senses it
 *                    teaches for a word already met (看 "to look", then in 1B "to think"); the HSK
 *                    list only adds its level to a book word. Words without a meaning yet (most HSK
 *                    levels) are left out.
 * @param characters  data/open/characters.json (optional)
 * @returns {{words: Map<string, Entry>, chars: object}}
 * Entry: {key, hanzi, pinyin, numbered, variants, speak, kind, lesson, pack, hsk?, senses:[{en, fr, pos, tip, lesson, kind}]}
 */
export function buildLexicon(packs, characters = null) {
  const words = new Map();
  for (const pack of packs) {
    for (const w of pack.words) {
      let e = words.get(w.key);
      if (e && e.pack !== pack.pack && w.level) {
        e.hsk ??= w.level; // a book word that is also an HSK word
        continue;
      }
      if (!w.en) continue;
      if (e && e.senses.some((s) => s.en === w.en)) continue; // the same sense taught again
      if (!e) {
        e = {
          key: w.key,
          hanzi: w.hanzi,
          pinyin: w.pinyin,
          numbered: w.numbered,
          variants: w.variants ?? [w.numbered],
          speak: w.speak ?? w.hanzi,
          kind: w.kind ?? "word",
          lesson: w.lesson ?? OUTSIDE_BOOKS,
          pack: pack.pack,
          senses: [],
        };
        if (w.level) e.hsk = w.level;
        words.set(w.key, e);
      }
      e.senses.push({ en: w.en, fr: w.fr ?? "", pos: w.pos ?? [], tip: w.tip ?? "", tipParts: w.tipParts ?? null, lesson: w.lesson ?? OUTSIDE_BOOKS, kind: w.kind ?? "word" });
    }
  }
  return { words, chars: characters?.characters ?? {} };
}

/** The Chinese characters of a word, without (), …, 〇 kept. */
export function charsOf(hanzi) {
  return [...hanzi].filter((c) => (c >= "一" && c <= "鿿") || c === "〇");
}
