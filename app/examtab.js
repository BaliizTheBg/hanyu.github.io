// Exam tab: the countdown, then two parts. Hanyu: an exam on the books (whole books or some
// lessons). HSK: an exam on HSK levels, and the word quiz (random words from the HSK list, like
// the teacher in class). Then the history of scores. An exam runs full screen; its word items
// count for the words.

import * as H from "./engine/index.js";
import { h, icon, wordCard, pinyinPad, bookChips, booksName, cantListen } from "./study.js";
import { tiles } from "./talk.js";

const CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
const PLAY = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
const SLOW = '<path d="M2.5 16a8 7.5 0 0 1 16 0z"/><path d="M6.5 16l2.6-5h2.8l2.6 5"/><circle cx="20.6" cy="12.6" r="2"/><path d="M5.5 16v3M15.5 16v3"/>'; // a turtle: slowly

const select = (from, to, value) =>
  h("select", { class: "field select" }, ...Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => h("option", { value: String(n), selected: n === value }, String(n))));
const number = (value) => h("input", { class: "field", type: "number", inputmode: "numeric", min: "1", value: String(value) });

let part = "hanyu"; // the part shown: "hanyu" or "hsk" (kept while the app is open)
let examBooks = null; // books of the Hanyu exam (kept while the app is open)
const LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];
let teach = null; // HSK choices (kept while the app is open): levels, word numbers, how many

