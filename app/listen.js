// Listening mode (Book › a lesson › Listen to the lesson): the lesson's texts read aloud line by
// line with a short pause, like the book's CD, without touching the screen. The line being read
// is highlighted and kept in view; tap a line to go there; pause, previous, next. Offline, with
// the phone's voice. The screen is kept awake while it plays (a locked iPhone stops the voice).

import { h, icon } from "./study.js";

const GAP = 1200; // ms of quiet between two lines
const SCENE = 1800; // ms for a stage direction (read, not spoken)
const I = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  prev: '<path d="M6 5v14"/><path d="M19 5.5v13L9 12z" fill="currentColor" stroke="none"/>',
  next: '<path d="M18 5v14"/><path d="M5 5.5v13L15 12z" fill="currentColor" stroke="none"/>',
};

/** ctx: {app, say(text) → Promise, stop(), afterMove(), tabbar, back()}; lesson = a lesson of texts.json */
export function listenMode(ctx, lesson) {
  const { app } = ctx;
  // everything to read, in order: part titles, stage directions, lines
  const steps = [];
  for (const P of lesson.parts) {
    if (P.title) steps.push({ type: "title", zh: P.title.zh, en: P.title.en });
    for (const it of P.items) steps.push(it.type === "line" ? { type: "line", ...it } : { type: "scene", zh: it.zh, en: it.en });
  }
  const lines = steps.filter((s) => s.type === "line").length;
  let pos = 0;
  let playing = true;
  let run = 0; // each start/stop/jump makes a new run: an older loop stops at its next step
  let lock = null;
  let open = true;
  let userScrolledAt = 0; // the reader scrolled to look around: don't pull the page back for a while

  // keep the screen awake while it plays (a locked iPhone stops the voice); always let it go after
  const release = () => {
    lock?.release?.().catch?.(() => {});
    lock = null;
  };
  const wake = async () => {
    if (lock) return;
    let l = null;
    try { l = await navigator.wakeLock?.request("screen"); } catch { /* not allowed: fine */ }
    if (!l) return;
    if (!open || !playing || lock) return void l.release?.().catch?.(() => {}); // stopped meanwhile
    lock = l;
  };
  // the phone locked or the app left: iOS stops the voice, so the reading pauses where it was
  const onVisibility = () => document.visibilityState === "hidden" && playing && pause();
  const onScroll = () => (userScrolledAt = Date.now());
  const leave = () => {
    open = false;
    run += 1;
    ctx.stop();
    release();
    document.removeEventListener("visibilitychange", onVisibility);
    for (const e of ["touchmove", "wheel"]) window.removeEventListener(e, onScroll);
    ctx.tabbar.hidden = false;
    ctx.back();
  };

  const rows = steps.map((s, i) => s.type === "title"
    ? h("h2", { class: "section-title listen-title hanzi-kai" }, s.zh, h("span", { class: "muted small" }, ` · ${s.en}`))
    : s.type === "scene"
      ? h("div", { class: "scene listen-row" }, h("div", { class: "hanzi-kai" }, s.zh), h("div", { class: "muted" }, s.en))
      : h("button", { class: "bubble listen-row", onclick: () => jump(i) },
        h("div", { class: "who" }, s.speaker),
        h("div", { class: "zh hanzi-kai" }, s.zh),
        h("div", { class: "py" }, s.pinyin),
        h("div", { class: "en" }, s.en, s.fr ? h("div", { class: "fr" }, s.fr) : null)));
  const count = h("span", { class: "count" });
  const bar = h("div");
  const playBtn = h("button", { class: "pill", onclick: () => (playing ? pause() : play()) });

  function draw() {
    rows.forEach((r, i) => r.classList.toggle("is-now", i === pos));
    const done = steps.slice(0, pos).filter((s) => s.type === "line").length;
    count.textContent = `${Math.min(done + 1, lines)}/${lines}`;
    bar.style.transform = `scaleX(${lines ? done / lines : 0})`;
    playBtn.textContent = playing ? "Pause" : pos >= steps.length ? "Play again" : "Play";
    if (Date.now() - userScrolledAt > 5000) rows[pos]?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  async function loop(me, first) {
    if (first) await ctx.afterMove(); // the screen moves in, then a moment to look before the voice
    await wait(first ? 700 : 0);
    while (me === run && pos < steps.length) {
      draw();
      const s = steps[pos];
      if (s.type === "line") {
        const t0 = Date.now();
        const r = await ctx.say(s.speak ?? s.zh);
        if (me !== run) return;
        // no Chinese voice on this device: still go through the text at a reading pace
        if (!r?.ok && r?.reason !== "stopped") await wait(Math.max(0, 1200 + 280 * [...s.zh].length - (Date.now() - t0)));
        await wait(GAP);
      } else await wait(s.type === "scene" ? SCENE : 600);
      if (me !== run) return;
      pos += 1;
    }
    if (me === run) (playing = false), release(), draw(); // the end: Play again starts over
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function play() {
    if (pos >= steps.length) pos = 0;
    playing = true;
    wake();
    loop(++run, false);
  }
  function pause() {
    playing = false;
    run += 1;
    ctx.stop();
    release();
    draw();
  }
  function jump(i) {
    userScrolledAt = 0; // a line chosen: show it
    run += 1;
    ctx.stop();
    pos = Math.max(0, Math.min(steps.length - 1, i));
    if (playing) loop(++run, false);
    else draw();
  }
  const lineAt = (from, dir) => {
    for (let i = from + dir; i >= 0 && i < steps.length; i += dir) if (steps[i].type === "line") return i;
    return from;
  };

  ctx.tabbar.hidden = true;
  app.replaceChildren(h("div", { class: "study listen-mode" },
    h("header", { class: "study-top" },
      h("button", { class: "round ghost", "aria-label": "Stop", onclick: leave }, icon(I.close)),
      h("div", { class: "bar" }, bar),
      count),
    h("div", { class: "study-body" },
      h("p", { class: "question" }, `Lesson ${lesson.lesson} · ${lesson.en}`),
      ...rows),
    h("footer", { class: "study-foot" },
      h("div", { class: "listen-controls" },
        h("button", { class: "round", "aria-label": "Previous line", onclick: () => jump(lineAt(pos, -1)) }, icon(I.prev)),
        playBtn,
        h("button", { class: "round", "aria-label": "Next line", onclick: () => jump(lineAt(pos, 1)) }, icon(I.next))))));
  window.scrollTo(0, 0);
  document.addEventListener("visibilitychange", onVisibility);
  for (const e of ["touchmove", "wheel"]) window.addEventListener(e, onScroll, { passive: true });
  draw();
  wake();
  loop(++run, true);
}
