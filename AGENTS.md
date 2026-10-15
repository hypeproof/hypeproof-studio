# Repository instructions

## 인간이 확정한 최종 합의 사항

에이전트의 제안과 인간의 최종 결정을 구분해 보존하는 구역이다.
아래 기록은 합의한 방향이며, 구현 완료나 운영 반영을 뜻하지 않는다.

### 기록 규칙

- 최종 결정자는 인간이다. 사용자가 명시적으로 선택하거나 동의한 사항만
  확정 기록에 추가한다. 에이전트의 제안·추천, 검토 요청, 침묵을 합의로 취급하지 않는다.
- 각 기록에 결정 ID, 날짜, 제안·선택지, 인간의 최종 결정, 확정 근거를 남긴다.
  제안을 수락한 경우 무엇을 수락했는지 함께 적어 대화 밖에서도 범위를 알 수 있게 한다.
- 검토 중인 제안은 `plan.md` 등 작업 문서에서 관리한다. 확정 사항과 섞지 않는다.
- 이미 확정한 범위 안의 작업은 계속 진행한다. 같은 결정을 다시 승인받지 않는다.
  결정의 범위를 넓히거나 뒤집는 제안은 새로운 합의와 구분한다.
- 사용자가 결정을 바꾸면 새 ID와 날짜로 기록하고 이전 기록에 대체된 ID를 표시한다.
  이전 합의를 지우거나 에이전트 판단만으로 수정하지 않는다. 최신 사용자 지시를 우선한다.
- 새 합의는 이 구역에 반영하고 관련 subagent에 알린다. 진행 상태와 실행 근거는
  `service-extraction-progress.json` 및 칸반에서 관리한다.
- 전담 작성자 `/root/decision_recorder`는 메인이 전달한 인간의 확정 발언과 맥락만
  기록한다. 흐름은 메인 전달 → 기록 → 짧은 결과 보고이며, 전달되지 않은 대화를
  관찰한다고 주장하거나 불명확한 내용을 확정하지 않는다.

### 확정 기록 — 2026-10-10

