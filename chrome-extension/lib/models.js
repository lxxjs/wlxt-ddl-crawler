/**
 * Urgency calculation and data normalization.
 * Ported from src/models.py.
 */

/**
 * Parse deadline string into a Date object.
 * Handles formats: "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DD HH:MM", "YYYY-MM-DD"
 */
function parseDeadline(deadlineStr) {
  if (!deadlineStr) return null;
  // Replace any dash-formatted date to ensure cross-browser compat
  const d = new Date(deadlineStr.replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a deadline has passed.
 */
function isExpired(deadline) {
  if (!deadline) return false;
  return Date.now() > deadline.getTime();
}

/**
 * Calculate urgency level (ported from src/models.py:46-72).
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
 * Format time remaining (ported from src/crawler.py:163-173).
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
  const deadlineStr = item.jzsj || '';
  const deadline = parseDeadline(deadlineStr);

  return {
    id: item.zyid || '',
    title: item.bt || 'Untitled',
    courseName,
    courseId,
    deadline: deadline ? deadline.toISOString() : null,
    deadlineStr,
    status: 'unsubmitted',
    timeLeft: formatTimeLeft(deadline),
    urgency: urgencyLevel(deadline),
    description: item.sm || '',
  };
}

/**
 * Sort homework list by urgency (most urgent first, no-deadline last).
 */
function sortHomework(homeworkList) {
  return [...homeworkList].sort((a, b) => {
    // Active (1-4) before expired (0), expired before no-deadline (5)
    const order = [5, 4, 3, 2, 1, 0]; // priority mapping: lower index = lower sort priority
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

export {
  parseDeadline,
  isExpired,
  urgencyLevel,
  formatTimeLeft,
  normalizeHomework,
  sortHomework,
};
