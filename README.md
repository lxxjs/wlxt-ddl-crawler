# 网络学堂 Homework Crawler

A Python crawler that fetches all homework deadlines from Tsinghua University's Web Learning platform (`learn.tsinghua.edu.cn`).

## ✨ Features

- **Browser-based login** - Supports 2FA authentication
- **Auto-fetch homework** - Gets all assignments from enrolled courses
- **Beautiful HTML report** - Dark theme with urgency indicators
- **Deadline tracking** - Sorted by due date with time remaining

## 🚀 Quick Start

### 1. Set up virtual environment

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the crawler

```bash
python main.py
```

A Chrome browser will open. Log in to 网络学堂 (complete 2FA if required). Once logged in, the crawler will automatically:
1. Extract your session
2. Fetch all courses
3. Fetch homework from each course
4. Generate `output/homework.html`

### 3. View your homework

Open `output/homework.html` in your browser!

## 📸 Output

The generated HTML report includes:
- 📊 Statistics dashboard (urgent, active, expired counts)
- 🔴 Urgent homework (due within 24h) with pulsing animation
- 🟠 Warning homework (due within 3 days)
- 🟢 Normal homework
- ⚫ Expired homework

## 🔧 Options

```bash
# Specify semester
python main.py --semester 2024-2025-1

# Also generate JSON output
python main.py --json
```

## 📁 Project Structure

```
wlxt-ddl-crawler/
├── main.py              # Entry point
├── requirements.txt     # Dependencies
├── src/
│   ├── auth.py         # Selenium-based authentication
│   ├── config.py       # URLs and constants
│   ├── crawler.py      # Course & homework fetching
│   ├── models.py       # Data models
│   └── output.py       # HTML/JSON generation
└── output/
    └── homework.html   # Generated report
```

## ⚠️ Notes

- Chrome browser is required (auto-managed by Selenium)
- Login session is NOT stored - you log in fresh each time
- Your credentials are never stored by this tool
