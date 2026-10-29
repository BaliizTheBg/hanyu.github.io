// Dialogues (conversation mode) in the new front end: pick a role, climb the levels
// (listen, repeat, choose your reply, build, play your role, change the details), 80% to pass.

import * as H from "./engine/index.js";
import { h, icon, cantListen } from "./study.js";

const CHEVRON = '<path d="M9 5l7 7-7 7"/>';
const BACK = '<path d="M15 5l-7 7 7 7"/>';
const LOCK = '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8.5a3.5 3.5 0 0 1 7 0V11"/>';
const CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
const PLAY = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>';
const SLOW = '<path d="M2.5 16a8 7.5 0 0 1 16 0z"/><path d="M6.5 16l2.6-5h2.8l2.6 5"/><circle cx="20.6" cy="12.6" r="2"/><path d="M5.5 16v3M15.5 16v3"/>'; // a turtle: slowly

/**
 * ctx: {app, engine, lexicon, units, substitutions, say, stop, tabbar, back()}
 * Opens one dialogue: the role choice (if there are several speakers), then its levels.
 */
export function openDialogue(ctx, unit) {
  if (unit.speakers.length === 1) return levels(ctx, unit, unit.speakers[0].label);
  const best = H.defaultRole(unit);
  ctx.app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Back", onclick: ctx.back }, icon(BACK)),
    h("div", { class: "lesson-hero" }, h("div", { class: "lesson-hero-zh hanzi-kai" }, unit.title.zh), h("div", { class: "lesson-hero-sub" }, unit.title.en)),
    h("h2", { class: "section-title" }, "Play as"),
    h("div", { class: "group" }, ...unit.speakers.map((s) =>
      h("button", { class: "cell row-button", onclick: () => levels(ctx, unit, s.label) },
        h("span", { class: "cell-hanzi hanzi-kai" }, s.label),
        h("span", { class: "label" }, h("div", {}, s.pinyin), s.label === best ? h("div", { class: "small muted" }, "Suggested: the most to say") : null),
        icon(CHEVRON))))));
  window.scrollTo(0, 0);
}

const convCtx = (ctx) => ({ lexicon: ctx.lexicon, units: ctx.units, substitutions: ctx.substitutions, maxLesson: ctx.engine.reachedLesson() });

function levels(ctx, unit, role) {
  const list = H.levelsFor(unit, role, convCtx(ctx));
  const prog = ctx.engine.conversationProgress(unit, list);
  const back = unit.speakers.length === 1 ? ctx.back : () => openDialogue(ctx, unit);
  ctx.app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Back", onclick: back }, icon(BACK)),
    h("div", { class: "lesson-hero" }, h("div", { class: "lesson-hero-zh hanzi-kai" }, unit.title.zh), h("div", { class: "lesson-hero-sub" }, `${unit.title.en} · you are ${role}`)),
    h("div", { class: "group levels" }, ...prog.map((p, i) =>
      h("button", { class: `cell row-button${p.open ? "" : " locked"}`, disabled: !p.open, onclick: () => play(ctx, unit, role, p.level) },
        h("span", { class: `step-num${p.passed ? " passed" : ""}` }, String(i + 1)),
        h("span", { class: "label" }, h("div", {}, p.title), p.tries ? h("div", { class: "small muted" }, `${p.tries} ${p.tries === 1 ? "try" : "tries"}`) : null),
        p.passed ? h("span", { class: p.due ? "tag due" : "tag" }, p.due ? "Review" : "Passed") : p.open ? icon(CHEVRON) : icon(LOCK))))));
  window.scrollTo(0, 0);
}

export function tiles(list, onDone) {
  const chosen = [];
  let locked = false;
  const answer = h("div", { class: "tiles answer" });
  const pool = h("div", { class: "tiles" });
  const check = h("button", { class: "pill", onclick: () => ((locked = true), draw(), onDone([...chosen])) }, "Check");
  const draw = () => {
    answer.replaceChildren(...chosen.map((i, k) => h("button", { class: "tile hanzi-kai", onclick: () => locked || (chosen.splice(k, 1), draw()) }, list[i])));
    pool.replaceChildren(...list.map((t, i) => (chosen.includes(i) ? null : h("button", { class: "tile hanzi-kai", onclick: () => locked || (chosen.push(i), draw()) }, t))));
    check.disabled = locked || chosen.length !== list.length;
  };
  draw();
  return { view: h("div", {}, answer, pool), check };
}

