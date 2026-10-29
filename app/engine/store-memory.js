// Same interface as store-idb.js, kept in memory. Used by the tests (Node has no IndexedDB).

export function createMemoryStore() {
  const cards = new Map();
  const reviews = new Map();
  const meta = new Map();
  const copy = (x) => structuredClone(x);
  const byTime = (a, b) => a.time - b.time || (a.id < b.id ? -1 : 1);
  return {
    async loadCards() {
      return [...cards.values()].map(copy);
    },
    async allReviews() {
      return [...reviews.values()].sort(byTime).map(copy);
    },
    async reviewsSince(time) {
      return [...reviews.values()].filter((r) => r.time >= time).sort(byTime).map(copy);
    },
    async reviewsOf(key) {
      return [...reviews.values()].filter((r) => r.key === key).sort(byTime).map(copy);
    },
    async getMeta(name) {
      return meta.has(name) ? copy(meta.get(name)) : undefined;
    },
    async setMeta(name, value) {
      meta.set(name, copy(value));
    },
    async commit(card, review, metaPatch = {}) {
      cards.set(card.id, copy(card));
      reviews.set(review.id, copy(review));
      for (const [k, v] of Object.entries(metaPatch)) meta.set(k, copy(v));
    },
    async replaceAll({ cards: cs, reviews: rs, meta: m = {} }) {
      cards.clear();
      reviews.clear();
      for (const c of cs) cards.set(c.id, copy(c));
      for (const r of rs) reviews.set(r.id, copy(r));
      for (const [k, v] of Object.entries(m)) meta.set(k, copy(v));
    },
    close() {},
  };
}
