// Study screens of the new front end: new word, the 5 kinds of questions, the pinyin keyboard,
// the word card after every answer (always waits for Next), a checkpoint every 20 answers,
// and the end screen. Works on any engine Session (study, dictation, teacher mode).

import * as H from "./engine/index.js";

const NS = "http://www.w3.org/2000/svg";
const CHECKPOINT = 20;
let strokes = null;
const strokesOf = async (c) => (await (strokes ??= fetch("../data/open/strokes.json").then((r) => r.json()).then((d) => d.characters)))[c];

export function h(tag, attrs = {}, ...kids) {
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
export function icon(inner, viewBox = "0 0 24 24") {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = inner; // static markup written in this file, never data
  return s;
}

/**
 * Book chips: one toggle per book (1A, 1B…), any mix of them, at least one kept on.
 * books = [{id, name}], selected = [ids], onChange(ids in book order).
 */
export function bookChips(books, selected, onChange, label = "Books") {
  let on = [...selected];
  const buttons = books.map((b) =>
    h("button", { "aria-pressed": String(on.includes(b.id)), onclick: () => {
      const next = on.includes(b.id) ? on.filter((x) => x !== b.id) : [...on, b.id];
      if (!next.length) return;
      on = books.map((x) => x.id).filter((x) => next.includes(x));
      buttons.forEach((btn, i) => btn.setAttribute("aria-pressed", String(on.includes(books[i].id))));
      onChange(on);
    } }, b.name));
  return h("div", { class: "segmented chips", role: "group", "aria-label": label }, ...buttons);
}

/** "Book 1A", "Books 1A + 1B" */
export const booksName = (books, ids) => {
  const names = books.filter((b) => ids.includes(b.id)).map((b) => b.name);
  return `${names.length > 1 ? "Books" : "Book"} ${names.join(" + ")}`;
};
const I = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  slow: '<path d="M2.5 16a8 7.5 0 0 1 16 0z"/><path d="M6.5 16l2.6-5h2.8l2.6 5"/><circle cx="20.6" cy="12.6" r="2"/><path d="M5.5 16v3M15.5 16v3"/>', // a turtle: slowly
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  back: '<path d="M10 7H6.5a1.5 1.5 0 0 0-1.1.5L2 12l3.4 4.5c.3.3.7.5 1.1.5H10"/><path d="M22 7H10v10h12zM13 10l4 4M17 10l-4 4"/>',
};

// ---------- pieces ----------

/** Stroke order of one character, drawn stroke by stroke once; tap to replay. */
function strokeBox(c) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 1024 1024");
  s.setAttribute("class", "strokes");
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", "translate(0,900) scale(1,-1)");
  s.append(g);
  let timer = null;
  const play = async () => {
    const d = await strokesOf(c);
    if (!d) return;
    clearInterval(timer);
    const paths = d.strokes.map((p) => {
      const e = document.createElementNS(NS, "path");
      e.setAttribute("d", p);
      e.setAttribute("class", "todo");
      return e;
    });
    g.replaceChildren(...paths);
    let i = 0;
    timer = setInterval(() => {
      if (i > 0) paths[i - 1].setAttribute("class", "done");
      if (i === paths.length || !s.isConnected) return clearInterval(timer);
      paths[i].setAttribute("class", "now");
      i += 1;
    }, 420);
  };
  s.addEventListener("click", play);
  setTimeout(play, 250);
  return s;
}

/** "Can't listen now" under a question with sound (in class, a quiet place). */
export function cantListen(onclick) {
  return h("button", { class: "cant-listen", onclick }, icon(I.mute), "Can't listen now");
}

function listen(ctx, text) {
  return h("div", { class: "listen" },
    h("button", { class: "round", "aria-label": "Listen", onclick: () => ctx.say(text) }, icon(I.play)),
    h("button", { class: "round", "aria-label": "Listen slowly", onclick: () => ctx.say(text, true) }, icon(I.slow)));
}

