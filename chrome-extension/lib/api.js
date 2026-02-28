/**
 * API client for 网络学堂.
 * Course list: parsed from the student HTML page (like main.py).
 * Homework:    POST /b/wlxt/kczy/zy/student/zyListWj with aoData format.
 */

import { getCsrfToken, BASE_URL, STUDENT_PAGE, consumeCachedStudentHtml } from './auth.js';
import { normalizeHomework, sortHomework } from './models.js';

const HOMEWORK_API = `${BASE_URL}/b/wlxt/kczy/zy/student/zyListWj`;

/**
 * POST to a DataTable-style API endpoint.
 * Sends aoData as a JSON array (matches the wlxt DataTable plugin format).
 * CSRF token must be both in the URL query param AND X-CSRF-Token header.
 */
async function dtPost(url, extraParams = []) {
  const csrf = await getCsrfToken();

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

  const resp = await fetch(`${url}?_csrf=${encodeURIComponent(csrf)}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-Token': csrf,
      'X-XSRF-TOKEN': csrf,
      'Referer': STUDENT_PAGE,
    },
    body: `aoData=${encodeURIComponent(JSON.stringify(aoData))}`,
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.json();
}

/**
 * Get courses by parsing the student HTML landing page.
 * Mirrors the approach in main.py: looks for course item elements.
 */
async function getCourses() {
  // Reuse HTML cached by isSessionValid() to avoid a duplicate fetch
  let html = consumeCachedStudentHtml();
  if (!html) {
    const csrf = await getCsrfToken();
    const resp = await fetch(STUDENT_PAGE, {
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf, 'X-XSRF-TOKEN': csrf },
    });
    if (!resp.ok) throw new Error(`Failed to fetch student page: HTTP ${resp.status}`);
    html = await resp.text();
  }

  // Service workers have no DOMParser, so parse with regex
  const courses = [];
  const titleRegex = /<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/;
  const teacherRegex = /<span[^>]*class="[^"]*teacherName[^"]*"[^>]*>([\s\S]*?)<\/span>/;
  const allWlkcids = [...html.matchAll(/<input[^>]*class="[^"]*wlkcid[^"]*"[^>]*value="([^"]+)"[^>]*>/g)];

  for (const match of allWlkcids) {
    const wlkcid = match[1];
    // Search forward from this match position for the title and teacher
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
 * Get unsubmitted homework for a single course.
 */
async function getCourseHomework(course) {
  const data = await dtPost(HOMEWORK_API, [
    { name: 'wlkcid', value: course.id },
  ]);

  const rows = data?.object?.aaData || [];
  return rows.map(item => normalizeHomework(item, course.name, course.id));
}

/**
 * Fetch all homework across all courses with concurrency limit.
 */
async function getAllHomework() {
  const courses = await getCourses();
  if (!courses.length) return [];

  const allHomework = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < courses.length; i += CONCURRENCY) {
    const batch = courses.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(c => getCourseHomework(c)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allHomework.push(...result.value);
      } else {
        console.warn('Failed to fetch homework for a course:', result.reason);
      }
    }
  }

  return sortHomework(allHomework);
}

export { getCourses, getCourseHomework, getAllHomework };
