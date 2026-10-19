# Studio behavioral requirements

## Personal task workspace (#1756)

`REQ-STUDIO-TASK-WORKSPACE`: personal/trial activities can create, name, switch and
reopen separate tasks. Each preserves its full local transcript, unsent draft and
source selection independently of the bounded model context and telemetry
retention. Pending work or failed input persistence blocks navigation; stale task
and foreign activity messages cannot overwrite the active task. Storage errors
preserve original bytes and remain visible. Existing available history is imported
once without claiming older lost messages. Source opening uses the native browser,
only for citations in this task, and preserves composer focus. A pinned source is
not replaced by later citations. Classroom, account authority and shared Service
memory remain governed by their existing contracts.

[Design](design/task-workspace.md) and [TW/CP acceptance](testing/task-workspace.md)
separate filesystem/host/built-UI evidence from native, Windows and customer proof.

### Personal chat detail (CP-R1)

`REQ-STUDIO-CHAT-DETAIL` (CP-R1): personal chat aligns prose and its expanding
composer, makes live response/tool/source states legible and offers confirmed
answer copying. Incoming output must not pull a reader away from older content;
explicit latest/send resumes following. Motion is bounded, disabled under reduced
motion, and tied to real state. Enter/Shift+Enter/Korean IME, queue/stop and draft
recovery retain their existing meaning. Light/dark and 320px layouts must remain
usable. Visual acceptance is independently reviewed against the implementation
revision; functional test counts alone do not prove ChatGPT-level quality.

### Chat reference interaction (CG-IMPL-R1)

`REQ-STUDIO-CHAT-REFERENCE`: the personal composer starts at 52–64px on a desktop
viewport, expands for wrapping text or selected context, and keeps the same editor,
draft and caret. Every primary editing target is at least 44px. A tool menu exposes
only supported actions; unavailable search remains visibly explained. Selecting
web search is a request preference, never permission or proof that search ran.
The host checks current activity, runtime and tool grant before execution, narrows
the SDK tool set, preserves approval policy and refuses unsupported fallback.
Actual tool events and successful structured tool results alone establish search
activity and source links. Missing or failed search is stated plainly.

Tool mode belongs to one request: save it with the draft, parked message, user
turn and retry identity. A recovered message with a different mode remains a
separate, durable paused item; neither current draft nor mode is overwritten and
no error recovery silently starts a new run. Reject duplicate pending dispatches.

A message-level citation opens one contextual preview with its real title,
hostname and URL. It does not imply sentence-level attribution or fetched page
content. Previewing another citation leaves an existing pin intact. Native browser
opening and return acknowledge the current task, request and URL. Reuse only the
owned source tab; never close or reuse a foreign tab. Failed/stale opening cannot
produce a success state. Close, Escape and acknowledged return preserve draft and
reading anchor and restore focus to the exact citation. Narrow drawers contain
focus; reduced motion suppresses nonessential transitions.

Acceptance CG-01–CG-06 in [the verification contract](testing/task-workspace.md)
is revision-bound. Matched screenshots and independent interaction review are
required; local synthetic success is separate from live SDK/account, signed
release, Windows and physical IME acceptance. No whole-product parity claim is
inferred from these selected flows.

## Curriculum runtime proposal — 2026-09-29