| ID | 에이전트의 제안·선택지 | 인간이 최종 확정한 결정 | 확정 근거 |
|---|---|---|---|
| DEC-001 | Service 레포와 공통 패키지의 공개 범위 선택 | `hypeproof/hypeproof-service`를 공개 레포로 만들고 공통 패키지도 공개한다. | 사용자가 “hypeproof/hypeproof-service 공개 레포 + 공개 패키지”를 선택했다. |
| DEC-002 | 공개 패키지 배포처 선택 | GitHub Release의 버전 고정 공개 패키지 파일로 배포한다. | 사용자가 “GitHub Release의 버전 고정 공개 패키지 파일”을 선택했다. |
| DEC-003 | 측정 실행과 측정 기준의 소유권을 함께 Service로 이전 | Worker 본체와 측정 엔진·평가 기준을 Service 소유로 둔다. `measurement-core`와 `measurement` CLI도 포함한다. CLI는 기존 로컬 실행·Lab 동기화 동작을 유지한다. | 사용자 작성 아래 작업 원칙과, 직전 3줄 요약을 수락한 “일단 그렇게 백그라운드로 실행시켜” 지시. |
| DEC-004 | Studio에 App 연결과 화면 역할을 유지 | Studio에는 App 이벤트 연결, 측정 요청, 결과 표시와 이를 위한 App 코드가 남는다. 측정 관련 코드를 무조건 한 줄도 남기지 않는 것을 목표로 삼지 않는다. | 직전 3줄 요약의 Studio 역할을 사용자가 “일단 그렇게” 진행하라고 수락했다. |
| DEC-005 | CLI 사용 강제와 구조 설계의 근거를 구분 | CLI를 강제한다는 이유만으로 공통화를 정당화하지 않는다. 실제 중복과 공통으로 유지해야 하는 계약을 기준으로 공통화한다. | 직전 3줄 요약의 공통화 원칙을 사용자가 “일단 그렇게” 진행하라고 수락했다. |
| DEC-006 | 구현을 백그라운드로 위임하고 메인은 사용자와 대화 | 이번 분리 작업은 같은 모델·thinking 설정을 상속하는 subagent가 진행한다. 메인 에이전트는 사용자와 대화하고 새 합의를 구현 담당에게 전달한다. | 사용자가 동일 설정을 지정했고, “subagents로 실행시켜. 메인인 너는 나랑 다시 중요한 이야기를 한다”라고 지시했다. |
| DEC-007 | GitHub 연결·조작 방식 | GitHub 작업은 `gh`로 수행한다. | 사용자가 “너 computer-use 하지말고 gh 로 해”라고 지시했다. |
| DEC-008 | 합의 기록 전담 역할 운영 방식 | 이번 대화의 합의 기록은 별도 경량 subagent가 맡는다. 메인은 사용자와 대화하고 확정 발언과 맥락을 전달한다. 기록 담당은 입력받은 새 합의를 `AGENTS.md`에 저장한다. | 사용자가 “이거 기록하는 agents를 light한 모델로 병렬롤 상시 따로 가동시킬 수 없냐?”라고 요청했다. |
| DEC-009 | Studio·Chalk 검토와 구현의 진행 순서 | Worker 분리 구현과 병렬로 Studio·Chalk의 제품 역할·사용 흐름·문제점을 생각하고, 최종 제품 구조 변경은 Worker 분리 결과를 확인한 뒤 진행한다. Worker 관련 의존 제거는 DEC-013에 따라 예외다. | 사용자가 이 순서 제안에 “오케이”라고 답했다. Worker 관련 코드 변경 대기는 DEC-013으로 대체됐다. |
| DEC-010 | Studio·Chalk 간 결합 완화 검토 방향 | 현재 제품 역할은 유지하되, 수정 하나가 다른 기능까지 건드리는 결합부터 줄이고 추가 레포 분리 여부는 검토 결과로 판단한다. | 사용자가 “좋아”라고 답해 이 검토 방향을 수락했다. |
| DEC-011 | 오늘 목표와 Studio·Chalk 레포 경계 | 오늘 목표는 Worker 분리와 Studio·Chalk의 역할 경계 및 겹친 책임 정리다. Studio와 Chalk의 추가 레포 분리는 필수가 아니다. DEC-009의 분석 병렬 진행 및 DEC-013의 Worker 의존 제거 예외를 적용한다. | 사용자가 “오케이 그러면 여기까지가 오늘 우리의 목표일거야”라고 수락하고, Worker 분리를 기다리지 않고 먼저 할 수 있는 작업을 물었다. |
| DEC-012 | Chalk의 제품 통합 위치와 설명 방식 | 웹에 있는 Chalk는 Studio App 안으로 들어간다. 제품 역할 구분과 App 통합은 별개의 결정 사항이며, 사용자에게는 직설적이고 간결하게 설명한다. 실제 웹→App 화면 전환은 DEC-013에 따라 이번 Worker 작업 범위 밖이다. | 사용자가 “지금 studio, chalk boundary 문서에서 웹에 있는 chalk는 앱으로 들어갈거야. 그거 감안해서 다시 정리하고, 저렇게 주저리 쓰지말고 나한테는 직설적으로 깔끔하게 알려줘”라고 지시했다. |
| DEC-013 | Worker 분리 완료 기준과 이번 구현 범위 | Worker 분리는 Service로의 독립 코드 이전뿐 아니라 Studio·Chalk·빌드·테스트의 기존 `worker/` 의존 제거를 포함한다. `worker/` 없는 Studio 체크아웃에서 빌드와 테스트가 실제로 동작해야 완료다. Worker 관련 연결 제거는 지금 구현한다. Chalk의 Studio App 통합 목표는 유지하되 웹 화면을 App으로 바꾸는 작업과 그 밖의 비Worker 작업은 이번 범위에서 제외해 backlog로 보낸다. 메인은 사용자와 대화하고 Worker 담당은 구현 및 GitHub backlog writer를 맡는다. 이에 따라 DEC-009의 Worker 관련 코드 변경 대기는 대체하며, 다른 제품 구조 변경은 기존 검토 순서를 유지한다. | 사용자가 “그럼 worker 담당한테 그 의존 제거까지 끝내라고 해. Studio에서 worker 폴더를 빼도 빌드·테스트가 돌아야 분리 완료지. Chalk가 앱으로 들어가는 것도 감안해서 진행해. 참고로 Chalk 웹을 App으로 바꾸는 작업은 out of scope이기 때문에 worker와 관련된 것에 집중하고 나머지는 backlog로 던지자”라고 지시했다. |
| DEC-014 | 테스트의 수보다 기능 검증의 실효성을 우선 | 설계상 요구되는 동작·판단·실패 처리를 확실히 검증하는 소수의 테스트를 우선한다. 구현을 복제하거나 하드코딩 assertion을 남발해 테스트 수를 늘리지 않는다. “5개”는 정확한 개수 제한이 아니라 검증 품질의 우선순위를 뜻한다. | 사용자가 “주저리 주저리 테스트 100개보다 (assert 하드코딩 남발) 확실히 기능 검증을 하는 테스트 5개만 남기는게 더 났다. 이 사상을 기억해라.”라고 지시했다. |
| DEC-015 | 설계 요구사항을 기준으로 테스트 작성 | 테스트는 구현을 따라 기대값을 복제하는 대신, 주어진 입력·상황에서 설계상 반드시 나와야 하는 결과와 실패 동작을 검증한다. 공개 Service 샘플과 App 결과의 일치는 호환성 검증이며, 측정 판단 자체의 정확성은 측정 기준에 따른 독립 기대 결과로 검증한다. | 사용자가 “얘는 이렇게 디자인 되었기 때문에 테스트 결과는 반드시 이렇게 나와야한다. 의 테스트가 주가 되야한다.”라고 지시했다. |
| DEC-016 | 이번 미션의 마지막 수용 테스트와 종료 기준 | `worker/` 및 비공개 형제 Service 소스가 없는 Studio에서 설치·빌드가 성공하고 남은 App·Chalk 핵심 기능과 공개 Service 연결이 실제로 정상 동작하는 최종 통합 검증을 통과하면 이번 Worker 분리 미션 완료다. 테스트 개수나 개별 검사 통과만으로 완료를 선언하지 않는다. 운영 배포·PR 병합·Chalk 웹→App 전환은 이 수용 테스트의 완료 조건에 추가하지 않고 별도 상태로 관리한다. DEC-013의 완료 기준을 구체화하며, 아래 과거 3단계 계획을 이번 미션 종료의 추가 조건으로 삼지 않는다. | 사용자가 “worker를 뻈을 때 나머지를 제대로 동작하면 되는거잖아. 그거를 마지막 테스트로 보는게 맞지?”라고 확인하고, “이거 통과하면 미션 완료다. 지금까지 우리가 했던 대화 내용을 AGENTS.md에 씽크업해라.”라고 확정했다. |
| DEC-017 | 분리 후 인간의 Dev 앱 수동 테스트 준비 | 에이전트는 분리 완료 시점에 로컬 Service와 Dev 앱을 실행할 수 있도록 준비하고, 단계별 수동 테스트 방법과 정상 결과를 제공한다. 실제 사용자의 수동 테스트 완료와 에이전트의 자동 검증·실행 준비를 구분한다. | 사용자가 “내가 Dev앱을 띄우고 수동 테스트 까지 직접 실행할 수 있게 준비해줘. 준비가 완료 되면 각 단계별로 내가 어떻게 수동 테스트 하면 되는지 가이드를 제공해.”라고 지시했다. |
| DEC-018 | 이번 범위 밖 작업의 backlog 저장소 | 앞서 정리한 후속 작업·보관 검토 후보를 `hypeproof/hype-luwak`에서 추적한다. 기존 이슈와 관계를 보존하고 현재 Worker 분리에 필요한 작업은 미루지 않는다. 작업 추적 위치 결정만으로 활성 코드의 삭제·이동이나 보관 후보의 폐기를 확정하지 않는다. | 사용자가 `https://github.com/hypeproof/hype-luwak.git`을 지정하고 “아까 내가 말한 짬통에다 던질 작업들은 여기에다가 보내줘.”라고 지시했다. |
| DEC-019 | hype-luwak 코드 보관의 재사용 조건과 병렬 실행 | hype-luwak은 폐기장이 아니라 재사용 가능한 코드 보관 레포다. 실제 이동하는 코드는 필요한 의존성·사용법을 갖춘 독립 패키지·모듈로 보존하며 Studio가 버전 고정 설치와 명시 import를 통해 가져다 쓸 수 있어야 한다. 당시 Worker 분리와 별도 담당을 통해 병렬 진행하기로 했으나, 지금 패키징·소비 연결 실행은 최신 DEC-020으로 대체한다. 모든 backlog 기능의 구현이나 활성 코드의 무조건 삭제를 뜻하지 않는다. | 사용자가 “짬통으로 옮겨간 코드들은 studio에서 import해서 사용할 수 있는 구조여야한다”라고 지시하고, 독립 설치·import·버전 고정 방식 설명에 “오케이 그렇게해. 병렬로 진행해.”라고 확정했다. |
| DEC-020 | Luwak 역할 단순화와 Worker 분리 우선 | 당시 Luwak을 애매한 코드(“짬”)의 식별·보관 위치로 정의했으나, 그 정의는 최신 DEC-021의 미사용 코드 보관·애매한 코드 backlog 구분으로 대체한다. 해당 코드가 Studio·Service에 그대로 남아 있어도 제품은 정상 동작해야 한다. Luwak 패키지 설치·import 연결·원본 삭제·강제 이전을 이번 Worker 분리의 전제나 완료 조건으로 만들지 않는다. 짬통 작업은 일시 중단하며 Worker·Studio 분리를 방해하거나 복잡하게 만들지 않는다. DEC-019의 지금 패키징·소비 연결 실행은 이 최신 지시로 대체한다. 원본 보존과 향후 재사용 가능성은 유지한다. | 사용자가 “짬통에는 짬이 들어가야한다”, “짬이 여전히 들어있더라도 동작은 해야한다”, “애매한 애들이 짬이다 라고 루왁이 알려주는 것이다”, “worker와 studio의 분리는 이 짬통 작업에 의해서 복잡해지거나 방해받으면 안된다”라고 확정했다. |
| DEC-021 | 짬통과 backlog의 구분 | 짬통은 불필요하거나 과거에 쓰였지만 현재 사용하지 않는 것이 확인된 코드를 복구 가능하게 옮겨 보관하는 곳이다. 사용 여부·필요성이 애매한 코드는 먼저 backlog에서 검토한다. 제품 통합·리팩터링·운영·이력 같은 후속 업무도 backlog이며 폐기 코드로 취급하지 않는다. 방금 이전하려던 후보들은 우선 backlog에 유지한다. DEC-020의 “애매한 코드 식별·보관 위치” 정의는 이 결정으로 대체하되 Worker 분리 우선과 짬통 작업 중단은 유지한다. | 사용자가 “짬통은 불필요한 코드를 정리하는 곳, 옛날에 있었는데 지금은 안쓰는 코드들을 옮기는 곳이고. 애매한 것들은 백로그에 남기는 것으로 생각해야한다.”라고 정정했다. |
| DEC-022 | 최종 PR 보고 시점과 칸반 갱신 순서 | 최종 PR 주소는 필요한 검사와 의존 정리가 끝나 인간이 바로 머지할 수 있는 상태에서 보고한다. 코드 테스트 통과나 draft PR 생성만으로 전체 완료를 보고하지 않는다. 인간에게 PR을 보고한 뒤 머지하는 동안 칸반 상태·근거를 갱신하며, 실제 병합 상태를 확인한 뒤 반영한다. 에이전트가 대신 병합하지 않는다. | 사용자가 “다 되면 최종 PR 주소와 함께 보고해라. 내가 바로 머지하면 되는 상태가 되었을 때 보고하고, 내가 머지하는동안 칸반 업데이트를 진행하도록 해라.”라고 지시했다. |

