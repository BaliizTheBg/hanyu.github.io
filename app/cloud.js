// Automatic sync between devices: the progress file (the same as a backup) lives in a secret
// gist on Adam's GitHub. Each sync = take the gist's file, merge it into this device (union of
// the two answer logs: nothing is ever lost, merging twice changes nothing), then put the merged
// file back if this device had answers the gist didn't. Works with a GitHub token that can only
// touch gists ("gist" scope). Without network, it just says so; the app keeps working.

const API = "https://api.github.com";
const DESCRIPTION = "Hanyu progress (sync)";
const FILE = "hanyu-progress.json";

// the file is compressed (gzip, then text) so it stays small for years of answers
async function pack(data) {
  const gz = await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  let s = "";
  const bytes = new Uint8Array(gz);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return JSON.stringify({ format: "hanyu-sync", v: 1, gz: btoa(s) });
}
async function unpack(text) {
  const { gz } = JSON.parse(text);
  const bytes = Uint8Array.from(atob(gz), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
}

/**
 * @param token    GitHub token (classic, "gist" scope only)
 * @param gistId   the gist found or made by an earlier sync (saved by the app), or null
 * @returns sync(engine) → {ok: true, gistId, received, sent} or {ok: false, reason: 'offline' | 'token' | 'scope' | 'error', message}
 */
export function createSync({ token, gistId = null, fetch = globalThis.fetch }) {
  const call = async (path, options = {}) => {
    // a secret gist's raw file is read without the token (its address is the secret)
    const raw = path.startsWith("http");
    const r = await fetch(raw ? path : API + path, raw ? {} : {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(options.body && { "Content-Type": "application/json" }) },
    }).catch(() => {
      throw Object.assign(new Error("no connection to GitHub"), { reason: "offline" });
    });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("GitHub refused the token"), { reason: "token" });
    if (!r.ok) throw Object.assign(new Error(`GitHub answered ${r.status}`), { reason: "error" });
    // the token is kept on the device: it must only be able to touch gists, never the repos
    // (where the private book is). Classic tokens list their rights in this header.
    const scopes = raw ? "" : (r.headers?.get?.("x-oauth-scopes") ?? "");
    if (scopes.split(",").map((x) => x.trim()).some((x) => x && x !== "gist")) {
      throw Object.assign(new Error("this token can do more than sync"), { reason: "scope" });
    }
    return r;
  };

  async function findGist() {
    for (let page = 1; page <= 10; page++) {
      const list = await (await call(`/gists?per_page=100&page=${page}`)).json();
      const g = list.find((x) => x.description === DESCRIPTION && x.files?.[FILE]);
      if (g || list.length < 100) return g?.id ?? null;
    }
    return null;
  }

  return {
    get gistId() {
      return gistId;
    },
    async sync(engine) {
      try {
        gistId ??= await findGist();
        let remote = null;
        if (gistId) {
          const f = (await (await call(`/gists/${gistId}`)).json()).files?.[FILE];
          // a big file is not given in full: then read it from its own address
          if (f) remote = await unpack(f.truncated ? await (await call(f.raw_url)).text() : f.content);
        }
        let local = await engine.exportData();
        const ids = (list) => new Set((list ?? []).map((x) => x.id));
        const mine = ids(local.reviews);
        const myExams = ids(local.exams);
        // a reset on either side: nothing from before the latest one counts
        const cut = Math.max(local.resetAt ?? 0, remote?.resetAt ?? 0);
        const received = remote ? remote.reviews.filter((r) => !mine.has(r.id) && r.time > cut).length : 0;
        const theyReset = (remote?.resetAt ?? 0) > (local.resetAt ?? 0);
        if (remote && (received || theyReset || (remote.exams ?? []).some((e) => !myExams.has(e.id) && e.time > cut))) {
          await engine.importData(remote);
          local = await engine.exportData();
        }
        const sent = local.reviews.length - (remote?.reviews.length ?? 0);
        const examsToSend = local.exams.length > (remote?.exams?.length ?? 0);
        if (!gistId) {
          const g = await (await call("/gists", { method: "POST", body: JSON.stringify({ description: DESCRIPTION, public: false, files: { [FILE]: { content: await pack(local) } } }) })).json();
          gistId = g.id;
        } else if (sent > 0 || examsToSend || (local.resetAt ?? 0) > (remote?.resetAt ?? 0)) {
          await call(`/gists/${gistId}`, { method: "PATCH", body: JSON.stringify({ files: { [FILE]: { content: await pack(local) } } }) });
        }
        return { ok: true, gistId, received, sent: Math.max(0, sent) };
      } catch (e) {
        return { ok: false, reason: e.reason ?? "error", message: e.message };
      }
    },
  };
}
