// Offline: every file the app needs is kept on the device. The app always opens from the
// device's copy (instant, and it works without internet); when online, each file is refreshed
// in the background, so a new version shows at the next launch.
// When a file is added to the app, add it to FILES (app/test/sw.test.js checks the list).

const CACHE = "hanyu-retired-20261031";
const FILES = [
  "./",
  "index.html",
  "moved.html",
  "icons/icon-180.png",
  "engine/cards.js",
  "engine/conversation.js",
  "engine/engine.js",
  "engine/exam.js",
  "engine/fsrs.js",
  "engine/index.js",
  "engine/lexicon.js",
  "engine/missed.js",
  "engine/path.js",
  "engine/pinyin.js",
  "engine/progress.js",
  "engine/questions.js",
  "engine/session.js",
  "engine/skills.js",
  "engine/store-idb.js",
  "engine/store-memory.js",
  "engine/sync.js",
  "engine/time.js",
  "engine/voice.js",
];

self.addEventListener("install", (event) => {
  // "reload": skip the browser's own short-term copy, so a new version never mixes old and new files
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) => Promise.all(clients
        .filter((client) => client.url.startsWith(self.registration.scope))
        .filter((client) => new URL(client.url).pathname !== new URL("moved.html", self.registration.scope).pathname)
        .map((client) => client.navigate(new URL("moved.html", self.registration.scope).href).catch(() => null)))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(fresh); // refresh in the background for next time
      return cached;
    }
    return (await fresh) ?? new Response("Offline and not saved yet.", { status: 503 });
  })());
});
