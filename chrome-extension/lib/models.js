/**
 * Urgency calculation and data normalization.
 * Ported from src/models.py.
 */

// 网络学堂 always reports wall-clock times in Beijing time (UTC+8, no DST).
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function fromEpoch(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  // Values below 1e11 are seconds, everything else is milliseconds.
  const d = new Date(n < 1e11 ? n * 1000 : n);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a deadline from the API into a Date.
 *
 * Accepts either an epoch timestamp (number or numeric string) or a
 * "YYYY-MM-DD[ HH:MM[:SS]]" string. Strings are interpreted as Beijing time
 * regardless of the timezone this machine is in.
 */
function parseDeadline(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return fromEpoch(value);

  const s = String(value).trim();
  if (/^\d{10,13}$/.test(s)) return fromEpoch(Number(s));

  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;

  const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - BEIJING_OFFSET_MS;
  const date = new Date(utcMs);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Format a Date as "YYYY-MM-DD HH:MM" in Beijing time (what 网络学堂 shows).
 */
function formatBeijing(date) {
  if (!date) return '';
  return new Date(date.getTime() + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}

/**
 * Check if a deadline has passed.
 */
function isExpired(deadline) {
  if (!deadline) return false;
  return Date.now() > deadline.getTime();
}

/**
 * Calculate urgency level.
 * 0 = expired, 1 = <24h, 2 = <3d, 3 = <7d, 4 = later, 5 = no deadline
 */
function urgencyLevel(deadline) {
  if (!deadline) return 5;
  if (isExpired(deadline)) return 0;

  const hoursLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft < 24) return 1;
  if (hoursLeft < 72) return 2;
  if (hoursLeft < 168) return 3;
  return 4;
}

/**
 * Format time remaining.
 */
function formatTimeLeft(deadline) {
  if (!deadline) return '';
  const diffMs = deadline.getTime() - Date.now();
  if (diffMs < 0) return '已过期';

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}天`;

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours > 0) return `${hours}小时`;

  const minutes = Math.floor(diffMs / (1000 * 60));
  return `${minutes}分钟`;
}

/**
 * Normalize a raw homework item from the API into a consistent shape.
 */
function normalizeHomework(item, courseName, courseId) {
  const deadline = parseDeadline(item.jzsj) ?? parseDeadline(item.jzsjStr);

  return {
    // xszyid is unique per student+homework; zyid is the shared homework id.
    id: item.xszyid || item.zyid || '',
    title: item.bt || 'Untitled',
    courseName,
    courseId,
    deadline: deadline ? deadline.toISOString() : null,
    deadlineStr: formatBeijing(deadline),
    status: 'unsubmitted',
    timeLeft: formatTimeLeft(deadline),
    urgency: urgencyLevel(deadline),
    description: item.sm || '',
  };
}

/**
 * Recompute the time-dependent fields of a cached homework item.
 */
function refreshComputedFields(hw) {
  const deadline = hw.deadline ? new Date(hw.deadline) : null;
  return {
    ...hw,
    timeLeft: formatTimeLeft(deadline),
    urgency: urgencyLevel(deadline),
  };
}

/**
 * Sort homework list by urgency (most urgent first, no-deadline last).
 */
function sortHomework(homeworkList) {
  return [...homeworkList].sort((a, b) => {
    // Active (1-4) before expired (0), expired before no-deadline (5)
    const aRank = a.urgency === 0 ? 6 : a.urgency === 5 ? 7 : a.urgency;
    const bRank = b.urgency === 0 ? 6 : b.urgency === 5 ? 7 : b.urgency;
    if (aRank !== bRank) return aRank - bRank;
    // Within same urgency, sort by deadline ascending
    if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return 0;
  });
}

/**
 * Merge a fresh fetch with the previous cache.
 *
 * Courses whose request failed keep the items we last saw for them, so a
 * transient error never makes pending homework disappear from the list.
 */
function mergeWithPrevious(freshHomework, previousHomework, failedCourseIds) {
  if (!failedCourseIds.length || !previousHomework?.length) return sortHomework(freshHomework);

  const failed = new Set(failedCourseIds);
  const carried = previousHomework
    .filter(hw => failed.has(hw.courseId))
    .map(hw => ({ ...refreshComputedFields(hw), stale: true }));

  return sortHomework([...freshHomework, ...carried]);
}

/**
 * Stable key for remembering which homework we already notified about.
 */
function notificationKey(hw) {
  return hw.id || `${hw.courseId}:${hw.title}`;
}

/**
 * Decide which urgent homework still needs a notification.
 *
 * `notified` maps notificationKey -> the deadline we notified for. An item is
 * notified once; it is notified again only if its deadline changes. Entries
 * for homework that is no longer urgent are dropped.
 */
function selectNewUrgent(homeworkList, notified = {}) {
  const urgent = homeworkList.filter(hw => hw.urgency === 1);
  const fresh = urgent.filter(hw => notified[notificationKey(hw)] !== hw.deadline);
  const next = Object.fromEntries(urgent.map(hw => [notificationKey(hw), hw.deadline]));
  return { fresh, next };
}

export {
  parseDeadline,
  formatBeijing,
  urgencyLevel,
  formatTimeLeft,
  normalizeHomework,
  refreshComputedFields,
  sortHomework,
  mergeWithPrevious,
  selectNewUrgent,
};