### Confirmed Google automation decision — 2026-10-14

| ID | Proposal | Human decision | Evidence |
|---|---|---|---|
| DEC-023 | Managed shared Google executor versus learner-owned Apps Script | Default to the shared executor; defer personal Apps Script export. First verify two distinct Google users without company Cloud IAM and isolate their data. Real mail requires separate explicit approval. | TJ: “공통 실행기를 기본으로 가자. 개인 Apps Script 내보내기는 나중에 추가하고 ... 회사 관리 권한 없이 서로 다른 구글 계정으로 실행되고 데이터가 분리되는지부터 직접 검증해.” |

This changes the intended commercial execution contract. It does not claim the
shared runner is integrated, accepted, or released. Existing owner-script MVP
evidence remains historical evidence of that implementation only.

### Confirmed learner-experience design direction — 2026-10-15

| ID | Proposal | Human decision | Evidence |
|---|---|---|---|
| DEC-024 | Extend the email-only journey into reusable workplace automation | Update the design to cover conversational problem definition; proactive structure negotiation with two choices per decision; one final-outcome image inside the template; a visual quest roadmap; and iterative improvement. Prefer automatic Google integration and learner-owned Apps Script web-app deployment as the destination. Incorporate the supplied curriculum's ten needs, six assets and personal-account background processing. | TJ's explicit five-part design-update request and the curriculum response supplied in the same message on 2026-10-15. |

