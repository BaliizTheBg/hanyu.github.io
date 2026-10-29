// Me tab: streak and stats, then the settings (exam date, voice, speed), sync between devices,
// and backup to a file. Also the automatic sync used by the whole app.

import * as H from "./engine/index.js";
import { createSync } from "./cloud.js";
import { h, bookChips } from "./study.js";
import { shareSection } from "./share.js";

// ---------- sync (same keys as the test page, so a token saved there keeps working) ----------

const SYNC = { token: "hanyu-sync-token", gist: "hanyu-sync-gist", last: "hanyu-sync-last" };
const stored = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
  } catch {
    /* private mode: sync just won't remember */
  }
};
let syncing = null;
let lastTry = 0;

/** Sync now (at most every 20 s unless forced); does nothing without a token. Resolves to the result. */
export function syncNow(engine, { force = false, onReceived = null } = {}) {
  const token = stored(SYNC.token);
  if (!token || syncing || (!force && Date.now() - lastTry < 20_000)) return syncing ?? Promise.resolve(null);
  lastTry = Date.now();
  syncing = (async () => {
    try {
      const r = await createSync({ token, gistId: stored(SYNC.gist) }).sync(engine);
      if (r.gistId) store(SYNC.gist, r.gistId);
      store(SYNC.last, JSON.stringify({ ...r, time: Date.now() }));
      if (r.received && onReceived) onReceived(r);
      return r;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function syncText() {
  if (!stored(SYNC.token)) return "Off. Paste your GitHub token to turn it on.";
  let last = null;
  try {
    last = JSON.parse(stored(SYNC.last) ?? "null");
  } catch {
    /* damaged: as if never synced */
  }
  if (!last) return "Not synced yet.";
  const ago = Math.round((Date.now() - last.time) / 60_000);
  const when = ago < 1 ? "just now" : ago < 60 ? `${ago} min ago` : ago < 1440 ? `${Math.round(ago / 60)} h ago` : `${Math.round(ago / 1440)} d ago`;
  if (last.ok) return `Synced ${when}${last.received ? ` · ${last.received} answers received` : ""}.`;
  return {
    offline: `No connection, last try ${when}. Your progress is safe on this device.`,
    token: "GitHub refused the token. Paste a new one.",
    scope: "This token can do more than sync. For safety, make a new one with only “gist” ticked.",
  }[last.reason] ?? `Not synced: ${last.message}.`;
}

// ---------- the tab ----------

/** ctx: {app, engine, speaker(), say, remakeSpeaker()} */
export async function meTab(ctx) {
  const { app, engine } = ctx;
  const s = engine.settings;
  const st = await engine.stats();
  const accuracy = st.answersToday ? Math.round((100 * st.correctToday) / st.answersToday) : null;

  const date = h("input", { class: "field inline", type: "date", value: s.examDate ?? "", "aria-label": "Exam date" });
  date.addEventListener("change", () => engine.setSettings({ examDate: date.value || null }));

  const voices = await ctx.speaker().list();
  const voice = h("select", { class: "field inline select-right", "aria-label": "Voice" },
    h("option", { value: "" }, "Best available"),
    h("option", { value: H.SYSTEM, selected: s.voice === H.SYSTEM }, "System voice"),
    ...voices.map((v) => h("option", { value: v.name, selected: v.name === s.voice }, `${v.name}${v.offline ? "" : " (online)"}`)));
  voice.addEventListener("change", async () => (await engine.setSettings({ voice: voice.value || null }), ctx.remakeSpeaker()));
  const rate = h("select", { class: "field inline select-right", "aria-label": "Speed" },
    ...[0.8, 0.9, 1, 1.1].map((r) => h("option", { value: String(r), selected: r === s.speechRate }, r === 1 ? "Normal" : `${r}×`)));
  rate.addEventListener("change", async () => (await engine.setSettings({ speechRate: Number(rate.value) }), ctx.remakeSpeaker()));

  const token = h("input", { class: "field", type: "password", autocomplete: "off", placeholder: "GitHub token (gist only)", value: stored(SYNC.token) ?? "" });
  const status = h("p", { class: "small muted status" }, syncText());
  const run = async () => {
    status.textContent = "Syncing…";
    await syncNow(engine, { force: true });
    status.textContent = syncText();
  };

  const msg = h("p", { class: "footnote" });
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  file.addEventListener("change", async () => {
    try {
      const before = engine.settings;
      const r = await engine.importData(JSON.parse(await file.files[0].text()), { fillGoals: true });
      // the file brought other books for the daily plan: Today follows them
      if (JSON.stringify(engine.settings.planBooks) !== JSON.stringify(before.planBooks)) await ctx.choosePlan(engine.settings.planBooks);
      msg.textContent = `Merged: ${r.reviews} answers in total.`;
    } catch (e) {
      msg.textContent = `Not added: ${e.message}`;
    }
    file.value = "";
  });
  const save = async () => {
    const blob = new Blob([JSON.stringify(await engine.exportData())], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `hanyu-progress-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    msg.textContent = "Saved to your files.";
  };

  const stat = (n, label) => h("div", { class: "figure" }, h("b", {}, String(n)), h("span", {}, label));
  const row = (label, control) => h("label", { class: "cell" }, h("span", { class: "label" }, label), control);

  if (ctx.alive && !ctx.alive()) return; // you moved on while this was being prepared
  app.replaceChildren(h("div", { class: "view" },
    h("h1", { class: "large-title" }, "Me"),
    h("div", { class: "streak" },
      h("div", { class: "streak-num" }, String(st.streak)),
      h("div", { class: "muted" }, st.streak === 1 ? "day in a row" : "days in a row")),
    h("div", { class: "figures" },
      stat(st.mastered, "mastered"), stat(st.learning, "learning"), stat(st.new, "not started")),
    h("div", { class: "group" },
      h("div", { class: "cell" }, h("span", { class: "label" }, "Answers today"), h("span", { class: "value" }, String(st.answersToday))),
      h("div", { class: "cell" }, h("span", { class: "label" }, "Right today"), h("span", { class: "value" }, accuracy === null ? "–" : `${accuracy}%`))),

    h("h2", { class: "section-title" }, "Study"),
    h("div", { class: "group" },
      h("div", { class: "cell" }, h("span", { class: "label" }, "Daily plan"),
        bookChips(ctx.books, s.planBooks ?? [ctx.books[0].id], (ids) => ctx.choosePlan(ids).then(() => meTab(ctx)), "Books in the daily plan")),
      row("Exam date", date)),
    h("p", { class: "footnote" }, "Today's new words come from these books. They are spread over the days before the exam; the last day is for review only."),

    h("h2", { class: "section-title" }, "Voice"),
    h("div", { class: "group" },
      row("Voice", voice),
      row("Speed", rate),
      h("button", { class: "cell row-button accent", onclick: () => ctx.say("你好！我是汉语老师。") }, "Test the voice")),
    h("p", { class: "footnote" }, voices.length
      ? "iPhone hides Premium voices from web apps. “System voice” uses the Mandarin voice set in Settings → Accessibility → Spoken Content → Voices → Chinese."
      : "No Chinese voice on this device. iPhone: Settings → Accessibility → Spoken Content → Voices → Chinese → Mandarin."),

    h("h2", { class: "section-title" }, "Sync between devices"),
    h("div", { class: "group pad-group" },
      h("p", { class: "small muted" }, "Your progress goes to a private file on your GitHub and comes back on your other devices. Paste the same token on each device."),
      token,
      h("div", { class: "split" },
        h("button", { class: "pill quiet", onclick: run }, "Sync now"),
        h("button", { class: "pill", onclick: () => (store(SYNC.token, token.value.trim() || null), run()) }, "Save and sync")),
      status),

    h("h2", { class: "section-title" }, "Backup"),
    h("div", { class: "group" },
      h("button", { class: "cell row-button accent", onclick: save }, "Save my progress to a file"),
      h("button", { class: "cell row-button accent", onclick: () => file.click() }, "Add progress from a file")),
    file, msg,

    ...shareSection(),

    h("h2", { class: "section-title" }, "Start over"),
    h("div", { class: "group" }, h("button", { class: "cell row-button danger", onclick: () => confirmReset(ctx) }, "Reset all progress")),
    h("p", { class: "footnote" }, "Erases every answer, word level, streak and exam score, on this device and on every device synced with it. Your settings stay."),
    h("p", { class: "footnote center" }, navigator.serviceWorker?.controller ? "Ready offline." : "Open the app once more to make it work offline.")));
  window.scrollTo(0, 0);
}

/** The one destructive action of the app: asked in a sheet, with Cancel as the easy way out. */
function confirmReset(ctx) {
  const close = () => {
    panel.classList.remove("open");
    scrim.classList.remove("open");
    document.removeEventListener("keydown", onKey, true);
    setTimeout(() => layer.remove(), 220);
  };
  const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), close());
  const go = async () => {
    yes.disabled = no.disabled = true;
    yes.textContent = "Resetting…";
    await ctx.engine.reset();
    await syncNow(ctx.engine, { force: true }); // tell the other devices (if sync is on)
    close();
    ctx.afterReset();
  };
  const yes = h("button", { class: "pill danger-pill", onclick: go }, "Reset everything");
  const no = h("button", { class: "pill quiet", onclick: close }, "Cancel");
  const scrim = h("div", { class: "scrim", onclick: close });
  const panel = h("div", { class: "sheet alert", role: "alertdialog", "aria-label": "Reset all progress?" },
    h("div", { class: "handle" }),
    h("h2", { class: "pause-title" }, "Reset all progress?"),
    h("p", { class: "muted" }, "Every answer, word level, streak and exam score will be erased, here and on your other devices at their next sync. This can't be undone."),
    h("p", { class: "small muted" }, "To keep a copy, cancel and use “Save my progress to a file” first."),
    yes, no);
  const layer = h("div", { class: "layer" }, scrim, panel);
  document.body.append(layer);
  document.addEventListener("keydown", onKey, true);
  requestAnimationFrame(() => requestAnimationFrame(() => (panel.classList.add("open"), scrim.classList.add("open"))));
  no.focus();
}
