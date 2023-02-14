import requests

from bs4 import BeautifulSoup as bs
import time
import codecs
from pprint import pprint
from time import strftime

LOGIN_URL = 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/post/bb5df85216504820be7bba2b0ae1535b/0?/login.do'
REDIRECT_URL = 'https://learn.tsinghua.edu.cn/f/loginAccountSave'
LANDING_URL = 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/'


LOGIN_INFO = {
    'i_user' : '***********',
    'i_pass' : '***********',
    'atOnce' : True,
}
loginAccount = '***********'

with requests.Session() as s:
    login_page = s.post(LOGIN_URL, data=LOGIN_INFO)
    time.sleep(1)

    # find ticket value
    soup = bs(login_page.text, 'html.parser')
    url_with_ticket = soup.find('a')
    referer_to_landing_page = url_with_ticket['href']
    print(referer_to_landing_page)

    redirect_page = s.get(referer_to_landing_page)

    # get cookies in dic form
    cookies_str = redirect_page.headers['set-cookie']
    print(cookies_str)
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
        'accept': '*/*',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        # 'cookie': 'serverid=1425456; !Proxy!PHPSESSID=chskfro3cvfg6lln0de1nhd2e1; JSESSIONID=AA4CF879511EC88EA93A65A818B71120.wlxt20181; XSRF-TOKEN=2f56659d-a17d-4f1d-a68e-f540dad16b70',
        'origin': 'https://learn.tsinghua.edu.cn',
        'referer': 'https://learn.tsinghua.edu.cn/f/login',
        'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest',
    }
    

    headers = {
        'authority': 'learn.tsinghua.edu.cn',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        # 'cookie': 'serverid=1425456; !Proxy!PHPSESSID=chskfro3cvfg6lln0de1nhd2e1; JSESSIONID=AA4CF879511EC88EA93A65A818B71120.wlxt20181; XSRF-TOKEN=2f56659d-a17d-4f1d-a68e-f540dad16b70',
        'referer': 'https://learn.tsinghua.edu.cn/f/login.do?status=SUCCESS&ticket=pm8EKA0Hpw2n01UQRSLY2PE3W5GJBA6NDY4J',
        'sec-ch-ua': '"Not_A Brand";v="99", "Google Chrome";v="109", "Chromium";v="109"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    }

    landing_page = s.get(LANDING_URL, cookies=cookies, headers=headers)
    #landing_page = s.get(LANDING_URL)
    print(landing_page.text)