/** ctx: {app, engine, lexicon, bookLexicon, books, texts, D, say, stop, tabbar, study(session), back()} */
export function examTab(ctx) {
  const { app, engine, D } = ctx;
  examBooks ??= engine.settings.planBooks ?? [ctx.books[0].id];
  const chosen = ctx.books.filter((b) => examBooks.includes(b.id));
  const bookLessons = chosen.flatMap((b) => b.texts.lessons.map((L) => L.lesson));
  const first = bookLessons[0];
  const last = bookLessons.at(-1);
  const p = engine.plan();
  const exam = engine.settings.examDate;
  const days = exam && p.daysLeft >= 0 ? p.daysLeft : null;
  const from = select(first, last, first);
  const to = select(first, last, last);
  // HSK: levels from–to (for the exam and the word quiz); the quiz's word numbers follow the
  // levels (and can be narrowed: 4000–5000)
  const bounds = (lv) => {
    const ns = D.hsk.words.filter((w) => w.level === lv).map((w) => w.n);
    return [Math.min(...ns), Math.max(...ns)];
  };
  teach ??= { from: "1", to: "1", a: 1, b: bounds("1")[1], count: 20 };
  const lvSelect = (value) => h("select", { class: "field select" }, ...LEVELS.map((lv) => h("option", { value: lv, selected: lv === value }, lv)));
  const lvFrom = lvSelect(teach.from);
  const lvTo = lvSelect(teach.to);
  const hFrom = number(teach.a);
  const hTo = number(teach.b);
  const hCount = number(teach.count);
  const levelsChosen = () => {
    const [i, j] = [LEVELS.indexOf(lvFrom.value), LEVELS.indexOf(lvTo.value)].sort((x, y) => x - y);
    return LEVELS.slice(i, j + 1);
  };
  const onLevels = () => {
    const lv = levelsChosen();
    [hFrom.value, hTo.value] = [String(bounds(lv[0])[0]), String(bounds(lv.at(-1))[1])];
    remember();
  };
  const remember = () => (teach = { from: lvFrom.value, to: lvTo.value, a: Number(hFrom.value) || 1, b: Number(hTo.value) || 1, count: Number(hCount.value) || 20 });
  lvFrom.addEventListener("change", onLevels);
  lvTo.addEventListener("change", onLevels);
  for (const f of [hFrom, hTo, hCount]) f.addEventListener("change", remember);
  const quiz = (skills) => {
    remember();
    const a = Math.max(1, Math.min(teach.a, teach.b));
    const b = Math.max(teach.a, teach.b); // "5000 to 4000" works too
    const keys = H.pathFromHsk(D.hsk, levelsChosen()).filter((w) => w.n >= a && w.n <= b).map((w) => w.key);
    if (keys.length) ctx.study(engine.teacher({ keys, count: Math.max(1, teach.count), skills }));
  };
  const history = engine.examHistory().slice(-6).reverse();
  const levelsName = (lv) => `HSK ${lv[0]}${lv.length > 1 ? `–${lv.at(-1)}` : ""}`;
  const choose = (id) => () => ((part = id), examTab(ctx));
  const hanyu = [
    h("div", { class: "group pad-group" },
      h("p", { class: "small muted" }, "60 questions like a real paper: listening, vocabulary, reading and writing. Keep paper and a pen for the dictation."),
      bookChips(ctx.books, examBooks, (ids) => ((examBooks = ids), examTab(ctx)), "Books in the exam"),
      h("button", { class: "pill", onclick: () => runExam(ctx, { lessons: bookLessons }) }, `Whole ${booksName(ctx.books, examBooks)}`),
      h("div", { class: "range" }, h("label", {}, "Lessons", from), h("span", { class: "muted" }, "to"), h("label", {}, " ", to)),
      h("button", { class: "pill quiet", onclick: () => {
        const a = Math.min(+from.value, +to.value);
        const b = Math.max(+from.value, +to.value);
        runExam(ctx, { lessons: bookLessons.filter((n) => n >= a && n <= b) });
      } }, "These lessons only")),
  ];
  const hsk = [
    h("div", { class: "group pad-group" },
      h("div", { class: "range" }, h("label", {}, "HSK level", lvFrom), h("span", { class: "muted" }, "to"), h("label", {}, " ", lvTo)),
      h("p", { class: "small muted" }, "HSK 1 has Hanyu's own meanings; the other levels, English from the CC-CEDICT dictionary.")),
    h("h2", { class: "section-title" }, "Exam"),
    h("div", { class: "group pad-group" },
      h("p", { class: "small muted" }, "50 questions on the words of these levels: listening, vocabulary and writing. Keep paper and a pen for the dictation."),
      h("button", { class: "pill", onclick: () => {
        remember();
        const levels = levelsChosen();
        runExam(ctx, { levels, keys: H.pathFromHsk(D.hsk, levels).map((w) => w.key) });
      } }, "Start the exam")),
    h("h2", { class: "section-title" }, "Word quiz"),
    h("div", { class: "group pad-group" },
      h("p", { class: "small muted" }, "Random words from the list, like the teacher in class."),
      h("div", { class: "range three" }, h("label", {}, "From word", hFrom), h("label", {}, "To word", hTo), h("label", {}, "How many", hCount)),
      h("div", { class: "split" }, h("button", { class: "pill quiet", onclick: () => quiz(["write"]) }, "Dictation"), h("button", { class: "pill", onclick: () => quiz(undefined) }, "Quiz"))),
  ];

  app.replaceChildren(h("div", { class: "view" },
    h("h1", { class: "large-title" }, "Exam"),
    days === null
      ? h("p", { class: "subtitle" }, exam ? `The exam of ${exam} is behind you. Set the next one in Me.` : "No exam date yet. Set it in Me to get a countdown and a daily plan.")
      : h("div", { class: "countdown" },
        h("div", { class: "countdown-num" }, String(days)),
        h("div", { class: "muted" }, days === 0 ? "Your exam is today" : `day${days === 1 ? "" : "s"} to your exam · ${exam}`)),
    h("div", { class: "segmented", role: "radiogroup", "aria-label": "Exam part" },
      ...[["hanyu", "Hanyu"], ["hsk", "HSK"]].map(([id, name]) =>
        h("button", { role: "radio", "aria-checked": String(part === id), onclick: choose(id) }, name))),
    ...(part === "hsk" ? hsk : hanyu),
    history.length ? h("h2", { class: "section-title" }, "Your scores") : null,
    history.length ? h("div", { class: "group" }, ...history.map((e) =>
      h("div", { class: "cell" },
        h("span", { class: "score" }, `${e.percent}%`),
        h("span", { class: "label" },
          h("div", {}, e.levels ? levelsName(e.levels) : examLabel(e.lessons)),
          h("div", { class: "small muted" }, new Date(e.time).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ` · ${e.correct}/${e.total}` + (e.skipped ? ` · ${e.skipped} with sound skipped` : "")))))) : null));
  window.scrollTo(0, 0);
}

