from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import time
import codecs
#from fake_useragent import UserAgent

options = Options()
options.binary_location = r"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
#options.add_argument('headless')
options.add_argument('window-size=1920x1080')  # 브라우저 사이즈 결정
options.add_argument("disable-gpu")

login_url = 'https://learn.tsinghua.edu.cn/f/login'

path = r"C:\Users\james\Desktop\chromedriver_win32\chromedriver.exe"
driver = webdriver.Chrome(executable_path = path, chrome_options = options)
driver.get(login_url)

time.sleep(1)

yourID = '2020080172' #change to 'input'
yourPW = 'James4976!!'

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

time.sleep(1)

for i in range(1, c_count + 1):
    next_tab = driver.window_handles[i]
    driver.switch_to.window(window_name = next_tab)
    html = driver.page_source
    soup = BeautifulSoup(html, 'html.parser')
    zy_table = list() # ???????잘모르겄다이
    while (soup.select('a.btn.reviewBtn')):
        zy_table.append(soup.select_one('#wtj tr'))
    print(zy_table)
    time.sleep(2)

# //*[@id="wtj"]/tbody/tr[1]/td[2]/a zuoyetimu

time.sleep(3)

driver.close()
