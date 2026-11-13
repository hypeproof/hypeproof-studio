# Windows 개발환경

> 작성일 2026-11-13 · 상태: 활성

공통 Harness 작업은 다음 두 경로로 구분한다. Studio 앱의 Windows 제품 빌드·릴리스
검증은 별도 작업이며 이 문서의 진단 통과로 대체하지 않는다.

| 작업 | 실행 위치 |
|---|---|
| 추적 소스·Python 문법·모듈 충돌·의존성 진단 | 네이티브 PowerShell + Windows Python 3.11/3.14 |
| 인증, agent Git/PR, consumer 동기화 | WSL2 Ubuntu의 Linux 파일시스템 |
| Windows에서 위 WSL 명령 실행 | `scripts/dev-environment/run-in-wsl.ps1` |

## 네이티브 PowerShell 진단

Git for Windows와 Python을 설치한 환경에서 실행한다. Python 가상환경의 실행파일을
직접 호출하므로 PowerShell 실행 정책 변경이나 `Activate.ps1` 허용이 필요 없다.

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
& .\.venv\Scripts\python.exe scripts/dev-environment/check.py --dev --json
& .\.venv\Scripts\python.exe -m pytest tests/dev_environment tests/hype_pr/test_agent_identity_stdlib_shadow.py -q
```

Windows Python 3.11에서 파일/콘솔 기본 인코딩이 UTF-8이 아닐 수 있으므로 JSON은
ASCII escape로 출력한다. JSON 파싱 후에는 원래 한글 경로가 복원된다. POSIX 실행
비트는 Windows에서 검사하지 않으며, 이를 통과시키기 위해 파일 ACL을 바꾸지 않는다.

Harness skill은 Git symlink를 사용한다. 일반 파일로 풀린 symlink는 정상 설치가 아니며
진단에서 `symlink-materialized`로 실패한다. Windows가 symlink 생성을 허용하는
환경(예: Developer Mode)에서는 **새 체크아웃을** 다음처럼 만든다.

```powershell
git -c core.symlinks=true clone https://github.com/hypeproof/hypeproof-harness.git
```

기존 다른 세션의 체크아웃을 강제로 다시 checkout하거나 관리자로 자동 재실행하지
않는다. symlink 생성이 허용되지 않으면 아래 WSL 경로를 쓴다. 시스템 정책이나
Developer Mode 변경은 자동 수행하지 않는다.

`windows-workflow` 경고는 네이티브 파일 진단의 실패가 아니라 인증·PR 작업을 WSL로
실행하라는 안내다. Windows에서 `agent-auth.py ensure`를 실제 인증용으로 실행하면
`wsl_required`로 중단하며, GitHub 자격 증명을 읽거나 전송하지 않는다. 도움말은
네이티브에서 사용할 수 있다. POSIX의 0600 검사와 `O_NOFOLLOW`를 Windows에서
생략하는 방식으로 인증을 통과시키지 않는다.

## WSL2에서 전체 Harness 도구 실행

이미 설치한 Ubuntu 24.04 WSL2 배포판을 사용한다. 배포판 설치·WSL 활성화·재부팅은
개인 PC의 시스템 변경이며 진단기나 bridge가 자동 수행하지 않는다.
PowerShell에서 `wsl --list --verbose`로 배포판 이름과 VERSION 2를 확인한다.

WSL 터미널 안에서 저장소와 가상환경을 Linux 홈 디렉터리에 만든다.
`/mnt/c`나 `/mnt/d`의 Windows 체크아웃·Windows `.venv`를 재사용하지 않는다.

```bash
mkdir -p ~/code
cd ~/code
git clone https://github.com/hypeproof/hypeproof-harness.git
cd hypeproof-harness
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/dev-environment/check.py --dev --json
```

필수 명령은 `git`, `bash`, `gh`, `openssl`이며 동기화에는 `rsync`도 필요하다.
GitHub 로그인/최초 브로커 동의는 기존 멤버 인증 절차를 **WSL 환경 안에서** 따른다.
Windows의 로그인 파일·토큰을 자동 복사하지 않는다.

PowerShell에서 기존 WSL 체크아웃의 명령을 호출할 수도 있다. `Checkout`에는 자신의
Linux 경로를 넣고, 명령을 문자열 조합 대신 인자 배열로 전달한다.

```powershell
& ./scripts/dev-environment/run-in-wsl.ps1 `
  -Distribution 'Ubuntu-24.04' `
  -Checkout '/home/you/code/hypeproof-harness' `
  -Command @('.venv/bin/python', 'scripts/dev-environment/check.py', '--dev', '--json')
```

bridge는 지정 배포판/디렉터리에서 지정 명령만 실행하고 종료 코드를 전달한다.
다른 배포판 fallback, 자동 설치, 자동 로그인, 자격 증명 전송은 하지 않는다.

## 검증 범위

`.github/workflows/dev-environment.yml`은 고정된 Windows Server 2022 runner의
네이티브 Python 3.11/3.14에서
PowerShell 진단, 실제 symlink, 한글·공백 경로, legacy console, CLI 시작, 인증 경계와
PowerShell 문법을 검사한다. 공유 Harness 엔진 잠금은 Windows에서도 실제 파일 잠금을
사용하며, 두 프로세스가 동시에 갱신하지 못하는지와 잠금 해제를 검사한다. 별도 Windows runner의 **실제 WSL2 Ubuntu 24.04**에서
Linux 파일시스템 clone, 인증 회귀, 동기화 gate, PowerShell bridge를 검사한다.
WSL kernel 문자열도 확인하므로 일반 Linux 실행을 WSL 검증으로 표시하지 않는다.

실행 결과는 해당 PR의 exact-head Actions 기록을 기준으로 읽는다. workflow 파일이
존재하는 것, Linux 결과, 로컬 Mac 결과만으로 Windows/WSL 통과를 주장하지 않는다.
모든 개인 PC의 회사 정책·설치 상태·드라이버 및 제품별 전체 빌드까지 보증하지 않는다.

WSL CI 설치 도구는 [setup-wsl v7.2.0](https://github.com/Vampire/setup-wsl/tree/4c48163d9f981914dd8caa0fc335fe19cca5bff4)를
고정 commit으로 사용하며, 변경은 임시 hosted runner 안에서만 이루어진다.
