"""
Output generation module for homework reports.
Generates HTML and JSON output files.
"""
import html
import json
import os
from datetime import datetime
from typing import List

from .config import OUTPUT_DIR, HTML_OUTPUT_FILE, JSON_OUTPUT_FILE
from .models import Homework


def ensure_output_dir():
    """Create output directory if it doesn't exist."""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)


def generate_html(homework_list: List[Homework], output_path: str = None) -> str:
    """
    Generate an HTML report of homework assignments.
    
    Args:
        homework_list: List of Homework objects
        output_path: Optional custom output path
    
    Returns:
        Path to the generated HTML file
    """
    ensure_output_dir()
    
    if output_path is None:
        output_path = os.path.join(OUTPUT_DIR, HTML_OUTPUT_FILE)
    
    # Separate active and expired homework
    active = [h for h in homework_list if not h.is_expired]
    expired = [h for h in homework_list if h.is_expired]
    
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>网络学堂作业列表</title>
    <style>
        :root {{
            --bg-primary: #0f0f1a;
            --bg-secondary: #1a1a2e;
            --bg-card: #252542;
            --text-primary: #e0e0ff;
            --text-secondary: #a0a0c0;
            --accent-urgent: #ff4757;
            --accent-warning: #ffa502;
            --accent-normal: #2ed573;
            --accent-info: #70a1ff;
            --gradient-1: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            --shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
        }}
        
        .container {{
            max-width: 1000px;
            margin: 0 auto;
        }}
        
        header {{
            text-align: center;
            margin-bottom: 3rem;
        }}
        
        h1 {{
            font-size: 2.5rem;
            background: var(--gradient-1);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 0.5rem;
        }}
        
        .subtitle {{
            color: var(--text-secondary);
            font-size: 0.95rem;
        }}
        
        .stats {{
            display: flex;
            gap: 1rem;
            justify-content: center;
            margin-top: 1.5rem;
        }}
        
        .stat-card {{
            background: var(--bg-secondary);
            padding: 1rem 1.5rem;
            border-radius: 12px;
            text-align: center;
        }}
        
        .stat-number {{
            font-size: 2rem;
            font-weight: 700;
        }}
        
        .stat-label {{
            font-size: 0.8rem;
            color: var(--text-secondary);
            text-transform: uppercase;
        }}
        
        .stat-urgent .stat-number {{ color: var(--accent-urgent); }}
        .stat-active .stat-number {{ color: var(--accent-normal); }}
        .stat-expired .stat-number {{ color: var(--text-secondary); }}
        
        section {{
            margin-bottom: 2rem;
        }}
        
        h2 {{
            font-size: 1.3rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--bg-card);
        }}
        
        .homework-list {{
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }}
        
        .homework-card {{
            background: var(--bg-card);
            border-radius: 16px;
            padding: 1.5rem;
            transition: transform 0.2s, box-shadow 0.2s;
            border-left: 4px solid var(--accent-info);
        }}
        
        .homework-card:hover {{
            transform: translateY(-2px);
            box-shadow: var(--shadow);
        }}
        
        .homework-card.urgent {{
            border-left-color: var(--accent-urgent);
            animation: pulse 2s infinite;
        }}
        
        .homework-card.warning {{
            border-left-color: var(--accent-warning);
        }}
        
        .homework-card.expired {{
            border-left-color: var(--text-secondary);
            opacity: 0.6;
        }}
        
        @keyframes pulse {{
            0%, 100% {{ box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.4); }}
            50% {{ box-shadow: 0 0 20px 5px rgba(255, 71, 87, 0.2); }}
        }}
        
        .homework-header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 0.8rem;
        }}
        
        .homework-title {{
            font-size: 1.1rem;
            font-weight: 600;
        }}
        
        .homework-deadline {{
            font-size: 0.85rem;
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            background: var(--bg-secondary);
        }}
        
        .homework-deadline.urgent {{
            background: var(--accent-urgent);
            color: white;
        }}
        
        .homework-deadline.warning {{
            background: var(--accent-warning);
            color: #1a1a2e;
        }}
        
        .homework-course {{
            color: var(--text-secondary);
            font-size: 0.9rem;
        }}
        
        .time-left {{
            font-weight: 500;
            margin-left: 0.5rem;
        }}
        
        .empty-state {{
            text-align: center;
            padding: 3rem;
            color: var(--text-secondary);
        }}
        
        footer {{
            text-align: center;
            margin-top: 3rem;
            color: var(--text-secondary);
            font-size: 0.85rem;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>📚 网络学堂作业</h1>
            <p class="subtitle">生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            
            <div class="stats">
                <div class="stat-card stat-urgent">
                    <div class="stat-number">{len([h for h in active if h.urgency_level == 1])}</div>
                    <div class="stat-label">紧急 (24h内)</div>
                </div>
                <div class="stat-card stat-active">
                    <div class="stat-number">{len(active)}</div>
                    <div class="stat-label">待完成</div>
                </div>
                <div class="stat-card stat-expired">
                    <div class="stat-number">{len(expired)}</div>
                    <div class="stat-label">已过期</div>
                </div>
            </div>
        </header>
        
        <main>
            <section>
                <h2>📝 待完成作业</h2>
                <div class="homework-list">
                    {_generate_homework_cards(active) if active else '<div class="empty-state">🎉 没有待完成的作业!</div>'}
                </div>
            </section>
            
            {f'''<section>
                <h2>⏰ 已过期作业</h2>
                <div class="homework-list">
                    {_generate_homework_cards(expired, expired=True)}
                </div>
            </section>''' if expired else ''}
        </main>
        
        <footer>
            <p>网络学堂作业爬虫 | 数据来自 learn.tsinghua.edu.cn</p>
        </footer>
    </div>
</body>
</html>"""
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"📄 HTML report saved to: {output_path}")
    return output_path


def _generate_homework_cards(homework_list: List[Homework], expired: bool = False) -> str:
    """Generate HTML cards for homework items."""
    cards = []
    
    for hw in homework_list:
        # Determine urgency class
        if expired:
            urgency_class = "expired"
            deadline_class = ""
        elif hw.urgency_level == 1:
            urgency_class = "urgent"
            deadline_class = "urgent"
        elif hw.urgency_level == 2:
            urgency_class = "warning"
            deadline_class = "warning"
        else:
            urgency_class = ""
            deadline_class = ""
        
        time_display = f'<span class="time-left">({html.escape(hw.time_left)})</span>' if hw.time_left else ''
        
        card = f'''
        <div class="homework-card {urgency_class}">
            <div class="homework-header">
                <span class="homework-title">{html.escape(hw.title)}</span>
                <span class="homework-deadline {deadline_class}">
                    {html.escape(hw.deadline_str)} {time_display}
                </span>
            </div>
            <div class="homework-course">{html.escape(hw.course_name)}</div>
        </div>'''
        cards.append(card)
    
    return '\n'.join(cards)


def generate_json(homework_list: List[Homework], output_path: str = None) -> str:
    """
    Generate a JSON file of homework assignments.
    
    Args:
        homework_list: List of Homework objects
        output_path: Optional custom output path
    
    Returns:
        Path to the generated JSON file
    """
    ensure_output_dir()
    
    if output_path is None:
        output_path = os.path.join(OUTPUT_DIR, JSON_OUTPUT_FILE)
    
    data = {
        'generated_at': datetime.now().isoformat(),
        'total_count': len(homework_list),
        'homework': [
            {
                'id': hw.id,
                'title': hw.title,
                'course_name': hw.course_name,
                'deadline': hw.deadline_str,
                'status': hw.status,
                'time_left': hw.time_left,
                'is_expired': hw.is_expired,
            }
            for hw in homework_list
        ]
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"📄 JSON data saved to: {output_path}")
    return output_path