function promptView(ctx, p) {
  if (p.speak) {
    ctx.sayOpen(p.speak);
    return h("div", { class: "prompt" }, h("div", { class: "listen" },
      h("button", { class: "round", "aria-label": "Listen", onclick: () => ctx.say(p.speak) }, icon(PLAY)),
      h("button", { class: "round", "aria-label": "Listen slowly", onclick: () => ctx.say(p.speak, true) }, icon(SLOW))));
  }
  if (p.hanzi) return h("div", { class: "prompt prompt-hanzi" }, p.hanzi);
  if (p.pinyin) return h("div", { class: "prompt prompt-meaning" }, p.pinyin);
  if (p.zh) return h("div", { class: "prompt prompt-zh hanzi-kai" }, p.zh);
  if ("before" in p) return h("div", { class: "prompt prompt-col" }, h("div", { class: "prompt-zh hanzi-kai" }, p.before, h("span", { class: "blank" }, "　"), p.after), p.en ? h("div", { class: "muted" }, p.en) : null);
  if (p.tiles) return h("div", { class: "prompt prompt-meaning" }, h("div", {}, p.en), p.fr ? h("div", { class: "fr" }, p.fr) : null);
  return null;
}

function sentence(ctx, s) {
  return h("div", { class: "bubble" }, h("div", { class: "zh hanzi-kai" }, s.zh), h("div", { class: "py" }, s.pinyin), h("div", { class: "en" }, s.en, s.fr ? h("div", { class: "fr" }, s.fr) : null),
    h("div", { class: "listen" }, h("button", { class: "round", "aria-label": "Listen", onclick: () => ctx.say(s.speak ?? s.zh) }, icon(PLAY))));
}
function reveal(ctx, r) {
  if (!r) return null;
  if (r.key) return wordCard(ctx, r);
  if (r.question) return h("div", {}, sentence(ctx, r.question), sentence(ctx, r.answer));
  return h("div", {}, sentence(ctx, r), r.word ? wordCard(ctx, r.word) : null);
}

/** "Book 1A", "Books 1A + 1B" or "Lessons 3–7" (older scores without lessons were whole Book 1A). */
function examLabel(lessons) {
  if (!lessons) return "Book 1A";
  const [a, b] = [lessons[0], lessons.at(-1)];
  if (a === 1 && b === 15) return "Book 1A";
  if (a === 16 && b === 25) return "Book 1B";
  if (a === 1 && b === 25) return "Books 1A + 1B";
  return `Lessons ${a}–${b}`;
}

