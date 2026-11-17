/**
 * Background service worker.
 * Handles alarm-based refresh, session keep-alive and recovery, message
 * routing, badge updates, and login detection.
 *
 * Session recovery, in order, whenever 网络学堂 says we are logged out:
 *   1. trySilentLogin()  — password-less SSO re-login via fetch (lib/auth.js)
 *   2. startTabLogin()   — if credentials are saved and auto login is on, open
 *                          the login page in a background tab and let
 *                          content/autofill.js fill and submit the form
 *   3. ask the user      — badge "!" plus one notification
 *
 * Service workers are stopped when idle, so the tab login is event-driven
 * (state in chrome.storage.local) instead of awaiting a long promise.
 */

import {
  isSessionValid, trySilentLogin, resetSessionCache, SessionExpiredError,
  LOGIN_SUCCESS_PATH, LOGIN_URL,
} from '../lib/auth.js';
import { getAllHomework } from '../lib/api.js';
import {
  saveHomeworkCache, getHomeworkCache, getSettings, getCredentials, clampInterval,
  getRefreshStatus, saveRefreshStatus, getNotified, saveNotified,
  getSessionState, saveSessionState, getAutoLoginState, saveAutoLoginState,
} from '../lib/storage.js';
import { refreshComputedFields, mergeWithPrevious, selectNewUrgent } from '../lib/models.js';

const REFRESH_ALARM = 'refreshHomework';
const KEEPALIVE_ALARM = 'keepSessionAlive';
const LOGIN_TIMEOUT_ALARM = 'autoLoginTimeout';

const KEEPALIVE_MINUTES = 10;
const AUTO_LOGIN_TIMEOUT_MINUTES = 1;
const AUTO_LOGIN_MAX_FAILURES = 2;
const AUTO_LOGIN_MIN_GAP_MS = 10 * 60 * 1000;

const LOGIN_NOTIFICATION_ID = 'login-required';
const ID_ORIGIN = 'https://id.tsinghua.edu.cn/';
const RED = '#ff4757';
const GREEN = '#2ed573';

// --- Alarm setup ---

async function setupAlarmsAndRefresh() {
  const settings = await getSettings();
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: settings.refreshInterval });
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES });
  await refreshHomework();
}

chrome.runtime.onInstalled.addListener(setupAlarmsAndRefresh);
chrome.runtime.onStartup.addListener(setupAlarmsAndRefresh);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    await refreshHomework();
  } else if (alarm.name === KEEPALIVE_ALARM) {
    await keepSessionAlive();
  } else if (alarm.name === LOGIN_TIMEOUT_ALARM) {
    await onAutoLoginTimeout();
  }
});

// --- Session handling ---

/**
 * Touch the student page so the server-side session does not idle out.
 * If it already expired, a full refresh runs the recovery chain.
 */
async function keepSessionAlive() {
  if (await isSessionValid()) {
    await markSessionOk();
  } else {
    await refreshHomework();
  }
}

async function markSessionOk() {
  const [session, autoLogin] = await Promise.all([getSessionState(), getAutoLoginState()]);
  if (session.loginNotified || session.attentionTabId) {
    await saveSessionState({ loginNotified: false });
    chrome.notifications.clear(LOGIN_NOTIFICATION_ID);
  }
  if (autoLogin.failures > 0) {
    await saveAutoLoginState({ ...autoLogin, failures: 0 });
  }
}

/**
 * Make sure we have a 网络学堂 session, restoring it if possible.
 * Returns { ok } or { ok: false, pending } where `pending` means a background
 * tab login was started and the refresh will re-run when it completes.
 */
async function ensureSession({ manual = false } = {}) {
  if (await isSessionValid()) {
    await markSessionOk();
    return { ok: true };
  }

  const silent = await trySilentLogin();
  if (silent.ok && await isSessionValid()) {
    await markSessionOk();
    return { ok: true };
  }
  console.log(`Session expired; silent login: ${silent.reason}`);

  const pending = await startTabLogin({ manual });
  return { ok: false, pending };
}

async function tabExists(tabId) {
  if (tabId === null || tabId === undefined) return false;
  return chrome.tabs.get(tabId).then(() => true, () => false);
}

/**
 * Open the login page in a background tab for content/autofill.js to submit.
 * Returns true if a tab login is (now or already) in progress.
 */
