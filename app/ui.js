// Hanyu front end (in progress, see DESIGN.md). Each tab is a function that redraws #app.
// Same data, engine and device storage as the test page (index.html), so progress is shared.

import * as H from "./engine/index.js";
import { runStudy, booksName } from "./study.js";
import { bookTab } from "./book.js";
import { openDialogue } from "./talk.js";
import { practiceTab } from "./practice.js";
import { examTab } from "./examtab.js";
import { meTab, syncNow } from "./me.js";
import { installMotion } from "./motion.js";
import { installCard, installGuide, offerInstall } from "./share.js";
import { fixPage } from "./fix.js";

// the books, in class order (lesson numbers run on: 1A = 1-15, 1B = 16-25)
const BOOKS = [{ id: "hj-1a", name: "1A" }, { id: "hj-1b", name: "1B" }];
const FILES = {
  ...Object.fromEntries(BOOKS.flatMap((b) => [[`${b.id}/vocab`, `../packs/${b.id}/vocab.json`], [`${b.id}/texts`, `../packs/${b.id}/texts.json`]])),
  chars: "../data/open/characters.json",
  hsk: "../data/open/hsk-2025.json",
  substitutions: "../data/open/substitutions.json",
  measureWords: "../data/open/measure-words.json",
};

const app = document.getElementById("app");
const motion = installMotion(app);
const tabbar = document.getElementById("tabbar");
let D, engine, lexicon, speaker;
// L = every book with its own word list, the dialogues and texts of all of them
let L;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const NS = "http://www.w3.org/2000/svg";
function svg(viewBox, inner) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = inner; // static markup written here, never data
  return s;
}

// ---------- tabs ----------

const ICONS = {
  today: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/><circle cx="12" cy="12" r="3.2"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  practice: '<rect x="3.5" y="7" width="13" height="13.5" rx="2.5"/><path d="M8 3.5h10a2.5 2.5 0 0 1 2.5 2.5v10"/>',
  exam: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 9.5l2 2 4-4M8.5 15.5h7"/>',
  me: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5"/>',
};
const TABS = [
  ["today", "Today", today],
  ["book", "Book", () => bookTab({ app, engine, lexicon, books: L.books, say, sayOpen, stop: stopVoice, tabbar, study: (s) => study(s, "book") })],
  ["practice", "Practice", () => practiceTab({ app, engine, lexicon, books: L.books, units: L.units, say, sayOpen, stop: stopVoice, tabbar, afterMove: motion.afterMove, alive: stillOn(shown),
    missed: async () => (await engine.missed()).filter((m) => lexicon.words.has(m.key)).length,
    openFix, study: (s, back) => study(s, back),
    openDialogue: (u, back) => openDialogue({ app, engine, lexicon, units: L.units, substitutions: D.substitutions, say, sayOpen, hush, stop: stopVoice, tabbar, back }, u) })],
  ["exam", "Exam", () => examTab({ app, engine, lexicon, bookLexicon: L.bookLexicon, books: L.books, texts: L.texts, D, say, sayOpen, hush, stop: stopVoice, tabbar, study: (s) => study(s, "exam"), back: () => show("exam") })],
  ["me", "Me", () => meTab({ app, engine, say, speaker: () => speaker, remakeSpeaker, books: L.books, choosePlan, alive: stillOn(shown), afterReset: () => show("today") })],
];
let current = "today";

// a screen that takes a moment to prepare (Me waits for the voices, Today for the numbers)
// is dropped if you have moved on meanwhile, instead of appearing late over another screen
let shown = 0;
const stillOn = (n) => () => n === shown && !tabbar.hidden;
function show(id) {
  stopVoice(); // stop current speech and invalidate a delayed voice from the screen we are leaving
  current = id;
  shown += 1;
  tabbar.replaceChildren(...TABS.map(([tid, label]) =>
    h("button", { class: "tab", "aria-current": tid === id ? "page" : null, onclick: () => show(tid) }, // the tab you are on: back to its first page, like iOS
      svg("0 0 24 24", ICONS[tid]), label)));
  TABS.find(([tid]) => tid === id)[2]();
  window.scrollTo(0, 0);
}


// ---------- today ----------

let ringDrawn = false;
function ring(fraction) {
  const r = 95;
  const c = 2 * Math.PI * r;
  const s = svg("0 0 232 232", `<circle class="ring-track" cx="116" cy="116" r="${r}"/><circle class="ring-fill" cx="116" cy="116" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}"/>`);
  // draws once per launch (the screen's one authored moment); after that it is simply there
  const fill = s.querySelector(".ring-fill");
  const set = () => (fill.style.strokeDashoffset = String(c * (1 - fraction)));
  if (ringDrawn) {
    fill.style.transition = "none";
    set();
  } else {
    ringDrawn = true;
    requestAnimationFrame(() => requestAnimationFrame(set));
  }
  return s;
}

