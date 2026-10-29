// Hanyu test page: a plain way to use everything the engine does, on the iPhone and the Mac,
// before the real screens exist. Every screen is a function that redraws #app.
// Progress is stored on this device (IndexedDB); the files are kept offline by sw.js.

import * as H from "./engine/index.js";
import { openPack } from "./pack.js";
import { createSync } from "./cloud.js";

export const VERSION = "step-10";
export const FILES = {
  vocab: "../packs/hj-1a/vocab.json",
  texts: "../packs/hj-1a/texts.json",
  chars: "../data/open/characters.json",
  hsk: "../data/open/hsk-2025.json",
  measureWords: "../data/open/measure-words.json",
  substitutions: "../data/open/substitutions.json",
};
export const STROKES = "../data/open/strokes.json";
// On the published site the book is one encrypted file (scripts/build_site.mjs) instead of
// vocab.json + texts.json; its password is asked once per device.
export const PACK = "../packs/hj-1a.pack";

const app = document.getElementById("app");
let D; // the loaded files
let engine, lexicon, bookLexicon, units, speaker;

// ---------- small helpers ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const card = (...kids) => h("div", { class: "card" }, ...kids);
const btn = (label, onclick, secondary = false) => h("button", { class: secondary ? "btn secondary" : "btn", onclick }, label);
const row = (label, onclick, right = "›") => h("button", { onclick }, h("span", {}, label), h("span", { class: "chev" }, right));

function screen(title, back, ...content) {
  app.replaceChildren(
    h("header", {},
      back ? h("button", { class: "back", onclick: () => (speaker.stop(), back()) }, "‹ Back") : null,
      h(back ? "h2" : "h1", {}, title),
      back ? h("span", { class: "counter", id: "counter" }) : null),
    ...content);
  window.scrollTo(0, 0);
}
const setCounter = (text) => {
  const c = document.getElementById("counter");
  if (c) c.textContent = text;
};

const say = (text, slow = false) => speaker.speak(text, { slow });
const listen = (text) =>
  h("div", { class: "center" },
    h("button", { class: "speak", onclick: () => say(text) }, "▶ Listen"),
    h("button", { class: "speak", onclick: () => say(text, true) }, "Slow"));
const enFr = (en, fr) => h("div", {}, h("div", {}, en), fr ? h("div", { class: "fr" }, fr) : null);

// iPhone: the voice only starts after a first tap; unlock it on the first touch
let unlocked = false;
document.addEventListener("pointerdown", () => {
  if (unlocked || !globalThis.speechSynthesis) return;
  unlocked = true;
  speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}, true);

