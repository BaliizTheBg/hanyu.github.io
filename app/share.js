// Getting Hanyu onto a friend's phone: the link and its QR code, and the install offer for the
// phone in hand (iPhone Safari or Chrome, Android Chrome one-tap, WeChat's own browser, Mac). Everything
// is open: no password, no key, nothing to copy.

import qrcode from "./vendor/qrcode.js";
import { h } from "./study.js";

const DISMISSED = "hanyu-install-dismissed";
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const inWeChat = /MicroMessenger/i.test(ua);
// Chinese phones' own browsers (Huawei, Xiaomi, OPPO, vivo, UC, QQ…): no Chrome menu there
const ownBrowser = /HuaweiBrowser|HarmonyOS|MiuiBrowser|XiaoMi|HeyTapBrowser|OppoBrowser|VivoBrowser|UCBrowser|MQQBrowser|Quark|SamsungBrowser/i.test(ua);
const iosChrome = /CriOS|EdgiOS|FxiOS/.test(ua); // other browsers on iPhone: their Share button is at the top right
export const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// Android Chrome offers its own one-tap install: keep the offer for our button
let deferred = null;
addEventListener("beforeinstallprompt", (e) => (e.preventDefault(), (deferred = e)));

// The one link to share, from every copy of the app (also the github.io one): hanyu86.com opens
// in China without a VPN, github.io doesn't. Everyone new installs from it.
export const OFFICIAL = "https://hanyu86.com/";

/** The address to share: always the official one. */
export function appLink() {
  return OFFICIAL;
}

function qr(text) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const box = h("div", { class: "qr", role: "img", "aria-label": "QR code of the Hanyu link" });
  box.innerHTML = q.createSvgTag(4, 2); // made here from the link, no outside markup
  return box;
}

/** Me › Share Hanyu: QR code + share / copy the magic link. */
export function shareSection() {
  const link = appLink();
  const msg = h("p", { class: "footnote center" });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      msg.textContent = "Link copied.";
    } catch {
      msg.textContent = link;
    }
  };
  const share = async () => {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: "Hanyu", text: "Learn Chinese with Hanyu (Book 1A + HSK). Open this link, then add it to your Home Screen:", url: link });
    } catch {
      /* closed the share sheet */
    }
  };
  return [
    h("h2", { class: "section-title" }, "Share Hanyu"),
    h("div", { class: "group pad-group share" },
      qr(link),
      h("p", { class: "small muted center" }, "Friends scan this or open the link, then add Hanyu to their Home Screen."),
      h("div", { class: "split" },
        h("button", { class: "pill quiet", onclick: copy }, "Copy link"),
        h("button", { class: "pill", onclick: share }, "Share"))),
    msg,
  ];
}

/** Today: a small card when the app is opened in a browser instead of from the Home Screen. */
export function installCard(onOpen) {
  if (installed() || read(DISMISSED)) return null;
  const card = h("div", { class: "install-card" },
    h("img", { src: "icons/icon-180.png", alt: "", width: "44", height: "44" }),
    h("div", { class: "label" }, h("b", {}, "Install Hanyu"), h("div", { class: "small muted" }, "Full screen, works offline, on your Home Screen.")),
    h("button", { class: "pill install-go", onclick: () => (deferred ? installNow() : onOpen()) }, deferred ? "Install" : "How"),
    h("button", { class: "install-x", "aria-label": "Not now", onclick: () => (store(DISMISSED, "1"), card.remove()) }, "✕"));
  return card;
}

/** The install steps for the phone in hand, in a sheet. */
export function installGuide() {
  const close = () => {
    panel.classList.remove("open");
    scrim.classList.remove("open");
    setTimeout(() => layer.remove(), 220);
  };
  const step = (n, text) => h("li", {}, h("span", { class: "step-n" }, String(n)), h("span", {}, text));
  let title;
  let steps;
  let extra = null;
  if (inWeChat) {
    title = "Open it in your browser first";
    steps = [
      "Tap ··· at the top right of WeChat.",
      isIOS ? "Choose “Open in Safari” (or your browser)." : "Choose “Open in browser” (Chrome works best).",
      "Then follow the install steps shown there.",
    ];
  } else if (isIOS) {
    title = "Add Hanyu to your Home Screen";
    steps = [
      iosChrome
        ? "Tap the Share button (the square with an arrow ↑) at the top right, next to the address."
        : "Tap the Share button (the square with an arrow ↑).",
      "Tap “More” if you don't see it, then “Add to Home Screen”, then “Add”.",
      "Open Hanyu from its red 汉 icon on your Home Screen.",
    ];
  } else if (isAndroid) {
    title = "Install Hanyu";
    steps = deferred
      ? ["Tap Install below, then confirm.", "Hanyu appears with your apps, with its red 汉 icon."]
      : ownBrowser
        ? ["Open the browser's menu (☰ or ⋮, usually at the bottom or top right).", "Tap “Add to home screen” (it may be called “Add shortcut” or “Add to desktop”).", "Open Hanyu from its red 汉 icon. If there is no such option, open this link in Edge or Firefox from your app store."]
        : ["Tap ⋮ at the top right of Chrome.", "Tap “Install app” (or “Add to Home screen” › Install).", "Open Hanyu from its red 汉 icon."];
    if (deferred) extra = h("button", { class: "pill", onclick: async () => { deferred.prompt(); await deferred.userChoice; deferred = null; close(); } }, "Install");
  } else {
    title = "Install Hanyu on this computer";
    steps = [
      "Mac, in Safari: menu File › “Add to Dock…”, then Add.",
      "In Chrome or Edge: the install icon at the right end of the address bar.",
      "Open Hanyu from the Dock or your apps.",
    ];
  }
  const scrim = h("div", { class: "scrim", onclick: close });
  const panel = h("div", { class: "sheet alert", role: "dialog", "aria-label": title },
    h("div", { class: "handle" }),
    h("h2", { class: "pause-title" }, title),
    h("ol", { class: "steps" }, ...steps.map((t, i) => step(i + 1, t))),
    extra,
    h("button", { class: "pill quiet", onclick: close }, "Done"));
  const layer = h("div", { class: "layer" }, scrim, panel);
  document.body.append(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => (panel.classList.add("open"), scrim.classList.add("open"))));
}

/** Android Chrome's own install dialog, in one tap. */
async function installNow() {
  if (!deferred) return installGuide();
  deferred.prompt();
  await deferred.userChoice;
  deferred = null;
}

/**
 * Opened in a browser (from the link or the QR code): offer the install right away, once per
 * visit, unless already installed or turned down with the card's ✕.
 */
export function offerInstall() {
  if (installed() || read(DISMISSED)) return;
  try {
    if (sessionStorage.getItem("hanyu-install-offered")) return;
    sessionStorage.setItem("hanyu-install-offered", "1");
  } catch {
    /* private mode: offer anyway */
  }
  setTimeout(() => (deferred ? installNow().catch(() => installGuide()) : installGuide()), 700);
}
