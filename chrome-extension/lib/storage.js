/**
 * Typed wrappers for chrome.storage.local.
 */

const KEYS = {
  CREDENTIALS: 'credentials',       // { username, password }
  HOMEWORK_CACHE: 'homeworkCache',   // { updatedAt, homework: [...], failedCourses: [name] }
  SETTINGS: 'settings',             // { refreshInterval, notifications, autoLogin }
  REFRESH_STATUS: 'refreshStatus',   // { lastAttemptAt, lastError }
  NOTIFIED: 'notifiedUrgent',        // { [homeworkKey]: deadlineISO }
  SESSION_STATE: 'sessionState',     // { loginNotified }
  AUTO_LOGIN: 'autoLoginState',      // { pendingTabId, submitted, lastAttemptAt, failures }
};

const MIN_REFRESH_INTERVAL = 5;
const MAX_REFRESH_INTERVAL = 120;

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

async function saveHomeworkCache(homework, failedCourses = []) {
  await set(KEYS.HOMEWORK_CACHE, {
    updatedAt: Date.now(),
    homework,
    failedCourses,
  });
}

/**
 * Clamp a refresh interval (minutes) into the supported range.
 * Exported for testing.
 */
function clampInterval(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.min(MAX_REFRESH_INTERVAL, Math.max(MIN_REFRESH_INTERVAL, n));
}

async function getSettings() {
  const settings = await get(KEYS.SETTINGS);
  const merged = {
    refreshInterval: 30, // minutes
    notifications: true,
    autoLogin: true,     // only takes effect when credentials are saved
    ...settings,
  };
  merged.refreshInterval = clampInterval(merged.refreshInterval);
  return merged;
}

async function saveSettings(settings) {
  await set(KEYS.SETTINGS, settings);
}

async function getRefreshStatus() {
  return (await get(KEYS.REFRESH_STATUS)) ?? { lastAttemptAt: null, lastError: null };
}

async function saveRefreshStatus(lastError) {
  await set(KEYS.REFRESH_STATUS, { lastAttemptAt: Date.now(), lastError });
}

async function getNotified() {
  return (await get(KEYS.NOTIFIED)) ?? {};
}

async function saveNotified(notified) {
  await set(KEYS.NOTIFIED, notified);
}

async function getSessionState() {
  return (await get(KEYS.SESSION_STATE)) ?? { loginNotified: false };
}

async function saveSessionState(state) {
  await set(KEYS.SESSION_STATE, state);
}

async function getAutoLoginState() {
  return {
    pendingTabId: null,
    submitted: false,
    lastAttemptAt: 0,
    failures: 0,
    ...(await get(KEYS.AUTO_LOGIN)),
  };
}

async function saveAutoLoginState(state) {
  await set(KEYS.AUTO_LOGIN, state);
}

export {
  getCredentials,
  saveCredentials,
  getHomeworkCache,
  saveHomeworkCache,
  clampInterval,
  getSettings,
  saveSettings,
  getRefreshStatus,
  saveRefreshStatus,
  getNotified,
  saveNotified,
  getSessionState,
  saveSessionState,
  getAutoLoginState,
  saveAutoLoginState,
};
