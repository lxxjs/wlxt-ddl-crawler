/**
 * API client for 网络学堂.
 * Semester:    GET  /b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester
 * Course list: GET  /b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/{semester}/zh
 * Homework:    POST /b/wlxt/kczy/zy/student/zyListWj with aoData format.
 *
 * Every request can fail, and a failure must never look like "no homework":
 * getAllHomework() reports which courses failed and throws when nothing
 * could be fetched at all.
 */

import {
  getCsrfToken, BASE_URL, STUDENT_PAGE, consumeCachedStudentHtml, SessionExpiredError,
} from './auth.js';
import { normalizeHomework, sortHomework } from './models.js';

const SEMESTER_API = `${BASE_URL}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;
const courseListApi = (semesterId) =>
  `${BASE_URL}/b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/${semesterId}/zh`;
const HOMEWORK_API = `${BASE_URL}/b/wlxt/kczy/zy/student/zyListWj`;

const CONCURRENCY = 3;

/**
 * Fetch a JSON endpoint with the session cookie and CSRF token.
 * Throws SessionExpiredError when the server treats us as logged out (HTTP
 * 403 or a bounce to a login page), and a plain Error on other HTTP errors
 * and non-JSON bodies.
 */
async function fetchJson(url, init = {}) {
  const csrf = await getCsrfToken();
  const sep = url.includes('?') ? '&' : '?';

  const resp = await fetch(`${url}${sep}_csrf=${encodeURIComponent(csrf)}`, {
    ...init,
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf,
      'X-XSRF-TOKEN': csrf,
      ...init.headers,
    },
  });

  if (resp.status === 403 || resp.url.includes('login')) {
    throw new SessionExpiredError(`Session rejected (HTTP ${resp.status}) by ${url}`);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);

  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}`);
  }
}

/**
 * POST to a DataTable-style API endpoint.
 * Sends aoData as a JSON array (matches the wlxt DataTable plugin format).
 */
function dtPost(url, extraParams = []) {
  const aoData = [
    { name: 'sEcho',          value: '1' },
    { name: 'iColumns',       value: '5' },
    { name: 'sColumns',       value: '' },
    { name: 'iDisplayStart',  value: '0' },
    { name: 'iDisplayLength', value: '-1' },
    { name: 'sSearch',        value: '' },
    { name: 'bRegex',         value: 'false' },
    { name: 'iSortCol_0',     value: '0' },
    { name: 'sSortDir_0',     value: 'asc' },
    { name: 'iSortingCols',   value: '1' },
    ...extraParams,
  ];

  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `aoData=${encodeURIComponent(JSON.stringify(aoData))}`,
  });
}

/**
 * Read the current semester id (e.g. "2026-2027-1") from the semester API.
 * Throws when the response is not the expected shape.
 * Exported for testing.
 */
export function parseSemesterResponse(data) {
  const id = data?.result?.id || data?.result?.xnxq;
  if (typeof id !== 'string' || !id) {
    throw new Error('Unexpected semester response');
  }
  return id;
}

/**
 * Turn the course list API response into [{ id, name, teacher }].
 * Throws when the response is not the expected shape, so a broken response
 * is never mistaken for "enrolled in zero courses".
 * Exported for testing.
 */
export function parseCourseListResponse(data) {
  if (!Array.isArray(data?.resultList)) {
    throw new Error('Unexpected course list response');
  }
  return data.resultList
    .filter(c => c?.wlkcid)
    .map(c => ({
      id: c.wlkcid,
      name: c.kcm || c.zywkcm || c.ywkcm || 'Unknown Course',
      teacher: c.jsm || '',
    }));
}

/**
 * Parse course IDs, names, and teachers from the student page HTML.
 * Only used as a fallback when the JSON course API fails: the live page
 * fills its course list with JavaScript, so this often finds nothing.
 * Exported for testing.
 */
