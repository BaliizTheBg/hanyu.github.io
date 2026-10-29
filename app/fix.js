// "Words to fix" (opened from Practice): every word you missed, the most missed first, and a
// button to practise them. A word leaves the list once it is right on two days after the miss
// (app/engine/missed.js).

import { h, icon } from "./study.js";
import { CLEAR_DAYS } from "./engine/index.js";

const BACK = '<path d="M15 5l-7 7 7 7"/>';
const PER_SESSION = 20;

/** ctx: {app, engine, lexicon, study(session), back()} */
export async function fixPage(ctx) {
  const { app, engine, lexicon } = ctx;
  const list = (await engine.missed()).filter((w) => lexicon.words.has(w.key));
  if (ctx.alive && !ctx.alive()) return; // another tab was opened meanwhile
  const n = list.length;
  app.replaceChildren(h("div", { class: "view" },
    h("button", { class: "back-link", "aria-label": "Practice", onclick: ctx.back }, icon(BACK)),
    h("h1", { class: "large-title" }, "Words to fix"),
    h("p", { class: "subtitle" }, n
      ? `${n} word${n === 1 ? "" : "s"} you missed. A word leaves the list once you get it right on two later days.`
      : "Nothing to fix. Every word you miss will come here."),
    n ? h("button", { class: "pill", onclick: async () => ctx.study(await engine.missedPractice({ count: PER_SESSION, keep: (k) => lexicon.words.has(k) })) },
      n > PER_SESSION ? `Practise ${PER_SESSION} of them` : "Practise them") : null,
    n ? h("div", { class: "group fix-list" }, ...list.map((m) => {
      const w = lexicon.words.get(m.key);
      return h("div", { class: "cell" },
        h("span", { class: "cell-hanzi hanzi-kai" }, w.hanzi),
        h("span", { class: "label" }, h("div", {}, w.pinyin), h("div", { class: "small muted one-line" }, w.senses[0].en)),
        h("span", { class: "fix-meta" },
          h("span", { class: "lesson-count" }, `missed ${m.misses}×`),
          h("span", { class: "dots", "aria-label": `right on ${m.rightDays} of ${CLEAR_DAYS} days` },
            ...Array.from({ length: CLEAR_DAYS }, (_, i) => h("i", { class: i < m.rightDays ? "on" : "" })))));
    })) : null));
  window.scrollTo(0, 0);
}
