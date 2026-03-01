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
