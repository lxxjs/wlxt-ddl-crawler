import requests
from bs4 import BeautifulSoup as bs
import time
import codecs
from pprint import pprint
from time import strftime
import urllib3
from urllib3.util.ssl_ import create_urllib3_context

ctx = create_urllib3_context()
ctx.load_default_certs()
ctx.options |= 0x4  # ssl.OP_LEGACY_SERVER_CONNECT


LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/post/bb5df85216504820be7bba2b0ae1535b/0?/login.do'
# LOGIN_URL = "https://learn.tsinghua.edu.cn/f/login"
REDIRECT_URL = 'https://learn.tsinghua.edu.cn/f/loginAccountSave'
LANDING_URL = 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/'
COURSE_LIST_URL = "https://learn.tsinghua.edu.cn/b/wlxt/common/auth/gnt?_csrf=07372d0a-5cc5-4b2c-bd2c-ed987a31bf69"

TEST_URL = 'https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket='

with open("./account.key") as f:
    lines = f.readlines()
    username = lines[0].strip()
    password = lines[1].strip()
    f.close()


# Simulate the submission of the login form
session = requests.Session()

LOGIN_INFO = {
    'i_user' : username,
    'i_pass' : password,
    'atOnce' : True,
}

# session.post(LOGIN_URL, data=LOGIN_INFO)

# # Use the session object to send subsequent requests to the website
# response = session.get('https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/')

with urllib3.PoolManager(ssl_context=ctx) as http:
    resp = http.request(
    "POST",
    LOGIN_URL,
    fields=LOGIN_INFO
    )

    soup = bs(resp._body, 'html.parser')
    #print(soup)
    url_with_ticket = soup.find('a')['href'] # find 'href' attribute from html 'a' tag
    print(url_with_ticket)
    TICKET = url_with_ticket.split('=')[2]
    TEST_URL = TEST_URL + TICKET
    redirect_page = http.request("GET", TEST_URL)
    soup = bs(redirect_page._body, 'html.parser')
    ans = soup.find('div', {'id' : 'suoxuecourse'})
    print(ans)
    landing_page = http.request("GET", LANDING_URL)
    soup = bs(landing_page._body, 'html.parser')
    ans = soup.find('div', {'id' : 'suoxuecourse'})
    print(ans)

# with requests.Session() as s:
#     login_page = s.post(LOGIN_URL, data=LOGIN_INFO)
#     time.sleep(1)

#     # find ticket value
#     soup = bs(login_page.text, 'html.parser')
#     print(soup)
#     url_with_ticket = soup.find('a')['href'] # find 'href' attribute from html 'a' tag
#     print(url_with_ticket)
    # TICKET = url_with_ticket.split('=')[2]
    # TEST_URL = TEST_URL + TICKET
    # print(TEST_URL)
    # redirect_page = s.get(TEST_URL)
    # soup = bs(redirect_page.text, 'html.parser')
    # ans = soup.find('div', {'id' : 'suoxuecourse'})
    # print(ans)
    # landing_page = s.get(LANDING_URL)
    # soup = bs(landing_page.text, 'html.parser')
    # ans = soup.find('div', {'id' : 'suoxuecourse'})
    # print(ans)
    #여기까지만 써도 된다 .... 거의다왔따


    # get cookies in dic form
    # cookies_str = redirect_page.headers['set-cookie']
    # print(cookies_str)
    # strings = cookies_str.split()
    # JSESSIONID = strings[6][11:-1]
    # serverid = strings[9][9:-1]
    # XSRF_TOKEN = strings[0][11:-1]
    # cookies = {
    #     'JSESSIONID' : JSESSIONID,
    #     'serverid' : serverid,
    #     'XSRF-TOKEN' : XSRF_TOKEN,
    # }
    # print(cookies)
    # headers = {
    #     'authority': 'learn.tsinghua.edu.cn',
    #     'accept': '*/*',
    #     'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    #     'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    #     # 'cookie': 'serverid=1425456; !Proxy!PHPSESSID=chskfro3cvfg6lln0de1nhd2e1; JSESSIONID=AA4CF879511EC88EA93A65A818B71120.wlxt20181; XSRF-TOKEN=2f56659d-a17d-4f1d-a68e-f540dad16b70',
    #     'origin': 'https://learn.tsinghua.edu.cn',
    #     'referer': 'https://learn.tsinghua.edu.cn/f/login',
    #     'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
    #     'sec-ch-ua-mobile': '?0',
    #     'sec-ch-ua-platform': '"Windows"',
    #     'sec-fetch-dest': 'empty',
    #     'sec-fetch-mode': 'cors',
    #     'sec-fetch-site': 'same-origin',
    #     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    #     'x-requested-with': 'XMLHttpRequest',
    # }

    # headers = {
    #     'authority': 'learn.tsinghua.edu.cn',
    #     'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    #     'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    #     # 'cookie': 'serverid=1425456; !Proxy!PHPSESSID=chskfro3cvfg6lln0de1nhd2e1; JSESSIONID=AA4CF879511EC88EA93A65A818B71120.wlxt20181; XSRF-TOKEN=2f56659d-a17d-4f1d-a68e-f540dad16b70',
    #     'referer': 'https://learn.tsinghua.edu.cn/f/login.do?status=SUCCESS&ticket=pm8EKA0Hpw2n01UQRSLY2PE3W5GJBA6NDY4J',
    #     'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
    #     'sec-ch-ua-mobile': '?0',
    #     'sec-ch-ua-platform': '"Windows"',
    #     'sec-fetch-dest': 'document',
    #     'sec-fetch-mode': 'navigate',
    #     'sec-fetch-site': 'same-origin',
    #     'upgrade-insecure-requests': '1',
    #     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    # }

    # landing_page = s.get(LANDING_URL, cookies=cookies, headers=headers)
    # #landing_page = s.get(LANDING_URL)
    # #print(landing_page.text)