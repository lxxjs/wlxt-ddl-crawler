/**
 * End-to-end tests for the service worker against a fake 网络学堂.
 * Run with: node chrome-extension/tests/test-flow.mjs
 *
 * `chrome.*` and `fetch` are replaced with in-memory fakes, then the real
 * background/service-worker.js is imported and driven through its listeners.
 * The fake server follows the request/response shapes thu-learn-lib relies
 * on; it is NOT a recording of the live site.
 */

import assert from 'node:assert/strict';

const LEARN = 'https://learn.tsinghua.edu.cn';
const ID = 'https://id.tsinghua.edu.cn';
const STUDENT_PAGE = `${LEARN}/f/wlxt/index/course/student/`;
const LOGIN_URL = `${ID}/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0`;

const HOUR = 3600 * 1000;

// ─── Fake server ─────────────────────────────────────────────────────────────

const world = {
  loggedIn: true,
  ssoRemembered: false,
  courseApiBroken: false,
  loggedOutPageIs200: false, // logged-out student page answers 200 without a token
  apiRejections: 0,          // number of upcoming API calls to answer with 403
  failingCourses: new Set(),
  courses: [
    { wlkcid: 'c1', kcm: '高等数学', jsm: '张伟' },
    { wlkcid: 'c2', kcm: '线性代数', jsm: '李明' },
  ],
  homework: {
    c1: [{ xszyid: 'hw-urgent', zyid: 'z1', bt: '第一次作业', jzsj: Date.now() + 5 * HOUR }],
    c2: [{ xszyid: 'hw-later', zyid: 'z2', bt: '第二次作业', jzsj: Date.now() + 5 * 24 * HOUR }],
  },
  requests: [],
};

const respond = (url, body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

const loginPage = () =>
  respond(LOGIN_URL, world.ssoRemembered
    ? '<form action="/do/off/ui/auth/login/checkSingle"><input id="fingerPrint"></form>'
    : '<form id="theform"><input id="i_user"><input id="i_pass"></form>');

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const path = url.split('?')[0];
  world.requests.push(`${init.method || 'GET'} ${path}`);

  if (path === STUDENT_PAGE) {
    if (world.loggedIn) return respond(STUDENT_PAGE, '<a href="/f/wlxt/x?a=1&_csrf=TOKEN-1">课程</a>');
    return world.loggedOutPageIs200 ? respond(STUDENT_PAGE, '<html>请登录</html>') : loginPage();
  }
  if (path === LOGIN_URL) return loginPage();

  if (path === `${ID}/do/off/ui/auth/login/checkSingle`) {
    assert.equal(init.method, 'POST');
    assert.equal(init.body.get('fingerPrint'), 'FP-1');
    return respond(url, `<a href="${LEARN}/f/login.do?status=SUCCESS&ticket=TICKET-1">continue</a>`);
  }
  if (path === `${LEARN}/b/j_spring_security_thauth_roaming_entry`) {
    assert.ok(url.endsWith('ticket=TICKET-1'));
    world.loggedIn = true;
    return respond(STUDENT_PAGE, 'ok');
  }

  // Everything below is the JSON API. Logged-out users get a 403 or the login page.
  if (world.apiRejections > 0) {
    world.apiRejections -= 1;
    return respond(url, 'Forbidden', 403);
  }
  if (!world.loggedIn) {
    return world.loggedOutPageIs200
      ? respond(url, 'Forbidden', 403)
      : respond(`${LEARN}/f/login?login_timeout=1`, '<html>login</html>');
  }
  assert.ok(url.includes('_csrf=TOKEN-1'), `CSRF token missing on ${url}`);

  if (path.endsWith('/getCurrentAndNextSemester')) {
    return respond(url, { message: 'success', result: { id: '2026-2027-1' } });
  }
  if (path.includes('/loadCourseBySemesterId/2026-2027-1/')) {
    return world.courseApiBroken
      ? respond(url, '<html>maintenance</html>')
      : respond(url, { message: 'success', resultList: world.courses });
  }
  if (path.endsWith('/zyListWj')) {
    const aoData = JSON.parse(new URLSearchParams(init.body).get('aoData'));
    const courseId = aoData.find(p => p.name === 'wlkcid').value;
    if (world.failingCourses.has(courseId)) return respond(url, 'boom', 500);
    return respond(url, { result: 'success', object: { aaData: world.homework[courseId] ?? [] } });
  }
  throw new Error(`fake server: unexpected request ${url}`);
};

