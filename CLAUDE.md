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

There are **two separate approaches** in the codebase — only `main.py`'s approach is currently active:

### Active approach (`main.py`)
Full Selenium browser automation. `WebLearningCrawler` navigates the browser through the entire flow:
1. Opens login page, waits for user to authenticate
2. Parses the landing page HTML with BeautifulSoup to extract courses and their homework URLs
3. Navigates to each course's homework page and scrapes the table (`<table id="wtj">`)
4. Passes results to `src/output.py` for HTML/JSON generation

### Dormant approach (`src/auth.py` + `src/crawler.py`)
Hybrid approach: Selenium only for login/cookie extraction, then switches to a `requests.Session` for all subsequent API calls. `WebLearningAuth` extracts cookies (especially `XSRF-TOKEN`) and constructs a session with appropriate headers. `HomeworkCrawler` then calls the JSON APIs directly. This approach is **not wired into main.py**.

### `src/` module breakdown
- `config.py` — All URLs and constants (API endpoints, timeouts, output paths)
- `models.py` — `Course` and `Homework` dataclasses; `Homework` has computed properties `is_expired` and `urgency_level` (0=expired, 1=<24h, 2=<3d, 3=<7d, 4=later, 5=no deadline)
- `output.py` — `generate_html()` and `generate_json()` write to `output/`; HTML is self-contained with inline CSS (dark theme, urgency-based color coding)

## Key API Endpoints (from `src/config.py`)

- Semester list: `GET /b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadSemesterIdList`
- Course list: `POST /b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId`
- Unsubmitted homework: `POST /b/wlxt/kczy/zy/student/index/zyListWj`

Authentication requires `XSRF-TOKEN` cookie + `X-XSRF-TOKEN` / `X-CSRF-Token` headers. The `Referer` header is also critical for requests to succeed.

## Notes

- The `legacy/` directory contains old experimental scripts; ignore them.
- `src/crawler.py` uses `HOMEWORK_SUBMITTED_URL` in config but `HomeworkCrawler.get_homework()` only fetches unsubmitted homework — submitted homework fetching is stubbed out.
- The README mentions a `--semester` flag that does not exist in the current `main.py`; it only exists in the dormant `HomeworkCrawler`.