export function parseCoursesFromHtml(html) {
  const courses = [];
  const titleRegex = /<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/;
  const teacherRegex = /<span[^>]*class="[^"]*teacherName[^"]*"[^>]*>([\s\S]*?)<\/span>/;

  // Try multiple patterns for the wlkcid field — attribute order varies across
  // wlxt versions: class before value, value before class, or name attribute.
  const wlkcidPatterns = [
    /<input[^>]*class="[^"]*wlkcid[^"]*"[^>]*value="([^"]+)"[^>]*>/g,   // class then value
    /<input[^>]*value="([^"]+)"[^>]*class="[^"]*wlkcid[^"]*"[^>]*>/g,   // value then class
    /<input[^>]*name="wlkcid"[^>]*value="([^"]+)"[^>]*>/g,               // name then value
    /<input[^>]*value="([^"]+)"[^>]*name="wlkcid"[^>]*>/g,               // value then name
  ];

  let allWlkcids = [];
  for (const pattern of wlkcidPatterns) {
    allWlkcids = [...html.matchAll(pattern)];
    if (allWlkcids.length) break;
  }

  for (const match of allWlkcids) {
    const wlkcid = match[1];
    const after = html.substring(match.index, match.index + 2000);
    const titleMatch = after.match(titleRegex);
    const teacherMatch = after.match(teacherRegex);

    const name = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : 'Unknown Course';
    const teacher = teacherMatch ? teacherMatch[1].replace(/<[^>]*>/g, '').trim() : '';

    if (wlkcid) {
      courses.push({ id: wlkcid, name, teacher });
    }
  }
  return courses;
}

/**
 * Get the current semester's courses from the JSON API.
 * Falls back to scraping the student page only if the API fails and the
 * scrape actually finds courses; otherwise the API error is rethrown.
 */
async function getCourses() {
  try {
    const semesterId = parseSemesterResponse(await fetchJson(SEMESTER_API));
    return parseCourseListResponse(await fetchJson(courseListApi(semesterId)));
  } catch (apiError) {
    if (apiError instanceof SessionExpiredError) throw apiError;
    console.warn('[api] course API failed, trying student page HTML:', apiError);

    let html = consumeCachedStudentHtml();
    if (!html) {
      const resp = await fetch(STUDENT_PAGE, { credentials: 'include' }).catch(() => null);
      html = resp?.ok ? await resp.text() : '';
    }

    const courses = parseCoursesFromHtml(html);
    if (!courses.length) throw apiError;
    return courses;
  }
}

/**
 * Parse homework rows from an API response.
 * Handles both { object: { aaData: [...] } } and { aaData: [...] } shapes.
 * Exported for testing.
 */
export function parseHomeworkResponse(data) {
  return data?.object?.aaData ?? data?.aaData ?? [];
}

/**
 * Like parseHomeworkResponse, but throws when the response is not a homework
 * list at all (error payload, missing aaData) instead of returning [].
 * Exported for testing.
 */
export function requireHomeworkRows(data) {
  if (data?.result && data.result !== 'success') {
    throw new Error(`Homework API returned result=${data.result}`);
  }
  const rows = data?.object?.aaData ?? data?.aaData;
  if (!Array.isArray(rows)) throw new Error('Unexpected homework response');
  return rows;
}

/**
 * Get unsubmitted homework for a single course.
 */
async function getCourseHomework(course) {
  const data = await dtPost(HOMEWORK_API, [
    { name: 'wlkcid', value: course.id },
  ]);

  return requireHomeworkRows(data).map(item => normalizeHomework(item, course.name, course.id));
}

/**
 * Fetch all homework across all courses with a concurrency limit.
 *
 * Returns { homework, courseCount, failedCourses: [{ id, name, error }] }.
 * Throws if the course list cannot be loaded or if every course failed.
 */
async function getAllHomework() {
  const courses = await getCourses();

  const homework = [];
  const failedCourses = [];

  for (let i = 0; i < courses.length; i += CONCURRENCY) {
    const batch = courses.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c => getCourseHomework(c)));

    results.forEach((result, idx) => {
      const course = batch[idx];
      if (result.status === 'fulfilled') {
        homework.push(...result.value);
      } else {
        console.warn(`[api] homework fetch failed for ${course.name}:`, result.reason);
        failedCourses.push({
          id: course.id,
          name: course.name,
          error: result.reason?.message || String(result.reason),
          sessionExpired: result.reason instanceof SessionExpiredError,
        });
      }
    });
  }

  if (courses.length && failedCourses.length === courses.length) {
    const message = `All ${courses.length} course requests failed: ${failedCourses[0].error}`;
    throw failedCourses.every(c => c.sessionExpired)
      ? new SessionExpiredError(message)
      : new Error(message);
  }

  return {
    homework: sortHomework(homework),
    courseCount: courses.length,
    failedCourses,
  };
}

export { getAllHomework };
