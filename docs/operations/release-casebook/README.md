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

## 하루의 흐름

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

릴리스마다 자동으로 고른다. 이유가 케이스마다 기록된다.

| 이유 | 조건 |
|---|---|
| `p0` | 모든 여정의 P0 케이스 전부 |
| `touched:<id>` | 마지막 안정 태그 이후 머지된 PR 이 건드린 요구사항 id 에 연결된 케이스. id 는 커밋 제목·본문(스쿼시 머지가 PR 제목과 본문을 담는다)과 요구사항 문서(`docs/studio-requirements.md`, `docs/requirements/`, `docs/dev/04-requirements.md`) diff 의 바뀐 줄에서 찾는다. 로컬 git 만 쓴다. 바뀐 id 가 케이스 id 의 하위(`REQ-L12-14` → `REQ-L12`)여도 걸린다 |
| `escaped:<날짜>` | 최근 14일 안에 추가된 유출 버그 케이스 |

`status: 자동화됨` 케이스는 고르지 않는다. 출력은 마크다운 체크리스트(PR 본문)와 JSON
(`cases.json`, `hps-release-cases/1`)이다. 컷 아티팩트에 둘 다 남는다.

```bash
node scripts/release/select-cases.mjs                      # 마지막 안정 태그..origin/main
node scripts/release/select-cases.mjs --json --today 2026-10-21
node scripts/release/select-cases.mjs --pr 2210 --json     # 릴리스 PR 본문의 범위·커밋 (gh 읽기 1회)
```

`--pr <번호>` 는 릴리스 PR 본문의 `Candidate commit` 과 `Range` 를 읽어 범위를 정한다. 본문에 그 줄이
없거나 형식이 다르면 멈춘다 — 기본 범위로 조용히 바꾸지 않는다. `--baseline`·`--candidate` 와 같이 쓰면
오류다. 모르는 옵션도 오류로 멈춘다.

케이스북이 깨져 선택이 실패하면 컷은 멈추지 않는다. PR 본문에 **케이스 선택 실패** 가 찍히고,
관리자는 `cases.yaml` 의 P0 를 전부 실행한다.

## 판정 규칙

- **P0 가 하나라도 FAIL 이면 승인하지 않는다.** 예외 없음. 고친 뒤 다음 rc 에서 다시 한다.
- P0 가 BLOCKED 면 승인하지 않는다 — 사람이 직접 실행해서 PASS 로 바꾸거나, 막힌 이유가 제품 밖(예: 결제 대행사 장애)임을 PR 에 적고 Jay 가 결정한다.
- P1 FAIL 은 이슈 번호를 적고 관리자가 판단한다. 승인하면 PR 에 이유를 남긴다.
- P2 FAIL 은 이슈만 남긴다.
- PASS 는 스크린샷이 있어야 PASS 다. 사전 테스트의 FAIL 은 깨끗한 프로필에서 한 번 다시 해 본 뒤의 FAIL 이다.
- 체크박스를 비워 둔 채 승인하지 않는다. 할 수 없었던 케이스는 `BLOCKED — 이유` 로 적는다.

## 유출 버그 규칙

**운영에서 발견된 버그를 고치는 PR 은 BB 케이스를 하나 추가한다.**

- `origin: {kind: escaped-bug, date: <발견일>, ref: "#<고친 PR>"}`.
- 케이스는 그 버그를 사용자 눈으로 다시 밟는 단계와, 고친 뒤의 실제 문구를 `expect` 에 적는다.
- 추가된 날부터 14일 동안은 P0 가 아니어도 매 릴리스에 뽑힌다. 그 뒤에는 우선순위와 요구사항 연결로만 뽑힌다.
- 리뷰어는 `fix(...)` PR 의 원인이 운영 발견인데 `cases.yaml` 변경이 없으면 고치라고 한다.

## 은퇴 규칙

CI 가 자동으로 같은 것을 재고, **그 자동 검사가 6개월 동안 한 번도 실패하지 않았으면** 케이스를
`status: 자동화됨` 으로 옮긴다. `automated_by` 에 그 검사(파일·워크플로)를 적는다. 지우지 않는다 —
자동 검사가 사라지면 다시 `active` 로 돌린다. P0 케이스의 은퇴는 Jay 가 확인한다.

## 케이스 쓰는 법

```yaml
  - id: BB-023
    journey: CUJ-1
    priority: P0
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
- `requirements`: `REQ-` `TUX-` `US-` `PRA-` `NAT-` `AB-` `CGP-…-R-nnn` id. 적어도 하나. 이것이 `touched` 선택의 연결고리다.
- `origin.kind` 는 `design` 또는 `escaped-bug`(+ `date`, `ref`). `automated_by` 는 같은 것을 재는 자동 검사(선택). `status: 자동화됨` 은 은퇴 규칙을 따른다.
- 줄 끝 주석(`값  # 설명`)은 쓰지 않는다. 주석은 줄 전체로만 쓴다.

- 문구는 소스(`extensions/hypeproof-chat/`, `scripts/release/templates/`)에서 그대로 옮긴다. 추측한 문구로 기준을 세우지 않는다(.claude/rules/verification.md 규칙 1).
- 따옴표로 시작하는 값은 따옴표로 끝나야 한다. 날짜(`"2026-10-20"`)와 `#` 으로 시작하는 값(`"#2094"`)은 따옴표로 감싼다 — 다른 YAML 도구가 날짜 객체나 주석으로 읽는다. 파서는 YAML 의 일부만 읽고, 모르는 것은 오류로 낸다. 테스트가 PyYAML 결과와 대조한다.
- 고친 뒤 `node --test scripts/release/test/select-cases.test.mjs` 를 돌린다.

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