/** The full card of a word: shown for a new word and after every answer. */
export function wordCard(ctx, r, { strokes = false } = {}) {
  return h("section", { class: "word" },
    h("div", { class: "word-head" },
      h("div", {}, h("div", { class: "word-hanzi" }, r.hanzi), h("div", { class: "word-pinyin" }, r.pinyin)),
      listen(ctx, r.speak)),
    h("div", { class: "senses" }, ...r.senses.map((s) => h("div", { class: "sense" }, h("div", {}, s.en), s.fr ? h("div", { class: "fr" }, s.fr) : null))),
    // the Chinese of a tip with its pinyin under it, so a beginner can read it
    ...r.tips.map((t) => h("p", { class: "tip" }, ...t.parts.map(([text, py]) => py
      ? h("span", { class: "tip-zh" }, h("span", { class: "hanzi-kai" }, text), h("span", { class: "tip-py" }, py))
      : text))),
    h("div", { class: "chars" }, ...r.characters.map((c) =>
      h("div", { class: "char" },
        strokes ? strokeBox(c.char) : h("div", { class: "char-glyph" }, c.char),
        h("div", { class: "char-text" },
          h("div", {}, h("span", { class: "char-big" }, c.char), " ", h("span", { class: "muted" }, c.pinyin.join(", "))),
          c.note ? h("div", { class: "small muted" }, c.note) : null)))));
}

/** Turns typed "ni3hao3" into "nǐhǎo" as you type (the checker reads both). */
function marksOf(raw) {
  return raw.replace(/([a-zü]+)([1-5])/g, (m, letters, tone) => {
    try {
      return H.toMarks(letters.replace(/ü/g, "v") + tone);
    } catch {
      return m;
    }
  });
}

