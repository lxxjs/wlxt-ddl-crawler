# Changelog

## [1.2.0] — 2026-11-17

### Chrome Extension — reliability
- A failed fetch no longer shows up as "no homework": course-list and per-course failures are reported, the previous cache is kept, and items of failed courses are marked as stale in the popup
- Deadlines are parsed as Beijing time regardless of the machine's timezone, and epoch-millisecond `jzsj` values no longer throw
- Course list now comes from the JSON API (`getCurrentAndNextSemester` → `loadCourseBySemesterId`) instead of regex over the student page; the HTML scrape remains only as a fallback
- Urgent-deadline notifications fire once per homework instead of on every refresh
- Concurrent refreshes share one run; refresh interval is clamped to 5–120 minutes
- Removed the `Referer` request header, which `fetch()` silently drops
- A session only counts as valid when the student page yields a CSRF token; API requests are never sent with an empty token, and an HTTP 403 from the API is handled as "session expired" (one retry with a fresh token, then ask the user) instead of a generic fetch error

### Chrome Extension — log in once
- Keep-alive alarm every 10 minutes
- Silent session restore through id.tsinghua.edu.cn's remembered login (`checkSingle`), using the device fingerprint recorded on the login page
- Optional background-tab auto login with saved credentials (new setting, on by default; one submission per attempt, stops on wrong password / 2FA / captcha)
- "Please log in" notification is sent once per expiry and focuses the tab that needs attention

### Python
- Deadlines are timezone-aware (Beijing time), so urgency is correct outside UTC+8

### Tests
- Added `tests/test-flow.mjs`: drives the real service worker against a fake 网络学堂

## [Unreleased] — 2026-03-03

### Chrome Extension — JS
- Removed dead exports: `getCourses`, `getCourseHomework` from `lib/api.js` (functions kept internally)
- Made private (unexported): `parseDeadline`, `isExpired` in `lib/models.js`
- Made private (unexported): `generateICS` in `lib/export.js`
- Made private (unexported): `KEYS`, `get`, `set` in `lib/storage.js`

### Chrome Extension — CSS
- Changed accent color from Tsinghua blue (#1493f2) to Tsinghua purple (#660874)
- Added CSS design tokens: `--accent-light`, `--accent-mid`, `--accent-focus`
- Added font scale tokens: `--font-2xs` through `--font-2xl`
- Added spacing tokens: `--space-xs` through `--space-xl`
- Replaced 5 hardcoded `rgba(20, 147, 242, ...)` values with accent tokens
- Replaced 18 hardcoded `font-size` values with scale tokens

### Python / Docs
- Updated `CLAUDE.md`: removed references to deleted `src/auth.py` and `src/crawler.py`
- Updated `CLAUDE.md`: corrected models description (only `Homework`, not `Course`)
- Updated `CLAUDE.md`: corrected API endpoints section to Chrome extension context
- Added Chrome Extension Rules section to `CLAUDE.md` (service worker constraints)
- Deleted `legacy/` directory (unused experimental scripts)
