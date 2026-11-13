# 릴리스 케이스북 — 릴리스 관리자 절차

`REQ-STUDIO-RELEASE-CASEBOOK` ([docs/studio-requirements.md](../../studio-requirements.md#release-casebook-req-studio-release-casebook)).
이 폴더는 학습자 화면의 한국어 문구를 그대로 인용하므로 한국어로 쓴다(CLAUDE.md §Language,
테스트 문서 예외). 사전 테스터 프롬프트만 에이전트가 읽는 영어 문서다.

| 파일 | 내용 |
|---|---|
| [journeys.yaml](journeys.yaml) | 핵심 사용자 여정(CUJ). 케이스북의 뼈대 |
| [cases.yaml](cases.yaml) | 여정 아래에 계속 늘어나는 블랙박스 케이스(BB) |
| [results-schema.md](results-schema.md) | 실행 결과 형식 `hps-blackbox-run/1` |
| [pre-tester-prompt.md](pre-tester-prompt.md) | 에이전트 사전 테스터(Jay 의 Mac 에서 도는 Codex) 지시문 |

코드: `scripts/release/select-cases.mjs`(케이스 선택), `scripts/release/casebook.mjs`(로더·검사),
`scripts/release/validate-blackbox-run.mjs`(결과 검사), `scripts/release/daily-gate.mjs`(매일 컷 판단).
대조군: `node --test scripts/release/test/select-cases.test.mjs`.

## 데스크톱 릴리스의 하루 흐름

```
17:00 KST  release-cut 예약 실행 ─ 앱 변경 없음 / 수업 중 / 일시 정지 → 건너뜀
   │
   ├─ smoke → rc 태그 → rc 빌드 + 자동 E2E(verify-unified-release)
   └─ 봇 릴리스 PR (release 라벨) ─ 맨 위 rc 한 줄 설치 · 바뀐 요구사항 · 선택된 케이스 체크리스트
          │
17:30 / 20:30  (선택) 에이전트 사전 테스트 → PR 댓글 한 개 (hps-blackbox-run/1)
          │
          ├─ 릴리스 관리자: 남은 케이스를 rc 설치본에서 실행, 체크리스트에 PASS/FAIL/BLOCKED
          ├─ 판정 규칙 통과 → PR 의 **현재 head** 에서 승인
          └─ v 태그 → 공개 게이트(publish-gate) → 공개
```

1. **컷 (매일 17:00 KST).** `.github/workflows/release-cut.yml` 이 `schedule` 로 돈다.
   `gate` 잡(`scripts/release/daily-gate.mjs`)이 마지막 안정 `v` 태그 이후 앱 경로
   (`extensions/`, `vscodium-base`, 설치 스크립트 템플릿 등 — 파일의 `APP_PATHS`)가 바뀌지 않았거나,
   수업이 열려 있거나(`scripts/check-live-sessions.mjs`, 실패하면 막힘), 일시 정지 상태면 건너뛴다.
   그 밖에는 `mode=create` 로 컷한다. 손으로 돌리는 실행은 지금처럼 입력값을 쓰고, 입력이 없으면 dry-run 이다.
2. **CI 수용.** 기존 관문은 그대로다: smoke FAIL 이면 이슈만 열고 멈춘다. NOT_RUN 이면
   `accept_not_run` 없이는 멈춘다. rc 빌드가 `verify-unified-release` 자동 E2E 를 돈다.
3. **봇 릴리스 PR.** `hypeproof-org-lab-bot` 이 `release/<version>` PR 을 `release` 라벨로 연다
   (라벨이 없으면 만든다. 같은 날 다음 rc 는 기존 PR 을 고치고 라벨을 다시 붙인다). 본문 맨 위에
   rc 한 줄 설치 명령, §4 에 바뀐 요구사항과 이번 릴리스의 케이스 체크리스트가 들어간다.
4. **에이전트 사전 테스트(선택).** [pre-tester-prompt.md](pre-tester-prompt.md). 테스트만 하고 승인하지 않는다.
   결과는 PR 댓글 하나 — 케이스 표, P0 판정 줄, 새 케이스 제안, 접힌 결과 JSON.
5. **사람이 남은 케이스를 실행한다.** 사전 테스트가 PASS(스크린샷 있음)로 덮은 케이스는 다시 하지 않아도 된다.
   FAIL·BLOCKED 와 사전 테스트가 못 한 케이스(구매·Google 로그인, 실제 코드)는 사람이 한다.
   설치는 PR 맨 위 한 줄로만 한다 — rc 는 `~/Applications/<kit 폴더>/` 에 나란히 깔리고 기존 설치는 건드리지 않는다.
   **주의:** 키트는 프로필이 따로라 기존 설치가 `~/HypeProofTrial` 을 어느 활동에 묶었는지 모른다. 키트에서 무료 시작을
   누르면 그 폴더를 그대로 쓸 수 있다. 실제 작업이 든 Mac 이면 사전 테스터처럼 `HOME` 을 임시 폴더로 바꿔 실행한다
   ([pre-tester-prompt.md](pre-tester-prompt.md) "Run under a sandbox HOME").
6. **정확한 head 에서 승인.** 승인은 PR 의 현재 head 커밋에 한다. 다음 rc 가 브랜치를 옮기면 이전 승인은 무효다
   (`scripts/release/publish-gate.mjs`).
7. **공개.** v 태그를 rc 와 같은 커밋에 달고, `verify-unified-release` 가 공개 게이트를 확인한 뒤 공개한다
   ([06-release-process.md](../../dev/06-release-process.md#approval)).

## 케이스 선택 (`select-cases.mjs`)

릴리스마다 해당 대상의 케이스를 고른다. 기본 대상은 `desktop`(기존 macOS·Windows 앱)이다.
각 케이스의 `targets` 를 생략하면 `desktop` 이며, iPhone 은 `targets: [ios]` 로 명시한다.
허용 값은 `desktop`, `ios`, `android` 다. 빈 배열·중복·문자열 하나·모르는 값은 오류이며,
모르는 대상을 데스크톱으로 바꾸거나 검사 0건으로 통과시키지 않는다.
대상 필터를 적용한 뒤 다음 이유가 케이스마다 기록된다.

| 이유 | 조건 |
|---|---|
| `p0` | 해당 대상에 속한 모든 여정의 P0 케이스 전부 |
| `touched:<id>` | 마지막 안정 태그 이후 머지된 PR 이 건드린 요구사항 id 에 연결된 케이스. id 는 커밋 제목·본문(스쿼시 머지가 PR 제목과 본문을 담는다)과 요구사항 문서(`docs/studio-requirements.md`, `docs/requirements/`, `docs/dev/04-requirements.md`) diff 의 바뀐 줄에서 찾는다. 로컬 git 만 쓴다. 바뀐 id 가 케이스 id 의 하위(`REQ-L12-14` → `REQ-L12`)여도 걸린다 |
| `escaped:<날짜>` | 최근 14일 안에 추가된 유출 버그 케이스 |

`status: 자동화됨` 케이스는 고르지 않는다. 출력은 마크다운 체크리스트(PR 본문)와 JSON
(`cases.json`, `hps-release-cases/1`)이다. 컷 아티팩트에 둘 다 남는다.

```bash
node scripts/release/select-cases.mjs                      # 마지막 안정 태그..origin/main
node scripts/release/select-cases.mjs --json --today 2026-10-21
node scripts/release/select-cases.mjs --pr 2210 --json     # 릴리스 PR 본문의 범위·커밋 (gh 읽기 1회)
node scripts/release/select-cases.mjs --target ios --baseline <이전-소스-SHA> --candidate <후보-소스-SHA> --json
```

`--pr <번호>` 는 릴리스 PR 본문의 `Candidate commit` 과 `Range` 를 읽어 범위를 정한다. 본문에 그 줄이
없거나 형식이 다르면 멈춘다 — 기본 범위로 조용히 바꾸지 않는다. `--baseline`·`--candidate` 와 같이 쓰면
오류다. 모르는 옵션·`--target` 값도 오류로 멈춘다. JSON 의 `target` 과 각 행의 `targets`,
마크다운의 대상 줄에 적용 범위가 남는다. iPhone 확인은 정확한 네이티브 후보의 소스 범위를 명시한다.

케이스북이 깨져 선택이 실패하면 컷은 멈추지 않는다. PR 본문에 **케이스 선택 실패** 가 찍히고,
관리자는 `cases.yaml` 에서 해당 대상의 P0 를 전부 확인한다. 잘못된 대상 표기는 먼저 고친다.

## 판정 규칙

- **P0 가 하나라도 FAIL 이면 승인하지 않는다.** 예외 없음. 고친 뒤 다음 rc 에서 다시 한다.
- P0 가 BLOCKED 면 승인하지 않는다 — 사람이 직접 실행해서 PASS 로 바꾸거나, 막힌 이유가 제품 밖(예: 결제 대행사 장애)임을 PR 에 적고 Jay 가 결정한다.
- P1 FAIL 은 이슈 번호를 적고 관리자가 판단한다. 승인하면 PR 에 이유를 남긴다.
- P2 FAIL 은 이슈만 남긴다.
- PASS 는 스크린샷이 있어야 PASS 다. 사전 테스트의 FAIL 은 깨끗한 프로필에서 한 번 다시 해 본 뒤의 FAIL 이다.
- 체크박스를 비워 둔 채 승인하지 않는다. 할 수 없었던 케이스는 `BLOCKED — 이유` 로 적는다.
- **발행 게이트가 이것을 확인한다**(#3429, `scripts/release/publish-gate.mjs`). 승인 경로의 안정 태그는 릴리스 PR 에
  현재 head 를 테스트한 `hps-blackbox-run/1` 결과 댓글이 태그 시점 `cases.yaml` 의 데스크톱 P0 케이스(자동화됨 제외) 전부에
  PASS 를 줄 때만 공개된다. 결과 댓글은 멤버·협업자나 조직 봇이 단 것만 센다. 대신 Jay 나 그 PR 을 승인한 writer 가 head
  커밋 뒤에 `Release manager override` 로 시작하고 이유를 적은 댓글을 남기면 공개된다. 어느 길로 나갔는지 한 줄이 릴리스
  노트의 `hps-process:v1` 블록에 남는다. 공개 Service 가 rc 수락 뒤에 바뀌어 수락을 다시 돌렸으면 그 사실도 한 줄 남는다.

## iPhone 여정과 증거 연결 (CUJ-8, #3771 / #3784)

`CUJ-8` 의 `BB-033`–`BB-037` 은 첫 로그인·받아쓰기·음성 대화·실패 복구의 **active** 유출 버그
케이스다. `--target ios` 로 고르며, 최근 14일 유출 조건이나 P0 때문에 데스크톱 안정 릴리스의
필수 목록에 섞이지 않는다. 선택기와 `publish-gate` 는 같은 대상 판정을 사용한다.
`android` 는 허용된 대상 이름일 뿐, iPhone 케이스가 Android 수용 증거가 되는 것은 아니다.

자동 검사는 기존 네이티브 경로에 연결한다. 아래 여덟 검사는
[`StudioJourneyTests`](../../../apps/studio-native/ios/UITests/StudioShellTests.swift)에 있으며,
[`collect-native-journeys.py`](../../../apps/studio-native/scripts/collect-native-journeys.py)가 실제
실행 로그에서 이름별 실행·통과를 확인한다. 하나라도 누락·건너뜀·실패하면 시뮬레이터 여정 통과로
보고하지 않는다. 빌드 성공만으로 이 목록을 채우지 않는다.

| 케이스 | 시뮬레이터 검사 (`StudioJourneyTests.` 뒤 이름) |
|---|---|
| BB-033 | `testFirstInstallSignInToFirstAnswerWithoutDesktop` |
| BB-033 | `testExpiredSignInLeavesActionableFailureInsteadOfInfiniteChecking` |
| BB-034 | `testDictationEditsDraftThenSendGetsReplyWithoutDesktop` |
| BB-034 | `testVoiceFinishingDuringHistorySyncSendsOnceAndResumesListening` |
| BB-035 | `testHandsFreeReplyStartsNextTurnAndStopPreventsSecondSend` |
| BB-036 | `testBackgroundStopsCaptureAndPreservesUnsentDraftAcrossRelaunch` |
| BB-036 | `testFailedSendRetainsOutboxAndRetriesSameRequestAfterRelaunch` |
| BB-037 | `testAIAdmissionDenialRemainsVisibleAfterHistoryRefreshAndRelaunch` |

`hps-native-journey-evidence/1` 의 빌드·시뮬레이터 결과와 소스 SHA를 보존한다. 이 검사는 실제 앱의
상태·저장 경로를 사용하지만 인증 서버·HTTP·음성 이벤트는 합성이다. 실기기, 실제 브라우저 로그인,
한국어 음성 인식은 따로 실행하기 전까지 `NOT_RUN` 이다. 실제 iPhone 실행은 빌드 번호·소스 SHA·
iOS 버전·계정 이용 자격과 케이스별 스크린샷/관측·실패 이유를 별도 기록한다. 한 케이스의 일부만
관측했으면 전체 PASS 로 합치지 않는다. 시뮬레이터 통과는 `status: 자동화됨` 으로 은퇴시키는
근거가 아니며 아래 은퇴 규칙을 그대로 따른다.

데스크톱 RC 태그용 `hps-blackbox-run/1` 에 iPhone 빌드나 합성 결과를 끼워 넣지 않는다.
이 연결은 새 승인·배포 경로를 만들지 않는다. 기존 네이티브 후보 검증·TestFlight 업로드 절차를
유지하며 **실기기 `NOT_RUN` 만으로 테스트 후보 배포를 막지 않는다.** 업로드·TestFlight에서 설치 가능·
사용자 수용은 다른 상태다. 상세 기준은 [MFR-01–06](../../requirements/mobile-growth-roadmap.md)과
[MFR-T01–06](../../testing/native-mobile-growth.md),
[Foundry native recipe](../../../apps/studio-native/FOUNDRY.md)를 따른다.

## 유출 버그 규칙

**운영에서 발견된 버그를 고치는 PR 은 BB 케이스를 하나 추가한다.**

- `origin: {kind: escaped-bug, date: <발견일>, ref: "#<고친 PR>"}`.
- 케이스는 그 버그를 사용자 눈으로 다시 밟는 단계와, 고친 뒤의 실제 문구를 `expect` 에 적는다.
- 추가된 날부터 14일 동안은 P0 가 아니어도 해당 대상의 매 릴리스에 뽑힌다. 그 뒤에는 우선순위와 요구사항 연결로만 뽑힌다.
- PR 검사 `process / escaped-bug-case` 가 이 규칙을 기계로 지킨다(#3429, `scripts/release/escaped-bug-case.mjs`).
  PR 이 닫는 이슈(`Closes #N` 또는 연결된 이슈)에 `escaped-bug` 라벨이 있거나 `member-report` + `bug` 이면, 이 PR 이
  `cases.yaml` 에서 추가·수정한 케이스 중 하나가 `origin.ref` 에 그 PR 이나 이슈 번호를 적거나, `automated_by` 에 이 PR 이
  추가한 테스트 파일을 적어야 한다. 아니면 빨간불이다.
- 예외: 라벨 `no-casebook-needed` 와 본문 한 줄 `No casebook: <이유>` 를 함께 단다. 둘 중 하나만 있으면 빨간불이고,
  쓴 기록은 검사 요약과 주석에 남는다.
- **회원 신고도 운영 발견이다.** 앱 안 신고(`reports`), 회원 메시지, 릴리스 뒤 실패로 찾은 버그는 모두 이 규칙을 따른다.
  이슈에 `escaped-bug` 라벨을 붙이고, 고치는 PR 이 케이스를 추가한다. 2026-11-03 에 사람 리뷰어 없이 봇이 머지하면서
  이 규칙이 한 번도 지켜지지 않은 것을 확인했다(#3399 는 케이스 없이 머지). 기계 검사로 바꾸는 일: #3429.
- 흔한 여정에 케이스가 없어서 생긴 유출이면 `journeys.yaml` 에 여정을 먼저 추가한다(CUJ-5 미리보기, CUJ-6 신고가 그렇게 생겼다).

## 은퇴 규칙

CI 가 자동으로 같은 것을 재고, **그 자동 검사가 6개월 동안 한 번도 실패하지 않았으면** 케이스를
`status: 자동화됨` 으로 옮긴다. `automated_by` 에 그 검사(파일·워크플로)를 적는다. 지우지 않는다 —
자동 검사가 사라지면 다시 `active` 로 돌린다. P0 케이스의 은퇴는 Jay 가 확인한다.

## 케이스 쓰는 법

```yaml
  - id: BB-023
    journey: CUJ-1
    priority: P0
    targets: [desktop]
    title: 한 줄 요약
    requirements: [REQ-STUDIO-FREE-START, TUX-SP-14]
    steps:
      - 사용자가 하는 일, 순서대로
    expect:
      - 화면에 보이는 실제 문구를 그대로
    origin:
      kind: escaped-bug
      date: "2026-10-20"
      ref: "#2094"
    automated_by: e2e/trial-ux/run.mjs
```

- `id` 는 다음 번호. 지운 번호를 다시 쓰지 않는다.
- `priority`: **P0** = 막히면 사용자가 그 여정을 끝내지 못한다. P1 = 우회할 수 있지만 사용자가 알아챈다. P2 = 드문 경로·문구.
- `targets`: 선택. 생략하면 `[desktop]`. 복수 대상에 실제로 같은 동작이 있을 때만 예를 들어 `[ios, android]` 로 적는다. 대상 선택은 실행·수용 증거가 아니다.
- `requirements`: `REQ-` `TUX-` `US-` `PRA-` `NAT-` `AB-` `MFR-nn` `CGP-…-R-nnn` id. 적어도 하나. 이것이 `touched` 선택의 연결고리다.
- `origin.kind` 는 `design` 또는 `escaped-bug`(+ `date`, `ref`). `automated_by` 는 같은 것을 재는 자동 검사(선택). `status: 자동화됨` 은 은퇴 규칙을 따른다.
- 줄 끝 주석(`값  # 설명`)은 쓰지 않는다. 주석은 줄 전체로만 쓴다.

- 문구는 소스(`extensions/hypeproof-chat/`, `scripts/release/templates/`, `apps/studio-native/ios/`)에서 그대로 옮긴다. 추측한 문구로 기준을 세우지 않는다(.claude/rules/verification.md 규칙 1).
- 따옴표로 시작하는 값은 따옴표로 끝나야 한다. 날짜(`"2026-10-20"`)와 `#` 으로 시작하는 값(`"#2094"`)은 따옴표로 감싼다 — 다른 YAML 도구가 날짜 객체나 주석으로 읽는다. 파서는 YAML 의 일부만 읽고, 모르는 것은 오류로 낸다. 테스트가 PyYAML 결과와 대조한다.
- 고친 뒤 `node --test scripts/release/test/select-cases.test.mjs scripts/release/test/publish-gate.test.mjs` 를 공유 자원 래퍼로 돌린다.

## 매일 컷 멈추기

- **일시 정지:** 저장소 변수 `RELEASE_CUT_DAILY=off`
  (`gh variable set RELEASE_CUT_DAILY --body off --repo hypeproof/hypeproof-studio`).
- **dry-run 만:** `RELEASE_CUT_DAILY=dry-run` — 매일 범위·smoke·PR 본문 아티팩트만 만든다.
- **재개:** 변수를 지우거나 `create` 로 둔다.
- 손으로 돌리는 `workflow_dispatch` 는 변수와 상관없이 그대로 쓸 수 있다.

### Loud skips

A scheduled skip is quiet only when it is expected: paused, no app change, or a class that really is
live (`live_session`, `undecidable_session`). The `alarm` job turns the run red, opens or comments on
one issue titled "Daily release cut skipped: needs attention", and posts to `#alerts` when the
`DISCORD_WEBHOOK_ALERTS` secret is set, in two cases:

- the live check failed (`query_failed`, `bad_payload`, or no decision), for example a stale
  `HPS_ADMIN_PASSWORD` secret (HTTP 401 from `/admin/cohorts`);
- app changes have waited more than 48 h for an rc tag.

From 2026-10-25 to 10-28 the admin password rotation left this secret stale and the gate skipped three
days with green runs and no message; this section exists because of that.
