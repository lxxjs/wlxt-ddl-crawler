/**
 * Authentication for learn.tsinghua.edu.cn.
 *
 * Key insight: In Manifest V3, fetch() from the service worker with
 * credentials:'include' automatically sends cookies when we have host_permissions.
 * No `cookies` permission is needed to make authenticated requests.
 *
 * The CSRF token comes from the `_csrf=` links in the student page. On the
 * live site that is the only place it appears (no XSRF-TOKEN cookie, no meta
 * tag), so the extension does not need the `cookies` permission at all.
 *
 * Whether we are logged in is decided by probeSession(): the student page
 * must yield a token AND a real API call with that token must be accepted.
 * The page alone is not proof — after logging out it can still look fine
 * while every API call is refused.
 *
 * When the 网络学堂 session has expired we try to restore it without the user:
 * id.tsinghua.edu.cn keeps its own longer-lived "remembered" login, and its
 * login page then offers a password-less `checkSingle` step. That step only
 * needs the device fingerprint, which content/autofill.js records the first
 * time the user logs in by hand. The flow mirrors thu-learn-lib's login().
 */

const BASE_URL = 'https://learn.tsinghua.edu.cn';
const ID_URL = 'https://id.tsinghua.edu.cn';
const LOGIN_URL = `${ID_URL}/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0`;
const LOGIN_CHECK_SINGLE_URL = `${ID_URL}/do/off/ui/auth/login/checkSingle`;
const LOGIN_SUCCESS_PATH = '/f/wlxt/index/course/student';
const STUDENT_PAGE = `${BASE_URL}/f/wlxt/index/course/student/`;
const SEMESTER_API = `${BASE_URL}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;
const roamUrl = (ticket) => `${BASE_URL}/b/j_spring_security_thauth_roaming_entry?ticket=${ticket}`;

const FINGERPRINT_KEY = 'fingerprint'; // { fingerPrint, fingerGenPrint, fingerGenPrint3 }

// Cache CSRF token and student page HTML to avoid duplicate fetches
let cachedCsrf = null;
let cachedCsrfTime = 0;
let cachedStudentHtml = null;
const CSRF_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * True when a response URL is the logged-in student landing page rather than
 * a login / login_timeout page we were bounced to.
 * Exported for testing.
 */
function isStudentPageUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === BASE_URL
      && u.pathname.startsWith(LOGIN_SUCCESS_PATH)
      && !u.href.includes('login_timeout');
  } catch {
    return false;
  }
}

/**
 * Thrown when 网络学堂 answers like we are not logged in (HTTP 403, a bounce
 * to a login page, or no CSRF token to send).
 */
class SessionExpiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * Forget the cached token and page, e.g. after the API rejected the token.
 */
function resetSessionCache() {
  cachedCsrf = null;
  cachedCsrfTime = 0;
  cachedStudentHtml = null;
}

/**
 * Thrown when a request never got an HTTP answer (offline, DNS, timeout).
 */
class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Never answer from the HTTP cache, and do not follow redirects blindly: on
// this site a redirect means "go and log in", and following it can fail in a
// way that is indistinguishable from being offline.
const FETCH_DEFAULTS = { credentials: 'include', cache: 'no-store' };

/**
 * fetch() that reports what kind of answer came back.
 *
 * Returns { kind: 'response', resp } for a direct answer,
 *         { kind: 'redirect' }       when the server redirected us,
 *         { kind: 'unreachable' }    when there was no answer at all.
 */
async function fetchNoFollow(url, init = {}) {
  try {
    const resp = await fetch(url, { ...FETCH_DEFAULTS, ...init, redirect: 'manual' });
    if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
      return { kind: 'redirect' };
    }
    return { kind: 'response', resp };
  } catch (e) {
    return { kind: 'unreachable', error: e };
  }
}

/**
 * Load the student page and cache its CSRF token.
 * Returns 'ok' | 'expired' | 'unreachable'.
 */
async function loadStudentPage() {
  let result = await fetchNoFollow(STUDENT_PAGE);
  if (result.kind === 'unreachable') return 'unreachable';

  if (result.kind === 'redirect') {
    // Normally a bounce to the login page. Follow it once in case the
    // logged-in page is itself reached through a redirect.
    try {
      const resp = await fetch(STUDENT_PAGE, FETCH_DEFAULTS);
      result = { kind: 'response', resp };
    } catch {
      resetSessionCache();
      return 'expired';
    }
  }

  const { resp } = result;
  if (resp.status >= 500) return 'unreachable'; // server trouble, not a logout
  if (!resp.ok || !isStudentPageUrl(resp.url)) {
    resetSessionCache();
    return 'expired';
  }

  const html = await resp.text();
  const csrf = extractCsrfFromHtml(html);
  if (!csrf) {
    resetSessionCache();
    return 'expired';
  }

  cachedStudentHtml = html;
  cachedCsrf = csrf;
  cachedCsrfTime = Date.now();
  return 'ok';
}

/**
 * Find out whether we are logged in.
 * Returns 'valid' | 'expired' | 'unreachable'.
 *
 * 'unreachable' means the site could not be reached at all (offline, server
 * down) — nothing is known about the session, so nobody should be asked to
 * log in because of it.
 */
async function probeSession() {
  const page = await loadStudentPage();
  if (page !== 'ok') return page;

  // The page looked logged in; make sure the API agrees.
  const ping = await fetchNoFollow(`${SEMESTER_API}?_csrf=${encodeURIComponent(cachedCsrf)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  let accepted = false;
  if (ping.kind === 'response') {
    if (ping.resp.status >= 500) return 'unreachable';
    if (ping.resp.ok) {
      const data = await ping.resp.json().catch(() => null);
      accepted = !!data?.result;
    }
  }
  // A redirect, a 403, a non-JSON body, or no answer while the page itself
  // was reachable all mean the API does not consider us logged in.
  if (!accepted) {
    resetSessionCache();
    return 'expired';
  }
  return 'valid';
}