/** The pinyin keyboard: letters, ü, the 4 tones and the light tone. Calls onCheck(text). */
export function pinyinPad(onCheck) {
  let raw = "";
  let locked = false;
  const shown = h("div", { class: "typed", "aria-live": "polite" });
  const draw = () => {
    // checked: the blinking cursor goes away
    shown.replaceChildren(raw ? marksOf(raw) : h("span", { class: "placeholder" }, "Type the pinyin"), ...(locked ? [] : [h("span", { class: "caret" })]));
    check.disabled = locked || !raw.trim();
  };
  const key = (label, value, cls = "") =>
    h("button", { class: `key ${cls}`, onpointerdown: (e) => (e.preventDefault(), !locked && press(value)) }, label);
  const press = (v) => {
    if (v === "back") raw = raw.slice(0, -1);
    else if (v === " ") raw = raw && !raw.endsWith(" ") ? raw + " " : raw;
    else raw += v;
    draw();
  };
  // once checked, the keyboard goes away so the answer and the word card take its place
  const check = h("button", { class: "pill", onclick: () => ((locked = true), draw(), (pad.hidden = true), onCheck(raw)) }, "Check");
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((r) => [...r]);
  const pad = h("div", { class: "pad" },
    h("div", { class: "pad-row" }, ...rows[0].map((c) => key(c, c))),
    h("div", { class: "pad-row" }, ...rows[1].map((c) => key(c, c))),
    h("div", { class: "pad-row" }, ...rows[2].map((c) => key(c, c)), key("ü", "ü"), key(icon(I.back), "back", "wide")),
    h("div", { class: "pad-row tones" },
      key("ā", "1", "tone"), key("á", "2", "tone"), key("ǎ", "3", "tone"), key("à", "4", "tone"), key("a", "5", "tone"), key("space", " ", "space")));
  // on the Mac: the real keyboard types too (letters, 1-5 for the tones, v for ü, Backspace, Enter)
  const onKey = (e) => {
    if (!pad.isConnected) return document.removeEventListener("keydown", onKey);
    if (locked || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (/^[a-zü]$/.test(k)) press(k);
    else if (/^[1-5]$/.test(k)) press(k);
    else if (k === " ") press(" ");
    else if (k === "backspace") press("back");
    else if (k === "enter" && !check.disabled) check.click();
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  draw();
  return { view: h("div", {}, shown, pad), check, lock: () => ((locked = true), draw()) };
}

// ---------- the session ----------

/**
 * Runs a Session full screen. ctx: {app, engine, lexicon, say, stop, tabbar, onExit, title}
 */
export function runStudy(session, ctx) {
  const { app, engine, lexicon } = ctx;
  const missed = new Map(); // key -> times missed this session
  let sinceCheckpoint = 0;
  // "Can't listen now": no question with sound and no voice by itself until the end of this
  // session or the next checkpoint (a pause); the questions left out stay due for later
  let quiet = false;
  const startTotal = session.remaining;
  ctx.tabbar.hidden = true;

  const exit = () => {
    ctx.stop();
    ctx.tabbar.hidden = false;
    ctx.onExit();
  };

  function frame(body, footer) {
    const done = Math.max(0, startTotal - session.remaining);
    const bar = h("div", { class: "bar" }, h("div", { style: `transform:scaleX(${startTotal ? Math.min(1, done / startTotal) : 0})` }));
    app.replaceChildren(h("div", { class: "study" },
      h("header", { class: "study-top" },
        h("button", { class: "round ghost", "aria-label": "Stop", onclick: exit }, icon(I.close)),
        bar,
        h("span", { class: "count" }, String(session.remaining))),
      h("div", { class: "study-body" }, ...body),
      h("footer", { class: "study-foot" }, ...footer)));
    window.scrollTo(0, 0);
  }

  function next() {
    if (session.done) return finish();
    if (sinceCheckpoint >= CHECKPOINT) return checkpoint();
    return session.current.type === "intro" ? newWord() : ask();
  }

  function newWord() {
    const r = H.revealOf(lexicon.words.get(session.current.key), lexicon);
    frame([h("span", { class: "badge" }, "New word"), wordCard(ctx, r, { strokes: true })],
      [h("button", { class: "pill", onclick: () => (session.next(), next()) }, "Next")]);
    if (!quiet) ctx.sayOpen(r.speak);
  }

  const QUESTION = { meaning: "What does it mean?", listening: "Which word do you hear?", recall: "Which word is it?", pinyin: "Type the pinyin", write: "Write it on paper" };

  function ask() {
    const q = H.makeQuestion(session.current, { lexicon, maxLesson: engine.reachedLesson() });
    const t0 = Date.now();
    let answered = false;
    const after = h("div");
    const foot = h("div", { class: "foot-stack" });

    const done = async (result, verdict) => {
      if (answered) return;
      answered = true;
      ctx.hush?.(); // answered before the question spoke: its voice won't come late
      app.querySelector(".cant-listen")?.remove(); // answered: nothing left to skip
      const wasMastered = engine.status(q.key) === "mastered";
      const out = await session.answer({ ...result, ms: Date.now() - t0 });
      sinceCheckpoint += 1;
      if (!out.correct) missed.set(q.key, (missed.get(q.key) ?? 0) + 1);
      // the signature moment: a word that just became mastered in all 4 skills gets its seal
      const sealed = !wasMastered && engine.status(q.key) === "mastered";
      after.replaceChildren(
        h("p", { class: out.correct ? "verdict right" : "verdict wrong" }, verdict ?? (out.correct ? "Right" : "Not quite")),
        // (an empty spot must not be passed on: replaceChildren would write it as the text "null")
        ...(sealed ? [h("div", { class: "mastered" },
          h("span", { class: "seal stamp hanzi-kai" }, [...q.reveal.hanzi].filter((c) => c >= "一" && c <= "鿿").slice(0, 2).join("")),
          h("span", {}, h("b", {}, "Mastered"), h("div", { class: "small muted" }, "Right in all four skills")))] : []),
        wordCard(ctx, q.reveal));
      foot.replaceChildren(h("button", { class: "pill", onclick: next }, "Next"));
      if (q.kind !== "self" && !quiet) ctx.say(q.reveal.speak);
      after.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    };

    let prompt;
    if (q.prompt.speak) {
      prompt = h("div", { class: "prompt" }, listen(ctx, q.prompt.speak), cantListen(() => {
        quiet = true;
        ctx.stop();
        session.dropSound();
        next();
      }));
      ctx.sayOpen(q.prompt.speak);
    } else if (q.prompt.hanzi) prompt = h("div", { class: "prompt prompt-hanzi" }, q.prompt.hanzi);
    else prompt = h("div", { class: "prompt prompt-meaning" }, h("div", {}, q.prompt.en), q.prompt.fr ? h("div", { class: "fr" }, q.prompt.fr) : null);

    let answer;
    if (q.kind === "choice") {
      const hanzi = q.skill !== "meaning";
      const buttons = q.choices.map((c, i) =>
        h("button", { class: hanzi ? "choice choice-hanzi" : "choice", onclick: () => pick(i) },
          hanzi ? c.hanzi : h("div", {}, h("div", {}, c.en), c.fr ? h("div", { class: "fr" }, c.fr) : null)));
      const pick = (i) => {
        if (answered) return;
        buttons.forEach((b) => (b.disabled = true));
        buttons[q.answerIndex].classList.add("is-right");
        if (i !== q.answerIndex) buttons[i].classList.add("is-wrong");
        done(H.checkAnswer(q, i));
      };
      answer = h("div", { class: hanzi ? "choices grid" : "choices" }, ...buttons);
    } else if (q.kind === "typed") {
      const pad = pinyinPad((text) => {
        const r = H.checkAnswer(q, text);
        const why = { "tones-missing": "Add the tones", tone: "A tone is wrong", spelling: "The spelling is wrong", empty: "Nothing typed" }[r.reason];
        done({ correct: r.correct }, r.correct ? (r.lightTone ? `Right · the book writes it light: ${r.expected}` : `Right · ${r.expected}`) : `${why} · ${r.expected}`);
      });
      answer = pad.view;
      foot.append(pad.check);
    } else {
      // dictation: write on paper, then mark yourself (one tap only)
      const reveal = h("button", { class: "pill", onclick: () => {
        foot.replaceChildren(
          h("div", { class: "split" },
            h("button", { class: "pill quiet", onclick: () => done({ selfGrade: 1 }, "Not yet") }, "Not yet"),
            h("button", { class: "pill", onclick: () => done({ selfGrade: 3 }, "Got it") }, "Got it")));
        after.replaceChildren(wordCard(ctx, q.reveal));
      } }, "Show the answer");
      answer = null;
      foot.append(reveal);
    }
    frame([h("p", { class: "question" }, QUESTION[q.skill]), prompt, answer, after], [foot]);
  }

  function checkpoint() {
    sinceCheckpoint = 0;
    quiet = false; // a pause: sound is back after it
    const st = session.stats;
    frame([
      h("div", { class: "pause" },
        ctx.dayRing(),
        h("h2", { class: "pause-title" }, "Checkpoint"),
        h("p", { class: "muted" }, `${st.correct} right out of ${st.asked} so far. ${session.remaining} left today. Everything is saved: you can stop here and continue later.`)),
    ], [h("button", { class: "pill", onclick: next }, "Continue"), h("button", { class: "pill quiet", onclick: exit }, "Stop for now")]);
  }

  function finish() {
    const st = session.stats;
    if (!st.asked && quiet) {
      // every question needed sound ("can't listen now" in a dictation)
      return frame([h("div", { class: "pause" },
        h("h2", { class: "pause-title" }, "Nothing without sound"),
        h("p", { class: "muted" }, "Every question here needs sound. They wait for you: do them when you can listen.")),
      ], [h("button", { class: "pill", onclick: exit }, "OK")]);
    }
    if (!st.asked) {
      // nothing was due (e.g. a dictation before any word was studied): say so instead of a 0/0 score
      return frame([h("div", { class: "pause" },
        h("h2", { class: "pause-title" }, "Nothing to do here yet"),
        h("p", { class: "muted" }, "Dictation uses the words you have already studied. Start with a study session.")),
      ], [h("button", { class: "pill", onclick: exit }, "OK")]);
    }
    const words = [...missed.keys()].slice(0, 5).map((k) => lexicon.words.get(k)).filter(Boolean);
    frame([
      h("div", { class: "pause" },
        ctx.dayRing(),
        h("h2", { class: "pause-title" }, "Session complete"),
        h("p", { class: "muted" }, `${st.correct} right out of ${st.asked}. Best streak: ${st.bestStreak}.`)),
      words.length ? h("div", { class: "group" },
        h("div", { class: "cell head" }, "Words to watch"),
        ...words.map((w) => h("div", { class: "cell" },
          h("span", { class: "cell-hanzi hanzi-kai" }, w.hanzi),
          h("span", { class: "label" }, h("div", {}, w.pinyin), h("div", { class: "small muted" }, w.senses[0].en))))) : null,
    ], [h("button", { class: "pill", onclick: exit }, "Done")]);
  }

  next();
}