function play(ctx, unit, role, level) {
  const { app, engine } = ctx;
  const script = H.buildLevel(unit, level, { ...convCtx(ctx), role });
  const results = [];
  // "Can't listen now": until the end of this level, no voice by itself, and the steps that need
  // sound (repeat after the voice, hear a line and pick its meaning) are skipped; the level is
  // then not saved, so it is played again later
  let quiet = false;
  const NEEDS_SOUND = new Set(["shadow", "meaning"]);
  const silence = (i) => cantListen(() => {
    quiet = true;
    ctx.stop();
    if (!NEEDS_SOUND.has(script.steps[i].type)) return show(i); // a line: stays, to be read
    results[i] = { skipped: true };
    show(i + 1);
  });
  ctx.tabbar.hidden = true;
  const leave = () => (ctx.stop(), (ctx.tabbar.hidden = false), levels(ctx, unit, role));
  const listen = (text) => h("div", { class: "listen" },
    h("button", { class: "round", "aria-label": "Listen", onclick: () => ctx.say(text) }, icon(PLAY)),
    h("button", { class: "round", "aria-label": "Listen slowly", onclick: () => ctx.say(text, true) }, icon(SLOW)));
  const lineCard = (l, mine = false) => h("div", { class: `bubble${mine ? " mine" : ""}` },
    h("div", { class: "who" }, l.speaker),
    h("div", { class: "zh hanzi-kai" }, l.zh),
    h("div", { class: "py" }, l.pinyin),
    h("div", { class: "en" }, l.en, l.fr ? h("div", { class: "fr" }, l.fr) : null),
    listen(l.speak));

  function frame(i, body, foot) {
    app.replaceChildren(h("div", { class: "study" },
      h("header", { class: "study-top" },
        h("button", { class: "round ghost", "aria-label": "Stop", onclick: leave }, icon(CLOSE)),
        h("div", { class: "bar" }, h("div", { style: `transform:scaleX(${i / script.steps.length})` })),
        h("span", { class: "count" }, `${Math.min(i + 1, script.steps.length)}/${script.steps.length}`)),
      h("div", { class: "study-body" }, h("p", { class: "question" }, script.title), ...body),
      h("footer", { class: "study-foot" }, ...foot)));
    window.scrollTo(0, 0);
  }

  async function show(i) {
    if (i === script.steps.length) {
      const r = await engine.recordLevel(script, results);
      if (r.skipped) {
        return frame(i, [h("div", { class: "pause" },
          h("div", { class: "result-num" }, "Done"),
          h("h2", { class: "pause-title" }, "Not saved"),
          h("p", { class: "muted" }, "The parts with sound were skipped. Play this level again when you can listen."))],
        [h("button", { class: "pill", onclick: leave }, "Back to the levels")]);
      }
      const pct = r.answered ? Math.round(r.score * 100) : null;
      return frame(i, [h("div", { class: "pause" },
        h("div", { class: "result-num" }, pct === null ? "Done" : `${pct}%`),
        h("h2", { class: "pause-title" }, r.passed ? "Level passed" : "Not passed yet"),
        h("p", { class: "muted" }, r.passed ? "The next level is open. This one comes back for review later." : "80% opens the next level. Try it again."))],
      [h("button", { class: "pill", onclick: leave }, "Back to the levels")]);
    }
    const st = script.steps[i];
    const next = () => show(i + 1);
    if (quiet && NEEDS_SOUND.has(st.type)) {
      results[i] = { skipped: true };
      return next();
    }
    const after = h("div");
    const foot = h("div", { class: "foot-stack" });
    let answered = false;
    const mark = (r, text) => {
      if (answered) return;
      answered = true;
      ctx.hush?.(); // answered before the voice spoke: it won't come late
      app.querySelector(".cant-listen")?.remove(); // answered: nothing left to skip
      results[i] = r;
      after.replaceChildren(h("p", { class: r.correct ? "verdict right" : "verdict wrong" }, text ?? (r.correct ? "Right" : "Not quite")));
      foot.replaceChildren(h("button", { class: "pill", onclick: next }, "Next"));
    };
    const selfMark = (g) => {
      if (answered) return;
      answered = true;
      ctx.hush?.(); // graded before the voice spoke: it won't come late
      results[i] = H.checkStep(st, { selfGrade: g });
      next();
    };
    const twoButtons = () => h("div", { class: "split" },
      h("button", { class: "pill quiet", onclick: () => selfMark(1) }, "Not yet"),
      h("button", { class: "pill", onclick: () => selfMark(3) }, "Got it"));
    let body = [];
    if (st.type === "scene") {
      body = [h("div", { class: "scene" }, h("div", { class: "hanzi-kai" }, st.zh), h("div", { class: "muted" }, st.en), st.fr ? h("div", { class: "fr" }, st.fr) : null)];
      foot.append(h("button", { class: "pill", onclick: next }, "Next"));
    } else if (st.type === "line") {
      if (!quiet) ctx.sayOpen(st.speak);
      // "Listen and understand" read without the voice: not listened to, so not saved
      else if (level === "listen") results[i] = { skipped: true };
      body = [lineCard(st, st.speaker === role), quiet ? null : silence(i)];
      foot.append(h("button", { class: "pill", onclick: next }, "Next"));
    } else if (st.type === "shadow") {
      ctx.sayOpen(st.speak);
      body = [h("p", { class: "hint" }, "Say it right after the voice."), lineCard(st), silence(i)];
      foot.append(twoButtons());
    } else if (st.type === "reply" || st.type === "meaning") {
      const p = st.type === "reply" ? st.prompt : st.line;
      if (!quiet) ctx.sayOpen(p.speak);
      const buttons = st.choices.map((c, k) => h("button", { class: "choice", onclick: () => pick(k) },
        c.zh ? h("div", {}, h("div", { class: "hanzi-kai choice-zh" }, c.zh), h("div", { class: "fr" }, c.pinyin)) : h("div", {}, h("div", {}, c.en), c.fr ? h("div", { class: "fr" }, c.fr) : null)));
      const pick = (k) => {
        if (answered) return;
        ctx.hush?.(); // answered before the line spoke: its voice won't come late
        buttons.forEach((b) => (b.disabled = true));
        buttons[st.answerIndex].classList.add("is-right");
        if (k !== st.answerIndex) buttons[k].classList.add("is-wrong");
        const r = H.checkStep(st, k);
        mark(r, st.type === "reply" ? `${r.correct ? "Right" : "Not quite"} · ${st.line.en}` : undefined);
      };
      body = [st.type === "reply" ? h("div", {}, lineCard(p), quiet ? null : silence(i)) : h("div", { class: "prompt" }, listen(p.speak), silence(i)),
        h("p", { class: "hint" }, st.type === "reply" ? "What do you answer?" : "What does it mean?"),
        h("div", { class: "choices" }, ...buttons), after];
    } else if (st.type === "build") {
      const t = tiles(st.tiles, (idx) => { const r = H.checkStep(st, idx); mark(r, r.correct ? "Right" : `Answer: ${r.expected}`); });
      body = [h("div", { class: "prompt prompt-meaning" }, h("div", {}, st.line.en), st.line.fr ? h("div", { class: "fr" }, st.line.fr) : null), t.view, after];
      foot.append(t.check);
    } else if (st.type === "say") {
      body = [h("p", { class: "hint" }, "Your turn: say it in Chinese."),
        h("div", { class: "bubble mine" }, h("div", { class: "who" }, `${role} · you`), h("div", { class: "en big" }, st.prompt.en), st.prompt.fr ? h("div", { class: "fr" }, st.prompt.fr) : null), after];
      foot.append(h("button", { class: "pill", onclick: () => {
        if (!quiet) ctx.say(st.line.speak);
        after.replaceChildren(lineCard(st.line, true));
        foot.replaceChildren(twoButtons());
      } }, "Show the answer"));
    }
    const changes = script.changes && i === 0 ? h("p", { class: "hint" }, "Changed: " + script.changes.map((c) => `${c.from.zh} → ${c.to.zh}`).join(", ")) : null;
    frame(i, [changes, ...body], [foot]);
  }
  show(0);
}