/**
 * Extract _csrf token from HTML.
 * Exported for testing.
 */
function extractCsrfFromHtml(html) {
  // Links on the student page carry it as a query parameter (what thu-learn-lib reads)
  const queryMatch = html.match(/[?&]_csrf=([^"'&\s<>]+)/);
  if (queryMatch) return queryMatch[1];

  // Spring Security meta tag
  const metaMatch = html.match(/<meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']/i);
  if (metaMatch) return metaMatch[1];

  // Hidden input
  const inputMatch = html.match(/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/i);
  if (inputMatch) return inputMatch[1];

  // Script variable or data attribute
  const varMatch = html.match(/["']_csrf["']\s*:\s*["']([^"']+)["']/);
  if (varMatch) return varMatch[1];

  return null;
}

/**
 * Get the CSRF token. Never returns an empty token: a request without one
 * is rejected with 403, so we fail early with SessionExpiredError instead.
 */
async function getCsrfToken() {
  // 1. Return cached if fresh
  if (cachedCsrf && (Date.now() - cachedCsrfTime) < CSRF_CACHE_TTL) {
    return cachedCsrf;
  }

  // 2. Read it from the student page (the source that works on the live site)
  const page = await loadStudentPage();
  if (page === 'ok') return cachedCsrf;
  if (page === 'unreachable') throw new NetworkError('Cannot reach 网络学堂');

  throw new SessionExpiredError('No CSRF token available (not logged in)');
}

/**
 * Consume the student page HTML cached by loadStudentPage().
 * Returns the HTML once, then clears the cache so it isn't stale.
 */
function consumeCachedStudentHtml() {
  const html = cachedStudentHtml;
  cachedStudentHtml = null;
  return html;
}

/**
 * Pull the roaming ticket out of the page id.tsinghua.edu.cn returns after a
 * successful login check. The page contains a link back to 网络学堂 whose
 * last query value is the ticket.
 * Exported for testing.
 */
function extractTicketFromHtml(html) {
  const withTicket = html.match(/<a[^>]*href=["']([^"']*ticket=[^"']+)["']/i);
  const anyLink = withTicket || html.match(/<a[^>]*href=["']([^"']+)["']/i);
  if (!anyLink) return null;

  const href = anyLink[1].replace(/&amp;/g, '&');
  const ticket = href.split('=').slice(-1)[0];
  return ticket && ticket !== href ? ticket : null;
}

/**
 * Try to restore the 网络学堂 session without any user interaction.
 *
 * Returns { ok, reason }. `ok` only means the roaming request went through;
 * callers should re-run probeSession() to confirm.
 *
 * reason: 'redirected' | 'restored' | 'password_required' | 'no_fingerprint'
 *       | 'two_factor' | 'no_ticket' | 'roam_failed' | 'error'
 */
async function trySilentLogin() {
  try {
    const formResp = await fetch(LOGIN_URL, FETCH_DEFAULTS);
    const formHtml = await formResp.text();

    // SSO sent us straight back to 网络学堂 — nothing more to do.
    if (formResp.url.startsWith(BASE_URL)) return { ok: true, reason: 'redirected' };

    // No remembered login on id.tsinghua.edu.cn: a password is required.
    if (!formHtml.includes('checkSingle')) return { ok: false, reason: 'password_required' };

    const stored = await chrome.storage.local.get(FINGERPRINT_KEY).catch(() => ({}));
    const fp = stored[FINGERPRINT_KEY];
    if (!fp?.fingerPrint) return { ok: false, reason: 'no_fingerprint' };

    const form = new FormData();
    form.append('i_rememberme', 'on');
    form.append('fingerPrint', fp.fingerPrint);
    form.append('fingerGenPrint', fp.fingerGenPrint ?? '');

    const checkResp = await fetch(LOGIN_CHECK_SINGLE_URL, {
      ...FETCH_DEFAULTS,
      method: 'POST',
      body: form,
    });
    const checkHtml = await checkResp.text();

    if (checkHtml.includes('二次认证')) return { ok: false, reason: 'two_factor' };

    const ticket = extractTicketFromHtml(checkHtml);
    if (!ticket) return { ok: false, reason: 'no_ticket' };

    const roamResp = await fetch(roamUrl(ticket), FETCH_DEFAULTS);
    if (!roamResp.ok) return { ok: false, reason: 'roam_failed' };

    resetSessionCache(); // the new session has a new token
    return { ok: true, reason: 'restored' };
  } catch (e) {
    console.warn('Silent login failed:', e);
    return { ok: false, reason: 'error' };
  }
}

export {
  BASE_URL,
  LOGIN_URL,
  LOGIN_SUCCESS_PATH,
  STUDENT_PAGE,
  SEMESTER_API,
  SessionExpiredError,
  NetworkError,
  resetSessionCache,
  fetchNoFollow,
  probeSession,
  isStudentPageUrl,
  extractCsrfFromHtml,
  extractTicketFromHtml,
  getCsrfToken,
  consumeCachedStudentHtml,
  trySilentLogin,
};
