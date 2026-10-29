// Screen transitions, like an iPhone app: a page you open slides in from the right and the one
// below moves back a little (Back reverses it); studying and exams rise from the bottom like a
// full-screen sheet and drop back down when you leave; tabs cross-fade; the next question slides
// in while the top bar stays put. Uses the browser's View Transitions; where they don't exist,
// or with Reduce Motion on, screens simply change (a cross-fade with Reduce Motion).
//
// How: a click decides what kind of move it is (from what was tapped), and the next redraw of
// #app within 700 ms plays that move. Screens don't need to know anything about it.
// installMotion() returns afterMove(): the voice waits for the move to end before it speaks.
// Pages can also be left the iPhone way: swipe from the left edge (or two fingers on the Mac
// trackpad); the page follows the finger and the page under it comes back.

const KIND_TTL = 700;

/** What kind of move a tap on `el` means, or null (taps that don't change the screen). */
function kindOf(el) {
  if (el.closest(".tab")) return "fade";
  if (el.closest(".back-link")) return "pop";
  if (el.closest(".study-top .round")) return "down"; // the ✕ of a study / exam / dialogue
  const foot = el.closest(".study-foot .pill");
  if (foot) return /^(Done|OK|Stop for now|Back to the levels)$/.test(foot.textContent.trim()) ? "down" : "next";
  if (el.closest(".cant-listen")) return "next"; // the next question slides in, like Next
  if (el.closest(".levels .row-button")) return "up"; // a dialogue level opens full screen
  if (el.closest(".lesson-row, .view .row-button")) return "push";
  if (el.closest(".view .pill")) return "up"; // Start studying, Whole book, Quiz, Study this lesson…
  return null;
}

// swipe back: how far (share of the width) or how fast a release must go to complete
const EDGE = 28; // px from the left edge where an iPhone back swipe starts
const project = (v) => (v * 0.998) / (1 - 0.998); // Apple's momentum projection, v in px/ms

