import { h, icon } from "./study.js";

const BACK = '<path d="M15 5l-7 7 7 7"/>';
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const compact = (s) => plain(s).replace(/[\s'’.-]/g, "");

/** Find the best 40 matches without sorting the whole HSK dictionary on each keystroke. */
export function searchDictionary(entries, chars, raw, limit = 40) {
  const q = compact(raw.trim());
  if (!q) return { count: 0, entries: [] };
  const latinQuery = plain(raw.trim());
  let count = 0;
  const best = [];
  const consider = (entry, score) => {
    count++;
    let at = best.findIndex(([s, item]) => score < s || (score === s && entry.hanzi.localeCompare(item.hanzi, "zh") < 0));
    if (at < 0) at = best.length;
    if (at < limit) best.splice(at, 0, [score, entry]);
    if (best.length > limit) best.pop();
  };
  for (const entry of entries) {
    const zh = entry.hanziKey.indexOf(q);
    const py = entry.pinyinKey.indexOf(q);
    const numbered = entry.numberKey.indexOf(q);
    const en = entry.englishKey.indexOf(latinQuery);
    if (zh < 0 && py < 0 && numbered < 0 && en < 0) continue;
    const score = zh === 0 ? 0 : py === 0 || numbered === 0 ? 1 : en === 0 ? 2 : zh >= 0 ? 3 : py >= 0 || numbered >= 0 ? 4 : 5;
    consider(entry, score);
  }
  // Character notes are useful for short queries; word entries stay ahead of them.
  if ([...raw.trim()].length <= 2) for (const entry of chars) {
    if (entry.hanziKey.includes(q) || entry.pinyinKey.includes(q) || entry.englishKey.includes(latinQuery)) consider(entry, 6);
  }
  return { count, entries: best.map(([, entry]) => entry) };
}

/** Offline dictionary over the book lexicon + HSK/CC-CEDICT data already shipped with Hanyu. */
export function dictionaryPage(ctx) {
  const { app, lexicon } = ctx;
  const back = h("button", { class: "back-link", "aria-label": "Practice", onclick: ctx.back }, icon(BACK));
  const input = h("input", { class: "field dictionary-search", type: "search", placeholder: "Chinese, pinyin or English", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Search dictionary" });
  const status = h("p", { class: "subtitle dictionary-status", "aria-live": "polite" });
  const results = h("div", { class: "dictionary-results" });
  const entries = [...lexicon.words.values()].map((w) => ({
    hanzi: w.hanzi, pinyin: w.pinyin, numbered: w.numbered, senses: w.senses,
    source: w.hsk ? `HSK ${w.hsk}` : "Book",
    hanziKey: compact(w.hanzi), pinyinKey: compact(w.pinyin), numberKey: compact(w.numbered),
    englishKey: plain(w.senses.map((s) => `${s.en} ${s.fr}`).join(" ")),
  }));
  const chars = Object.values(lexicon.chars ?? {}).map((c) => ({
    hanzi: c.char, pinyin: c.pinyin?.join(", ") ?? "", numbered: "", senses: [{ en: c.definition, fr: "" }], source: "Character",
    hanziKey: compact(c.char), pinyinKey: compact((c.pinyin ?? []).join(" ")), numberKey: "", englishKey: plain(c.definition),
  }));

  function showMatches(raw) {
    if (!raw.trim()) {
      status.textContent = "Search the words from your books and the HSK list.";
      results.replaceChildren();
      return;
    }
    const { count, entries: matches } = searchDictionary(entries, chars, raw);
    const found = matches.map((e) => h("details", { class: "dictionary-entry" },
      h("summary", {},
        h("span", { class: "dictionary-hanzi hanzi-kai" }, e.hanzi),
        h("span", { class: "dictionary-word" }, h("span", { class: "dictionary-pinyin" }, e.pinyin),
          h("span", { class: "small muted" }, e.source))),
      h("div", { class: "dictionary-senses" }, ...e.senses.map((s) => h("div", { class: "sense" },
        h("div", {}, s.en), s.fr ? h("div", { class: "fr" }, s.fr) : null))),
      h("button", { class: "dictionary-speak", onclick: (event) => (event.preventDefault(), ctx.say(e.hanzi)) }, "Listen")));
    status.textContent = count ? `${count}${count > 40 ? "+" : ""} result${count === 1 ? "" : "s"}` : "No matches";
    results.replaceChildren(...found);
  }
  input.addEventListener("input", () => showMatches(input.value));
  app.replaceChildren(h("div", { class: "view" }, back,
    h("h1", { class: "large-title" }, "Dictionary"),
    h("p", { class: "subtitle" }, "Available offline · book vocabulary and HSK/CC-CEDICT"),
    input, status, results));
  showMatches("");
  window.scrollTo(0, 0);
}
