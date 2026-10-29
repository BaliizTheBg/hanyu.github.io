// A "path" is the ordered list of words to learn. It points into the master dictionary
// by `key`, so a word that appears in two books (or a book and the HSK list) is one word.

/**
 * Path of a book pack: lesson by lesson, each lesson's new words in the order the
 * lesson text uses them. A key seen earlier is not repeated.
 * @returns {{key:string, lesson:number, pack:string}[]}
 */
export function pathFromPack(vocab, texts, seen = new Set()) {
  const byId = new Map(vocab.words.map((w) => [w.id, w]));
  const path = [];
  const add = (w, lesson) => {
    if (!w || seen.has(w.key)) return;
    seen.add(w.key);
    path.push({ key: w.key, lesson, pack: vocab.pack });
  };
  for (const L of texts.lessons) for (const id of L.newWords) add(byId.get(id), L.lesson);
  for (const w of vocab.words) add(w, w.lesson); // safety net: nothing is left out
  return path;
}

/**
 * Path of several books in order (e.g. 1A then 1B): a word met in an earlier book is not
 * repeated (its new senses come with the lexicon).
 * @param books  [{vocab, texts}, …]
 */
export function pathFromBooks(books) {
  const seen = new Set();
  return books.flatMap(({ vocab, texts }) => pathFromPack(vocab, texts, seen));
}

/**
 * Path of the official HSK list: the words of the chosen levels in the list's order (序号),
 * one entry per word. Only words that have a meaning (meanings are added level by level).
 * @param levels  e.g. ["1"], ["1", "2"], ["7-9"]
 * @returns {{key:string, n:number, level:string, pack:string}[]}
 */
export function pathFromHsk(hsk, levels = ["1"]) {
  const seen = new Set();
  const path = [];
  for (const w of hsk.words) {
    if (!levels.includes(w.level) || !w.en || seen.has(w.key)) continue;
    seen.add(w.key);
    path.push({ key: w.key, n: w.n, level: w.level, pack: hsk.pack });
  }
  return path;
}
