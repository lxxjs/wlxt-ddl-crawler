import requests

from bs4 import BeautifulSoup as bs
import time
import codecs
from pprint import pprint
from time import strftime

LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/post/bb5df85216504820be7bba2b0ae1535b/0?/login.do'


LOGIN_INFO = {
    'i_user' : '2020080172',
    'i_pass' : 'James4976!!'
    }

with requests.Session() as s:
    req = s.post(LOGIN_URL, data=LOGIN_INFO)
    time.sleep(1)
    
    html = req.text
    header = req.headers
    status = req.status_code
    is_ok = req.ok
    print("login status :", status)
    print("header :", header)
    print(html)
    redirect_cookie = req.headers['Set-Cookie']
    print("cookie :", redirect_cookie)
    redirect_url = 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/'
    headers = {
        'cookie' : redirect_cookie,
        'referer' : 'https://learn.tsinghua.edu.cn/f/login.do?status=SUCCESS&ticket=pm8EKA0Hpw2n01HMYH3PWQSHGUPXBTDZLWXZ',
        'user-agent' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36'
    }
    #res = s.get(redirect_url)

    #print(res.status_code)
    #print(res.text)
