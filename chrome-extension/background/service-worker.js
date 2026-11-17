/**
 * Background service worker.
 * Handles alarm-based refresh, session keep-alive and recovery, message
 * routing, badge updates, and login detection.
 *
 * probeSession() (lib/auth.js) says whether we are logged in, by asking the
 * API rather than trusting the student page. "unreachable" (offline, server
 * down) is kept apart from "expired": only the latter starts a recovery or
 * asks the user to log in.
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
  probeSession, trySilentLogin, SessionExpiredError, NetworkError,
  LOGIN_SUCCESS_PATH, LOGIN_URL,
} from '../lib/auth.js';
import { getAllHomework } from '../lib/api.js';
import {
  saveHomeworkCache, getHomeworkCache, getSettings, clampInterval,
  getRefreshStatus, saveRefreshStatus, getNotified, saveNotified,
  getSessionState, saveSessionState, getAutoLoginState, saveAutoLoginState,
} from '../lib/storage.js';
import { refreshComputedFields, mergeWithPrevious, selectNewUrgent } from '../lib/models.js';
import {
  getCredentials, saveCredentials, clearCredentials, getCredentialStatus,
} from '../lib/credentials.js';

const REFRESH_ALARM = 'refreshHomework';
const KEEPALIVE_ALARM = 'keepSessionAlive';
const LOGIN_TIMEOUT_ALARM = 'autoLoginTimeout';

const KEEPALIVE_MINUTES = 10;
const AUTO_LOGIN_TIMEOUT_MINUTES = 1;
const AUTO_LOGIN_MAX_FAILURES = 2;
const AUTO_LOGIN_MIN_GAP_MS = 10 * 60 * 1000;

const LOGIN_NOTIFICATION_ID = 'login-required';
const LOGIN_PAGE_PREFIX = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login';
const RED = '#ff4757';
const GREEN = '#2ed573';

// --- Alarm setup ---

async function setupAlarmsAndRefresh() {
  const settings = await getSettings();
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: settings.refreshInterval });
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES });
  // Reading once encrypts credentials an older version stored as plain text,
  // and drops the token the removed cookie-bridge script used to store.
  await getCredentials().catch(() => {});
  await chrome.storage.local.remove('xsrfToken').catch(() => {});
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
 * Touch the session so it does not idle out on the server.
 * If it already expired, a full refresh runs the recovery chain. If the
 * site is unreachable there is nothing to do until the network is back.
 */
async function keepSessionAlive() {
  if ((await probeSession()) === 'expired') {
    await refreshHomework();
  }
}

/**
 * Called after homework was actually fetched: the session works, so clear
 * the "please log in" state and allow background logins again.
 */
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
 * Returns { ok: true },
 *         { ok: false, offline: true } when the site cannot be reached, or
 *         { ok: false, pending } where `pending` means a background tab login
 *         was started and the refresh will re-run when it completes.
 */
async function ensureSession({ manual = false } = {}) {
  const probe = await probeSession();
  if (probe === 'valid') return { ok: true };
  if (probe === 'unreachable') return { ok: false, offline: true };

  const silent = await trySilentLogin();
  if (silent.ok && (await probeSession()) === 'valid') return { ok: true };
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

  // Never hammer the login endpoint: repeated attempts can lock the account.
  // `failures` counts attempts since homework was last fetched successfully,
  // so a login that "works" but still leaves the API refusing us cannot loop.
  if (state.failures >= AUTO_LOGIN_MAX_FAILURES) return false;
  if (!manual && Date.now() - state.lastAttemptAt < AUTO_LOGIN_MIN_GAP_MS) return false;

  const tab = await chrome.tabs.create({ url: LOGIN_URL, active: false });
  await saveAutoLoginState({
    ...state,
    pendingTabId: tab.id,
    submitted: false,
    lastAttemptAt: Date.now(),
    failures: state.failures + 1,
  });
  chrome.alarms.create(LOGIN_TIMEOUT_ALARM, { delayInMinutes: AUTO_LOGIN_TIMEOUT_MINUTES });
  return true;
}

