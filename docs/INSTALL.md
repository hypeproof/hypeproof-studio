# HypeProof Studio 설치 가이드

워크숍 가족 여러분 환영합니다. 5분 안에 설치 끝납니다.

---

## 먼저 준비할 것

현재 설치 파일은 비공개입니다. 아래 명령은 hypeproof 조직 초대를 받은 GitHub 계정에서만 동작합니다.

1. hypeproof 조직 초대를 수락합니다.
2. GitHub CLI(`gh`)를 설치합니다.
3. 터미널에서 `gh auth login --hostname github.com` 을 실행해 초대받은 계정으로 로그인합니다.

초대가 없는 수업 참가자와 이용권 구매자는 참여 코드로 https://hypeproof-ai.xyz/studio/install 에서 설치합니다.

---

## 🍎 Mac

1. **Spotlight** (⌘+Space) → "Terminal" 입력 → Enter
2. 아래 한 줄을 복사해서 붙여넣고 Enter:

```bash
gh api repos/hypeproof/hypeproof-studio/contents/scripts/install.sh -H "Accept: application/vnd.github.raw" > /tmp/hps-bootstrap.sh && bash /tmp/hps-bootstrap.sh
```

3. 다 끝나면 응용 프로그램에서 HypeProof Studio를 여세요.

> **앱이 열리지 않거나 macOS 보안 경고가 뜨면:**
> HypeProof Studio는 아직 Apple 공증(notarization)을 받지 않았습니다. 그래서 브라우저로 받은 앱은 macOS가 막을 수 있습니다.
> 보안 설정을 바꾸거나 우회하지 마세요. 대신 터미널에서 설치 명령으로 다시 설치합니다. 터미널(curl)로 받은 앱은 이 경고 없이 열립니다.
>
> - 특정 버전: 릴리스 페이지의 한 줄 명령 `curl -fsSL https://github.com/hypeproof/hypeproof-studio/releases/download/<태그>/install-mac.sh | bash`
> - 참여 코드가 있거나 처음 설치하는 분: `curl -fsSL https://hypeproof-ai.xyz/install/studio/install-mac.sh -o /tmp/hps-install.sh && bash /tmp/hps-install.sh` (https://hypeproof-ai.xyz/studio/install 와 같은 명령)
>
> 그래도 열리지 않으면 앱을 지우지 말고 https://github.com/hypeproof/hypeproof-studio/issues 에 알려 주세요.

---

## 🪟 Windows

1. **시작 버튼** 우클릭 → "터미널" 또는 "Windows PowerShell" 클릭
2. 아래 한 줄을 복사해서 붙여넣고 Enter:

```powershell
gh api repos/hypeproof/hypeproof-studio/contents/scripts/install.ps1 -H "Accept: application/vnd.github.raw" | Out-File "$env:TEMP/hps-bootstrap.ps1" -Encoding utf8; if ($LASTEXITCODE -eq 0) { powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP/hps-bootstrap.ps1"; "exit code: $LASTEXITCODE" } else { Write-Error "GitHub 로그인과 조직 초대 수락을 확인하세요." }
```

3. SmartScreen 경고가 뜨면 → "추가 정보" → "실행" 클릭
4. 다 끝나면 시작 메뉴에서 HypeProof Studio를 여세요.

---

## 워크숍 토큰 등록

설치 후 처음 열면 좌측에 💬 아이콘이 보입니다.

1. 💬 아이콘 클릭
2. 화면 위쪽 **"Set token"** 버튼 클릭
3. 운영진이 나눠드린 토큰 문자열 붙여넣기 → Enter

이제 채팅창에 무엇이든 입력해보세요 — 예:
> "삼각형을 그리는 게임을 만들어줘"

---

## 도움이 필요하면

- 카톡: 워크숍 단톡방
- 이메일: jayleekr0125@gmail.com
- GitHub: https://github.com/hypeproof/hypeproof-studio/issues (조직 멤버만 열 수 있습니다)
