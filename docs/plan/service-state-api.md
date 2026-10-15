# Chalk 학급 상태 조회의 Service API 전환

이 변경은 Service 분리 칸반 [#5](https://github.com/hypeproof/hypeproof-service/issues/5)의 상태 조회 부분입니다. board·로그 조회와 Chalk의 공통 서명 비밀·저장소 binding 제거는 아직 남아 있습니다. Worker 런타임은 현재 Studio 레포에 있으며, 이 변경만으로 새 Service 레포로 이전되지는 않습니다.

## 요청과 응답

브라우저는 기존 `GET /admin/cohorts/:id/state`를 Chalk에 요청합니다. Chalk는 요청당 한 번 `GET /admin/chalk/cohorts/:id/state`를 Service에 호출합니다. 전달하는 헤더는 issuer Bearer와 요청 ID뿐입니다. Access 사용자 헤더·operator 비밀·쿠키를 전달하지 않습니다. 리디렉션은 거부하고 8초 제한을 둡니다.

Service가 기존 issuer 검증·학급 범위 확인·토큰 폐기 확인을 수행한 후 KV 상태와 프로필을 읽습니다. Basic 인증이나 Access 사용자 헤더만으로 이 읽기 권한을 얻을 수 없습니다. 응답의 `id`, `now`, `session`, `roster_size`, `paused`, `profiles`, `templates`, `scope`와 기존 필터링·기본값을 유지합니다. roster의 이름과 프로필 prompt는 응답하지 않습니다.

Chalk는 Service의 HTTP 상태와 응답을 보존합니다. 전송 실패·제한 시간 초과는 502로 표시하며 빈 학급이나 학생 수 0을 만들어내지 않습니다. 응답은 `no-store`이며 Chalk 요청 ID와 Service 응답 요청 ID를 함께 제공합니다.

## 검증과 적용 순서

기존 Chalk 응답 형식·프로필 필터·권한 대조 테스트는 실제 Service 라우터를 통과하도록 바꿨습니다. 테스트에서는 HTTP 전송만 대체합니다. 새 테스트는 Service의 범위·폐기·학생 토큰 거부와 Chalk의 헤더 제한·한 번의 호출·전송 실패를 확인합니다.

적용할 때는 새 상태 API를 포함한 Service 버전을 먼저 staging에 배포하고, 그 API를 사용하는 Chalk를 뒤에 배포해야 합니다. API가 없는 Service로 Chalk만 배포하면 기존 상태 조회를 사용할 수 없습니다. 운영 배포와 실제 staging 확인은 이 구현에서 수행하지 않았습니다. 되돌릴 때는 Chalk를 기존 읽기 버전으로 먼저 되돌릴 수 있습니다. 저장소나 토큰 데이터를 이동하는 변경은 없습니다.