async function onAutoLoginTimeout() {
  const state = await getAutoLoginState();
  if (state.pendingTabId === null) return;

  const tabId = state.pendingTabId;
  await saveAutoLoginState({ ...state, pendingTabId: null, submitted: false });
  chrome.tabs.remove(tabId).catch(() => {});

  // The login may have gone through without us seeing the navigation event;
  // a refresh finds out and reports whatever the real state is.
  await refreshHomework();
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

async function reportSessionExpired(pending) {
  const error = pending ? 'logging_in' : 'session_expired';
  updateBadge('!', RED);
  await saveRefreshStatus(error);
  if (!pending) await notifyLoginRequired();
  return { success: false, error };
}

/**
 * The site could not be reached. That says nothing about the session, so
 * the badge and cache stay as they are and nobody is asked to log in.
 */
async function reportOffline() {
  await saveRefreshStatus('network');
  return { success: false, error: 'network' };
}

async function doRefresh({ manual = false } = {}) {
  try {
    const session = await ensureSession({ manual });
    if (!session.ok) {
      return session.offline ? await reportOffline() : await reportSessionExpired(session.pending);
    }

    // The probe just confirmed the session and cached a fresh CSRF token.
    const previous = await getHomeworkCache();
    const { homework, failedCourses } = await getAllHomework();

    // Courses that failed keep what we last knew about them.
    const merged = mergeWithPrevious(homework, previous?.homework, failedCourses.map(c => c.id));
    const failedNames = failedCourses.map(c => c.name);

    await saveHomeworkCache(merged, failedNames);
    await saveRefreshStatus(null);
    await markSessionOk();
    updateBadgeFromHomework(merged);
    await checkUrgentNotifications(merged);

    return { success: true, homework: merged, failedCourses: failedNames };
  } catch (e) {
    // Keep the previous cache: a failed refresh must not look like "no homework".
    if (e instanceof SessionExpiredError) {
      // The session ended between the probe and the fetch. The next refresh
      // (or the keep-alive) runs the recovery chain.
      console.warn('Session rejected by the API:', e.message);
      return await reportSessionExpired(false).catch(() => ({ success: false, error: 'session_expired' }));
    }
    if (e instanceof NetworkError) {
      console.warn('Network error during refresh:', e.message);
      return await reportOffline().catch(() => ({ success: false, error: 'network' }));
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
    await saveAutoLoginState({ ...state, pendingTabId: null, submitted: false });
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

  // ── Credentials: only the service worker can read or write them. ──
  // The three messages below are accepted from the extension's own pages
  // (the popup, also when opened in a tab) only — never from a content
  // script, whose sender.url is the web page it runs in.
  const fromExtensionPage = sender.id === chrome.runtime.id
    && !!sender.url?.startsWith(chrome.runtime.getURL(''));

  if (message.type === 'GET_CREDENTIAL_STATUS') {
    if (!fromExtensionPage) { sendResponse({ saved: false, username: '' }); return false; }
    getCredentialStatus().then(sendResponse, () => sendResponse({ saved: false, username: '' }));
    return true;
  }

  if (message.type === 'SAVE_CREDENTIALS') {
    if (!fromExtensionPage || !message.username || !message.password) {
      sendResponse({ ok: false });
      return false;
    }
    saveCredentials(message.username, message.password)
      // New credentials deserve a fresh set of auto-login attempts.
      .then(() => getAutoLoginState())
      .then(state => saveAutoLoginState({ ...state, failures: 0, lastAttemptAt: 0 }))
      .then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === 'CLEAR_CREDENTIALS') {
    if (!fromExtensionPage) { sendResponse({ ok: false }); return false; }
    clearCredentials().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // The two messages below come from content/autofill.js. The browser sets
  // sender.url, so a page cannot pretend to be the login page; only the top
  // frame of the real id.tsinghua.edu.cn login page is ever given credentials.
  const fromLoginPage = !!sender.tab && sender.frameId === 0
    && !!sender.url?.startsWith(LOGIN_PAGE_PREFIX);

  if (message.type === 'LOGIN_PAGE_READY') {
    if (!fromLoginPage) {
      sendResponse({ pending: false, autoSubmit: false, credentials: null });
      return false;
    }
    Promise.all([getAutoLoginState(), getCredentials().catch(() => null)]).then(async ([state, credentials]) => {
      const pending = state.pendingTabId === sender.tab.id;
      // Submit at most once per attempt, so an error page cannot cause a loop.
      const autoSubmit = pending && !state.submitted && !!credentials;
      if (autoSubmit) await saveAutoLoginState({ ...state, submitted: true });
      sendResponse({ pending, autoSubmit, credentials });
    });
    return true;
  }

  if (message.type === 'LOGIN_NEEDS_USER') {
    if (fromLoginPage) onLoginNeedsUser(sender.tab.id, message.reason);
    sendResponse({ ok: true });
    return false;
  }
});