// ─── Fake chrome ─────────────────────────────────────────────────────────────

const store = {};
const listeners = {};
const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
const seen = { badge: null, notifications: [], createdTabs: [], removedTabs: [], alarms: {} };
const openTabs = new Set();
let nextTabId = 100;

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
      set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    },
  },
  cookies: { getAll: async () => [] },
  alarms: {
    create: (name, opts) => { seen.alarms[name] = opts; },
    clear: (name, cb) => { delete seen.alarms[name]; cb?.(); },
    onAlarm: event('alarm'),
  },
  runtime: {
    onInstalled: event('installed'),
    onStartup: event('startup'),
    onMessage: event('message'),
    sendMessage: async () => {},
    getURL: (p) => `chrome-extension://test/${p}`,
  },
  action: {
    setBadgeText: ({ text }) => { seen.badge = text; },
    setBadgeBackgroundColor: () => {},
  },
  notifications: {
    create: (id, opts) => { seen.notifications.push({ id, ...opts }); },
    clear: () => {},
    onClicked: event('notificationClicked'),
  },
  tabs: {
    create: async ({ url, active }) => {
      const tab = { id: nextTabId++, url, active, windowId: 1 };
      openTabs.add(tab.id);
      seen.createdTabs.push(tab);
      return tab;
    },
    get: async (id) => {
      if (!openTabs.has(id)) throw new Error('No tab');
      return { id, windowId: 1 };
    },
    remove: async (id) => { openTabs.delete(id); seen.removedTabs.push(id); },
    update: async (id) => ({ id, windowId: 1 }),
  },
  windows: { update: async () => {} },
  webNavigation: { onCompleted: event('navigation') },
};

