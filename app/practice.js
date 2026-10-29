// Practice tab: everything to practise beyond the daily plan, each in one place.
// 1. Words to fix (every word you missed, app/fix.js)
// 2. Listen to a lesson (the texts read aloud, app/listen.js)
// 3. Dialogues (the conversation levels of each lesson, and Classroom Chinese, app/talk.js)
// 4. Dictation (hear a word, write it on paper, check yourself)
// Listen, Dialogues and Dictation open a page with the book switch and the lessons.

import { h, icon } from "./study.js";
import { listenMode } from "./listen.js";
import { dictionaryPage } from "./dictionary.js";
import { writingPage } from "./writing.js";

const CHEVRON = '<path d="M9 5l7 7-7 7"/>';
const BACK = '<path d="M15 5l-7 7 7 7"/>';

let viewing = null; // the book shown in Practice (its own choice, kept while the app is open)

/**
 * ctx: {app, engine, lexicon, books, units, missed() → count, openFix(), openDialogue(unit, back),
 *       study(session, back), say, sayOpen, stop, afterMove, tabbar, alive()}
 */
export async function practiceTab(ctx) {
  const missed = await ctx.missed();
  if (ctx.alive && !ctx.alive()) return; // another tab was opened meanwhile
  const row = (glyph, title, sub, onclick, value = null) =>
    h("button", { class: "cell row-button", onclick },
      h("span", { class: "glyph" }, glyph),
      h("span", { class: "label" }, h("div", {}, title), h("div", { class: "small muted" }, sub)),
      value === null ? null : h("span", { class: "value" }, String(value)),
      icon(CHEVRON));
  ctx.app.replaceChildren(h("div", { class: "view" },
    h("h1", { class: "large-title" }, "Practice"),
    h("div", { class: "group practice-list" },
      row("错", "Words to fix", missed ? "The words you missed" : "Nothing to fix", ctx.openFix, missed || null),
      row("字", "Dictionary", "Search Chinese, pinyin or English", () => dictionaryPage({ ...ctx, back: () => practiceTab(ctx) })),
      row("写", "Write characters", "Practise stroke order with your finger", () => writingBooksPage(ctx)),
      row("听", "Listen", "A lesson read aloud", () => lessonsPage(ctx, "listen")),
      row("说", "Dialogues", "Speak a lesson's dialogues", () => lessonsPage(ctx, "dialogues")),
      row("写", "Dictation", "Hear a word, write it on paper", () => lessonsPage(ctx, "dictation")))));
  window.scrollTo(0, 0);
}

function writingBooksPage(ctx) {
  const { app, books } = ctx;
  const book = books.find((b) => b.id === (viewing ?? books[0].id)) ?? books[0];
  const back = () => practiceTab(ctx);
  app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Practice", onclick: back }, icon(BACK)),
    h("h1", { class: "large-title" }, "Write characters"),
    h("div", { class: "segmented", role: "radiogroup", "aria-label": "Book shown" }, ...books.map((b) =>
      h("button", { role: "radio", "aria-checked": String(b.id === book.id), onclick: () => b.id !== book.id && ((viewing = b.id), writingBooksPage(ctx)) }, b.name))),
    h("p", { class: "subtitle" }, "Choose a lesson. Draw each stroke in order; the shape can be approximate."),
    ...book.texts.lessons.map((L) => h("button", { class: "lesson-row", onclick: () => writingPage({ ...ctx, book, lesson: L.lesson, back: () => writingBooksPage(ctx) }) },
      h("span", { class: "lesson-num" }, String(L.lesson)),
      h("span", { class: "lesson-text" }, h("span", { class: "lesson-zh hanzi-kai" }, L.zh), h("span", { class: "lesson-en" }, L.en)),
      icon(CHEVRON)))));
  window.scrollTo(0, 0);
}

const PAGES = {
  listen: { title: "Listen", sub: "Choose a lesson: its texts are read aloud, line by line." },
  dialogues: { title: "Dialogues", sub: "Choose a dialogue: listen, then take a role." },
  dictation: { title: "Dictation", sub: "Keep paper and a pen. Hear a word, write it, then check yourself." },
};

/** Listen, Dialogues or Dictation: the book switch, then the lessons (or their dialogues). */
function lessonsPage(ctx, kind) {
  const { app, engine } = ctx;
  viewing ??= (engine.settings.planBooks ?? [ctx.books[0].id]).at(-1);
  const book = ctx.books.find((b) => b.id === viewing) ?? ctx.books[0];
  const again = () => lessonsPage(ctx, kind);
  const back = () => practiceTab(ctx);
  const lessonRow = (L, onclick, value = null) =>
    h("button", { class: "lesson-row", onclick },
      h("span", { class: "lesson-num" }, String(L.lesson)),
      h("span", { class: "lesson-text" }, h("span", { class: "lesson-zh hanzi-kai" }, L.zh), h("span", { class: "lesson-en" }, L.en)),
      value === null ? null : h("span", { class: "lesson-count" }, value),
      icon(CHEVRON));
  const dialogueRow = (u) =>
    h("button", { class: "cell row-button", onclick: () => ctx.openDialogue(u, again) },
      h("span", { class: "label" }, h("div", { class: "hanzi-kai row-zh" }, u.title.zh), h("div", { class: "small muted" }, u.title.en)),
      icon(CHEVRON));

  let body;
  if (kind === "listen") {
    const lessons = book.texts.lessons.filter((L) => L.parts.some((P) => P.items.some((it) => it.type === "line")));
    body = [h("div", { class: "group lessons" }, ...lessons.map((L) => lessonRow(L, () => listenMode({ ...ctx, back: again }, L))))];
  } else if (kind === "dictation") {
    const count = (L) => book.path.filter((p) => p.lesson === L.lesson).length;
    body = [
      h("button", { class: "pill", onclick: () => ctx.study(engine.dictation(), again) }, "The words I've learned"),
      h("h2", { class: "section-title" }, "One lesson"),
      h("div", { class: "group lessons" }, ...book.texts.lessons.map((L) =>
        lessonRow(L, () => ctx.study(engine.dictation({ words: book.path, lessons: [L.lesson] }), again), `${count(L)} words`))),
    ];
  } else {
    // each lesson with its dialogues under its title, then Classroom Chinese (in the book that has it)
    const byLesson = book.texts.lessons.map((L) => [L, ctx.units.filter((u) => u.lesson === L.lesson)]).filter(([, us]) => us.length);
    const classroom = book.texts.classroom ? ctx.units.filter((u) => !u.lesson) : [];
    body = [
      ...byLesson.flatMap(([L, us]) => [
        h("h2", { class: "section-title" }, h("span", { class: "muted" }, `${L.lesson} · `), h("span", { class: "hanzi-kai" }, L.zh)),
        h("div", { class: "group" }, ...us.map(dialogueRow)),
      ]),
      ...(classroom.length ? [h("h2", { class: "section-title" }, "Classroom Chinese"), h("div", { class: "group" }, ...classroom.map(dialogueRow))] : []),
    ];
  }

  app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Practice", onclick: back }, icon(BACK)),
    h("h1", { class: "large-title" }, PAGES[kind].title),
    h("div", { class: "segmented", role: "radiogroup", "aria-label": "Book shown" }, ...ctx.books.map((b) =>
      h("button", { role: "radio", "aria-checked": String(b.id === book.id), onclick: () => b.id !== book.id && ((viewing = b.id), again()) }, b.name))),
    h("p", { class: "subtitle" }, PAGES[kind].sub),
    ...body));
  window.scrollTo(0, 0);
}
