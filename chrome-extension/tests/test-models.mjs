/**
 * Unit tests for lib/models.js
 * Run with: node chrome-extension/tests/test-models.mjs
 *
 * models.js has no browser dependencies — imports cleanly in Node.js.
 */

import assert from 'node:assert/strict';
import {
  parseDeadline, formatBeijing, urgencyLevel, formatTimeLeft, normalizeHomework,
  sortHomework, mergeWithPrevious, selectNewUrgent,
} from '../lib/models.js';

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

// ─── parseDeadline ──────────────────────────────────────────────────────────

console.log('\nparseDeadline()');

test('string is read as Beijing time, whatever TZ this machine is in', () => {
  // 23:59:59 in Beijing (UTC+8) is 15:59:59 UTC
  assert.equal(parseDeadline('2026-03-10 23:59:59').toISOString(), '2026-03-10T15:59:59.000Z');
});

test('string without seconds / date only', () => {
  assert.equal(parseDeadline('2026-03-10 23:59').toISOString(), '2026-03-10T15:59:00.000Z');
  assert.equal(parseDeadline('2026-03-10').toISOString(), '2026-03-09T16:00:00.000Z');
});

test('epoch milliseconds as number', () => {
  assert.equal(parseDeadline(1773158399000).toISOString(), '2026-03-10T15:59:59.000Z');
});

test('epoch milliseconds as numeric string, and epoch seconds', () => {
  assert.equal(parseDeadline('1773158399000').toISOString(), '2026-03-10T15:59:59.000Z');
  assert.equal(parseDeadline(1773158399).toISOString(), '2026-03-10T15:59:59.000Z');
});

test('empty / null / garbage → null', () => {
  assert.equal(parseDeadline(''), null);
  assert.equal(parseDeadline(null), null);
  assert.equal(parseDeadline(undefined), null);
  assert.equal(parseDeadline('not-a-date'), null);
  assert.equal(parseDeadline(0), null);
});

test('formatBeijing round-trips the wall-clock time', () => {
  assert.equal(formatBeijing(parseDeadline('2026-03-10 23:59:59')), '2026-03-10 23:59');
  assert.equal(formatBeijing(null), '');
});

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
  assert.equal(hw.deadlineStr, '2030-12-31 23:59');
  assert.equal(hw.deadline, '2030-12-31T15:59:59.000Z');
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

test('numeric jzsj (epoch ms) is accepted instead of throwing', () => {
  const hw = normalizeHomework({ zyid: 'z', bt: 'hw', jzsj: 1924963199000 }, 'test', 'c1');
  assert.equal(hw.deadline, '2030-12-31T15:59:59.000Z');
  assert.equal(hw.deadlineStr, '2030-12-31 23:59');
  assert.equal(hw.urgency, 4);
});

test('falls back to jzsjStr when jzsj is missing', () => {
  const hw = normalizeHomework({ bt: 'hw', jzsjStr: '2030-12-31 23:59' }, 'test', 'c1');
  assert.equal(hw.deadline, '2030-12-31T15:59:00.000Z');
});

test('id prefers xszyid over zyid', () => {
  assert.equal(normalizeHomework({ xszyid: 's1', zyid: 'z1' }, 'c', 'c1').id, 's1');
  assert.equal(normalizeHomework({ zyid: 'z1' }, 'c', 'c1').id, 'z1');
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

// ─── mergeWithPrevious ───────────────────────────────────────────────────────

console.log('\nmergeWithPrevious()');

const soon = new Date(now + 5 * 3600 * 1000).toISOString();
const later = new Date(now + 5 * 24 * 3600 * 1000).toISOString();

test('no failures → just the fresh list', () => {
  const fresh = [{ id: 'a', courseId: 'c1', urgency: 3, deadline: later }];
  const prev = [{ id: 'old', courseId: 'c2', urgency: 1, deadline: soon }];
  assert.deepEqual(mergeWithPrevious(fresh, prev, []).map(h => h.id), ['a']);
});

test('failed course keeps its previous items, marked stale', () => {
  const fresh = [{ id: 'a', courseId: 'c1', urgency: 3, deadline: later }];
  const prev = [
    { id: 'old-c2', courseId: 'c2', urgency: 4, deadline: soon },
    { id: 'old-c1', courseId: 'c1', urgency: 4, deadline: soon },
  ];
  const merged = mergeWithPrevious(fresh, prev, ['c2']);
  assert.deepEqual(merged.map(h => h.id), ['old-c2', 'a']); // re-sorted by urgency
  assert.equal(merged[0].stale, true);
  assert.equal(merged[0].urgency, 1); // recomputed from the deadline
  assert.equal(merged[1].stale, undefined);
});

test('failed course with no previous cache → fresh list only', () => {
  const fresh = [{ id: 'a', courseId: 'c1', urgency: 3, deadline: later }];
  assert.deepEqual(mergeWithPrevious(fresh, null, ['c2']).map(h => h.id), ['a']);
});

// ─── selectNewUrgent ─────────────────────────────────────────────────────────

console.log('\nselectNewUrgent()');

test('first sighting of urgent homework is notified', () => {
  const list = [
    { id: 'a', urgency: 1, deadline: soon },
    { id: 'b', urgency: 3, deadline: later },
  ];
  const { fresh, next } = selectNewUrgent(list, {});
  assert.deepEqual(fresh.map(h => h.id), ['a']);
  assert.deepEqual(next, { a: soon });
});

test('already-notified homework is not notified again', () => {
  const list = [{ id: 'a', urgency: 1, deadline: soon }];
  const { fresh, next } = selectNewUrgent(list, { a: soon });
  assert.equal(fresh.length, 0);
  assert.deepEqual(next, { a: soon });
});

test('changed deadline is notified again', () => {
  const moved = new Date(now + 3 * 3600 * 1000).toISOString();
  const { fresh } = selectNewUrgent([{ id: 'a', urgency: 1, deadline: moved }], { a: soon });
  assert.equal(fresh.length, 1);
});

test('homework that is no longer urgent is forgotten', () => {
  const { next } = selectNewUrgent([{ id: 'b', urgency: 3, deadline: later }], { a: soon });
  assert.deepEqual(next, {});
});

test('items without id are keyed by course + title', () => {
  const list = [{ id: '', courseId: 'c1', title: 'hw', urgency: 1, deadline: soon }];
  const { next } = selectNewUrgent(list, {});
  assert.deepEqual(next, { 'c1:hw': soon });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