await import('../background/service-worker.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const send = (message, sender = {}) =>
  new Promise((resolve) => listeners.message(message, sender, resolve));
const refresh = () => send({ type: 'REFRESH' });
const loginTab = (id) => ({ tab: { id }, url: LOGIN_URL });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const urgentNotifications = () => seen.notifications.filter(n => n.id.startsWith('urgent-'));
const loginNotifications = () => seen.notifications.filter(n => n.id === 'login-required');

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

// ─── Fetching ────────────────────────────────────────────────────────────────

console.log('\nfetching');

await test('refresh loads courses from the JSON API and epoch-ms deadlines', async () => {
  const result = await refresh();
  assert.equal(result.success, true);
  assert.deepEqual(result.homework.map(h => h.id), ['hw-urgent', 'hw-later']);
  assert.deepEqual(result.homework.map(h => h.urgency), [1, 3]);
  assert.deepEqual(result.failedCourses, []);
  assert.equal(seen.badge, '1');
  assert.equal(store.homeworkCache.homework.length, 2);
});

await test('urgent homework is notified once, not on every refresh', async () => {
  assert.equal(urgentNotifications().length, 1);
  await refresh();
  await refresh();
  assert.equal(urgentNotifications().length, 1);
});

await test('one failing course keeps its last known homework, marked stale', async () => {
  world.failingCourses.add('c1');
  const result = await refresh();
  assert.equal(result.success, true);
  assert.deepEqual(result.failedCourses, ['高等数学']);
  assert.deepEqual(result.homework.map(h => h.id), ['hw-urgent', 'hw-later']);
  assert.equal(result.homework[0].stale, true);
  assert.equal(seen.badge, '1');
  assert.equal(urgentNotifications().length, 1); // still no repeat
  world.failingCourses.clear();
});

await test('broken course API is an error and leaves the cache untouched', async () => {
  world.courseApiBroken = true;
  const before = structuredClone(store.homeworkCache);
  const result = await refresh();
  assert.equal(result.success, false);
  assert.match(result.error, /Non-JSON/);
  assert.deepEqual(store.homeworkCache, before);
  assert.equal(seen.badge, '!');

  const popup = await send({ type: 'GET_HOMEWORK' });
  assert.equal(popup.homework.length, 2); // old data still shown…
  assert.match(popup.lastError, /Non-JSON/); // …with the error attached
  world.courseApiBroken = false;
});

await test('every course failing is an error, not "no homework"', async () => {
  world.failingCourses = new Set(['c1', 'c2']);
  const result = await refresh();
  assert.equal(result.success, false);
  assert.equal(store.homeworkCache.homework.length, 2);
  world.failingCourses.clear();
});

await test('a real empty list is still reported as empty', async () => {
  const saved = world.homework;
  world.homework = {};
  const result = await refresh();
  assert.equal(result.success, true);
  assert.deepEqual(result.homework, []);
  assert.equal(seen.badge, '');
  world.homework = saved;
  await refresh();
});

// ─── Session recovery ────────────────────────────────────────────────────────

console.log('\nsession recovery');

await test('expired session, nothing saved → asks the user once, keeps cache', async () => {
  world.loggedIn = false;
  const result = await refresh();
  assert.equal(result.error, 'session_expired');
  assert.equal(seen.badge, '!');
  assert.equal(store.homeworkCache.homework.length, 2);
  assert.equal(loginNotifications().length, 1);

  await refresh();
  await listeners.alarm({ name: 'keepSessionAlive' });
  assert.equal(loginNotifications().length, 1); // not repeated
  assert.equal(seen.createdTabs.length, 0);     // no credentials → no tab
});

await test('remembered SSO + stored fingerprint → restored silently, no tab', async () => {
  world.ssoRemembered = true;
  store.fingerprint = { fingerPrint: 'FP-1', fingerGenPrint: 'G-1', fingerGenPrint3: '' };

  await listeners.alarm({ name: 'keepSessionAlive' });
  assert.equal(world.loggedIn, true);
  assert.equal(seen.createdTabs.length, 0);
  assert.equal(seen.badge, '1');
  assert.equal(store.refreshStatus.lastError, null);
  assert.equal(store.sessionState.loginNotified, false);
});

await test('remembered SSO but no fingerprint yet → not restored', async () => {
  world.loggedIn = false;
  delete store.fingerprint;
  const result = await refresh();
  assert.equal(result.error, 'session_expired');
  assert.equal(world.loggedIn, false);
});

await test('saved credentials → background tab login, submitted exactly once', async () => {
  world.ssoRemembered = false;
  store.credentials = { username: 'u', password: 'p' };

  const result = await refresh();
  assert.equal(result.error, 'logging_in');
  assert.equal(seen.createdTabs.length, 1);
  const tab = seen.createdTabs[0];
  assert.equal(tab.url, LOGIN_URL);
  assert.equal(tab.active, false);
  assert.ok(seen.alarms.autoLoginTimeout);

  // A login page the user opened themselves is never auto-submitted.
  assert.deepEqual(await send({ type: 'LOGIN_PAGE_READY' }, loginTab(999)),
    { pending: false, autoSubmit: false });
  // Messages that do not come from id.tsinghua.edu.cn are ignored.
  assert.deepEqual(await send({ type: 'LOGIN_PAGE_READY' }, { tab: { id: tab.id }, url: 'https://evil.example/' }),
    { pending: false, autoSubmit: false });

  assert.deepEqual(await send({ type: 'LOGIN_PAGE_READY' }, loginTab(tab.id)),
    { pending: true, autoSubmit: true });
  assert.deepEqual(await send({ type: 'LOGIN_PAGE_READY' }, loginTab(tab.id)),
    { pending: true, autoSubmit: false });

  // A second refresh while the tab is open must not open another one.
  await refresh();
  assert.equal(seen.createdTabs.length, 1);
});

await test('login completing in that tab refreshes and closes it', async () => {
  const tab = seen.createdTabs[0];
  world.loggedIn = true;
  await listeners.navigation({ frameId: 0, tabId: tab.id, url: STUDENT_PAGE });
  await sleep(2200);

  assert.deepEqual(seen.removedTabs, [tab.id]);
  assert.equal(store.autoLoginState.pendingTabId, null);
  assert.equal(store.autoLoginState.failures, 0);
  assert.equal(seen.badge, '1');
  assert.equal(seen.alarms.autoLoginTimeout, undefined);
});

await test('2FA in the background tab → tab kept, user notified, no retries', async () => {
  world.loggedIn = false;
  store.autoLoginState.lastAttemptAt = 0; // skip the 10-minute gap
  await refresh();
  assert.equal(seen.createdTabs.length, 2);
  const tab = seen.createdTabs[1];
  const before = loginNotifications().length;

  await send({ type: 'LOGIN_NEEDS_USER', reason: 'two_factor' }, loginTab(tab.id));
  await sleep(50);

  assert.equal(openTabs.has(tab.id), true);
  assert.equal(loginNotifications().length, before + 1);
  assert.match(loginNotifications().at(-1).message, /二次认证/);
  assert.equal(store.sessionState.attentionTabId, tab.id);

  store.autoLoginState.lastAttemptAt = 0;
  const result = await send({ type: 'REFRESH' });
  assert.equal(result.error, 'session_expired');
  assert.equal(seen.createdTabs.length, 2); // no further automatic attempts
});

await test('user finishing the login by hand re-enables auto login', async () => {
  world.loggedIn = true;
  const result = await refresh();
  assert.equal(result.success, true);
  assert.equal(store.autoLoginState.failures, 0);
});

await test('timed-out tab login is closed and counted as a failure', async () => {
  world.loggedIn = false;
  store.autoLoginState.lastAttemptAt = 0;
  await refresh();
  const tab = seen.createdTabs.at(-1);

  await listeners.alarm({ name: 'autoLoginTimeout' });
  assert.equal(openTabs.has(tab.id), false);
  assert.equal(store.autoLoginState.failures, 1);
  assert.equal(store.autoLoginState.pendingTabId, null);

  // Within the 10-minute gap the alarm-driven refresh does not try again.
  const count = seen.createdTabs.length;
  await listeners.alarm({ name: 'refreshHomework' });
  assert.equal(seen.createdTabs.length, count);
});

await test('auto login switched off → no tab even with credentials', async () => {
  store.settings = { refreshInterval: 30, notifications: true, autoLogin: false };
  store.autoLoginState = { pendingTabId: null, submitted: false, lastAttemptAt: 0, failures: 0 };
  const count = seen.createdTabs.length;
  const result = await refresh();
  assert.equal(result.error, 'session_expired');
  assert.equal(seen.createdTabs.length, count);
});

// ─── Logged-out detection (found on the live site) ───────────────────────────

console.log('\nlogged-out detection');

await test('student page answering 200 without a token is NOT a session', async () => {
  world.loggedIn = false;
  world.loggedOutPageIs200 = true;
  const mark = world.requests.length;

  const result = await refresh();
  assert.equal(result.error, 'session_expired'); // not "HTTP 403 from …"
  assert.equal(world.requests.slice(mark).some(r => r.includes('/b/')), false,
    'no API call may be made without a token');
  assert.equal(store.homeworkCache.homework.length, 2);
  world.loggedOutPageIs200 = false;
});

await test('API answering 403 once is retried with a fresh token', async () => {
  world.loggedIn = true;
  world.apiRejections = 1;
  const result = await refresh();
  assert.equal(result.success, true);
  assert.equal(result.homework.length, 2);
});

await test('API answering 403 persistently → ask the user, no login-tab loop', async () => {
  store.settings = { refreshInterval: 30, notifications: true, autoLogin: true };
  store.autoLoginState = { pendingTabId: null, submitted: false, lastAttemptAt: 0, failures: 0 };
  world.apiRejections = Infinity;
  const tabs = seen.createdTabs.length;

  const result = await refresh();
  assert.equal(result.error, 'session_expired');
  assert.equal(seen.createdTabs.length, tabs);
  assert.equal(store.homeworkCache.homework.length, 2);
  assert.equal(seen.badge, '!');
  world.apiRejections = 0;
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