DEC-024 supersedes DEC-023's personal-script/scheduling deferral **for the expanded
design destination**. DEC-023 still describes the existing shared email runner.
This does not authorize unattended customer mail, claim new scope consent, or
mark the expanded runtime implemented. The four-template taxonomy and detailed
UX are design proposals under this direction, not separately confirmed human
choices. Canonical design: [workplace automation journey](docs/requirements/workplace-automation-journey.md).

### Confirmed cross-platform store verification — 2026-10-15

| ID | Proposal | Human decision | Evidence |
|---|---|---|---|
| DEC-025 | Verify store reuse after feature implementation and investigate secure distribution | Extend the goal and acceptance criteria to three existing test accounts, including a Mac-authored automation published through the Studio-connected store and downloaded/configured/executed by another person in Windows Studio. Research storage format, security, distribution and efficient open-source/community practices using existing Supabase, Cloudflare, Google and GitHub options; use a low-reasoning subagent for research and update the documents. | TJ explicitly requested these outcomes and low-reasoning research on 2026-10-15. |

Canonical contract: [cross-platform skill store](docs/plan/skill-store-cross-platform.md).
This approves research and acceptance planning, not a chosen storage vendor,
public audience, new paid subscription, executable-package trust grant or new
mail send. Three Google logins alone do not establish three Studio principals.

