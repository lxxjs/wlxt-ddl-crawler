/**
 * API client for 网络学堂.
 * Course list: parsed from the student HTML page (like main.py).
 * Homework:    POST /b/wlxt/kczy/zy/student/zyListWj with aoData format.
 */

import { getSessionCookies, BASE_URL } from './auth.js';
import { normalizeHomework, sortHomework } from './models.js';

const STUDENT_PAGE = `${BASE_URL}/f/wlxt/index/course/student/`;
const HOMEWORK_API = `${BASE_URL}/b/wlxt/kczy/zy/student/zyListWj`;

/**
 * Get XSRF-TOKEN cookie value.
 */
async function getCsrfToken() {
  const cookies = await getSessionCookies();
  return cookies['XSRF-TOKEN'] || '';
}

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
 * Mirrors the approach in main.py: looks for #suoxuecourse .item elements.
 */
async function getCourses() {
  const csrf = await getCsrfToken();
  const resp = await fetch(STUDENT_PAGE, {
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrf,
      'X-XSRF-TOKEN': csrf,
    },
  });
  if (!resp.ok) throw new Error(`Failed to fetch student page: HTTP ${resp.status}`);
  const html = await resp.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const courses = [];
  const items = doc.querySelectorAll('#suoxuecourse .item');
  for (const item of items) {
    // Get wlkcid from hidden input
    const wlkcidInput = item.querySelector('input.wlkcid');
    const titleEl = item.querySelector('a.title');
    const teacherEl = item.querySelector('span.teacherName');

    const wlkcid = wlkcidInput?.value || '';
    const name = titleEl?.textContent?.trim() || 'Unknown Course';
    const teacher = teacherEl?.textContent?.trim() || '';

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
