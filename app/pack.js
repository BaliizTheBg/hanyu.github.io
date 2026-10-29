// The book's content (private) is published encrypted, so the public site can't be read
// without the password: AES-GCM with a key made from the password (PBKDF2-SHA256).
// The same code runs in the browser (to open) and in Node (to build the site).

const ITERATIONS = 100_000;
const text = new TextEncoder();

const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Encrypt any JSON content with a password. */
export async function lockPack(content, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), text.encode(JSON.stringify(content)));
  return { v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

/** The content back; throws if the password is wrong. */
export async function openPack(pack, password) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(pack.iv) }, await keyFrom(password, fromB64(pack.salt)), fromB64(pack.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