export function installMotion(app) {
  const can = typeof document.startViewTransition === "function";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let kind = null;
  let at = 0;
  let pending = false;
  let restore = null; // scroll position to give back to a page we return to
  let moving = Promise.resolve(); // the screen move playing now (the voice waits for it)
  const stack = []; // the pages under the current one: {nodes, scroll}, so Back can show them

  let swiped = false; // the Back click that a finished swipe sends: no second animation
  document.addEventListener("click", (e) => {
    const k = swiped ? "swipe" : kindOf(e.target);
    swiped = false;
    if (k) (kind = k), (at = performance.now());
  }, true);

  // screens call window.scrollTo(0, 0) right after drawing: wait until the new screen is in,
  // so the old one doesn't jump to the top in the middle of its exit; a page we come back to
  // gets its old scroll position back, like on the iPhone
  const scrollTo = window.scrollTo.bind(window);
  let restoredAt = -1e9;
  window.scrollTo = (...a) => {
    if (pending || performance.now() - restoredAt < 100) return; // the screen's own "top" after a return
    scrollTo(...a);
  };
  const giveScrollBack = () => {
    if (restore === null) return;
    scrollTo(0, restore);
    restore = null;
    restoredAt = performance.now();
  };

  const replace = app.replaceChildren.bind(app);
  app.replaceChildren = (...nodes) => {
    const k = kind && performance.now() - at < KIND_TTL ? kind : null;
    kind = null;
    if (k === "push") stack.push({ nodes: [...app.childNodes], scroll: window.scrollY });
    if (k === "pop" || k === "swipe") restore = stack.pop()?.scroll ?? null;
    const done = () => {
      giveScrollBack();
      // a session hides the tab bar: a tab that still had keyboard focus would take Enter
      if (document.activeElement?.closest?.(".tabbar[hidden]")) document.activeElement.blur();
      // a page without a Back button is a root (a tab): nothing under it any more
      // (a full-screen session keeps the pages under it, for when it closes)
      if (!app.querySelector(".back-link, .study")) stack.length = 0;
    };
    if (!can || !k || k === "swipe") return (replace(...nodes), done());
    document.documentElement.dataset.nav = reduce.matches ? "fade" : k;
    pending = true;
    const t = document.startViewTransition(() => {
      replace(...nodes);
      pending = false;
      done();
      window.scrollTo(0, 0);
    });
    t.finished.finally(() => delete document.documentElement.dataset.nav).catch(() => {});
    moving = t.finished.catch(() => {});
    // the browser may give up on a move (a busy phone: "timeout in DOM update"); the new screen
    // is drawn anyway, so a skipped animation is not an error
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
  };

  // ---------- swipe back: the page follows the finger, the page under it comes back ----------
  let drag = null;
  const backButton = () => (document.querySelector(".layer") ? null : app.querySelector(".back-link"));
  const width = () => window.innerWidth;

  function begin() {
    const under = stack.at(-1);
    if (!under || !backButton()) return null;
    // the page under: shown as it was left, at its scroll position
    const layer = document.createElement("div");
    layer.className = "underlay";
    const inner = document.createElement("div");
    inner.style.transform = `translateY(${-under.scroll}px)`;
    inner.append(...under.nodes.map((n) => n.cloneNode(true)));
    layer.append(inner);
    document.body.append(layer);
    app.classList.add("dragging");
    return { layer, dx: 0, samples: [] };
  }
  function move(d, dx) {
    d.dx = Math.max(0, dx);
    const p = Math.min(1, d.dx / width());
    app.style.transform = `translateX(${d.dx}px)`;
    d.layer.style.transform = `translateX(${-28 * (1 - p)}%)`;
    d.layer.style.filter = `brightness(${0.82 + 0.18 * p})`;
    const t = performance.now();
    d.samples.push([t, d.dx]);
    while (d.samples.length > 2 && t - d.samples[0][0] > 90) d.samples.shift();
  }
  function end(d) {
    const [t0, x0] = d.samples[0] ?? [0, 0];
    const [t1, x1] = d.samples.at(-1) ?? [1, 0];
    // px/ms, the finger's speed at release (0 if it stopped before letting go)
    const v = performance.now() - t1 > 80 ? 0 : (x1 - x0) / Math.max(1, t1 - t0);
    const complete = d.dx + project(v) > width() / 2;
    app.classList.remove("dragging");
    app.classList.add("settling");
    d.layer.classList.add("settling");
    app.style.transform = complete ? `translateX(${width()}px)` : "";
    d.layer.style.transform = complete ? "translateX(0)" : "translateX(-28%)";
    d.layer.style.filter = complete ? "brightness(1)" : "brightness(0.82)";
    setTimeout(() => {
      app.classList.remove("settling");
      if (complete) {
        // go back for real (fresh page, same look), without a second animation
        swiped = true;
        app.style.transform = "";
        backButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      } else app.style.transform = "";
      d.layer.remove();
    }, 260);
  }

  // iPhone: from the left edge, with a finger (or a mouse on the Mac)
  let start = null;
  document.addEventListener("pointerdown", (e) => {
    start = e.clientX <= EDGE && backButton() && stack.length ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, true);
  document.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!drag) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return (start = null); // a scroll, not a swipe
      if (dx < 10) return;
      drag = begin();
      if (!drag) return (start = null);
    }
    move(drag, dx);
  }, true);
  const release = () => {
    if (drag) end(drag);
    drag = null;
    start = null;
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);

  // Mac: the two-finger swipe on the trackpad (left to right), like Safari's Back
  let wheelTimer = null;
  let wheel = null;
  window.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || drag) return;
    if (!wheel) {
      if (e.deltaX >= 0 || !backButton() || !stack.length) return;
      wheel = begin();
      if (!wheel) return;
    }
    e.preventDefault();
    move(wheel, wheel.dx - e.deltaX);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => (end(wheel), (wheel = null)), 90);
  }, { passive: false });

  // Mac keyboard: Escape = Back (or close a session), like the top-left button
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.target.closest?.("input, select, textarea") || document.querySelector(".layer")) return;
    const b = app.querySelector(".back-link, .study-top .round");
    if (b) (e.preventDefault(), b.click());
  });

  return {
    /** Resolves once the screen being drawn has finished moving in (at once if nothing moves). */
    afterMove: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))).then(() => moving),
  };
}