/** Today's work in answers: done today against what is left (a new word = 4 questions). */
async function dayProgress() {
  const p = engine.plan();
  const st = await engine.stats();
  const left = p.newLeftToday * 4 + st.dueToday;
  return { p, st, left, fraction: left ? st.answersToday / (st.answersToday + left) : 1 }; // nothing left = the day is complete
}

function dayRing({ fraction, left }) {
  const pct = Math.round(fraction * 100);
  return h("div", { class: "ring-wrap", role: "img", "aria-label": `${pct}% of today's work done` },
    ring(fraction),
    h("div", { class: "ring-center" },
      h("div", { class: "ring-pct" }, String(pct), h("small", {}, "%")),
      h("div", { class: "ring-label" }, left ? "of today" : "Day complete")));
}

// the voice: `say` speaks now (a tap on Listen, an answer just given); `sayOpen` is for the voice
// that plays by itself when a screen opens: it waits until the screen has moved in, then a short
// pause so people can read first. Any newer voice, or leaving the screen, cancels a waiting one.
const VOICE_PAUSE = 700; // ms after the screen is in
let voiceTurn = 0;
const say = async (text, slow = false) => {
  const turn = (voiceTurn += 1);
  await speaker.voices(); // the voice list may take a moment the first time: a stop meanwhile wins
  if (turn !== voiceTurn) return { ok: false, reason: "stopped" };
  return speaker.speak(text, { slow });
};
const sayOpen = (text) => {
  const turn = (voiceTurn += 1);
  motion.afterMove()
    .then(() => new Promise((r) => setTimeout(r, VOICE_PAUSE)))
    // Route through say(): the screen may have changed while the OS voice list was loading.
    // say() checks the turn again after that asynchronous wait, preventing a stale prompt from
    // starting after the learner has already answered or moved to another screen.
    .then(() => turn === voiceTurn && say(text));
};
const stopVoice = () => ((voiceTurn += 1), speaker.stop());
const hush = () => (voiceTurn += 1); // a voice still waiting won't play (an answer given before it spoke)
// the app put in the background: a waiting voice must not play when it comes back
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && stopVoice());
const remakeSpeaker = () => (speaker = H.createSpeaker({ voiceName: engine.settings.voice, rate: engine.settings.speechRate }));
// sync: at launch, back on Today, and when the app comes back to the front; new answers redraw Today
const sync = () => syncNow(engine, { onReceived: () => {
  if (tabbar.hidden) return; // in a session: it stays as it is
  if (current === "today") show("today");
  else if (current === "fix") openFix(); // new answers from another device: the list is redone
} });

function study(session, back = "today") {
  // the end screen shows the ring as it is after the session
  const ringNow = () => {
    const box = h("div");
    dayProgress().then((d) => box.replaceChildren(dayRing(d)));
    return box;
  };
  runStudy(session, { app, engine, lexicon, say, sayOpen, hush, stop: stopVoice, tabbar, dayRing: ringNow, onExit: typeof back === "function" ? back : () => show(back) });
}

/** Practice › Words to fix; its practice sessions come back to it. */
function openFix() {
  // a page of its own: a sync bringing new answers redraws Today only when Today is on screen
  current = "fix";
  shown += 1;
  fixPage({ app, engine, lexicon, alive: stillOn(shown), study: (s) => study(s, openFix), back: () => show("practice") });
}

async function today() {
  const alive = stillOn(shown);
  const { p, st, left, fraction } = await dayProgress();
  if (!alive()) return;
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const exam = engine.settings.examDate;
  const countdown = exam && p.daysLeft >= 0
    ? `${p.daysLeft === 0 ? "Today" : `${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}`}`
    : exam ? "Passed" : "Not set";

  app.replaceChildren(h("div", { class: "view" },
    location.hostname.endsWith(".github.io") ? h("section", { class: "migration-card" },
      h("b", {}, "Hanyu has moved to hanyu86.com"),
      h("p", {}, "To keep your progress, open Me → Backup → Save my progress to a file. Then open the new app and choose Me → Backup → Add progress from a file."),
      h("div", { class: "migration-actions" },
        h("button", { class: "pill quiet", onclick: () => show("me") }, "Open Me settings"),
        h("a", { class: "pill", href: "https://hanyu86.com/app/" }, "Open new Hanyu"))) : null,
    installCard(installGuide),
    h("h1", { class: "large-title" }, "Today"),
    h("p", { class: "subtitle" }, date),
    dayRing({ fraction, left }),
    h("div", { class: "figures" },
      h("div", { class: "figure" }, h("b", {}, String(p.newLeftToday)), h("span", {}, "new words")),
      h("div", { class: "figure" }, h("b", {}, String(st.dueToday)), h("span", {}, "to review")),
      h("div", { class: "figure" }, h("b", {}, String(st.streak)), h("span", {}, st.streak === 1 ? "day streak" : "days streak"))),
    h("button", { class: "pill", onclick: () => study(engine.session()), disabled: !left }, left ? "Start studying" : "All done for today"),
    h("div", { class: "group" },
      h("div", { class: "cell" }, h("span", { class: "glyph" }, "考"), h("span", { class: "label" }, "Exam"), h("span", { class: "value" }, countdown)),
      h("div", { class: "cell" }, h("span", { class: "glyph" }, "书"), h("span", { class: "label" }, `${booksName(L.books, planBooks())} mastered`), h("span", { class: "value" }, `${st.mastered} / ${st.total}`)))));
}

