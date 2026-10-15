# Worker 분리 후 로컬 Dev 앱 수동 테스트

2026-10-10 · 이 Mac에서 준비한 실행 환경. 자동 분리 검증과 사용자의 수동 결과는 별도로 기록한다.

## 준비 상태

- 공개 Mac arm64 shell `v0.1.56` 다운로드 및 GitHub asset SHA-256 일치 확인.
- 현재 체크아웃 extension·webview로 격리된 `HypeProof Studio Dev.app` 준비, codesign 검증 통과.
- `/Users/ryan/.local/bin/claude`의 Claude 구독 로그인 확인.
- 공개 Service testkit 기반 로컬 Service 실행 및 `/v1/health`, 참여 토큰의 `/v1/profile` HTTP 200 확인.
- 사용자 요청으로 Dev 앱 프로세스를 실제 실행했고, 사용자가 앱을 닫은 뒤 해당 App·Service 프로세스를 종료했다. Claude 응답·사용자 파일 작업의 수동 통과는 아직 확인하지 않았다.
- 최종 `npm run test:worker-free` 결과는 진행 기록을 확인한다. 위 준비 검증만으로 전체 분리 완료를 선언하지 않는다.

## 1. 로컬 Service 시작

Finder에서 아래 파일을 더블클릭하거나 터미널에서 실행한다.

```sh
"$HOME/Library/Application Support/HypeProof Studio Development/manual-worker-free/Start Local Service.command"
```

`READY 8787 ... control=off`가 나오면 준비됐다. 이 터미널은 열어 둔다.
8787 포트가 이미 사용 중이면 기존 Service가 무엇인지 확인하고 종료한 뒤 재실행한다.
스크립트는 임의의 기존 프로세스를 종료하지 않는다.

이 서버는 실제 Service 라우터와 테스트용 저장소·계정을 사용한다. 모델 API 응답은
scripted fixture지만, 다음 단계의 Dev 앱은 모델 호출을 로컬 Claude 구독으로 보낸다.
운영 Service 배포와 모델 API 키는 이 기본 실행에 필요하지 않다.

## 2. Dev 앱 열기

다른 터미널이나 Finder에서 실행한다.

```sh
"$HOME/Library/Application Support/HypeProof Studio Development/manual-worker-free/Open Studio Dev.command"
```

이 파일은 현재 extension·webview를 다시 빌드하고 격리된 앱을 실행한다.
기존 Dev 앱이 열려 있으면 작업을 저장하고 그 Dev 앱만 종료한 뒤 실행한다.
앱 `.app` 파일을 직접 열지 않는다. 런처가 로컬 주소·구독 모드·참여 토큰 경로를 설정한다.

정상: 보라색 DEV 표시, 로컬 Service 연결, 모델 연결 표시 `Claude Code · 로컬 구독`.
참여 토큰은 자동으로 읽으며 채팅에 입력할 필요가 없다.

## 3. 핵심 수동 테스트

| 순서 | 할 일 | 정상 결과 |
|---|---|---|
| 연결 | 채팅 패널을 열고 수업·프로필이 로드됐는지 확인 | 연결 오류 없이 해당 로컬 테스트 수업이 표시됨 |
| 구독 AI | “지금 사용할 수 있는 파일 도구를 짧게 설명해줘” 전송 | Claude 응답이 들어오고 턴이 끝남. 실제 구독 사용량이 발생할 수 있음 |
| 파일 생성·수정 | “작업 폴더에 manual-check.txt를 만들고 manual test라고 써줘” 요청. 승인창이 나오면 내용을 확인하고 승인. 이어서 문구를 manual test passed로 바꾸도록 요청 | 편집기에서 실제 파일과 변경 내용 확인. 말로만 완료했다고 답하는 것은 통과가 아님 |
| 기존 파일 보존 | 별도 파일 keep-me.txt에 직접 내용을 저장한 뒤 manual-check.txt만 다시 수정 요청 | 대상 파일만 수정되고 keep-me.txt 내용은 그대로 유지됨 |
| 재실행 | 작업 저장 → Dev 앱 종료 → 같은 실행 파일로 다시 열기 | 생성한 파일이 유지되고 수업 연결·Claude 응답을 다시 사용할 수 있음 |

실패했다면 해당 단계, 화면에 나온 오류, 실제 파일 결과를 기록한다.
AI의 문장과 실제 디스크 결과가 다르면 실패로 기록한다.

## 4. Service 실패·재연결 확인

Service 터미널에서 Ctrl-C로 서버를 멈춘다. `Open Studio Dev.command`를 실행하면
“먼저 Start Local Service.command를 실행하세요”로 거부해야 한다.
이는 실행 준비 검사이며 실행 중인 앱의 모든 오류 UI를 검증했다는 뜻은 아니다.

Dev 앱을 종료하고 Service를 다시 시작한 뒤 Dev 앱을 다시 실행한다.
새 로컬 참여 토큰은 자동으로 생성·읽히며 연결이 복구돼야 한다.
로컬 Claude 호출은 서버 호출과 다른 경로이므로, 서버를 멈춰도 진행 중인 Claude
응답이 계속되는 것만으로 실패 처리를 판단하지 않는다.

## 5. 종료와 로그

- Dev 앱은 직접 종료한다. Service 터미널에서는 Ctrl-C.
- 앱 로그: `~/Library/Application Support/HypeProof Studio Development/manual-worker-free/app-state/app.log`.
- 작업 폴더: 같은 `app-state/workspace`.
- 참여·교사·admin 토큰 파일은 로컬 전용이다. 채팅·이슈·스크린샷에 첨부하지 않는다.
- 로컬 서버의 저장소는 재시작하면 초기화된다. App 작업 파일은 유지된다.
- Chalk 웹→App 통합과 운영 서버 배포는 이번 수동 실행 준비에 포함하지 않는다.
