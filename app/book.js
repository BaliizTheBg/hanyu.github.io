// Book tab: the lessons of one book (1A, 1B…, switched at the top: only what is shown changes,
// not the daily plan) with their progress, and each lesson's page (study this lesson, its words
// with 4 skill dots). A mastered word gets a seal. Listening, dialogues and dictation are in
// the Practice tab (app/practice.js).

import * as H from "./engine/index.js";
import { h, icon, wordCard } from "./study.js";

const SKILL_DOTS = [["meaning", "Meaning"], ["listening", "Listening"], ["recall", "Recall"], ["pinyin", "Pinyin"]];
const REVIEW = 2; // card state: last answer right
const CHEVRON = '<path d="M9 5l7 7-7 7"/>';
const BACK = '<path d="M15 5l-7 7 7 7"/>';

let viewing = null; // the book shown (kept while the app is open)

/** ctx: {app, engine, lexicon, books: [{id, name, texts, path}], say, study(session)} */
export function bookTab(ctx) {
  const { app, engine } = ctx;
  viewing ??= (engine.settings.planBooks ?? [ctx.books[0].id]).at(-1);
  const book = ctx.books.find((b) => b.id === viewing) ?? ctx.books[0];
  const { texts } = book;
  ctx = { ...ctx, book };
  const first = texts.lessons[0].lesson;
  const last = texts.lessons.at(-1).lesson;
  const byLesson = new Map();
  for (const p of book.path) {
    if (!byLesson.has(p.lesson)) byLesson.set(p.lesson, []);
    byLesson.get(p.lesson).push(p.key);
  }
  const rows = texts.lessons.map((L) => {
    const keys = byLesson.get(L.lesson) ?? [];
    const mastered = keys.filter((k) => engine.status(k) === "mastered").length;
    const started = keys.some((k) => engine.status(k) !== "new");
    return h("button", { class: "lesson-row", onclick: () => lessonPage(ctx, L, keys) },
      h("span", { class: "lesson-num" }, String(L.lesson)),
      h("span", { class: "lesson-text" },
        h("span", { class: "lesson-zh hanzi-kai" }, L.zh),
        h("span", { class: "lesson-en" }, L.en),
        h("span", { class: "meter" }, h("span", { style: `transform:scaleX(${keys.length ? mastered / keys.length : 0})` }))),
      h("span", { class: "lesson-count" }, started ? `${mastered}/${keys.length}` : `${keys.length} words`),
      icon(CHEVRON));
  });
  app.replaceChildren(h("div", { class: "view" },
    h("h1", { class: "large-title" }, `Book ${book.name}`),
    h("div", { class: "segmented", role: "radiogroup", "aria-label": "Book shown" }, ...ctx.books.map((b) =>
      h("button", { role: "radio", "aria-checked": String(b.id === book.id), onclick: () => b.id !== book.id && ((viewing = b.id), bookTab(ctx)) }, b.name))),
    h("p", { class: "subtitle" }, `Hanyu Jiaocheng · lessons ${first}–${last}`),
    h("div", { class: "group lessons" }, ...rows)));
}

function dots(engine, key) {
  if (engine.status(key) === "mastered") {
    return h("span", { class: "seal hanzi-kai", title: "Mastered" }, [...key.split("|")[0]].filter((c) => c >= "一" && c <= "鿿").slice(0, 2).join(""));
  }
  return h("span", { class: "dots", "aria-label": SKILL_DOTS.filter(([s]) => engine.card(key, s).state === REVIEW).map(([, n]) => n).join(", ") || "Not learned yet" },
    ...SKILL_DOTS.map(([s]) => h("i", { class: engine.card(key, s).state === REVIEW ? "on" : "" })));
}

function lessonPage(ctx, L, keys) {
  const { app, engine, lexicon } = ctx;
  const words = keys.map((k) => lexicon.words.get(k)).filter(Boolean);
  const mastered = keys.filter((k) => engine.status(k) === "mastered").length;
  app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Book", onclick: () => bookTab(ctx) }, icon(BACK)),
    h("div", { class: "lesson-hero" },
      h("div", { class: "lesson-hero-zh hanzi-kai" }, L.zh),
      h("div", { class: "lesson-hero-sub" }, `Lesson ${L.lesson} · ${L.pinyin} · ${L.en}`)),
    h("p", { class: "subtitle center" }, `${mastered} of ${keys.length} words mastered`),
    h("button", { class: "pill", onclick: () => ctx.study(engine.session({ words: ctx.book.path, lessons: [L.lesson], newCount: keys.length })) }, "Study this lesson"),
    h("h2", { class: "section-title" }, "Words"),
    h("div", { class: "group" }, ...words.map((w) =>
      h("button", { class: "cell row-button", onclick: () => sheet(ctx, w) },
        h("span", { class: "cell-hanzi hanzi-kai" }, w.hanzi),
        h("span", { class: "label" }, h("div", {}, w.pinyin), h("div", { class: "small muted one-line" }, w.senses[0].en)),
        dots(engine, w.key))))));
  window.scrollTo(0, 0);
}

/** A word's full card in a sheet that slides up; tap outside or swipe the handle down to close. */
function sheet(ctx, w) {
  const close = () => {
    ctx.stop?.(); // its word, if still waiting to be spoken, is not spoken any more
    panel.classList.remove("open");
    scrim.classList.remove("open");
    setTimeout(() => layer.remove(), 280);
  };
  const scrim = h("div", { class: "scrim", onclick: close });
  const panel = h("div", { class: "sheet", role: "dialog", "aria-label": w.hanzi },
    h("div", { class: "handle" }),
    wordCard(ctx, H.revealOf(w, ctx.lexicon), { strokes: true }));
  const layer = h("div", { class: "layer" }, scrim, panel);
  document.body.append(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => (panel.classList.add("open"), scrim.classList.add("open"))));
  ctx.sayOpen(w.speak);
  // drag the sheet down to close it: follows the finger, a flick is enough
  let y0 = null, t0 = 0, dy = 0;
  panel.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".handle, .word-head") || panel.scrollTop > 0) return;
    y0 = e.clientY; t0 = performance.now(); dy = 0;
    panel.style.transition = "none";
  });
  panel.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    const d = e.clientY - y0;
    dy = d < 0 ? d * 0.2 : d; // pulling up past the top gives a little, then resists
    panel.style.transform = `translateY(${dy}px)`;
  });
  const release = () => {
    if (y0 === null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dy > 120 || (dy > 0 && v > 0.5)) close();
  };
  panel.addEventListener("pointerup", release);
  panel.addEventListener("pointercancel", release);
}
