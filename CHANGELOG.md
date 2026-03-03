# Changelog

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
