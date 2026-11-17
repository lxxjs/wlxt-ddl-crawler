# Changelog

## [1.3.0] — 2026-11-17

### Chrome Extension — security
- Saved credentials are encrypted at rest (AES-GCM, non-extractable key in IndexedDB). Credentials saved by earlier versions as plain text are encrypted automatically on update
- Only the service worker can read them. The login-page script gets them by message, and only as the top frame of the id.tsinghua.edu.cn login page; the popup can only learn whether an account is saved and its username
- The settings panel no longer fills the saved password back in (leave the field blank to keep it); added **清除账号** to delete the saved account
- Permissions reduced to `storage`, `alarms`, `webNavigation`, `notifications`; host access reduced from `*.tsinghua.edu.cn` to `learn` and `id`. Removed `cookies`, `tabs`, `scripting`
- Removed `content/cookie-bridge.js` and the `XSRF-TOKEN` cookie fallback: the live site has no such cookie
- The login-page content script now only runs on `/do/off/ui/auth/login/*`

## [1.2.1] — 2026-11-17

### Chrome Extension
- Logging out of 网络学堂 no longer shows "获取失败: Failed to fetch". Whether we are logged in is now decided by a real API call (`probeSession()`), not by how the student page looks; requests bypass the HTTP cache and do not follow redirects, since a redirect from the API means "log in"
- Being offline is reported as such ("无法连接网络学堂") and no longer triggers the login prompt, a login notification, a background login tab, or the "!" badge
- Background-tab login attempts are counted since the last successful fetch (max 2), so a login that completes while the API still refuses us cannot loop

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
