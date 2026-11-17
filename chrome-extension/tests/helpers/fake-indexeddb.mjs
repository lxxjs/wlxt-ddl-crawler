/**
 * The few IndexedDB calls lib/credentials.js makes, backed by a Map.
 * Enough for Node tests; not a general IndexedDB implementation.
 */
export function createFakeIndexedDB() {
  const stores = new Map();

  function transaction(storeName) {
    const tx = {};
    const request = (fn) => {
      const req = {};
      queueMicrotask(() => {
        try {
          req.result = fn(stores.get(storeName));
          req.onsuccess?.();
          queueMicrotask(() => tx.oncomplete?.());
        } catch (e) {
          tx.error = e;
          tx.onerror?.();
        }
      });
      return req;
    };
    tx.objectStore = () => ({
      get: (key) => request(store => store.get(key)),
      put: (value, key) => request(store => { store.set(key, value); }),
      delete: (key) => request(store => { store.delete(key); }),
    });
    return tx;
  }

  const db = {
    createObjectStore: (name) => { stores.set(name, new Map()); },
    transaction,
  };

  return {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = db;
        if (stores.size === 0) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    /** Test hook: forget every stored key, as if site data had been cleared. */
    wipe() { for (const store of stores.values()) store.clear(); },
    stores,
  };
}