/** All the books: each with its own word list; one dictionary, all dialogues, all texts. */
function loadBooks() {
  const books = BOOKS.map((b) => ({ ...b, vocab: D[`${b.id}/vocab`], texts: D[`${b.id}/texts`] }));
  for (const b of books) b.path = H.pathFromPack(b.vocab, b.texts);
  L = {
    books,
    units: books.flatMap((b) => H.listUnits(b.texts)),
    // every text (mock exams take their lines from here, limited to the chosen lessons)
    texts: { pack: "books", lessons: books.flatMap((b) => b.texts.lessons) },
    bookLexicon: H.buildLexicon(books.map((b) => b.vocab), D.chars),
  };
  lexicon = H.buildLexicon([...books.map((b) => b.vocab), D.hsk], D.chars);
}

/** The books of the daily plan (setting planBooks, chosen in Me), in book order. */
const planBooks = (settings = engine.settings) => BOOKS.map((b) => b.id).filter((id) => (settings.planBooks ?? ["hj-1a"]).includes(id));
const planPath = (ids) => H.pathFromBooks(L.books.filter((b) => ids.includes(b.id)));

/** The learner changes the books of the daily plan (Me): Today follows, progress stays. */
async function choosePlan(ids) {
  await engine.setSettings({ planBooks: ids });
  engine.setPath(planPath(ids));
}

// ---------- start ----------

// iPhone: the voice only starts after a first tap (Safari's rule). The voice of a new screen now
// comes a moment after the tap, so the voice is unlocked by an empty sentence on the first touch,
// on every event Safari may count as the tap
const UNLOCK = ["pointerdown", "touchend", "click"];
function unlockVoice() {
  for (const e of UNLOCK) document.removeEventListener(e, unlockVoice, true);
  if (globalThis.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}
for (const e of UNLOCK) document.addEventListener(e, unlockVoice, true);

// on the Mac: 1-4 picks a choice, Enter presses the only button at the bottom (Next, Continue…)
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, select, textarea") || document.querySelector(".pad:not([hidden])")) return;
  if (e.key === "Enter" && e.target.closest?.("button")) return; // a focused button (a line, a choice) takes Enter itself
  const choices = [...document.querySelectorAll(".choice:not([disabled])")];
  if (/^[1-4]$/.test(e.key) && choices[e.key - 1]) return (e.preventDefault(), choices[e.key - 1].click());
  const pills = [...document.querySelectorAll(".study-foot .pill:not([disabled])")];
  if (e.key === "Enter" && pills.length === 1) (e.preventDefault(), pills[0].click());
});

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  // the loading screen (app/index.html): its bar follows the files as they arrive, and creeps
  // on slowly meanwhile so a slow line never looks stuck
  const bar = document.querySelector(".loading-bar > div");
  const names = Object.keys(FILES);
  let done = 0;
  const t0 = performance.now();
  const paint = () => bar && (bar.style.transform = `scaleX(${Math.max(done / names.length, 0.85 * (1 - Math.exp(-(performance.now() - t0) / 6000)))})`);
  const creep = setInterval(paint, 200);
  const getJson = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const j = await r.json();
    done += 1;
    paint();
    return j;
  };
  // everything is open: the book loads like the rest, no password
  D = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await getJson(FILES[n])])).finally(() => clearInterval(creep)));
  const store = await H.openIdbStore();
  loadBooks();
  engine = await H.createEngine({ store, path: planPath(planBooks({ ...H.DEFAULT_SETTINGS, ...(await store.getMeta("settings")) })) });
  remakeSpeaker();
  globalThis.hanyu = { engine }; // for the browser checks (app/test) and debugging
  tabbar.hidden = false;
  show("today");
  offerInstall(); // opened from a link in the browser: offer to add it to the Home Screen
  sync();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
}
start().catch((e) => app.replaceChildren(h("div", { class: "view" }, h("p", { class: "empty" }, "Hanyu could not start.", h("br"), e.message))));