// ---------- start ----------

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const getJson = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  const book = null; // the book is open now (no password): it loads like the other files
  const names = Object.keys(FILES).filter((n) => !(book && n in book));
  D = { ...book, ...Object.fromEntries(await Promise.all(names.map(async (n) => [n, await getJson(FILES[n])]))) };
  engine = await H.createEngine({ store: await H.openIdbStore(), path: H.pathFromPack(D.vocab, D.texts) });
  lexicon = H.buildLexicon([D.vocab, D.hsk], D.chars);
  bookLexicon = H.buildLexicon([D.vocab], D.chars); // mock exams: Book 1A only
  units = H.listUnits(D.texts);
  makeSpeaker();
  home();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
}
/** Open the encrypted book: with the saved password, or ask for it (once per device). */
async function unlock(pack) {
  const KEY = "hanyu-book-password";
  let password = localStorage.getItem(KEY);
  let wrong = false;
  for (;;) {
    if (password) {
      try {
        const book = await openPack(pack, password);
        localStorage.setItem(KEY, password);
        return book;
      } catch {
        wrong = true;
      }
    }
    password = await new Promise((resolve) => {
      const input = h("input", { type: "text", autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false", placeholder: "password" });
      const go = () => input.value.trim() && resolve(input.value.trim());
      input.addEventListener("keydown", (e) => e.key === "Enter" && go());
      screen("Hanyu", null, card(h("h3", {}, "Book 1A"), h("p", {}, "Type the password to open the book on this device (only once)."), input,
        wrong ? h("p", { class: "feedback wrong" }, "Wrong password, try again.") : null, btn("Open", go)));
    });
  }
}

function makeSpeaker() {
  speaker = H.createSpeaker({ voiceName: engine.settings.voice, rate: engine.settings.speechRate });
}
start().catch((e) => app.replaceChildren(card(h("p", {}, "Hanyu could not start."), h("p", { class: "muted small" }, e.message))));

// ---------- home ----------

async function home() {
  const p = engine.plan();
  const st = await engine.stats();
  const exam = engine.settings.examDate;
  const stat = (n, label) => h("div", {}, h("div", { class: "stat" }, n), h("div", { class: "muted small" }, label));
  const pct = st.total ? Math.round((100 * st.mastered) / st.total) : 0;
  screen("Hanyu", null,
    card(
      h("h3", {}, "Today"),
      h("div", { class: "stats" }, stat(p.newLeftToday, "new words"), stat(st.dueToday, "to review"), stat(st.streak, "day streak")),
      btn("Study", () => runSession(engine.session(), "Study", home)),
      btn("Dictation", () => runSession(engine.dictation(), "Dictation", home), true)),
    card(
      h("h3", {}, "Book 1A"),
      h("div", { class: "small" }, `${st.mastered} mastered · ${st.learning} learning · ${st.new} new, of ${st.total} words`),
      h("div", { class: "progress" }, h("div", { style: `width:${pct}%` })),
      h("p", { class: "muted small" }, exam ? `Exam on ${exam}: ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left.` : "No exam date yet: set it in Settings."),
      h("p", { class: "muted small", id: "sync" }, syncText())),
    h("div", { class: "card list" },
      row("Mock exam", examStart),
      row("Dialogues", dialogues),
      row("Teacher mode · HSK 1", teacher),
      row("Settings", settings)));
  syncNow();
}

// ---------- sync between devices (cloud.js) ----------

const SYNC = { token: "hanyu-sync-token", gist: "hanyu-sync-gist", last: "hanyu-sync-last" };
const stored = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
let syncing = null;
let lastTry = 0;

/** Sync now (at most every 20 s unless forced); quietly does nothing without a token. */
async function syncNow(force = false) {
  const token = stored(SYNC.token);
  if (!token || syncing || (!force && Date.now() - lastTry < 20_000)) return syncing;
  lastTry = Date.now();
  syncing = (async () => {
    try {
      const r = await createSync({ token, gistId: stored(SYNC.gist) }).sync(engine);
      if (r.gistId) localStorage.setItem(SYNC.gist, r.gistId);
      localStorage.setItem(SYNC.last, JSON.stringify({ ...r, time: Date.now() }));
      if (document.getElementById("sync")) r.received ? home() : (document.getElementById("sync").textContent = syncText());
      return r;
    } finally {
      syncing = null; // whatever happens, the next sync can run
    }
  })();
  return syncing;
}

function syncText() {
  if (!stored(SYNC.token)) return "Sync between devices: off (Settings).";
  const last = JSON.parse(stored(SYNC.last) ?? "null");
  if (!last) return "Sync: not done yet.";
  const ago = Math.round((Date.now() - last.time) / 60_000);
  const when = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} h ago`;
  if (last.ok) return `Synced ${when}${last.received ? ` (${last.received} answers received)` : ""}.`;
  return { offline: `Not synced (no connection), ${when}.`, token: "Not synced: GitHub refused the token (Settings).", scope: "Not synced: this token can do more than sync. For safety, make a new one with only \"gist\" ticked (Settings)." }[last.reason] ?? `Not synced: ${last.message}.`;
}

// ---------- word card (after a question, or a new word) ----------

let strokesData = null;
const strokesOf = async (c) => (await (strokesData ??= fetch(STROKES).then((r) => r.json()).then((d) => d.characters)))[c];

/** The stroke order of one character, drawn stroke by stroke; tap to play again. */
function strokeBox(c) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 1024 1024");
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", "translate(0,900) scale(1,-1)");
  svg.append(g);
  let timer = null;
  const play = async () => {
    const d = await strokesOf(c);
    if (!d) return;
    clearInterval(timer);
    const paths = d.strokes.map((p) => {
      const e = document.createElementNS(NS, "path");
      e.setAttribute("d", p);
      e.setAttribute("class", "stroke todo");
      return e;
    });
    g.replaceChildren(...paths);
    let i = 0;
    timer = setInterval(() => {
      if (i > 0) paths[i - 1].setAttribute("class", "stroke");
      if (i === paths.length) return clearInterval(timer);
      paths[i].setAttribute("class", "stroke now");
      i += 1;
    }, 450);
  };
  svg.addEventListener("click", play);
  play();
  return svg;
}

function wordCard(r) {
  return card(
    h("div", { class: "hanzi" }, r.hanzi),
    h("div", { class: "pinyin center" }, r.pinyin),
    listen(r.speak),
    ...r.senses.map((s) => h("div", { style: "margin-top:8px" }, enFr(s.en, s.fr))),
    ...r.tips.map((t) => h("p", { class: "muted small" }, t.text)),
    ...r.characters.map((c) =>
      h("div", { class: "char" }, strokeBox(c.char),
        h("div", {}, h("span", { class: "big" }, c.char), " ", h("span", { class: "muted" }, c.pinyin.join(", ")), h("div", { class: "small" }, c.note)))));
}

function sentenceCard(s) {
  return card(h("div", { class: "zh" }, s.zh), h("div", { class: "pinyin" }, s.pinyin), listen(s.speak ?? s.zh), enFr(s.en, s.fr));
}

function revealCard(r) {
  if (!r) return null;
  if (r.key) return wordCard(r);
  if (r.question) return h("div", {}, sentenceCard(r.question), sentenceCard(r.answer));
  return sentenceCard(r);
}

// ---------- questions: prompt and ways to answer ----------

function promptView(p) {
  if (p.speak) {
    say(p.speak);
    return h("div", { class: "prompt" }, listen(p.speak));
  }
  if (p.hanzi) return h("div", { class: "prompt hanzi" }, p.hanzi);
  if (p.pinyin) return h("div", { class: "prompt zh" }, p.pinyin);
  if (p.zh) return h("div", { class: "prompt zh" }, p.zh);
  if ("before" in p) return h("div", { class: "prompt" }, h("div", { class: "zh" }, `${p.before}＿＿${p.after}`), p.en ? enFr(p.en, p.fr) : null);
  if (p.en) return h("div", { class: "prompt" }, h("div", { class: "zh" }, p.en), p.fr ? h("div", { class: "fr" }, p.fr) : null);
  return null;
}

function choiceLabel(c) {
  if (c.hanzi) return [c.hanzi];
  if (c.zh) return [h("div", {}, c.zh), c.pinyin ? h("div", { class: "fr" }, c.pinyin) : null];
  if (c.pinyin) return [c.pinyin];
  return [h("div", {}, c.en), c.fr ? h("div", { class: "fr" }, c.fr) : null];
}

/** 4 choices; calls onPick(index) once, then shows which was right. */
function choicesView(choices, answerIndex, onPick) {
  const big = choices.every((c) => c.hanzi || (c.pinyin && !c.zh));
  const buttons = choices.map((c, i) =>
    h("button", { class: big ? "choice big" : "choice", onclick: () => pick(i) }, ...choiceLabel(c)));
  function pick(i) {
    buttons.forEach((b) => (b.disabled = true));
    buttons[answerIndex].classList.add("right");
    if (i !== answerIndex) buttons[i].classList.add("wrong");
    onPick(i);
  }
  return h("div", { class: "choices" }, ...buttons);
}

/** Typed pinyin; calls onCheck(text). */
function typedView(onCheck) {
  const input = h("input", { type: "text", autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false", placeholder: "pinyin with tones: nǐ hǎo or ni3 hao3" });
  const go = h("button", { class: "btn", onclick: () => ((go.disabled = input.disabled = true), onCheck(input.value)) }, "Check");
  input.addEventListener("keydown", (e) => e.key === "Enter" && !go.disabled && go.click());
  setTimeout(() => input.focus(), 50);
  return h("div", {}, input, go);
}

function pinyinFeedback(r) {
  if (r.correct) return r.lightTone ? `Right. The book writes it light: ${r.expected}` : `Right: ${r.expected}`;
  const why = { "tones-missing": "Add the tones.", tone: "A tone is wrong.", spelling: "The spelling is wrong.", empty: "Nothing typed." }[r.reason] ?? "";
  return `${why} Answer: ${r.expected}`;
}

/** Word order: tap tiles to build the sentence; calls onDone(tile indexes). */
function orderView(tiles, onDone) {
  const chosen = [];
  const answer = h("div", { class: "tiles answer" });
  const pool = h("div", { class: "tiles" });
  const check = h("button", { class: "btn", onclick: () => ((check.disabled = true), (locked = true), onDone([...chosen])) }, "Check");
  let locked = false;
  const draw = () => {
    answer.replaceChildren(...chosen.map((i, k) => h("button", { class: "tile", onclick: () => locked || (chosen.splice(k, 1), draw()) }, tiles[i])));
    pool.replaceChildren(...tiles.map((t, i) => (chosen.includes(i) ? null : h("button", { class: "tile", onclick: () => locked || (chosen.push(i), draw()) }, t))));
    check.disabled = locked || chosen.length !== tiles.length;
  };
  draw();
  return h("div", {}, answer, pool, check);
}

/** Self-marked: show the answer, then "Got it" / "Not yet"; calls onGrade(selfGrade). */
function selfView(showAnswer, onGrade) {
  const box = h("div");
  let graded = false; // a double tap must not mark the next question too
  const grade = (g) => {
    if (graded) return;
    graded = true;
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    onGrade(g);
  };
  box.append(btn("Show the answer", () => {
    box.replaceChildren(showAnswer(),
      h("div", { class: "row" }, btn("Not yet", () => grade(1), true), btn("Got it", () => grade(3))));
  }));
  return box;
}

const feedback = (ok, text) => h("p", { class: ok ? "feedback right" : "feedback wrong" }, text ?? (ok ? "Right!" : "Not quite."));

// ---------- study sessions (study, dictation, teacher mode) ----------

function runSession(s, title, back) {
  const next = () => {
    if (s.done) return sessionDone(s, title, back);
    setTimeout(() => setCounter(`${s.remaining} left`));
    return s.current.type === "intro" ? newWord(s, title, back, next) : ask(s, title, back, next);
  };
  next();
}

function newWord(s, title, back, next) {
  const r = H.revealOf(lexicon.words.get(s.current.key), lexicon);
  screen(title, back, h("p", { class: "instruction center" }, "New word"), wordCard(r), btn("Next", () => (s.next(), next())));
  say(r.speak);
}

function ask(s, title, back, next) {
  const q = H.makeQuestion(s.current, { lexicon, maxLesson: engine.reachedLesson() });
  const t0 = Date.now();
  const after = h("div");
  const done = async (result, text) => {
    const out = await s.answer({ ...result, ms: Date.now() - t0 });
    after.replaceChildren(feedback(out.correct, text), wordCard(q.reveal), btn("Next", next));
    if (q.kind !== "self") say(q.reveal.speak);
  };
  const what = { meaning: "What does it mean?", listening: "Which word do you hear?", recall: "Which word means this?", pinyin: "Type the pinyin, with tones.", write: "Write it on paper." }[q.skill];
  let answer;
  if (q.kind === "choice") answer = choicesView(q.choices, q.answerIndex, (i) => done(H.checkAnswer(q, i)));
  else if (q.kind === "typed") answer = typedView((text) => { const r = H.checkAnswer(q, text); done({ correct: r.correct }, pinyinFeedback(r)); });
  else answer = selfView(() => wordCard(q.reveal), (g) => done({ selfGrade: g }));
  screen(title, back, h("p", { class: "instruction center" }, what), promptView(q.prompt), answer, after);
}

function sessionDone(s, title, back) {
  const st = s.stats;
  screen(title, back,
    card(h("h3", {}, "Done"), h("p", {}, `${st.correct} right out of ${st.asked} answers. Best streak: ${st.bestStreak}.`)),
    btn("Home", home));
}

// ---------- mock exam ----------

function examStart() {
  const lessons = h("input", { type: "text", placeholder: "e.g. 11-15", inputmode: "numeric" });
  screen("Mock exam", home,
    card(h("p", {}, "60 questions like a real paper: listening, vocabulary, reading, writing. Keep paper and a pen for the dictation."),
      btn("Start: whole book", () => runExam(null))),
    card(h("label", {}, "Only some lessons"), lessons,
      btn("Start these lessons", () => {
        const [a, b = a] = lessons.value.split(/[-–\s]+/).filter(Boolean).map(Number);
        const [lo, hi] = [Math.max(1, Math.min(a, b)), Math.min(15, Math.max(a, b))]; // "15-11" works too
        if (lo <= hi) runExam(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      }, true)));
}

function runExam(lessons) {
  const seed = Date.now() % 1e9;
  const exam = H.buildExam({ lexicon: bookLexicon, texts: D.texts, measureWords: D.measureWords, rng: H.seededRandom(seed), seed, lessons, prefer: engine.weakest(30).map((w) => w.key) });
  const results = [];
  const show = (i) => {
    if (i === exam.items.length) return examDone(exam, results);
    const it = exam.items[i];
    const section = H.EXAM_SECTIONS.find((s) => s.id === it.section).title;
    const after = h("div");
    const done = (r, text) => {
      results[i] = r;
      after.replaceChildren(feedback(r.correct, text), revealCard(it.reveal), btn(i + 1 === exam.items.length ? "See my score" : "Next", () => show(i + 1)));
    };
    let answer;
    if (it.kind === "choice") answer = choicesView(it.choices, it.answerIndex, (k) => done(H.checkExamAnswer(it, k)));
    else if (it.kind === "typed") answer = typedView((text) => { const r = H.checkExamAnswer(it, text); done(r, pinyinFeedback(r)); });
    else if (it.kind === "order") answer = orderView(it.prompt.tiles, (idx) => { const r = H.checkExamAnswer(it, idx); done(r, r.correct ? "Right!" : `Answer: ${it.accept[0]}${it.prompt.end ?? ""}`); });
    else answer = selfView(() => revealCard(it.reveal), (g) => done(H.checkExamAnswer(it, { selfGrade: g })));
    const prompt = it.kind === "order" ? h("div", { class: "prompt" }, enFr(it.prompt.en, it.prompt.fr)) : promptView(it.prompt);
    screen("Mock exam", examStart, h("p", { class: "instruction center" }, `${section} · ${it.instruction}`), prompt, answer, after);
    setCounter(`${i + 1}/${exam.items.length}`);
  };
  show(0);
}

async function examDone(exam, results) {
  const sum = await engine.recordExam(exam, results);
  screen("Mock exam", home,
    card(h("h3", {}, "Score"), h("div", { class: "stat center" }, `${sum.percent}%`), h("p", { class: "center muted" }, `${sum.correct} / ${sum.total}`)),
    card(...H.EXAM_SECTIONS.filter((s) => sum.sections[s.id]).map((s) => h("div", { class: "line" }, `${s.title}: ${sum.sections[s.id].correct} / ${sum.sections[s.id].total}`))),
    h("p", { class: "muted small" }, "Words you missed come back in your next study sessions."),
    btn("Home", home));
}

// ---------- dialogues (conversation mode) ----------

const convCtx = () => ({ lexicon, units, substitutions: D.substitutions, maxLesson: engine.reachedLesson() });

function dialogues() {
  const groups = new Map();
  for (const u of units) {
    const name = u.lesson ? `Lesson ${u.lesson}` : "Classroom Chinese";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(u);
  }
  screen("Dialogues", home, ...[...groups].map(([name, us]) =>
    h("div", { class: "card list" }, h("h3", {}, name), ...us.map((u) => row(h("span", {}, u.title.zh, " ", h("span", { class: "muted small" }, u.title.en)), () => chooseRole(u))))));
}

function chooseRole(u) {
  if (u.speakers.length === 1) return levels(u, u.speakers[0].label);
  const best = H.defaultRole(u);
  screen(u.title.zh, dialogues, card(h("h3", {}, "Play as"), h("div", { class: "list" },
    ...u.speakers.map((s) => row(h("span", {}, s.label, " ", h("span", { class: "muted small" }, s.pinyin)), () => levels(u, s.label), s.label === best ? "suggested ›" : "›")))));
}

function levels(u, role) {
  const list = H.levelsFor(u, role, convCtx());
  const prog = engine.conversationProgress(u, list);
  const back = () => (u.speakers.length === 1 ? dialogues() : chooseRole(u));
  screen(u.title.zh, back,
    h("p", { class: "instruction center" }, `${u.title.en} · you are ${role}`),
    h("div", { class: "card list" }, ...prog.map((p) =>
      row(p.title, () => p.open && playLevel(u, role, p.level),
        p.passed ? h("span", { class: p.due ? "badge due" : "badge passed" }, p.due ? "review" : "passed") : p.open ? "›" : h("span", { class: "badge" }, "locked")))));
}

function playLevel(u, role, level) {
  const script = H.buildLevel(u, level, { ...convCtx(), role });
  const results = [];
  const back = () => levels(u, role);
  const show = async (i) => {
    if (i === script.steps.length) {
      const r = await engine.recordLevel(script, results);
      return screen(script.title, back,
        card(h("div", { class: "stat center" }, r.answered ? `${Math.round(r.score * 100)}%` : "Done"),
          h("p", { class: "center" }, r.passed ? "Level passed." : "Not passed yet: 80% opens the next level.")),
        btn("Back to the levels", back));
    }
    const st = script.steps[i];
    const next = () => show(i + 1);
    const after = h("div");
    const mark = (r, text) => ((results[i] = r), after.replaceChildren(feedback(r.correct, text), btn("Next", next)));
    const lineView = (l) => card(h("div", { class: "who" }, l.speaker), h("div", { class: "zh" }, l.zh), h("div", { class: "pinyin" }, l.pinyin), enFr(l.en, l.fr), listen(l.speak));
    let body;
    if (st.type === "scene") {
      body = [card(h("div", { class: "muted" }, st.zh), enFr(st.en, st.fr)), btn("Next", next)];
    } else if (st.type === "line") {
      say(st.speak);
      body = [lineView(st), btn("Next", next)];
    } else if (st.type === "shadow") {
      say(st.speak);
      body = [h("p", { class: "instruction center" }, "Say it right after the voice."), lineView(st),
        h("div", { class: "row" }, btn("Not yet", () => ((results[i] = H.checkStep(st, { selfGrade: 1 })), next()), true), btn("Got it", () => ((results[i] = H.checkStep(st, { selfGrade: 3 })), next())))];
    } else if (st.type === "reply" || st.type === "meaning") {
      const p = st.type === "reply" ? st.prompt : st.line;
      say(p.speak);
      body = [h("p", { class: "instruction center" }, st.type === "reply" ? "What do you answer?" : "What does it mean?"),
        st.type === "reply" ? card(h("div", { class: "who" }, p.speaker), h("div", { class: "zh" }, p.zh), listen(p.speak)) : h("div", { class: "prompt" }, listen(p.speak)),
        choicesView(st.choices, st.answerIndex, (k) => {
          const r = H.checkStep(st, k);
          mark(r, st.type === "reply" ? `${r.correct ? "Right!" : "Not quite."} ${st.line.en}` : undefined);
        }), after];
    } else if (st.type === "build") {
      body = [h("p", { class: "instruction center" }, "Put the words in order."), h("div", { class: "prompt" }, enFr(st.line.en, st.line.fr)),
        orderView(st.tiles, (idx) => { const r = H.checkStep(st, idx); mark(r, r.correct ? "Right!" : `Answer: ${r.expected}`); }), after];
    } else if (st.type === "say") {
      body = [h("p", { class: "instruction center" }, "Your turn: say it in Chinese."), card(h("div", { class: "who" }, `${role} (you)`), enFr(st.prompt.en, st.prompt.fr)),
        selfView(() => (say(st.line.speak), lineView(st.line)), (g) => ((results[i] = H.checkStep(st, { selfGrade: g })), next()))];
    }
    screen(script.title, back, ...(script.changes && i === 0 ? [h("p", { class: "muted small center" }, "Changed: " + script.changes.map((c) => `${c.from.zh} → ${c.to.zh}`).join(", "))] : []), ...body);
    setCounter(`${i + 1}/${script.steps.length}`);
  };
  show(0);
}

// ---------- teacher mode ----------

function teacher() {
  const num = (value) => h("input", { type: "number", inputmode: "numeric", value: String(value), min: "1" });
  const from = num(1);
  const to = num(200);
  const count = num(20);
  const go = (skills) => {
    const keys = H.pathFromHsk(D.hsk).filter((w) => w.n >= Number(from.value) && w.n <= Number(to.value)).map((w) => w.key);
    if (keys.length) runSession(engine.teacher({ keys, count: Number(count.value) || 20, skills }), "Teacher mode", teacher);
  };
  screen("Teacher mode", home,
    card(h("p", { class: "small" }, "Random words from the official HSK 1 list, like the teacher in class."),
      h("div", { class: "row" }, h("div", {}, h("label", {}, "From word"), from), h("div", {}, h("label", {}, "To word"), to)),
      h("label", {}, "How many words"), count,
      btn("Quiz", () => go(undefined)),
      btn("Dictation", () => go(["write"]), true)));
}

// ---------- settings ----------

function syncCard() {
  const token = h("input", { type: "password", autocomplete: "off", placeholder: "GitHub token (gist)", value: stored(SYNC.token) ?? "" });
  const msg = h("p", { class: "muted small" }, syncText());
  const run = async () => {
    msg.textContent = "Syncing…";
    await syncNow(true);
    msg.textContent = syncText();
  };
  return card(h("h3", {}, "Sync between devices"),
    h("p", { class: "small" }, "Your progress goes to a private file on your GitHub, and comes back on your other devices. Paste the same token on each device."),
    token,
    btn("Save and sync", () => (token.value.trim() ? localStorage.setItem(SYNC.token, token.value.trim()) : localStorage.removeItem(SYNC.token), run())),
    btn("Sync now", run, true),
    msg);
}

async function settings() {
  const s = engine.settings;
  const date = h("input", { type: "date", value: s.examDate ?? "" });
  date.addEventListener("change", () => engine.setSettings({ examDate: date.value || null }));
  const voices = await speaker.list();
  const voice = h("select", {}, h("option", { value: "" }, "Best available"),
    h("option", { value: H.SYSTEM, selected: s.voice === H.SYSTEM }, "System voice (iPhone/Mac settings)"),
    ...voices.map((v) => h("option", { value: v.name, selected: v.name === s.voice }, `${v.name} · ${v.quality}${v.offline ? "" : " · needs internet"}`)));
  voice.addEventListener("change", async () => (await engine.setSettings({ voice: voice.value || null }), makeSpeaker()));
  const rate = h("select", {}, ...[0.8, 0.9, 1, 1.1].map((r) => h("option", { value: String(r), selected: r === s.speechRate }, r === 1 ? "Normal" : `${r}×`)));
  rate.addEventListener("change", async () => (await engine.setSettings({ speechRate: Number(rate.value) }), makeSpeaker()));
  const msg = h("p", { class: "muted small" });
  const file = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
  file.addEventListener("change", async () => {
    try {
      const r = await engine.importData(JSON.parse(await file.files[0].text()));
      msg.textContent = `Merged: ${r.reviews} answers in total.`;
    } catch (e) {
      msg.textContent = `Not imported: ${e.message}`;
    }
  });
  screen("Settings", home,
    card(h("label", {}, "Exam date"), date),
    card(h("label", {}, "Voice"), voice,
      h("p", { class: "muted small" }, "iPhone hides Premium voices from web apps. \"System voice\" reads with the Mandarin voice chosen in Settings → Accessibility → Spoken Content → Voices → Chinese → Mandarin."),
      voices.length ? null : h("p", { class: "small" }, "No Chinese voice on this device. iPhone: Settings → Accessibility → Spoken Content → Voices → Chinese (China mainland) → Han (Premium)."),
      h("label", {}, "Speed"), rate,
      btn("Test the voice", () => say("你好！我是汉语老师。"), true)),
    syncCard(),
    card(h("h3", {}, "Backup"),
      btn("Save my progress to a file", async () => {
        const blob = new Blob([JSON.stringify(await engine.exportData())], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `hanyu-progress-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
      }, true),
      btn("Add progress from a file", () => file.click(), true), file, msg),
    h("p", { class: "muted small center" }, `Hanyu ${VERSION} · ${navigator.serviceWorker?.controller ? "ready offline" : "not yet ready offline (open once more)"}`));
}