/** scope: {lessons} (Hanyu: book lessons) or {keys, levels} (HSK: the words of these levels) */
function runExam(ctx, scope) {
  const { app, engine } = ctx;
  const seed = Date.now() % 1e9;
  const prefer = engine.weakest(30).map((w) => w.key);
  const rng = H.seededRandom(seed);
  const exam = scope.keys
    ? H.buildExam({ lexicon: ctx.lexicon, rng, seed, keys: scope.keys, levels: scope.levels, prefer })
    : H.buildExam({ lexicon: ctx.bookLexicon, texts: ctx.texts, measureWords: ctx.D.measureWords, rng, seed, lessons: scope.lessons, prefer });
  const results = [];
  const n = exam.items.length;
  // "Can't listen now": the questions with sound are skipped until the end of this exam;
  // they are left out of the score (not wrong)
  let quiet = false;
  ctx.tabbar.hidden = true;
  const leave = () => (ctx.stop(), (ctx.tabbar.hidden = false), ctx.back());
  if (!n) return leave();

  const frame = (i, body, foot) => {
    app.replaceChildren(h("div", { class: "study" },
      h("header", { class: "study-top" },
        h("button", { class: "round ghost", "aria-label": "Stop the exam", onclick: leave }, icon(CLOSE)),
        h("div", { class: "bar" }, h("div", { style: `transform:scaleX(${i / n})` })),
        h("span", { class: "count" }, `${Math.min(i + 1, n)}/${n}`)),
      h("div", { class: "study-body" }, ...body),
      h("footer", { class: "study-foot" }, ...foot)));
    window.scrollTo(0, 0);
  };

  const show = (i) => {
    if (i === n) return finish();
    const it = exam.items[i];
    if (quiet && it.prompt.speak) {
      results[i] = { skipped: true };
      return show(i + 1);
    }
    const section = H.EXAM_SECTIONS.find((s) => s.id === it.section).title;
    const after = h("div");
    const foot = h("div", { class: "foot-stack" });
    let answered = false;
    const next = h("button", { class: "pill", onclick: () => show(i + 1) }, i + 1 === n ? "See my score" : "Next");
    const done = (r, text) => {
      if (answered) return;
      answered = true;
      ctx.hush?.(); // answered before the question spoke: its voice won't come late
      app.querySelector(".cant-listen")?.remove(); // answered: nothing left to skip
      results[i] = r;
      after.replaceChildren(h("p", { class: r.correct ? "verdict right" : "verdict wrong" }, text ?? (r.correct ? "Right" : "Not quite")), ...[reveal(ctx, it.reveal)].filter(Boolean));
      foot.replaceChildren(next);
    };
    let answer = null;
    if (it.kind === "choice") {
      const buttons = it.choices.map((c, k) => h("button", { class: c.hanzi ? `choice choice-hanzi${[...c.hanzi].length > 3 ? " long" : ""}` : "choice", onclick: () => pick(k) },
        c.hanzi ? c.hanzi : c.zh ? h("div", {}, h("div", { class: "hanzi-kai choice-zh" }, c.zh), c.pinyin ? h("div", { class: "fr" }, c.pinyin) : null) : c.pinyin ? h("div", { class: "choice-py" }, c.pinyin) : h("div", {}, h("div", {}, c.en), c.fr ? h("div", { class: "fr" }, c.fr) : null)));
      const pick = (k) => {
        if (answered) return;
        buttons.forEach((b) => (b.disabled = true));
        buttons[it.answerIndex].classList.add("is-right");
        if (k !== it.answerIndex) buttons[k].classList.add("is-wrong");
        done(H.checkExamAnswer(it, k));
      };
      answer = h("div", { class: it.choices.every((c) => c.hanzi) ? "choices grid" : "choices" }, ...buttons);
    } else if (it.kind === "typed") {
      const pad = pinyinPad((text) => {
        const r = H.checkExamAnswer(it, text);
        done(r, r.correct ? `Right · ${r.expected}` : `Answer: ${r.expected}`);
      });
      answer = pad.view;
      foot.append(pad.check);
    } else if (it.kind === "order") {
      const t = tiles(it.prompt.tiles, (idx) => { const r = H.checkExamAnswer(it, idx); done(r, r.correct ? "Right" : `Answer: ${it.accept[0]}${it.prompt.end ?? ""}`); });
      answer = t.view;
      foot.append(t.check);
    } else {
      foot.append(h("button", { class: "pill", onclick: () => {
        after.replaceChildren(...[reveal(ctx, it.reveal)].filter(Boolean));
        foot.replaceChildren(h("div", { class: "split" },
          h("button", { class: "pill quiet", onclick: () => done(H.checkExamAnswer(it, { selfGrade: 1 }), "Not yet") }, "Not yet"),
          h("button", { class: "pill", onclick: () => done(H.checkExamAnswer(it, { selfGrade: 3 }), "Got it") }, "Got it")));
      } }, "Show the answer"));
    }
    const prompt = promptView(ctx, it.prompt);
    if (it.prompt.speak) prompt.append(cantListen(() => {
      quiet = true;
      ctx.stop();
      results[i] = { skipped: true };
      show(i + 1);
    }));
    frame(i, [h("p", { class: "question" }, h("b", {}, section), " · ", it.instruction), prompt, answer, after], [foot]);
  };

  let finished = false;
  async function finish() {
    if (finished) return; // "See my score" tapped twice while the answers are saved: count them once
    finished = true;
    const sum = await engine.recordExam(exam, results);
    frame(n, [
      h("div", { class: "pause" },
        h("div", { class: "result-num" }, sum.total ? `${sum.percent}%` : "–"),
        sum.total ? h("h2", { class: "pause-title" }, `${sum.correct} / ${sum.total}`) : null,
        sum.total ? h("p", { class: "muted" }, "Words you missed come back in your next study sessions.") : null,
        sum.skipped ? h("p", { class: "muted" }, sum.total
          ? `${sum.skipped} question${sum.skipped === 1 ? "" : "s"} with sound skipped: not in the score.`
          : "Every question needed sound: no score this time.") : null),
      !sum.total ? null : h("div", { class: "group pad-group" }, ...H.EXAM_SECTIONS.filter((s) => sum.sections[s.id]).map((s) => {
        const { correct, total } = sum.sections[s.id];
        return h("div", { class: "section-score" },
          h("div", { class: "section-score-head" }, h("span", {}, s.title), h("span", { class: "muted" }, `${correct}/${total}`)),
          h("span", { class: "meter" }, h("span", { style: `transform:scaleX(${total ? correct / total : 0})` })));
      })),
    ], [h("button", { class: "pill", onclick: leave }, "Done")]);
  }
  show(0);
}