## 이번 레포 정리의 목표와 필수 원칙 — 2026-10-10

### 궁극적인 목표

개발 속도를 높이고, AI에게 개발을 맡겼을 때 불필요한 의존성·탐색·절차가
병목이 되지 않도록 레포를 정리한다. 디렉토리를 줄이거나 계획 문서를
완주하는 것보다 실제 개발 병목을 없애는 것이 기준이다.

### 한 시간 안에 수행할 세 단계

이 항목은 대화 초기에 정한 계획이다. 최신 DEC-013·016이 이번 구현 범위와
미션 종료 기준을 우선한다. Worker 분리 최종 검증을 통과한 뒤 아래 2·3단계를
자동으로 추가 수행하지 않는다. 비Worker 구현은 backlog로 관리한다.

사용자가 지정한 당시 작업의 시간 제한은 한 시간이다. 순서는 다음과 같다.

1. HypeProof Service(Worker)를 HypeProof Studio(App)에서 분리한다.
   `measurement-core`와 `measurement` CLI도 Service 소유로 둔다.
   공통 패키지 이전만으로 Worker 전체 분리를 완료했다고 보고하지 않는다.
2. 1번 완료 후 Studio와 Chalk의 역할·구조·의존성을 더 깊게 검토한다.
   Chalk API 전환이나 추가 레포 분리를 검토의 정답으로 미리 확정하지 않는다.
   개발과 AI 작업을 빠르게 만드는 구조를 판단하고 그 결과를 기록한다.
3. 앞의 두 단계에 속하지 않는 불필요한 코드를 작업 범위에서 격리·보관한다.
   사용 여부와 의존성을 확인하고, 복구 가능한 보관 위치와 이유를 기록한다.

### 진행 상황

작성 시점의 검증 근거를 요약한다. 최신 실행 결과는
`service-extraction-progress.json` 및 칸반에서 확인한다.

- Worker 본체·측정 엔진·기준·SQL·공통 코어·CLI를 Service로 이전했다.
- Studio의 tracked Worker 소스와 소비자 직접 의존을 제거했다. 원본 ignored 개발 상태는
  로컬 복구 위치에 보존했으며 실제 Studio 루트의 `worker/`도 제거했다.
- `worker/`와 형제 Service 소스가 없는 별도 체크아웃에서 설치·빌드·App/Chalk 회귀·
  핵심 App↔Service 및 Chromium 통합 기능 검증이 모두 통과했다.
- 최종 구현·수용 근거는 Studio `ac73a70`, 기록은 `860cda4`까지 push했다.
  Service 런타임 `6a2a769`와 후속 기록도 push했다.
- Dev 앱 빌드·서명 검사, 로컬 Service와 참여 프로필 조회를 확인했고 실제 앱 프로세스를
  실행했다. 사용자가 앱을 닫은 뒤 요청에 따라 해당 App·Service 프로세스를 종료했다.
  구독 AI의 실제 응답과 사용자 수동 기능 검수·운영 배포·병합은 통과로 주장하지 않는다.
