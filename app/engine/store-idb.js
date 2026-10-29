// On-device storage: an IndexedDB database inside Safari / the installed app.
// Works offline, survives restarts, never leaves the device unless exported.
//
// Database "hanyu", 3 tables:
//   cards    one row per word × skill   key: id ("你好|ni3 hao3#meaning")   indexes: due, key
//   reviews  one row per answer (log)   key: id (unique per device)     indexes: time, key
//   meta     settings, deviceId, activeDays, schemaVersion              key: name

export const DB_NAME = "hanyu";
export const DB_VERSION = 1;

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const cards = db.createObjectStore("cards", { keyPath: "id" });
    cards.createIndex("due", "due");
    cards.createIndex("key", "key");
    const reviews = db.createObjectStore("reviews", { keyPath: "id" });
    reviews.createIndex("time", "time");
    reviews.createIndex("key", "key");
    db.createObjectStore("meta", { keyPath: "name" });
  }
  // future versions: add `if (oldVersion < 2) { ... }` here, never edit the block above
}

export async function openIdbStore(name = DB_NAME, idb = globalThis.indexedDB) {
  const open = idb.open(name, DB_VERSION);
  open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion);
  const db = await req(open);
  // ask the browser not to clear this data when space is low
  try {
    await globalThis.navigator?.storage?.persist?.();
  } catch {
    /* not supported: data is still stored */
  }

  const store = {
    db,
    async loadCards() {
      return req(db.transaction("cards").objectStore("cards").getAll());
    },
    async allReviews() {
      const rows = await req(db.transaction("reviews").objectStore("reviews").index("time").getAll());
      return rows;
    },
    async reviewsSince(time) {
      const idx = db.transaction("reviews").objectStore("reviews").index("time");
      return req(idx.getAll(IDBKeyRange.lowerBound(time)));
    },
    async reviewsOf(key) {
      return req(db.transaction("reviews").objectStore("reviews").index("key").getAll(key));
    },
    async getMeta(name) {
      const row = await req(db.transaction("meta").objectStore("meta").get(name));
      return row?.value;
    },
    async setMeta(name, value) {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ name, value });
      await done(tx);
    },
    /** One answer = card + log row + meta changes, written together or not at all. */
    async commit(card, review, meta = {}) {
      const tx = db.transaction(["cards", "reviews", "meta"], "readwrite");
      tx.objectStore("cards").put(card);
      tx.objectStore("reviews").put(review);
      for (const [name, value] of Object.entries(meta)) tx.objectStore("meta").put({ name, value });
      await done(tx);
    },
    /** Replace all cards and reviews (after an import/merge), in one transaction. */
    async replaceAll({ cards, reviews, meta = {} }) {
      const tx = db.transaction(["cards", "reviews", "meta"], "readwrite");
      const c = tx.objectStore("cards");
      const r = tx.objectStore("reviews");
      c.clear();
      r.clear();
      for (const x of cards) c.put(x);
      for (const x of reviews) r.put(x);
      for (const [name, value] of Object.entries(meta)) tx.objectStore("meta").put({ name, value });
      await done(tx);
    },
    close() {
      db.close();
    },
  };
  if ((await store.getMeta("schemaVersion")) === undefined) await store.setMeta("schemaVersion", DB_VERSION);
  return store;
}
