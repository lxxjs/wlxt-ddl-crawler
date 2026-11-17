/**
 * Saved login credentials, encrypted at rest.
 *
 * Only the service worker imports this module. The popup and the content
 * script never touch the stored value: they ask the service worker, which
 * decides who gets what (see the message handlers in service-worker.js).
 *
 * Storage:
 *   chrome.storage.local.credentials = { v: 2, iv, data }   AES-GCM ciphertext
 *   IndexedDB "wlxt-reminder" / "keys"                      the AES key
 *
 * The key is generated as non-extractable, so no script — including this
 * extension's own — can read its bytes back out.
 *
 * What this protects against: the password no longer sits as readable text
 * in the Chrome profile, in profile backups, or in a storage dump pasted
 * into a bug report. What it does NOT protect against: anything that can
 * run as this Chrome profile (or copy the whole profile, key included) can
 * still have the extension decrypt it. An extension that logs in on its own
 * has to be able to recover the password, so it cannot do better than this.
 */

const STORAGE_KEY = 'credentials';
const DB_NAME = 'wlxt-reminder';
const KEY_STORE = 'keys';
const KEY_ID = 'credentials-v1';
const FORMAT_VERSION = 2;

// ─── IndexedDB (key storage) ─────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withKeyStore(mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, mode);
    const req = run(tx.objectStore(KEY_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function loadKey({ create }) {
  const existing = await withKeyStore('readonly', store => store.get(KEY_ID));
  if (existing || !create) return existing ?? null;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
  await withKeyStore('readwrite', store => store.put(key, KEY_ID));
  return key;
}

// ─── Encoding ────────────────────────────────────────────────────────────────

function toBase64(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

const isEncrypted = (v) => v?.v === FORMAT_VERSION && typeof v.iv === 'string' && typeof v.data === 'string';
const isLegacyPlaintext = (v) => typeof v?.username === 'string' && typeof v?.password === 'string';

// ─── Serialization of writers ────────────────────────────────────────────────

// Reads can trigger a migration and saves can create the key; run them one
// at a time so two callers never generate two different keys.
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function encryptAndStore(username, password) {
  const key = await loadKey({ create: true });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ username, password }));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  await chrome.storage.local.set({
    [STORAGE_KEY]: { v: FORMAT_VERSION, iv: toBase64(iv), data: toBase64(data) },
  });
}

/**
 * Save (or replace) the credentials.
 */
function saveCredentials(username, password) {
  return serialized(() => encryptAndStore(username, password));
}

/**
 * Return { username, password }, or null when nothing usable is saved.
 * Credentials saved by older versions as plain text are encrypted on first
 * read. A value that cannot be decrypted (key lost) counts as not saved.
 */
function getCredentials() {
  return serialized(async () => {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (!stored) return null;

    if (isLegacyPlaintext(stored)) {
      const { username, password } = stored;
      if (!username || !password) return null;
      await encryptAndStore(username, password);
      return { username, password };
    }

    if (!isEncrypted(stored)) return null;

    try {
      const key = await loadKey({ create: false });
      if (!key) return null;
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(stored.iv) },
        key,
        fromBase64(stored.data),
      );
      const { username, password } = JSON.parse(new TextDecoder().decode(plaintext));
      return username && password ? { username, password } : null;
    } catch (e) {
      console.warn('Saved credentials could not be decrypted:', e?.name || e);
      return null;
    }
  });
}

/**
 * What the settings UI is allowed to know: whether something is saved, and
 * for which username. Never the password.
 */
async function getCredentialStatus() {
  const creds = await getCredentials();
  return { saved: !!creds, username: creds?.username ?? '' };
}

/**
 * Delete the saved credentials and the key that protected them.
 */
function clearCredentials() {
  return serialized(async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
    await withKeyStore('readwrite', store => store.delete(KEY_ID));
  });
}

export { saveCredentials, getCredentials, getCredentialStatus, clearCredentials };
