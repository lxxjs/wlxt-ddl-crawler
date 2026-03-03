/**
 * Unit tests for lib/models.js
 * Run with: node chrome-extension/tests/test-models.mjs
 *
 * models.js has no browser dependencies — imports cleanly in Node.js.
 */

import assert from 'node:assert/strict';
import { urgencyLevel, formatTimeLeft, normalizeHomework, sortHomework } from '../lib/models.js';

const now = Date.now();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ─── urgencyLevel ───────────────────────────────────────────────────────────

console.log('\nurgencyLevel()');

test('null deadline → 5 (no deadline)', () => {
  assert.equal(urgencyLevel(null), 5);
});

test('undefined deadline → 5', () => {
  assert.equal(urgencyLevel(undefined), 5);
});

test('expired (1 second ago) → 0', () => {
  assert.equal(urgencyLevel(new Date(now - 1000)), 0);
});

test('< 24h left → 1', () => {
  assert.equal(urgencyLevel(new Date(now + 12 * 3600 * 1000)), 1);
});

test('exactly 23h 59m left → 1', () => {
  assert.equal(urgencyLevel(new Date(now + (24 * 3600 - 60) * 1000)), 1);
});

test('< 3 days (48h) left → 2', () => {
  assert.equal(urgencyLevel(new Date(now + 48 * 3600 * 1000)), 2);
});

test('< 7 days (5d) left → 3', () => {
  assert.equal(urgencyLevel(new Date(now + 5 * 24 * 3600 * 1000)), 3);
});

test('>= 7 days (10d) left → 4', () => {
  assert.equal(urgencyLevel(new Date(now + 10 * 24 * 3600 * 1000)), 4);
});

// ─── formatTimeLeft ─────────────────────────────────────────────────────────

console.log('\nformatTimeLeft()');

test('null → empty string', () => {
  assert.equal(formatTimeLeft(null), '');
});

test('past deadline → "已过期"', () => {
  assert.equal(formatTimeLeft(new Date(now - 60000)), '已过期');
});

test('2 days left → "2天"', () => {
  assert.equal(formatTimeLeft(new Date(now + 2 * 24 * 3600 * 1000 + 60000)), '2天');
});

test('3 hours left → "3小时"', () => {
  assert.equal(formatTimeLeft(new Date(now + 3 * 3600 * 1000 + 60000)), '3小时');
});

test('30 minutes left → "30分钟"', () => {
  assert.equal(formatTimeLeft(new Date(now + 30 * 60 * 1000 + 5000)), '30分钟');
});

// ─── normalizeHomework ───────────────────────────────────────────────────────

console.log('\nnormalizeHomework()');

const futureDate = '2030-12-31 23:59:59';
const pastDate   = '2020-01-01 00:00:00';

test('fields mapped correctly from API response', () => {
  const hw = normalizeHomework(
    { zyid: 'hw001', bt: '第一次作业', jzsj: futureDate, sm: '完成习题1-10' },
    '高等数学', 'course001'
  );
  assert.equal(hw.id, 'hw001');
  assert.equal(hw.title, '第一次作业');
  assert.equal(hw.courseName, '高等数学');
  assert.equal(hw.courseId, 'course001');
  assert.equal(hw.deadlineStr, futureDate);
  assert.equal(hw.status, 'unsubmitted');
  assert.equal(hw.description, '完成习题1-10');
  assert.ok(hw.deadline, 'deadline ISO string should be set');
  assert.equal(hw.urgency, 4); // far future
});

test('missing fields get defaults', () => {
  const hw = normalizeHomework({}, '数学', 'c1');
  assert.equal(hw.title, 'Untitled');
  assert.equal(hw.id, '');
  assert.equal(hw.deadline, null);
  assert.equal(hw.urgency, 5); // no deadline
  assert.equal(hw.timeLeft, '');
});

test('expired homework → urgency 0', () => {
  const hw = normalizeHomework(
    { bt: '过期作业', jzsj: pastDate },
    '数学', 'c1'
  );
  assert.equal(hw.urgency, 0);
  assert.equal(hw.timeLeft, '已过期');
});

test('deadline with dashes parses correctly (cross-browser fix)', () => {
  // Dates with dashes can fail in some environments — the code replaces - with /
  const hw = normalizeHomework(
    { bt: 'hw', jzsj: '2030-06-15 10:00:00' },
    'test', 'c1'
  );
  assert.ok(hw.deadline !== null, 'deadline should parse');
  assert.equal(hw.urgency, 4);
});

test('malformed deadline → null, urgency 5', () => {
  const hw = normalizeHomework({ bt: 'hw', jzsj: 'not-a-date' }, 'test', 'c1');
  assert.equal(hw.deadline, null);
  assert.equal(hw.urgency, 5);
});

// ─── sortHomework ────────────────────────────────────────────────────────────

console.log('\nsortHomework()');

test('most urgent first, no-deadline last, expired after active', () => {
  const unsorted = [
    { urgency: 5, deadline: null },
    { urgency: 0, deadline: '2020-01-01T00:00:00.000Z' },
    { urgency: 4, deadline: '2026-03-20T00:00:00.000Z' },
    { urgency: 1, deadline: '2026-03-04T01:00:00.000Z' },
    { urgency: 2, deadline: '2026-03-05T00:00:00.000Z' },
  ];
  const sorted = sortHomework(unsorted);
  const urgencies = sorted.map(h => h.urgency);
  assert.deepEqual(urgencies, [1, 2, 4, 0, 5]);
});

test('within same urgency, earlier deadline first', () => {
  const items = [
    { urgency: 2, deadline: '2026-03-06T00:00:00.000Z' },
    { urgency: 2, deadline: '2026-03-04T00:00:00.000Z' },
    { urgency: 2, deadline: '2026-03-05T00:00:00.000Z' },
  ];
  const sorted = sortHomework(items);
  assert.equal(sorted[0].deadline, '2026-03-04T00:00:00.000Z');
  assert.equal(sorted[2].deadline, '2026-03-06T00:00:00.000Z');
});

test('does not mutate input array', () => {
  const original = [
    { urgency: 4, deadline: '2026-03-20T00:00:00.000Z' },
    { urgency: 1, deadline: '2026-03-04T00:00:00.000Z' },
  ];
  sortHomework(original);
  assert.equal(original[0].urgency, 4); // unchanged
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
