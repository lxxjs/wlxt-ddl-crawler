"""
Authentication module using Selenium for browser-based login.
Handles 2FA by letting user log in manually, then extracts session cookies.
"""
import time
from typing import Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
import requests

from .config import LOGIN_URL, LOGIN_SUCCESS_INDICATOR, BROWSER_WAIT_TIMEOUT, BASE_URL


class WebLearningAuth:
    """
    Handles authentication to 网络学堂 using Selenium.
    Opens a browser for user to complete login (including 2FA),
    then extracts session cookies for API requests.
    """
    
    def __init__(self):
        self.driver: Optional[webdriver.Chrome] = None
        self.session: Optional[requests.Session] = None
        self.cookies: dict = {}
        self.csrf_token: str = ""
    
    def _create_driver(self) -> webdriver.Chrome:
        """Create and configure Chrome WebDriver."""
        options = Options()
        # Keep browser open after script completes for debugging
        options.add_experimental_option('detach', False)
        # Suppress unnecessary logging
        options.add_experimental_option('excludeSwitches', ['enable-logging'])
        # Disable automation flags to appear more like regular browser
        options.add_argument('--disable-blink-features=AutomationControlled')
        
        driver = webdriver.Chrome(options=options)
        driver.set_window_size(1200, 800)
        return driver
    
    def login(self) -> requests.Session:
        """
        Open browser for user to log in, wait for success, extract cookies.
        
        Returns:
            requests.Session with authentication cookies set
        """
        print("🔐 Opening browser for login...")
        print("   Please log in to 网络学堂 (including 2FA if required)")
        print(f"   Waiting up to {BROWSER_WAIT_TIMEOUT} seconds...")
        
        self.driver = self._create_driver()
        self.driver.get(LOGIN_URL)
        
        # Wait for user to complete login
        # Login is successful when redirected to course page
        try:
            WebDriverWait(self.driver, BROWSER_WAIT_TIMEOUT).until(
                lambda d: LOGIN_SUCCESS_INDICATOR in d.current_url
            )
            print("✅ Login successful!")
        except Exception as e:
            print("❌ Login timeout or failed")
            self.close()
            raise RuntimeError("Login failed - please try again") from e
        
        # Give page time to fully load and set all cookies
        time.sleep(3)
        
        # Navigate to ensure we get all cookies for the learning domain
        self.driver.get(f"{BASE_URL}/f/wlxt/index/course/student/")
        time.sleep(2)
        
        # Extract cookies from browser
        self._extract_cookies()
        
        # Create requests session with extracted cookies
        self.session = self._create_session()
        
        # Close browser - we have what we need
        self.close()
        
        return self.session
    
    def _extract_cookies(self):
        """Extract all cookies from browser session."""
        if not self.driver:
            return
        
        browser_cookies = self.driver.get_cookies()
        self.cookies = {}
        
        for cookie in browser_cookies:
            name = cookie['name']
            value = cookie['value']
            self.cookies[name] = value
            
            # Extract CSRF token
            if name == 'XSRF-TOKEN':
                self.csrf_token = value
                print(f"   Found CSRF token: {value[:20]}...")
        
        print(f"   Extracted {len(self.cookies)} cookies")
        
        if not self.csrf_token:
            print("   ⚠️ Warning: XSRF-TOKEN not found in cookies")
    
    def _create_session(self) -> requests.Session:
        """Create a requests Session with extracted cookies and CSRF header."""
        session = requests.Session()
        
        # Set all cookies with proper domain
        for name, value in self.cookies.items():
            # Some cookies need the exact domain
            if 'JSESSIONID' in name or 'XSRF' in name or 'serverid' in name:
                session.cookies.set(name, value, domain='learn.tsinghua.edu.cn')
            else:
                session.cookies.set(name, value, domain='.tsinghua.edu.cn')
        
        # Set headers to mimic browser - CSRF token is critical!
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Origin': BASE_URL,
            'Referer': f'{BASE_URL}/f/wlxt/index/course/student/',
            'X-Requested-With': 'XMLHttpRequest',
        }
        
        # Add CSRF token header - this is the key!
        if self.csrf_token:
            headers['X-CSRF-Token'] = self.csrf_token
            headers['X-XSRF-TOKEN'] = self.csrf_token
        
        session.headers.update(headers)
        
        return session
    
    def close(self):
        """Close the browser if open."""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
