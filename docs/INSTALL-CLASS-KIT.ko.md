# 수업용 설치 키트

조직 멤버가 아닌 수업 참가자가 HypeProof Studio를 설치하는 방법이다. 강사가 읽는 운영 문서다.

2026-10-10부터 소스 저장소와 릴리스 저장소가 비공개다. 원라인 설치기(`scripts/install.sh`, `scripts/install.ps1`)는
앱 파일과 SDK 시드 스크립트를 GitHub에서 받기 때문에 멤버의 `gh` 로그인이 있어야 한다. 조직 초대가 없는 참가자는
그 명령으로 설치할 수 없다. 앱 파일만 따로 설치하면 코치가 파일 저장과 미리보기를 못 하는 축소 모드로 시작한다.

설치 키트는 그 두 가지를 한 폴더에 담은 것이다. 멤버가 한 번 만들고, 강사가 참가자에게 직접 건넨다.
새 서버, 계정, 토큰은 필요 없다.

## 0. 먼저 확인할 것

**비공개 앱을 조직 밖 참가자에게 주는 일은 소유자(Jay)가 정한다.**
2026-10-10 결정은 설치와 업데이트를 저장소 읽기 권한이 있는 멤버에게만 연다
([private-release-access](requirements/private-release-access.md)). 키트는 그 결정의 예외다.
키트를 만들기 전에 소유자의 확인을 받는다.

## 1. 키트 만들기 (멤버, 한 번)

준비물은 이 저장소의 체크아웃과 멤버 계정으로 로그인한 `gh`다.

```bash
bash scripts/make-class-kit.sh --out ~/Desktop/hypeproof-class-kit --version 0.1.56
```

| 옵션 | 뜻 |
|---|---|
| `--out <폴더>` | 만들 폴더. 이미 있거나 git 체크아웃 안이면 멈춘다. |
| `--version <x.y.z>` | 담을 Studio 버전. 생략하면 최신 릴리스. |
| `--platform <p>` | `darwin-arm64` 또는 `win32-x64`. 생략하면 둘 다. |

폴더에 들어가는 것:

| 파일 | 출처 |
|---|---|
| `HypeProof-Studio-darwin-arm64.zip` | 비공개 릴리스. 릴리스의 SHA-256과 대조한 뒤 담는다. |
| `HypeProof.StudioUserSetup-x64-*.exe` | 위와 같다. |
| `install.sh`, `install.ps1` | 이 체크아웃의 설치기 |
| `seed-sdk-binary.sh`, `seed-sdk-binary.ps1` | 이 체크아웃의 SDK 시드 스크립트 |
| `kit-info.txt` | Studio 버전, 플랫폼, 만든 시각(UTC), 소스 커밋 |
| `SHA256SUMS` | 위 모든 파일의 SHA-256 |

v0.1.56을 두 플랫폼으로 담으면 약 290 MB다.
토큰, `gh` 설정, 만든 사람의 계정 이름, 호스트 이름, 로컬 경로는 들어가지 않는다. 수업 참여 코드도 들어 있지 않다.

SDK 시드 스크립트는 SDK 버전을 고정한다(지금 0.3.207). 이 버전이 담는 앱이 찾는 버전과 같아야 코치가 전체 모드로 시작한다.
`v0.1.56` 태그의 앱 소스는 0.3.207을 찾는다. 다른 버전의 앱을 담을 때는 그 버전 태그의 `scripts/seed-sdk-binary.sh` 와 비교한다.

## 2. 건네기

- 폴더를 통째로 건넨다. USB, AirDrop, 수업 참가자만 보는 공유 폴더를 쓴다. 압축해서 건넸다면 풀어서 쓴다.
- 누구나 받을 수 있는 공개 주소에는 올리지 않는다. 수업이 끝나면 공유 폴더에서 지운다.
- 건네기 전에 복사본을 확인한다: 폴더 안에서 `shasum -a 256 -c SHA256SUMS`.

## 3. 참가자 설치

네트워크가 필요하다. Homebrew, winget, SDK 바이너리(npm 레지스트리, 약 67 MiB)는 평소처럼 공개 주소에서 받는다.
GitHub 로그인과 조직 초대는 필요 없다.

**macOS (Apple Silicon)**

1. 터미널을 연다. `cd ` 를 입력하고(뒤에 빈칸), 키트 폴더를 터미널 창으로 끌어다 놓은 뒤 Enter.
2. 아래를 붙여넣고 Enter.

```bash
bash install.sh --kit .
```

