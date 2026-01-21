"""
Configuration constants for the 网络学堂 homework crawler.
"""

# URLs
# The ID auth page handles 2FA login
LOGIN_URL = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0"
BASE_URL = "https://learn.tsinghua.edu.cn"

# API Endpoints
API_PREFIX = f"{BASE_URL}/b"
SEMESTER_LIST_URL = f"{API_PREFIX}/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadSemesterIdList"
COURSE_LIST_URL = f"{API_PREFIX}/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId"
HOMEWORK_LIST_URL = f"{API_PREFIX}/wlxt/kczy/zy/student/index/zyListWj"  # Unsubmitted homework
HOMEWORK_SUBMITTED_URL = f"{API_PREFIX}/wlxt/kczy/zy/student/index/zyListYjwg"  # Submitted homework

# Browser settings
BROWSER_WAIT_TIMEOUT = 300  # seconds to wait for user login
LOGIN_SUCCESS_INDICATOR = "/f/wlxt/index/course/student"

# Output settings
OUTPUT_DIR = "output"
HTML_OUTPUT_FILE = "homework.html"
JSON_OUTPUT_FILE = "homework.json"
