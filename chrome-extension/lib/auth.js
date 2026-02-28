/**
 * Cookie reading and header construction for learn.tsinghua.edu.cn.
 * Ported from src/auth.py.
 */

const BASE_URL = 'https://learn.tsinghua.edu.cn';
const LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0';
const LOGIN_SUCCESS_PATH = '/f/wlxt/index/course/student';

/**
 * Get all cookies for learn.tsinghua.edu.cn.
 */
async function getSessionCookies() {
  const cookies = await chrome.cookies.getAll({ domain: 'learn.tsinghua.edu.cn' });
  const cookieMap = {};
  for (const c of cookies) {
    cookieMap[c.name] = c.value;
  }
  return cookieMap;
}

/**
 * Check if the user has a valid session (XSRF-TOKEN exists).
 */
async function isSessionValid() {
  const cookies = await getSessionCookies();
  return !!cookies['XSRF-TOKEN'];
}

/**
 * Build headers for API requests (ported from src/auth.py:122-136).
 */
async function buildHeaders() {
  const cookies = await getSessionCookies();
  const csrfToken = cookies['XSRF-TOKEN'] || '';

  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/f/wlxt/index/course/student/`,
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Token': csrfToken,
    'X-XSRF-TOKEN': csrfToken,
  };
}

export {
  BASE_URL,
  LOGIN_URL,
  LOGIN_SUCCESS_PATH,
  getSessionCookies,
  isSessionValid,
  buildHeaders,
};
