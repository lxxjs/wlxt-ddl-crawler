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
 */

const BASE_URL = 'https://learn.tsinghua.edu.cn';
const LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0';
const LOGIN_SUCCESS_PATH = '/f/wlxt/index/course/student';
const STUDENT_PAGE = `${BASE_URL}/f/wlxt/index/course/student/`;

// Cache CSRF token and student page HTML to avoid duplicate fetches
let cachedCsrf = null;
let cachedCsrfTime = 0;
let cachedStudentHtml = null;
const CSRF_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if the user has a valid session by trying to fetch the student page.
 * If the response redirects (to login) or fails, session is expired.
 * If successful, also extracts and caches the CSRF token from the page.
 */
async function isSessionValid() {
  try {
    const resp = await fetch(STUDENT_PAGE, {
      credentials: 'include',
      redirect: 'manual', // Don't follow redirects — a 302 means session expired
    });

    // 302 redirect = session expired (redirecting to login)
    if (resp.status === 302 || resp.type === 'opaqueredirect') {
      cachedCsrf = null;
      return false;
    }

    // 200 = logged in
    if (resp.ok) {
      const html = await resp.text();
      cachedStudentHtml = html;
      const csrf = extractCsrfFromHtml(html);
      if (csrf) {
        cachedCsrf = csrf;
        cachedCsrfTime = Date.now();
      }
      return true;
    }

    return false;
  } catch (e) {
    console.warn('isSessionValid fetch failed:', e);
    return false;
  }
}

/**
 * Extract _csrf token from HTML.
 * Spring Security typically includes: <meta name="_csrf" content="TOKEN">
 * or <input type="hidden" name="_csrf" value="TOKEN">
 */
function extractCsrfFromHtml(html) {
  // Try meta tag
  const metaMatch = html.match(/<meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']/i);
  if (metaMatch) return metaMatch[1];

  // Try hidden input
  const inputMatch = html.match(/<input[^>]*name=["']_csrf["'][^>]*value=["']([^"']+)["']/i);
  if (inputMatch) return inputMatch[1];

  // Try looking for it in a script variable or data attribute
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

export {
  BASE_URL,
  LOGIN_URL,
  LOGIN_SUCCESS_PATH,
  STUDENT_PAGE,
  isSessionValid,
  getCsrfToken,
  consumeCachedStudentHtml,
};
