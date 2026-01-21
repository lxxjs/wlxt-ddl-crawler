#!/usr/bin/env python3
"""
网络学堂 Homework Crawler
Fetches all homework assignments using Selenium (full browser automation).

Usage:
    python main.py              # Fetch homework for current semester
    python main.py --json       # Also generate JSON output
    python main.py --debug      # Save page HTML for debugging
"""
import argparse
import sys
import time
import os
import re
from datetime import datetime

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from bs4 import BeautifulSoup

from src.models import Course, Homework
from src.output import generate_html, generate_json
from src.config import LOGIN_URL, BASE_URL


class WebLearningCrawler:
    """
    Full Selenium-based crawler for 网络学堂.
    Opens browser, lets user login, then scrapes courses and homework.
    """
    
    def __init__(self, debug: bool = False):
        self.driver = None
        self.courses = []
        self.homework_list = []
        self.debug = debug
    
    def _create_driver(self) -> webdriver.Chrome:
        """Create and configure Chrome WebDriver."""
        options = Options()
        # Keep browser open for debugging
        options.add_experimental_option('detach', True)
        # Suppress unnecessary logging
        options.add_experimental_option('excludeSwitches', ['enable-logging'])
        # Disable automation flags
        options.add_argument('--disable-blink-features=AutomationControlled')
        
        driver = webdriver.Chrome(options=options)
        driver.set_window_size(1200, 900)
        return driver
    
    def _save_debug_html(self, name: str):
        """Save current page HTML for debugging."""
        if self.debug and self.driver:
            os.makedirs('debug', exist_ok=True)
            filepath = f'debug/{name}.html'
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(self.driver.page_source)
            print(f"   [DEBUG] Saved page to {filepath}")
    
    def start(self):
        """Start the browser and navigate to login page."""
        print("🔐 Opening browser...")
        self.driver = self._create_driver()
        
        print(f"   Navigating to login page...")
        self.driver.get(LOGIN_URL)
        
        print("\n" + "="*50)
        print("   Please log in to 网络学堂")
        print("   Complete 2FA if required")
        print("   The script will continue automatically after login")
        print("="*50 + "\n")
    
    def wait_for_login(self, timeout: int = 300) -> bool:
        """Wait for user to complete login."""
        try:
            # Wait until we're on the course list page
            WebDriverWait(self.driver, timeout).until(
                lambda d: '/f/wlxt/index/course/student' in d.current_url
                or 'suoxuecourse' in d.page_source
            )
            print("✅ Login successful!")
            time.sleep(2)  # Let page fully load
            
            self._save_debug_html('after_login')
            return True
        except TimeoutException:
            print("❌ Login timeout")
            return False
    
    def fetch_courses_and_homework_urls(self) -> list:
        """
        Parse the landing page to extract courses and their homework URLs.
        The landing page already shows homework links for each course!
        """
        print("📚 Parsing course list and homework links...")
        
        soup = BeautifulSoup(self.driver.page_source, 'html.parser')
        
        # Find the course container
        course_container = soup.find('div', id='suoxuecourse')
        if not course_container:
            print("   ⚠️ Could not find course container")
            return []
        
        # Find all course items
        course_items = course_container.find_all('div', class_='item')
        
        courses = []
        for item in course_items:
            try:
                # Get course title link
                title_link = item.find('a', class_='title')
                if not title_link:
                    continue
                
                course_name = title_link.get_text(strip=True)
                
                # Get wlkcid from hidden input or title link href
                wlkcid_input = item.find('input', class_='wlkcid')
                if wlkcid_input:
                    wlkcid = wlkcid_input.get('value', '')
                else:
                    # Extract from href
                    href = title_link.get('href', '')
                    match = re.search(r'wlkcid=([^&]+)', href)
                    wlkcid = match.group(1) if match else ''
                
                # Get teacher name
                teacher_span = item.find('span', class_='teacherName')
                teacher = teacher_span.get_text(strip=True) if teacher_span else ''
                
                # Find homework link - it's in the course card, containing "作业"
                homework_link = None
                for link in item.find_all('a'):
                    link_text = link.get_text(strip=True)
                    link_href = link.get('href', '')
                    if '作业' in link_text and 'kczy/zy' in link_href:
                        homework_link = link_href
                        break
                
                # Get unsubmitted count
                unsubmitted = 0
                # Look for the homework li and its count
                for li in item.find_all('li'):
                    li_text = li.get_text()
                    if '作业' in li_text and '未提交' in li_text:
                        # Extract number
                        count_a = li.find('a', class_='counte')
                        if count_a:
                            try:
                                unsubmitted = int(count_a.get_text(strip=True))
                            except ValueError:
                                pass
                        break
                
                courses.append({
                    'name': course_name,
                    'wlkcid': wlkcid,
                    'teacher': teacher,
                    'homework_url': homework_link,
                    'unsubmitted': unsubmitted,
                })
                
            except Exception as e:
                if self.debug:
                    print(f"   ⚠️ Error parsing course: {e}")
        
        print(f"   Found {len(courses)} courses")
        for c in courses:
            print(f"      • {c['name']} ({c['unsubmitted']} unsubmitted)")
        
        self.courses = courses
        return courses
    
    def fetch_all_homework(self) -> list:
        """
        Fetch homework from all courses by navigating to each homework URL.
        """
        print("\n📝 Fetching homework details...")
        
        all_homework = []
        
        for i, course in enumerate(self.courses):
            if not course['homework_url']:
                continue
            
            print(f"\n   [{i+1}/{len(self.courses)}] {course['name']}")
            
            # Navigate to homework page
            homework_url = BASE_URL + course['homework_url']
            self.driver.get(homework_url)
            time.sleep(2)
            
            self._save_debug_html(f'homework_{i+1}')
            
            # Scrape homework from this page
            hw_list = self._scrape_homework_page(course['name'])
            all_homework.extend(hw_list)
            print(f"      Found {len(hw_list)} homework items")
        
        # Sort by deadline
        all_homework.sort(
            key=lambda h: (h.deadline is None, h.is_expired, h.deadline or datetime.max)
        )
        
        self.homework_list = all_homework
        print(f"\n✅ Found {len(all_homework)} homework assignments total")
        return all_homework
    
    def _scrape_homework_page(self, course_name: str) -> list:
        """Scrape homework from the current homework page."""
        homework_list = []
        
        # Wait for page to load
        time.sleep(1)
        
        soup = BeautifulSoup(self.driver.page_source, 'html.parser')
        
        # The homework page typically has tabs: "未提交" (unsubmitted), "已完成" (completed)
        # Let's get homework from the table
        
        # Find table rows
        table = soup.find('table', id='wtj')  # wtj = 未提交 (unsubmitted)
        if not table:
            # Try alternative selector
            table = soup.find('table', class_='dataTable')
        
        if not table:
            return []
        
        tbody = table.find('tbody')
        if not tbody:
            return []
        
        rows = tbody.find_all('tr')
        
        for row in rows:
            try:
                cells = row.find_all('td')
                if len(cells) < 5:
                    continue
                
                # Structure: [checkbox], [title], [start time], [deadline], [status/time left], ...
                # Index may vary, let's find title and deadline
                title = ""
                deadline_str = ""
                time_left = ""
                
                for idx, cell in enumerate(cells):
                    cell_text = cell.get_text(strip=True)
                    
                    # Title is usually in a cell with a link
                    if cell.find('a') and not title:
                        title = cell.get_text(strip=True)
                    
                    # Deadline contains date format YYYY-MM-DD
                    if re.match(r'\d{4}-\d{2}-\d{2}', cell_text):
                        if not deadline_str:
                            # First date might be start time, second is deadline
                            deadline_str = cell_text
                        else:
                            # If we already have one, the second is more likely deadline
                            deadline_str = cell_text
                    
                    # Time left / status
                    if '天' in cell_text or '小时' in cell_text or '已过期' in cell_text:
                        time_left = cell_text
                
                if not title:
                    continue
                
                # Parse deadline
                deadline = None
                if deadline_str:
                    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"]:
                        try:
                            deadline = datetime.strptime(deadline_str, fmt)
                            break
                        except ValueError:
                            continue
                
                hw = Homework(
                    id=f"{course_name}_{len(homework_list)}",
                    title=title,
                    course_name=course_name,
                    course_id="",
                    deadline=deadline,
                    deadline_str=deadline_str,
                    status="expired" if time_left == "已过期" else "unsubmitted",
                    time_left=time_left,
                )
                homework_list.append(hw)
                
            except Exception as e:
                if self.debug:
                    print(f"      ⚠️ Error parsing row: {e}")
        
        return homework_list
    
    def close(self):
        """Close all browser windows."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None


def main():
    parser = argparse.ArgumentParser(
        description='Fetch homework from 网络学堂 (Web Learning)'
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='Also generate JSON output'
    )
    parser.add_argument(
        '--no-close',
        action='store_true',
        help='Keep browser open after completion'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Save page HTML for debugging'
    )
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("    网络学堂 Homework Crawler")
    print("=" * 50)
    print()
    
    crawler = WebLearningCrawler(debug=args.debug)
    
    try:
        # Step 1: Start browser and show login page
        crawler.start()
        
        # Step 2: Wait for user to login
        if not crawler.wait_for_login():
            print("❌ Please restart and try again")
            return 1
        
        # Step 3: Parse courses and homework URLs from landing page
        crawler.fetch_courses_and_homework_urls()
        
        if not crawler.courses:
            print("\n⚠️ No courses found!")
            if not args.no_close:
                crawler.close()
            return 1
        
        # Step 4: Fetch homework from each course
        homework_list = crawler.fetch_all_homework()
        
        if not homework_list:
            print("\n⚠️ No homework found!")
        else:
            # Step 5: Generate output
            print("\n📊 Generating reports...")
            html_path = generate_html(homework_list)
            
            if args.json:
                generate_json(homework_list)
            
            print("\n" + "=" * 50)
            print("✅ Done!")
            print(f"   Open {html_path} in your browser to view homework.")
            print("=" * 50)
        
        # Close browser unless --no-close specified
        if not args.no_close:
            print("\n🔒 Closing browser...")
            crawler.close()
        
        return 0
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Cancelled by user")
        if not args.no_close:
            crawler.close()
        return 1
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())