async function startTabLogin({ manual = false } = {}) {
  const [settings, creds, state] = await Promise.all([
    getSettings(), getCredentials(), getAutoLoginState(),
  ]);

  if (!settings.autoLogin || !creds?.username || !creds?.password) return false;
  if (await tabExists(state.pendingTabId)) return true;

  // Never hammer the login endpoint: repeated failures can lock the account.
  if (state.failures >= AUTO_LOGIN_MAX_FAILURES) return false;
  if (!manual && Date.now() - state.lastAttemptAt < AUTO_LOGIN_MIN_GAP_MS) return false;

  const tab = await chrome.tabs.create({ url: LOGIN_URL, active: false });
  await saveAutoLoginState({
    ...state,
    pendingTabId: tab.id,
    submitted: false,
    lastAttemptAt: Date.now(),
  });
  chrome.alarms.create(LOGIN_TIMEOUT_ALARM, { delayInMinutes: AUTO_LOGIN_TIMEOUT_MINUTES });
  return true;
}

async function onAutoLoginTimeout() {
  const state = await getAutoLoginState();
  if (state.pendingTabId === null) return;

  const tabId = state.pendingTabId;
  const loggedIn = await isSessionValid();

  await saveAutoLoginState({
    ...state,
    pendingTabId: null,
    submitted: false,
    failures: loggedIn ? 0 : state.failures + 1,
  });
  chrome.tabs.remove(tabId).catch(() => {});

  if (loggedIn) {
    await refreshHomework();
  } else {
    updateBadge('!', RED);
    await saveRefreshStatus('session_expired');
    await notifyLoginRequired();
  }
}

/**
 * The background login tab hit something only the user can do.
 */
async function onLoginNeedsUser(tabId, reason) {
  const state = await getAutoLoginState();
  if (state.pendingTabId !== tabId) return;

  chrome.alarms.clear(LOGIN_TIMEOUT_ALARM);

  // Stop automatic attempts until the user logs in successfully or saves new
  // credentials — retrying here risks captchas, 2FA prompts or a lockout.
  await saveAutoLoginState({
    ...state, pendingTabId: null, submitted: false, failures: AUTO_LOGIN_MAX_FAILURES,
  });

  if (reason === 'bad_credentials') {
    chrome.tabs.remove(tabId).catch(() => {});
    await notifyLoginRequired('保存的用户名或密码不正确，请在扩展设置中更新');
  } else {
    // 2FA, captcha or anything unexpected: keep the tab so the user can finish there.
    const messages = {
      two_factor: '需要完成二次认证，点击此处继续登录',
      captcha: '需要输入验证码，点击此处继续登录',
    };
    await notifyLoginRequired(messages[reason] || '自动登录未成功，点击此处手动登录', tabId);
  }

  updateBadge('!', RED);
  await saveRefreshStatus('session_expired');
}

// --- Core refresh logic ---

let inFlightRefresh = null;

/**
 * Refresh homework. Concurrent callers share one run.
 */
function refreshHomework(options) {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh(options).finally(() => { inFlightRefresh = null; });
  }
  return inFlightRefresh;
}

/**
 * Fetch homework; if the API rejects the session even though the student
 * page looked fine, get a fresh token (re-logging in silently if needed)
 * and try exactly once more.
 */
async function fetchHomeworkWithRetry() {
  try {
    return await getAllHomework();
  } catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
    console.warn('API rejected the session, retrying with a fresh token:', e.message);

    resetSessionCache();
    if (!(await isSessionValid())) {
      await trySilentLogin();
      if (!(await isSessionValid())) throw e;
    }
    return await getAllHomework();
  }
}

async function reportSessionExpired(pending) {
  const error = pending ? 'logging_in' : 'session_expired';
  updateBadge('!', RED);
  await saveRefreshStatus(error);
  if (!pending) await notifyLoginRequired();
  return { success: false, error };
}

async function doRefresh({ manual = false } = {}) {
  try {
    const session = await ensureSession({ manual });
    if (!session.ok) return await reportSessionExpired(session.pending);

    // Session is valid and CSRF token is now cached by isSessionValid()
    const previous = await getHomeworkCache();
    const { homework, failedCourses } = await fetchHomeworkWithRetry();

    // Courses that failed keep what we last knew about them.
    const merged = mergeWithPrevious(homework, previous?.homework, failedCourses.map(c => c.id));
    const failedNames = failedCourses.map(c => c.name);

    await saveHomeworkCache(merged, failedNames);
    await saveRefreshStatus(null);
    updateBadgeFromHomework(merged);
    await checkUrgentNotifications(merged);

    return { success: true, homework: merged, failedCourses: failedNames };
  } catch (e) {
    // Keep the previous cache: a failed refresh must not look like "no homework".
    if (e instanceof SessionExpiredError) {
      // Still rejected after a fresh token. Ask the user rather than opening
      // login tabs in a loop: a tab login would "succeed" and land here again.
      console.warn('Session rejected by the API:', e.message);
      return await reportSessionExpired(false).catch(() => ({ success: false, error: 'session_expired' }));
    }
    console.error('Refresh failed:', e);
    updateBadge('!', RED);
    await saveRefreshStatus(e.message).catch(() => {});
    return { success: false, error: e.message };
  }
}