- 최종 Studio PR #1587과 Service PR #16이 생성됐다. Service는 원격 CI가 모두 통과했다.
  Studio는 이전된 registry 경로와 두 독립 CI job의 공개 testkit 설치 누락을 수정했다.
  같은 Node22의 격리 체크아웃에서 해당 명령이 통과했으며 원격 재검증 결과를 기다린다.
  외부 소스 검토 도구 지원은 Harness #308의 별도 후속이며 런타임 병합 전제가 아니다.
  DEC-022에 따라 필요한 원격 검사 통과와 머지 상태를 확인한 뒤 최종 주소를 보고한다.
- Luwak 후속 이슈 6개는 backlog로 추적하며 추가 패키징 작업은 중단했다.
- 진행 기록: `service-extraction-progress.json`.
  칸반: https://github.com/orgs/hypeproof/projects/1.

### 반드시 지킬 것

- 사용자의 최신 목표·순서·시간 제한을 우선한다. `plan.md`는 실행 수단이며,
  기존의 큰 계획을 그대로 수행하는 것을 이번 작업의 목표로 삼지 않는다.
- 운영 배포 이전·전체 Git 이력 연결·광범위한 검증을 한 시간 정리 작업의
  불필요한 선행 조건으로 만들지 않는다. 남은 운영·이력·인수 작업은 별도로 추적한다.
- 패키지 분리, Worker 전체 분리, 소비자 적용, 운영 이전을 구분하여 보고한다.
  실제로 실행한 근거가 있는 항목만 완료로 표시한다.
- 각 제품이 다른 제품의 비공개 소스나 형제 체크아웃 없이 개발·빌드되도록 한다.
  연결은 명시적인 패키지와 API 경계로 만든다.
- 기존 기능·인증·데이터·CLI 동기화 동작을 정리 명목으로 바꾸지 않는다.
  불필요한 코드와 현재 사용 중인 코드를 구분한다.
- 진행 상황과 GitHub 칸반에 완료·진행 중·대기 상태 및 근거를 동기화한다.
- 사용자에게는 직관적이고 짧게 말한다. 필요한 결과·남은 일·막힌 이유만 설명한다.
- GitHub 작업은 `gh`를 사용한다. GitHub 조작에 computer-use를 사용하지 않는다.

Before selecting more work or reporting that none remains, run
`python3 scripts/next-work.py` and read [requirement execution](docs/plan/requirements-activation.md).
It checks the current requirement inventory and GitHub work ownership. A completed
`dag.yaml` or `HANDOFF.md` applies only to that plan. It is not a product-wide stop condition.

Read [CLAUDE.md](CLAUDE.md) for existing project rules, then the documents below.
This entry point does not replace the autonomy mandate, product philosophy, or
release gates. Keep those rules in their existing canonical documents.

- Development flow: [DEV-GUIDE.md](DEV-GUIDE.md).
- Layer placement and admission: [vessel-and-modules](docs/plan/vessel-and-modules.md).
- Directory and naming conventions: [directory structure](docs/dev/02-directory-structure.md).
- Requirement index: [requirements](docs/dev/04-requirements.md).
- Verification and evidence: [testing](docs/dev/05-testing-requirements.md) and
  [verification rules](.claude/rules/verification.md).
- Workshop/production decisions: [autonomy mandate](docs/AUTONOMY-MANDATE.md).
- Chalk authoring proposal: [product requirements](docs/requirements/chalk-authoring.md)
  and [test requirements](docs/testing/chalk-authoring.md).

Read the scoped AGENTS.md before changing chalk/, worker/, or the Studio extension.
Inspect existing implementations before creating another store, validator, or
authentication path. Declare planned behavior as planned; a documented test is
not an executed test. Keep changes in a focused branch and PR following the dev
guide. Do not change production state merely to validate documentation.

<!-- hype-pr-skill:start -->
## Agent PR preparation

For development through PR creation in this repository, read and use
`.claude/skills/hype-pr/SKILL.md` (also discoverable at `.agents/skills/hype-pr/`).
Inspect criteria links at task start; before creating a PR, record the agent's
impact assessment and validation with `scripts/hype-pr/pr.py inspect` / `prepare`.
Create through `scripts/hype-pr/pr.py create --preparation <receipt> --apply`.
Fix stale/missing preparation instead of bypassing it with direct `gh pr create`.
The common contract is `docs/AGENT-GUIDE.ko.md`; commands are in `docs/HYPE-PR.ko.md`.
This adds no GitHub required check and does not grant human approval or merge authority.
<!-- hype-pr-skill:end -->
