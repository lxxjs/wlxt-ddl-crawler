/**
 * Typed wrappers for chrome.storage.local.
 */

const KEYS = {
  CREDENTIALS: 'credentials',     // { username, password }
  HOMEWORK_CACHE: 'homeworkCache', // { updatedAt, homework: [...] }
  SETTINGS: 'settings',           // { refreshInterval, notifications }
};

async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getCredentials() {
  return await get(KEYS.CREDENTIALS);
}

async function saveCredentials(username, password) {
  await set(KEYS.CREDENTIALS, { username, password });
}

async function getHomeworkCache() {
  return await get(KEYS.HOMEWORK_CACHE);
}

async function saveHomeworkCache(homework) {
  await set(KEYS.HOMEWORK_CACHE, {
    updatedAt: Date.now(),
    homework,
  });
}

async function getSettings() {
  const settings = await get(KEYS.SETTINGS);
  return {
    refreshInterval: 30, // minutes
    notifications: true,
    ...settings,
  };
}

async function saveSettings(settings) {
  await set(KEYS.SETTINGS, settings);
}

export {
  getCredentials,
  saveCredentials,
  getHomeworkCache,
  saveHomeworkCache,
  getSettings,
  saveSettings,
};
