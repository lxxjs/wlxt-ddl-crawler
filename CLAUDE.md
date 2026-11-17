# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

A Python crawler for Tsinghua University's 网络学堂 (Web Learning) platform (`learn.tsinghua.edu.cn`). It opens a Chrome browser so the user can log in (including 2FA), then scrapes all homework assignments and generates an HTML report sorted by deadline urgency.

## Setup & Running

```bash
# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run (opens Chrome for login, generates output/homework.html)
python main.py

# Options
python main.py --json        # also generate output/homework.json
python main.py --debug       # save page HTML snapshots to debug/
python main.py --no-close    # keep browser open after completion
```

Requires Chrome to be installed; Selenium manages the ChromeDriver automatically.

## Architecture

`main.py` uses full Selenium browser automation. `WebLearningCrawler` navigates the browser through the entire flow:
1. Opens login page, waits for user to authenticate
2. Parses the landing page HTML with BeautifulSoup to extract courses and their homework URLs
3. Navigates to each course's homework page and scrapes the table (`<table id="wtj">`)
4. Passes results to `src/output.py` for HTML/JSON generation

### `src/` module breakdown
- `config.py` — Login URL, base URL, and output path constants
- `models.py` — `Homework` dataclass with computed properties `is_expired` and `urgency_level` (0=expired, 1=<24h, 2=<3d, 3=<7d, 4=later, 5=no deadline)
- `output.py` — `generate_html()` and `generate_json()` write to `output/`; HTML is self-contained with inline CSS (dark theme, urgency-based color coding)

## Key API Endpoints

These endpoints are used by the Chrome extension (`chrome-extension/lib/api.js`), not the Python crawler (which uses HTML scraping only):

- Current semester: `GET /b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester` — `result.id`
- Courses: `GET /b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/{semester}/zh` — `resultList[]` (`wlkcid`, `kcm`, `jsm`)
- Unsubmitted homework: `POST /b/wlxt/kczy/zy/student/zyListWj` — DataTable format with `aoData=<JSON array>`
- Student page: `GET /f/wlxt/index/course/student/` — session probe and `_csrf` source only. The page fills its course list with JavaScript, so scraping it for courses is just a last-resort fallback.

Authentication requires the session cookie plus the CSRF token as the `_csrf` query parameter (also sent as `X-CSRF-Token` / `X-XSRF-TOKEN`; the API accepts requests with or without those headers). `fetch()` cannot set `Referer`; do not rely on it.

Checked against the live site on 2026-11-17: the token only appears as `_csrf=` in links on the student page — there is no `XSRF-TOKEN` cookie and no `<meta name="_csrf">`. A request with a missing or empty token gets HTTP 403. After logging out, the student page can still look logged in while API calls fail (seen as `Failed to fetch`: a redirect to login that cannot be followed).

So `probeSession()` (`lib/auth.js`) decides whether we are logged in: the student page must yield a token **and** a real API call with it must be accepted. It returns `valid`, `expired`, or `unreachable`. All requests use `cache: 'no-store'` and `redirect: 'manual'`; from the API a redirect or a 403 means logged out (`SessionExpiredError`), no answer at all means `NetworkError`. Keep those two apart: `unreachable` / `NetworkError` must never trigger a login prompt, a login tab, or a badge change.

Endpoints and field names follow [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib); check there first when the site changes.

## Chrome Extension Behaviour

- **A failed fetch must never look like "no homework".** `getAllHomework()` throws when the course list or every course fails, and reports partially failed courses; the service worker then keeps the previous cache (items of failed courses are marked `stale`).
- **Deadlines are Beijing time.** `parseDeadline()` accepts epoch timestamps or `YYYY-MM-DD HH:MM[:SS]` strings and never uses the machine's timezone. `src/models.py` uses `BEIJING_TZ` for the same reason.
- **Notifications are sent once per homework** (`selectNewUrgent()`), and the "please log in" notification once per expiry.
- **Offline is not logged out.** When the site cannot be reached the popup says so and keeps the cached list; nothing else changes.
- **Session recovery** (`ensureSession()` in the service worker), in order: silent SSO re-login via `checkSingle` using the fingerprint recorded by `content/autofill.js` → background-tab login with saved credentials (opt-out in settings, submitted at most once per attempt, stops after a wrong password / 2FA / captcha) → ask the user. A keep-alive alarm probes the session every 10 minutes. Background-tab logins are limited to 2 attempts since the last successful homework fetch.

## Credentials and Permissions

- **Saved credentials are encrypted at rest and only the service worker can read them** (`lib/credentials.js`): AES-GCM, with a non-extractable key kept in IndexedDB; `chrome.storage.local.credentials` holds `{ v: 2, iv, data }`. Do not read or write that key anywhere else, and do not import `lib/credentials.js` from the popup or a content script.
  - The popup talks to the service worker: `GET_CREDENTIAL_STATUS` (saved? which username — never the password), `SAVE_CREDENTIALS`, `CLEAR_CREDENTIALS`. These are accepted only from the extension's own pages.
  - `content/autofill.js` receives `{ username, password }` in the `LOGIN_PAGE_READY` reply, and only when the sender is the top frame of `https://id.tsinghua.edu.cn/do/off/ui/auth/login…`.
  - This keeps the password out of plain-text storage, backups and storage dumps. It cannot protect against something running as the same Chrome profile; an extension that logs in unattended must be able to recover the password.
- **Permissions are minimal on purpose:** `storage`, `alarms`, `webNavigation`, `notifications`, and host access to `learn.tsinghua.edu.cn` and `id.tsinghua.edu.cn` only. `chrome.tabs.create/get/update/remove` need no `tabs` permission. Do not add `cookies`, `tabs`, `scripting` or wider hosts without a concrete need.

## Tests

```bash
node chrome-extension/tests/test-credentials.mjs  # encrypted credential storage (real WebCrypto, fake IndexedDB)
node chrome-extension/tests/test-models.mjs    # deadline parsing, urgency, merge, notification dedupe
node chrome-extension/tests/test-parsing.mjs   # API/HTML response parsing, auth helpers
node chrome-extension/tests/test-flow.mjs      # service worker against a fake 网络学堂 (fake chrome.* + fetch)
```

The fake server in `test-flow.mjs` is modelled on thu-learn-lib, not recorded from the live site.

## Chrome Extension Rules

- Service workers have restricted APIs — do NOT use DOMParser, document, or other DOM APIs in service worker scripts. Use regex or string parsing instead.
