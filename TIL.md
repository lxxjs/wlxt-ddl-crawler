# 20230211 SAT
- login 후 랜딩 페이지로 넘어가는 데 어떤 Header와 Cookie들을 넘겨줘야 하는지, 어떻게 찾고 어떤 방식으로 어디로 넘겨줘야 하는지 모르겠어서 열심히 찾아봤다. 
- Genaral : 요청과 응답 모두에 적용
- Request Header : 내가 요청하는데 보내야할 헤더
- Response Header : 응답 받은 메세지의 헤더
- 그 중 Request Header에 포함되는 항목들에 관한 설명에서 'Referer : 바로 직전에 머물었던 웹 링크 주소'라는 것을 알게 됐다. 이걸 알았으면 어디로 get/post 요청을 보내야 할지 쉽게 알았을텐데 ...
- 진작 헤더들에 관해 공부했다면 필요한 헤더들을 보내 정상적인 응답을 받았을 것이다
- 또 cURL command 변환기라는 좋은 도구를 발견함 'https://curl.trillworks.com/' cURL command를 집어넣으면 적절한 요청을 보내는 코드로 변환해줌 

# 20230214 TUE
- CSRF
- Request initiator chain