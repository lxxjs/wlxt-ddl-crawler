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

- Student page (courses): `GET /f/wlxt/index/course/student/` — parse HTML for course data
- Unsubmitted homework: `POST /b/wlxt/kczy/zy/student/zyListWj` — DataTable format with `aoData=<JSON array>`

Authentication requires `XSRF-TOKEN` cookie + `X-CSRF-Token` / `X-XSRF-TOKEN` headers. The `Referer` header is also critical.

## Notes

- The README mentions a `--semester` flag that does not exist in the current `main.py`.

## Chrome Extension Rules

- Service workers have restricted APIs — do NOT use DOMParser, document, or other DOM APIs in service worker scripts. Use regex or string parsing instead.
