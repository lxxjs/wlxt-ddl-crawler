/**
 * API client for 网络学堂.
 * Ported from src/config.py (URLs) and src/crawler.py (request logic).
 */

import { buildHeaders, BASE_URL } from './auth.js';
import { normalizeHomework, sortHomework } from './models.js';

// API endpoints (from src/config.py)
const API_PREFIX = `${BASE_URL}/b`;
const SEMESTER_LIST_URL = `${API_PREFIX}/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadSemesterIdList`;
const COURSE_LIST_URL = `${API_PREFIX}/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId`;
const HOMEWORK_LIST_URL = `${API_PREFIX}/wlxt/kczy/zy/student/index/zyListWj`;

/**
 * Calculate current semester ID based on date (from src/crawler.py:42-58).
 */
function calculateCurrentSemester() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (month >= 2 && month <= 6) return `${year - 1}-${year}-2`;
  if (month >= 7 && month <= 8) return `${year - 1}-${year}-3`;
  if (month >= 9) return `${year}-${year + 1}-1`;
  return `${year - 1}-${year}-1`; // January
}

/**
 * Make an authenticated GET request.
 */
async function apiGet(url) {
  const headers = await buildHeaders();
  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Make an authenticated POST request with form data.
 */
async function apiPost(url, params) {
  const headers = await buildHeaders();
  headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';

  const body = new URLSearchParams(params).toString();
  const resp = await fetch(url, { method: 'POST', headers, body, credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Get current semester ID (from src/crawler.py:26-40).
 */
async function getCurrentSemester() {
  try {
    const data = await apiGet(SEMESTER_LIST_URL);
    if (data.result === 'success' && data.resultList?.length) {
      return data.resultList[0].id;
    }
  } catch (e) {
    console.warn('Failed to get semester list, using calculated value:', e);
  }
  return calculateCurrentSemester();
}

/**
 * Get courses for a semester (from src/crawler.py:60-109).
 */
async function getCourses(semesterId) {
  if (!semesterId) semesterId = await getCurrentSemester();
  const data = await apiPost(COURSE_LIST_URL, { semester: semesterId });

  if (data.result === 'success' && data.resultList) {
    return data.resultList.map(item => ({
      id: item.wlkcid || '',
      name: item.kcm || 'Unknown Course',
      teacher: item.jsm || '',
      courseNumber: item.kch || '',
    }));
  }
  return [];
}

/**
 * Get unsubmitted homework for a single course (from src/crawler.py:130-188).
 */
async function getCourseHomework(course) {
  const data = await apiPost(HOMEWORK_LIST_URL, {
    wlkcid: course.id,
    size: 100,
    page: 1,
  });

  const rows = data?.object?.aaData || [];
  return rows.map(item => normalizeHomework(item, course.name, course.id));
}

/**
 * Fetch all homework across all courses with concurrency limit.
 */
async function getAllHomework(semesterId) {
  const courses = await getCourses(semesterId);
  if (!courses.length) return [];

  const allHomework = [];
  const CONCURRENCY = 3;

  // Process in batches of CONCURRENCY
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

export {
  getCurrentSemester,
  getCourses,
  getCourseHomework,
  getAllHomework,
};
