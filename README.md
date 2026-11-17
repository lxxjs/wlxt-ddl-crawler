# 网络学堂 Homework Crawler

Fetches all homework deadlines from Tsinghua University's Web Learning platform (`learn.tsinghua.edu.cn`) and generates an HTML report sorted by urgency.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Requires Chrome (ChromeDriver is managed automatically by Selenium).

## Usage

```bash
python main.py              # Generate output/homework.html
python main.py --json       # Also generate output/homework.json
python main.py --debug      # Save page HTML snapshots to debug/
python main.py --no-close   # Keep browser open after completion
```

A Chrome window opens — log in to 网络学堂 (complete 2FA if required). The crawler then scrapes all courses and homework automatically.

## Output

`output/homework.html` — a self-contained dark-theme report with:
- Stats bar (urgent / active / expired counts)
- Cards color-coded by urgency: red (<24h), orange (<3d), green (≤7d)
- Expired homework section at the bottom

## Project Structure

```
wlxt-ddl-crawler/
├── main.py                        # Selenium crawler (entry point)
├── requirements.txt
├── src/
│   ├── config.py                  # URLs and output paths
│   ├── models.py                  # Homework dataclass
│   └── output.py                  # HTML/JSON generation
└── chrome-extension/              # Chrome extension (badge + notifications)
    ├── manifest.json
    ├── background/service-worker.js
    ├── lib/                       # auth, api, models, storage, export
    ├── popup/                     # Extension popup UI
    └── content/                   # Autofill + cookie-bridge scripts
```

## Chrome Extension

The `chrome-extension/` directory contains a Manifest V3 extension that:
- Shows a badge with the count of urgent/active homework
- Sends notifications for assignments due within 24h
- Refreshes automatically on a configurable interval
- Exports to clipboard (text) or `.ics` (Apple Reminders)

Load it in Chrome via **Extensions → Load unpacked** and point to `chrome-extension/`.

### Log in once

Log in to 网络学堂 once in the same Chrome profile. After that the extension keeps itself logged in:

1. A keep-alive request every 10 minutes stops the session from idling out.
2. If the session still expires (for example after restarting Chrome), it is restored silently through the login that `id.tsinghua.edu.cn` remembers for this browser. No password is involved.
3. If that is not possible and you saved your username and password in the extension settings, the login page is opened in a background tab, filled in, submitted once, and closed again. Turn this off with **会话过期时自动登录**. Saved credentials live unencrypted in `chrome.storage.local`.
4. Only when a step needs you (二次认证, captcha, wrong password) do you get a notification; click it to finish logging in.

While logged out, or when some courses fail to load, the popup keeps showing the last known homework and says so, instead of showing an empty list.

### Tests

```bash
node chrome-extension/tests/test-models.mjs
node chrome-extension/tests/test-parsing.mjs
node chrome-extension/tests/test-flow.mjs
```
