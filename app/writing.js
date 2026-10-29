import { h, icon } from "./study.js";

const BACK = '<path d="M15 5l-7 7 7 7"/>';
const cjk = (text) => [...text].filter((c) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(c));
const distance = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
const pathDistance = (p, line) => Math.min(...line.slice(1).map((b, i) => distance(p, line[i], b)));
const sampled = (points, count = 12) => {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = lengths.at(-1);
  if (!total) return points;
  return Array.from({ length: count }, (_, n) => {
    const d = total * n / (count - 1);
    let i = lengths.findIndex((x) => x >= d);
    if (i <= 0) return points[0];
    const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
  });
};
export function strokeMatches(drawn, target) {
  if (drawn.length < 3) return false;
  const user = sampled(drawn), expected = sampled(target);
  const errors = [...user.map((p) => pathDistance(p, target)), ...expected.map((p) => pathDistance(p, drawn))].sort((a, b) => a - b);
  return errors[Math.floor(errors.length * 0.82)] < 165;
}
function svgPath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

/** Finger-drawing practice. Stroke order is strict; each stroke is checked against its median with a generous shape tolerance. */
export async function writingPage(ctx) {
  const { app, book, lesson } = ctx;
  const back = h("button", { class: "back-link", "aria-label": "Lessons", onclick: ctx.back }, icon(BACK));
  app.replaceChildren(h("div", { class: "view" }, back, h("h1", { class: "large-title" }, "Write characters"), h("p", { class: "subtitle" }, "Loading stroke guides…")));
  let data;
  try {
    const response = await fetch("../data/open/strokes.json");
    if (!response.ok) throw new Error(`Stroke data: ${response.status}`);
    data = (await response.json()).characters;
  } catch {
    app.replaceChildren(h("div", { class: "view" }, back, h("h1", { class: "large-title" }, "Write characters"), h("p", { class: "subtitle" }, "Stroke guides could not be loaded. Reopen this screen while online, then try offline again.")));
    return;
  }
  const seen = new Set();
  const items = [];
  for (const part of book.path.filter((p) => p.lesson === lesson)) {
    const word = ctx.lexicon.words.get(part.key);
    if (!word) continue;
    for (const char of cjk(word.hanzi)) if (data[char] && !seen.has(char)) {
      seen.add(char);
      items.push({ char, word });
    }
  }
  if (!items.length) {
    app.replaceChildren(h("div", { class: "view" }, back, h("h1", { class: "large-title" }, "Write characters"), h("p", { class: "subtitle" }, "There are no stroke guides for this lesson yet.")));
    return;
  }

  let itemIndex = 0, strokeIndex = 0, accepted = false, drawing = null, showGuide = false;
  const board = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  board.setAttribute("viewBox", "0 0 1024 1024");
  board.setAttribute("class", "writing-board");
  board.setAttribute("role", "img");
  const guide = document.createElementNS(board.namespaceURI, "g");
  guide.setAttribute("transform", "translate(0 900) scale(1 -1)");
  board.append(guide);
  const status = h("p", { class: "writing-status", "aria-live": "polite" });
  const counter = h("p", { class: "small muted writing-counter" });
  const characterLabel = h("span", { class: "writing-character hanzi-kai" });
  const wordPinyin = h("span", {});
  const wordMeaning = h("span", { class: "small muted" });
  const wordInfo = h("div", { class: "writing-word" }, characterLabel, h("span", { class: "writing-word-info" }, wordPinyin, wordMeaning));
  const hintButton = h("button", { class: "pill quiet", onclick: () => { showGuide = !showGuide; paint(); } }, "Show stroke hint");
  const clearButton = h("button", { class: "pill quiet", onclick: () => { drawing = null; accepted = false; status.textContent = "Try the stroke again."; paint(); } }, "Clear stroke");
  const nextButton = h("button", { class: "pill", onclick: next }, "Next character");

  function targetPoints() { return data[items[itemIndex].char].medians[strokeIndex].map(([x, y]) => [x, y]); }
  function paint() {
    const item = items[itemIndex], strokes = data[item.char].strokes;
    characterLabel.textContent = item.char;
    wordPinyin.textContent = item.word.pinyin;
    wordMeaning.textContent = item.word.senses[0]?.en ?? "";
    board.setAttribute("aria-label", `Draw ${item.char}, stroke ${strokeIndex + 1} of ${strokes.length}`);
    guide.replaceChildren();
    if (showGuide && !accepted) {
      const p = document.createElementNS(board.namespaceURI, "path");
      p.setAttribute("d", svgPath(targetPoints())); p.setAttribute("class", "writing-hint"); guide.append(p);
    }
    for (let i = 0; i < strokeIndex; i++) {
      const p = document.createElementNS(board.namespaceURI, "path");
      p.setAttribute("d", data[item.char].strokes[i]); p.setAttribute("class", "writing-done"); guide.append(p);
    }
    if (drawing?.length) {
      const p = document.createElementNS(board.namespaceURI, "path");
      p.setAttribute("d", svgPath(drawing)); p.setAttribute("class", accepted ? "writing-user writing-user-ok" : "writing-user"); guide.append(p);
    }
    counter.textContent = `Character ${itemIndex + 1} of ${items.length} · Stroke ${Math.min(strokeIndex + 1, strokes.length)} of ${strokes.length}`;
    hintButton.textContent = showGuide ? "Hide stroke hint" : "Show stroke hint";
    clearButton.hidden = accepted;
    nextButton.textContent = strokeIndex >= strokes.length ? (itemIndex + 1 === items.length ? "Finish" : "Next character") : "Next character";
    nextButton.hidden = strokeIndex < strokes.length;
  }
  function next() {
    if (strokeIndex < data[items[itemIndex].char].strokes.length) return;
    if (itemIndex + 1 >= items.length) {
      app.replaceChildren(h("div", { class: "view" }, back,
        h("h1", { class: "large-title" }, "Practice complete"),
        h("p", { class: "subtitle" }, `You drew ${items.length} characters from lesson ${lesson}.`),
        h("button", { class: "pill", onclick: ctx.back }, "Back to lessons")));
      return;
    }
    itemIndex++; strokeIndex = 0; drawing = null; accepted = false; showGuide = false; paint();
  }

  board.addEventListener("pointerdown", (event) => {
    if (accepted || strokeIndex >= data[items[itemIndex].char].strokes.length) return;
    board.setPointerCapture(event.pointerId);
    const p = board.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const local = p.matrixTransform(board.getScreenCTM().inverse());
    drawing = [[local.x, 900 - local.y]]; paint();
  });
  board.addEventListener("pointermove", (event) => {
    if (!drawing || accepted) return;
    const p = board.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const local = p.matrixTransform(board.getScreenCTM().inverse());
    const pt = [local.x, 900 - local.y], last = drawing.at(-1);
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 3) { drawing.push(pt); paint(); }
  });
  board.addEventListener("pointerup", () => {
    if (!drawing || accepted) return;
    if (strokeMatches(drawing, targetPoints())) {
      accepted = true;
      status.textContent = "Good stroke.";
      setTimeout(() => {
        if (!accepted) return;
        strokeIndex++; drawing = null; accepted = false; showGuide = false;
        if (strokeIndex >= data[items[itemIndex].char].strokes.length) status.textContent = "Character complete.";
        else status.textContent = "Next stroke.";
        paint();
      }, 420);
    } else status.textContent = "Not quite. Try the stroke again, or show a hint.";
    paint();
  });
  app.replaceChildren(h("div", { class: "view writing-view" }, back,
    h("h1", { class: "large-title" }, "Write characters"),
    wordInfo,
    counter, board, status, hintButton, clearButton, nextButton));
  paint();
  window.scrollTo(0, 0);
}
