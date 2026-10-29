// What can be practised for each word. One "card" = one word × one skill.

export const SKILLS = Object.freeze({
  meaning: { from: "hanzi", to: "meaning", answer: "choice", slowMs: 8_000 }, // see 你好, pick "hello"
  listening: { from: "sound", to: "hanzi", answer: "choice", slowMs: 8_000 }, // hear nǐ hǎo, pick 你好
  recall: { from: "meaning", to: "hanzi", answer: "choice", slowMs: 10_000 }, // see "hello", pick 你好
  pinyin: { from: "hanzi", to: "pinyin", answer: "typed", slowMs: 15_000 }, // see 你好, type ni3 hao3
  write: { from: "sound", to: "handwriting", answer: "self", slowMs: Infinity }, // dictation on paper
  // conversation mode: one card per dialogue × level (key "dlg:<unit id>"), passed or not (see conversation.js)
  "dlg-listen": { from: "dialogue", to: "understanding", answer: "level", slowMs: Infinity },
  "dlg-shadow": { from: "dialogue", to: "speech", answer: "level", slowMs: Infinity },
  "dlg-reply": { from: "dialogue", to: "reply", answer: "level", slowMs: Infinity },
  "dlg-meaning": { from: "dialogue", to: "meaning", answer: "level", slowMs: Infinity },
  "dlg-build": { from: "dialogue", to: "word order", answer: "level", slowMs: Infinity },
  "dlg-roleplay": { from: "dialogue", to: "speech", answer: "level", slowMs: Infinity },
  "dlg-vary": { from: "dialogue", to: "speech", answer: "level", slowMs: Infinity },
});

/** A word is mastered when these four are right. */
export const CORE_SKILLS = Object.freeze(["meaning", "listening", "pinyin", "recall"]);

/** Practised only in their own mode (dictation), never required for mastery. */
export const EXTRA_SKILLS = Object.freeze(["write"]);

/** Questions that need sound (hear the word, dictation): left out when you can't listen now. */
export const SOUND_SKILLS = Object.freeze(["listening", "write"]);

/** Conversation levels: never part of word sessions, word status or word stats. */
export const CONVERSATION_SKILLS = Object.freeze(Object.keys(SKILLS).filter((s) => s.startsWith("dlg-")));