끝에 `점검(doctor): 모든 항목 통과` 와 `SDK: 준비·확인됨` 이 보여야 한다.
SDK 시드가 빠지거나 실패하면 doctor 가 `SDK: 설치되지 않았습니다 — 멈춘 단계: …` 와 복구 명령을 찍고 non-zero 로 끝난다
(Windows 설치기와 같다). 앱 안에서 SDK를 받는 기능은 아직 없다([sdk-bundling](sdk-bundling.md)). `registry.npmjs.org` 접속을 확인하고 찍힌 명령(같은 키트 설치 명령)을 다시 실행한다.

**Windows (x64)**

1. 탐색기에서 키트 폴더를 연다. 주소 표시줄에 `powershell` 을 입력하고 Enter.
2. 아래를 붙여넣고 Enter.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -KitDir .
```

끝에 `점검(doctor): 모든 항목 통과` 또는 `점검(doctor): 필수 항목 통과` 가 보여야 한다.

설치가 끝나면 앱을 열고 수업 참여 코드를 입력한다. 다시 실행해도 된다. 이미 설치된 것은 건너뛴다.

## 4. 키트가 하는 일과 하지 않는 일

- **손상은 잡는다. 건넨 사람은 확인하지 않는다.** 설치기는 설치 전에 폴더의 모든 파일을 `SHA256SUMS`와 대조하고,
  다르면 멈춘다. 복사가 덜 됐거나 깨진 키트를 걸러낸다. 그러나 파일을 바꿀 수 있는 사람은 `SHA256SUMS`도 바꿀 수 있다.
  누가 만든 키트인지는 건네는 사람이 보증한다.
- **GitHub 로그인을 쓰지 않고 비공개 저장소에 접근하지 않는다.** 키트 모드의 설치기는 `gh api`, `gh release`, `gh auth` 를 부르지 않는다.
  `gh` 자체는 `git` 이나 `node` 처럼 설치하고 버전만 확인한다(`gh --version`). 수업의 홈페이지 공개 단계가 참가자 본인 계정으로 `gh` 를 쓰기 때문이다.
  Homebrew와 winget이 받는 공개 파일 중에는 GitHub에서 오는 것이 있다. 그 경로는 바꾸지 않았다.
- **자동 업데이트가 없다.** v0.1.56 앱이 보는 업데이트 주소는 지금 404를 돌려준다. 이후 버전의 업데이트는 멤버 로그인이 필요하다.
  새 버전이 필요하면 새 키트를 만들어 다시 설치한다.
- **앱 안의 "환경 세팅 점검해줘"(Windows)로는 복구되지 않는다.** 그 기능은 설치기를
  `raw.githubusercontent.com/jayleekr/hypeproof-studio/...` 에서 받게 되어 있고, 그 주소도 지금 404다.
  SDK가 빠졌으면 키트의 설치 명령을 다시 실행한다.
- 키트에 든 버전만 설치한다. `HPS_STUDIO_VERSION` 은 무시한다.
- Intel Mac용 파일은 릴리스에 없다. 키트로도 설치할 수 없다.

## 5. 수업 전 리허설

멤버가 아닌 사람의 노트북으로, macOS 한 대와 Windows 한 대에서 키트 설치를 끝까지 해 본다.
앱을 열어 코치가 파일을 저장하고 미리보기를 켜는지 확인한다.

Windows 경로는 2026-10-13 현재 실제 Windows 기기에서 실행해 보지 못했다. macOS의 `pwsh` 로 키트 확인 함수와
`-DoctorOnly` 실행만 검증했다. 리허설 없이 수업에 쓰지 않는다.

## 6. 문제가 생기면

| 화면에 보이는 것 | 뜻과 조치 |
|---|---|
| `SHA-256 mismatch for <파일>` | 복사본이 깨졌다. 키트를 다시 받는다. |
| `SHA256SUMS not found` | 키트 폴더가 아니다. 폴더 위치를 확인한다. |
| `<파일> is missing` / `is not listed` | 폴더의 일부만 복사됐다. 통째로 다시 받는다. |
| `it was built without darwin-arm64` (또는 `win32-x64`) | 그 플랫폼 없이 만든 키트다. `--platform` 없이 다시 만든다. |
| `Intel Mac(x86_64)는 현재 지원되지 않습니다` | 지원하지 않는 기기다. |

## 7. 검증

```bash
bash scripts/test-installer-kit.sh                      # 키트 만들기 + macOS 키트 설치, 임시 폴더 안에서
pwsh -NoProfile -File scripts/tests/install-kit-fixture.ps1   # Windows 키트 확인 함수
```

두 테스트 모두 실제 설치를 하지 않고 네트워크를 쓰지 않는다. Windows 쪽은 `private-installers` 작업이
Windows PowerShell 5.1에서 같이 돌린다.
