// The voice: the device's own Chinese voice (Web Speech API), which works offline once the
// voice is installed (iPhone/Mac: Settings → Accessibility → Spoken Content → Voices → Chinese).
// Choice, best first: the voice the learner picked; voices on the device before voices that need
// the internet (Chrome's "Google" voices); Premium, then Enhanced, then basic quality; then
// Adam's favourites (Han first). Only mainland Mandarin voices (zh-CN), never Taiwan or Cantonese.

export const FAVOURITES = ["Han", "Lili", "Li-mu", "Yu-shu", "Tingting"];
export const CANCEL_GAP = 150; // ms between stopping a word and starting the next (Safari on iPhone)
export const SLOW = 0.45; // slow speed = 45% of the normal speed (60% sounded almost the same on an iPhone)
// voiceName = SYSTEM: name no voice, only "Mandarin (zh-CN)", so the device reads with the voice
// set in its own settings (iPhone: Spoken Content → Voices → Chinese → Mandarin). Safari doesn't
// list Premium/Enhanced voices to web pages; this may still reach them.
export const SYSTEM = "system";

// Mainland Mandarin, however the device writes it: zh-CN (iPhone, Mac), zh_CN, zh-Hans-CN,
// cmn-Hans-CN, and zh_CN_#Hans (Chrome on Android). Never Taiwan, Hong Kong, Macau, Singapore
// or Cantonese.
export function isMandarin(v) {
  const parts = String(v.lang ?? "").toLowerCase().split(/[-_#]+/).filter(Boolean);
  if (!["zh", "cmn"].includes(parts[0])) return false;
  if (parts.some((p) => ["tw", "hk", "mo", "sg", "yue", "hant"].includes(p))) return false;
  return parts.includes("cn");
}
const quality = (v) => (/premium/i.test(`${v.name} ${v.voiceURI}`) ? 3 : /enhanced/i.test(`${v.name} ${v.voiceURI}`) ? 2 : 1);
const favourite = (v) => {
  const i = FAVOURITES.findIndex((n) => new RegExp(`(^|[\\s.])${n}\\b`, "i").test(`${v.name} ${v.voiceURI}`));
  return i < 0 ? FAVOURITES.length : i;
};

/** The device's Mandarin voices, best first (the `chosen` name, if installed, comes first). */
export function rankVoices(voices, chosen = null) {
  return voices
    .filter(isMandarin)
    .sort((a, b) =>
      (b.name === chosen) - (a.name === chosen) ||
      (b.localService !== false) - (a.localService !== false) ||
      quality(b) - quality(a) ||
      favourite(a) - favourite(b) ||
      a.name.localeCompare(b.name));
}

/** For a settings screen: [{name, quality: 'premium'|'enhanced'|'basic', offline}] best first. */
export function describeVoices(voices, chosen = null) {
  return rankVoices(voices, chosen).map((v) => ({
    name: v.name,
    quality: ["basic", "enhanced", "premium"][quality(v) - 1],
    offline: v.localService !== false,
  }));
}

/**
 * speaker.speak(text, {slow}) reads Chinese aloud and resolves when it is done:
 * {ok: true, voice} or {ok: false, reason: 'no-speech' | 'no-chinese-voice' | 'error'}.
 * On iPhone the first speak() must come from a tap (Safari's rule).
 * @param voiceName  the learner's choice (engine.settings.voice), null = the best one
 * @param rate       normal speed (engine.settings.speechRate, 1 = the voice's own speed)
 */
export function createSpeaker({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, voiceName = null, rate = 1 } = {}) {
  // voices load a little after the page opens: wait for them (at most 1.5 s)
  let waited = false; // a phone that lists no voices: wait for them only once, not before every word
  async function voices() {
    if (!synth) return [];
    let list = synth.getVoices();
    if (list.length || waited) return list;
    waited = true;
    await new Promise((resolve) => {
      const done = () => {
        synth.removeEventListener?.("voiceschanged", done);
        resolve();
      };
      synth.addEventListener?.("voiceschanged", done);
      setTimeout(done, 1500);
    });
    return synth.getVoices();
  }

  let current = null;
  return {
    voices,
    async list() {
      return describeVoices(await voices(), voiceName);
    },
    async speak(text, { slow = false } = {}) {
      if (!synth || !Utterance) return { ok: false, reason: "no-speech" };
      const list = await voices();
      // no Mandarin voice listed (many Android phones don't list their voices to web pages):
      // ask for Chinese anyway, and the phone reads with its own Chinese voice if it has one
      const voice = voiceName === SYSTEM ? { name: SYSTEM, lang: "zh-CN" } : rankVoices(list, voiceName)[0] ?? { name: SYSTEM, lang: "zh-CN", guessed: true };
      if (voice.guessed && list.length && !list.some((v) => /^(zh|cmn)/i.test(v.lang ?? ""))) return { ok: false, reason: "no-chinese-voice" };
      // Stop the word still being read, but only if one is: Safari on iPhone drops or cuts a word
      // started in the same moment as a cancel (WebKit bug 238189), so a cancel is followed by a
      // short wait. Chrome (Android) can also stay paused after a while: resume before speaking.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        await new Promise((r) => setTimeout(r, CANCEL_GAP));
      }
      synth.resume?.();
      const u = new Utterance(text);
      current = u; // kept: Chrome can lose an utterance nothing points to, and never play it
      if (voice.name !== SYSTEM) u.voice = voice;
      u.lang = voice.lang;
      u.rate = slow ? rate * SLOW : rate;
      return new Promise((resolve) => {
        // safety: some browsers never fire "end"; give up after a generous time
        const timer = setTimeout(() => resolve({ ok: true, voice: voice.name }), 3000 + (800 * [...text].length) / u.rate);
        u.onend = () => (clearTimeout(timer), resolve({ ok: true, voice: voice.name }));
        u.onerror = (e) => {
          clearTimeout(timer);
          const stopped = e?.error === "interrupted" || e?.error === "canceled"; // another word started
          resolve({ ok: false, reason: stopped ? "stopped" : "error", voice: voice.name });
        };
        synth.speak(u);
      });
    },
    stop() {
      if (synth?.speaking || synth?.pending) synth.cancel(); // a cancel with nothing playing can make Safari drop the next word
    },
  };
}
