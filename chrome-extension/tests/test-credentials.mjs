/**
 * Unit tests for lib/credentials.js (encrypted credential storage).
 * Run with: node chrome-extension/tests/test-credentials.mjs
 *
 * Uses Node's real WebCrypto; chrome.storage.local and IndexedDB are faked.
 */

import assert from 'node:assert/strict';
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs';

const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
      set: async (obj) => { Object.assign(store, structuredClone(obj)); },
      remove: async (key) => { delete store[key]; },
    },
  },
};
globalThis.indexedDB = createFakeIndexedDB();

const {
  saveCredentials, getCredentials, getCredentialStatus, clearCredentials,
} = await import('../lib/credentials.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

const storedText = () => JSON.stringify(store);

console.log('\ncredentials');

await test('nothing saved → null / not saved', async () => {
  assert.equal(await getCredentials(), null);
  assert.deepEqual(await getCredentialStatus(), { saved: false, username: '' });
});

await test('save → read back round-trips', async () => {
  await saveCredentials('2023012345', 'p@ss wörd 密码');
  assert.deepEqual(await getCredentials(), { username: '2023012345', password: 'p@ss wörd 密码' });
});

await test('neither username nor password is stored as readable text', async () => {
  assert.equal(store.credentials.v, 2);
  assert.deepEqual(Object.keys(store.credentials).sort(), ['data', 'iv', 'v']);
  assert.equal(storedText().includes('2023012345'), false);
  assert.equal(storedText().includes('p@ss'), false);
  assert.equal(atob(store.credentials.data).includes('p@ss'), false);
});

await test('the key is non-extractable', async () => {
  const key = globalThis.indexedDB.stores.get('keys').get('credentials-v1');
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
});

await test('status exposes the username but never the password', async () => {
  const status = await getCredentialStatus();
  assert.deepEqual(status, { saved: true, username: '2023012345' });
  assert.equal('password' in status, false);
});

await test('every save uses a fresh IV', async () => {
  const first = structuredClone(store.credentials);
  await saveCredentials('2023012345', 'p@ss wörd 密码');
  assert.notEqual(store.credentials.iv, first.iv);
  assert.notEqual(store.credentials.data, first.data);
});

await test('legacy plain-text credentials are encrypted on first read', async () => {
  store.credentials = { username: 'old-user', password: 'old-pass' };
  assert.deepEqual(await getCredentials(), { username: 'old-user', password: 'old-pass' });
  assert.equal(store.credentials.v, 2);
  assert.equal(storedText().includes('old-pass'), false);
  assert.deepEqual(await getCredentials(), { username: 'old-user', password: 'old-pass' });
});

await test('concurrent first reads of legacy data end up with one working key', async () => {
  globalThis.indexedDB.wipe();
  store.credentials = { username: 'u', password: 'p' };
  const results = await Promise.all([getCredentials(), getCredentials(), getCredentials()]);
  for (const r of results) assert.deepEqual(r, { username: 'u', password: 'p' });
  assert.deepEqual(await getCredentials(), { username: 'u', password: 'p' });
});

await test('tampered ciphertext → treated as not saved', async () => {
  const good = structuredClone(store.credentials);
  const bytes = Uint8Array.from(atob(good.data), c => c.charCodeAt(0));
  bytes[0] ^= 0xff;
  store.credentials = { ...good, data: btoa(String.fromCharCode(...bytes)) };
  assert.equal(await getCredentials(), null);
  store.credentials = good;
  assert.deepEqual(await getCredentials(), { username: 'u', password: 'p' });
});

await test('lost key → treated as not saved, and saving again works', async () => {
  globalThis.indexedDB.wipe();
  assert.equal(await getCredentials(), null);
  assert.deepEqual(await getCredentialStatus(), { saved: false, username: '' });
  await saveCredentials('u2', 'p2');
  assert.deepEqual(await getCredentials(), { username: 'u2', password: 'p2' });
});

await test('clear removes both the ciphertext and the key', async () => {
  await clearCredentials();
  assert.equal('credentials' in store, false);
  assert.equal(globalThis.indexedDB.stores.get('keys').size, 0);
  assert.equal(await getCredentials(), null);
});

await test('malformed stored value → null', async () => {
  store.credentials = { v: 2 };
  assert.equal(await getCredentials(), null);
  store.credentials = 'garbage';
  assert.equal(await getCredentials(), null);
  delete store.credentials;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
