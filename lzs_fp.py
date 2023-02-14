from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import chromedriver_autoinstaller

chromedriver_autoinstaller.install()

from bs4 import BeautifulSoup
import time
import codecs
from pprint import pprint
from time import strftime


login_url = 'https://learn.tsinghua.edu.cn/f/login'

options = webdriver.ChromeOptions()
options.add_experimental_option('detach', True) #브라우저 바로 닫힘 방지
options.add_experimental_option('excludeSwitches', ['enable-logging']) #불필요한 메시지 제거

path = r"C:\Users\james\Desktop\chromedriver_win32\chromedriver.exe"

# driver = webdriver.Chrome(executable_path = path, options = options)
#cd = ChromeDriverManager(path="DRIVER",).install()
#service = Service(cd)
#print(cd)
#driver = webdriver.Chrome(service = service, options = options)

driver = webdriver.Chrome()


driver.get(login_url)

time.sleep(1)

yourID = '***********'
yourPW = '***********'

driver.find_element(by = By.XPATH, value = '//*[@name="i_user"]').send_keys(yourID)
driver.find_element(by = By.XPATH, value = '//*[@name="i_pass"]').send_keys(yourPW)
driver.find_element(by = By.XPATH, value = '//*[@id="loginButtonId"]').click()

time.sleep(3)

html = driver.page_source
soup = BeautifulSoup(html, 'html.parser')

c_list = soup.select('a.title.stu')
c_count = len(c_list)
print(c_list)
c_names = list()
for i in range(c_count):
    c_names.append(c_list[i].text)

print(c_names)

time.sleep(3)

for i in range(1, c_count + 1):
    driver.find_element(by = By.XPATH, value = f'//*[@id="suoxuecourse"]/dd[{i}]/div[2]/div[2]/ul/li[4]/a').click()

time.sleep(3)

tm = time.localtime()
now_time = strftime('%Y-%m-%d %I:%M', tm)

for i in range(1, c_count + 1):
    next_tab = driver.window_handles[i]
    driver.switch_to.window(window_name = next_tab)
    txt = driver.find_element(by = By.XPATH, value = '//*[@id="wtj_info"]').text
    newtxt = ''.join((ch if ch in '0123456789.-e' else ' ') for ch in txt)
    zy_counts = [int(s) for s in newtxt.split() if s.isdigit()]
    if bool(zy_counts):
        zy_count = zy_counts[0]
    else:
        continue
    zy_list = list()
    for i in range(1, zy_count + 1):    
        zy_name = driver.find_element(by = By.XPATH, value = f'//*[@id="wtj"]/tbody/tr[{i}]/td[2]').text
        zy_ddl = driver.find_element(by = By.XPATH, value = f'//*[@id="wtj"]/tbody/tr[{i}]/td[5]').text
        zy_timeleft = driver.find_element(by = By.XPATH, value = f'//*[@id="wtj"]/tbody/tr[{i}]/td[7]').text
        pprint(zy_timeleft)
        if (zy_timeleft == '已过期'):
            break
        zy_list.append(zy_name)
    pprint(zy_list)
    time.sleep(2)

time.sleep(3)

driver.close()