`REQ-STUDIO-CURRICULUM-RUNTIME`: Studio executes the AI for Good v5 loop
(Problem → Hypothesis → Build → Test → Evidence → Decision → Product Change →
Deck Change) with one HypeProof account. The embedded browser becomes an
Experiment Browser the agent can observe and operate; "Test my product" verifies
observable criteria against a specific artifact version; verified versions are
published as immutable, revocable test links; participant events and notes become
sourced evidence on the existing measurement-core store (SX-48, no second store);
Venture Memory keeps hypotheses, experiments, decisions and versions; curriculum
skills, a cached Weekly Review Pack and an evidence-aware HTML deck close the loop.
Student apps call AI through capability names without provider keys; MU-02 stays,
so there is no automatic cross-provider substitution. Source: HypeProof Studio
Curriculum Runtime PRD v1.0 (2026-09-28), preserved at
[design/curriculum-runtime-prd-v1.0-2026-09-28.md](design/curriculum-runtime-prd-v1.0-2026-09-28.md).
[Intent INT-CR-00–09](intents/curriculum-runtime.md),
[CR-01–84 requirements](requirements/curriculum-runtime.md),
[CR-T01–T80 validation](testing/curriculum-runtime.md),
[plan, DAG and gap matrix](plan/curriculum-runtime.md),
[epic #1388](https://github.com/jayleekr/hypeproof-studio/issues/1388).
Status: criteria proposed; implementation, runtime and human acceptance NOT RUN.
New behaviour ships behind a switch that is off by default (CR-02).

## Learning experience revision — 2026-09-18

`REQ-STUDIO-LEARNING-EXPERIENCE`: the student's default screen shows the current
task, customer and artifact; the coach asks and hints instead of answering;
evidence (criteria, reasons, before/after, real vs simulated) is captured in
the flow; reflection opens only at submit, session end and week end; no
capability score, level or badge appears on a work screen; six-week content is
session-design data, never code. Source: Jay's 2026-09-18 UI/UX design
philosophy. [Intent INT-SX-00–10](intents/studio-learning-experience.md),
[breakdown](design/ux-principles-breakdown-2026-09-18.md),
[SX-01–60 requirements](requirements/studio-learning-experience.md),
[design](design/studio-learning-experience.md),
[SX-T validation](testing/studio-learning-experience.md),
[plan and DAG](plan/studio-learning-experience.md).
Status: criteria proposed; implementation, runtime and human acceptance NOT RUN.
Overnight execution governance: `.claude/hypeproof/ux/`.

## Measurement core proposal — 2026-09-13

`REQ-STUDIO-MEASUREMENT-CORE`: extract the existing observation/evidence/interpretation
implementation into a common core consumed by Studio, Claude Code and Codex.
Jay's real product work is the first use case, with local review, submission receipts
and a follow-up improvement. New work uses the six-item model selected by Jay;
legacy seven-item evidence remains readable in its original model.
[Intent](intents/measurement-core.md), [MC-01–48 requirements](requirements/measurement-core.md),
[MC-T01–24 validation](testing/measurement-core.md),
[epic #1020](https://github.com/jayleekr/hypeproof-studio/issues/1020).
Status: criteria proposed; runtime and human acceptance NOT RUN. Existing classroom
policies and deployed legacy clients are unchanged by this documentation.

## Native trial revision — 2026-09-08

`REQ-STUDIO-NATIVE-TRIAL`: a participant enters the existing Studio application
with an individually scoped participation token and performs real work through
the existing model gateway and SDK tools. Asset observations must cite participant
decisions and executed outcomes; authored web choices and assistant keyword scores
are not evidence of this requirement. [Intent, NAT-01–12 and release gates](requirements/studio-native-trial.md).

The native implementation includes host event capture, separate observation API/UI
and individual trial grants. [Executed laptop evidence](testing/studio-native-trial-results-2026-09-08.md) records results and remaining release gates. The profile stays hidden
from public issuance until the applicable gates are satisfied.

> **Spec version:** v0.3.3
> **Last reviewed:** 2026-08-19
> **Live tracker:** [epic #200](https://github.com/jayleekr/hypeproof-studio/issues/200)
> **Philosophy anchor:** [docs/seven-assets.md](./seven-assets.md) — 7 AI Native Assets; chat-panel features follow [METAPLAN §4.5](../METAPLAN.md).

This file is the **contract** for what HypeProof Studio (the IDE-side bundle: `extensions/hypeproof-chat/` + the built `.app`) must do. The companion epic carries live status (🟢/🟡/🔴), this doc carries stable behavior.

Two artifacts, two audiences:

- **Epic (#200)** — current workshop gate and status-changing tracker
- **This doc** — contract, stable, PR-reviewable

When a PR touches Studio behavior, update this doc and link the relevant tracking issue in the same commit.

---

## Test layer policy

| Layer | Where | Tool | When to use |
|---|---|---|---|
| **U** — Pure unit | `extensions/hypeproof-chat/test/*.smoke.mjs` | `node --experimental-strip-types` + `node:assert` | Pure functions; regex/validation/hash/CSP strings; anything that can be extracted to `xxxHelpers.ts` (no `vscode` import) |
| **E** — Electron e2e | `e2e/tests/*.spec.ts` | Playwright Electron driver | Actual `.app` + webview round-trip; UI shape; user-driven flows; cross-process interactions |
| **R** — Rehearsal smoke | `tests/rehearsal/*.test.mjs` | Node 22 `node --test` | Live worker contract (prod or wrangler dev); HTTP shape; token lifecycle |
| **M** — Manual | `scripts/install-mac.sh` + click checklist | Human | Branding integrity (until fully scripted), data folder, signed install, things that need eyeballs |

Default to the leftmost (cheapest) layer that can pin the requirement.

When in doubt:
- Function with no `vscode` dependency → **U**
- DOM / focus / cross-frame postMessage → **E**
- Worker HTTP contract → **R**
- Build artifact properties → **M** (until `verify-branding.sh` style scripts cover it)

---

## A. Lifecycle & autoOnboard

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-A1 | 첫 수업 시작 시 작업 폴더 준비 | 시작 클릭마다 Service 인증·세션을 다시 확인한다. 만료/권한/연결 실패를 표시하고, 중복 시작을 막으며 성공 시 코치 진입 안내를 표시한다 (#756). 사용자가 시작 화면에서 수업 시작을 누르면 profile workspace_root와 기존 workspace routing을 적용한다. 기존 파일을 보존한다. `workspace_start: empty`인 일반 체험과 미확인 프로필은 폴더만 준비하며, 알려진 legacy 웹 수업만 시작 HTML을 생성한다 (#842). NAT-03에 따라 모호한 요청에는 불필요 파일 도구를 실행하지 않는다 | E + U (`workspace-preparation.smoke.mjs`, `native-trial-entry.spec.ts`) |
| REQ-A2 | 사용자의 workspace trust 설정 보존 | 시작 및 폴더 생성 시 security.workspace.trust.enabled를 자동 변경하지 않는다 | E |
| REQ-A3 | 브랜드 시작 화면 | 기존 편집기를 닫지 않고 시작 화면을 연다. 빈 창은 단일 편집 영역으로 정리한다 | E |
| REQ-A4 | 토큰 없는 첫 실행 | 중립적인 시작 화면에서 참여 코드를 입력한다. QuickInput 자동 호출과 아동 코치 fallback 노출 없음 | U + E |
| REQ-A5 | 저장된 연결 오류 | 원인별 오류와 재입력 화면을 제공하고 기존 시크릿은 보존한다 | U + E |
| REQ-A6 | 코치 네이밍 카드 표시 조건 | `profile.ux.coach.naming_mode != "fixed"` + `coach.configured == false` 일 때만 webview 카드 렌더 | E |
| REQ-A7 | 테스트 백도어 | `HPS_TEST_TOKEN` env / `hps-test-state.json` 파일 / 로컬-only `/tmp/hps-token.txt` 셋 다 동작 (prod proxyUrl 일 땐 dev backdoor 무시) | U |
| REQ-A8 | 수업 시작 클릭 시 코호트 폴더로 전환 | 폴더가 이미 열려 있어도 프로필의 `workspace_root` 가 **다른** 곳을 가리키면 그쪽으로 창을 옮긴다. 이전 동작(폴더가 열려 있으면 무조건 no-op)은 VS Code 의 마지막-창 복원과 맞물려 고착을 만들었다: 한 번 `~/HypeProofGames` 가 열리면 이후 어떤 코호트 토큰도 폴더를 못 바꾸고, 코치 cwd 는 열린 폴더 우선(`resolveCoachCwd`)이라 성인 코호트가 아이들 게임 폴더에서 수업을 했다. 판정은 `decideWorkspaceSwitch` (pure): 열린 폴더 없음 → 최초 open 경로 · `workspace_root` 없음/상대경로 → 유지 · 이미 그 폴더(멀티루트면 루트 중 하나) → 유지 · e2e 런(`HPS_TEST_E2E`) → 유지(픽스처가 폴더를 소유, #42). 전환 후에는 리로드 뒤 토스트로 알린다 — 폴더가 조용히 바뀌면 학생은 "내 파일이 사라졌다"로 읽는다 | U (`test/workspace-routing`) |
| REQ-A9 | 폴더 전환은 리로드 루프를 만들지 않는다 | 이 기능의 실패 모드는 "안 갈아탐"이 아니라 **무한 리로드**다 (`openFolder` → 리로드 → 재판정). 방어 2겹: ① 동일성 판정을 `path.relative(canon(a), canon(b)) === ""` 로 — win32 대소문자·드라이브 문자를 흡수해야 한다(실측: VS Code 는 `c:\…` 소문자로 주고 `os.homedir()` 는 `C:\…` 대문자라, 단순 문자열 비교였다면 **Windows 전 머신이 매 기동마다 리로드**했다). canonicalize 는 realpath 주입이라 심링크/리다이렉트된 홈도 흡수(#384); ② 전환 직전 목적지를 `hypeproofChat.workspaceSwitchAttempt`(globalState)에 기록하고, 리로드 후에도 그 폴더가 안 열렸으면 **재시도하지 않는다** — 열 수 없는 root 는 한 번만 실패한다. 착지(또는 포기) 시 마커를 지워 다음 코호트 변경이 실패한 재시도로 오인되지 않게 한다 | U (`test/workspace-routing`) |

## B. Token & profile

Adult instructor practice (`homepage-practice-s1`, #737) uses a separate `homepage-practice` cohort and `~/HypeProofHomepagePractice` workspace. It explicitly enables existing website read/write/browser/shell tools with the existing approval gate; subagents, publishing, raw-message logging and session-log upload remain disabled. The profile smoke contract checks these boundaries. This does not automatically activate a saved Chalk course or renew credentials.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-B1 | 수업 연결 happy path | 입력값 정리 → profile API 검증 → SecretStorage 저장 → 실제 수업·코치 확인 → 명시적 수업 시작 | U + E |
| REQ-B2 | 명시적 연결 해제 | 연결 해제 버튼만 시크릿을 삭제한다. 빈 입력은 제출 불가. 파일과 대화 기록은 보존 | U |
| REQ-B3 | 수업 연결 API 검증 | 200 + valid shape만 저장. 401/403/network/timeout은 원인별 인라인 오류이며 기존 연결을 유지 | U + E |
| REQ-B4 | `hasToken` UI 상태 동기화 | secrets 변화 → `postConfig` → webview 헤더 pill 갱신 | E |
| REQ-B5 | Auth error 분류 (4 sub) | 401/expired·missing → 재-prompt. 403/session_inactive·session_window·not_in_roster·mismatch → 친절한 토스트 (raw JSON 노출 금지) | U + R |
| REQ-B6 | 첫 실행 토큰 실패는 **원인**을 말한다 (#381) | `fetchProfile()` 이 모든 실패를 `null` 로 뭉개서 만료·강사토큰·모르는 회차·서버다운·네트워크단절이 한 문장("확인이 안 돼요")으로 보였다 — 신규 참가자가 스스로 풀 방법이 없어 강사를 불러야만 했다. 계약: ① worker `GET /v1/profile` 의 **모든** 실패가 `error.code` 를 싣는다 — 401 `expired`/`malformed`/`signature`, issuer 토큰은 `wrong_role`(401, 기존엔 `p` 가 placeholder 라 400 "unknown profile" 로 떨어졌다), 모르는 프로필은 400 `unknown_profile`. `request_id` 동봉(#49); ② 클라이언트 `fetchProfileResult()` 가 `null` 대신 `ProfileFailure{reason,friendly,status,requestId}` 를 돌려주고 `classifyProfileFailure` 가 원인별 문장을 고른다. **401 이 `expired` 가 아니면 만료를 단정하지 않는다** (REQ-M13 이 태운 이틀); ③ 강사 토큰은 네트워크 이전에 로컬에서 판정(`looksLikeIssuerTokenUnverified` — payload `role:"issuer"` 또는 `__issuer__` placeholder). **진단 전용, 게이트 아님** — 저장도 하지 않고 재입력을 준다(저장하면 채팅 못 하는 토큰에 "Token ✓" 가 뜬다); ④ 붙여넣기 형식 오류(`looksLikeWorkshopToken` 불일치)가 서버 원인보다 우선 — 서버까지 못 간 실패다 | U (`test/profile-failure`) + R (`worker/test/chat-integration`) |
| REQ-B7 | 세션만 열면 roster 는 비어 있다 (#381) | `POST /admin/cohorts/:id/session` 은 세션 시작 **only** — roster 는 별개 키라, 이 엔드포인트로 수업을 열면 정상 발급된 학생 토큰도 전부 `not_in_roster` 로 막힌다(원인을 수업 중 학생 입으로 알게 됨). 응답에 `roster_size` 를 싣고, 0 이면 `warning` 으로 `not_in_roster` 위험 + `/session/open`(guard→mint→roster→start) 경로를 명시한다. roster 가 이미 차 있으면 warning 없음(잡음 금지) | R (`worker/test/smoke.mjs` §issuer-self-service) |
| REQ-B8 | 커리큘럼은 배포가 아니라 배포판이다 — 모듈 층 (dag task H) | 코호트 시스템 프롬프트(`prompts/<cohort>.md`)는 **Module 층**(`m*`)이다: 워커 바이너리에 컴파일된 사본은 폴백일 뿐이고, 실서빙 텍스트는 KV 의 `module:curriculum:<profile_id>:pin` 이 가리키는 불변 버전 문서(`hps-module/1`, `lib/modules.ts`)다. 계약: ① **핀 없음 → 컴파일 텍스트**, 버전은 `compiled:<sha256[:12]>` — 발행 전에도 턴이 귀속된다(조용함, 정상 상태); ② **핀 → 그 버전의 `system_prompt` 로 교체**, 나머지 프로필(정책·안전 플래그·UX)은 컴파일본 그대로 — 하네스 게이트를 우회하지 않는다; ③ **커리큘럼 교체에 코드 배포 없음** — `npm run module -- publish\|pin\|unpin\|status`(wrangler kv) 만으로 1~2분 내 전 PoP 반영, 롤백 = 이전 버전 재핀(핀 레코드가 `previous` 를 든다); ④ **음성 대조군 — 잘못된 모듈은 자기만 끈다**: 검증(봉투·`m*` 버전·sha256·길이 밴드) 실패 시 `previous` → 컴파일 순으로 폴백하고, `console.error` 한 줄(핀 갱신당 1회) + Analytics `module_fallback` 데이터포인트 + 응답 헤더 `x-hps-module-fallback` + 사용 행 blob[6] 으로 **보이게** 한다. 빈 프롬프트는 절대 서빙하지 않는다(REQ-M30 계열 — 무성 폴백 금지). 형제 프로필은 영향 없음; ⑤ **양성 대조군 — 프롬프트 캐시**: 프리픽스는 버전당 바이트 동일, 버전 문자열은 프리픽스에 들어가지 않으며, KV 일시 장애에도 마지막 관측 핀을 유지해 프리픽스가 요동치지 않는다(실측: 교체 직후 1회 miss 후 `cache_read_input_tokens > 0`); ⑥ **턴 기록에 버전이 있다** — 두 LLM 경로 모두 Analytics blob[5]=서빙 버전, 응답 헤더 `x-hps-module`, `GET /v1/profile` 의 `module:{version,source,fallback}`. `usage_log` D1 컬럼은 마이그레이션이 사람 게이트라 이 태스크에 없다(후속); ⑦ **텍스트에 사는 하네스 규칙은 텍스트와 함께 간다** (attempt 2): `rules.yaml child.required_prompt_phrase`(CI `child_missing_url_ban`, fail)는 프로필 키가 아니라 **프롬프트 문장**을 검사하므로, 프롬프트가 런타임 로드가 되는 순간 CI 를 우회했다. 워커가 `lib/harness-rules.ts` 로 **같은 rules.yaml 을 읽어**(validate.py 파서의 포트, 파서 동치는 테스트가 잠근다) 하네스 기준 아동 코호트(`parent_coaching` 또는 `age_range[1] ≤ child_age_max`)의 모듈에 그 문구를 요구하고, 없으면 sha256 불일치와 똑같이 거부·폴백·공지한다. 발행기는 같은 함수로 쓰기 전에 거부한다(빠른 피드백일 뿐, 보증은 워커). 두 번째 사본은 없다; ⑧ **모든 저하 상태가 기록에 남는다**: 폴백 `cause ∈ missing·malformed·bad_pin·transport` — 잘못된 핀 레코드와 KV 장애도 `module_fallback` 데이터포인트(blob[5]=cause)와 턴 기록의 `fallback` 을 남기며, transport 는 "bad publish 가 아니다"라고 말한다. transport 시엔 컴파일본이 아니라 **마지막으로 서빙한 모듈**을 다시 낸다(프리픽스 무요동 — 핀 읽기·문서 읽기 모두). ⑨ **규칙이 사라지는 것과 규칙을 통과하는 것은 다르다** (#692·#693): ⑦의 보증은 `rules.yaml` 의 한 줄과 호출자가 넘기는 인자 하나에 걸려 있었다. 둘 다 없어지면 양쪽 검사기가 동시에 "요구사항 없음"이 되어 **아무것도 빨개지지 않는다**. 이제 ⓐ `rules.yaml` 이 `required_keys` 로 자기 필수 키를 선언하고, `validate.py` 는 그것이 비면 **exit 2**(규칙 파일이 깨졌다 — 프로필 위반인 exit 1 과 구분)로 죽으며, 워커는 아동 코호트의 발행 모듈을 **문구가 맞더라도 거부**하고 컴파일본으로 폴백한다(검사할 수 없음 ≠ 통과). `required_keys` 블록 자체의 존재는 양쪽 코드가 주장한다. **같은 모양을 전수로 훑었다**(#692 의 마지막 요청): `validate.py` 가 읽는 모든 rules 키 대비 `severity: fail` 규칙을 대조해 하나를 더 찾았다 — `publishing_promise_contradiction` 이 읽는 `publishing.promise_phrases` 다. 목록이 사라지면 히트 0건으로 조용히 통과한다(실증: 발행이 꺼진 프로필이 공개를 약속해도 exit 1 → exit 0). 이제 `required_keys` 에 있다. `deferral_markers` 는 사라지면 오히려 더 엄격해지므로(완화 신호 소실) 대상이 아니고, `severity` 블록의 개별 항목은 `add()` 기본값이 `fail` 이라 안전하다. **CI 키와 서빙 관문을 가른다** — 워커는 `child.` 접두 키만 유도하므로 `publishing.promise_phrases` 가 비어도 수업은 계속 돈다. 빌드를 세우는 것과 교실을 세우는 것은 다른 사건이다. ⓑ `validateModuleDoc` 의 `requirements` 는 선택 인자가 아니라 `profile_id` 에서 **유도**된다 — 넘기지 않는 호출자(`lib/lesson-delivery.ts`·`lib/native-assessment.ts`)가 이미 존재했고, 잊는 것이 가능한 인자는 언젠가 잊힌다. 명시적 `null` 만이 "텍스트 규칙 없음"이고, 분류할 수 없는 profile id 는 거부한다. 성인 코호트는 아동 키 상실에 영향받지 않는다(대조군). 컴파일 상태로 남긴 것: `_*.md` 계약 문서(코드 불변식을 서술하므로 코드와 롤백 단위를 공유), 프로필 정책 객체, skills·skeletons(코호트 간 공유 — 핀 모델이 프로필 단위) | U (`worker/test/module-distribution.test.mjs` — 형식 드리프트 락 · 양성/음성 대조군 · 두 경로 e2e; `worker/test/module-child-guard.test.mjs` — 심은 정답(문구 없는 아동 모듈은 워커·발행기 모두 거부) · rules.yaml ⇄ 워커 파서 동치 · validate.py 와 같은 판정) |

## C. Chat round-trip

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-C1 | SSE 스트리밍 round-trip | `안녕` → 30s 내 한글 응답 + streamEnd | E |
| REQ-C2 | 코치 헤더 URL-인코딩 | 한글 코치 이름·인격 → `x-hps-coach-name` 가 `encodeURIComponent` 적용된 byte-safe 값 | U |
| REQ-C3 | History 영속화 (workspaceState) | 최대 200 turn 유지, 패널 reload 후 복원, 별도 workspace 에선 보이지 않음 | E + U (clampHistory) |
| REQ-C4 | Clear conversation 명령 | workspaceState 비움 + 빈 history push | E |
| REQ-C5 | Retry message | 직전 user prompt 그대로 다시 전송, history 에 새 assistant turn append. **(#358)** 실패 턴에 첨부 이미지가 있으면 `retryMessage.images` 로 재첨부(단발성이라 in-memory 메시지에서만 읽음) → 코치가 스크린샷을 다시 받음 | E |
| REQ-C6 | Cancel in-flight stream | Stop → `cancelStream` → `AbortController.abort()` **그리고 호스트가 `streamStopped` 를 post** (#497). 이전 계약은 "streamEnd 도착하지 않음"이었는데, 그 상태를 푸는 메시지가 **아무것도** 없어서 웹뷰가 스트리밍 상태에 영구히 갇혔다 — Stop 이 먹통으로 보이고, 이후 입력은 REQ-C16 큐에 park 된 뒤 `streaming → idle` 엣지가 오지 않아 영영 flush 되지 않았다(2026-07-06 `2ae96bd` 회귀, 3주간 미검출). `streamStopped` 는 streamEnd 와 같은 상태 해제를 하되 **오류가 아니다** — `streamError` 배너("문제가 생겼어요" + 🚨 신고하기)는 정상 조작을 사고로 만들므로 쓰지 않고, 조용한 인라인 안내(`.hps-stop-notice`)로 "답변 생성이 중지되었습니다. 다시 채팅을 입력해주세요." 를 띄운다. 안내는 다음 턴 시작(`streamStart`) 또는 재입력(`userSent`) 시 사라진다. 잘린 턴을 히스토리에 커밋하지 않는 것은 REQ-M8 그대로 | E |
| REQ-C7 | Webview crash 복구 (S-04 #48) | React render-time error → ErrorBoundary fallback + `webviewError` 호스트 로그 | E |
| REQ-C8 | request_id 가 error banner 에 표시 (S-07 #49) | 스트림 실패 시 `x-request-id` 8글자가 webview ErrorBanner 에 노출 | E |
| REQ-C9 | Show-intent 단축 | "게임 보여줘"/"실행해" 같은 짧은 비-create 입력 → LLM 호출 없이 마지막 게임 preview 재오픈 | U + E |
| REQ-C10 | 이미지 붙여넣기 첨부 (website-copyclone) | **profile `input.image_paste=true` 일 때만**: 입력창에 이미지 클립보드 paste(⌘V) → data URL 썸네일이 입력 영역에 표시 + × 로 제거 가능. image-only(텍스트 없이)도 전송 가능. 텍스트 paste 는 항상 기존 동작 유지(preventDefault 안 함) | E |
| REQ-C11 | Current-turn image injection; explicit re-reference | History remains text-only: thumbnails/image blobs are neither replayed automatically nor persisted as conversation state. A current-turn image is sent as actual SDK/proxy image blocks. REQ-C18 may persist workspace assets and plain path notes. Under REQ-STUDIO-REFERENCE-IMAGES, an explicit request to inspect an earlier image creates a fresh current-turn read of the active activity's referenced workspace file under its current image-analysis permission; a changed/deleted/denied file never resurrects cached pixels. Ordinary follow-ups carry no prior image blocks. | U (`reference-images.smoke.mjs`, `reference-transport.test.mjs`) + E (candidate/installed execution required) |
| REQ-C12 | 이미지 입력 sanitize + 캡 (worker) | `translate()` 가 OpenAI `image_url` → Anthropic image 블록(data URL→base64 source, http(s)→url source) 변환. `data:image/{png,jpe?g,gif,webp}` + http(s) 만 허용, `file:`/`javascript:` 등은 drop. 턴당 최대 4장·data URL 6.5M자 상한. 이미지 없는 array 는 string 으로 collapse(legacy shape 유지) | U |
| REQ-C13 | 이미지 입력 profile 게이트 (default OFF) | `Profile.input.image_paste` 미설정/false 면 (1) 웹뷰 paste 핸들러가 텍스트 전용으로 동작 + (2) **워커가 `filterMessages` 에서 image 블록 server-side strip** (클라가 보내도 차단). 현 3개 cohort 전부 OFF — 미성년 cohort 가 이미지 흐름에 노출되지 않음. `/v1/profile` 이 resolved boolean 으로 노출 | U |
| REQ-C14 | AI 상호작용 고지 (세션 시작) (#320) | Anthropic Usage Policy — consumer-facing chat 은 최소 세션 시작 시 "AI 와 대화 중" 고지. `AiDisclosureGate`(호스트측): 세션 첫 webview mount 에서 1회 + history clear 직후 재고지; 같은 세션 내 hide/show remount 에는 미재노출. 문구는 오답 가능성·확인 권고 문장 포함(ToS §D.3, verification_reflex). webview 는 메시지 리스트 상단에 `role=note` + `aria-live=polite` 배너로 렌더 | U (`test/ai-disclosure`) |
| REQ-C15 | 요청-shaped 업스트림 4xx 분류 (#358) | worker `/v1/chat` 이 업스트림 4xx(400/413/422/429)를 502 로 뭉개지 않고 **실제 status + sanitized `type`** 으로 통과(raw prose 는 로그만; `routes/messages.ts` PASSTHROUGH_4XX 와 동형). 클라는 `friendlyTransportMessage(status)` 로 413→"이미지가 너무 커요" 친절 메시지, 그 외는 generic 카드. 5xx/네트워크는 여전히 502 | U (`test/proxy-transport-friendly`) |
| REQ-C16 | 응답 중 입력 + 예약 전송 (#416) | 입력창은 스트리밍 중에도 **절대 `disabled` 가 아니다**. 프록시 턴 20~30 s 시절엔 티가 안 났지만 agent-sdk 턴은 실측 5~10분(실강의 9분 사례) — 그동안 참가자는 떠오른 것을 적어둘 수조차 없었다. **적어두지 못한 생각은 사라진다 (iteration_reflex 직접 방해).** 계약(pure `webview-ui/src/sendQueue.ts`): ① `decideEnter` — 유휴면 즉시 전송(기존 그대로, 이미지만 있어도 전송), 스트리밍 중 Enter 는 **예약**; ② 예약은 **정확히 1건** — 다시 Enter 하면 교체(먼저 친 문장 소실)도 무한 큐(다음에 뭐가 갈지 예측 불가)도 아닌 **줄바꿈 덧붙이기**로 한 건에 누적; ③ `shouldFlushQueue` — 자동 전송은 `streaming → idle` **엣지에서만** (스트림이 열린 채 flush 하면 `submit()` 자체 가드에 걸려 **에러 없이 증발**); ④ `draftAfterStop` — Stop·예약취소는 예약 문장을 입력창으로 되돌린다(예약 이후 더 친 문장은 그 아래에 순서대로). **강사가 원격으로 끊은 turn도 같다(#751 U4, `shouldRestoreQueue`)** — 끊긴 turn의 끝에서는 flush 하지 않는다: 강사가 멈춘 순간 학생이 아직 보내지 않은 문장으로 새 AI 실행이 시작되면 안 된다. 어떤 경로로도 사용자가 친 글자를 버리지 않는다; ⑤ 한글 IME 조합 중 Enter 는 여전히 전송/예약이 아님(`composing`·`isComposing`·keyCode 229 유지); ⑥ Send 버튼은 기존대로 스트리밍 중 Stop — 예약은 Enter 경로 전용. 화면엔 "다음에 보낼 메시지" 한 줄 + × (× 는 삭제가 아니라 되돌리기) | U (`test/send-queue`) |
| REQ-C17 | 대화와 툴 실행은 하나의 타임라인 (#503) | 실행은 말풍선 → 툴 → 말풍선 순서로 일어나는데 화면은 [말풍선 전부] 아래 [툴 전부] 두 덩어리였다 — 참가자가 "코치가 무슨 말을 하고 나서 무슨 일을 했는지"를 읽을 수 없다(**verification_reflex** 정면 훼손: 확인하려면 말과 행동이 시간 순으로 붙어 있어야 한다). 원인은 리듀서가 `messages[]` 와 `toolLog[]` 두 배열로 갈라 담은 것(교점 없음)이고, 같은 뿌리에서 두 번째 결함이 나왔다 — `streamStart` 의 `toolLog: []` 때문에 **다음 턴이 시작되는 순간 직전 턴의 툴 기록이 통째로 증발**. 계약(pure `src/chatTimeline.ts`, 호스트·웹뷰가 **같은 리듀서**를 돌린다 — 규칙이 두 벌이면 창을 다시 열 때 순서가 달라진다): ① 툴 도착 시 열린 말풍선을 닫고 `role:"tool"` 아이템을 그 자리에 넣으며, 다음 델타가 **새 말풍선**을 연다 → `[말풍선]→[툴]→[말풍선]`; ② 같은 id 는 제자리 갱신(running → done/error) — 줄이 늘면 같은 툴을 두 번 실행한 것처럼 보인다; ③ **코드펜스가 열려 있는 동안 도착한 툴은 보류**했다가 펜스가 닫힐 때(또는 턴 종료 시) 흘려 넣는다 — 펜스가 두 말풍선에 걸리면 `extractRenderableHtml` 이 못 찾아 자동 프리뷰(REQ-D2)가 죽는다; ④ 툴 줄은 대화 기록의 일부라 턴이 넘어가도 남고 workspaceState 에 함께 저장된다(창을 다시 열어도 보인다). `Clear`/history 는 대화와 툴을 **함께** 비운다; ⑤ **모델에 나가는 히스토리에는 `role:"tool"` 이 절대 들어가지 않는다**(`modelHistory()` — 호스트 진입점 + `proxyClient` 이중 방어); ⑥ 순서의 출처는 단일 postMessage 채널의 도착순이다(별도 시퀀스 번호 없음) — 2026-07-28 벤더 SDK 0.3.207 실측에서 assistant 메시지 12/12 의 `message.content` 길이가 1이라 한 이벤트가 텍스트와 툴을 동시에 내지 않는다. 툴 줄의 `createdAt` 은 SDK 가 실어 보낸 `timestamp`; ⑦ DOM 클래스(`.hps-tool-log-line`/`.hps-tool-icon`/`.hps-tool-label`/`.hps-tool-<state>`)는 e2e·관측기 셀렉터 호환으로 **유지**, 컨테이너 `.hps-tool-log` 는 삭제; ⑧ 히스토리 상한(REQ-C3, 200)은 **말한 것(user/assistant) 기준**으로 센다(`clampTimeline`) — 전체 메시지 수로 세면 SDK 턴 한 번의 툴 수십 줄이 대화를 통째로 밀어낸다 | U (`test/chat-timeline` — 양성/음성 대조군) + E |
| REQ-C18 | 붙여넣은 이미지를 워크스페이스 파일로 남긴다 (#421) | 붙여넣기는 모델로만 가고 **디스크에는 안 남았다** — 그래서 코치가 `<img src>` 로 걸 대상이 없어 참가자에게 "파일로 저장해 주시겠어요?" 라고 일을 떠넘겼다(2026-07-24 실강의 실측 발화). 워크숍에서 참가자가 원하는 건 대개 "이 사진을 우리 홈페이지에 넣어줘" 이고, 그러려면 파일이 어차피 필요하다. 계약(pure `src/pastedImages.ts` + 호스트 `savePastedImages`): ① 그 턴에 첨부된 이미지를 `<작업폴더>/assets/pasted-<YYYYMMDD-HHMMSS>-<n>.<ext>` 로 쓴다 — 작업 폴더는 `resolveCoachCwd()`(라이브 서버가 서빙하는 루트와 동일), 그래서 상대경로 `assets/…` 가 페이지에서 바로 뜬다; ② **mime 화이트리스트**(`image/{png,jpeg,webp,gif}`)를 통과한 base64 data URL 만 저장 — `image/svg+xml`·`text/html`·비-base64·비-data URL 은 전부 거절(값의 출처가 샌드박스 웹뷰다); ③ 파일명은 시각+순번+mime 확장자로만 조립 — **참가자·모델 문자열이 파일명에 닿는 경로가 없다**(경로 이탈 불가). 같은 초 충돌은 접미사를 올려 가며 피한다(덮어쓰면 참가자가 앞서 붙인 사진이 소리 없이 사라진다); ④ 저장한 경로를 `<pasted-images>` 블록으로 현재 턴의 모델 입력과 활동별 text history에 남긴다 — 프록시·SDK 두 런타임이 같은 문구를 본다. 이미지 바이트는 history에 저장하지 않으며, 명시적 후속 재참조는 REQ-C11/REQ-STUDIO-REFERENCE-IMAGES의 새 파일 읽기다. 문구는 존재를 사실로 알리고 "저장해 달라"는 되묻기를 명시적으로 막는다; ⑤ 화면에도 저장 사실을 남긴다(`toolLog` 한 줄) — 조용히 저장하면 참가자도 코치도 확인할 근거가 없다(REQ-C17 과 같은 이유); ⑥ 실패는 삼키지 않는다 — 저장 못 한 장수를 한 줄로 알리고 그 턴의 문구를 비운다(코치가 없는 파일을 있다고 믿는 것보다 낫다); ⑦ **저장 대상은 참가자가 붙인 이미지뿐**이다 — #278 의 페이지 캡처(`pendingPageImage`)는 참가자가 간직하겠다고 붙인 자료가 아니라 브라우저 캡처라 저장하지 않는다. **승인 게이트와의 관계**: 이건 모델발 쓰기가 아니라 참가자 자기 자료의 호스트측 보관이라 `resolveActionApproval` 모달을 태우지 않는다 — `saveGameToWorkspace`(index.html)·`saveAgentMdIfPresent`(agent.md) 와 같은 계열이고, 그 정책의 핵심인 "워크스페이스 밖 절대경로 금지"는 ③ 으로 구조적으로 성립한다 | U (`test/pasted-images` — 양성/음성 대조군) |
| REQ-C19 | Error banner frames an ended personal trial as account state, not connection loss (trial diagnosis 2026-10-18; TUX-COND, CU-13) | `webview-ui/src/errorBannerPresentation.ts`: a sentence that states the trial ended or was spent (`개인 체험 시간이 끝났습니다…` from `trial_expired`, `개인 체험의 총 요청 한도에 도달했습니다.` from `trial_exhausted`) renders ⏳ `체험이 끝났어요`. Before, "시간" matched the connection pattern and the banner said 🔌 `연결이 끊겼어요`, inviting a retry that cannot succeed. Pass copy (`이용권`) keeps the REQ-L12 🎟️ frame; real network/timeout failures (incl. `timed out`) keep 🔌; "busy or exhausted" copy that cannot prove the ending is not claimed as an ending. Positive rows + network negative controls: `test/error-banner-presentation.smoke.mjs` | U |

## D. Preview / Run

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-D1 | ▶ Run last code 명령 | 마지막 assistant turn 에서 ` ```html ` / `<!doctype>` / ` ```js ` 추출 → preview 패널 오픈 | U + E |
| REQ-D2 | HTML 자동-reveal | assistant 스트림에 HTML 포함 → 별도 클릭 없이 preview 자동 오픈 (Taste 감탄) | E |
| REQ-D3 | Preview iframe 샌드박싱 | `sandbox="allow-scripts allow-pointer-lock allow-modals"` 만. `allow-same-origin`/`allow-top-navigation` 금지. CSP `connect-src none` | U (cspBuilder) + E |
| REQ-D4 | Preview 패널 재사용 | 두 번째 render → 새 WebviewPanel 아니라 기존 panel.reveal | E |
| REQ-D5 | 게임 저장 (workspace `index.html`) | preview 오픈 시 자동으로 workspaceFolder/index.html 에 write (GitHub Pages 준비). **2026-10-14 메모 (v0.1.56 의 덮어쓰기 경로와 Service 쪽 가드)**: 모든 reveal 경로가 `saveGameToWorkspace` 한 곳에서 `<root>/index.html` 을 쓰고(v0.1.56 `chatPanelProvider.ts:819-831`, 호출 `:1322`) 이전 파일은 아동 world 코호트만 보관한다(`:1317-1319`). 그래서 성인 코호트에서는 채팅의 ```html·```js 펜스(조각이라도)나 doctype 문서(`extractRenderableHtml`, `:3095-3113`)와, 코치가 저장한 다른 `.html` 파일(`revealWrittenHtml`, `:1240-1252`)이 `index.html` 을 덮어쓴다. 앱을 바꾸지 않고 Service main `399109c`(#74)가 프롬프트로 막는다: 세미나(디렉터)와 canary 는 채팅에 html·js 코드 블록을 넣지 않고 `index.html` 하나에 섹션·앵커 링크로 쌓는다(`prompts/dental-copyclone-2026-s1.md:69-76`, `contract_variant: "director"` `lib/translate.ts:31-69`, `:507-527`, design-craft 의 one-page 변형 `skills/index.ts:75-87`); 홈페이지 연습·이용권은 홈페이지 계약(`prompts/_preview-env-contract-homepage.md`)으로 같은 규칙을 받는다. 미성년 코호트는 계약 변형을 받지 않는다. 0% rc2 에서 canary 는 예시 코드 요청에 코드 펜스 없이 답했고 16,384 상한 안에서 20,748자 단일 페이지를 완성했다(hypeproof/hypeproof-service#74 본문). 성인 코호트의 덮어쓰기 전 보관은 Studio main `4304c25f`(#1629)에 모듈(`adultArchive.ts`, `diffGuard.ts`)로 들어왔지만 아직 reveal 경로에 연결되지 않았고(#1618 A4) v0.1.56 에는 없다 | E |
| REQ-D6 | previewReady handshake | host → webview 사이 `previewReady` 메시지 전에 보낸 HTML 은 pending 큐 → ready 시점에 flush | U + E |
| REQ-D7 | 생성물 구조 가드 (#359) | reveal 직전 `validateAndRepairHtml`: 미종료 HTML 주석의 오타 close(`*/`)를 `-->` 로 자동복구(정상 CSS/JS `*/` 는 불간섭); 복구 후에도 주석/`<script>` 불균형이면 reveal **차단**(직전 빌드 유지)+경고. 순수 구조 검사 — 법·의료광고 관련 검사 없음(#384로 제거). 경고 표면 = 스트림 중 `toolLog` 한 줄, 스트림 밖(▶ Run) 경고 토스트 | U (`test/html-structure`) |

## E. Manual-approve modal

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-E1 | `requireApprovalFor` 기본값 적용 | 기본 정책은 `extensions/hypeproof-chat/package.json` 의 `default` = `[executeShell, openBrowser, delegateAgent, browserType]` 하나뿐이다(#499 — 코드 폴백은 도달 불가; v0.1.56 `package.json:204-209`). **목록이 곧 모달은 아니다** (2026-10-14 정정 — 이 행은 네 종 모두 modal 이라고 적어 셸까지 기본 모달로 읽혔고 v0.1.56 코드와 달랐다). `resolveActionApproval` 은 `executeShell`·`openBrowser` 를 목록을 읽기 **전에** 자기 계층에서 처리하고(v0.1.56 `chatPanelProvider.ts:2716`, `:2766`; 목록은 `:2831-2837`), 목록이 정하는 것은 `delegateAgent`·`browserType`(그리고 넣으면 `writeFile`)뿐이다. 셸 계층은 되돌리기 어려운 명령이면 매번 강한 확인(「항상 허용」 없음), 그 밖이면 「실행」·「항상 허용(서명)」 확인(세션 한정 기억); 브라우저 계층은 오리진 단위 「항상 허용」. 그리고 **SDK 경로의 셸은 대부분 이 함수에 닿지 않는다** — `evaluateSdkToolUse` 가 파괴적이지 않은 명령을 모달 없이 자동 실행하므로(REQ-M4) 기본값에서 셸 모달은 파괴 명령에서만 뜬다. `writeFile`·`browserClick`·`readFile` 은 modal 없이 진행(#464), 워크스페이스 밖 경로는 모달 없이 거부(`:2788`). 같은 이유로 REQ-E3 의 `requireApprovalFor: []` 도 셸·브라우저 계층에는 닿지 않는다. HEAD `bcfe8ebd` 도 같은 구조다(`chatPanelProvider.ts:5153`, `package.json:411-416`). 모달은 네이티브 OS 다이얼로그라 DOM 클릭이 불가 → e2e 는 **settle 여부**로 잰다: 자동 허용은 즉시 `approved=true`, 게이트는 사람이 누를 때까지 settle 하지 않음 | E |
| REQ-E2 | Approve/Deny → actionResult | "Approve" 클릭 → `actionResult.approved=true` 가 webview 로 회신 | E |
| REQ-E3 | 설정으로 bypass 가능 | `requireApprovalFor: []` 일 때 modal 없이 즉시 approved 회신 | M |

## F. Coach naming

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-F1 | `user_names_it` 모드 → 카드 노출 | profile 의 naming_mode = user_names_it + 미설정 → in-panel 카드 | E |
| REQ-F2 | `fixed` 모드 → 카드 미노출 | 카드 안 뜸, 헤더에 `fallback_name` 표시 | E |
| REQ-F3 | 이름·인격 길이 클램프 | 40/200 자 초과 입력 → 잘라서 저장 | U |
| REQ-F4 | 빈 입력 → fallback | 빈 이름 입력 → `profile.fallback_name` 사용 | E |
| REQ-F5 | Rename 명령 prefill | `renameCoach` 실행 시 현재 값 prefilled | E |
| REQ-F6 | 작명 전환이 훅 순서를 깨지 않는다 | 카드로 빠지는 조기 return 은 `ChatPanel` 의 **모든 훅 아래**에 있어야 한다. 훅 사이에 두면 `needsNaming` 이 true→false 로 바뀌는 순간 렌더 간 훅 개수가 달라져 React #310(증가)·#300(감소)으로 크래시한다. 작명 의식은 전원이 통과하므로 정상 경로에서 100% 재현된다 | U |
| REQ-F7 | 확정 수업의 AI 이름이 헤더·답변 이름에 표시된다 (#747 feature A, AE-07/08) | 강사가 `hps-session-design/1`의 선택 필드 `assistant.display_name`(1~40 UTF-16 단위, 한 줄, 보이지 않는 문자·방향 제어 문자·따옴표만인 이름 거부)을 저장하고 버전을 고정하면 Service 가 `/v1/profile`의 `ux.coach`를 `fixed` + 그 이름으로 투영한다. 앱은 REQ-F2 규칙 그대로 표시하며 저장된 학생 별명은 이 이름을 덮지 못한다. 버전 고정 뒤의 초안 변경은 발급된 좌석에 반영되지 않는다. 블록이 없는 구버전 수업은 프로필 `ux.coach`를 그대로 받는다. 이름은 `sdk_tools`·모델·AI 고지를 바꾸지 않으며, 이름이 고정된 좌석에서는 참가자의 `x-hps-coach-name`/`-personality` 헤더를 두 런타임 모두 무시한다. 헤더의 긴 이름은 390px에서 한 줄로 줄임표 처리하고 전체 이름은 `title`로 제공한다. 계약: [ADR-0005](adr/0005-lesson-assistant-identity.md). 실제 화면·390/1280px·확대·키보드 검수는 Codex 인수 기록에서 별도 판정한다 | R (`worker/test/authoring.test.mjs`), U (`test/resolve-coach.smoke.mjs`, `chalk/test/authoring-ui.test.mjs`); E — NOT RUN here |
| REQ-F8 | AI 이름은 모든 화면 문장에서 하나다 (#747 feature B, AE-07 표시 일관성) | 헤더·답변 이름뿐 아니라 첫 안내, 승인 모달(파일·읽기·검색·위임·입력·셸·브라우저·기타), SDK 저하 알림, 페이지 첨부 알림, 게이트웨이 인증 실패·응답 지연·프로필 미수신 오류, 이미지 첨부 확인, 시작 화면 제목·설명·버튼·02단계·AI 이름 행·미연결 안내, 관찰 패널 소개가 같은 resolved identity(`src/coachIdentity.ts`)를 쓴다. 호스트와 웹뷰가 같은 모듈을 import 하며 웹뷰의 손 복제 규칙은 없다. 조사(이/가·와/과·은/는·을/를·예요/이에요)는 받침에 맞추고, 뒤따르는 문장부호·기호·공백은 건너뛰며 숫자는 한자어 읽기를 쓴다(라틴·이모지는 모음형 유지). 저장되는 학생 이름에서 제어·서식 문자를 제거한다. 승인 모달 제목은 이름 없이도 식별되도록 `APPROVAL_TITLE_PATTERN`을 만족한다 — 관측 도구는 이름 접두사로 분류하지 않는다. 기본 이름 "코치"일 때 모든 문장은 이전 문자열과 바이트 단위로 같다(기존 e2e 잠금 유지). AI 고지 문장은 이름과 무관하게 유지한다 | U (`test/coach-identity.smoke.mjs`: 동등성·조사/서술격·기본 문자열 잠금·오류 문구·승인 패턴 양/음성 대조·정적 검사); E — 실제 화면은 Codex 인수(B1~B6) |
| REQ-F9 | 기록은 소급해서 다시 쓰이지 않는다 — 답변 줄은 **그때 답한 이름**을 지킨다 (#747, AE-08) | 답변 줄이 전부 살아 있는 `coachName` 하나를 렌더하고 있었다(`ChatPanel.tsx` 의 `hps-msg-role`). 아동 코호트 둘 다 `naming_mode: "user_names_it"` 이라(`kids-2026-grade-3-4-s1`, `kids-2026-grade-5-6-s1`) 아이가 수업 중간에 이름을 바꾸면 **그 전에 코치가 한 말까지 새 이름이 한 것으로 소급해서 바뀌었다.** 증거 기반 관찰을 표방하는 제품에서 기록이 스스로를 고치는 상태였다 — [ADR-0005](adr/0005-lesson-assistant-identity.md) 가 이걸 명시적 **비목표**로 적어뒀지 해결됐다고 적어두지 않았다. 계약: ① `ChatMessage.assistantName?` 이 그 턴의 이름을 들고 다닌다. 값의 정의는 "지금 화면에 뜬 이름" 이 아니라 **그 턴을 돌릴 때 런타임에 넘긴 문자열** 이다(SDK 경로의 `coachName`, proxy 경로의 `x-hps-coach-name` 과 같은 값) — 턴 도중에 바뀌는 경우 모델이 자기를 뭐라고 알고 답했는지가 남아야 한다; ② 찍는 곳은 **커밋 지점 셋뿐**이다. `finishTurnItems` 하나가 두 런타임의 공통 choke point 이고, 나머지 둘은 앱이 직접 쓰는 답변(보여주기·게스트 목록)이다. 순수 모듈 `chatTimeline.ts` 는 이 관심사를 **모른다** — 넣으면 다음 사람이 렌더 시점에 다시 해석하고 싶어진다; ③ 없으면 살아 있는 이름으로 떨어진다 — 이 변경 **이전에 쓰인 줄**과 아직 스트리밍 중인 말풍선이 그 경로다. 스탬프가 기본값과 같은 좌석은 출력이 오늘과 **바이트 동일**하다; ④ `user`·`tool` 줄에는 절대 붙지 않는다(음성 대조군 — 없으면 '모든 줄에 이름을 찍는' 구현이 나머지를 통과한다); ⑤ 저장된 스탬프를 렌더 시점에 **다시 해석하지 않는다.** `fixed` 모드가 헤더를 이기는 규칙(REQ-F7)이 과거로 소급하면 안 된다. **이 행이 주장하지 않는 것**: AE-08 충족이 아니다. 변경 이후에 쓰인 줄만 보존되고 이전 줄은 영원히 현재 이름으로 남는다 — **백필하지 않는다.** 그리고 기록 **분리**가 아니다: 히스토리는 여전히 코호트 단위(`historyKeyForCohort`)이고 수업 토큰은 `c` 만 실으므로 한 코호트의 두 수업이 같은 기록을 공유한다. 이 행은 다시 **라벨링되는 것**을 막지 기록을 **나누지** 않는다. 두 정체성이 구분선 없이 한 스크롤에 이어지는 게 5~6학년에게 읽히는지는 인수 판단이다 | U (`test/history-identity.smoke.mjs`) |


## G. Mint student token (#66)

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-G1 | Issuer 토큰 1회 입력 → SecretStorage 영속 | 첫 mint 시만 prompt, 이후 자동 사용 | U + M |
| REQ-G2 | Cohort 디폴트 = issuer 토큰의 단일-cohort scope | `issuerDefaultCohort()` 가 payload `c` 필드 추출 | U |
| REQ-G3 | 5단계 cascade 검증 | issuer/cohort/profile/user/hours 입력 + `validateInputs` (user charset, hours 1..1440) | U |
| REQ-G4 | 401/403 → 저장된 issuer 삭제 | 인증 실패 시 다음 호출 때 다시 prompt | U + R |
| REQ-G5 | 토큰 → 클립보드 + 만료 토스트 | `vscode.env.clipboard.writeText` + `expISO` 표시 | M |
| REQ-G6 | `forgetIssuerToken` 명령 | secrets 삭제 + 확인 토스트 | M |
| REQ-G7 | Issuer roster append (#290) | `POST /admin/cohorts/:id/roster/append` — cohort-scoped issuer(can_start_session 불요)로 서버측 merge·dedupe, 기존 멤버 보존, 상한 500 | U |
| REQ-G8 | Composite session open (#290) | `POST /admin/cohorts/:id/session/open` — 가드(라이브 세션 시 409, `force:true`로만 교체)→학생토큰 발급→roster append→세션 시작 원자 수행. 토큰은 응답 body로만 전달. issuer는 `max_hours`/`max_session_hours` 상한, 전 경로 24h 하드캡 | U |
| REQ-G9 | Composite session close (#290) | `POST /admin/cohorts/:id/session/close` — 세션 종료 + `{jti, exp}` revoke. TTL은 exp까지 (고정 24h TTL이 장수 토큰보다 먼저 만료되는 구멍 금지) | U |
| REQ-G10 | Server-side issuer mint (#294) | `POST /admin/issuers` (admin Basic/CF) — 서명키 없이 서버가 issuer 발급/재스코프. days≤90·max_hours≤168·session≤24 하드캡, `revoke_jti`로 원자 교체(mint 성공 후 revoke), `issuer_audit:<jti>` 메타데이터 기록(토큰 미포함) | U |
| REQ-G11 | Admin-tier mint delegation (#295) | `can_issue_issuers` 토큰을 든 운영 멤버는 본인 Bearer로 `/admin/issuers` 호출해 강사 issuer 발급 가능(비번 공유 X). 감사에 `minted_by` 기록. **신뢰 모델: Bearer minter ≠ full admin — 본인 scope 안에서만 위임(subset 강제)**: ① 자식 scope는 minter 자신의 scope의 부분집합(cohort 일치, profiles ⊆, max_hours ≤ minter 캡(minter 캡 부재=무제한), can_start_session은 minter가 보유한 scope에서만, max_session_hours ≤ minter 유효캡(기본 4h)) — 위반 시 403; ② `revoke_jti`는 `issuer_audit.minted_by === minter`인(본인이 발급한) 토큰만 대상 — 그 외 403; ③ `can_issue_issuers` 재부여 불가(403) — 권한 자가증식 차단. 새 admin-minter는 full admin(Basic/CF)만 생성하며, full admin은 ①②③ 제한 없음. minter revoke 시 발급권 즉시 소멸 | U |
| REQ-G12 | Issuer mint-lineage query (#313) | `GET /admin/issuers?minted_by=<u>&limit=<n>` (admin Basic/CF **only** — `isIssuerAllowedEndpoint` 미등록이라 Bearer minter는 열람 불가) — `issuer_audit:` prefix 스캔으로 "minter X가 발급한 강사 issuer 목록"을 반환. 각 행은 `jti·instructor·minted_by·exp·expired·can_issue_issuers·cohorts·scopes` + jti별 실시간 revoke 교차조회(`revoked`). 멤버 퇴사/minter 토큰 유출 시 계보를 찾아 기존 `POST /admin/tokens/revoke`로 개별 revoke하기 위한 운영 도구. 오발동 파급이 커 일괄 cascade 엔드포인트는 의도적으로 미제공(runbook 4-step) | U |
| REQ-G13 | Instructor surface is its own Worker — Chalk (plan task F) | `/console`·`/issuer` 페이지와 `GET /admin/cohorts/:id/state` 는 Service(`worker/`)가 아니라 **Chalk**(`chalk/`, `chalk.hypeproof-ai.xyz`, 태그 `c*`)가 서빙한다. Service 는 두 페이지를 302 로 Chalk 에 넘기고(`HPS_CHALK_ORIGIN`; Location 에 fragment 가 없어 `#t=` 토큰 링크 보존), 강사 **쓰기**(세션 open/close·roster append·토큰 mint)와 운영자 surface(admin Basic/CF Access)는 Service 에 남는다 — 채팅 게이트가 읽는 KV 키는 그것을 쓰는 아티팩트와 함께 배포돼야 하고, 서명은 Service 에서만 일어난다. Chalk 는 강사 쓰기를 Service 로 **forward** 한다(헤더 화이트리스트: Bearer + content-type; `cf-access-…` 는 절대 전달 안 함, Basic 거부). 토큰 검증은 `worker/src/lib/instructor-auth.ts` 하나를 re-export — 복제 금지. `c*` 태그 배포는 Service 버전(task C `/v1/health.version`)을 움직이지 않는다 | U (`chalk/test/instructor-auth-drift` — 두 워커 동일 판정 · `chalk/test/deploy-isolation` — c\* 트레인 격리 · `chalk/test/board-contract` — 읽기 계약 · `worker/test/route-order` — 리다이렉트) |

Instructor-mode credential isolation (#1298): changing the saved issuer clears the previous issuer's authorization and brief before checking `whoami`. A network error, 500 or 429 for the new credential cannot inherit instructor mode; a later successful check may recover. Verified by `test/chalk-instructor-token-change.smoke.mjs`.

## H. Report problem (#64)

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-H1 | 3-step QuickInput cascade | description (≥10자) → recent_turns yes/no → contact (옵션) | M |
| REQ-H2 | JTI 로컬 해싱 (SubtleCrypto) | 원본 JTI 는 절대 네트워크 미전송, 16-hex 만 | U |
| REQ-H3 | 자동 메타데이터 | studio_version, OS, locale, vscode_version, profile_id, jti_hash, last_request_id, ts_client | U |
| REQ-H4 | 마지막 request_id 자동 첨부 | 직전 스트림 에러의 request_id 가 body 에 포함 | U + R |
| REQ-H5 | 429 rate-limit graceful | "잠시 후 다시 시도" 토스트, throw 금지 | R |
| REQ-H6 | 채팅 경로 실패 시에도 동작 | proxyUrl 가 다운된 상태에서도 `/v1/report` 만 살아있으면 신고 성공 (anonymous POST 허용) | R + M |
| REQ-H7 | Abuse 상한 (#260) | 비인증 endpoint 방어: IP당 3건/60s rate limit (429), 전체 body ≤32KB (413), description ≤5000자, attachments ≤20 keys·key명 ≤64자·직렬화 ≤8KB (400), recent_turns opt-in 시 3건×2000자 캡 | U |
| REQ-H8 | PII 최소화 (#260) | 직접 PII 는 `contact` 단일 필드 (옵션, ≤200자) — **D1 에만 저장, Discord embed 미전달**. jti 는 원본 미저장 (16-hex sha256 해시만), Discord embed 는 description 앞 1000자만 노출 | U |
| REQ-H9 | Retention/redaction 정책 (#260) | D1 `reports` 는 진단 목적 한정. 운영 체크리스트: `resolved` 도달 후 90일 내 `contact` 삭제/NULL 처리. GET `/v1/report/:id` 응답은 status/resolution 필드만 (description·contact·attachments 미노출) | 운영 |

## I. Auto-update (#72)

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-I1 | 24h cadence + 30s initial | 활성화 30s 후 첫 체크, 이후 24h 마다 | U |
| REQ-I2 | Banner gating (#730) | newer version + dismissals 에 없음 → 배너; 동일/구버전 → null. 수업 미연결·작명 중에도 배너를 유지하며 토큰 없이 설치 확인/보류 가능 | U + E (`e2e/update-check/run.mjs`) |
| REQ-I3 | Dismiss = 7일 silence | `dismissVersion` 후 동일 버전 배너 7일간 미노출 | U |
| REQ-I4 | 설치 pipeline (#730) | 공개 릴리스 파일 크기·SHA-256 검증 → unzip → installer 준비 → 사용자 재시작 승인 → detached spawn 성공 확인 → 정상 quit. 보류하면 자동 적용을 약속하지 않는다. 실행 중인 앱은 교체하지 않는다 | U + M |
| REQ-I5 | Free-disk 사전 체크 (≥1GB) | 1GB 미만 → 경고 토스트, 다운로드 skip | U |
| REQ-I6 | Dev 환경에선 no-op | `detectAppBundle` 가 null 이면 "개발 환경" 토스트 후 종료 | U |
| REQ-I7 | 더블-클릭 idempotency | 같은 version 의 inflight Promise 재사용 | U |
| REQ-I11 | 실패한 확인은 최신 버전 판정이 아니다 (#730) | HTTP 오류·시간 초과·잘못된 응답·지원하지 않는 OS/아키텍처·새 릴리스의 설치 파일 누락을 오류로 표시한다. 백그라운드 확인 실패는 기존 배너를 지우지 않는다. 릴리스 API 제한 15초 | U (`test/update-orchestration`, `test/update-transport`) + E (`e2e/update-check/run.mjs`, 확인만 수행) |
| REQ-I12 | 검증된 다운로드 (#730) | 공개 미러의 HTTPS asset URL만 허용. 60초 무응답·10분 전체 제한, 스트림 backpressure와 파일 오류 전파, 선언 크기와 SHA-256 일치 필수. 손상·중단 파일은 제거하며 기존 파일은 덮거나 지우지 않는다. SHA-256은 코드 서명 인증을 대신하지 않는다 | U (`test/update-transport`) |
| REQ-I13 | 기존 앱 보존 (#730) | macOS는 같은 볼륨에 staging·backup 후 교체. 백업 실패 시 기존 앱 삭제 금지, 교체 실패 시 복구. 종료 취소·계속 실행 상태면 Mac/Windows 모두 설치 중단. Windows wrapper는 BOM을 유지하고 오류를 숨기지 않는다 | U (`test/update-installer`, `test/update-windows-wrapper`, OS별 CI fixture 실행) + M (실제 패키지 교체·재시작은 별도 릴리스 게이트) |
| REQ-I14 | Without release access, point to the homepage download (trial-diagnosis I5, PRA-01, TUX-COND-02) | When no member credential can read the private release mirror (no env token and no `gh` login, or a token the mirror answers with 401/404), the check fails with `UpdateAccessError`; the private mirror is never called anonymously. The manual check shows an info notification "이 Studio에서는 앱 안에서 새 버전을 확인할 수 없어요. 새 버전은 홈페이지에서 받을 수 있어요." with "홈페이지 열기" (`https://hypeproof-ai.xyz/download`) — never `gh auth login`, `HPS_RELEASE_TOKEN` or "잠시 후 다시 시도". The automatic check is not silent: once per installed app version (globalState `hypeproofChat.updateAccessNotice`) it shows the non-modal line "새 버전은 홈페이지에서 받을 수 있어요." (not the status bar, which Studio hides by default). It neither pushes nor clears a banner. The member path (banner, up-to-date verdict, retry copy for transient failures, silent transient automatic failures per REQ-I11) is unchanged | U (`test/update-access-copy`: bundled updateChecker + `vscode` stub; no credential and token without access (positive), member token (control)) |
| REQ-I8 | Bundle id 일치 확인 | installer.sh 가 `ai.hypeproof.studio` 일 때만 swap | U |
| REQ-I9 | win32 설치 pipeline (#447, #463) | macOS 처럼 우리가 .app 을 스왑하지 않고 Inno Setup 설치 관리자에 위임: download → `renderWindowsUpdateWrapper` 로 detached PowerShell wrapper write → spawn → `workbench.action.quit`. wrapper 가 앱 종료를 **먼저** 기다린 뒤 설치 관리자를 `/silent /mergetasks=runcode /LOG=…` 로 실행 — 종료 중인 구 인스턴스의 single-instance lock 과 경합하면 재실행된 프로세스가 죽어가는 구 인스턴스에 핸드오프하고 종료해 "업데이트는 됐는데 안 켜짐" 이 된다 | U (`test/update-checker`) |
| REQ-I10 | win32 wrapper 는 UTF-8 BOM 으로 기록 — 한글 계정명 머신에서 업데이트 성립 | `renderWindowsUpdateWrapper` 반환값이 **U+FEFF 로 시작**하고 호출부가 그대로(`fs.writeFileSync(p, s, "utf8")`) 기록해 디스크에 `EF BB BF` 가 남아야 한다. 이유: 벤치 머신의 `powershell.exe` 는 Windows PowerShell **5.1** 이고, BOM 없는 `-File` 스크립트를 UTF-8 이 아니라 **ANSI 코드페이지(한국은 CP949)** 로 디코드한다. wrapper 에 박히는 설치 관리자 경로는 `%TEMP%` = `C:\Users\<계정명>\AppData\Local\Temp\…` 아래라, 계정명이 한글이면(코호트 대다수) 경로가 모지바케가 되어 `Start-Process` 가 아무것도 못 찾는다. 그런데 호출부는 wrapper 를 띄운 직후 앱을 종료하므로 **Studio 는 꺼지고 업데이트는 안 된 채 끝난다** — 실패가 조용하다. 실측(Windows 11 / PS 5.1.26100 / `C:\Users\신제형`): BOM 없음 → 설치 관리자 미기동, UTF-8 BOM → 기동. PS 5.1·PS 7 모두 UTF-8 BOM 을 존중한다. **주의(닭-달걀): 이 결함이 있는 빌드는 인앱 업데이트로 자신을 고칠 수 없다 — 해당 머신은 재설치가 유일한 경로다** | U (`test/update-checker`) + M (한글 경로 실기기 확인) |

## J. Build / branding integrity (Phase 2-3 게이트)

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-J1 | App display name = "HypeProof Studio" | `Info.plist` `CFBundleDisplayName` 검증 | M (`scripts/verify-branding.sh`) |
| REQ-J2 | Bundle id = `ai.hypeproof.studio` | `defaults read .../Info.plist CFBundleIdentifier` | M (`scripts/verify-branding.sh`) |
| REQ-J3 | Data folder = `~/Library/Application Support/HypeProof Studio/` | 첫 실행 후 디렉토리 존재 | M (`scripts/verify-branding.sh`) |
| REQ-J4 | "VSCodium" 잔존 문자열 없음 (About attribution 외) | `grep -ri "VSCodium\|codium" Resources \| grep -v -i "license\|notice\|attribution\|third-party"` 결과 0 | M (`scripts/verify-branding.sh`) |
| REQ-J5 | 빌트인 확장 자동 활성 | `onStartupFinished` 시 activity bar 에 hypeproof-chat container 노출 | E |

## K. Settings & config

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-K1 | 연결·모델·승인 설정 노출 | `hypeproofChat.proxyUrl` / `model` / `requireApprovalFor` 가 settings UI 에 검색됨. 전체 설정 개수는 `extensions/hypeproof-chat/package.json`의 `contributes.configuration.properties`가 기준이며 이 세 항목으로 제한하지 않음. `model`은 요청값이고 Service가 허용 범위로 clamp하므로 자유로운 실제 모델 선택을 뜻하지 않음 | M |
| REQ-K2 | webview → openSettings 브릿지 | 패널 내부 ⚙ 클릭 → `workbench.action.openSettings` 호출 | E |
| REQ-K3 | `coachRuntime` 설정 노출 | `hypeproofChat.coachRuntime` (proxy/agent-sdk) 가 settings UI 에 검색됨 | M |

## L. Safety / observability

후속 설계: [AB 이용권·예산·정산](requirements/access-budget-settlement.md)과
[HC 후보 역량 해석 계약](requirements/capability-model-contract.md). 두 문서는 Lab #777 / #800의
후속 요구사항이다. #853의 이용권 게시·조회 계약부터 구현하며 각 단계의 실행 근거는
[인수 기록](testing/capability-and-access.md)에 분리한다. 기존 관측 schema를 새 정산 완료로 간주하지 않는다.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-L1 | Chat webview CSP | `default-src 'none'` + nonce'd script-src + connect-src webview only | U (cspBuilder) |
| REQ-L2 | Preview iframe 격리 | iframe sandbox 위 D3 + parent CSP `frame-src 'self' data: blob:` | U (cspBuilder) |
| REQ-L3 | Stream abort on dispose | view dispose 시 모든 activeStreams.abort + map clear | U |
| REQ-L4 | 갤러리 발행은 프로필이 허가한 좌석에서만 (#748) | 발행 여부를 판단하는 곳이 **웹뷰 버튼 하나뿐**이었고, 그마저도 `publishing.strategy` 만 봤다. `publishing.enabled` 는 워커가 실어 보내기만 하고 **아무도 읽지 않는 값**이었다. 버튼은 유일한 도달 수단도 아니다 — 발행은 웹뷰 메시지 `publishToGallery` 로 시작하므로 버튼을 거치지 않고 호스트에 도달한다. 계약: ① 순수 판정기 `galleryPublishAllowed` 하나가 두 값을 **모두** 본다 — `enabled === true` **그리고** `strategy === 'hypeproof_gallery'`. truthy 는 true 가 아니고, 프로필이 아직 없으면 허가의 증거가 없으므로 거절한다(fail closed); ② 호스트는 세상·토큰·작업폴더 검사보다 **먼저** 묻는다 — 뒤에 두면 허용되지 않은 좌석이 "먼저 친구를 눌러 세상을 열어주세요" 를 보게 되고 그건 하면 되는 일처럼 읽힌다; ③ 웹뷰 버튼도 같은 두 값을 같은 방향으로 본다. 별도 vite 앱이라 호스트 모듈을 import 하지 않고 손으로 미러링하므로(REQ-M33 과 같은 이유) 스모크가 드리프트를 잠근다; ④ `hypeproofChat.siteBase` 는 `machine` 범위다 — 아이 작품이 실제로 올라가는 목적지를 프로젝트 폴더의 `.vscode/settings.json` 이 바꿀 수 있어서는 안 된다. `proxyUrl` 은 이미 machine 이었고 siteBase 만 window 로 남아 있었다. **오늘 실제 노출은 없다** — 등록된 프로필 다섯 개 전부에서 두 값이 일치한다(`enabled:false` ↔ `local_only`, `enabled:true` ↔ `hypeproof_gallery`). 이 행은 구멍을 막은 기록이 아니라 두 값이 갈라지는 날의 방향을 정한 기록이다. 사이트 라우트(`POST /api/gallery/publish`)가 토큰으로 코호트 opt-in 을 확인한다고 `galleryPublish.ts` 상단 주석이 적고 있으나 그 코드는 **다른 저장소에 있어 이 레포에서 확인하지 못했다** — 이 행을 서버 게이트의 대체물로 읽지 않는다 | U (`test/gallery-publish-gate.smoke.mjs`) |

| REQ-L5 | 사용량 저장 기록과 확정 비용을 구분한다 (#800) | 운영자 최근 기록 조회는 범위·시각·캐시 쓰기·오류 중 토큰 기록·세션 미귀속을 표시한다. Owner 기간별 전체 조회는 사람·반·모델별로 체험판·패스·테스트·미분류 기록을 포함하며, 비용 원장 소계와 미확인 범위를 구분한다. 빈 기록/조회 실패를 구분하고 실패 후 이전 숫자를 현재값처럼 유지하지 않는다. 미확인 보고/원가를 0이나 잔여 예산으로 확정하지 않는다. 학생·강사에게 운영자 조회 권한을 넓히지 않는다. CLI와 화면은 provider/스키마 없는 통합 캐시 적중률을 계산하지 않는다. | Service/SQLite (`usage-observation.test`), [실제 브라우저](testing/usage-observation.md) |
| REQ-L6 | 가격 계약·개인/수업/기관 이용권을 서버에서 구분한다 (#853) | 불변 상품 revision과 검증된 계약 이벤트, UTC 기간, 개인 계정과 수업 좌석의 명시적 연결을 사용한다. 재발급/중복 갱신으로 지급을 반복하지 않는다. 담당 강사는 자기 수업 계약만 조회하며 가격·개인 계약 쓰기 권한은 없다. 미승인 상품 digest/운영 합성 계약/충돌/지원하지 않는 정책을 거부한다. 실행·금액 차감은 #854/#855 후속이다. | Service+SQLite `access-contracts.test`, 실제 로컬 D1 `access-contracts-d1.test` |
| REQ-L7 | 실제 시도별 원가·미정산·조정 이력을 보존한다 (#854) | 기존 model_usage_requests ID에 작업/계약/기간/가격 revision을 연결한다. 실제 모델·protocol·등급·지역·캐시 TTL이 확인된 항목만 정수 micro 통화로 계산하며 미확인 합계를 0으로 만들지 않는다. 중복/늦은/역순 보고는 누적 snapshot revision으로 정산하고 원 증거를 보존한다. 공급자 청구 조정은 별도 이력이며 고객 결제·강사 지급을 일으키지 않는다. SDK/proxy 응답 수집 hook은 선행 예약 귀속을 소비하며 예약 집행은 #855다. | `usage-costs.test`, `usage-costs-d1.test`, `sse-cost-receipts.test` |
| REQ-L8 | 이용 기간의 자원·동시 슬롯을 실행 전 함께 예약한다 (#855) | 공용 pool/배정 allocation/상한 cap을 구별한다. 명시된 이용권 하나에 실제 공급자 시도를 원자적으로 귀속·예약한 뒤 한 번 전송한다. 미확인은 예약 유지, 종료와 원가 확정을 구별, 초과는 음수 노출과 신규 중지로 처리한다. 개인 계정은 가짜 수업 없이 같은 집행 경로를 사용한다. | `budget-admission.test`, `budget-admission-d1.test` |
| REQ-L9 | 학생·강사·운영자의 이용권과 예산 화면을 권한에 맞게 제공한다 (#856/#847) | 학생은 명시된 출처/기준 시각/자기 사용·예약·미확인을 보며 자동 전환하지 않는다. 강사는 담당 반과 별도 예산 위임의 교집합에서 배정·pause·요청 검토를 한다. 위임 취소와 동시 수정은 저장 transaction에서 확인한다. 운영자는 원가와 invoice 조정을 별도로 보고 복구 증거를 남긴다. | `budget-surfaces.test`, `budget-surfaces-d1.test`, Chalk `budgets.test`, `access-client.smoke`, `e2e/access-budgets` |
| REQ-L10 | 공급자가 **실제로 보내는** usage 모양으로 원가를 매긴다 — 부재를 미지로 읽지 않는다 (#897 조사) | `openai-chat` 정규화가 세 입력 차원을 모두 `prompt_tokens_details.cache_write_tokens` 에서 유도했는데, **OpenAI 는 그 필드를 보내지 않는다**(레포 전체에서 하네스 fixture 와 그것을 읽는 두 줄 말고는 등장하지 않았다). 부재 시 `write` 가 null → `valid` 가 false → `tokens:input`·`cache_read`·`cache_write` 가 전부 null + `input_cache_split_unconfirmed`. 사유가 하나라도 있으면 상태가 `priced` 가 될 수 없으므로 **모든 openai-chat 턴이 입력 차원에서 영구히 정산되지 않았고 홀드만 남았다.** 2026-09-10 실측: 현실적인 모양 셋(details 없음 / `cached_tokens` 만 / reasoning 포함) 전부 입력 전멸, 가격이 나온 유일한 입력은 발명된 필드가 든 레포 자신의 fixture. 계약: ① 이 프로토콜에서 **부재는 미지가 아니라 알려진 0 이다** — `cached_tokens` 부재는 캐시 히트 0, cache-write 차원 부재는 0(OpenAI 는 캐시 쓰기를 과금하지 않는다); ② 그러나 **공급자가 값을 보내면 존중한다** — OpenAI 호환 표면을 쓰는 다른 공급자가 채울 수 있고 0 으로 덮으면 과소 계량이다; ③ 값이 **있는데** 숫자가 아니면 그건 진짜 미지이므로 null 로 두어 거절을 유도한다 (문자열·null·음수·비정수·합계 초과 여덟 모양을 음성 대조군으로 상시 검증); ④ 세 입력 차원의 합은 항상 `prompt_tokens` 와 같다 — 토큰이 사라지거나 중복되지 않는다; ⑤ 입력 경로를 살린 뒤에도 오디오·이미지 토큰은 **텍스트 단가를 타지 않는다**(REQ-R3 의 성질이며, 되살린 길로 회귀하기 쉬우므로 같은 파일에서 다시 검증한다); ⑥ 계측기 자신을 잠근다 — 하네스 fixture 가 여전히 발명된 필드를 들고 있다는 사실을 단언한다. 그 fixture 가 현실적으로 바뀌는 날 이 행의 근거를 다시 읽어야 한다. 이 해석은 이 레포가 이미 적어둔 경고와 일치한다 — `docs/design/usage-observation-audit.md` 는 "지원하는 새 모델의 캐시 쓰기 상세가 포함된다. Responses 예제를 Studio의 Chat Completions 추출기에 그대로 적용하지 않고 실제 응답 스키마를 대조해야 한다" 고 적었다. 즉 누군가 이 불일치를 이미 의심했고, 대조는 이뤄지지 않았다. 그래서 "부재는 0, 존재하면 존중" 이 **양쪽 답 모두에서 맞는** 유일한 모양이다. **이 행이 주장하지 않는 것**: 실제 OpenAI API 가 `cache_write_tokens` 를 보내지 않는다는 **확인** 아님 — 이 레포에 api.openai.com 의 200 기록이 없다(유일한 시도가 `429 credit_balance_exhausted`, #841). 두 답 모두에서 동작하도록 만들었을 뿐이다. 그리고 프로덕션 정산 검증 아님 — `HPS_ACCESS_CONTRACTS` 가 `wrangler.toml [vars]` 에 없다 | Service (`openai-usage-shape.test`, `usage-costs.test`) |
| REQ-L11 | 운영자 표면은 **운영자 자격증명**을 요구한다 — 요청 헤더는 출처의 증거가 아니다 (#897 조사) | `/v1/health/deep` 이 `x-cron-trigger: true` 라는 **요청 헤더 하나로** 인증을 통과시켰다. 2026-09-10 프로덕션에서 자격증명 없이 실제로 열렸고(200, 공급자별 상태·지연·KV·D1·Anthropic 프록시 호스트명), 소스 주석은 그 헤더가 "set by the scheduled() entry point" 라고 단정하고 있었다. 두 번 틀렸다: 요청 헤더는 요청자가 정하므로 내부 출처의 증거가 될 수 없고, **그 헤더를 보내는 코드는 존재하지 않았다** (`scheduled()` 는 `runHeartbeat(env)` 를 평범한 함수로 부른다; 레포 전체 grep 결과가 우회 분기 자신의 두 줄뿐). 보호하는 호출자는 없고 노출만 있었다. **단정하는 주석이 이것을 살려뒀다** — 원인을 못박아서 아무도 그쪽을 보지 않았고, 이 레포에는 같은 실패 기록이 이미 있다("토큰 만료" 배너가 이틀을 태웠다). 공개보다 나쁜 것: 호출 한 번이 워커로 하여금 **네 공급자에 실제 probe** 를 보내게 한다 — 인증 없는 요청 하나가 유료 요청 넷으로 증폭됐다. 계약: ① 운영자 표면은 관리자 Basic 만 받는다. 세션 토큰도 받지 않는다; ② **핸들러는 `authorization` 외의 요청 헤더를 읽지 않는다** — 소스 단언으로 잠가, 다른 이름으로 같은 패턴이 되살아나는 것을 막는다; ③ 거절은 **업스트림 probe 를 하나도 보내지 않는다** — 401 을 주면서 probe 를 쏘면 증폭은 그대로 남으므로, 호출 수로 직접 확인한다; ④ 거절 본문은 아무것도 흘리지 않고 실패 **사유를 구분해 주지 않는다**(추측 공격에 단서를 주지 않는다); ⑤ 비밀번호 미설정 배포는 **열리지 않는다** — fail-open 이 가장 비싼 실수다; ⑥ 깨진 base64 는 500 이 아니라 401 이다(`atob` 는 던진다); ⑦ `scheduled()` 가 자기 자신에게 HTTP 요청을 하지 않는다는 사실을 시험이 지킨다 — 그게 우회를 지운 근거이므로, cron 이 HTTP 호출로 바뀌면 시험이 터지고 인증을 다시 설계해야 한다. **이 행이 주장하지 않는 것**: 다른 운영자 경로의 감사 아님 — `/admin/*` 은 이 변경 범위가 아니다 | Service (`deep-health-auth.test`) |
| REQ-L12 | 이용권을 **앱 안에서** 카드로 산다 — 결제됐는지는 Service 만 판정한다 (Lab #1210 · Service #40) | 시작 화면의 구매 경로. 근거: [Product Intent](PRODUCT-INTENT.md)의 이용 권한 Intent(INT-ACCESS-01 실행 전에 포함 범위와 비용 부담을 이해한다 · INT-ACCESS-05 한도·만료 뒤에도 만든 결과를 유지하고 불필요한 업그레이드 압박을 하지 않는다). 계약: ① 시작 방법의 세 번째 선택지 `이용권으로 시작하기` 는 Service 가 상품을 줄 때만 그린다. 다른 두 선택지와 같은 급이고(SX-04), **사람이 눌러야만** 열린다 — 한도·만료·오류가 이 화면을 대신 열지 않는다; ② 결제 전 화면이 이용권을 **선택지 목록**으로 보여 준다 — 이름, 누구에게 맞는지 한 줄, 결제 금액, 포함된 AI 요청 횟수와 하루 환산. Service 가 추천으로 표시한 것이 먼저 선택돼 있고, Primary 는 목록 뒤 하나(`{금액} 결제하러 가기`)다. 화면은 `자동으로 다시 결제되지 않아요` 를 적는다. 구매 화면의 문구는 해요체다(2026-10-12 Jay) — 시작 화면의 다른 문구는 그대로 둔다; ③ 주문 비밀값은 **브라우저를 열기 전에** SecretStorage 에 저장한다 — 결제할 수 있게 된 사람은 창을 닫거나 앱을 다시 켜도 돌아올 수 있어야 한다. 비밀값과 발급된 코드는 webview 로 가지 않는다; ④ 브라우저는 설정된 사이트(`hypeproofChat.siteBase`)의 결제 페이지로만 연다. Service 응답이 다른 주소를 주면 열지 않고 아무것도 저장하지 않는다; ⑤ 앱은 결제를 판정하지 않는다 — Service 가 `paid` 라고 답하기 전에는 좌석을 받으러 가지 않는다. Service 를 못 읽은 것과 확인 중(`confirming`)인 것은 결제 실패가 아니므로 **주문을 버리지 않고 계속 기다린다**. 기한 뒤 여유 시간이 지나 끝내는 것은 Service 가 아직 `pending`(미결제)이라고 답한 주문뿐이다(2026-10-14 리허설: 오래 오프라인이었다가 돌아오면 결제한 주문을 지우는 경로가 있었다); ⑥ 받은 코드는 평범한 참여 코드로 **기존 입장 경로**(미리보기 → `이 활동 시작하기`)를 그대로 탄다. 구매가 별도 인증·별도 권한 경로를 만들지 않는다; ⑦ 주문 기록은 활동에 **실제로 들어간 뒤에** 지운다. 그 전에 연결이 실패하거나 앱이 꺼지면 `다시 연결` 이 코드를 **교체**받는다 — 다시 결제하게 하지 않는다. 교체는 자격증명을 바꾸므로 사람이 누를 때만 한다; ⑧ `그만두기` 는 기다림만 멈추고 **다른 시작 방법으로 돌아간다**. 결제됐을 수 있는 주문을 버리지 않고, 시작 방법 목록에 `결제 중인 이용권 이어서 보기` 로 다시 보여 준다. 시작 탭을 닫았다 다시 열면 기다림이 다시 시작된다. 기다리는 화면에는 `결제했는데 그대로예요` 가 있어 브라우저는 끝났는데 앱이 그대로일 때 Service 에 다시 묻는다; ⑨ 저장된 주문은 그것을 만든 Service 로만 보낸다 — 설정이 바뀌면 비밀값을 어디에도 보내지 않는다. ⑩ 산 이용권은 `체험` 이 아니라 **`이용권`** 으로 표시한다(시작 화면 미리보기·저장된 활동·채팅 머리말). 기준은 Service `/v1/profile` 의 `pass` 블록이다(Service #70; 종류는 호환을 위해 `trial` 그대로). 시작 화면은 연결할 때 읽은 남은 AI 요청 횟수와 끝나는 날을, 채팅 머리말은 끝나는 날만 보여 준다. 머리말은 턴마다 다시 읽지 않으므로 횟수를 적지 않는다; ⑪ 다 쓴 이용권으로 끝난 턴은 오류가 아니라 이용권 안내로 끝낸다 — 파일은 남고 `이용권으로 시작하기` 에서 새로 살 수 있다고 적는다. 환불·교체된 코드(401 `trial_revoked_or_reissued`)와 기간이 끝난 이용권(403 `trial_expired`)은 Service 가 보낸 문장을 그대로 보여 준다(Service #72 가 이용권용 문장을 보낸다). SDK 스트림이 본문 없는 401만 주면, 이미 산 이용권으로 확인된 프로필에 한해 같은 코드로 `/profile`을 다시 읽고 이 두 코드가 확인될 때만 이용권 종료 안내를 보인다. 일반 401은 원인을 단정하지 않는다. 이 안내의 제목은 `이용권을 더 쓸 수 없어요` 다; ⑫ 새로 산 이용권은 이용권의 기본 작업 폴더(프로필의 `workspace_root`)를 앞 활동에게서 **이어받는다**. Claude Code 가 시작한 폴더에서 이어서 일하는 방식을 따른다(2026-10-14 Jay). 파일은 그대로 남고 대화 기록은 새 활동으로 시작한다. 이어받을 기본 폴더는 입장 직전에 Service에서 다시 읽은 `workspace_root`로만 판정한다. 사용자가 고른 폴더나 저장된 활동의 폴더는 탐색 대상이며 이 값을 바꾸지 않는다. 기본 폴더라면 앞 활동이 수업이어도 이어받을 수 있고, 다른 폴더와 이용권이 아닌 새 활동에는 기존 충돌 차단을 유지한다. 폴더 준비는 기존 연결을 바꾸지 않으며, 준비·자격 저장·폴더 열기 실패 시 이전 연결·폴더 바인딩·파일을 보존한다. ⑬ 무료 체험이 끝난 턴도 오류가 아니라 체험 종료 안내로 끝낸다(2026-10-18 진단 P1-01). SDK 는 Service 의 체험 문장만 넘기고 코드는 넘기지 않으므로, 실측한 두 문장(`개인 체험의 총 요청 한도에 도달했습니다` · `개인 체험 시간이 끝났습니다`)으로 판정한다. 산 이용권으로 돈 턴에는 코드만 있는 `trial_exhausted` 를 체험으로 읽지 않는다. 안내는 `체험에서 쓸 수 있는 AI 요청을 모두 썼어요.` / `체험 시간이 끝났어요.` 다음에 `만든 파일과 대화는 그대로 있어요.` 를 적고(CU-14), Service 가 상품을 줄 때만(①) `계속하려면 시작 화면의 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.` 를 붙인다. 상품 확인은 코드 없이 읽는 공개 카탈로그 한 번이며 3초 안에 답이 없으면 붙이지 않는다. 구매 화면·코드 입력창을 열지 않고, 저장된 코드를 지우지 않으며, 주문을 만들지 않는다. 배너 제목은 `체험이 끝났어요` 다 — 연결 끊김·이용권 종료와 구분한다. 수업의 429(`이 수업의 요청 한도`)·예산 429·`trial_busy` 는 체험 종료가 아니다. 체험이 끝난 뒤 시작 화면(같은 코드로 다시 연결 · 403 `trial_expired`)은 더 이상 `코드 발급 담당자` 에게 보내지 않는다 — `체험 시간이 끝났어요. 만든 파일과 대화는 그대로 있어요.` 를 적고, 상품이 있을 때만 `계속하려면 '이용권으로 시작하기'에서 이용권을 고를 수 있어요.` 를 붙인다(TUX-SP-05). 이 항목이 주장하지 않는 것: 남은 시간·횟수 표시(CU-13), 소진 뒤 시작 화면의 `이어서 하기` 카드는 그대로다; **이 행이 주장하지 않는 것**: 2026-10-14 로컬 리허설(개발 앱 · 로컬 Service · 토스 테스트 키, 카드와 토스페이 간편결제)에서 결제 → 코드 → 시작 → 실제 AI 작업 → 소진 → 환불(좌석 회수)까지 왕복했다. 운영 결제대행사·출시 앱 인수는 아니다. 월 구독·자동결제·해지 화면 아님. 채팅 중 남은 횟수 실시간 표시, 재구매 시 기간 연장 규칙은 아직이다. 설치된 앱에 닿으려면 App 릴리스가 필요하다 | Host (`test/pass-purchase.smoke.mjs`, `test/start-page-purchase.smoke.mjs`, `test/pass-takeover-transaction.smoke.mjs`, `test/sdk-paid-pass-ending.test.mjs`, `test/trial-end-notice.smoke.mjs`, `test/sdk-trial-end-notice.test.mjs`) · Browser (`e2e/trial-ux/run.mjs` TUX-SP-05) · Webview (`webview-ui/src/activityLabel.ts`) |
| REQ-L13 | 개인 계정으로 이용권을 복사하지 않고 시작한다 — Lab #1254 P4의 **로컬 미리보기** | 근거: INT-ACCESS-01/05 및 REQ-L12. 기본은 꺼져 있고 머신의 로컬 미리보기 설정과 loopback Service·Lab가 모두 있어야 미리보기 `Google로 시작하기`를 표시한다. 별도 기본-off `accountsEnabled` 설정은 정확한 공식 HTTPS Service·Lab 주소에서만 운영 계정 경로를 연다. 미리보기 설정·환경 변수로 운영 계정을 켤 수 없다. ① Service 기기 요청 → 브라우저의 명시 승인 → polling 순서이며 취소·거절·만료는 계정을 만들지 않는다. 취소와 승인 응답이 겹치면 받은 세션을 즉시 회수한다. ② access/refresh/device credential은 호스트 SecretStorage·메모리에만 있고 webview·URL·로그에 없다. 사용자 비교용 번호만 화면과 승인 URL에 쓴다. 돌아가기 URI에는 credential 대신 단회 nonce·원래 windowId를 넣고 Service 승인이 확인돼야 계정 화면을 연다. 브라우저 재시도 실패를 표시하며 기본 브라우저 복구 후 다시 열 수 있다. ③ refresh rotation은 창 사이에도 직렬화하고 SDK·proxy가 실제 읽는 `ActivityConnections.token()` 경로에서 활성 이용권을 다시 발급받는다. 240초 실행 한도보다 긴 5분 만료 여유를 둔다. ④ Service가 거절한 세션은 활성 실행을 중지하고 해당 계정의 저장 credential을 지운다. 다른 창의 로그아웃과 원격 회수는 15초 간격으로 확인한다. 네트워크 오류는 로그아웃으로 추정하지 않는다. 수업 연결·작업 파일은 보존한다. ⑤ 계정의 이용권과 남은 횟수·종료일을 보여 주며 기존 미리보기 → `이 활동 시작하기` 트랜잭션을 탄다. Service가 소유권·횟수·기간을 판정한다. ⑥ 미리보기의 새 구매는 로그인이 필요하고 주문에 계정 bearer를 보낸다. 결제된 계정 주문은 코드 claim 없이 계정 이용권으로 활성화한다. ⑦ 영수증·기기·동의·삭제는 인증된 웹 계정 화면을 연다. 기존 수업·체험·익명 이용권 경로는 switch-off 상태에서 그대로 동작한다. **범위 한계:** 실제 Google 동의·카드 결제·운영 계정 활성화·출시 앱·Windows 인수·법률 검토를 증명하지 않는다. | Host (`test/account-session.smoke.mjs`, `test/account-runtime.smoke.mjs`, `test/account-lock.smoke.mjs`) · 실제 Mac 개발 앱 (`e2e/accounts/mac-preview.mjs`) · [개발·수용 기준](dev/studio-account-preview.md) |
| REQ-L14 | Solo seats are not told to call staff — trial/pass/personal wording (trial diagnosis 2026-10-18 D3/D9) | A seat is **solo** when its `activity_kind` is `trial` or `personal`, or it carries a `pass`; anything else, including a profile with no kind, keeps the classroom copy byte for byte. On a solo seat no host or webview string covered here names 스태프, 강사, 운영 담당자 or Jay: the generic proxy failure card ("…계속되면 ‘문제 신고하기’로 알려 주세요."), the SDK 429 stall line, the SDK-degraded notice, the chat error banner hover titles, and the report flow's contact prompt and receipt. The chat send button reads "보내기" on every seat (was "Send"); the start page eyebrow reads "시작하기" and the footer motto "만들기 · 검토하기 · 내 것으로" (was "GET STARTED" / "MAKE · VERIFY · OWN"). One pure module (`src/seatVocabulary.ts`) holds both variants; the host passes the seat to `proxyChat` (`audience`), `coachDegradedNotice` and the report command, and the webview derives it from `config.activity`. Out of scope here: the missing-SDK error path (ind-missing-sdk-error) and classroom-only surfaces (help requests, ops, instructor tools). | U (`test/seat-vocabulary.smoke.mjs`: per-seat strings with a classroom positive control and a solo negative control, `proxyChat` fed a 500) · W (`test/seat-vocabulary-render.test.tsx`: rendered chat panel per trial/pass/classroom seat, start page chrome) · E (`e2e/trial-ux/run.mjs` TUX-CHAT-02 selects the button by "보내기") |



## M. Agent SDK coach runtime (#282)

다중 공급자 성인 실습과 요청 한도는 [MU-01~08](requirements/model-access-usage.md),
실제 실행 결과는 [모델·사용량 검증](testing/model-access-usage.md)에 연결한다.
기존 SDK 수업의 모델·도구 권한을 넓히지 않으며 금액 예산은 #800 후속이다.


> `hypeproofChat.coachRuntime = "agent-sdk"` 로 전환 시 코치를 Claude Agent SDK 위에서 구동. Phase 1: `@anthropic-ai/claude-agent-sdk` 가 실제 의존성으로 설치되어 있고(dev/extension-host 경로), worker 게이트웨이(`POST /v1/messages`, #316)로 라우팅된다. 아래 안전 계약은 pure helper 단위로 검증된다. Phase 2 부터 도구 정책의 canonical owner 는 **worker 프로필의 `sdk_tools`** 다 ([ADR 0003](adr/0003-agent-sdk-coach-runtime.md) / #283) — 클라이언트는 tier 로 파일 도구를 추론하지 않는다. 주의: SDK 는 플랫폼별 native `claude` 바이너리(~240 MB)를 optionalDependency 로 동반한다 — 패키징(.vsix/built-in)은 node_modules 를 포함하지 않으므로 그 경로에서는 REQ-M7 폴백이 동작하며, built-in 번들링 전략은 Phase-2+ 결정 사항이다.

### 두 런타임은 같지 않다 — 어디가 다른지 한 곳에서 (#749, 2026-09-08 감사)

같은 학생이 `coach_runtime` 에 따라 **다른 제품**을 쓴다. 그 차이를 매번 코드로 되짚느라
2026-09-08 감사에서만 한 시간을 썼고, 그 사이 1번 이슈가 한쪽 경로에서 아직 안 고쳐진 채로
발견됐다. 아래는 **길잡이 표**다 — 계약 자체는 각 행이 소유하고 여기서 반복하지 않는다
(두 곳에 적으면 한쪽이 드리프트한다).

**지금 아동 코호트 둘 다 `agent-sdk` 다** (`kids-2026-grade-3-4-s1`,
`kids-2026-grade-5-6-s1`). 아래에서 "클라이언트" 라고 적힌 칸은 그 아이들에게
Service 집행이 없다는 뜻이다.

| 무엇 | proxy (`/v1/chat/completions`) | agent-sdk (`/v1/messages`) | 계약 |
|---|---|---|---|
| 도구 배열 | 워커가 **직접 만든다** | 클라이언트가 선언하고 **클라이언트가 실행한다** | REQ-M38, [ADR-0007](adr/0007-lesson-feature-binding.md) |
| 수업 기능 좁히기 | 실제 경계 | 정상 클라이언트에만 유효 | REQ-M38 |
| `web_search` · 브라우저 | 워커가 주입/생략 | 클라이언트 선언 | REQ-M38 |
| 이미지 필터 (`input.image_paste`) | 워커가 거른다 | **워커가 거른다** (참가자 제공분만) | REQ-M43 |
| 잘림 안내 (max_tokens) | 워커가 끼워 넣는다 | 클라이언트가 낸다 (#749 이전엔 **없었다**) | REQ-M39 ⑥ |
| 종료 오류 안내 | — | 클라이언트가 낸다 | REQ-M39 |
| 모델 clamp | Service | Service (+ fast 예외) | REQ-M11, REQ-M36 |
| system prompt | Service 교체 | Service 교체 | REQ-M10 |
| 모더레이션 (미성년) | Service, 인바운드 | Service, 인바운드 | REQ-O2 — 아웃바운드 스트리밍은 **양쪽 다** 미구현이라 차이가 아니다 |
| `asset_score` · citations | 워커가 주입 | **미주입** (배선만 있고 미구현) | REQ-M12 |

**agent-sdk 좌석에서 Service 가 집행하는 것은 넷뿐이다**: 신뢰 게이트 · system prompt 교체 ·
모델 clamp · `max_tokens`/effort 정규화. 나머지는 **클라이언트 무결성** 속성이다 —
근거와 그 함의는 [ADR-0007 의 2026-09-08 amendment](adr/0007-lesson-feature-binding.md).

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-M1 | 프로필 → 도구 정책 매핑 (fail-closed) | `permittedToolsFor`: worker 프로필 `sdk_tools` 가 유일한 소스 — `read: true` → Read/Grep/Glob, `write: true` → Write/Edit. `sdk_tools` 부재/false → chat-only(`[]`), 워크숍 tier 라도 예외 없음 (tier 기반 추론 제거, #282 Phase 2) | U (`test/sdk-coach-helpers`) |
| REQ-M2 | WebSearch 는 프로필 opt-in 에만 | `tools.web_search === true` 인 cohort 만 WebSearch 부여 (assets_focus 추론 금지) | U (`test/sdk-coach-helpers`) |
| REQ-M3 | Minor 루프 bound | `maxTurnsFor`: 워크숍 tier(`search-webapp`·`website`) **60**, 그 외(미지정 포함 — `isMinorTier` 가 fail-closed 로 미성년 취급) **20** (v0.1.56 `sdkCoachHelpers.ts:97`, `:104-107`, `:382-389`; HEAD `bcfe8ebd` 같은 값 `:390-397`). 미성년 6→20 은 2026-08-19 실기(Read 1 + Edit 5 로 6 소진), 성인 20→60 은 2026-07-26 실측(멀티페이지 한 요청에 툴 54회)에서 왔고 60 은 잠정값이다. 폭주 방어는 턴 수가 아니라 Service `max_tokens` 상한(미성년 12000, Service main `399109c` `routes/messages.ts:505`)과 스톨 감시(REQ-M26)가 맡는다. **2026-10-14 정정**: 이 행은 '워크숍 20, 그 외 6' 으로 적혀 있어 v0.1.56 코드와 달랐다 | U (`test/sdk-coach-helpers` — v0.1.56 `:117-132`) |
| REQ-M4 | SDK 도구 → 정확한 ActionRequest kind | `sdkToolToActionRequest`(v0.1.56 `sdkCoachHelpers.ts:1641-1728`): Bash → `executeShell`(파괴 명령이면 `destructive`), Write/Edit/MultiEdit → `writeFile`+실경로, Read/Grep/Glob → `readFile`, WebSearch/WebFetch → `webSearch`, `browser_open`/`browser_click`/`browser_type` → `openBrowser`/`browserClick`/`browserType`, Agent/Task → `delegateAgent`, 미지 도구 → fail-closed(`executeShell`). **셸은 hard-deny 가 아니다** (epic #431, 2026-07-27 결정 — 이 행은 'Tier-1 hard-deny' 로 적혀 있었다, 2026-10-14 정정): `sdk_tools.shell` 을 연 코호트에서 `evaluateSdkToolUse` 는 되돌리기 어려운 명령(`isDestructiveCommand`, `shellPolicy.ts:43-90`, `:126`)만 `ask`+`destructive`(강한 확인)로 보내고 **나머지는 모달 없이 자동 실행**한다(`sdkCoachHelpers.ts:1919-1942`, `sdkCoach.ts:639-642`; HEAD `bcfe8ebd` `sdkCoachHelpers.ts:2220-2243` 동일). 셸을 열지 않은 코호트의 Bash 는 deny. 파괴 목록은 Unix 동사와 `curl`/`wget … \| sh` 만 다룬다 — PowerShell(`Remove-Item`, `irm … \| iex` 등)은 목록에 없어 Windows 에서 자동 실행된다(코드에서 읽은 공백, 실기 미검증). Service main `399109c` 는 그 명령을 가르치던 `workshop-setup` 을 더 이상 원문대로 보내지 않는다 — 세미나(디렉터)는 instruction-only 변형을 받고(`profiles/dental-copyclone-2026-s1.ts:150`, `skills/workshop-setup-instruction-only.md`) 홈페이지 연습은 그 스킬을 빼고 설치 요청을 강사·스태프에게 돌린다(`profiles/homepage-practice-s1.ts:41`, `:63-67`). 디렉터·canary 계약의 '셸 실행·외부 명령 금지' 는 '스킬에 적힌 단계에만 셸을 쓰고, 실행 전에 무엇을 왜 하는지 말하고, 실행하지 않은 명령을 실행했다고 말하지 않는다' 로 바뀌었다(`lib/translate.ts:59-64`). 클라이언트 쪽 보완은 Studio main `4304c25f`(#1629, FO-11)가 PowerShell·cmd 파괴 동사와 `… \| iex` 패턴을 `isDestructiveCommand` 에 더해 다음 앱 빌드부터 적용된다(`shellPolicy.ts:132`, Windows 규칙 `:192` 이하) — 설치된 v0.1.56 좌석에는 아직 없다. 미분류 도구 이름은 이 매핑 전에 drift 로 거부된다(`:1892-1898`) | U (`test/sdk-coach-helpers` — v0.1.56 `:159-161`, `:237-243`) |
| REQ-M5 | 매 tool use 는 canUseTool 게이트 | SDK `allowedTools` 는 빈 값 + `settingSources: []` — 모든 도구가 canUseTool 로 fall-through, cohort 미허용 도구는 deny | U + E |
| REQ-M6 | 게이트웨이 라우팅 + env 보존 | `buildSdkGatewayEnv`: process.env 스프레드(PATH/HOME 보존) 위에 SDK 인식 변수만 설정 — `ANTHROPIC_BASE_URL` 은 `proxyUrl` 설정에서 **파생**(`/v1` 접미사 제거 — SDK 가 `/v1/messages` 를 스스로 붙임), `ANTHROPIC_AUTH_TOKEN` = workshop 토큰 (커스텀 이름 금지) | U (`test/sdk-gateway`) |
| REQ-M7 | SDK 미가용 시 proxy fallback | 패키지 로드 실패(패키징 빌드 등 node_modules 부재) → `SdkUnavailableError` → 해당 턴 proxy 로 폴백 (학생에게 raw 에러 미노출). **폴백 동작 자체는 이 행 그대로 유지**되고, 그것이 *보이게* 되는 계약은 REQ-M30 이 소유한다 — "콘솔 경고"였던 부분은 어디에도 남지 않는 로그였으므로 REQ-M30 이 대체했다(#476). Exception: an SDK-only seat (native trial, pass) never falls back; see REQ-M45 | U + E |
| REQ-M8 | Abort parity | agent-sdk 경로도 stop 시 AbortError throw → streamEnd·appendHistory 건너뜀 (잘린 턴 미커밋); abort listener 는 `loadSdk()` 이전 등록. **UI 상태 해제는 이 경로가 아니라 `cancelStream` 핸들러의 `streamStopped` 가 책임진다** (REQ-C6, #497) — `handleSend`/`handleSendError` 의 "웹뷰가 이미 스트림을 끝냈다"는 전제는 성립한 적이 없었다. 부분 출력은 화면에만 남고 영속 히스토리엔 들어가지 않는다(의도된 동작) | U + E |
| REQ-M9 | `/v1/messages` 게이트 parity | worker `POST /v1/messages` (Anthropic-native 게이트웨이) 는 `/v1/chat/completions` 와 동일 게이트 공유 (`lib/chat-gate.ts`): 토큰 verify · issuer 거부 · revocation · session window · roster · cohort pause · signingSecretGuard | R (`worker/test/messages-integration.test.mjs`, `route-order.test.mjs`) |
| REQ-M10 | 서버측 system prompt 강제 | `/v1/messages` 는 클라이언트 `system` 을 병합 없이 폐기하고 cohort 프로필 블록으로 교체 (`buildAnthropicSystemBlocks` — `/v1/chat` 과 byte-identical, prompt-cache 마커 유지). classroom key 는 worker 밖으로 안 나감 (upstream 은 `x-api-key`, 학생 토큰 미전달). **2026-10-14 메모 (5.5 재지정)**: 교체는 보조 요청과 참가자 요청을 가르지 않으므로 SDK 보조 호출도 같은 cohort prefix 를 싣는다 — `hypeproof-fast` 재지정은 모든 보조 호출의 모델과 비용을 바꾼다(REQ-M11). 또 교체된 `system` 의 coach tail(작업 폴더 목록·미리보기 URL)은 프롬프트 사이에 바뀐다. 5.5 모델은 thinking block 을 그 prefix 에 묶어 바뀐 prefix 뒤의 이전 블록 재생을 400 으로 거부한다(문서상 2026-08-31 이후 생성 계정). 그래서 게이트웨이는 5.5 의 adaptive thinking 요청에 `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` 과 beta `thinking-binding-controls-2026-08-01` 을 붙인다 — 클라이언트 값은 덮지 않고, 같은 검사를 하는 count_tokens 에도 붙인다(Service main `399109c` `lib/model-caps.ts:498`, `:514-528`; `routes/messages.ts:632-635`, `:663`; count_tokens `:956`, `:968`). macOS 의 0% 버전 rc1 `e4483c9b`·rc2 `987383f4` 파일 쓰기 실행에서 400 은 나오지 않았다(hypeproof/hypeproof-service#73 본문) — 블록이 실제로 버려졌는지와 조직 생성일은 따로 관측하지 않았다 | R (`worker/test/messages-integration.test.mjs`) |
| REQ-M11 | 모델 정책 clamp와 fast 예외 | `/v1/messages`는 default/fallback에 `hypeproof-fast`를 항상 추가해 요청 alias/id를 clamp하며 `claude-*haiku*`도 fast 핀으로 보낸다. 프로필에 fast fallback이 없어도 허용된다. SDK 보조 호출 비용이 도입 이유이지만 현재 resolver는 일반 요청과 보조 요청을 구분하지 않음. 그 외는 프로필 default 강제. 이 예외를 수업의 엄격한 단일 모델 제한으로 표현하지 않으며 AE-25/26의 수업별 정책 집행은 별도 계획. **2026-10-14 메모**: 재지정 후 fast 핀은 `claude-haiku-5-5` 이고, 잠기지 않은 프로필에서 코호트가 나열하지 않은 `claude-*haiku*` 요청이 그리로 clamp 된다(Service main `399109c` `profiles/types.ts:551`, `routes/messages.ts:168-180`; 이 PR 전의 배포 고정 `43dd009` 에서는 `claude-haiku-4-5`). 확정 수업(`lesson_locked`)에는 이 예외가 없다(REQ-M36). 게이트웨이는 이 보조 호출을 Haiku 5.5 의 up-front thinking off(`disabled`)·effort low 로 보낸다 — 미성년은 MINOR_EFFORT, effort 정책이 있는 코호트(이용권·홈페이지 연습 medium)는 그 정책이 effort 를 정한다(`routes/messages.ts:580-596`; `lib/model-caps.ts:430-459`). 끝이 assistant prefill 인 보조 호출은 Haiku 5.5 가 400 으로 거부하므로(`assistantPrefill: false`, `lib/model-caps.ts:77-82`, `:200`) thinking 없이 `claude-haiku-4-5` 로 보낸다(`routes/messages.ts:182-187`, `:471-486`) — 주 코치 호출은 옮기지 않는다. 토큰 단가는 100K 토큰 이하 프롬프트에서 Haiku 4.5 보다 약 90% 낮고 100K 초과 프롬프트는 5배 요율이다. v0.1.56(Agent SDK 0.3.207, `ANTHROPIC_DEFAULT_HAIKU_MODEL` 미설정)의 CLI 가 배경 호출을 haiku id 로 보내는지 주 모델로 보내는지는 미검증이다 — 2026-08-10~09-09 운영 usage_log 9,638건은 전부 Sonnet 4.6 이라([budget-readiness](research/budget-readiness-2026-09-08/README.md)) '보조 호출 없음' 과 '주 모델로 감' 을 가르지 못한다. 명시 정책·예산은 여전히 AE-25 의 미결 항목 | R (`worker/test/messages-integration.test.mjs`) |
| REQ-M12 | Anthropic-native passthrough + 계량 | 응답은 원형 그대로 (non-stream JSON verbatim; stream 은 Anthropic SSE verbatim — OpenAI chunk/[DONE]/asset_score 미주입) + usage tap 으로 `usage_log`/`turns` 를 chat 과 동일 스키마로 기록; upstream 에러·stream 중단은 #257 규율 (request_id 만 노출) | R (`worker/test/messages-integration.test.mjs`) |
| REQ-M13 | 로컬 자격증명 불요·불허 | agent-sdk 경로의 유일한 자격증명은 workshop 토큰. `buildSdkGatewayEnv` 가 ambient `ANTHROPIC_API_KEY`(AUTH_TOKEN 보다 우선순위 높음)·`CLAUDE_CODE_OAUTH_TOKEN`·`CLAUDE_CODE_USE_BEDROCK`·`CLAUDE_CODE_USE_VERTEX` 를 스크럽하고, **`CLAUDE_CONFIG_DIR` 을 코치 전용 디렉터리로 격리**(`sdkConfigDirFor`) — env 스크럽은 **디스크에 저장된** 자격증명에 닿지 못한다. CLI 는 자기 config dir 의 Claude Code/Desktop OAuth 자격증명을 `ANTHROPIC_AUTH_TOKEN` 보다 **우선**하므로, 격리 없이는 `claude` 를 한 번이라도 쓴 머신에서 코치가 그 사람 개인 계정으로 게이트웨이에 붙고 401 로 죽는다(2026-07-28 Windows 실측: 유효 토큰인데 401×9 → 격리 후 1회 성공). 개인 자격증명이 게이트웨이로 **유출되지도** 않는다. classroom Anthropic key 는 worker 밖으로 안 나감 | U (`test/sdk-gateway`) |
| REQ-STUDIO-DEV-SUBSCRIPTION | Explicit isolated developer subscription runtime | On macOS arm64 and Windows, the development launcher checks an installed Claude Code/Codex subscription login and runs the locally built extension/webview in a separately identified app copy. Both Dev identity and launcher opt-in are required; the Service must be loopback, signed participant/profile authorization and tool approvals remain active, and API/admin/workshop credentials are scrubbed from CLI children. Windows native CLI paths and descendant cancellation are supported. Optional local setup reuses existing admin issuance and refuses production. This developer-only exception does not change REQ-M13 release behavior or establish learner outcomes. | U (`scripts/test-studio-dev.py`, `test/local-runtime`) + actual native app evidence |
| REQ-M31 | ~~미성년은 어느 경로로도 agent-sdk 에 닿지 않는다~~ **대체됨(2026-08-11 d116c2a7, REQ-M32)** | 런타임 선택은 `resolveCoachRuntime`(chatPanelHelpers, pure)이 소유한다. 워커가 미성년 프로필의 `coach_runtime` 을 proxy 로 강제하는 것(routes/chat.ts)과 **짝을 이루는 클라이언트 측 가드**다. 2026-08-11 실측에서 비대칭이 드러났다 — 인라인 판단이 프로필 경로만 미성년을 걸렀고 머신 스코프 `hypeproofChat.coachRuntime` 경로는 안 걸러, 그 설정이 켜진 기기에서 워커의 핀이 우회됐다. 권한 침해는 아니다(도구는 `sdk_tools` 가 소유하고 미성년 프로필은 이를 두지 않아 `permittedToolsFor` 가 빈 배열을 낸다). 그러나 **도구 0개로 SDK 루프가 돌면서 툴 호출 원문이 아이 화면에 그대로 렌더되고, 쓰지도 않은 파일을 썼다고 단언**했다(R0 위반) — 실기기 관측. 계약: 설정·프로필 두 경로의 **합집합 바깥**에 미성년 검사를 둔다. `minor_cohort` 를 모르는 응답(구 워커)에서는 기존 동작을 유지한다 — fail-closed 로 바꾸면 성인 코호트가 조용히 강등된다 | U (`test/coach-runtime`) |
| REQ-M32 | 아동 코호트의 workspace read/write (2026-08-11 결정) | 커리큘럼이 "코치가 워크스페이스 파일을 읽고 고친다" 를 전제로 바뀌어, SK 두 아동 트랙이 `sdk_tools: {read,write}` + `coach_runtime: "agent-sdk"` 를 명시적으로 opt-in 한다. 이전 불변식("minors never gain workspace write capability", #282 P2)을 이 행이 대체한다. **함께 유지되는 것:** ① 인바운드/아웃바운드 모더레이션(REQ-O2/O3)은 `isMinorCohort` 로 그대로 돈다 — 이 변경과 무관한 계층이다; ② `shell`·`browser`·`subagents` 는 아동에게 여전히 닫혀 있고 하네스가 `child_sdk_browser`/`child_sdk_subagents` HARD FAIL 로 막는다; ③ 모든 툴 호출은 `canUseTool` 승인 게이트를 지나고 `workspace_root` 밖 경로는 `evaluateSdkToolUse` 가 거부한다. **새 배선 검사:** `write` 를 열었으면 실행될 런타임이 있어야 한다 — `coach_runtime != "agent-sdk"` 이면 워커가 proxy 로 내려주고 코치는 도구가 있다고 믿은 채 실패한다(#476 오진 패턴). 하네스 `child_sdk_write_without_runtime` HARD FAIL. 클라이언트의 minor-tier write 스트립도 제거했다 — 정책 owner 는 프로필이며(ADR 0003) 클라이언트가 다시 깎으면 권한이 조용히 사라진다 | R (`worker/test/chat-integration`, `worker/test/smoke`) + U (`extensions/…/test/sdk-coach-helpers`) |
| REQ-M33 | 톤 문구는 tier 를 따라간다 (게임 프레임 금지 트랙) | `appToneOf` 가 `template_tier` → 톤을 정하고 `TONE_LABELS` 가 문구를 소유한다. **웹뷰는 같은 로직을 손으로 미러링**한다 — `chatPanelHelpers` 가 Node `Buffer` 를 쓰기 때문에 import 할 수 없다(extension-dev.md Boundaries). 미러는 없앨 수 없으므로 **어긋나면 잡는다**: `test/tone-mirror.smoke.mjs` 가 tier 분기·buildingLabel·namingEmoji 일치를 강제하고, "게임 프레임 금지" 트랙(world)의 문구에 `게임`·🎮 가 없음을 검사한다. 2026-08-17 Windows 실기기에서 `kids-world` 가 톤 판정에 없어 `game` 으로 떨어졌고, 커리큘럼이 금지한 "게임" 낱말이 UI 8곳에 노출됐다 | U (`test/tone-mirror`) |
| REQ-M34 | "띄워줘" 는 다시 만들지 않는다 | `isShowIntent` 가 참이면 기존 산출물을 **여는** 것으로 처리하고 코치에게 넘기지 않는다. 동사 목록에 `띄워`·`띄어` 가 없어 2026-08-17 실기기에서 "띄워봐" 가 생성 요청으로 흘러 **세계를 처음부터 다시 그렸다** — 아이는 보려던 것을 더 오래 기다렸다. 접두사도 `게임` 뿐이라 `미래/그림/세계/동네 보여줘` 가 전부 빠져나갔다. 대조군: 양성(띄워봐·미래 보여줘·run) / 음성(별이 떨어지는 게임 보여줘·비 내리게 해줘 — 생성 요청은 통과해야 한다) | U (`test/chat-panel-helpers`) |
| REQ-M35 | 미리보기가 열리는 동안 화면이 멈춘 것처럼 보이지 않는다 | 스트림 종료와 미리보기 표시 사이에 라이브서버 기동 + 탭 열기가 들어간다. 그 구간을 타임라인 한 줄(`🖼️ 미리보기 여는 중` → `미리보기를 열었어요`)로 메운다. 실패하면 `error` 상태로 바뀌어 "열었다고 말했는데 안 열린" 상태가 남지 않는다(R0). 진행 줄 자체도 shimmer + breathe 로 살아있음을 보인다 — 정적 표시를 초3·4 는 고장으로 읽는다. `prefers-reduced-motion` 이면 애니메이션을 끈다 | E |
| REQ-M14 | 설정 기본값과 실제 런타임 구분 | `hypeproofChat.coachRuntime`의 manifest default는 `"proxy"`로 유지. 실제 선택은 Service의 `coach_runtime`과 machine 설정을 함께 읽어 어느 쪽이든 `agent-sdk`면 SDK 경로를 요청하며 미성년 조건은 proxy로 강제한다. SDK를 로드하지 못한 턴의 proxy fallback은 REQ-M7/M30을 적용. manifest 기본값만으로 모든 수업이 proxy 실행이라고 판정하지 않음 | U (`test/sdk-gateway`, `test/coach-runtime.smoke.mjs`) + E |
| REQ-M15 | 게이트웨이 4xx fast-fail (#320) | SDK CLI 는 401/400 도 최대 10회 backoff 재시도 → 만료 토큰이 아이에게 수 분간 무응답으로 보임. `consumeSdkStream`: `api_retry` 이벤트의 `error_status` 401/400 이면 **첫 이벤트에서** 쿼리 abort. 단 **원인을 단정하지 않는다**: `api_retry` 는 상태코드만 싣고 `error.code` 가 없어 401 이 만료인지·자격증명 거부인지 구분할 근거가 없다. 401은 `SdkGatewayAuthError`로 표시하고, 이미 인증된 프로필이 산 이용권이면 같은 코드로 `/profile`을 다시 읽는다. 그 응답이 정확히 `trial_revoked_or_reissued`/`trial_expired`일 때만 이용권 종료 안내를 보이며 자격증명은 지우거나 바꾸지 않는다. 유효 프로필·일반 체험·네트워크 실패·다른 오류 코드는 기존 `GATEWAY_AUTH_FAILED_FRIENDLY`와 재입력 동작을 유지한다. 400 → `ProxyAuthError("other", GATEWAY_BAD_REQUEST_FRIENDLY)`(인증 문제가 아니므로 토큰 언급 금지). 실제 상태코드는 `console.warn`으로 남긴다. 429/5xx/529/연결오류(null status)는 SDK backoff 유지 | U (`test/sdk-fastfail`, `test/sdk-paid-pass-ending`) |
| REQ-M16 | `sdk_tools` 는 프로필 소유 + 가용성/승인 분리 (#282 P2) | Service `Profile.sdk_tools { read, write, browser, subagents, shell }` 이 `/v1/profile` 로 노출(부재 → 명시적 false 정규화; Service main `399109c` `profiles/types.ts:315-331`, `routes/chat.ts:519-536`). **`shell` 플래그는 존재한다** (epic #431 — 이 행은 '스키마에 shell/exec 플래그 자체가 존재하지 않음' 으로 적혀 있었다, 2026-10-14 정정): 성인 워크숍 코호트만 켜고(예: 디렉터 copyclone `dental-copyclone-2026-s1.ts:137`) 미성년 전용 가드는 없다 — 프로필이 정책이다. 클라이언트는 `shell: true` 를 `Bash` 로 매핑한다(v0.1.56 `sdkCoachHelpers.ts:197-199`); 승인 방식은 REQ-M4·REQ-E1. 클라이언트 매핑: `buildSdkQueryOptions` 가 permitted set 을 SDK `Options.tools`(base tool set — 가용성)로 전달, chat-only cohort 는 `tools: []` 로 빌트인 전체 비활성(`:885-930`). `allowedTools` 는 항상 `[]` 유지(`:925`) — allowedTools 항목은 **auto-approve 로 canUseTool 을 우회**하므로 승인 모달을 무력화한다(가용성≠승인). 프로필 밖으로 절대 확장 금지. '셸 플래그 없음' 이라는 낡은 문장은 Service `399109c` `types.ts:287` JSDoc 과 v0.1.56 `sdkCoachHelpers.ts:111` 주석에, '모든 셸 명령이 승인 모달로 간다' 는 낡은 문장은 `:192-196` 주석에 남아 있다(동작이 아니라 주석) | U (`test/sdk-coach-helpers`, `test/sdk-gateway`) + R (`worker/test/chat-integration`) |
| REQ-M17 | canUseTool 정책 매트릭스 (#282 P2) | `evaluateSdkToolUse` (매 tool call): ① 프로필 미허용 도구(Bash·미 opt-in WebFetch·미지/MCP 도구) → **deny** + 호스트 로그(사유), 학생에겐 한국어 안내; ② read 도구(Read/Grep/Glob)는 **워크스페이스 내부 경로만 자동 허용** — `../` 탈출·cwd 밖 절대경로·절대/`..` Glob 패턴은 deny (`isPathContained`); ③ write 도구(Write/Edit)는 경로 격리 통과 후에도 **항상** `resolveActionApproval` 승인 모달 경유 (승인 게이트가 곧 pedagogy — delegation_judgment·verification_reflex); shell 은 permitted set 이 오염돼도 deny (belt-over-suspenders) | U (`test/sdk-coach-helpers`) |
| REQ-M18 | 미성년 write 불가 invariant (#282 P2, #320) | 미성년 cohort 는 어떤 경로로도 write/exec 능력을 얻지 않는다: ① worker cohort-harness `child_sdk_write` **FAIL** (child cohort 의 `sdk_tools.write: true` 차단, `validate-profiles` + CI); ② worker smoke — parent_coaching cohort 전수 `sdk_tools.write ≠ true`; ③ 클라이언트 `permittedToolsFor` 가 minor tier 에서 write 도구를 **무조건 strip** (프로필이 오염돼도 방어). 의심스러우면 deny | U (`test/sdk-coach-helpers`) + R (`worker/test/smoke`, cohort-harness fixtures) |
| REQ-M19 | 브라우저 MCP 도구는 프로필 소유 (#282 P2 slice 2, #309) | `Profile.sdk_tools.browser` 가 `/v1/profile` 로 노출(부재 → false). grant 시 in-process SDK MCP 서버 `"hypeproof"` (`createSdkMcpServer`) 가 `mcpServers` 로 등록 — 도구: `browser_open(url)`·`browser_screenshot()`(vision image 반환)·`live_preview_start()` (#309 native browser + live server 재사용). 등록 조건: `permittedMcpToolsFor` 비어있지 않음(성인 + browser=true) AND SDK/zod factory 가용 — 아니면 browser-less 로 우아하게 강등. MCP 이름은 `Options.tools`(빌트인 가용성)에 **절대 안 들어감**; `strictMcpConfig: true` 로 ambient MCP 설정(.mcp.json/유저 설정/플러그인) 차단; `allowedTools` 는 여전히 `[]` (모든 호출이 canUseTool 경유) | U (`test/sdk-coach-helpers`, `test/sdk-gateway`, `test/browser-mcp`) + R (`worker/test/chat-integration`) |
| REQ-M20 | 브라우저 MCP canUseTool 정책 (#282 P2 slice 2) | `evaluateSdkToolUse`: ① `browser_open` 은 **outward action** — URL 정책(`safeNavigateUrl` 재사용: http(s)/localhost/file 만, `javascript:`·`vscode:`·`data:`·bare path 거부)을 모달 **이전에** 통과해야 하고, 통과해도 **항상** 승인 모달 (`ActionRequest kind "openBrowser"`, `requireApprovalFor` 기본값 포함 — delegation_judgment; #415 이후 "이미 열려 있어 **실제로 열지 않는**" 경우만 예외 — REQ-M28); ② `browser_screenshot`/`live_preview_start` 는 browser grant 존재 시 자동 허용 (학생 자신의 탭/워크스페이스를 코치가 "보는" 행위 — verification_reflex); ③ 미허용 cohort 의 hypeproof MCP 도구·모든 외부 `mcp__*` 도구 → deny; 핸들러도 URL 정책을 재검증 (belt-over-suspenders, 거부 시 isError 결과) | U (`test/sdk-coach-helpers`, `test/browser-mcp`) |
| REQ-M21 | 브라우저 도구는 나이로 깎지 않는다 (2026-10-05 변경 · 이전: 미성년 브라우저 도구 불가 invariant, #282 P2 slice 2, #306/#318) | `sdk_tools.browser`(SDK)·`browser_control.enabled`(프록시)가 켜진 코호트는 나이·tier 와 무관하게 브라우저 도구를 받는다. 클라이언트 `permittedMcpToolsFor` 는 플래그만 본다. cohort-harness `child_sdk_browser`·`child_browser_control` 과 worker smoke 의 parent_coaching 전수 검사는 제거했다. 아동 코호트가 켜면 하드닝 세션(`child_browser_session_safe` FAIL)과 인바운드·아웃바운드 모더레이션(`isMinorCohort`)이 그대로 걸린다. 근거: AI for Good 창업 과정이 고등학생 코호트를 대상으로 한다 | U (`test/sdk-coach-helpers`, `test/sdk-gateway`, `test/sdk-binary`) + R (cohort-harness fixtures T10) |
| REQ-M22 | SDK subagents 는 프로필 소유 + 읽기 전용 교집합 (#282 P2 slice 3) | `Profile.sdk_tools.subagents` 가 `/v1/profile` 로 노출(부재 → false). grant 시: ① 읽기 전용 subagent 카탈로그(`코드리뷰어`/`리서처` — 한국어 prompt, 이 slice 에선 web 도구 없음)가 SDK `Options.agents` 로 정의되고 Agent/Task invoker 가 `Options.tools` 에 합류 — 미grant 시 `agents` 키 자체가 부재해 모델이 subagent 를 볼 수 없음; ② 각 definition 의 `tools` 는 wishlist(Read/Grep/Glob) ∩ cohort permitted set — definition 이 drift 해 Write 를 열어도 교집합이 strip (read-only cohort 의 코드리뷰어는 절대 Write 불가), `tools` 는 **항상 명시** (생략 시 부모 전체 도구 상속 — sdk.d.ts `AgentDefinition.tools`), `disallowedTools` 로 Bash/Write/Edit/Web 이중 차단; ③ 위임(Agent/Task 호출)은 카탈로그 내 `subagent_type` 만 허용(미지/부재 → deny) + **항상** 승인 모달 (`ActionRequest kind "delegateAgent"`, `requireApprovalFor` 기본값 포함) — 학생의 승인/거부가 곧 delegation_judgment pedagogy (seven-assets §5); ④ **subagent 의 도구 호출도 부모 `canUseTool` 을 경유** (sdk.d.ts@0.3.207 `CanUseTool` options 의 `agentID` — "If running within the context of a sub-agent, the sub-agent's ID") → 동일 `evaluateSdkToolUse` 매트릭스 적용, definition allowlist 는 defense-in-depth | U (`test/sdk-subagents`) + R (`worker/test/chat-integration`) |
| REQ-M23 | SDK subagent 는 나이로 깎지 않는다 (2026-10-05 변경 · 이전: 미성년 subagent 불가 invariant, #282 P2 slice 3) | `sdk_tools.subagents` 가 켜진 코호트는 나이·tier 와 무관하게 읽기 전용 subagent 카탈로그를 받는다(REQ-M22 의 교집합·`allowedTools: []` 는 그대로). cohort-harness `child_sdk_subagents` 와 worker smoke 의 parent_coaching 전수 검사는 제거했다 | U (`test/sdk-subagents`) + R (cohort-harness fixtures T10) |
| REQ-M25 | SDK JS 벤더링 → 패키징 빌드에서 SDK 코치 구동 (#282 W4b, [docs/sdk-bundling.md](sdk-bundling.md)) | 패키징 빌드는 `node_modules` 를 포함하지 않아 SDK JS(`sdk.mjs`) 의 variable-specifier dynamic import 가 실패 → REQ-M7 프록시 폴백 (W4b 이전 상태). W4b: `scripts/inject-builtin-extensions.sh` 가 `@anthropic-ai/claude-agent-sdk`(package-lock 핀) + `ajv`·`ajv-formats`(sdk.mjs 의 런타임 import — self-contained 아님) + `zod`(브라우저 MCP 스키마)를 `--omit=optional`(229 MB 플랫폼 바이너리 제외 — W4a seed 담당)·`--omit=dev`·`--omit=peer` 로 **`dist/vendor/node_modules`** 에 설치(~13 MB). `dist/` 아래에 두는 이유: inject 스크립트와 fork `prepare_vscode.sh` re-inject 가 **둘 다** `dist/` 를 통째로 복사(`cp -r dist`) → vscodium-base 수정 없이 두 경로 모두에 실림(버전 스탬프가 SOURCE package.json 을 쓰는 것과 동일 패턴); `dist/` 는 gitignore 라 커밋 안 됨(빌드 산출물). 빌드 가드: SDK/zod entry 존재 + 플랫폼-바이너리 패키지 누출 없음 + 50 MB 초과 파일 없음 + 벤더 `sdk.mjs` 를 실제로 import 해 `query()` 확인(런타임 closure 완결성). `loadSdk`/`loadZod`: `resolveSdkModule`/`resolveZodModule`(pure, fileExists 주입) — 벤더 copy(`<dist>/vendor`, `file://` URL, `__dirname` 앵커) → bare specifier(dev node_modules) → import 실패 → `SdkUnavailableError` → 프록시 폴백(REQ-M7 그대로). 결과: 벤더 JS(앱에 실림) + seed 바이너리(W4a) → 패키징 빌드에서 SDK 코치 최초 구동 | U (`test/sdk-vendor`) |
| REQ-M26 | SDK 턴 stall 워치독 — 무한 "생각하는 중" 금지 (#403) | REQ-M15 의 fast-fail 은 401/400 **뿐**. 나머지(429·529·5xx·연결끊김 → SDK CLI 가 최대 10회 backoff 재시도, 또는 첫 토큰이 아예 안 나오는 무거운 첫 턴)는 스트림 이벤트가 하나도 안 나와 학생 화면엔 "생각하는 중… ✨" 만 영원히 — 에러도 탈출구도 없음(무거운 디자인 프롬프트 실측 4/4). `consumeSdkStream` 이 자체 데드라인 보유: **진행(progress) 없이 `stallMs` 경과 → 쿼리 abort + `CoachStallError(SDK_STALL_FRIENDLY)` throw** → 프록시 경로와 동일하게 streamError 배너로 노출(원문 그대로, 영문/JSON 노출 없음). 규칙: ① `api_retry` 틱은 **진행이 아님**(backoff 스케줄이 예산을 무한 갱신하면 잡으려는 그 hang 이 됨), ② 승인 모달 열림·도구 실행 중(`isTurnBlocked` — 모달 카운터 OR 마지막 `canUseTool` 결정 후 1 예산 이내)은 정상 침묵이라 예산 갱신, 블록 해제 후 grace 1회 → 최대 2 예산, 그래도 무응답이면 stall, ③ 401/400 fast-fail 과 사용자 stop(REQ-M8)은 그대로 우선. 예산: `hypeproofChat.sdkStallTimeoutMs`(machine-scope, 기본 `SDK_STREAM_STALL_MS` = **240 s**, `0` = 비활성) — 추측이 아니라 실측 기반: 건강한 copyclone 턴 1회(2026-07-24, 시드 SDK→prod)가 **286 s·4턴·87 이벤트**였고 이벤트 사이 최대 침묵이 **~86 s**(긴 thinking 구간, `system/thinking_tokens`가 침묵을 끊는다). 첫 안은 120 s였는데 여유가 34 s뿐이라 조금만 무거운 페이지면 **정상 턴을 죽인다** → 관측 최악 간격의 3배로 재보정 — manifest 기본값과 상수는 스모크로 단일 소스 잠금 | U (`test/sdk-stall-watchdog`) |
| REQ-M28 | 브라우저 상태 인지 — 이미 열린 페이지를 또 열지 않는다 (#415) | 코치가 브라우저 현재 상태를 읽을 수단이 없어 매번 새로 여는 게 유일한 선택지였다 → 승인 모달 반복(교육 장치인 승인 게이트가 무의미한 반복으로 마모된다 — delegation_judgment)·보던 페이지 리로드·턴 예산 낭비. 2026-07-24 실사용에서 `live_preview_start` → `browser_screenshot` → `browser_open`(같은 URL) 순서로 **같은 URL 탭이 두 개** 열리고 중복 open 의 승인 대기로 턴이 ~2분 멈췄다. ① `BrowserMcpHost.currentPage?()` — **스크린샷 없이** url/title 만 (`vscode.window.activeBrowserTab` 그대로; CDP 접속조차 불필요). optional 이라 미지원 호스트는 예전 동작(무조건 열기)으로 폴백; ② `browser_open` 은 요청 URL 이 현재 페이지와 같으면(`isSameBrowserUrl` — 끝 슬래시·스킴/호스트 대소문자·빈 `?`/`#` 무시, 경로·포트·query·hash·`localhost`↔`127.0.0.1` 은 구분) **호스트를 부르지 않고** "이미 열려 있어요" 결과 반환 → 탭 중복·리로드 없음. 승인 모달은 핸들러보다 **먼저** 뜨므로 canUseTool 도 같은 판정(`resolveAlreadyOpen` — 핸들러와 **단일 소스**; 갈라지면 "모달 없는 실제 오픈" 구멍이 된다)으로 모달을 건너뛴다 — 실제로 여는 동작이 없으니 물을 것이 없다. REQ-M20 의 "항상 모달"은 **실제로 여는 경우**를 뜻한다(정책 위반 URL·비문자열 입력·상태 미확인은 전부 `alreadyOpen=false` → 평소대로 모달); ③ 모든 브라우저 도구 결과 끝에 `현재 열린 페이지: <url>`(탭 없으면 `없음`) 한 줄 — 도구 **설명**이 아니라 **결과**가 컨텍스트에 남으므로 상태 학습은 결과로만 가능. 상태를 모르면(미지원/조회 실패) 지어내지 않고 줄을 생략; ④ `live_preview_start` 결과 문장이 브라우저까지 열렸음을 직접 말한다(`라이브 프리뷰를 시작하고 브라우저에 열었어요: <url>`) — "서버 주소만 받았다"로 읽혀 후속 `browser_open` 을 유발한 것이 실제 1차 원인, ②는 백스톱 | U (`test/browser-mcp`, `test/browser-control-helpers`) |
| REQ-M29 | 코치 브라우징은 슬롯 2개, 탭은 늘지 않는다 (#519) | `openBrowserTab` 은 URL 재사용이 **없다** — `mainThreadBrowsers.$openBrowserTab` 이 매 호출 새 UUID 로 새 에디터를 연다. REQ-M28 의 중복 방지는 ① `activeBrowserTab` **하나**만 봤고(그 값은 활성 에디터가 브라우저일 때만 세팅 — 참가자가 코드 탭을 클릭하는 순간 판정이 조용히 꺼진다), ② 정리 로직(`coachTabsToClose`)은 루프백을 대상에서 통째로 뺐다("루프백 = 프리뷰 하나" 가정). 결과: 코치가 참가자 결과물의 하위 페이지를 돌면 탐색마다 탭이 쌓이고(대조군 관측 2026-08-01: 4회 탐색 → 4탭, 같은 URL 재방문도 중복), 다음 주소가 루프백일 때는 **바깥 주소 탭을 전부 닫아** 참가자가 보던 정답지를 죽였다 — 커리큘럼이 요구하는 "정답지와 내 결과물 비교"(코호트 프롬프트 :107-109)가 코드에서 깨져 있었다. 계약: ① **슬롯 2개** — `coachTabSlot(url)`: 루프백 = `preview`(참가자 결과물), 나머지 = `reference`(참고 사이트). `planCoachBrowserTabs` 는 같은 슬롯 탭 하나를 재사용 대상으로 고르고(같은 URL 우선) 같은 슬롯의 **잉여만** 닫으며 **다른 슬롯은 건드리지 않는다** → 탐색 횟수와 무관하게 탭 총수 ≤ 2; ② **열지 말고 이동** — `host.openBrowser` 는 재사용 탭을 고정한 뒤 `BrowserControl` 의 `browser_navigate`(CDP `Page.navigate`)를 태운다. 프록시 경로(#278)와 **같은 실행기**를 쓴다(두 벌이면 한쪽만 고쳐진다 — #457 과 같은 이유). 이동 실패 시에만 새로 여는 쪽으로 폴백; ③ **탭 핸들 고정** — `BrowserControl.setTargetTab`/`currentTab()`: `openBrowserTab` 이 돌려준 핸들을 들고, `browserTabs` 에 살아 있으면 그것을, 아니면 `activeBrowserTab` 으로 폴백. 이것이 `preserveFocus: true` 를 안전하게 켜기 위한 전제다 — 포커스 없이도 검사 3종·스크린샷이 같은 페이지를 운전한다; ④ **컬럼 명시** — 새 탭은 `preview`→`ViewColumn.One`, `reference`→`Two`. `Beside`(SIDE_GROUP)는 활성 그룹 오른쪽 이웃을 찾고 없으면 새 그룹을 만들어, 방금 연 탭이 활성(맨 오른쪽)이면 호출마다 컬럼이 갈라져 작업 공간이 좁아진다; ⑤ 중복 판정(REQ-M28 ②)은 `BrowserMcpHost.openPages?()` 로 **열린 탭 전부**와 비교 — 슬롯이 둘이라 "지금 보는 페이지"만으로는 다른 슬롯에 이미 떠 있는 것을 놓쳐 불필요한 모달이 뜬다. optional 이라 미지원/조회 실패는 `currentPage` 폴백. ⑥ **한계를 숨기지 않는다 (#526)** — 슬롯당 탭 하나라 같은 슬롯으로의 open 은 실제로는 기존 탭의 **이동**이고 보고 있던 페이지가 화면에서 사라진다. `host.openBrowser` 는 밀려난 페이지를 `BrowserOpenOutcome.replaced` 로 돌려주고(이동 **전에** 캡처 — 후에 읽으면 이미 새 주소다) `browser_open` 결과가 그것을 문장으로 적는다. 안 그러면 코치는 참고 사이트 둘이 나란히 떠 있다고 믿고 없는 화면을 설명한다(지어낸 성공 — R0 계열). 같은 주소가 밀려난 것으로 보고되면 무시한다(참가자 눈엔 사라진 게 없다). 반환값은 optional — 구버전 호스트는 예전 문장 그대로. SDK 계약(`_browser-control-contract-sdk.md`)도 "결과물 1개 · 참고 사이트 1개, 동종 두 개는 번갈아"를 명시해 코치가 애초에 과약속하지 않게 한다. **슬롯 개수는 늘리지 않는다** — 동종 나란히 보기는 세 번째 컬럼과 #525(`BrowserTab.show()` 부재)이 필요하고, 둘 다 이 계약의 목적(탭 누적 방지)과 상충한다. ⑦ **앞으로 가져오기 (#525)** — 고정(REQ-M30)만으로는 참가자가 못 본다. 탭이 배경이면 화면은 그대로다. proposed API 의 `BrowserTab` 에는 `show()`/`reveal()` 이 없고 `openBrowserTab` 재호출은 새 탭을 만들므로(①을 되돌린다), **일반 에디터 경로**를 쓴다: `workbench.action.focus{First,Second}EditorGroup` → `workbench.action.openEditorAtIndex`(활성 그룹·0-based) → 참가자가 편집기에 있었으면 `showTextDocument` 로 bounce. 적용 대상은 **참가자가 요청한 흐름만** — `browser_open`(실제 이동/alreadyOpen)과 `live_preview_start` 재사용. `browser_read`/`click`/`type`/`screenshot` 같은 내부 확인에는 하지 않는다(호출마다 화면을 뺏으면 승인 게이트 마모와 같은 실패다). 탭 식별은 `pickRevealTabIndex` 의 **세 조건 교집합**: 슬롯 컬럼 + `tab.input === undefined` + 라벨이 `BrowserTab.title` 의 접두사. 라벨과 title 은 **다른 문자열이다**(코어 `getName()`=30자 truncate vs `getTitle()`=`"<제목> (<주소>)"`). **후보가 2개 이상이면 아무것도 하지 않는다** — 라벨은 동점을 만든다(실측: example.com/.org 라벨이 둘 다 `"Example Domain"`). 이미 활성이면 무동작. `activeTextEditor` 가 없으면 bounce 를 생략한다(되돌릴 커서가 없으면 IME 위험 0). 전 과정 best-effort — 실패해도 도구 결과를 오류로 바꾸지 않는다. **매칭된 탭을 타깃으로 고정하는 것은 REQ-M30** — 판정만 넓히고 고정을 안 하면 후속 도구가 다른 탭에 붙는다. 승인 게이트는 **그대로**: 다른 주소로의 이동은 여전히 outward action → 모달, 스킵은 `resolveAlreadyOpen` 단일 소스. **범위 밖(별도 이슈):** SDK 런타임에는 `browser_navigate` 도구가 없는데 주입되는 규약(`_browser-control-contract.md`)은 그것을 설명한다 — 모델 쪽 정합은 여기서 다루지 않는다 | U (`test/browser-control-helpers` — 슬롯 대조군 + 8회 탐색 누적 회귀, `test/browser-mcp` — openPages 양성/음성) + 실기계(미검증: 탭/컬럼 실측) |
| REQ-M30 | 안 여는 것으로 끝나지 않는다 — 매칭된 탭을 운전 대상으로 고정 (#523) | REQ-M28 ②의 `alreadyOpen` 조기 반환은 `host.openBrowser` 를 부르지 않는데, `setTargetTab` 은 **탭을 열거나 재사용하는 경로에서만** 호출된다(`chatPanelProvider.ts` openBrowser/startLivePreview). 그래서 조기 반환 뒤에는 타깃이 **직전 슬롯에 그대로 남고**, `cdp()`→`currentTab()` 을 타는 `browser_read`/`click`/`type`(및 폴백 screenshot)이 **매칭된 페이지가 아닌 탭**에 붙는다 — 코치는 A 를 본다고 믿으며 B 를 읽는다. REQ-M29 ⑤(`openPages` 전체 비교)가 들어오기 전에는 매칭 = 타깃이라 무해했으므로, 이는 그 변경이 만든 회귀다. 계약: ① `BrowserMcpHost.focusOpenPage?(url)` — 호스트가 **판정과 같은 비교 함수**(`isSameBrowserUrl`)로 탭을 찾아 `setTargetTab` 하고 그 페이지를 돌려준다. 탭 핸들은 이 경계를 넘지 않는다(`browserMcp.ts` 는 vscode-free — 노드 단위 테스트 대상); ② 상태 줄도 **매칭된 탭**으로 적는다 — `current`(운전 중인 탭)를 그대로 쓰면 한 결과 안에서 "A 가 열려 있다 / 현재 페이지는 B" 로 갈라져 모델이 읽는 두 줄이 다른 페이지를 말한다; ③ optional + fail-safe — 미지원·못 찾음·throw 는 전부 예전 동작(타깃 유지)이고 **결과를 오류로 바꾸지 않는다**("이미 열려 있다"는 판정 자체는 유효하다). **범위 밖:** 그 탭을 참가자 화면에 **보이게** 하는 것 — proposed API 의 `BrowserTab` 에는 `close()`/`startCDPSession()` 뿐이고 `show()`/`reveal()` 이 없다. 유일한 우회로인 `openBrowserTab(url)` 재호출은 새 탭을 만들어 REQ-M29 를 되돌린다. fork 의 proposed API 확장이 필요한 별건 | U (`test/browser-mcp` — 양성: 백그라운드 슬롯 매칭 시 타깃 이동 + 상태 줄 일치 / 음성: 이미 타깃·미오픈 URL·능력 미지원·고정 실패) |
| REQ-M24 | native `claude` 바이너리 해석 순서 + 무결성 게이트 (#282 W4a, [docs/sdk-bundling.md](sdk-bundling.md)) | `resolveSdkBinary` (pure, 프로브 주입): ① `hypeproofChat.sdkBinaryPath` 설정 → ② `HPS_SDK_BINARY` env (e2e/CI) → ③ seeded 위치 (`seededSdkBinaryPath` 가 유일 정의 — darwin `~/Library/Application Support/HypeProof-Studio/sdk/<ver>/claude`; `scripts/seed-sdk-binary.sh` 가 설치) — seed 시 tarball sha512 를 핀 manifest(`sdkBinaryManifest.ts` = package-lock, smoke 로 drift 차단)에 대해 1회 검증 후 `.verified.json` 마커 기록, 런타임은 마커 + 정확 크기 일치 + min-floor 만 검사 (229 MB 를 매 턴 재해시하지 않음) → ④ node_modules (dev — `pathToClaudeCodeExecutable` 미전달, SDK 자체 lookup) → ⑤ 전부 실패 → `SdkUnavailableError` → proxy 폴백 (REQ-M7 그대로). 상위 후보의 부재/불신은 **fall-through** (stale 설정이 dev 경로를 막지 않음). 바이너리 존재는 도구 정책을 절대 확장하지 않음 — minor cohort 는 바이너리가 있어도 `tools: []`. **머신-스코프 하드닝(#342):** `sdkBinaryPath`·`coachRuntime`·`proxyUrl`·`requireApprovalFor` 는 `scope: "machine"` — 워크스페이스/폴더 `.vscode/settings.json` 로 실행 파일·게이트웨이·승인 게이트를 덮어쓸 수 없음(user/machine 설정만; `HPS_SDK_BINARY` env 는 그대로). 방어심층으로 `capabilities.untrustedWorkspaces` = `limited` + 위 4개를 `restrictedConfigurations` 로 선언. **win32 마커 인코딩 계약:** seeded 경로는 `%APPDATA%\HypeProof-Studio\sdk\<ver>\claude.exe` 이고 `scripts/seed-sdk-binary.ps1` 이 설치한다 — 이 스크립트는 벤치 머신의 Windows PowerShell 5.1 에서 도는데 `Out-File -Encoding utf8` 이 **항상 BOM(EF BB BF)** 을 붙이고, 런타임은 마커를 `fs.readFileSync(…, "utf8")` + `JSON.parse` 로 읽으므로 **BOM 하나로 파싱이 throw** → `isSeededBinaryTrusted` 가 "malformed marker" 로 거절 → 정상 시딩된 claude.exe 를 두고도 Windows 전 머신이 조용히 proxy-only 폴백(REQ-M7). 양쪽을 다 고정한다: 시더는 `[System.IO.File]::WriteAllText(…, UTF8Encoding($false))` 로 BOM 없이 쓰고, `parseSdkBinaryMarker` 는 선행 BOM 을 제거한 뒤 파싱한다(구버전 시더로 이미 시딩된 머신이 재시딩 없이 업데이트만으로 복구되도록) | U (`test/sdk-binary`, `test/manifest-security-scope`) |
| REQ-M27 | SDK 활동 로그 — 진행 표시는 지어내지 않는다 (#414) | 진행 표시가 **응답 텍스트 길이**로 단계를 지어내고 있었음(`buildStageText`, #161 — 프록시 경로에선 HTML 이 채팅으로 흘러 길이가 늘어 맞는 신호였다). SDK 경로는 코치가 도구로 파일을 쓰므로 텍스트가 안 늘어 영원히 첫 단계 — 실측(2026-07-24 prod) 286 s·4턴 동안 thinking → Write → Bash → Write 를 돌면서 화면엔 "🛠️ 웹사이트 만드는 중 — 구조 정리 중… ✨" 한 줄뿐. **원장이 뭘 하는지 못 보면 검증도 못 한다 (verification_reflex 정면 훼손).** 계약: ① `extractSdkActivity` (pure) 가 SDK 이벤트 하나에서 `thinking`·`tool_use`(id+name+input)·`tool_result`(id+isError)·`system/thinking_tokens` 를 뽑고, 나머지(텍스트 델타·init·`api_retry`·result)는 `[]`; ② `consumeSdkStream` 이 **텍스트보다 먼저** `onActivity` 로 흘림(말이 행동보다 앞서면 순서가 거꾸로 읽힘) — `onActivity` 는 optional 이라 미배선 시 동작 완전 동일, #320 fast-fail·REQ-M26 stall 워치독 **무회귀**(재시도 틱은 활동도 진행도 아님); ③ 호스트가 브라우저 루프의 기존 `toolLog` 프로토콜에 매핑 — 중립적인 한국어 응답 준비 상태(제자리 갱신) → 완료 시 접힌 상세에서 thinking 원문, `🔧 Write(index.html)` running → tool_result 로 done/⚠️. **한국어로 번역하지 않는다**: 도구 이름은 SDK 의 것, thinking 은 모델이 실제로 쓴 문장 — 의역은 원본보다 못한 신호다. Claude Code 처럼 행동당 한 줄, 길면 CSS 로 자름(`summarizeToolInput` 이 `file_path`→꼬리, `command`/`url`/`query`/`pattern` → 원문 60자, 미지 도구 → 압축 JSON); ④ 활동 로그가 화면에 있으면(`hasActivity`) 스피너는 지어낸 하위 단계를 버리고 중립 라벨만 — 진짜 신호가 있는데 추측이 그것과 모순되면 안 됨. 프록시 경로(활동 로그 없음)는 #161 길이 단계 그대로. **#503 정정**: ② 의 "텍스트보다 먼저"는 화면 순서에 영향이 없다 — 실측(2026-07-28, SDK 0.3.207) assistant 메시지 12/12 의 `message.content` 길이가 1이라 한 이벤트에서 `onActivity` 와 `onDelta` 가 둘 다 발화하지 않는다. 순서를 잃던 곳은 웹뷰 리듀서였고 REQ-C17 에서 고쳤다 | U (`test/sdk-activity`) |
| REQ-M30 | 능력 상실은 보여야 한다 — 무성 폴백 금지 (#476) | REQ-M7 의 폴백은 의도된 설계지만(#387 — 미시딩 머신에서도 수업이 죽지 않게), 그 사실이 **아무에게도 안 보였다**: `console.warn` 한 줄이 전부였고 확장에 `createOutputChannel` 이 한 군데도 없어 사고 당일 전 세션의 `exthost.log` 에서 `[coach]` 가 **0건**이었다. 그래서 학생은 코치가 왜 파일을 못 찾는지 모르고, 강사는 교실 절반이 능력 없는 코치로 도는 걸 모르고, 개발자는 사후에도 확인할 수 없고, **코치 자신도 몰랐다** — 마지막이 제일 비쌌다: 파일 도구가 0개인 코치가 "저장했어요"·"작업 폴더가 비어 있어요"·"파일로 저장해 주시겠어요?" 를 발화했고, 같은 원인이 이슈 3건(#470·#471·#472)으로 각각 다른 제품 결함으로 진단됐다. **무성 폴백의 비용은 능력 상실 자체보다 오진이다.** 계약: ① **코치** — 워커가 캐시 프리픽스 끝에 능력 정정 블록을 붙인다(`degradedRuntimeNoticeFor`, `_runtime-degraded-notice.md`). 게이트는 `runtime==='proxy'` ∧ `coach_runtime==='agent-sdk'` ∧ 비-미성년 ∧ `sdk_tools` 가 read/write/shell 중 하나 이상 부여. 런타임의 ground truth 는 **라우트**이므로(REQ-N8/#520) 워커가 클라이언트에 묻지 않고 판정하며, 프롬프트 소유자가 워커라 **앱 릴리스 없이 배포만으로 반영**된다. 블록은 **스킬 뒤**에 온다 — 176줄짜리 셸 절차 앞에 한 문단을 두면 뒤가 앞을 덮는다. 문구는 사고 보고가 아니라 **능력 설명**이다: 강사가 `coachRuntime` 을 프록시로 고정한 경우에도 참이어야 하므로 "SDK 를 못 찾았다"고 단정하지 않는다. 프롬프트 캐시 변형 수는 늘지 않는다(#520 이 이미 런타임별로 둘로 갈랐고 이 블록은 그 안에서만 다르다); ② **참가자** — 대화 타임라인에 한 줄(`COACH_DEGRADED_NOTICE`), **세션 1회**. 매 턴이면 두 번째부터 아무도 안 읽고 기록이 경고로 덮인다 — 능력 상실은 사건이 아니라 상태다. 문구는 안 되는 것(저장·명령·배포)과 **되는 것**(만들기·미리보기)을 같이 말하고 다음 행동(스태프 호출)을 준다; ③ **개발자** — 전용 출력 채널("HypeProof Coach")에 타임스탬프 + `SdkUnavailableError` **사유 원문**. 요약하면 "어느 해석 후보가 없었나"라는 정확히 필요한 정보가 사라진다; ④ 안내는 타임라인 리셋(REQ-C17 폴백 경로) **뒤**에 넣는다 — 앞에 넣으면 웹뷰에만 남고 히스토리에서 사라진다. **범위 밖(이슈에 잔여로 남김)**: 강사용 별도 신호(워커 trace → `/console` 교실 단위 표시)와 `saveGameToWorkspace` 의 무성 저장 가시화 | U (`worker/test/runtime-degraded-notice` · `test/coach-fallback-notice` — 양성/음성 대조군) |

---

| REQ-M36 | 수업 허용 모델 선택·전환 (#792) | 줄 번호: Service 는 `hypeproof/hypeproof-service` main `399109c`(#73 `bb0d1ef` 모델 카탈로그·5.5 요청 규칙·별칭 재지정, #74 `399109c` 홈페이지 하네스·세미나 가드), 앱은 v0.1.56. **카탈로그**: 검토된 Anthropic id 12개 — Sonnet 5.5/5/4.6/4.5, Opus 5.5/5/4.8/4.7/4.6/4.5, Haiku 5.5/4.5 — 와 OpenAI GPT-5.6 Luna/Terra/Sol·GPT-6 Luna/Sol·GPT-6.1 Sol·GPT-6 Astra(`profiles/types.ts:561-589`). 이전 id 는 명시 핀·확정 수업·측정 경로가 계속 부르므로 남긴다. **별칭 핀 (2026-10-14 소유자 결정 — 이전의 '기존 alias 핀은 유지한다' 를 대체)**: `hypeproof-fast`→`claude-haiku-5-5`, `hypeproof-default`→`claude-sonnet-5-5`, `hypeproof-strong`→`claude-opus-5-5`(`:550-554`); OpenAI 는 싼 것 먼저 — fast·default→`gpt-6-luna`, strong→`gpt-6.1-sol`(`:663-667`), `gpt-6-astra` 는 별칭 대상이 아니다. 바뀌기 전 map(`ANTHROPIC_ALIASES_UNTIL_2026_10_14` = Haiku 4.5·Sonnet 4.6·Opus 4.7, GPT-5.6 Luna×3)은 `SUPERSEDED_ALIAS_MAPS` 에 남긴다(`:691-699`). **적용 범위**: 별칭을 쓰는 모든 코호트가 함께 옮겨 간다 — SK 아동 3-4·5-6, 디렉터 copyclone(세미나), 티저, canary, 이용권·체험(`studio-native-trial`)과 synthetic 의 기본값(프로필별 서빙 표 `worker/test/model-catalog.test.mjs:126-140`). **아동 수업은 검증 실행이 통과한 뒤에만 옮긴다**: 아동 프로필은 별칭만 쓰므로(`kids-workshop-s1.ts:18-21`, `kids-2026-grade-5-6-s1.ts:27-30`) 코드에는 아동만 붙잡는 핀이 없고 이 조건은 운영 반영 게이트가 지킨다 — 0% 버전의 닫힌 아동 검증 세션에서 생물·의학 질문 5/5 가 거절 없이 답했다(hypeproof/hypeproof-service#73 본문). 홈페이지 연습은 명시 id 로 Sonnet 5.5(기본)·Opus 5.5·Haiku 5.5 를 열고 수업 effort 기본 medium 을 둔다(`homepage-practice-s1.ts:14-25`). 이용권은 자기 model 블록을 명시해(`studio-native-trial.ts:22-27`) 9개를 서빙하며 **Opus 5.5 를 계속 고를 수 있다**: Sonnet 5.5(기본)·Haiku 5.5·Sonnet 5·Sonnet 4.5·Opus 5.5·Opus 5·Opus 4.8·Opus 4.6·Opus 4.5 — 별칭으로만 닿던 Sonnet 4.6·Haiku 4.5·Opus 4.7 은 같은 id 로 접혀 메뉴에서 빠진다. 확장 목록은 이용권·synthetic, 홈페이지 연습, GPT 실습, 모델 비교 실습(MU-01)만 갖고 나머지는 default/fallback 쌍이다. **측정 경로는 옮기지 않는다**: 관찰 평가와 수업 리포트 평가기는 별칭을 재지정 전 map(`MEASUREMENT_ALIAS_MAP`)으로 풀어 재지정 전 모델에 머물고 평가 revision·rubric 은 그대로다(`lib/measurement-models.ts:1-20`, `routes/observations.ts:123`, `routes/classroom-reports.ts:59`). **확정 수업**: 강사는 코호트 허용 부분집합과 기본값을 버전으로 고정한다. Service 가 공급자·실행기·모델 ID 를 확정 때 binding 에 보존하고(`routes/authoring.ts:194`) 읽을 때마다 대조한다. 기록된 이전 map 으로 확정된 수업은 **확정 당시 모델로 계속 서빙**되고(AE-33; `lib/lesson-model-policy.ts:73-97`, `lib/chat-gate.ts:332`) 새 핀은 강사가 새 버전을 확정할 때만 붙는다(재확정 절차: [ADR-0006](adr/0006-lesson-model-policy.md#alias-remap--2026-10-14)). 기록되지 않은 map 변경은 여전히 `lesson_unavailable` 로 닫는다. 운영 D1 의 확정 버전 2개는 model 블록이 없어 이번에 바뀌는 확정 수업은 없다(#73 본문). 학생 입력창의 선택은 다음 요청부터 적용하며 입력·대화·파일을 보존한다. 새 수업 정책은 SDK fast 요청도 같은 집합으로 제한한다(`routes/messages.ts:170`, `:177`). 이름/모델 변경으로 도구 권한 확대 없음. 명시적 선택/고정 수업에서 SDK 부재 시 다른 실행기로 조용히 전환하지 않는다. 구형 수업의 기존 fallback은 유지. 답변마다 모델 배지는 필수 아님. **요청별 모델 라우터는 없다**(설치 앱 v0.1.56) — 도입하려면 새 ADR 이 먼저다(2026-10-14 결정). **능력 근거**: 5.5 세 행(`lib/model-caps.ts:155-205`, 행마다 `verifiedBy`)은 공식 문서로 작성했고 **macOS 에서 0% 버전 rc1 `e4483c9b`·rc2 `987383f4` 로 검증했다** — 설치 엔진(Claude Code 2.1.207, Agent SDK 0.3.207 `sdkBinaryManifest.ts:29`)이 Sonnet·Opus·Haiku 5.5 에서 파일 쓰기 실행을 끝냈고 API 프로브 16/16 이 통과했다(#73 본문). **Windows 는 아직 검증하지 않았다.** 게이트웨이 규칙 — thinking `disabled` 는 Opus 5.5 에서 제거·Sonnet 5.5 에서 `between_tools`(`:365-382`), 강제 `tool_choice` 는 Opus·Sonnet 5.5 에서 `auto`(`:384-395`), sampling 제거, 정책 없는 코호트의 effort `high` 상한(REQ-M40), 보조 호출의 thinking off(REQ-M11), proxy 경로의 thinking off·keep-alive·거절 안내(REQ-M42), 성인 코호트의 thinking 요약 표시와 `drop_block`(REQ-M10) — 의 조합은 [AE-28 행렬](requirements/learning-agent-experience.md#claude-55-능력-행렬-ae-28-2026-10-14)에 있다. **보조 호출 비용**: 잠기지 않은 프로필의 `claude-*haiku*` 보조 요청은 Haiku 5.5 로 가며 thinking off·effort low 로 보낸다(REQ-M11) — 토큰 단가는 100K 토큰 이하 프롬프트에서 약 90% 내리고 100K 초과 프롬프트는 5배 요율이다. v0.1.56 CLI 가 보조 호출을 haiku id 로 보내는지 주 모델로 보내는지는 미검증. **GPT**: #828 의 별도 성인 GPT 실습은 기본 `gpt-6-luna`, 선택 GPT-6.1 Sol·GPT-5.6 Luna/Terra/Sol 을 기존 선택 UI 와 OpenAI proxy 로 연결한다(`studio-gpt-practice.ts:26-27`). GPT 모델을 Anthropic SDK 로 보내면 409 로 거부한다(`routes/messages.ts:365-369`). 로컬 Codex 구독 연결은 개발 검증용이며 공개 API 인증이나 SDK 도구 동등성을 뜻하지 않는다. **상태**: 이 Studio PR 이 배포 고정 Service 를 4.x 핀의 `43dd009` 에서 `399109c` 로 옮긴다(`.github/workflows/deploy-worker.yml:93`). 반영 전 확인 — 아동 검증 5/5·macOS 0% 검증은 통과, Windows 는 미실행, 계량 좌석과 model 블록 확정 수업은 운영에 없다(#73 본문) | U (`model-selection.smoke`), Service (`lesson-model-policy.test`, `model-catalog.test`, `model-request-shape.test`, `measurement-models.test` — main `399109c`), [native/Chalk 인수](testing/lesson-model-selection.md), [GPT 페르소나](testing/studio-personas-gpt.md) |
| REQ-M40 | 수업별 처리 수준 선택 (#799) | App·Chalk의 제어 이름은 `Effort`, 선택/기록 값은 `Low / Medium / High`로 표기하며 전송값 `low / medium / high`와 일대일 대응한다. 코호트가 명시적으로 허용한 low/medium/high만 강사가 기본값과 부분집합으로 고정한다. 학생은 지원 모델에서만 선택하며 실행 중 변경은 다음 턴부터, 모델 변경은 수업 기본값으로 재평가한다. 기존 대화·입력·파일은 보존한다. Service가 SDK/proxy 요청을 정규화하고 상한 우회는 거부한다. 헤더 없는 이전 앱은 수업 기본값을 사용한다. 설정 상세는 서버가 기록한 요청·전송값·이유를 표시하며 조회 실패/빈 기록은 미확인이다. metadata-only 기록은 동일 D1의 수업·학생·턴 범위로 격리한다. 기존 opt-in 없는 수업은 동작을 유지한다. **2026-10-14 메모 (5.5)**: 5.5 세 모델의 effort 지원은 `MODEL_CAPS` 행에서 파생된다(low–max; Service main `399109c` `lib/model-caps.ts:155-205`). 수업 Effort 는 여전히 `low/medium/high` 만이다(`COURSE_EFFORT`, `lib/model-effort.ts:5`, `:25-29`) — `xhigh`·`max` 는 고를 수 없게 숨긴다. effort 정책이 없는 성인 코호트(디렉터·티저·canary)는 5.5 핀에서 effort `high` 상한을 받는다: Claude Code 2.1.207 이 보내는 `xhigh`(Sonnet 4.6 에서는 `high` 로 내려갔다)와 `max` 가 `high` 로 내려가고 `#406 lowered` 로 기록된다(`unpolicedEffortCeiling`, `lib/model-caps.ts:57-65`, `:407-420`; `lib/model-effort.ts:36-43`; `routes/messages.ts:613-614`). 그래서 5.5 핀에서는 어느 코호트도 `xhigh`·`max` 에 닿지 않는다 — 올리려면 소유자 결정이다. 홈페이지 연습은 이용권과 같은 수업 정책(기본 medium)을 갖는다(`profiles/homepage-practice-s1.ts:16-25`). v0.1.56 은 effort 헤더를 보내지 않으므로 이용권·홈페이지 연습 좌석의 모든 요청(보조 호출 포함)이 medium 이다. 미성년은 medium 강제(`routes/messages.ts:525-542`). proxy 경로의 thinking off 는 REQ-M42 | U/Service (`model-selection.smoke`, `lesson-effort-policy.test`), [Chalk/native 검증](testing/lesson-effort.md) |
| REQ-M41 | 요청한 모델과 **답한 모델이 다르면 말한다** — 조용한 대체는 성공과 같은 화면이 아니다 (#897 H-05/H-13) | 2026-09-11 Codex 관측: 같은 요청 `gpt-5.6-luna` 에 (A) 같은 모델 에코와 (B) `claude-sonnet-4-6` 에코를 합성 SSE 로 주입했더니 **화면 전체 innerText 가 완전히 같았다.** 선택기는 둘 다 GPT 를 유지했고 변경 안내도 불일치 표시도 없었다. 값이 안 온 것이 아니다 — `usage.model` 은 갈렸고 `x-hps-model` 헤더도 왔지만, 확장에서 그 값을 읽는 코드가 한 줄도 없었다(`proxyUsageRecorder` 가 spool 로 넘기고 끝). 계약: (1) 판정은 순수 모듈 하나(`modelEchoHelpers.ts`)가 소유하고 네 갈래로 **구분**한다 — `match` · `unobserved` · `server_resolved` · `substituted`; (2) **명시 선택과 서버 해석을 가른다.** 학생이 직접 고른 모델이 바뀐 것만 안내하고, 수업 기본값과 구형 alias 가 서버에서 구체 모델로 풀리는 것은 정상 경로라 조용하다 — 후자까지 경고하면 정상 동작이 매 턴 경고를 내고 진짜 대체가 그 소음에 묻힌다(승인 피로와 같은 병); (3) **날짜 접미만 다른 에코는 대체가 아니다.** 공급자는 `gpt-5.6` 을 물어도 `gpt-5.6-20260901` 을 에코한다. 이걸 불일치로 세면 정상 응답마다 거짓 경고가 뜬다. 다만 접두가 같다는 이유로 `gpt-5.6-turbo` 를 같은 모델로 접지도 않는다(음성 대조군); (4) **에코가 없으면 판정하지 않는다** — `unobserved` 는 일치도 불일치도 아니다. 측정하지 못한 것을 사실로 적지 않는다(REQ-R1 (3) 과 같은 규칙); (5) 응답 모델이 허용 목록 밖이면 그 공급자를 **모르는 것**이므로 '공급자가 바뀌었다' 고 적지 않는다. 목록 안이고 공급자가 실제로 다를 때만 그렇게 말한다; (6) 안내는 한 턴에 **하나만** 쌓는다 — 브라우저 루프처럼 한 턴에 요청이 여러 번 나가는 경로에서 같은 문장이 반복되지 않도록 턴 id 로 막는다(REQ-M39 (4) 와 같은 형태); (7) 문구는 **자동 실행을 약속하지 않는다** — 다시 보내지도, 모델을 되돌리지도 않는다. 무슨 일이 있었는지 말하고 다음 행동(이어가기 / 다시 고르기 / 선생님께 알리기)을 준다. 공급자 변경을 승인 없이 자동 실행하는 정책은 이 행이 추가하지 않는다; (8) 배선을 소스로 잠근다 — 판정만 재고 화면으로 보내지 않는 구현이 통과하지 않도록, 전송 경로가 출처·선택지·`onDelta` 를 실제로 넘기는지 테스트가 확인한다(REQ-R2 (2) 와 같은 이유). **이 행이 주장하지 않는 것**: 서버가 실제 운영에서 모델을 바꾼다는 주장 아님 — 지금까지의 관측은 합성 SSE 주입이고 정상 UI 는 허용 목록만 노출하며 `selectModel` 호스트 처리도 choices 를 재확인한다. SDK 경로 아님(관측은 proxy 경로). 브라우저 루프 경로는 아직 이 문맥을 넘기지 않는다 — 한 턴 다중 요청이라 문맥을 실어 주면 그때부터 같은 판정이 돈다. 실기·강사 화면·운영 좌석 인수 아님(전부 NOT RUN) 그리고 (7) **추론보다 서버 판정이 앞선다** — 워커가 `x-hps-model-substituted` 를 실으면(REQ-M42) 그 값을 쓴다. 문자열 비교만으로는 alias 번역과 '요청이 버려진 것' 이 구별되지 않아서 (2) 가 허용 목록 밖 요청에 **침묵**을 골라야 했고, 그 대가로 진짜 버려진 요청도 조용했다. 헤더 부재는 단정이 아니므로(워커는 치환일 때만 싣는다) 없으면 전과 같이 추론한다. 학생 화면 문구는 여전히 명시 선택에만 붙고, 학생이 고르지 않은 경로의 서버 판정은 기록에만 남는다. **2026-10-14 메모 (별칭 재지정의 분류)**: 재지정은 **서버 해석**이지 대체가 아니다. `/v1/profile` 의 `model_selection` 이 같은 별칭을 새 id 로 내려 주고 판정은 고른 선택지의 `id` 와 에코를 비교하므로(`modelEchoHelpers.ts:130-160`) 학생이 고른 별칭이 Sonnet 5.5 로 답하면 `match`, 고르지 않은 기본값은 `server_resolved`(조용함)다. 이전 map 으로 확정된 수업은 확정 id 로 서빙되고 그 id 를 에코한다. **v0.1.56 에는 이 판정 코드가 없다**(#989·#993, 2026-09-11 — v0.1.56 태그 이후) — 설치 좌석에서는 재지정이 어느 쪽으로도 화면에 나오지 않는다. 다음 빌드에서 앱이 재지정 전에 받은 `model_selection` 을 들고 있는 동안 명시 선택 턴이 새 id 로 답하면 `substituted` 로 보일 수 있다(코드에서 유도, 미관측). v0.1.56 은 저장된 선택의 범위에 `model_selection` 전체를 넣으므로(`modelSelection.ts:7-9`, `:19-22`) 재지정 뒤 예전 선택은 버려지고 `hypeproofChat.model` 설정값(기본 `hypeproof-default`)이나 서빙 기본값으로 돌아간다 — 입력창 선택기에는 보이지만 따로 안내하지 않는다. 요청별 라우터는 이 행의 침묵 규칙을 빌릴 수 없다: 명시 선택에서 벗어나는 라우팅은 알려야 하며 새 ADR 이 먼저다 | U (`test/model-echo.smoke.mjs`) |
| REQ-M37 | 코치 세션은 학생·수업 단위다 — 공용 PC 에서 섞이지 않는다 (#749) | 벤더 CLI 는 매 턴의 전체 기록을 파일로 남기고(`persistSession` 기본값 on, 우리는 설정하지 않는다) 그 파일을 `cwd` 에서 파생된 슬러그 아래에 둔다. `cwd` 는 **코호트** 작업 폴더라 그 PC 에 앉는 모든 학생이 같은 값이다 — 한 학생의 기록이 다음 학생의 기록 옆에 쌓이고, 제품의 어떤 삭제 경로도 거기 닿지 않는다("대화 지우기" 는 workspaceState 만 비운다). 2026-09-08 개발 머신 실측: 프로젝트 디렉터리 65개 · 약 10 MB · 워크숍 작업 폴더 하나에 기록 파일 15개. 계약: ① `sdkConfigDirFor` 가 **좌석**(프로필 · 고정된 수업 version · workshop 토큰의 sha256 앞 12자) 을 경로 마지막 구간으로 받는다 — 토큰 자체는 디스크에 쓰지 않는다(native-trial 좌석의 `nativeHistoryScope` 와 같은 처리). 좌석 인자를 생략하면 #749 이전 경로와 **바이트 동일** — 누락된 호출자는 새 위치에 조용히 쓰는 대신 옛 디렉터리를 그대로 쓴다; ② 좌석 문자열은 항상 한 개의 경로 구간이다 — 허용 문자 allowlist, `.` · `..` 로 축약되지 않음, 빈 값이면 `profile~nolesson~anon`; ③ 한 좌석에 코치 턴은 동시에 하나만 돈다 — **두 런타임 모두.** 웹뷰의 Send 비활성화는 UI 상태일 뿐 게이트가 아니다 — 호스트의 `activeStreams` 는 스트림별 Map 이고 send 경로는 `hasActiveStream()` 을 보지 않는다(그건 수업 변경과 대화 지우기만 막는다). 두 번째 턴은 `CoachConcurrentRunError` 로 거절한다. **`SdkUnavailableError` 가 아니다** — 그 클래스는 "proxy 로 폴백" 을 뜻하고, 그러면 막으려던 중복 턴이 다른 런타임에서 실행된다. 잠금은 런타임 분기 **바깥**, 호스트의 턴 전체에 걸린다 (`withCoachSeatLock`). **2026-09-08 정정**: 처음엔 `runSdkCoach` 안에서 잠갔고, 그래서 이 조항이 코드보다 넓었다 — proxy 코호트 전체가 무방비였고, SDK 가 `SdkUnavailableError` 로 떨어질 때 잠금이 먼저 풀린 뒤 폴백이 돌아 **막으려던 그 중복 턴이 proxy 에서 실행**됐다. 잠금이 한 경로만 덮지 않는지를 테스트가 소스 위치로 확인한다; ④ 좌석 해제는 `finally` — 중단(abort)이나 실행 중 예외가 그 학생을 세션 내내 묶어두면 안 된다. **이 행이 다루지 않는 것**: `persistSession` 자체. 끄는 쪽이 자연스러운 질문이지만 벤더 CLI 가 그 상태에서 어떻게 동작하는지 실측한 바 없어 계약으로 적지 않는다 | U (`test/sdk-seat-session.smoke.mjs`) |

| REQ-M38 | 확정 수업은 좌석의 기능을 **좁힐 수만** 있다 (#748) | 수업이 `features: { allowed }` 를 실으면 그 좌석의 기능이 줄어든다. 늘어나지 않는다 — 모든 필드가 프로필 자신의 grant 와 `&&` 이고 `||` 인 곳이 없다. 카탈로그는 컴파일된 프로필에서 **파생**한다(`permittedFeatureKeys`) — 따로 관리하는 두 번째 목록이 아니다. 키는 여섯 개: `read` · `write` · `shell` · `subagents` · `browser` · `web_search`. `browser` 하나가 런타임 두 철자(`sdk_tools.browser` · `browser_control.enabled`)를 **모두** 덮는다 — 강사가 브라우저를 끄려고 자기 반이 어느 경로로 도는지 알아야 할 이유가 없다. 계약: ① 좁히기는 **투영**이지 새 키가 아니다 — 기존 `sdk_tools.*` · `tools.web_search` · `browser_control.enabled` 로 내려가므로 앱 업데이트도 능력 협상도 필요 없다; ② 적용 지점이 **둘**이다. `/v1/profile` 은 일반 수업 좌석에 `gateChatRequest` 를 돌리지 않고, 돌더라도 게이트가 다시 쓴 프로필을 버린다. 게이트에만 넣으면 게이트 테스트를 전부 통과하면서 **모든 SDK 좌석에서 무력**하게 나간다 — 이 레포에 이미 같은 결함 기록이 있다(프로필은 `shell: true` 인데 API 가 네 키만 서빙, 배포 후 프로덕션 질의로 발견); ③ 고정 시 Service 가 `binding` 을 만들고 **읽을 때마다** 다시 유도해 비교한다. 고정 뒤 프로필 grant 가 줄면 넓은 집합을 계속 서빙하지 않고 수업을 닫는다(#795 의 모델 binding 과 같은 형태); ④ binding 은 **어디서 집행되는지**를 기록한다 — `removed_enforced` 는 Service 가 직접 떼는 키, `removed_client_only` 는 클라이언트가 `/v1/profile` 을 지켜야 성립하는 키. **집행 강도는 경로마다 다르고 그대로 적는다**: proxy 경로는 워커가 업스트림 tool 배열을 직접 만들므로 `web_search` · `browser` 좁히기가 공급자 요청에서 실제로 사라진다(진짜 경계). agent-sdk 경로는 라우트가 클라이언트 body 를 펼치고 `tools` 를 건드리지 않으므로 **정상 클라이언트에는 유효하지만 조작된 클라이언트에 대한 Service 경계가 아니다.** 이 경로에서 서버는 도구를 **실행하지 않는다**(라우트 주석: "tools are DEFINED here but EXECUTED client-side"). 따라서 업스트림 `tools` 를 걸러도 AE-09 는 닫히지 않는다 — 조작된 클라이언트는 서버에 묻지 않고 로컬에서 실행한다. ADR-0007 이 원래 그 필터를 닫는 수로 적었다가 2026-09-08 에 정정했다. agent-sdk 좌석에서 Service 가 집행하는 것은 넷뿐이다: 신뢰 게이트 · system prompt 교체 · 모델 clamp · max_tokens/effort 정규화. 도구·이미지 정책은 **클라이언트 무결성** 속성이고, Service 집행이 필요한 코호트의 유일한 선택지는 오늘 proxy 경로다. **AE-09 는 이 경로에서 UNMET 으로 확정한다.** 오늘의 passthrough 를 그대로 단언하는 **음성 대조군**을 상시 테스트로 둔다 — 닫히기를 기다리는 것이 아니라 이 경로가 조용히 바뀌는 것을 막기 위해서다. 이 라우트가 언젠가 `tools` 를 건드리기 시작하면 그 테스트가 먼저 깨지고, 그때 이 행이 무엇을 주장할 수 있는지 다시 판정한다 | Service (`worker/test/lesson-feature-policy.test.mjs`), [ADR-0007](adr/0007-lesson-feature-binding.md) |

| REQ-M39 | 코치 턴은 조용히 끝나지 않는다 — 모든 종료 오류에 안내가 붙는다 (#749) | 벤더 SDK 는 `{type:"result"}` 를 **네 가지** 오류 subtype 으로 낸다(`sdk.d.ts` 의 `SDKResultError`): `error_during_execution` · `error_max_turns` · `error_max_budget_usd` · `error_max_structured_output_retries`. `consumeSdkStream` 은 **`error_max_turns` 하나만** 처리하고 있었고 나머지 셋은 delta 도 안내도 없이 떨어졌다 — 학생 화면에는 **그냥 멈춘 턴**이 남는다. REQ-M27·M30 과 같은 계열의 실패다(일어난 일이 아무에게도 안 보임). 계약: ① 판정은 `sdkResultNotice` 한 곳이 소유한다 — subtype 별 전용 문구가 있고 사유마다 **문구가 다르다**(넷이 같은 줄이면 무슨 일이 있었는지 알 수 없다); ② **열거로 끝내지 않는다.** 모르는 subtype 은 폴백 안내로 떨어진다 — SDK 가 다섯 번째를 추가해도 침묵이 다시 생기지 않는다. 이름 규칙이 바뀌어도 `is_error` 가 받는다; ③ 문구 규칙은 REQ-M15 와 같다 — **원인을 단정하지 않고**(폴백은 특히), 고장이 아니라 무슨 일이 있었는지를 말하고, 한 일이 파일로 남아 있다는 사실을 알려 주고, 다음 행동을 하나 준다. SDK 영어 원문은 절대 그대로 나가지 않는다; ④ **음성 대조군**: 정상 종료(`success`)에는 아무 줄도 붙지 않는다 — 이게 없으면 '모든 턴 끝에 오류를 붙이는' 구현이 나머지를 다 통과한다; ⑤ 드리프트 락: 테스트가 **설치된 벤더 `sdk.d.ts` 를 직접 읽어** 선언된 모든 subtype 이 안내를 만드는지 확인한다. 우리가 기억하는 목록이 아니라 배포되는 물건을 대조한다 — 벤더 트리가 없는 체크아웃에서는 선언 대조만 건너뛰고 동작 단언은 그대로 돈다; ⑥ **길이 제한으로 잘린 턴도 알린다 (#749).** 이 레포의 **1번 이슈**가 그것이었다 — max_tokens 로 끊긴 응답이 태그 중간에서 잘린 채 "완성본"으로 학생에게 갔다. proxy 경로는 그때 워커의 `TRUNCATION_NOTICE` 로 고쳐졌지만 **agent-sdk 경로는 열린 채였다**: `/v1/messages` 는 SSE 를 그대로 통과시켜 워커가 아무것도 끼워 넣지 않고, 클라이언트도 `stop_reason` 을 보지 않았다. 지금 아동 코호트 둘이 그 런타임에 있다. 계약: `stop_reason === "max_tokens"` 이면 **성공 result 여도** 안내를 낸다(오류 subtype 만 보면 이 경우를 통째로 놓친다). 잘림과 종료 오류가 겹치면 **잘림을 먼저** 낸다 — 학생에게 더 급한 사실은 왜 끝났는지가 아니라 산출물이 미완성이라는 것이고, 모르면 깨진 파일을 완성본으로 제출한다. 안내는 하나만 쌓는다. 문구는 워커와 **같은 사실 문장**을 쓰고 다음 행동만 런타임에 맞게 바꾼다(같은 사건에 경로마다 다른 말을 들으면 다른 사고로 읽힌다) — 공유 문장은 스모크가 워커 소스와 대조해 드리프트를 막는다 | U (`test/sdk-result-drift.smoke.mjs`) |


| REQ-M42 | 요청한 모델을 못 지켰으면 **말한다** — 조용한 치환 금지 (#897 H-05) | 일반 좌석의 `/v1/chat/completions` 은 코호트가 허용하지 않은 `model` 요청을 프로필 기본값으로 바꿔서 응답한다. 정책 집행 자체는 유지한다 — 클라이언트가 수업 모델을 벗어나면 안 되고, 일반 좌석에는 고르는 화면이 없으므로 400 으로 바꾸면 오타 하나가 아이 화면의 턴 실패가 된다. 고쳐야 할 것은 **그게 선에 흔적을 남기지 않는다**는 것이었다: alias→모델 id 번역에서도 요청 문자열과 응답 모델이 다르므로 `x-hps-model` 만으로는 "정상 번역" 과 "요청 무시" 가 구별되지 않았다(Codex H-05 부분 관측: "요청/응답 모델 불일치 시 기본 채팅 표시가 같음"). 계약: ① 치환이 일어나면 응답에 `x-hps-model-substituted: 1` 이 붙고, 헤더로 안전한 경우 `x-hps-model-requested` 에 요청 값이 실린다 — 비스트리밍·스트리밍 **양쪽**(한쪽만 실으면 "스트림이면 조용하다" 는 새 구멍이 된다); ② **서빙 모델은 바뀌지 않는다** — 이 행은 판정과 공지만 정의한다; ③ 거짓 경보를 내지 않는다 — 허용된 alias 의 정상 번역(요청 `hypeproof-fast` → 응답 `gpt-5.6-luna`)과 **같은 모델이 나가는 구체 id** 요청은 치환이 아니다; ④ 모델 문자열은 클라이언트가 주므로 헤더에 되돌려 싣기 전에 실제 모델 id 문자만 허용한다(64자). 걸러진 경우 **치환 사실은 알리고 이름만 생략한다** — 실측: 걸러내지 않으면 플랫폼 `Headers` 가 throw 해서 턴이 500 으로 죽고(주입 헤더는 나가지 않는다) 원인이 화면에 드러나지 않는다; ⑤ **비교 좌석은 계약이 다르고 그게 의도다** — 학생이 직접 고르는 `studio-model-practice` 는 비허용 모델을 400 `model_not_allowed` 로 거부한다(고르는 화면이 있으면 조용히 바꾸면 안 된다). 두 계약을 같게 만들지 않는 것이 결정이고 테스트가 그 비대칭을 잠근다; ⑥ **이 신호를 화면으로 바꾸는 것은 REQ-M41 이다** — 서버가 판정을 말하고 클라이언트가 보여준다. 두 행은 한 계약의 두 쪽이며, 클라이언트는 헤더가 있을 때 그것을 쓰고 없을 때만 문자열 비교로 추론한다(부재는 '치환 아님' 이 아니다 — 워커는 치환일 때만 싣는다); ⑦ `/v1/messages` 의 clamp(REQ-M11)는 이 행에서 바뀌지 않는다 — 그 경로는 `hypeproof-fast` 를 항상 더하는 별개 계약이고, 같은 공지를 붙일지는 SDK 경로 실기 관측 뒤에 정한다. **2026-10-14 메모**: OpenAI map 분리(fast·default `gpt-6-luna`, strong `gpt-6.1-sol`; Service main `399109c` `profiles/types.ts:663-667`) 뒤에도 ③의 정상 번역은 치환이 아니다 — 예시는 이제 `hypeproof-fast` → `gpt-6-luna` 다. 별칭 재지정 자체는 `x-hps-model-substituted` 를 만들지 않는다. 이 경로에는 이제 5.5 핀에서 up-front thinking off(Sonnet `between_tools`, Haiku `disabled`, 끌 수 없는 Opus 는 effort low; 미성년은 MINOR_EFFORT, 수업 정책이 있으면 그것이 이긴다)와 모델 게이트 매개변수 정리가 모든 코호트에 적용되고(`routes/chat.ts:922-935`; `lib/model-caps.ts:430-459`), 업스트림이 생각하는 동안 SSE `: keep-alive` 주석을 보내며(`lib/sse.ts:53-75`, `:134`, `:239` — 클라이언트는 `data:` 줄만 읽으므로 화면은 같다), `stop_reason: "refusal"` 이면 한국어 안내를 붙인다(`REFUSAL_NOTICE`, `lib/sse.ts:154`, `:523-525`; 비스트리밍 `routes/chat.ts:1089-1093`). 모두 서빙 모델을 바꾸지 않으므로 치환이 아니며 Worker 로그에만 남는다. ⑦은 그대로다 — `/v1/messages` 의 haiku 보조 clamp 는 Haiku 5.5 로 가고 공지 헤더가 없다. 끝이 prefill 인 보조 호출을 Haiku 4.5 로 보내는 것은 서버가 모델을 바꾸는 경우지만 학생이 고른 요청이 아니므로 `#406` 로그에만 남는다(REQ-M11). | Service (`worker/test/model-substitution.test.mjs` — 순수 판정 + 라우트 헤더, 제품 변이 7종 7/7 포착) |
| REQ-M43 | 참가자가 보낸 이미지는 **두 경로 모두** 워커에서 멈춘다 (#811) | proxy 경로는 copyclone 작업 이후 `filterMessages(body, profile.input?.image_paste === true, …)` 로 참가자 이미지를 떨궈 왔지만 **agent-sdk 경로에는 이미지 처리가 한 줄도 없었다** — `routes/messages.ts` 에 `image` 라는 문자열이 0건이었다. 이것을 덮고 있다고 믿었던 전제가 틀렸다: 2026-08-11 결정으로 "미성년은 무조건 proxy" 가 "프로필이 명시하지 않으면 proxy" 로 바뀌었고, 등록된 아동 코호트 **둘 다** `coach_runtime: "agent-sdk"` 를 명시한다. 즉 아이들이 필터 없는 쪽에 있었고, 둘 다 `input.image_paste` 를 두지 않는다(기본 false). 계약: ① **판별자는 역할이 아니라 구조다.** Anthropic 스키마에서 도구 결과는 `user` 역할 메시지 안의 `tool_result` 블록으로 돌아오므로 "user 역할이면 거른다" 는 브라우저 스크린샷 루프를 끊는다. 메시지 content 배열의 **최상위** `image` 블록만 참가자 것으로 보고 거르며, `tool_result.content` 안의 `image` 는 코치 자신의 산출물이라 `image_paste` 와 무관하게 **절대 떨구지 않는다**(proxy 필터의 `allowToolBlocks` 와 같은 분기); ② **개수·크기 상한은 정책이 아니라 비용·남용 경계**라 두 쪽 모두에 걸고 성인 코호트도 예외가 아니다 — 값은 proxy 와 같다(턴당 4장, 소스 6,500,000자). 실제 스크린샷은 그 한참 아래이고 넘는 것은 공급자도 받지 않는다; ③ **조용하지 않다.** 이 작업이 미뤄져 있던 이유가 "잘못 넣으면 스크린샷 루프가 **조용히** 끊긴다" 였으므로, 제거된 것은 전부 요청 로그와 응답 헤더 `x-hps-images-filtered` 로 나온다(`user_dropped` · `user_capped` · `tool_result_capped`). 회귀는 코치가 화면을 못 보게 되는 것이 아니라 `tool_result_capped` 라는 이름으로 먼저 보인다; ④ **모르는 모양은 거르지 않는다** — `scrubToolResultSecrets` 와 같은 전역·순수 규칙이라 공급자 스키마가 바뀌면 "필터 없음"으로 퇴화하지 반 시간에 500 으로 죽지 않는다. ⑤ **노출 조건은 이슈 본문의 설명과 다르고, 실측이 더 강하다.** 이슈는 "웹뷰가 붙여넣기 UI를 막으므로 정상 클라이언트 노출 없음" 이라고 적었다. 2026-09-21 실기 관측: **붙여넣기를 허용한(`image_paste:true`) 코호트에서조차** agent-sdk 경로는 이미지를 inline `image` 블록으로 싣지 않는다 — 확장이 워크스페이스에 파일로 저장하고 `<pasted-images>` 블록에 **경로만 텍스트로** 넘긴다(`assets/pasted-*.png`). 같은 붙여넣기가 proxy 경로에서는 329,916자 base64 `image` 블록으로 갔다. 따라서 `user_dropped` 분기는 **정상 클라이언트로는 도달 자체가 불가능**하고, 이 규칙이 지키는 것은 조작되거나 앞으로 바뀔 클라이언트다; ⑥ **`tool_result.content` 는 배열이 아니라 문자열일 수 있다** — 같은 관측에서 스크린샷 도구가 `is_error` 와 함께 평범한 문자열을 돌려줬다. 구현은 `Array.isArray` 가 아닌 content 를 손대지 않고 통과시킨다. **이 행이 주장하지 않는 것**: REQ-M38 의 판정은 그대로다 — agent-sdk 경로에서 도구는 여전히 클라이언트가 실행하고, 이 필터도 조작된 클라이언트에 대한 Service 경계가 아니다. 다만 이미지는 도구와 달리 워커가 업스트림 body 를 실제로 통과시키는 대상이라 여기서 거르면 공급자에게 **실제로 가지 않는다**. **성공한** 스크린샷 안의 image 블록 모양은 여전히 미관측이다(#811 1단계 절반) — 진짜 클라이언트가 `mcp__hypeproof__browser_screenshot` 을 실행해 `tool_result` 를 돌려보내는 왕복은 성립했으나 열린 탭이 없어 오류였다. 그래서 그 안은 상한만 걸고 아무것도 떨구지 않으며, 만약 스크린샷이 최상위 `image` 로 오는 런타임이 있다면 그 사실은 `user_dropped` 로 **드러난다** | Service (`worker/test/inbound-images.test.mjs` — 순수 판정·상한·전역성, `worker/test/messages-integration.test.mjs` — 상류 body 로 확인한 심은 정답과 스크린샷 대조군) |
| REQ-M44 | SDK·CLI 영어 오류 원문은 말풍선에도 배너에도 나가지 않는다 — Service 문장은 한 번만 (TUX-CHAT-14 · 2026-10-18 체험 진단 P1-03) | Service 가 요청을 거절하면(401·403·409·429, 프로바이더 5xx) CLI 는 거절을 **자기 assistant 메시지**로 찍는다(`error` 필드 또는 `<synthetic>` 모델, 예: `API Error: Request rejected (429) · <Service 문장>`, `Failed to authenticate. API Error: 403 <Service 문장>`). 그리고 `is_error` result 로 턴을 끝낸 뒤 `query()` 가 `Claude Code returned an error result: <같은 줄>` 을 던진다(2026-10-18 실측, SDK 0.3.299 · `test/fixtures/sdk-gateway-errors.json`). 그동안 이 줄이 코치 말풍선과 배너에 **둘 다** 나가 학생은 영어 배관 문자열과 Service 문장을 두 번 읽었고, 말풍선에는 소용없는 REQ-M39 폴백(`다시 한 번 부탁하거나…`)까지 붙었다. 계약: ① `consumeSdkStream` 은 CLI 오류 줄(`sdkCliErrorLine`)을 `onDelta` 로 내보내지 않는다 — 코치가 한 말이 아니다. `<synthetic>` 이어도 오류 줄이 아닌 것(`No response requested.`)과, 코치가 자기 말로 오류를 설명하는 정상 답은 그대로 나간다; ② 그 줄 뒤에 실패 result 가 오거나 정상 답 없이 스트림이 끝나면 턴은 **SDK 와 같은 형식의 오류**(`Claude Code returned an error result: …`, 이 턴의 status)로 끝난다 — SDK 가 던지지 않아도 조용히 끝나지 않고, `passSpentNotice`·`bindingRefusalCode`·스풀·ops 분류는 예전과 같은 문자열을 읽는다. 이 경우 REQ-M39 폴백은 붙지 않는다. 뒤에 코치의 정상 답이 오면 그 줄은 이 턴의 실패가 아니다; ③ 배너 문장은 `sdkErrorDisplayText` 가 만든다 — SDK·CLI 원문이면 Service 문장만 꺼내고(`[hps:…]` 태그·`(status N)`·풀리지 않은 JSON 본문 처리), 사람이 읽을 문장이 없으면 상태별 한국어(429·5xx 는 stall 워치독과 같은 문장, 그 밖은 기존 일반 문장)로 바꾼다. SDK 가 스스로 `Claude Code process exited …` 로 던져도 그 턴의 CLI 오류 줄에서 문장을 찾는다. 앱이 만든 한국어 오류는 그대로 통과한다; ④ 산 이용권 소진은 여전히 REQ-L12 ⑪ 안내가 먼저다. **이 행이 주장하지 않는 것**: 배너 제목(`errorBannerPresentation`)은 바꾸지 않았다 — 403 `trial_expired` 문장은 `시간` 때문에 여전히 `연결이 끊겼어요` 로 분류된다. 다음 행동(구매·이어서 하기) 안내도 이 행의 범위가 아니다. 실기기 확인이 아니라 기록된 SDK 메시지 형태의 재생이다 | U (`test/sdk-error-text.smoke.mjs` — 기록된 429·403 세 시나리오 재생(SDK 가 던질 때·안 던질 때), 401·409 합성, 5xx·JSON·태그; 양성 대조군: 정상 답·코치의 자기 설명·재시도 뒤 정상 답·REQ-M39 안내 유지; 음성 대조군: 기록된 수정 전 화면을 검출기가 잡는다) |
| REQ-M45 | SDK-only seat with no `claude` binary: no proxy fallback, one install notice (trial diagnosis 2026-10-18, US-01, F2/G7) | A native-trial or paid-pass grant (`activity_kind: "trial"` or `pass`), or a turn funded by a picked pass, is refused on `/v1/chat/completions` by the Service (409 `trial_requires_sdk`). When `runSdkCoach` throws `SdkUnavailableError` for such a seat, the REQ-M7 fallback does **not** run: the default, model-picked, pass-picked and web-search branches all end with the same `SDK_MISSING_NOTICE` ("이 Studio에는 AI 작업 도구(Agent SDK 실행 파일)가 설치되어 있지 않아 코치를 실행할 수 없어요. hypeproof-ai.xyz/studio/install 에서 받은 코드로 설치 도구를 내려받아 실행한 뒤 Studio를 다시 열어 주세요. 대화와 작업은 그대로 남아 있어요."). It states the cause and the remedy, names no staff, instructor or operator, and never shows the English `SdkUnavailableError` text (that reason goes verbatim to the "HypeProof Coach" output channel only, REQ-M30 ③). `streamError.retry: false` hides "다시 보내기" because resending cannot help. If a 409 `trial_requires_sdk` still reaches `proxyChat`, the Service sentence is kept and the same notice is appended. A personal (account) seat that still falls back gets the solo variant of the REQ-M30 ② line (installer instead of "스태프를 불러주세요."). Classroom seats are unchanged: REQ-M7 fallback, existing web-search and picked-model copy, existing retry button. Pure routing and copy: `src/sdkRequiredHelpers.ts` | U (`test/sdk-required.test.mjs`: exact Service 409 body through the actual `proxyChat`; actual provider matrix trial x {no selection, model picked, pass picked, web search}; classroom seat negative control; webview reducer retry flag) |
| REQ-STUDIO-TRIAL-BUSY | A native-trial seat's busy refusal ends within the bounded SDK busy policy | The Service holds one lease per native-trial grant (a bought pass is one too) and refuses an overlapping request with `429 trial_busy`, sending no `x-should-retry`, so the CLI retries it as a rate limit. Observed 2026-10-18 against a gateway that held the lease (SDK 0.3.299): 11 `api_retry` 429 events over 186 s, then the CLI's raw `API Error: Request rejected (429) · …` line as the chat bubble. The A2 busy policy (`SDK_BUSY_NOTICE`, `SDK_BUSY_ABORT_FRIENDLY`, `SDK_BUSY_MAX_RETRIES` = 3, `SDK_BUSY_MAX_WAIT_MS` = 90 s) was attached to orchestrator seats only, and the trial profile serves `orchestrator.enabled: false`. Contract: ① `sdkBusyPolicyFor` attaches the policy to an orchestrator seat **or** a seat whose served `activity_kind` is `"trial"`; classroom and personal seats without a roster keep today's path byte for byte; ② on a trial seat the first busy retry posts `SDK_BUSY_NOTICE` once as a ⏳ timeline line (`SdkCoachArgs.onNotice`, the host's `postToolLog`), and the third busy retry, or 90 s of busy waiting, aborts the query with `SdkBusyAbortError` (`SDK_BUSY_ABORT_FRIENDLY`) before the CLI's raw line is read; ③ a lease released after one retry lets the answer flow after the single notice; ④ the notice is optional, the bound is not: with no host sink the turn still ends on the third retry. **Not claimed**: the Service still sends no `x-should-retry` on `trial_busy`, and the abort copy says the service is crowded rather than that the learner's own earlier request is still running. | U (`extensions/hypeproof-chat/test/sdk-trial-busy.smoke.mjs` — replay of the observed stream: lease held forever (negative, ends on retry 3) vs released after one retry (positive), classroom control keeps all 11 retries; gate removed → negative fails) |

## R. 음성 capability 계측 (#896 / #897 V0)

계획된 팝업 UX (#939): [VO-36–47](requirements/voice-conversation.md) · [VO-T36–47](testing/voice-conversation.md). 큰 패널/작은 컨트롤과 관측 기반 움직임은 요구사항이며 현재 구현 완료를 뜻하지 않는다.


음성 전체 계획: [VO-01–35](requirements/voice-conversation.md) · [VO-T01–35 및 독립 검수](testing/voice-conversation.md) · [에픽 인계](plan/voice-conversation-epics.md). 아래 구현 계약과 전체 수용 기준의 완료 상태는 구분한다.

V1 음소거 계약 보강 (#929): 사용자의 음소거 의도는 전송 재연결과 독립적으로 보존한다. 연결 복구는 명시적 음소거 해제를 대신하지 않으며, 연결 대기 중 음소거 해제도 transport_ready 이전에 캡처를 열지 않는다. 순수 결정 회귀: `voice-session.smoke.mjs`; 실제 기기 인수는 별도 미실행.


> 음성 **요구사항 초안**은 #896→#897~903 (VO-01~35) 이 소유한다. 이 절은 그 초안을
> 복제하지 않고, 구현 쪽이 세운 **최소 통합 계약**만 적는다(#896 공통 경계: Claude =
> 제품 구현·최소 계약/ADR). 초안과 이 절이 어긋나면 초안이 정본이다.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-R1 | 음성 capability 는 **주장하지 않고 측정한다** (#897 VO-01/VO-04) | VO-01 은 "설치본의 마이크 권한·webview 오디오 경로를 확인한다" 인데, 확인 이전에 **사실이 하나 있다**: 출하된 0.1.51 번들 코어(`out/vs/workbench/contrib/webview/browser/pre/index.html`)의 webview 내부 iframe allow 목록에 `microphone` 이 **0건**이다. **2026-09-11 두 가지 정정**: ① 이 행은 allow 목록이 "clipboard 둘 뿐" 이라고 적었는데 틀렸다 — 실측하면 다섯 개다(`cross-origin-isolated`·`autoplay`·`local-network-access` + 스크립트 허용 시 clipboard 둘). `microphone` 부재라는 결론은 그대로다. ② "CSP 이전 단계에서 거부된다" 는 **인과 주장이었고 증거가 없다.** 실측으로 아는 것은 둘뿐이다 — allow 목록에 `microphone` 이 없고, Electron 메인 프로세스의 webview 권한 집합(`out/main.js`, 설치본)에 `media` 가 없다. 내부 iframe 은 same-origin 이고(`allow-same-origin` + 같은 출처 `fake.html` 로 로드) `microphone` 의 기본 allowlist 는 `self` 이므로, allow 속성에 없는 기능이 비활성화되는지 기본값으로 남는지가 MDN 에서 명확하지 않다. **어느 관문이 거부하는지는 패치된 빌드로만 가른다.** 같은 실측에서 드러난 더 중요한 사실: `media` 는 워크벤치 문서(`vscode-file://vscode-app`)에는 **이미 허용돼 있다** — 막힌 것은 webview 프레임뿐이다. 그 상태에서 마이크 UI 를 만들면 V1 의 네 권한 상태(허용·거부·장치없음·철회)가 **모든 설치본에서 같은 거부로 수렴**해 죽은 토글이 학생에게 나간다. 계약: ① capability 는 `hps-voice-capability/1` 보고서로 **측정**하며, 이후 어떤 음성 코드도 capability 를 가정하지 않고 이 게이트에 묻는다; ② 웹뷰는 **원시 관측만** 보내고 판정은 순수 호스트 모듈이 한다 — 같은 곳에서 재고 판정하면 "못 쟀다" 와 "재서 막혔다" 가 한 boolean 으로 섞이고, core patch 가 들어간 뒤에도 보고서가 계속 "막힘" 이라 말해 아무도 다시 재지 않는다; ③ **측정하지 않은 것을 막혔다고 적지 않는다** — `attempted: false` 는 `unknown` 이며 `blocked` 가 아니다. 이것이 이 계약의 핵심 음성 대조군이고, 없으면 분류기를 `return "blocked"` 로 써도 나머지 단언이 전부 통과한다(오늘 모든 빌드가 실제로 blocked 이기 때문); ④ 세 관문(iframe allow 목록 · 메인 프로세스 권한 목록 · Chromium 장치 권한)을 구분 가능하게 따로 재고, `getUserMedia` 오류의 **이름과 문구를 둘 다** 남긴다 — boolean 으로 접으면 어느 관문인지 영영 못 가른다; ⑤ 출력은 Web Audio · `data:` 오디오 · `blob:` worklet 을 따로 재서 `media-src`·`worker-src` 부재를 각각 분리한다. **Web Audio 만으로 된다면 `media-src` 를 넣지 않는다** — 이 계약은 CSP 를 쓰는 것이 아니라 필요 여부를 재는 것이다; ⑥ 모순된 관측(시도 안 했는데 결과가 있음, granted 인데 트랙 없음, rejected 인데 오류 이름 없음)은 **분류하지 않고 거부**한다 — VO-T05 의 "미실행을 PASS 로 기록한 fixture 는 거부한다" 를 자기 산출물에 적용한 것; ⑦ CSP 가 허용하는데 프로브가 실패하면 제품 판정을 내지 않고 `instrument_suspect` 를 남긴다(verification.md 규칙 6); ⑧ 보고서는 앱 버전과 확장 버전을 **둘 다** 적는다 — 설치본 0.1.51, 확장 0.1.5 로 실제로 다르고 한 칸이면 어느 쪽을 읽은 기록인지 모른다; ⑨ **학생에게 보이는 표면을 만들지 않는다.** 명령으로만 호출한다 — patch 후 이 경로가 OS 권한 프롬프트를 띄우므로 교실에서 묻지 않고 뜨면 그 자체가 사고다. 메뉴·툴바 부재만으로는 근거가 안 된다 — 기여된 명령의 **기본값은 명령판에 보임**이므로 `menus.commandPalette` 에 `when: "false"` 를 선언하고 테스트가 그 선언을 확인한다. **2026-09-10 정정**: #904 는 '메뉴에 없음' 을 근거로 비노출을 주장했고 그건 틀렸다 — 아이가 명령판을 열면 진단 명령이 그대로 보였다. 등록 자체도 `if (spool)` 분기 안에 들어가 스풀이 없는 런에서 조용히 사라졌다(두 결함 모두 같은 PR 에서 수정);  ⑩ 보고서는 **로컬 전용**이다. 업로드 allowlist(`session.meta.json`·`events.jsonl`·`manifest.json`)는 닫힌 상태를 유지한다 — 음성 산출물 업로드는 미성년 보존 정책(#901 V4) 결정 전에 열지 않는다. **이 행이 주장하지 않는 것**: VO-01·VO-T01 의 PASS 아님(계측기 + macOS 관측 1건, **Windows 는 NOT RUN**), 공급자·전송 결정 아님(VO-02), core patch 가 충분하다는 주장 아님(네 번째 관문 가능성은 patch 된 빌드로만 가른다), CSP 변경 아님 | U (`test/voice-capability.smoke.mjs`) |
| REQ-R2 | 음성이 들어오기 **전**의 텍스트 흐름을 기준선으로 찍는다 (#897 VO-04/VO-T04) | VO-04 는 "음성 부재·모듈 오류·기능 비활성 상태에서 기존 텍스트 진입→수정→저장 흐름이 유지된다" 를 요구한다. 그 판정에는 **유지돼야 할 것이 무엇이었는지**가 필요하고, 음성 코드가 들어온 뒤에 기억으로 복원하면 그건 기준선이 아니라 사후 서술이다. 그래서 음성 세션이 아직 존재할 수 없는 오늘(REQ-R1) 찍는다. 계약: ① 진입→수정→저장을 **실제로 돌린다** — 순수 모듈(`sendQueue`·`chatTimeline`)을 호출하고, 델타를 **두 번** 넣어 누적과 덮어쓰기를 구별한다(한 번만 넣으면 `content = delta` 로 바꾸는 변경이 통과하고 그건 흐름 가운데서 글자가 사라지는 결함이다); ② 판정을 **화면이 따르는지**도 잠근다 — `decideEnter` 만 재면 그 답을 동작으로 바꾸는 Enter 핸들러가 비어 있어도 통과한다. 세 갈래(ignore 무동작 · queue 는 `setQueued` + `setDraft("")` + 중단 · 그 밖에는 `submit()`)를 핸들러 슬라이스 안에서 확인하고, 슬라이스가 핸들러를 넘어 번지지 않았다는 음성 대조군을 붙인다; ③ 저장 모양(`ChatMessage`)에 오디오 필드가 들어올 자리가 없다 — 필드 목록 완전 일치; ④ 채팅 패널 CSP 는 **이름이 아니라 값으로** 잠근다. 지시자 이름만 재던 동안 `connect-src` 에 스트리밍 STT 주소를 붙이는 변경, `default-src 'none'` → `'self' mediastream:`, `script-src` 에 `'unsafe-eval'` 추가가 **모두 초록으로 지나갔다** — `cspBuilder.ts` 자신이 "Do NOT loosen `connect-src` to https:" 라고 적어둔 그 구멍이다. 전체 문자열 완전 일치로 막는다; ⑤ 텍스트 경로 파일들(ChatPanel·sendQueue·chatTimeline·chatPanelHelpers)과 호스트의 텍스트 진입 분기(`case "sendMessage"`·`case "retryMessage"`)가 음성 심볼 참조 0회 — 스캐너는 `mic` 계열을 **단어 경계로** 본다(`dynamic`·`atomic`·`semicolon` 이 걸리면 멀쩡한 파일을 음성 오염으로 잡는다; 경계 없이 썼다가 자체 대조군에 걸렸다); ⑥ 음성을 참조하는 파일의 **목록 자체**를 잠근다 — 정의 3 + 참조 4 = 7개. 이게 exit plan 의 실제 범위다. **처음 이 절의 기준은 "음성 3파일을 지워도 컴파일된다" 였고 그건 거짓이다** — 지우면 host 5건 · webview 3건의 tsc 오류가 난다(`protocol.ts:261`, `chatPanelProvider.ts:247·252·255`, `extension.ts:96`, `App.tsx:15·203`). 참조 0회인 것은 텍스트 흐름 파일들이고 프로젝트 전체가 아니다. **이 행이 주장하지 않는 것**: 음성 3파일만 지우면 빌드가 된다는 주장 아님(위 7개를 다 건드려야 한다), 실기기 관측 아님(소스·순수 모듈 단위), ChatPanel 의 DOM 동작 검증 아님(웹뷰는 단독 실행이 안 되어 핸들러 배선을 소스로 잠근다) | U (`extensions/hypeproof-chat/test/pre-voice-text-flow.smoke.mjs`) |
| REQ-R3 | 오디오 거절은 **계량되는 좌석 전용**이다 — 범위를 넓혀 적지 않는다 (#897 VO-T05 / #901 V4) | 음성 코드가 하나도 없는 지금도 Service 는 오디오를 거절한다(`budget-admission` 의 `validateWire`, `usage-costs` 의 `normalizeCostUsage`). 그 거절에 이름이 없으면 나중에 음성을 붙이는 변경이 조용히 지워도 아무 테스트도 울지 않는다. 계약: ① 거절을 **공개 진입점으로** 구동한다 — `validateWire` 는 비공개이므로 `reserveBudgetAttempt` 를 통해 재고, 그래야 "함수는 남았는데 호출이 빠진" 변경도 잡힌다; ② 모든 거절 단언에 **같은 경로의 통과 대조군**을 붙인다 — 없으면 `throw` 한 줄짜리 검증기와 구별되지 않는다. `modalities: ['text']` 가 통과하는 것까지 경계로 잰다; ③ 거절은 내구성 있는 행을 남기지 않는다(행 수로 직접 확인); ④ **프로토콜 두 축**을 잰다 — `anthropic-messages` 와 `openai-chat`. 한 축만 재던 동안 미디어 검사를 그 프로토콜 전용으로 좁히는 변경이 전부 초록으로 지나갔고, `routes/chat.ts` 는 다른 축으로 같은 함수를 부른다; ⑤ `/v1/chat/completions` 는 거절이 아니라 **탈락**이다 — `translateOpenAI` 가 화이트리스트로 본문을 조립하므로 `audio`/`modalities` 는 `validateWire` 에 도달조차 하지 않는다. 그 비대칭을 음성 대조군으로 고정하고, **키 이름이 아니라 바이트로** 잰다(센티널 base64) — 이름만으로 재던 동안 블록을 `{type:'audio', source:…}` 로 바꿔 실어 보내는 변경이 통과했다; ⑥ **거절은 계량과 무관하다 (2026-09-11, #901 V4).** 2026-09-10 실측에서는 거절이 `routes/messages.ts` 의 `if(executionAccess)` 안에 있어 계량되지 않는 좌석에 가드가 **없었다** — 정책 미설정 + 자금원 헤더 없음이면 text/audio/input_audio 전부 200 이고 상류 본문에 `"audio":{"voice":"alloy","format":"pcm16"}` 가 그대로 들어갔다. 아동 코호트가 그 좌석에 있다. 그 사실을 "가드가 옮겨지면 터지는" 상시 단언으로 박아 뒀고, 음성을 붙이기 전에 옮겨서 **그 단언이 실제로 터졌다** — 터진 것이 정답이었고 지금은 바뀐 사실을 다시 고정한다. 계약: `assertNoAudioWire` 가 admission 바깥에서 모든 좌석에 돌고, 거절은 **상류를 부르기 전**이다(업스트림 뒤의 거절은 이미 돈이 나간 뒤다). **옮긴 것은 오디오 절반뿐이다** — 이미지·문서·호스티드 툴 거절은 계량 좌석의 노출 상한 계약으로 남는다. 계량 없는 좌석의 이미지가 그대로 통과하는지를 **범위 대조군**으로 같이 잰다. 그게 없으면 `validateWire` 를 통째로 밖으로 내보내 지금 도는 이미지를 조용히 깨는 변경이 나머지 단언을 전부 통과한다(계량 좌석에서는 이미지가 원래 거절이라 다른 절도 그 변경을 못 잡는다). **이 행이 주장하지 않는 것**: 게이트웨이가 오디오를 보편적으로 막는다는 주장 아님(위 ⑥), 음성이 동작한다 / 음성 가격이 있다는 주장 아님(둘 다 없다), 제공자·전송 결정 아님(VO-02) | Service (`worker/test/audio-refusal-contract.test.mjs`) |
| REQ-R4 | 음성 기록은 **기존 식별자**에 묶는다 — 새 스토어를 만들지 않는다 (#897 VO-03/VO-T03) | 음성 세션은 아직 존재할 수 없으므로(REQ-R1) 이 계약은 돌아가는 기능의 명세가 아니라 **앞으로 어떤 음성 코드도 식별자를 새로 만들지 못하게 막는 잠금**이다. 계약: ① 버전 있는 단일 계약 (`hps-voice-linkage/1`) 이고, 읽을 수 있는 버전 집합을 주입 가능하게 둔다 — 없던 버전을 발명해 구/신 혼용을 꾸며내지 않는다; ② 식별자 문법은 기존 정의를 **import** 한다(`validTurnId`·`accessId`·`isUuid`·`isSha256Hex`) — 복사해 적으면 조용히 갈라지고, import 하면 갈라질 때 타입체크가 터진다; ③ 식별자별 **소유 스토어**를 기계가 읽을 수 있게 적고, 적힌 증거 리터럴이 실제로 worker 소스에 있는지 테스트가 확인한다. `voice_session_id` 만 전용 스토어가 없으므로 **만들지 않고** 기존 `hps-observation/1` 이벤트의 그룹 키로 싣는다; ④ 공급자(VO-02)가 정해지지 않은 두 칸(모델이 실제로 들은 오디오, 끼어들기 취소 의미)은 **타입에서** PROVISIONAL 로 막는다 — 주석으로만 적으면 다음 사람이 구체값을 채우고 그게 계약처럼 배포된다; ⑤ 허용 키 목록이 **드리프트 락**이다 — 이 목록이 오디오/전사 키를 받아들이면 이 행의 목적 자체가 무너지므로 목록 자체를 단언한다; ⑥ VO-T03 의 "임의 새 스토어 없음" 증거는 **스캐너가 실제로 탐지하는 범위까지만** 주장한다 — `voice\|audio\|speech\|transcript\|utterance` 토큰이 든 테이블·KV 네임스페이스다. 처음엔 `voice` 토큰과 `live\|cohort\|rate` 하위만 봤고 `voice:sess:`·`voicelog:`·`audio:chunk:`·`CREATE TABLE utterances` 가 모두 빠져나갔다(프로브로 확인). 넓힌 뒤에도 `rt:sess:`·`CREATE TABLE realtime_sessions` 처럼 **이름에 음성 토큰이 없는** 스토어는 탐지하지 못하므로, 주장을 그만큼 좁혀 적는다 — 탐지하지 못하는 것을 막았다고 적지 않는다. **이 행이 주장하지 않는 것**: 음성 기록 **분리** 아님(히스토리는 여전히 코호트 단위), 미성년 보존 정책 결정 아님(#901 V4), 공급자 결정 아님(VO-02) | Service (`worker/test/voice-linkage-contract.test.mjs`) |
| REQ-R5 | 음성 세션의 상태·끼어들기·자원 해제는 **순수 결정 계층 하나**가 소유한다 (#898 VO-06/VO-07/VO-09) | 음성 기능을 붙이기 전에 결정 계층을 먼저 고정한다. 이유는 테스트 편의가 아니다 — 상태 전이를 DOM 핸들러에 흩어놓으면 "지금 마이크가 열려 있나" 를 한 곳에서 답할 수 없고, 그 질문에 답할 수 없는 제품을 아이에게 주는 것이 VO-06 이 막으려는 일이다. #898 이 "V0 계약 및 V4의 인증·예산 경계. 그 전에는 합성 세션으로 개발 가능" 이라 적었고, 실제 음성 세션은 아직 존재할 수 없으므로(REQ-R1) 기기에 닿지 않는 부분만 여기 둔다. 계약: ① 상태는 아홉 갈래이고 **접지 않는다** — 특히 `listening`(듣는 중)과 `preparing`(응답 준비)은 사용자에게 완전히 다른 상황이라 하나의 `busy` 로 접으면 화면이 둘을 같은 스피너로 그린다; ② **명시적 `start` 이전에는 어떤 이벤트도 캡처를 열지 않는다.** 단발이 아니라 누적으로 잠근다 — 기기·네트워크 이벤트는 순서가 뒤바뀐 채 들어오고, 그 누적 경로에서 새는 것이 실제 위험이다; ③ 음소거는 캡처를 **실제로 닫는다**. 들어온 샘플을 버리는 소프트 게이트로 구현하면 OS 마이크 표시가 켜진 채 남고, 아이는 껐다고 듣고도 켜진 표시를 본다 — 그 불일치 자체가 VO-06 위반이다; ④ `speaking` 중에는 캡처를 **열어 둔다**(끼어들기 조건). 그 대가로 스피커 에코 구간이 생기고, **에코 억제는 이 계층이 해결하지 않는다** — 캡처가 열려 있다는 사실만 정직하게 들고 있어 실기 검증이 "언제 에코가 들어올 수 있나" 를 답할 수 있게 한다; ⑤ 끼어들기는 재생 중과 **재생 직전**(`preparing`) 모두 유효하다. 후자가 특히 중요하다 — 아직 한 글자도 안 들린 응답을 "들었다" 로 기록하면 다음 턴이 거짓 전제로 돈다; ⑥ 들은 범위는 네 갈래이고 `unknown` 이 **따로 있다**. 재생기가 경계를 보고하지 않는 경우가 실제로 있고, 그때 `none`/`all` 로 접으면 측정하지 못한 것을 사실로 적는 것이 된다(V0 의 `attempted:false → unknown` 과 같은 규칙). 타임마크가 없으면 글자 경계를 **추정하지 않는다** — 추정값이 문맥에 들어가면 그 거짓말이 대화 내내 남는다; ⑦ 모순된 관측(정렬되지 않은 타임마크)은 분류하지 않고 거부한다; ⑧ **재연결이 복수 청취 세션을 만들지 않는다.** `transport_ready` 의 세션 수는 증가가 아니라 **대입**이다. **2026-09-10 실제 발견**: 처음 작성본에는 복구 가능한 끊김이 아예 모델링되어 있지 않아 전송이 흔들리면 갈 곳이 `error`(세션 사망)뿐이었다 — 변이 테스트(`+1` 변이가 살아남음)가 테스트 구멍이 아니라 **요구 경로 누락**을 드러냈다. 지금은 `transport_dropped` 가 캡처를 닫고 재생 큐를 버리되 세션 슬롯은 유지한 채 `connecting` 으로 돌아간다; ⑨ 종료·오류 뒤 남는 자원이 없다. boolean 하나가 아니라 **해제 목록**(`capture_tracks`·`transport`·`playback_queue`·`session_slot`)으로 돌려주어 하나를 빠뜨렸는지 테스트가 확인한다 — transport 만 닫고 track 이 남는 것이 아이 노트북에서 마이크 표시가 안 꺼지는 모양이다; ⑩ VO-08 의 **정책**만 둔다. 임계값은 `provisional: true` 로 **타입에 표시**하고 주입 가능하게 남긴다 — 주석으로만 적으면 다음 사람이 그대로 기본값으로 배포하고 그게 계약처럼 굳는다(이 레포는 그 비용을 이미 치렀다). **이 행이 주장하지 않는 것**: 음성이 동작한다는 주장 아님(마이크를 여는 코드가 없다), VO-08 임계값이 맞다는 주장 아님(실제 한국어 발화·헤드셋·스피커 에코로만 정해지며 VO-T08 전까지 "튜닝 완료" 로 읽어서는 안 된다), VO-10 전부 아님(실기 + 사람 판단), 공급자·전송 결정 아님(VO-02 미정이므로 이 계층은 공급자 비의존), 그리고 **mock 성공을 실기 성공으로 확대하지 않는다** — VO-T06~T10 은 전부 NOT RUN 이다 | U (`extensions/hypeproof-chat/test/voice-session.smoke.mjs`) |
| REQ-R6 | 팝업은 **보이는 상태**와 **자원 상태**를 따로 들고, 둘이 어긋나면 터진다 (#939 VO-36 · VO-38 · VO-40 ~ VO-47) | #939 이 만든 새 사실 하나가 이 행의 전부다: 팝업은 **접혀도 세션이 살아 있다**. 그 전까지 이 레포에서 "보인다" 와 "마이크가 열려 있다" 는 같은 값이었고, 둘이 갈라지는 순간 두 방향의 결함이 동시에 생긴다 — 축소가 세션을 죽이거나(학생이 하던 대화를 잃는다), 안 보이는 채로 캡처가 열린 채 남는다(VO-40 이 금지하는 그것). 계약: ① 표현 결정은 `voicePopupHelpers.ts` 한 곳이 소유하고 **순수**하다 — `vscode` 도 DOM 도 참조하지 않으며 테스트가 소스로 확인한다. `VoicePanel.tsx` 는 받은 것을 배치만 한다; ② 축소·펼치기는 세션 이벤트를 **0개** 낸다. 이것이 "확대/축소가 새 세션을 만들지 않는다" 의 실제 구현이고, 하나라도 내면 테스트가 깨진다; ③ 컨트롤이 사라짐 · 앱 비활성화 · 잠자기 · 승인 검토는 **멈춘다**(mute 로 내려가 캡처를 실제로 닫는다). 조건이 풀려도 **자동 재개하지 않는다** — `awaitingResume` 로 남고 사용자가 눌러야 푼다; ④ 일시중지는 사용자의 음소거 의도를 **지우지 않는다**. 멈춤과 음소거를 한 플래그로 두면 화면을 잠깐 가렸다 돌아온 것만으로 눌러 둔 음소거가 풀린다(#929 의 재연결 결함과 같은 계열, 상시 대조군); ⑤ 움직임은 **관측된 오디오에만** 붙는다. 연결 중·응답 준비는 입력 반응이 아니라 별도 진행 표시이고, 생성이 끝났어도 재생 중이 아니면 출력 파형은 반응하지 않으며, 미보고는 0 이 아니라 `null` 이다 — 0 으로 접으면 "무음" 과 "측정 안 됨" 이 같아진다(REQ-R1 ③ 의 화면판); ⑥ 시작 게이트는 여덟 갈래를 **구분**한다 — 특히 `capability_unmeasured`(아직 안 쟀음) 와 `input_blocked`(재서 막힘) 의 문구가 달라야 한다. 하나의 회색 버튼으로 접으면 REQ-R1 이 계측기까지 만들어 가른 구분을 화면에서 다시 뭉갠다; ⑦ 종료·X·Escape·텍스트 전환은 **같은 해제**로 수렴하고, 확정 전사는 남기되 미확정 전사를 자동 전송하지 않으며, 음성 종료가 도구 작업 취소를 주장하지 않는다(`toolRunClaim: 'unchanged'` 한 값뿐); ⑧ 팝업을 여는 것만으로 화면 캡처나 전체 파일 공유가 없다 — `sharedContextOnOpen` 의 `screenCapture`·`allWorkspaceFiles` 는 타입 수준에서 `false` 다. 발화 '네' 는 승인이 아니다(`utterance` 를 받아 **쓰지 않는** 것이 의도이고, 그래야 음성 대조군이 성립한다); ⑨ 이름은 기존 `resolveCoachIdentity` 결과를 받고 '코치' 를 새로 하드코딩하지 않는다. effort 는 그 음성 경로가 실제 지원할 때만 보낸다. 세션 중 모델 교체는 없고 종료 후 재연결이다; ⑩ 예상 잔량을 확정으로 적지 않고, 한도 도달은 새 **유료** 응답만 막는다 — 종료·결과 열람은 계속된다. 자동 개인 결제/모델 전환은 타입 수준에서 `false`. 강사는 이름·시작 안내 문구만 바꾸며 상태·종료·서버 정책은 숨길 수 없다. ⑪ 축소·펼치기 후 포커스가 표시된 패널 안에 남고 두 형태 모두 Escape를 종료 콜백으로 전달한다. 상태·종료·음소거는 고정하고 긴 전사·세션 정보만 스크롤한다. 모션 감소 시 입력 레벨이 바뀌어도 막대 높이는 정적이며 상태 문구는 유지한다(#962, Chromium 합성 props 회귀). **이 행이 주장하지 않는 것**: 음성이 동작한다는 주장 아님 — 마이크·전송 코드는 여전히 없고(REQ-R1) 실제 마이크·전송·입력창 연결은 미구현이다. VO-T36~T47 은 **NOT RUN**(실기·사람 평가 전부). 채팅 입력창 배선도 **아직 하지 않았다** — 그 변경은 REQ-R2 ⑤ 의 기준선(텍스트 경로 파일의 음성 심볼 0회)을 깨므로 실제 연결이 생기는 UI-2 에서 그 행과 함께 갱신한다. #940 의 480×520 등 크기·색은 시안값이고 실기 검증 전이다 | U (`test/voice-popup.smoke.mjs`) |


## How to update this doc

1. PR that **adds** a behavior:
   - Add a row to the appropriate domain table (A–L). New domain → new ## section.
   - Specify Layer column with cheapest-first principle (U over E over R over M).
   - In the same PR, add a sub-issue to epic #89 if 🔴 (not yet implemented).

2. PR that **changes** a behavior:
   - Update the row's acceptance criteria.
   - Reference the REQ-### in the commit message body.
   - If the test layer changes (e.g. promoted U → E because logic moved into VS Code API surface), update the column too.

3. PR that **removes** a behavior:
   - Delete the row.
   - Document the removal in METAPLAN if it's user-visible.
   - Sub-issue cleanup in epic #89.

## Spec version policy

Bump `Spec version` on:
- A new domain section (e.g. M, N, …) → bump minor (e.g. v0.2.0 → v0.3.0).
- New non-breaking REQ rows in an existing domain → bump patch (e.g. v0.3.0 → v0.3.1).
- A breaking contract change in a stable REQ (e.g. token now requires a new claim) → bump minor.
- Editorial (typos, layer-column refinements, wording) → no bump.

Major version bump is reserved for a deliberate restructuring of the doc itself — not for product changes.

## Related

- [METAPLAN.md](../METAPLAN.md) §4.5 — AI Native Asset → Chat Panel UX map
- [docs/seven-assets.md](./seven-assets.md) — 7 AI Native Assets (canonical product philosophy)
- [.claude/rules/extension-dev.md](../.claude/rules/extension-dev.md) — hypeproof-chat extension architecture
- [.claude/rules/build-pipeline.md](../.claude/rules/build-pipeline.md) — build + post-build branding verification
- [tests/rehearsal/README.md](../tests/rehearsal/README.md) — R1–R6 rehearsal categories
- [e2e/README.md](../e2e/README.md) — Playwright Electron e2e

## N. Native browser + agentic control (#278)

Phase 0–3 (통합 브랜치 `feat/homepage-browser`). "실기계"는 디스플레이 있는 풀빌드/
dev-host 검증(자동화 셸 불가). REQ-D3(iframe 샌드박싱)은 live_server 코호트엔 REQ-N1이 대체.
**대상 코호트: 원장 website-copyclone(`dental-copyclone-2026-s1`, cohort
`dental-pilot-2026-a`, tier `website`)** — PR #309 리뷰로 별도 homepage 코호트 대신 이 트랙에 통합.

| ID | 요구 | 설명 | 테스트 |
|---|---|---|---|
| REQ-N1 | live_server 프리뷰 | `preview.type:"live_server"` 코호트는 iframe 대신 워크스페이스를 127.0.0.1로 서빙해 네이티브 브라우저로 열고, 저장 시 SSE로 자동 새로고침. path-traversal 거부 | U(liveServerHelpers) + 실기계 |
| REQ-N10 | Live preview denies devices (#1403) | The live server's page opens as a top-level integrated-browser tab, so the preview iframe's `allow="microphone 'none'; camera 'none'"` (REQ-D3, `PREVIEW_IFRAME_ALLOW`) never applies to it. Every static response (HTML, asset, `/__hp_viewport`, 403/404) carries `Permissions-Policy: camera=(), microphone=(), geolocation=(), display-capture=()`, the same text the Service's published runtime sends for an undeclared project (cr-publish), via `staticResponseHeaders`. The SSE reload stream keeps its own headers. Negative controls: a server sending the pre-#1403 header set, and a policy leaving `microphone=(self)`, both fail the check; the pre-fix `liveServer.ts` fails the smoke. Not claimed: that the header is the only gate (the base app's browser permission handler is separate) or an in-app run | U (`test/live-server.smoke.mjs`, real `LiveServer` over HTTP) |
| REQ-N2 | live_server 계약 완화 | live_server 코호트는 멀티파일·상대경로·same-origin fetch·스토리지 허용 계약을 받음(iframe 단일파일 계약 아님) | U(translate 분기) |
| REQ-N3 | 페이지→코치(vision) | page_context+image_paste 코호트에서 "페이지를 코치에게"가 현재 탭 스크린샷+DOM을 코치에 전달. 미성년 코호트는 반드시 off | U(worker gate) + 실기계 |
| REQ-N4 | 브라우저 tool 게이팅 | `browser_control` 켜진 코호트만 worker가 8개 브라우저 도구 + **프록시용** 사용 규약을 주입. 꺼지면 tool_use/tool_result 블록도 drop. 규약 주입은 런타임별로 갈린다 — REQ-N8 | U(translate, browser-contract) |
| REQ-N5 | CDP 실행기 핸드셰이크 | 실행기는 `Target.attachToTarget({flatten})` 후 sessionId로 모든 페이지 명령 라우팅(스파이크 확정). navigate URL은 스킴 화이트리스트(http/https/localhost/file) | U(cdpSession, browserControlHelpers) + 실기계 |
| REQ-N6 | 자동실행 + 액션로그 | 코치의 브라우저 액션은 모달 없이 자동 실행되고, 채팅에 액션 로그(running→done/error)로 표시. tool 루프 scratch 턴은 영속 히스토리 미오염 | U + 실기계 |
| REQ-N7 | 루프 안전 | agentic 루프는 per-cohort `max_iterations` 캡 + abort 준수. asset_score는 최종(비-tool) 턴만 기록 | U |
| REQ-N8 | 브라우저 규약은 런타임별 (#520) | 두 런타임은 **도구 집합이 다르다** — 프록시(/v1/chat, worker가 `BROWSER_TOOLS` 8종 주입: navigate·read·screenshot·click·type·back·forward·dialog) vs SDK 코치(/v1/messages, 클라이언트가 `MCP_BROWSER_TOOLS` 6종 소유: open·screenshot·live_preview_start·read·click·type). 따라서 시스템 프롬프트에 주입되는 사용 규약도 갈린다: `_browser-control-contract-proxy.md`(게이트 `browser_control.enabled`) / `_browser-control-contract-sdk.md`(게이트 `sdk_tools.browser` — 클라이언트 grant 와 같은 플래그. 2026-10-05 부터 나이·tier 조건 없음, REQ-M21). 판정은 **라우트**가 소유한다(`buildAnthropicSystemBlocks(profile, coach, runtime)`) — `profile.coach_runtime` 은 요청일 뿐 실제 도구 소유자가 아니다. 일치는 **양방향**이다: ① 계약이 그 런타임의 도구를 빠뜨리지 않는다, ② **캐시 프리픽스 전체**(계약 + 코호트 프롬프트 + **스킬** + 스켈레톤)가 그 런타임에 **없는** 도구를 가르치지 않는다. 스킬은 두 런타임 모두에 주입되므로 도구 이름을 박지 말고 런타임 중립 표현("브라우저 도구가 있으면 직접 열어줘라")을 쓴다 — 스킬을 런타임별로 쪼개는 것은 최후 수단 | U(`worker/test/browser-contract`) |

| REQ-N9 | 미리보기 주소는 추측하지 않는다 (#507, #470 재발) | 라이브 서버는 `listen(0)` 으로 매 실행 **다른 에페메랄 포트**를 받는다(실측 2026-07-28: 58085). 그런데 그 주소가 코치 컨텍스트로 가는 통로가 **아예 없었다** — Run 버튼은 확장이 `liveServer.ensure()` 로 URL 을 직접 받아 정상이고, 코치만 알 방법이 없어 `127.0.0.1:3000` 을 반사적으로 찍고 `ERR_CONNECTION_REFUSED` 로 멈췄다(코드·프롬프트 어디에도 `3000` 은 없다 — 모델의 추측이다. 그 포트는 사용 중이라서가 아니라 **비어 있어서** 죽는다). 계약 3겹: ① **주소를 준다** — `liveServer.currentUrl()`(떠 있을 때만, 시작 부작용 없음)을 `x-hps-preview-url` 헤더로 실어 보내고(프록시=요청 헤더, SDK=`ANTHROPIC_CUSTOM_HEADERS`, 작업 폴더 #431 과 같은 통로: 워커가 클라이언트 `system` 을 통째로 교체하므로 프롬프트에 붙이는 길은 없다), 워커가 `# 미리보기 (라이브 서버)` 블록을 만든다. **문구는 워커 소유**, 클라이언트는 주소만 — 값은 루프백 http(s) 만 통과(`sanitizeLoopbackUrl`)라 주입 통로가 되지 않는다. 서버가 없으면 블록도 없다(빈 블록이 곧 추측 유도); ② **추측을 교정한다** — `resolveLivePreviewUrl`(pure): 루프백→루프백만, 서버 주소를 **알 때만**, 경로·쿼리·해시 보존. 프록시 경로는 실행 직전(`retargetLoopbackNavigation`), SDK 경로는 `resolveAlreadyOpen` 안에서(모달과 핸들러가 같은 주소를 봐야 한다). 서버가 안 떠 있는 걸 **아는** 상태에서 루프백을 요청하면 그 주소는 반드시 틀렸으므로 `startLivePreview()` 로 띄우고 진짜 주소를 연다. 호스트가 `livePreviewUrl?()` 를 지원하지 않으면(=모름) **아무것도 바꾸지 않는다**; ③ **교정했으면 말한다** — 도구 결과에 원래 주소와 실제 주소를 함께 적는다. 조용히 고치면 다음 턴에 또 추측한다. 프롬프트 안전망은 런타임별 브라우저 규약 + live-server preview 계약(도구 이름 없이 — REQ-N8 ②) | U(`test/live-preview-url` — 양성/음성 대조군 + 미지원 호스트 무회귀) + R(`worker/test/messages-integration` — 전달·음성·주입 대조군) |

## O. 미성년 안전·컴플라이언스 (#320)

Anthropic 미성년자 가이드(#282 의 2026-07-13 라이선싱 코멘트) 구현 계층. 게이트웨이 모더레이션은
`worker/src/lib/moderation.ts` — deterministic 토큰/패턴 스크린이며 모델 호출이 아니다. **성인
코호트는 이 계층을 완전히 건너뛴다 (동작 변화 0).** 프로젝트 불변식: 미성년 코호트는 의심스러우면
차단(deny) 방향으로만 실패한다.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-O1 | Minor cohort 판별 fail-safe | `minor_cohort: true` 플래그 **또는** `audience.age_range` 상한 < 18 → minor (`isMinorCohort`). 플래그 누락이 모더레이션을 silent-disable 할 수 없음. `/v1/profile` 응답에 `minor_cohort` 노출 (클라이언트 AI 디스클로저 등 minor UX 근거) | R (`worker/test/moderation.test.mjs`) |
| REQ-O2 | 인바운드 게이트웨이 모더레이션 | minor cohort 의 최신 user 텍스트를 **upstream 호출 전** 스크린 (`/v1/chat` + `/v1/messages` 동일, stream/non-stream 공통). 카테고리: 노골적 성적 콘텐츠 · 자해 지시 · 잔혹 폭력 · PII 요구 (전화번호/집주소/주민번호). 한국어 토큰은 multi-char only (bare 색 → 검색 매칭 함정). 차단 시 400 + `type: "moderation_block"` + kid-friendly 한국어 문구 + `request_id`, upstream 호출 0회 | R (`worker/test/moderation.test.mjs`) |
| REQ-O3 | 아웃바운드 non-stream 모더레이션 | non-stream 응답의 assistant 텍스트 스크린 — 차단 시에도 usage 계량은 유지 (토큰은 실소비). **스트리밍 아웃바운드는 문서화된 후속** (스트림 버퍼링 금지 — 인바운드 스크린 + 코호트 child-safety 프롬프트가 스트림 경로 방어) | R (`worker/test/moderation.test.mjs`) |
| REQ-O4 | 성인 코호트 무영향 | adult profile 은 스크린을 아예 호출하지 않음 — 동일 텍스트가 성인 경로에선 그대로 통과 | R (`worker/test/moderation.test.mjs`) |
| REQ-O5 | 로그 위생 | 차단 로그(console.error + Analytics `moderation_block` datapoint)는 category + rule id + FNV hash 만 — 매칭된 텍스트 verbatim 절대 금지 | R (`worker/test/moderation.test.mjs`) |
| REQ-O6 | Age-verification 설계 노트 | [docs/age-verification.md](./age-verification.md) 유지 — 수강등록+roster+토큰 게이트가 minors-guide 의 "only intended users" 요건을 충족한다는 논거 + 잔여 갭 추적 | M (문서 리뷰) |
| REQ-O7 | False-positive 회귀 목록 | 검색/색상/이야기한(야한)/유니섹스(섹스)/게임 속 몬스터 처치/사이트 주소/전화번호 입력 화면 등 benign 한국어가 절대 차단되지 않음 — 룰 추가 PR 은 이 목록을 통과해야 머지 | R (`worker/test/moderation.test.mjs`) |

## P. 배포 자동화 (코치 스킬 · #431 결과물 2번)

배포 절차는 코드가 아니라 **스킬 마크다운**(`worker/src/skills/publish-homepage.md`)에
있다 — 코치가 셸로 직접 수행하는 실행 절차다. 그래서 회귀도 "함수가 틀렸다"가 아니라
**"절차의 순서가 틀렸다"** 로 나타나고, 테스트도 순서를 잰다.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-P1 | Pages 프로비저닝을 기다린 뒤 워크플로를 올린다 (#500) | `gh api -X PUT .../pages -f build_type=workflow` 의 **2xx 는 접수 확인이지 준비 완료가 아니다** — 백엔드 프로비저닝은 비동기라, 곧바로 워크플로 파일을 올리면 push 로 실행이 걸리고 `actions/configure-pages@v5` 가 활성 Pages 환경을 못 찾아 `HttpError: Not Found` 로 죽는다(2026-07-28 실측: 3연속 실패 중 2건). GitHub UI 의 "Static HTML ▸ Configure" 버튼이 되는 이유도 기능이 아니라 **순서**다 — 프로비저닝이 끝난 뒤에 워크플로를 쓴다. 계약: ① PUT 후 `repos/{owner}/{repo}/pages` 의 `build_type` 이 `workflow` 로 보일 때까지 **끝나는 루프**(12회×5s, bash/PowerShell 양쪽 제공)로 대기 — 스킬 자신의 규칙대로 `until` 금지(끝나지 않는 루프는 수업을 세운다); ② 준비 확인 전에는 **워크플로를 올리지 않는다** — 올려봐야 실패한 빨간 실행 기록만 남는다; ③ 실패 표에 `configure-pages ▸ Not Found` 행을 두고 재실행(`workflow_dispatch`) 경로를 준다 | R (`worker/test/smoke.mjs` §profile-snapshot — **순서 판정**: 대기 표식이 워크플로 업로드보다 앞선다. 양성/음성 대조군으로 계측기 검증) |
| REQ-P2 | `pages.yml` 재작성은 최신 `sha` 와 함께, 한 번에 (#500) | 이미 있는 파일을 `sha` 없이 PUT 하면 409 고, 브라우저 편집과 API 덮어쓰기를 번갈아 하면 내용이 중복·병합돼 **YAML 파싱 자체가 실패**한다(`This workflow graph cannot be shown` — 워크플로가 실패한 게 아니라 읽히지도 않은 것). 계약: ① 재업로드는 `contents/... --jq .sha` 로 최신 sha 를 받아 `-f sha=` 로 넘긴다; ② 한 파일을 두 통로(브라우저 편집 / `gh api`)로 번갈아 건드리지 않는다; ③ 이미 깨졌으면 부분 수정하지 말고 **전체를 한 번에** 다시 쓴다 | R (`worker/test/smoke.mjs` — 재업로드 절차에 sha 가 살아 있다) |
| REQ-P3 | 원클릭 배포 — 버튼과 코치 도구가 같은 결정적 모듈을 탄다 (hype-dental D1–D3, D-017) | `src/publish/` 하나가 배포를 수행하고 진입점 둘(명령 `hypeproof-chat.publishSite`, MCP 도구 `mcp__hypeproof__publish_site`)이 그것만 부른다. 계약: ① 게이트 — `publishing.enabled === true && strategy === "per_user_github_pages"` 이고 미성년이 아닐 때만 버튼·도구가 보인다(`sitePublishAllowed`, 갤러리 게이트와 같은 방향·fail closed), 도구 grant 는 `sdk_tools.browser` 와 독립; ② 사전 검사 — Text inspection is bounded to 2MiB per file; larger or unreadable text blocks publication with a named-file explanation rather than silently bypassing checks (binary media retain the existing limits). 미리보기에선 되고 Pages 에선 깨지거나 새는 것(대소문자 불일치·`/` 로 시작하는 경로·제외 파일 참조·비밀값·주민등록번호·50MB 초과)은 **차단**, 미리보기에서도 깨진 것은 경고, 점(.)으로 시작하는 항목·`node_modules`·키 파일은 올리지 않는다; ③ 순서 — REQ-P1 그대로(Pages `workflow` 설정 → 읽어서 확인 → 워크플로가 든 커밋), 스킬의 YAML 을 글자 그대로, `git` 없이 Git Data API 로 **한 번의 스냅샷 커밋**; ④ R0 — 이번 실행의 nonce(`hps-build.txt`)가 실제 주소에서 보이고 첫 화면이 200 일 때만 `verified: true` 와 `url` 을 낸다. 시간이 모자라면 `ok: true, verified: false`(아직 만드는 중)이고 `check_only` 로 다시 본다; ⑤ `stage: "save"` 는 파일만 올리고 워크플로·Pages 를 건드리지 않는다(404 를 보는 수업 단계); ⑥ 공개 동의는 저장소별·세션당 한 번(모달, `requireApprovalFor` 로 끌 수 없음), `check_only` 는 묻지 않는다; ⑦ GitHub REST 호출은 모두 `gh api` 프로세스로 보낸다 — 토큰을 확장이 요청에 싣지 않는다. 평문 HTTP 경로는 테스트·개발 실행 + 루프백 주소의 모의 GitHub 에서만(그 경로는 토큰을 직접 보낸다) | U (`publish-site`·`publish-host`·`publish-integration` smoke: 모의 GitHub, 가짜 `gh` 로 `gh api` 계약) + 실계정(옵트인, `gh` 경로로 공개·재공개·이어하기 확인) |
| REQ-P4 | GitHub에서 이어하기 — 폴더마다 자기 저장소 (hype-dental D-024, 2026-10-13 사용자 요구) | 참여 코드를 넣어 후보 카드가 뜨면, REQ-P3 ① 게이트가 열리고 프로필이 수업 폴더(`workspace_root`)를 정한 코호트에 한해 이 자리 GitHub 에 올린 수업 사이트가 있는지 **먼저** 본다(`/user/repos` — 버튼이 만든 저장소의 설명, 또는 Pages + 루트 `agent.md`). 참가자는 GitHub 에서 직접 고치지 않는다는 전제다. 계약: ① 있으면 "GitHub에서 이어하기"(여러 개면 고르기, 가장 최근 것을 미리 선택)와 "새로 하기"를 낸다 — Primary 는 하나(SX-04); ② 이어하기는 REQ-P5 ②와 **같은 규칙**으로 고른 저장소의 폴더를 연다 — 그 저장소에 등록된 폴더, 없으면 `<수업 폴더>-<저장소>`. 이 컴퓨터에 없으면 참가자의 `gh` 로그인으로 `gh repo clone`(`core.autocrlf=false` 로 GitHub 과 같은 바이트, 실패하면 만든 폴더를 지운다), 있으면 GitHub 과 비교해 그대로 열거나 받아온다. 그 폴더는 그 저장소에 묶이고(등록 + 커밋) 다음 누름은 질문 없이 그 커밋 위에 올린다. 같은 저장소를 다시 골라도 새 폴더를 만들지 않는다. 창이 다시 열리면 시작 화면이 아니라 코치 대화가 열린다 — 폴더가 같은지는 경로 표기(Windows 드라이브 문자 `c:`/`C:`)와 무관하고, 업데이트 전에 `c:` 로 저장된 활동 연결도 그대로 찾는다. git 은 묻지 않는다(로그인 실패 시 비밀번호 창 없이 실패). 공개가 만드는 파일(`.github`·`.nojekyll`·`hps-build.txt`)은 탐색기에 보이지 않는다 — 파일은 그대로 있고 공개에서도 계속 제외된다; ③ 새로 하기는 새 폴더에서 시작한다. 이 컴퓨터에서 올린 적 없는 폴더의 첫 누름은 **새 저장소**(`<기본>`, `<기본>-2`…)를 만든다 — 다른 컴퓨터에서 만든 사이트에 쓰지 않는다. 명시한 `repo_name` 은 그대로; ④ gh 가 로그인돼 있지 않으면 볼 수 없으므로 조용한 "GitHub 로그인" 줄을 내고, 로그인 뒤 다시 본다. 확인 실패·15초 초과는 평소 시작으로 | U (`github-continue` smoke: 모의 GitHub, 두 컴퓨터, 시작 화면; `repo-checkout` smoke: 실제 git·로컬 원격으로 폴더 찾기·clone·열기·받아오기·백업·실패, `c:`/`C:` 동일성; `activity-legacy-drive` smoke: `c:` 로 저장된 연결의 업데이트 호환) + E (개발 중 앱 사본, Windows, 2026-10-17: 이어하기·프로젝트 변경이 `gh repo clone`) |
| REQ-P5 | 프로젝트 변경 — 수업 중 다른 GitHub 저장소로 수업 폴더 바꾸기 (2026-10-15 사용자 요구, #1691) | 채팅 머리줄의 **프로젝트 변경** 버튼("인터넷에 올리기" 옆, 같은 REQ-P3 ① 게이트) 또는 채팅 문장 `프로젝트 변경`(가까운 변형만 — 그 말을 언급만 하는 문장은 코치에게)이 참가자의 저장소 목록을 연다: 수업 사이트(REQ-P4 판별) 먼저, 그다음 자기 소유의 다른 저장소(포크·보관 제외). 계약: ① 떠나는 폴더가 GitHub 과 같으면 묻지 않는다. 다르면 "올리고 바꾸기 / 올리지 않고 바꾸기"를 묻고, 올리기는 버튼과 같은 공개(워크플로를 지키기 위해 저장 단계가 아니다). 올린 적 없는 폴더는 새 저장소로 올리거나 그대로 둔다; ② 고른 저장소의 폴더: 등록된 폴더, 없으면 `<수업 폴더>-<저장소>` — 수업 폴더는 서비스가 준 `workspace_root` 이지 지금 활동이 열린 폴더가 아니다(이름이 `<수업>-<a>-<b>` 로 이어 붙지 않는다). 같은 이름의 폴더가 다른 저장소의 clone 이면 건드리지 않고 다음 이름을 쓴다. 이 컴퓨터에 없으면 `gh repo clone`(REQ-P4 ②), 있으면 GitHub 과 비교해 같으면 그대로 연다. 이 컴퓨터가 마지막으로 올리거나 받은 뒤 GitHub 이 그대로면 로컬 작업이 더 새것이라 그대로 연다(git 기록만 GitHub 커밋으로 옮긴다). GitHub 이 움직였으면 받아온다 — 공개는 API 로 커밋하므로 `git pull` 이 아니라 fetch 후 브랜치를 GitHub 커밋으로 옮기고 파일을 GitHub 것으로(추적되지 않는 점(.) 항목은 그대로, 로컬이 달랐으면 `<폴더>.before-pull-<시각>` 사본 — `fs.cpSync` 는 한글 경로에서 Studio 런타임을 죽이므로 쓰지 않는다). clone 이 아닌 기존 폴더는 그 자리에서 clone 이 된다. 떠나는 폴더는 대상 폴더로 쓰지 않는다; ③ 그 폴더를 그 저장소에 묶고(등록 + 커밋) 시작 화면과 같은 방식으로 활동 작업 폴더로 연다(창이 다시 열리고 대화는 그 폴더의 것); ④ 그 폴더의 첫 코치 턴에 모델 전용 메모: `agent.md` 가 있으면 다른 일보다 먼저 읽는다 — 한 번, 그 폴더에서만, 24시간 안에 | U (로컬 `project-switch` smoke: 모의 GitHub — 문장 판별·목록·비교·결정표·받아오기, PR 미포함) + E (개발 중 앱 사본, 2026-10-15) |

REQ-P3 retry feedback: a failed or unverified button result appears as one managed inline
notice and remains in the transcript, including any repository link. Pressing the button
again clears that attempt's notice before asynchronous work starts; a newer unrelated
notice is preserved. Repeated clicks during a button attempt start no additional progress
or result. Device-code modals, public-publishing consent, and verified-success actions
retain their behavior. This supports participant verification under ST-INT-NATIVE.

## Q. 세션 로그 로컬 스풀 (#580 수집 계층)

토큰 비용과 유저 행동을 의사결정 데이터로 만드는 수집 계층이다. 설계 결정과
근거는 이슈 #580 의 "설계 확정 노트" 코멘트가 원본이다. 업로드 계층은 후속
PR — 이 도메인은 "각 PC 에 빠짐없이, 깨지지 않게 쌓인다"까지만 계약한다.

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-Q1 | 단일 `events.jsonl` 스풀 | 세션 디렉토리(`<app-data>/logs/sessions/<로컬 yyyy-mm-dd>/<session-uuid>/`)에 prompt · response · artifact_snapshot · usage · workflow · turn_end 가 **한 파일에 발생 순서대로** append 된다. 레코드마다 `schema_version` + ISO UTC `ts`. 파일 분할(원안의 3-파일)은 순서를 파일 경계에서 잃으므로 하지 않는다. prompt 는 20k 자, response/HTML snapshot 은 각 200k 자 캡 — 자르되 무성 절단은 금지: `*_truncated: true` + 원래 길이를 같이 남긴다. HTML 은 전체 바이트의 sha256·크기·출처를 기록하고 같은 해시는 세션 내 중복 저장하지 않는다. 전체 경로 대신 `basename`만 남긴다. workflow payload 의 문자열 값은 500자 캡(웹뷰발 자유 텍스트 방어) | U (`test/session-spool`) |
| REQ-Q2 | 세션 = 활성화 1회 × 신원 1개 | 세션 id 는 **첫 이벤트에서** UUID 로 생성된다(게으른 실체화 — 채팅 없는 창은 아무것도 남기지 않는다). 신원(토큰 payload `u`·`c`·`p`)이 이벤트 적재 후 바뀌면 새 세션으로 회전한다(같은 PC 다른 학생 — 활성화 1회에 세션 여러 개 가능). 신원 후착은 세션 유지 + meta 갱신(`started_at` 보존, 디스크 쓰기 성공 후에만 메모리 커밋 — win32 rename 일시 실패가 영구 불일치가 되지 않게). **모든 상태 전이는 순서 보존 큐 안에서** 일어나고, 턴 단위 이벤트(usage·turn_end)는 그 턴의 prompt 가 적힌 세션에 피닝된다 — 회전을 가로질러 도착해도 남의 세션에 적히지 않는다 | U (`test/session-spool` 인터리빙·피닝 대조군) |
| REQ-Q3 | usage 요청 단위 · 과대계상 금지 | 토큰 4종(input/output/cache read/cache write)이 요청 1건 = 레코드 1건. SDK 는 API 응답 1개를 여러 메시지로 쪼개며 같은 usage 를 복제하므로(#503 실측) `requestKey` dedupe 필수 — **SDK 경로에서 키(`message.id`/`request_id`) 없는 usage 는 기록하지 않는다**(비용은 부풀리는 쪽이 더 나쁜 실패; 전량 원장은 서버 D1 `usage_log`). proxy 경로는 호출당 정확히 1회 발화가 구조적이라 키 3단 폴백을 쓴다: 청크 `hps_request_id` → `x-request-id` 헤더 → `local-*` 생성 키(서버 조인 불가 표식). SDK result 의 턴 합계는 `turn_end.total_usage` 로 남아 요청 단위 합의 대조군이 된다. **알려진 캐비앗(2026-08-19 실기기 실측)**: SDK assistant usage 는 스트림 시작 스냅샷이라 요청 단위 레코드의 `output_tokens` 가 과소일 수 있다(실측 1 vs 실제 562 — input/cache 3종은 정확 일치). 턴의 output 정답은 `turn_end.total_usage`, 요청 단위 전량 원장은 서버 D1 — 실패 방향이 과소(부풀리기 아님)임을 대조군이 보증한다 | U (`test/session-spool` + `test/sdk-usage-extract` + `test/proxy-chat-usage`) |
| REQ-Q4 | 워커는 usage 를 스트림에 싣는다 | OpenAI 형 스트림 두 경로(Anthropic 합성 `transformStream` · Gemini/OpenAI `passThroughOpenAIStream`) 모두 [DONE] 직전에 `hps_usage`(4종 전량) + `hps_request_id` 청크를 낸다 — D1 기록과 **같은 accumulator** 라 두 기록은 정의상 일치. 스트리밍 200 응답에는 `x-request-id` 헤더도 직접 싣는다(raw Response 는 미들웨어 헤더를 우회한다 — 실측으로 발견된 갭). usage 미관측 스트림·mid-stream 실패는 0 값 청크를 지어내지 않는다(그 경우 D1 에만 남고 스풀엔 turn_end 사유가 남는다 — 의도된 비대칭). 구 클라이언트 파서는 이 청크를 무해하게 지나친다(OpenAI include_usage 형태) | R (`worker/test/sse-usage-chunk` + `worker/test/chat-integration`) |
| REQ-Q5 | 스풀은 제품을 죽이지 않는다 | 모든 record\* 는 동기 시그니처 + 내부 순서 보존 큐. 쓰기 실패(권한·디스크)는 삼키고 **활성화당 사유별 1회** console 경고 — 채팅 경로로 예외가 전파되지 않는다. 세션 디렉토리가 밑에서 사라지면(다른 창의 스윕 등) 되살려 1회 재시도한다. 스트림 중 끊김(worker `stream_error`)은 이제 조용히 지나가지 않고 `ProxyTransportError` 로 표면화된다 — 학생에게 재시도 배너, 스풀에 turn_end(error) | U (`test/session-spool` + `test/proxy-chat-usage`) |
| REQ-Q6 | 총량 캡 보존 정책 | 업로드 여부와 무관하게 스풀 총량 캡(200MB) 초과 시 오래된 세션부터 삭제. 보호 대상: 자기 세션 + **당일 날짜 디렉토리 전체**(멀티윈도우의 남의 활성 세션 보호). 빈 날짜 디렉토리 정리. activate 시 fire-and-forget, 큐 경유라 실체화와 경합하지 않는다 | U (`test/session-spool`) |
| REQ-Q7 | 런타임 정직 표기 (no silent caps) | prompt 레코드는 턴이 향한 런타임을, turn_end 는 **실제로 돈** 런타임을 남긴다(SDK→proxy 폴백 반영 + `sdk_fallback` workflow 이벤트). usage 없는 턴의 비율과 원인이 데이터에서 정량으로 드러나야 한다. 실패 턴의 turn_end 에는 `error_kind` 분류값(`auth:missing`·`auth:session_inactive`·`transport`·`stall` 등 — 에러 원문 산문은 절대 기록하지 않는다)이 붙는다(첫 실기기 검증에서 걸린 공백). 테스트 런은 스풀을 만들지 않는다 — 게이트는 `HPS_TEST_E2E` env **와 `hps-test-state.json` 존재의 OR**(env 전파는 신뢰 불가 — REQ-A7 파일 백도어가 존재하는 이유; 오염에 필요한 토큰이 어느 채널로 오든 게이트에 걸린다). F5 개발 호스트는 meta 에 `dev: true` 로 표식된다 | E (기록 경로는 provider 안 — 후속 e2e 로 고정, 이 PR 은 코드 리뷰로만 확인) |
| REQ-Q8 | 행동 이벤트 스키마는 #552 와 단일 | 웹뷰 trace 4종(trialStart/trialEnd/validationRun/humanAction)은 vscode-free 매퍼 `traceMsgToWorkflowRecord` 를 거쳐 스풀 `workflow` 레코드로 남는다(spool-then-forward — 워커 전송은 후속에 이 스풀을 읽는다). 필드명 정합은 워커 필드명 리터럴을 박은 드리프트 락 테스트가 고정한다. 스풀 turn_id(streamId)는 워커 trace 의 UUID 검증을 통과하도록 UUID 다. 호스트발 이벤트: `preview_reveal`(모든 reveal 경로 — 구조 가드에 막힌 reveal 은 기록하지 않는다), `sdk_fallback`. 실제로 표시된 AI 응답은 turn_end 직전에 status와 함께 response로, 구조 가드를 통과해 표시된 HTML은 artifact_snapshot으로 남긴다. 사전완성본·응답 코드·도구 저장·수동 미리보기·종료본을 source로 구분해, AI가 만든 것을 아이 행동으로 오인하지 않는다 | U (`test/session-spool`, `test/trace-workflow-map`) |
| REQ-Q9 | 업로드는 명시 트리거만 (#596) | 커맨드 팔레트("HypeProof: 오늘 활동 기록 보내기") · **세션 종료 감지 배너**(proxy 런타임의 `session_window`, 활성화당 1회) · **기동 시 잔여분 배너**(미업로드 세션 발견 시 — agent-sdk 런타임은 session_window 를 못 보므로 이 경로가 주력) — 어느 쪽이든 버튼 클릭 없이는 어떤 업로드도 발생하지 않는다. 트리거 시 현재 작업 폴더의 실제 `index.html`을 `session_end` snapshot으로 기록한 뒤 세션을 **봉인(seal)** 하고 올린다 — 마지막 응답 뒤 직접 편집도 보존한다. 봉인 없이 "활성 세션 제외"만 있으면 1일차 수업 끝에 오늘 데이터가 하나도 안 올라간다(1회차 리뷰 F1). 재진입 락으로 이중 실행 방지. 프로필 확인 실패(네트워크)와 opt-in 미설정은 **다른 문구**로 구분한다(꺼져 있다는 오보 금지) | E (트리거는 vscode 계층; 업로더 코어는 U) |
| REQ-Q10 | 서버 업로드 게이트 (#596) | `PUT /v1/logs/<sessionId>/<filename>?day=` — **active-session 게이트 의도적 부재**(업로드는 수업 종료 후가 정상 경로; 토큰 만료가 시간 창을 대신함). opt-in `analytics.upload_session_logs` fail-closed(`upload_disabled` 403 — validate.py 가 아동 코호트의 이 플래그를 HARD FAIL 로 막고, `analytics.child_upload_consent` 주장 기록이 있을 때만 WARN 으로 내린다. 켜진 코호트 목록과 업로드 내용 고지는 `docs/session-log-consent.ko.md` §1·§3 이 갖는다), roster·revocation·rate limit(60/60s)·파일명 allowlist 3종(**own-property 조회 필수** — `__proto__` 류 프로토타입 키가 allowlist 와 크기 캡을 동시에 뚫는 것을 리뷰가 실증)·파일별 크기 캡(events 64MB — 낮으면 큰 세션이 영영 못 올라가는 무음 유실)·day 시맨틱 검증·sessionId 소문자 정규화. `/v1/logs/*` 는 signingSecretGuard 뒤에 마운트. **R2 키(`studio-logs/<c>/<u>/<day>/<sid>/<file>`)의 신원 프리픽스는 검증된 토큰에서 서버가 조립** — 경로 위조 불가 | R (`worker/test/logs-upload`) |
| REQ-Q11 | manifest-last 완결 · 멱등 재시도 (#596) | 업로더는 meta → events → **manifest(sha256 목록) 마지막** 순서이고, manifest 해시는 **업로드한 그 버퍼**에서 계산한다(파일 재읽기 금지 — 사이에 다른 프로세스가 append 하면 거짓 완결). 다른 창의 활성 세션은 **정지 게이트**(events mtime 5분)가 보호하고, 이 인스턴스가 봉인한 세션만 면제. 마커 있는 세션에 새 이벤트가 오면 스풀이 **마커를 무효화**해 재업로드 대상으로 되돌린다(꼬리 유실 방지). 중간 실패 시 manifest 미전송 = 미완결 → 다음 트리거 전체 재시도(멱등). 네트워크·fs 예외 모두 구조화 실패로 반환(throw 전파 없음), events 소실 시 빈 manifest 로 완결을 주장하지 않는다. manifest 의 sha256 은 서버가 검증하지 않는다 — 완결은 클라 자기증명, 바이트 대조는 소비 계층 몫 | U (`test/spool-uploader`) |
| REQ-Q12 | 업로드 성공 세션의 로컬 정리 (#596, #580 AC6) | `uploaded.json` 마커 세션은 3일 뒤 스윕이 캡과 무관하게 삭제(R2 완결본 존재). **미업로드 세션은 총량 캡 전까지 절대 삭제하지 않는다** | U (`test/session-spool`) |

## Chalk authoring API (Service slice)

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-STUDIO-AUTHORING-API | 강사 소유 초안 및 불변 버전 저장 | 타 강사·코호트·프로필 접근 차단, revision 충돌 검출, 중복 재시도 안전, 버전 원문 보존. 수업 활성화 없음. | R — in-process Service/SQLite and local D1 |

[Contract](adr/0004-chalk-authoring-storage.md) · [Execution scope](testing/chalk-authoring.md).

## Persona-led course authoring tooling

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-STUDIO-DENTAL-AUTHORING | 레벨별 치과 홈페이지 강의 5개 생성·검증·초안 저장 | 각 레벨의 페르소나·목표·실습·독립 과제·증거를 원본에서 생성. Service 스키마 재사용. 실제 authoring 라우트 저장/재열기 확인, 재실행·중단 재개 시 기존 초안 보호. 학습 성공·수업 활성화 자동 선언 없음. | Module data + authoring tooling; R/U |

[Source and execution](curriculum/dental-ownership/README.md) · `worker/test/dental-course-automation.test.mjs`.

## Dental reference exercise evidence

| ID | 요구사항 | 수용 기준 | Layer |
|---|---|---|---|
| REQ-STUDIO-DENTAL-REFERENCE | L1~L5 예제 결과물의 브라우저·운영 연습 근거 | 정상/오류 시안, 콘텐츠 변경·원본 복귀, HTTP 버전·링크 오류·복구, 채용 페이지, 백업 무결성·복원 검사를 실제 실행한다. Studio 학생 실행·공개 배포·학습 성과와 명확히 구분한다. | browser reference fixture, not App E2E |

[Runbook](curriculum/dental-ownership/reference/README.md) · `e2e/dental-reference/run.mjs`.

## Chalk authoring surface

| ID | Requirement | Acceptance | Layer |
|---|---|---|---|
| REQ-STUDIO-CHALK-AUTHORING-UI | Instructor can import and edit course drafts, save/reopen and view frozen versions | Preserve edits on 401/403/409; no token in URLs/storage/export; support request draft is explicitly unsubmitted | Surface; `e2e/chalk-authoring/run.mjs` |

REQ-A8 fixture isolation: both the environment flag and the existing user-data test-state file keep an explicitly opened practice folder. The activation verdict is shared with spool suppression and passed through onboarding and token changes (#713). Normal cohort switching remains unchanged.

## Preview viewport inspection

| ID | Requirement | Acceptance | Layer |
|---|---|---|---|
| REQ-STUDIO-PREVIEW-WIDTH | Manually inspect local HTML at 390px or 1280px | Command opens the active local preview in a width-controlled iframe with two buttons and an original-page link; reports the actual child innerWidth. Missing/nonlocal preview gives guidance | App, real Electron |

시작 화면 #723: `test/start-page.smoke.mjs`는 host 인증 오류/연결 보존/해제를, `e2e/start-page/run.mjs`는 빌드된 화면의 상태 전이와 390/768/1280px를 검증한다. 실제 Mac 관측은 `e2e/start-page/README.md` 참조.

### HP shell defaults (#725)

The built-in extension contributes the HypeProof Studio dark theme: forest `#151D19`,
ivory `#F2F4E8`, proof lime `#D5F279`. Title bar, editor, sidebar, inputs, focus and
selection use the same palette as the start page. Configuration defaults hide the
activity rail, command center, layout controls, file tab icons and status bar;
explicit user settings override these defaults. No global user settings are rewritten.

Start-page “파일” opens Explorer and “설정” opens the native settings editor. Course
entry keeps the HP canvas behind chat. The four upstream editor watermarks are
replaced by an HP SVG before Mac signing / Windows compilation. A missing expected
asset fails before any replacement. Standard file controls, tab-close affordances,
menus and shortcuts remain available; this is not removal of all editor functionality.

Tests: `test/shell-brand.smoke.mjs`, `test/start-page.smoke.mjs`, `e2e/start-page/run.mjs`,
`e2e/tests/27-hp-shell.spec.ts`. Screens: `e2e/start-page/hp-shell-evidence/`.

### Automated Mac credential isolation (#728)

Temporary Electron test profiles use `--use-inmemory-secretstorage`. A distinct
user-data-dir and `--password-store=basic` alone do not prevent macOS safeStorage
from accessing the shared app keychain item. The memory-only switch short-circuits
OS encryption initialization; it is limited to test/preview launchers. Production
SecretStorage remains encrypted and release signing remains certificate-based.
Existing ad-hoc app keychain grants may require one normal macOS approval when
migrating to the certificate-signed app; the application cannot grant that itself.
No login password, keychain deletion or ACL widening is part of the fix.

Playwright output is kept under `test-results/playwright` so normal runs do not
remove separately collected observation bundles in `test-results/`.


## Classroom administration extension

[강사·관리자 요구사항](requirements/classroom-admin.md)은 ADM-01~14와 별도 선택적 공유 계약을 정의한다.
[디자인 기준](requirements/classroom-design.md), [인수 테스트](testing/classroom-admin.md)를 함께 따른다.
기존 metadata board와 operator-only 로그 조회 권한을 확대하지 않는다. 개별 구현 범위는 해당 문서의 상태표를 따른다.

## Chalk lesson delivery

| ID | Behavior | Acceptance / evidence |
|---|---|---|
| REQ-STUDIO-LESSON | Display the Service-resolved immutable lesson in the start page and chat; insert the selected task and acceptance criteria into the editable composer only on user action. | `worker/test/authoring.test.mjs`, `e2e/chalk-authoring/run.mjs`, `e2e/lesson-studio/mac.mjs`. No automatic task execution or policy grant. Legacy credentials show the existing profile. |
| REQ-STUDIO-LESSON-NAME | A frozen lesson may carry a fixed AI display name (`assistant.display_name`); the Service projects it onto `ux.coach` so the start page, chat header and message labels show it for seats delivered from that version. | REQ-F7 · [ADR-0005](adr/0005-lesson-assistant-identity.md) · `worker/test/authoring.test.mjs` (AE-07/08 checks), `chalk/test/authoring-ui.test.mjs`. Draft edits after freezing do not change delivered seats. Real-screen acceptance is the Codex feature A record. |
| REQ-STUDIO-LESSON-STEP | The current step of the served lesson changes the NEXT turn (#751 G2, #1008 · EDU-02). The rail draws the step's help choices (`steps[].help`, lesson default pre-selected, labels only) and its work surface (`steps[].ui`: `criterion_form` / `decision_form`; any other valid kind is drawn as "not available in this Studio", never faked). Both runtimes send `x-hps-lesson-step` for the step on screen and `x-hps-help-mode` only for a mode that step offers, captured once at turn start (a running turn keeps its snapshot; a focus made under another lesson is not carried after a switch). The learner's saved criterion/decision travels, labelled as their own words, with the next turn of that step. Help is teaching strategy only: tool grants still come from the served profile. | U (`extensions/hypeproof-chat/test/lesson-focus.smoke.mjs`), Service (`worker/test/lesson-help-mode.test.mjs`, `worker/test/authoring-rehearsal.test.mjs`), browser (`e2e/classroom/authoring-g2.mjs`), actual Mac (`e2e/classroom/mac-curriculum.mjs`). A real model's teaching quality is NOT RUN. |
| REQ-STUDIO-LESSON-GOAL | The learner's own goal is kept beside the lesson's criteria (AE-01, [#554](https://github.com/jayleekr/hypeproof-studio/issues/554)). On a seat with a served lesson, region A draws the learner's saved goal under the lesson's own conditions, at most two lines (read whole in the rail), fixed with the header: wholly on screen at 1280×800, also with the result beside the chat and the conversation scrolled to its end; on a short window the header packs and the goal follows the completion conditions, inside the header's own scroll when the header is full. The rail right under region A holds the goal sentence and up to five personal completion criteria, closed by default (closed, it adds no field to the screen) and edited in place with quiet controls (region A keeps the screen's one Primary). The host stores them on this device (VS Code `workspaceState` key `hps.studentGoal`) per lesson revision (sha256) and activity and answers every chat view; every config (mount, reload, reopen, and one that arrives after the chat view was drawn, e.g. once the Service answers) starts from that record, so the same goal stays on screen while the learner moves between the conversation and the result beside it and after a reconnect. The editor's fields follow every stored change, another chat view's included, except text the learner typed and has not saved: another chat view's save keeps it, the editor says the goal was changed on another screen, and the save made after that starts from the newer goal. Region A keeps drawing the lesson's own criteria (step acceptance, week completion conditions) from the frozen lesson; the save message cannot carry or change them. Another lesson's, revision's or activity's goal is never restored; a save sent from an older revision (sent before another chat view's save reached this view) is refused; only the view that saved says "저장했어요." or why not, and a refusal changes no screen's goal or typed text. Opening or saving the goal records no learning event, step move, class-board event or completion. Nothing is sent to the Service, and nothing is added to model requests. | U (`extensions/hypeproof-chat/test/student-goal.smoke.mjs`: the rules, the real host handler and config path, the rendered chat screen, each with planted-defect controls), browser (`e2e/sx/goal-browser.mjs`, CI `start-page`: the built webview over time — a lesson that arrives after the chat view was drawn, save answers, another view's save reaching typed text, a refusal, another lesson), actual Mac App (`e2e/sx/goal-app.spec.ts`: save, change, the short window, the result open beside the chat, the conversation scrolled, a reopen, a second chat view, clearing, text typed in one view while the other saves). A real student and Windows are NOT RUN. |
| REQ-STUDIO-REHEARSAL | A learner code issued for an instructor's rehearsal (`rehearsal` claim, Service record) shows a rehearsal line in the rail; "리허설 결과 보내기" sends what the panel actually DREW per step plus the App identity. The Service judges it once against the candidate and its own records of requests made with that code; sending before any request is refused as "not executed", not judged. The report also carries the mission header as read back from the rendered DOM (week line, mission sentence, completion texts); a candidate with a mission passes only when it matches word for word (`mission_mismatch` / `mission_not_reported` otherwise), a candidate without one makes no mission claim (#751 G2 mission). | Same as above; contract in [chalk-authoring G2](requirements/chalk-authoring.md#g2-curriculum-runtime-20260922). |

## Service-gated seminar surface (hype-dental, 2026-10)

Three per-cohort switches the 2026-10-17 dental seminar turns on through `/v1/profile`. A cohort that does not set a field behaves as before.

| ID | Behavior | Acceptance / evidence |
|---|---|---|
| REQ-STUDIO-CLASSROOM-PANELS | The learner rail's two classroom-operation panels (#751: "강사에게 도움 요청", "수업 결과물 승인") follow the Service per cohort (`classroom_panels.help_request` / `artifact_approval` on `/v1/profile`, hype-dental D-025). Only an explicit `false` hides a panel; absent keeps both, so every cohort served before the field looks the same. Instructor mode never draws them. | U (`classroom-panels` smoke: absent → both drawn, off → neither) + E (app copy, during development) |
| REQ-STUDIO-TOOL-ACTIVITY | How much of the SDK coach's tool work the timeline draws follows the Service per cohort (`tool_activity` on `/v1/profile`, hype-dental D-027). `"summary"`: one live Korean line per stretch of work (e.g. "홈페이지를 고치는 중…", "화면을 확인하는 중…"), changed in place and hidden when the stretch ends; no tool names or inputs, no thinking text, no line for a failed call the coach retries, and the preview line shows only while it opens. Absent or any other value keeps one line per call (#414). Observation and the spool record the same either way; whether a turn wrote anything is still told only by a successful write (R0). | U (mode, phrases for the rehearsal's own calls, the line's in-place/hidden/new-id behaviour, provider wiring) + E (class rehearsal, 1017). Unit: `tool-activity` smoke |
| REQ-STUDIO-CHAT-PHOTO-FILES | Where the Service turns on `input.image_files` (hype-dental D-028), a photo dropped or pasted into the chat is kept as a file, not shown to the model. A photo dropped from Finder (VS Code opens it as a tab, #384) comes in the same way after one 붙이기 prompt and its tab closes; a photo already in the class folder being opened is not an attachment. The host holds the original bytes in a staging folder of its own until the message is sent, then moves them into the workspace's `images/` under the participant's file name (NFC, never overwriting: `외관-2.jpg`) and appends an `[첨부한 사진]` list of the paths to the model input, the saved history and the sent bubble. A photo removed before sending is deleted at once; photos never sent are deleted with the window, and a crashed window's folder on the next start (a live window's folder is left alone). Ready photos alone can be sent with Send or Enter after the host acknowledges staging; unavailable/locked/busy states still prevent sending. The canonical images directory must stay inside the workspace; directory links/junctions are rejected without writing outside it. Limits: 10 photos, 25 MB each, photo types only (HEIC by name). The coach opens a photo only when asked to copy its look (Service `_attached-images-contract.md`). Absent → drop and paste behave as before (`image_paste` or nothing). | U (names, dedupe, refusal, staging lifecycle incl. live-window guard) + E (studio-dev app, real model: chat drop, Finder/tab path, ×, close, insert without opening, copy-the-look opens) verified locally during development. Unit: `attached-images` smoke; browser: `npm --prefix e2e run test:photo-only-send` |

## Native Studio trial (#744)

표시 이름은 **Studio · 내 삶에 AI 더하기**이며 업무·여행·취미·공부 등 사용자가
선택한 일상의 과제를 다룬다. NAT-01의 프로필과 기존 개인 권한을 유지한다.

[Product Intent](PRODUCT-INTENT.md)의 실제 과제 수행·판단 가시성·최소 개입 원칙을
[NAT-03의 대화 분기](requirements/studio-native-trial.md#764에서-파생한-행동-계약)로 구현한다.
명확한 요청은 즉시 진행하고, 정보가 부족할 때 필요한 질문 하나만 한다. 질문·성찰의
건너뛰기, 위임과 권한의 분리, 제안과 인간 판단의 구별은 NAT-02~09/11을 함께 따른다.
상위 REQ-STUDIO-CHAT을 확장하는 계약이며 별도 진단 상태 저장소를 요구하지 않는다.
검증은 [T04 분기 및 T07/09/16/18](testing/studio-native-trial-validation.md#t04-product-intent-분기),
사람 학습 효과는 T25로 분리한다. #764의 프롬프트 변경만으로 전체 PASS를 주장하지 않는다.

| ID | Acceptance criteria | Implementation / verification |
|---|---|---|
| REQ-STUDIO-NATIVE-EVENTS | Host roles, task/session/program IDs and actual tool decisions survive replay; missing records are explicit and cannot be assessed. | nativeObservationRecorder.ts; worker/test/native-observation.test.mjs |
| REQ-STUDIO-NATIVE-OBSERVATION | Seven provisional observations cite exact source events, retain unobserved assets and distinguish help; no numeric score or unsupported independence. | worker/src/routes/observations.ts; NativeObservationPanel.tsx; native-trial-live.spec.ts |
| REQ-STUDIO-NATIVE-LIFETIME | Existing issuer flow grants a fixed individual window, attempt allowance and atomic concurrency; reissue cannot reset them. | native-trial-grants.ts; native-trial-grants.test.mjs; native-trial-d1.test.mjs |

[NAT-01–12](requirements/studio-native-trial.md) define the product scope; [T01–25](testing/studio-native-trial-validation.md) define acceptance tests.
[Executed laptop evidence](testing/studio-native-trial-results-2026-09-08.md) records real App/API results separately from synthetic and human validation.

### Trial choice disclosure (TUX-SP-12, interim)

`REQ-STUDIO-TRIAL-CARD-DISCLOSURE`: until open entry ships, the start page says under the
"AI 체험하기" choice, before it is chosen, that an issued code is needed today, plus the
allowance the Service advertises. The allowance is never hard-coded: Studio reads
`GET /v1/trial/offer` (`{ entry: "code" | "open", duration_hours?, request_limit? }`) once per
window without a credential, so the read cannot start a trial clock. No answer (the Service
does not serve the route yet, offline, malformed) → the code sentence only, no numbers.
This build implements only code entry, so it keeps the code sentence even for `entry: "open"`: hiding it would
contradict the code screen the choice leads to. The change that ships the open-entry path removes it in the same build. Addresses trial diagnosis A6/H-02 and U3.
The Service route is a separate change; until it ships the card shows the code sentence only.
Product Intent: "the user understands, before running, what is included and who pays"
([PRODUCT-INTENT.md](PRODUCT-INTENT.md) §후보 모델과 이용 권한에 대한 Intent); assets: none trained, it is an access disclosure.
Verification: `test/trial-offer.smoke.mjs` (parse, note, fetch, host) and `e2e/start-page/run.mjs`
(offer off positive, allowance from state, offer open keeps the code line and the next screen agrees).

## Conversation presentation (#758)

Product Intent의 Human judgment stays visible와 Useful work first를 화면에 연결한다.
시작 후에는 연결 캔버스를 넓은 대화로 전환하고 실제 결과물을 옆에서 확인한다.
응답의 Markdown은 안전한 React 요소로 렌더링하고 코드 원문·실제 도구 기록을 유지한다.
응답 대기가 끝났다는 이유만으로 파일을 고쳤다고 표시하지 않는다.

REQ-M27의 활동 원문 보존은 유지하되 기본 표시를 조정한다. 영어 처리 원문은 접힌
‘응답 준비’ 아래에서 열 수 있고, 실제 도구 이름·대상·성공/실패는 그대로 보인다.
완료된 합성 대기 줄은 화면에서 숨기며 저장된 타임라인을 지우지 않는다. 별도 인증이나
관찰 경로를 만들지 않는다. 검증은 TUX-SP-03, TUX-CHAT-15/16과 실제 Mac 실행 기록이다.

## Candidate draft build contract (#1758)

| ID | Requirement | Verification |
|---|---|---|
| REQ-STUDIO-CANDIDATE-DRAFT | Both release-cut builders receive the exact candidate SHA and refuse checkout, workflow-ref or publication-tag drift. Managed candidates require the same reviewed contract sources before any remote mutation. | `scripts/release/test/build-contract.test.mjs`: advancing-main and unsupported-candidate controls |
| REQ-STUDIO-CANDIDATE-DRAFT-VERSION | A managed RC tag permanently binds its source, publication identity and final embedded App/extension version. Missing or false dispatch inputs cannot turn that managed tag into legacy automatic acceptance; malformed/partial markers fail closed. Ordinary branch builds retain extension-version fallback and ordinary release tags retain tag-version behavior. | Managed push/retry, legacy branch/tag, malformed marker and environment-injection controls |
| REQ-STUDIO-CANDIDATE-DRAFT-STOP | Managed builds stop at immutable draft upload with a per-platform inventory of exact package names, sizes and SHA256 digests, including Windows portable and both installers. Changed package bytes, moved tag objects, published releases and overwrite attempts are refused. The inventory is not installed-App or black-box PASS, manager approval or publication authority. | Package inventory, moved-tag and executed upload-script fixtures; actual OS builds/install/update and model-budget validation remain NOT_RUN |

Design, invocation and evidence boundaries: [managed candidate drafts](dev/06-release-process.md#managed-candidate-drafts-1758).
This delivery contract supports the existing Product Intent's visible human judgment and
evidence boundaries; it does not claim a measured learner capability outcome.

## Personal trial interaction coverage (#758)

| ID | Requirement | Verification |
|---|---|---|
| REQ-STUDIO-NATIVE-UX | [TUX controls](requirements/studio-native-trial-ux.md) define observable outcomes for trial entry, coaching, observations, updates and recovery. Preserve work on cancel; confirm conversation deletion; isolate observation state on identity changes; recover the actual chat tree after a render error. | [UI and host test matrix](testing/studio-native-trial-ux.md); built React browser suite, host tests and applicable actual Electron reruns |

체험 대화 후속 계획: [CU/GHX 요구사항과 #844 에픽](design/trial-conversation-experience.md). 전체 UI·GitHub 연결 구현을 의미하지 않으며 [실행/미실행](testing/trial-conversation-experience.md)을 구분한다.

## 체험·수업 공통 진입과 전환 (#915)

[INT-US-01~04](design/unified-studio-experience.md)의 연속성과 책임 경계를
[US-01~18](requirements/unified-studio-experience.md) 및 [US-T01~21](testing/unified-studio-experience.md)로 추적한다.
활동 선택만으로 작업을 시작하지 않으며, 새 연결의 준비가 실패하면 기존 연결을 유지한다.
요청 접수부터 인증·응답·기록 저장까지 전환과 이용권 선택을 막는 경계는 US-07/08/11의
구현 일부다. 사용자가 작업의 대상과 비용 출처를 구분할 수 있어야 한다는 계약이며,
책임 인식의 학습 효과를 입증한 것은 아니다. [후보·접수 대조 결과](testing/activity-candidate-917-evidence.md)는
창 간 격리와 전체 공개 인수를 포함하지 않는다. 개별 US 행의 원본은 위 요구사항 표다.


활동별 창/자격·대화·초안/첨부 저장과 실제 폴더 전환의 구현·실기 범위는
[후속 실행 기록](testing/unified-completion-917-919-evidence.md)에 남긴다. AI/도구가
실패했을 때 파일 저장을 관측하지 않았다면 저장 완료라고 안내하지 않는다 (#968).
배포·이행은 [공통 릴리스 절차](dev/unified-release-and-migration.md)를 따르며
양쪽 활동 검사 누락을 한쪽의 성공으로 보충하지 않는다.

`REQ-STUDIO-ACCEPTANCE-SDK-SEED` (jayleekr/hypeprooflab#997): acceptance that drives a
packaged App (`e2e/unified-release/run.mjs`, called by `verify-service-activities.yml`
and `verify-unified-release.yml`) first seeds the native Agent SDK binary at the version
the App vendors, the same per-machine step the installers perform. It refuses to start
(BLOCKED) when that seed is absent or would not be trusted by the App. Without it a native
trial turn falls back to the proxy runtime, the Service answers `409 trial_requires_sdk`
before any model call, and the check fails on UI timing without naming the cause.
Verification: `e2e/unified-release/sdk-seed.test.mjs` (fresh-runner negative, seeded
positive, stale/truncated/unmarked/other-version seeds rejected). The macOS and Windows
acceptance runs are recorded per run, not by this control.

## Local task review (#1020)

`REQ-STUDIO-LOCAL-REVIEW`: [Explicit local task review](requirements/local-task-review.md) connects selected Claude/Codex message evidence to private file storage, the six-capability card, human review revisions and an independently verified local submission receipt. Captured replay, automated installed-shell tests, public release and Jay acceptance remain distinct.

### Local session observation (#1049)

REQ-STUDIO-LOCAL-REVIEW now includes on-demand project-scoped recent-session
selection, bounded streaming snapshots, model-condition observations, same-task
snapshot revisions, source-linked manual interpretation, and persisted next-task
improvement/follow-up. See `docs/requirements/local-task-review.md` for limits and
acceptance. No automated semantic scoring, live capture or research validity claim.

## Automatic host session sync (#1049)

REQ-SS1: The standalone measurement package automatically queues project-scoped
Codex/Claude visible-message snapshots to the member server after one connection.
REQ-SS2: Offline retries, exact server receipts, authorized download/cursor recovery
and a restartable local supervisor preserve evidence without requiring the Studio UI.
REQ-SS3: Transfer remains unreviewed evidence, separate from manual app reviews,
legacy-seven records, task outcomes and research validity.
REQ-SS4: Both host tools can read server workbench results with the existing
connection, preserving review/hold states without submitting reviews. Specific
server deletion responses prevent recapture and unblock download races across restart.
REQ-SS5: Known-secret redaction (MC-30) also removes a pasted Lab measurement
connection token (`hps_sync_` + 43 base64url characters), bare or after `Bearer`,
before local storage and upload (package 0.3.4, #1377; MC-T18 in
`worker/test/measurement-core-local-record.test.mjs`). Installation is mandatory
for every member since 2026-10-01; scope, purpose, score display and read access are
owned by [measurement-core §멤버 설치 의무](requirements/measurement-core.md#멤버-설치-의무--2026-10-01-결정).

Contract: [SS-01–10](requirements/session-sync.md). Validation:
`packages/measurement/test/sync.test.mjs`; production acceptance and installed
supervisor observation must be recorded separately.


## Remote classroom operations proposal — 2026-09-18

The [existing classroom ADM contract](requirements/classroom-admin.md#원격-수업-운영-확장-설계--2026-09-18)
extends token activation, run-scoped progress, bounded remote commands, preserving
runtime reset, evidence collection and report delivery. It reuses ADM-01–14;
[AT-15–34](testing/classroom-admin.md#remote-classroom-tests) are NOT RUN.
App host code owns local observations and allowlisted actions; Chalk displays
and forwards; Service owns authority and durable command/job receipts. Preserve
REQ-A/B onboarding, REQ-Q spool ownership/retention and existing activity/runtime
boundaries. Remote reset must not call clearHistory or erase learner files.
Automatic collection requires the new explicit consent/grant contract; this
proposal does not relax existing manual-upload or operator-only log access.
New reports follow MC-17/19; legacy HAIN7 stays a separate versioned adapter.
Implementation phases and rollback are in [E5](plan/learning-agent-experience-epics.md#remote-classroom-delivery).

### Targeted distribution of notices and materials (U2) — implemented 2026-09-21, off by default

Implemented behind the per-run switch `ops_distribute` (default OFF); no REQ row is claimed. What was run and what was NOT RUN
is in the [AT-44 run record](testing/classroom-admin.md#remote-management-u2-run-20260921).
The contract lives in the [classroom ADM document](requirements/classroom-admin.md#remote-management-u2-20260921).
The Studio behavior it adds is bounded as follows. The App host owns a
durable per-learner, per-class-run inbox under extension global storage; it never writes
to the learner's workspace, conversation, input draft or spool (REQ-Q ownership unchanged).
An item is stored only after its hash is verified, as an immutable per-revision file followed
by one atomic index commit, so an interrupted update never costs the learner the material they
already had; a file that was received but not committed is never promoted on restart without a
fresh sync response. "Applied" means the host re-read the committed item
through the same disk path the card list uses — a sync HTTP 200, a notification or a
webview `postMessage` is not completion, and opening a card is not reported. The card is a
closed-by-default `<details>` in the coach rail of the work screen and a quiet line on the
"이어서 하기" entry card: no modal, no second Primary (SX-04), nothing in the message stream,
canvas or evidence drawer (SX-05/06/13). Text is rendered as text; links open only on a
learner click through the existing https-guarded `openExternal` path. A late response or
webview callback from an ended connection generation changes nothing.
Without a valid connection the list stays readable and says "수업 연결 확인 전"; it says "끝난 수업의 자료"
only on a normal expiry or once the run's own end time has passed — a missing connection (an app restart in a
running class) is not evidence that the class ended.

### Targeted distribution of lesson prompts and lesson settings (U3) — implemented, locally run, not accepted, default OFF, 2026-09-21

Implemented on `feat/751-u3-prompt-settings` and run locally (unit, Service, local workerd D1, browser, a real
Studio window on a Mac with a scripted model provider): see the
[run record](testing/classroom-admin.md#remote-management-u3-run-20260921). Not accepted, not deployed, OFF by default
(`HPS_LESSON_BINDINGS` unset and the per-run `ops_lesson_settings` flag false); no REQ row is claimed until acceptance.
Found only on the real window and fixed: a profile cached before enforcement began made the host send no binding key,
never switch and never close a turn — the preflight now re-reads the profile once when the device's own inbox holds a
lesson setting. "Applied" on the instructor screen is request-level evidence (one provider request under the binding
ended protocol-complete), not "the learner's question succeeded".
An independent review at `d32a191` then found, on the real window, that neither Studio window drew the inbox although the
board said "reflected": windows of one app share `globalState` and the inbox directory, and the window whose connection a
second window's pairing had replaced marked the shared pointer hidden. The pointer now names its connection, only that
connection may hide it, a live connection is authoritative, and a window re-reads the shared inbox on focus (a read — no
new "opened" tracking). The switch request now carries the learner's token for the Service to verify (the device's own
statement of its base lesson decides nothing); a parked message that goes out when a turn ends carries no prompt
provenance and no longer empties the draft typed meanwhile; a turn is looked up and closed where it was admitted.
See the [review record](testing/classroom-admin.md#remote-management-u3-review-20260921). A further review at `e7d719a` changed only the Service:
the lesson basis of a collected input is established by joining each permitted request to its own usage row (no counting) —
no Studio behavior changed ([record](testing/classroom-admin.md#remote-management-u3-basis-identity-20260921)).
The contract lives in the [classroom ADM document](requirements/classroom-admin.md#remote-management-u3-20260921);
its first draft was revised the same day after an independent review (turn pinning, fallback under
outage/off, execution evidence, mixed-basis reports). The Studio behavior it adds is bounded as follows. **Prompt:** an instructor prompt is an inbox card; only the learner's own press of
`초안에 가져오기` changes the input draft, as one functional update inside the webview that appends to
the latest draft and never replaces it, touches no attachment or queued send, sends nothing and calls
no model. Undo restores the previous draft only while the text is byte-identical to the just-imported
state. Withdrawal removes the card body and never the learner's draft, conversation or files.
Importing and sending are not reported to the instructor; the only provenance is a bodiless reference
kept with the local draft and, when the learner sends it, on that turn's spool `prompt` event.
**Setting:** a setting is a reference to a frozen lesson version of the same course, never free-form
values, and can only narrow within the compiled profile (ADR 0006/0007). The host switches at the
turn-start preflight: it asks the Service to record the binding, re-fetches `/v1/profile` as a
candidate and swaps the cached profile only when the served `lesson_binding.key` matches. It sends
that key as its expectation with the existing per-turn `x-hps-turn-id` on every request of the turn,
for both runtimes. The header is never the authority: the Service admits each turn id once, records
the execution snapshot for it, and runs every later request of that turn from that snapshot however
many times the setting changes afterwards; a new turn carrying an old key is refused before anything
runs. If the switch succeeded but the new profile could not be verified, the host does not send a
turn at all and the learner's text and attachments stay in the input. A turn that ends in a
`lesson_binding` refusal is closed from the Service's record of that turn, not from guesswork:
nothing dispatched → text and attachments return to the input (existing `inputRejected`); something
dispatched → the turn is marked as partially executed and is never re-sent automatically; record
unreadable → marked unknown, never re-sent automatically. When the binding cannot be read the
Service holds new execution instead of falling back to the wider token lesson, and turning classroom
operations off does not undo a setting that was already switched. The activity identity,
conversation, draft, workspace files and usage attribution do not move. Step signals carry the new
lesson version after the switch, and earlier self-reports are never shown as completion of the new
version. "Applied" is the Service's record that a request pinned to that binding reached the
upstream with its normalized wire and got a response — not a gate pass, a device receipt, a profile
200, `count_tokens`, or the inbox card.

### Cause-specific remote recovery (U4) — implemented, locally run, not accepted, default OFF, 2026-09-22

Implemented on `feat/751-u4-remote-recovery` (stacked on U3) and run locally (unit, Service, local workerd D1, browser, a
real Studio window on a Mac with a scripted model provider and locally made faults): see the
[contract](requirements/classroom-admin.md#remote-management-u4-20260922) and the
[run record](testing/classroom-admin.md#remote-management-u4-run-20260922). Not accepted, not deployed, behind the existing
per-run `ops_commands` flag (default false); no migration; no REQ row is claimed until acceptance.
A remote action that a device reports as `succeeded` is not shown as a fix. Per target the Service says one of: resolved,
remains, executed (ran; nothing yet says whether the cause is gone), unverified, not executed — from that command's own
receipt, from follow-up observations the app links to that command id over the same connection and login generation, and
from the Service's own records (latest token issue, verified upload). Learner-side behaviour that changed:
a token re-check names the public issue id of the token the app holds (never the token); a stop or a preserving restart
is answered once by the learner's own next finished turn — the app never sends a question or calls a model to find out;
a stop takes its preservation baseline before acting and compares the learner's words (parked message + typed text +
attachments + import references), not which slot holds them; a turn the instructor cut off hands the parked message back
to the draft like the learner's own Stop (REQ-C16); a token re-check no longer clears a runtime, tool or provider fault;
preview recovery checks the page the learner had open (a 404 is a named fault) and touches only tabs on the learner's
preview server as it was before the action (other localhost tools and sites are never read, moved or closed); it reports
the page back only when that tab itself loaded a fresh document at the page's address (on one session bound to that
tab, stopping if the tab goes) and every learner page answered as a document, never from an HTTP answer alone;
an Agent SDK turn whose result is an error is a failed turn for the spool, the observation log, the turn close and the
board alike (the learner's notice is shown once, nothing is retried), classified only from the HTTP status this turn's own
stream carried (5xx → provider, 429 → rate limit, none → unknown). A re-issued code typed on the start page for the activity already open in
the window keeps the learner's work folder (it used to move them to the profile's default folder). Pause still refuses only NEW model requests: a request already streaming is not
cut, the next request of the same turn is a new request and is refused, nothing is re-sent on resume.

## Classroom integrity corrections (#1409)

ADM-03/05 voluntary help cancellation and discard carry the request ID displayed
in the preview; a stale window cannot cancel a replacement request. Oversize HTTP
413 responses preserve the draft and explain the size refusal. The existing
8,000-code-unit field limit is unchanged; the student share body budget covers
six fields, including JSON escaping. Local help-store commits are confirmed by
commit identity, so a successor does not replay an already committed mutation.

ADM collection copies repeat approved artifact bytes at approval time, including
after restart, and keep undated damaged fragments only inside the evidenced time
window (all-undated legacy inputs retain compatibility). Missing approved pages
never receive complete coverage. See the existing classroom-admin contract and
`docs/testing/classroom-admin.md` for the nine regression cases and actual results.

## Release acceptance synthetic cohort (#1404)

Release acceptance (`verify-unified-release.yml`, [procedure](dev/unified-release-and-migration.md#public-acceptance-credentials-1404))
must run unattended without a long-lived student code, without holding a session the
live-session freeze reads as a class, and without consuming a real trial allowance.
REQ-STUDIO-NATIVE-LIFETIME is unchanged: a fresh handle gets a fresh allowance, and a
reissue to the same handle still cannot reset one.

| ID | Acceptance criteria | Implementation / verification |
|---|---|---|
| REQ-STUDIO-SYNTHETIC-ACCEPTANCE | A cohort whose every profile declares `synthetic: true` refuses any roster write (replace, append, session open) or token mint naming a handle outside `synthetic-` with `400 synthetic_handle_required`, and `GET /admin/cohorts` reports `synthetic` for every cohort. `synthetic-release-acceptance` is served exactly what `studio-native-trial` is served and is hidden from the console. Each acceptance run mints a fresh handle's classroom code (session open) and trial code, and revokes the trial grant and closes the session in `finally`. The freeze ignores a live session only on a cohort reported exactly `synthetic: true` running one of its own profiles, names what it ignored, and still blocks a real class beside it; a missing or non-boolean flag, a foreign profile or an undecidable window blocks. The real workflow run with these credentials is NOT RUN. | `worker/src/lib/synthetic-cohort.ts`, `worker/src/profiles/synthetic-release-acceptance.ts`, `worker/src/routes/admin.ts`, `scripts/check-live-sessions.mjs`, `e2e/unified-release/public.mjs`; `worker/test/synthetic-cohort.test.mjs`, `worker/test/profile-serving-snapshot.test.mjs`, `scripts/test-check-live-sessions.mjs` |

## Team brain: learning wiki and deck generator (founder course first)

Two App-side skills, generic and off by default, that keep a team's record across sessions and draft
pitch slides from it. A cohort turns them on with `learning_wiki.enabled` on its profile (served by
`/v1/profile`) and specializes them with `learning_wiki.plan`: folder, audience, session label, the
name students call it by (default "팀 브레인"), a deck template with each slide's role, and each
session's focus slides and question. The AI for Good founder course uses
`worker/src/profiles/plans/founder-ai-for-good-v5.ts` (eight v5 slides, week 1 → slide 1, 2 → 2-3,
3 → 4-5, 4 → 6, 5 → 7-8). Files live in the student's workspace; nothing is stored on the Service.
How confirmed decisions later reach the server project memory (cr-memory, #1450) is an open decision
(#1395 comment, 2026-10-01). Model calls are single non-streaming coach-route requests.

| ID | Acceptance criteria | Implementation / verification |
|---|---|---|
| REQ-STUDIO-LEARNING-WIKI | One ingest reads the current session's spool conversation and `<wiki>/notes/*.md`, sends one request, and keeps only proposals (problem, hypotheses, evidence with real / team test / simulated state, decisions with the AI suggestion and the student's choice, product changes, next action) that cite a turn or note of that session. Entries are numbered H-n / E-n / D-n and appended; uncited items are listed in `log.md`, never written as entries. A hypothesis is "지지" only after a real observation judged a match. The same conversation is not ingested twice; ingested notes move to `raw/`. On the first coach turn of a conversation the team's summary and the next session's question and deck focus are prepended to the model input (not the student's bubble). | `extensions/hypeproof-chat/src/learningWiki.ts`, `chatPanelProvider.wikiIngest`; `test/learning-wiki.smoke.mjs`; Studio Dev app run 2026-10-05 (week 1 → 2, deck 1/8 → 3/8) |
| REQ-STUDIO-DECK-GENERATOR | Drafts only the requested template slides from the wiki: one claim headline, one visual (number, quote, the student's product page, steps, before/after, statement), at most two supporting lines, speaker notes. A slide is kept only when its references resolve in the wiki and every number on its face appears in the entries it cites; a refused or missing slide gets one repair request with the reasons. Citations, notes and unconfirmed items stay behind the "발표자 노트·근거" switch; the basis tag on the slide is computed from the cited evidence. A humanizer pass rewrites the slide text once; a rewrite that adds a number or balloons is refused, a quote is never rewritten, dashes are stripped. | `src/deckGenerator.ts`, `src/humanizer.ts`; `test/learning-wiki.smoke.mjs` |
| REQ-STUDIO-TEAM-BRAIN-CALL | Students call the wiki by name in the chat: "팀 브레인에 정리해 줘" ingests (the next session unless the student names one; asks only when the latest session was already filed today), "팀 브레인으로 덱 만들어 줘" drafts the plan's focus slides, "팀 브레인 보여 줘" shows a summary without a model call. Messages without the name, longer than 40 characters, with two sentences, or asking about the feature do not trigger. The answer says what was added and the deck progress. The commands "HypeProof: 팀 브레인에 정리하기" / "HypeProof: 팀 브레인으로 덱 만들기" do the same, gated on `hypeproof-chat.learningWikiEnabled`. | `brainIntent` in `src/learningWiki.ts`; `chatPanelProvider`; `test/learning-wiki.smoke.mjs`, `test/cr-switch.smoke.mjs` (manifest gating) |


## Feedback delivery contracts (2026-10-16)

These contracts derive from Useful work first, Human judgment stays visible,
Minimum necessary intervention and Evidence over claims in
[Product Intent](PRODUCT-INTENT.md). They expose choices, delegation boundaries
and verification; they do not assert measured learning gains. The FB/OC/DL
labels and frozen T01–T30 acceptance are mapped in
[the test contract](testing/studio-feedback-owner-console.md).
Implementation and local/synthetic checks do not establish candidate-app,
installed-release, production, visual fidelity or human acceptance.

FB-01/02 reuse [US-03/07–10/12/18](requirements/unified-studio-experience.md),
[ADR 0008](adr/0008-activity-connection-boundaries.md) and the existing activity
credential/history/draft stores. `initializeFilesLayout` closes the primary sidebar
on every launch and workspace activation, before remote activity restoration.
Explorer opens when the user explicitly chooses the existing file-view action;
project changes and restarts start closed even if that workspace saved it open.
Native integrated-browser preview tabs restored from the previous session are
closed before activity restoration. Only that startup snapshot is closed; later
preview requests remain open. Ordinary file/chat restoration and external
browser applications are unaffected. A failed tab close does not block startup.
Chat focus waits for initial activity restoration, reveals the existing editor
chat and explicitly returns the caret to its existing composer. The focus request
is bound to that activity and is cancelled when the composer unmounts or changes
activity; passive restoration does not steal focus. If no editor chat exists, it
opens the entry surface; it must not create a second sidebar chat or reopen a
sidebar the user hid.
Controlled StartPage/activity folder navigation prepares and validates the
existing binding before open, blocks while a send is active, and consumes a
destination/activity/Service-bound resume marker once (ten-minute maximum age).
A validated arrival retires only the matching folder-switch attempt, so a later
explicit visit can reopen that folder. Invalid or expired arrival information
must not clear the guard against repeatedly reopening a failed destination.
Its Start surface lists locally saved activities without passively revalidating
the previous profile on mount, reveal or inbox refresh. Explicit activity
selection and entry retain Service validation; cancel or denied selection keeps
the previous credentials and does not reactivate that profile.
Only the current activity's known history/draft keys can fill an empty
destination; a destination's existing saved work wins. Cancel, failed draft
flush, failed navigation and invalid credentials preserve the original state.
Native File → Open Folder, real reload/restart and multi-window acceptance still
require the actual app path; the E2E routing bypass is not sufficient evidence.

### REQ-STUDIO-EXTERNAL-INSTRUCTIONS

Public GitHub Markdown instructions and static text references are resolved to
an immutable commit and integrity-checked manifest. Preview source, revision,
license, declared capabilities and contents before saving or selecting; saving
alone is inactive. Selection is scoped to the canonical trusted workspace and
is appended to the current user-turn context for both runtimes. Update, exact
prior-revision restore, deselection and removal preserve learner output files.
The transport sends no user credentials and refuses redirects, unbounded input,
traversal, symlinks/submodules and executable bundles. External text remains
untrusted context: it cannot alter the Service system prompt, lesson/profile
tool grants, user approval policy or curriculum-skill registry. There is no
promise to detect every malicious natural-language instruction; the runtime
permission boundary remains authoritative.

Verification: `external-instruction-skills.smoke.mjs` and
`external-skill-commands.smoke.mjs` exercise import/store/selection and host
controls; actual model use and installed-app acceptance require separate evidence.

### REQ-STUDIO-REFERENCE-IMAGES

SDK and proxy receive actual current-turn image blocks, not a path/thumbnail
claim. A file-only attachment is analysed only when the active profile grants
`input.image_paste`; `input.image_files` alone grants file attachment, not image
analysis. An explicit reference to a prior attached/pasted image re-reads only
eligible notes from the current activity's history and files inside its current
workspace. Reject outside paths and symlinks; inspect bytes for supported MIME,
size and SHA-256, and make absent/denied/unsupported files visible. Do not replay
old blobs on an ordinary follow-up. Keep the current four-image transport cap.

Reference captures bind pixels to URL/document, time, MIME/hash, viewport/state
and observed readiness where available; unsupported metadata stays null. Discard
captures mixed across redirects. A reference brief distinguishes `observed`,
`user_requested`, `inferred`, `unknown`; observed fields cite a capture hash and
region/state. The Service's reference-design instructions guide artifact creation
and bounded comparison; the App's pure brief validator alone is not proof that a
model created a brief. Preserve identifiable subjects and their arrangement,
angle, occlusion and shadow. A keyboard replaced by a generic illustration fails
the requested meaning. One screenshot does not prove motion or visual fidelity.

Verification: `reference-images.smoke.mjs`, `reference-transport.test.mjs`,
`reference-design.smoke.mjs`, existing browser checks and
`e2e/reference-design/run.mjs`. Scripted SDK/fetch/CDP seams and the synthetic
keyboard fixture do not establish live upstream receipt or human visual judgment.

### REQ-STUDIO-IMAGE-EDIT

Only an explicit `image_edit.enabled` profile grant and configured Service can
start an image edit. The App sends original pixels/hash, requested change,
preserved subject and transparency intent; it never substitutes a generation
endpoint or a lookalike fallback. Current support is bounded RGB/RGBA,
non-interlaced PNG input and a new PNG output. Preserve original bytes, validate
actual format/dimensions/hash/alpha, reject opaque removal results and an entirely
transparent deleted subject, and save exclusively to a new file. Format/alpha
checks do not certify subject identity, key rows or edge/halo quality.

The candidate command persists stable job identity for same-job status lookup,
checks workspace/activity/Service/credential identity before selection, compares
original/result over checker/light/dark backgrounds and allows explicit edited
or original-path selection. A selection does not rewrite the original file.
Changed originals, wrong job hashes, cancellation and late completion prevent
automatic save/application. Timeouts and unconfirmed cancellation remain unknown;
reopening a job must not dispatch another edit.

Service owns the authenticated edit adapter, durable single dispatch, output
retention and the existing attempt/evidence cost ledger. It is disabled by
default; no production profile is enabled by this contract. Unsupported paid-media
budgets and frozen lessons are explicit refusals. Supported free-trial requests
use the existing allowance. An approved matching price and actual response
model/tier/region are needed to price modality meters; otherwise cost is unknown,
not zero. Actual billing and semantic preservation require provider and human
checks in T15/16/20/30.

Verification: `image-edit.smoke.mjs`, candidate `image-edit-commands.smoke.mjs`,
`e2e/image-edit/compare.mjs` and the Service image-edit tests named in the test map.
The command module's presence is not proof of installed command registration.

### REQ-STUDIO-FEEDBACK-EVIDENCE

The report/manual bundle binds frozen acceptance revision, implementation SHAs,
runtime/fixture scope, actual commands, observations and hashed evidence.
Missing execution is NOT_RUN; changed source/evidence is stale or rejected;
missing original assets/provider access are BLOCKED for the affected scenario.
Local/synthetic, candidate-app, installed-app, production and human gates remain
separate. The report must escape untrusted text, reject escaped/missing/modified
artifact references and forged PASS, and work offline with its static data.
The Korean manual identifies controls, prerequisites, recovery and the confirmed
collection boundary. A human task record names the person, artifact and assistance;
a model report or screenshot cannot mark human acceptance complete.

Verification: candidate report generator/tests, local-file browser report/manual
checks and T27 human observation. Operational token/cost totals are not learning
outcomes. Missing invoice, externally direct personal-key traffic and unreported
historical activity remain explicitly unverified.

## Daily release coordinator (#1757)

`REQ-STUDIO-RELEASE-ENGINE`: the [local coordinator](dev/release-engine.md) pins
existing release-cut inputs, persists idempotent decisions and zero-incremental
cost reservations, requires every policy-defined artifact/work stage/installed-App
check, and binds a rotating manager's signed approval to exact manifest and
evidence digests. Changed bytes, missing/failed checks, unknown budgets, expired or
revoked approval and an older channel intent cannot authorize promotion. Failure
ticket intents deduplicate across candidates and product fixes have one reserved
attempt. A dead same-host writer is recoverable without evicting a live owner.

Verification: `scripts/release/test/engine.test.mjs` exercises real local files,
CLI restarts, two-process contention and SIGKILL with signed protocol fixtures.
This is local engine evidence, not installed-App acceptance. Provider/billing,
remote publish wiring, exact-byte customer delivery and seven-day operations
remain NOT RUN. No workflow publication gate is bypassed or replaced.