// --- Badge ---

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color });
}

function updateBadgeFromHomework(homework) {
  const urgentCount = homework.filter(hw => hw.urgency === 1).length;

  if (urgentCount > 0) {
    updateBadge(String(urgentCount), RED);
  } else {
    const activeCount = homework.filter(hw => hw.urgency > 0).length;
    if (activeCount > 0) {
      updateBadge(String(activeCount), GREEN);
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
}

// --- Notifications ---

/**
 * Notify about homework due within 24h — once per homework, not on every
 * refresh. A changed deadline counts as new.
 */
async function checkUrgentNotifications(homework) {
  const settings = await getSettings();
  const { fresh, next } = selectNewUrgent(homework, await getNotified());
  await saveNotified(next);

  if (!settings.notifications || fresh.length === 0) return;

  chrome.notifications.create(`urgent-${Date.now()}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `${fresh.length} 项作业将在24小时内截止`,
    message: fresh.slice(0, 3).map(hw => `[${hw.courseName}] ${hw.title}`).join('\n'),
  });
}

/**
 * Tell the user they have to log in — once per expiry, not on every refresh.
 * `attentionTabId` is a tab the notification should bring to the front.
 */
async function notifyLoginRequired(message, attentionTabId = null) {
  const [settings, session] = await Promise.all([getSettings(), getSessionState()]);
  if (session.loginNotified && !message) return;

  await saveSessionState({ loginNotified: true, attentionTabId });
  if (!settings.notifications) return;

  chrome.notifications.create(LOGIN_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: '网络学堂需要重新登录',
    message: message || '登录已过期，点击此处打开登录页面',
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId !== LOGIN_NOTIFICATION_ID) return;
  chrome.notifications.clear(notificationId);

  const { attentionTabId } = await getSessionState();
  if (await tabExists(attentionTabId)) {
    const tab = await chrome.tabs.update(attentionTabId, { active: true });
    chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  } else {
    chrome.tabs.create({ url: LOGIN_URL });
  }
});

// --- Login detection via webNavigation ---

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0 || !details.url.includes(LOGIN_SUCCESS_PATH)) return;

  // Was this our own background login tab?
  const state = await getAutoLoginState();
  const wasAutoLogin = state.pendingTabId === details.tabId;
  if (wasAutoLogin) {
    await saveAutoLoginState({ ...state, pendingTabId: null, submitted: false, failures: 0 });
    chrome.alarms.clear(LOGIN_TIMEOUT_ALARM);
  }

  console.log('Login detected, refreshing homework...');
  setTimeout(async () => {
    const result = await refreshHomework();
    if (wasAutoLogin) chrome.tabs.remove(details.tabId).catch(() => {});
    chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS', ...result }).catch(() => {});
  }, 2000);
}, { url: [{ hostContains: 'learn.tsinghua.edu.cn' }] });

// --- Message handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REFRESH') {
    refreshHomework({ manual: true }).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_HOMEWORK') {
    Promise.all([getHomeworkCache(), getRefreshStatus()]).then(([cache, status]) => {
      sendResponse({
        homework: cache?.homework ? cache.homework.map(refreshComputedFields) : null,
        updatedAt: cache?.updatedAt ?? null,
        failedCourses: cache?.failedCourses ?? [],
        lastError: status.lastError,
      });
    });
    return true;
  }

  if (message.type === 'OPEN_LOGIN') {
    chrome.tabs.create({ url: LOGIN_URL });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'UPDATE_ALARM') {
    chrome.alarms.clear(REFRESH_ALARM, () => {
      chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: clampInterval(message.interval) });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CREDENTIALS_UPDATED') {
    // New credentials deserve a fresh set of auto-login attempts.
    getAutoLoginState()
      .then(state => saveAutoLoginState({ ...state, failures: 0, lastAttemptAt: 0 }))
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  // The two messages below come from content/autofill.js on the login page.
  const fromLoginPage = sender.tab && sender.url?.startsWith(ID_ORIGIN);

  if (message.type === 'LOGIN_PAGE_READY') {
    if (!fromLoginPage) {
      sendResponse({ pending: false, autoSubmit: false });
      return false;
    }
    getAutoLoginState().then(async (state) => {
      const pending = state.pendingTabId === sender.tab.id;
      // Submit at most once per attempt, so an error page cannot cause a loop.
      const autoSubmit = pending && !state.submitted;
      if (autoSubmit) await saveAutoLoginState({ ...state, submitted: true });
      sendResponse({ pending, autoSubmit });
    });
    return true;
  }

  if (message.type === 'LOGIN_NEEDS_USER') {
    if (fromLoginPage) onLoginNeedsUser(sender.tab.id, message.reason);
    sendResponse({ ok: true });
    return false;
  }
});
