/**
 * Unit tests for the HTML/API parsing logic in lib/api.js
 * Run with: node chrome-extension/tests/test-parsing.mjs
 *
 * api.js imports from auth.js which uses chrome.* globals, so we mock the
 * minimum needed before importing.
 */

import assert from 'node:assert/strict';

// Minimal chrome mock — only what auth.js touches at module level
globalThis.chrome = {
  cookies: { getAll: async () => [] },
  storage: { local: { get: async () => ({}) } },
};
globalThis.fetch = async () => ({ ok: false, text: async () => '' });

// Import the named exports we want to test
import { parseCoursesFromHtml, parseHomeworkResponse } from '../lib/api.js';

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

// ─── parseCoursesFromHtml ────────────────────────────────────────────────────

console.log('\nparseCoursesFromHtml()');

const sampleHtmlClassFirst = `
<li class="clearfix course-item">
  <input type="hidden" class="wlkcid" value="2024010001">
  <a class="title" href="/f/wlxt/kc/course?wlkcid=2024010001">高等数学</a>
  <span class="teacherName">张伟</span>
</li>
<li class="clearfix course-item">
  <input type="hidden" class="wlkcid" value="2024010002">
  <a class="title" href="/f/wlxt/kc/course?wlkcid=2024010002">线性代数</a>
  <span class="teacherName">李明</span>
</li>
`;

const sampleHtmlValueFirst = `
<li class="clearfix course-item">
  <input value="2024020001" class="wlkcid" type="hidden">
  <a class="title" href="#">离散数学</a>
  <span class="teacherName">王芳</span>
</li>
`;

const sampleHtmlNameAttr = `
<li class="clearfix course-item">
  <input type="hidden" name="wlkcid" value="2024030001">
  <a class="title" href="#">概率论</a>
  <span class="teacherName">陈刚</span>
</li>
`;

const sampleHtmlNameValueReversed = `
<li class="clearfix course-item">
  <input value="2024040001" type="hidden" name="wlkcid">
  <a class="title" href="#">数学分析</a>
  <span class="teacherName">赵雷</span>
</li>
`;

test('class="wlkcid" before value= — standard order', () => {
  const courses = parseCoursesFromHtml(sampleHtmlClassFirst);
  assert.equal(courses.length, 2);
  assert.equal(courses[0].id, '2024010001');
  assert.equal(courses[0].name, '高等数学');
  assert.equal(courses[0].teacher, '张伟');
  assert.equal(courses[1].id, '2024010002');
  assert.equal(courses[1].name, '线性代数');
});

test('value= before class="wlkcid" — reversed attribute order', () => {
  const courses = parseCoursesFromHtml(sampleHtmlValueFirst);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, '2024020001');
  assert.equal(courses[0].name, '离散数学');
  assert.equal(courses[0].teacher, '王芳');
});

test('name="wlkcid" attribute (fallback pattern)', () => {
  const courses = parseCoursesFromHtml(sampleHtmlNameAttr);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, '2024030001');
  assert.equal(courses[0].name, '概率论');
});

test('value= before name="wlkcid" — reversed name attribute order', () => {
  const courses = parseCoursesFromHtml(sampleHtmlNameValueReversed);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, '2024040001');
  assert.equal(courses[0].name, '数学分析');
});

test('empty HTML → empty array', () => {
  const courses = parseCoursesFromHtml('');
  assert.equal(courses.length, 0);
});

test('HTML with no courses → empty array', () => {
  const courses = parseCoursesFromHtml('<html><body><p>Hello</p></body></html>');
  assert.equal(courses.length, 0);
});

test('course without title → "Unknown Course"', () => {
  const html = `<input type="hidden" class="wlkcid" value="99999">`;
  const courses = parseCoursesFromHtml(html);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].name, 'Unknown Course');
  assert.equal(courses[0].teacher, '');
});

test('course without teacher → empty teacher string', () => {
  const html = `
    <input class="wlkcid" value="11111" type="hidden">
    <a class="title">无教师课程</a>
  `;
  const courses = parseCoursesFromHtml(html);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].teacher, '');
});

test('HTML tags stripped from name and teacher', () => {
  const html = `
    <input class="wlkcid" value="22222" type="hidden">
    <a class="title"><span>嵌套</span>标签</a>
    <span class="teacherName"><b>教授</b></span>
  `;
  const courses = parseCoursesFromHtml(html);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].name, '嵌套标签');
  assert.equal(courses[0].teacher, '教授');
});

// ─── parseHomeworkResponse ───────────────────────────────────────────────────

console.log('\nparseHomeworkResponse()');

test('{ object: { aaData: [...] } } — standard DataTable wrapper', () => {
  const data = { object: { aaData: [{ bt: 'hw1' }, { bt: 'hw2' }] } };
  const rows = parseHomeworkResponse(data);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].bt, 'hw1');
});

test('{ aaData: [...] } — flat response shape (fallback)', () => {
  const data = { aaData: [{ bt: 'hw3' }] };
  const rows = parseHomeworkResponse(data);
  assert.equal(rows.length, 1);
});

test('empty aaData array', () => {
  const data = { object: { aaData: [] } };
  const rows = parseHomeworkResponse(data);
  assert.equal(rows.length, 0);
});

test('null response → empty array', () => {
  assert.deepEqual(parseHomeworkResponse(null), []);
});

test('undefined response → empty array', () => {
  assert.deepEqual(parseHomeworkResponse(undefined), []);
});

test('object without aaData → empty array', () => {
  const data = { object: { total: 0 } };
  assert.deepEqual(parseHomeworkResponse(data), []);
});

test('realistic full API response', () => {
  const data = {
    result: 'success',
    object: {
      sEcho: 1,
      iTotalRecords: 1,
      iTotalDisplayRecords: 1,
      aaData: [
        {
          zyid: 'abc123',
          bt: '第一次作业',
          jzsj: '2026-03-10 23:59:59',
          sm: '完成习题',
        },
      ],
    },
  };
  const rows = parseHomeworkResponse(data);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].zyid, 'abc123');
  assert.equal(rows[0].bt, '第一次作业');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
