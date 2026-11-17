/**
 * Authentication for learn.tsinghua.edu.cn.
 *
 * Key insight: In Manifest V3, fetch() from the service worker with
 * credentials:'include' automatically sends cookies when we have host_permissions.
 * We do NOT need chrome.cookies.getAll to make authenticated requests.
 *
 * For the CSRF token (needed in headers), we:
 * 1. Try chrome.cookies.getAll (may work)
 * 2. Try reading from a content script via chrome.storage.local
 * 3. Fetch the student page and parse _csrf from the HTML (most reliable fallback)
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
 * Check if the user has a valid session by fetching the student page.
 * A logged-out session gets redirected away (to login), so we follow the
 * redirect and look at where we ended up.
 * If successful, also extracts and caches the CSRF token from the page.
 */
async function isSessionValid() {
  try {
    const resp = await fetch(STUDENT_PAGE, { credentials: 'include' });

    if (!resp.ok || !isStudentPageUrl(resp.url)) {
      cachedCsrf = null;
      cachedStudentHtml = null;
      return false;
    }

    const html = await resp.text();
    cachedStudentHtml = html;
    const csrf = extractCsrfFromHtml(html);
    if (csrf) {
      cachedCsrf = csrf;
      cachedCsrfTime = Date.now();
    }
    return true;
  } catch (e) {
    console.warn('isSessionValid fetch failed:', e);
    return false;
  }
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
 * Get CSRF token using multiple strategies.
 */
async function getCsrfToken() {
  // 1. Return cached if fresh
  if (cachedCsrf && (Date.now() - cachedCsrfTime) < CSRF_CACHE_TTL) {
    return cachedCsrf;
  }

  // 2. Try chrome.cookies and chrome.storage in parallel
  const [cookieResult, storageResult] = await Promise.all([
    chrome.cookies.getAll({ url: 'https://learn.tsinghua.edu.cn/' }).catch(() => []),
    chrome.storage.local.get('xsrfToken').catch(() => ({})),
  ]);

  const xsrf = cookieResult.find(c => c.name === 'XSRF-TOKEN');
  if (xsrf) {
    cachedCsrf = xsrf.value;
    cachedCsrfTime = Date.now();
    return cachedCsrf;
  }

  if (storageResult.xsrfToken) {
    cachedCsrf = storageResult.xsrfToken;
    cachedCsrfTime = Date.now();
    return cachedCsrf;
  }

  // 3. Fetch student page to extract _csrf (fallback for edge cases)
  try {
    const resp = await fetch(STUDENT_PAGE, { credentials: 'include' });
    if (resp.ok) {
      const html = await resp.text();
      const csrf = extractCsrfFromHtml(html);
      if (csrf) {
        cachedCsrf = csrf;
        cachedCsrfTime = Date.now();
        return cachedCsrf;
      }
    }
  } catch (e) {
    console.warn('CSRF fetch failed:', e);
  }

  return '';
}

/**
 * Consume the student page HTML cached by isSessionValid().
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
 * callers should re-run isSessionValid() to confirm.
 *
 * reason: 'redirected' | 'restored' | 'password_required' | 'no_fingerprint'
 *       | 'two_factor' | 'no_ticket' | 'roam_failed' | 'error'
 */
async function trySilentLogin() {
  try {
    const formResp = await fetch(LOGIN_URL, { credentials: 'include' });
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
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const checkHtml = await checkResp.text();

    if (checkHtml.includes('二次认证')) return { ok: false, reason: 'two_factor' };

    const ticket = extractTicketFromHtml(checkHtml);
    if (!ticket) return { ok: false, reason: 'no_ticket' };

    const roamResp = await fetch(roamUrl(ticket), { credentials: 'include' });
    if (!roamResp.ok) return { ok: false, reason: 'roam_failed' };

    cachedCsrf = null; // the new session has a new token
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
  isSessionValid,
  isStudentPageUrl,
  extractCsrfFromHtml,
  extractTicketFromHtml,
  getCsrfToken,
  consumeCachedStudentHtml,
  trySilentLogin,
};
