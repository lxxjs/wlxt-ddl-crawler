import requests

from bs4 import BeautifulSoup as bs
import time
import codecs
from pprint import pprint
from time import strftime

LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/post/bb5df85216504820be7bba2b0ae1535b/0?/login.do'
REDIRECT_URL = 'https://learn.tsinghua.edu.cn/f/loginAccountSave?_csrf=ab951a27-9f96-44ba-875f-d1f5cc39a164'
LANDING_URL = 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/'


LOGIN_INFO = {
    'i_user' : '***********',
    'i_pass' : '***********'
    }
loginAccount = '***********'

with requests.Session() as s:
    req = s.post(LOGIN_URL, data=LOGIN_INFO)
    time.sleep(1)

    print(req.text) #여기 TICKET 있음
    
    res = s.post(REDIRECT_URL, data=loginAccount)

    cookies_str = res.headers['set-cookie']
    strings = cookies_str.split()
    JSESSIONID = strings[6][11:-1]
    serverid = strings[9][9:-1]
    XSRF_TOKEN = strings[0][11:-1]

    cookies = {
        'JSESSIONID' : JSESSIONID,
        'serverid' : serverid,
        'XSRF-TOKEN' : XSRF_TOKEN,
    }
    print(cookies)
    headers = {
        'authority': 'learn.tsinghua.edu.cn',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.101 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-ch-ua': '"Chromium";v="91", " Not;A Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'referer': 'https://learn.tsinghua.edu.cn/f/login.do?status=SUCCESS&ticket=pm8EKA0Hpw2n01C68NGBJAH9WSB7L8Z5CYHC',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    }

    response = requests.get(LANDING_URL, cookies=cookies, headers=headers)
    print(response.text)
