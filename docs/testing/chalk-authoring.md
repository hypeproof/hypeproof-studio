# Chalk authoring test requirements

Status: staged implementation. The original scenario table is the target plan; see the execution record below for implemented subsets.
Requirement definitions: [Chalk authoring](../requirements/chalk-authoring.md).
Existing verification policy: [testing](../dev/05-testing-requirements.md) and
[verification rules](../../.claude/rules/verification.md).

## 테스트 REQ

아래는 종단 시나리오 목표다. 부분 실행 결과는 하단 기록을 따른다.

| Test ID | 제품 REQ | 조건 및 실행 | 합격 기준 | 검증 방식 |
|---|---|---|---|---|
| T-01 | BASE-01, ARC-01 | 강사 A, 강사 B, 학생 토큰으로 A의 수업 읽기·수정 API 직접 호출 | 허용된 강사만 작업 가능, 나머지는 401/403, 데이터 불변 | API 통합 |
| T-02 | CH-01, SAVE-01 | 초안 생성, 단계 편집, 저장 후 창을 닫고 다시 열기 | 모든 필드와 순서 복원, 인증 비밀 미포함 | API + E2E |
| T-03 | CH-03 | 같은 예제를 학생 A/B에게 제공하고 A가 파일 수정 | 원본과 B 파일의 내용·해시 불변 | 파일 통합 |
| T-04 | CH-04 | 필수 안내·완료 기준이 빠진 단계로 수업 확정 시도 | 누락 위치 표시, 초안은 보존, 확정은 차단 | API + UI |
| T-05 | ENV-01, ENV-02, WEB-03 | 필수 실행 의존성이 없는 지원 기기에서 예제 실행 | 준비 또는 복구 안내 후 실제 페이지 열림; 설치 여부만으로 성공 처리 금지 | 기기 E2E |
| T-06 | RUN-01 | 강사만 가진 외부 계정 권한을 리허설에서 사용 시도 | 학생 조건에서는 사용 불가로 표시; 강사 자격 증명 유출 없음 | 통합 |
| T-07 | VER-02 | 리허설 통과 후 예제 또는 도구 설정 변경 | 이전 합격 기록 유지하되 새 버전은 재검증 필요 상태 | 상태 전이 |
| T-08 | VER-01, ENV-03 | v1 수업 진행 중 초안을 v2로 수정 | 기존 학생은 v1 유지, 새 수업에서 명시적으로 v2 선택 | 통합 |
| T-09 | RUN-03 | 정상·만료·다른 수업용 참여 자격으로 참여 시도 | 정상만 지정 수업 진입, 오류는 복구 가능한 안내, 다른 수업 접근 불가 | API + E2E |
| T-10 | SAVE-01 | 저장 응답 유실 후 같은 요청 재시도 | 수업·학생 항목 중복 생성 없음, 상태 재조회 가능 | 장애 주입 |
| T-11 | SAVE-01 | 두 창이 같은 revision을 각각 수정·저장 | 늦은 저장에 충돌 표시, 선행 변경을 조용히 덮어쓰지 않음 | API 통합 |
| T-12 | WEB-01, WEB-02, WEB-04 | 진료시간·사진·문구 수정 후 375/768/1280px 확인 | 의도한 내용 반영, 가로 넘침·주요 버튼 가림 없음 | 브라우저 + 시각 확인 |
| T-13 | WEB-05 | 파일 추가·변경·삭제 후 복구 | 저장 지점의 파일 집합과 내용 복원, 복구 전 상태도 보존 | 파일 통합 |
| T-14 | WEB-06 | 깨진 이미지·링크·JS 오류를 의도적으로 넣고 검사 | 심은 오류 탐지, 미검사 범위 표시; 검사 완료를 전체 품질 보증으로 표현하지 않음 | 브라우저 통합 |
| T-15 | WEB-07 | 시험 호스팅에 배포 후 새 브라우저 세션으로 URL 접속 | 해당 버전의 페이지와 자산 로드, 인증 실패는 성공으로 표시하지 않음 | 외부 연동 E2E |
| T-16 | CLS-01, AUTH-01 | 활동 없는 학생 포함 수업 현황 조회 | 선택한 수업의 전체 대상 표시, 신호 없으면 unknown, 질문 원문 미노출 | 기존 board 회귀 |
| T-17 | CLS-02, AUTH-01 | 학생이 선택한 화면만 도움 요청에 공유 | 미선택 대화·파일·비밀 미포함, 다른 수업 강사는 접근 불가 | API + UI |
| T-18 | REQ-01, REQ-02 | 수업과 연결된 기능 요청 접수 및 상태 변경 | 요청 ID·다음 조치 표시, 요청자에게 접근 가능, 개발 완료로 허위 표시 금지 | 통합 |
| T-19 | BASE-05 | 수업 세션 종료 후 자기 프로젝트 재열기 | 파일 열람·로컬 수정 가능, AI/호스팅 만료는 별도 안내 | 기기 E2E |
| T-20 | EDU-03, EDU-04 | 시연과 다른 휴진 공지 과제 수행·제출 | 결과와 검수 기록, 지원 사용 범위 구분; 제출만으로 자립 등급 자동 확정 금지 | 강사 평가 |
| T-21 | ARC-01 | Chalk를 통한 미허용 쓰기·위조 전달 헤더 시도 | 기존 공유 인증 정책으로 거부, Chalk의 직접 상태 쓰기·토큰 발급 없음 | 기존 인증 회귀 |
| T-22 | ARC-02 | Studio에서 Chalk 진입, 만료 인증으로 재진입 | 정상 이동 또는 로그인 안내, URL·로그에 토큰 미노출 | 기기 E2E |
| T-23 | ENV-07 | 지원 OS 각각에서 설치·참여·실행·종료·재시작 | 같은 과제 수행 가능; 미지원 OS는 참여 전 명시 | 플랫폼 매트릭스 |

## 구현 순서와 각 단계의 종료 기준

### 누락된 요구사항의 인수 시나리오 (2026-09-13, #1007)

아래 T-24~46은 새로 발현한 인수 계획이며 전부 **NOT RUN**이다.
기존 79개 작성·관리·디자인 요구 중 테스트 연결이 없던 23개를 다룬다.
각 실행은 제출·실제 App/Service/수업 revision, 기대/관측과 근거를 기록한다.
합성·로컬 검사는 실제 설치본·운영 활성화·인간 학습 효과의 PASS가 아니다.

| Test ID | 제품 REQ | 조건 및 실행 | 합격 기준 | 검증 방식 |
|---|---|---|---|---|
| T-24 | BASE-02 | 강사 조건으로 초안→설정→학생 리허설→확정 수업 현황까지 이동하고 각 단계 실패를 주입 | 같은 수업 revision으로 연결; 미실행 리허설을 준비 완료로 표시하지 않고 입력/확정본 보존 | Chalk+Service E2E |
| T-25 | BASE-03 | 새 지원 기기의 학생이 기본 홈페이지 실습 시작·수정·검수·저장을 UI로 수행; 실행 의존성 하나 제거 | 명령어/설정 파일 편집 없이 정상 완료; 환경 부재는 지원되는 복구 안내, 몰래 성공 처리 금지 | 실제 App+관찰 |
| T-26 | BASE-04 | 안내·예제·도구·지침·완료 기준을 저장/재열기/확정하고 필수 항목 하나씩 삭제 | 전 항목과 순서 복원; 누락 위치 표시·확정 차단·기존 확정본 불변 | API+상태 전이 |
| T-27 | CH-02 | 충분한 목표/자료로 홈페이지 수업 초안 생성, 예제나 검수 기준 누락·생성 중단 재현 | 편집 가능한 초안에 예제/실습/검수 항목 존재; 누락/부분 생성은 미완 표시, 자동 개설 없음 | 실제 모델+Chalk |
| T-28 | CH-05 | 선택 기록 A로 초안 생성, 기록 B 미선택·A 공유 철회 후 재시도 | A 출처를 보존한 초안을 강사가 직접 확정; B/철회 기록 재전송·자동 확정 없음 | 권한+실제 모델 |
| T-29 | CH-06 | 기본/확장 과제 편집·순서 변경·학생 진입, 확장 과제만 실패 | 기본과 확장 조건/완료 상태 분리; 확장 실패가 기본 결과 삭제나 허위 전체 완료를 만들지 않음 | API+UI |
| T-30 | CH-07 | 학생 기록·합성 자격을 포함한 이전 기수에서 새 기수 복제 | 수업 자료/구성만 복제, 새 ID; 학생 원문/명단/자격/사용량 미포함, 원 기수 불변 | API+저장소 대조 |
| T-31 | WEB-08 | 통제된 공개 대상에서 v1→v2→v1 복구, 인증 실패·배포 중 응답 유실 | 실제 재접속한 파일/자산이 선택한 revision; 미확인/실패를 복구 완료로 표시하지 않고 이전 대상 보존 | 승인된 외부 연동 E2E |
| T-32 | WEB-09 | 지원 템플릿 설치→빌드→실행, lock 불일치·의존성/빌드 오류·실행 포트 충돌 | 검증된 템플릿만 실행, 단계별 오류/복구 제공·파일 보존; 임의 템플릿 지원 성공 주장 없음 | 격리 설치+App |
| T-33 | ENV-04 | 학생 A/B 자격으로 실행·예제 복제·내보내기, B 자격/공유 폴더로 우회 시도 | A/B 정상 작업 분리; 복제에 자격 없음, 타 학생 자격 재사용·접근 거부 | API+파일+SDK |
| T-34 | ENV-05 | 검토된 플러그인/MCP 연결 시험 후 확정 버전에 편입, 시험 실패/버전 변경 | 시험한 권한/버전만 편입; 실패·미검토 버전 자동 활성화 없음 | 격리 통합 |
| T-35 | ENV-06 | 미등록 도구 후보를 격리 시험·제거하고 수업 편입 요청 | 시험 기록과 검토 결정 분리; 시험 중 운영 수업/학생 자격 접근 없음, 미승인 편입 차단 | 격리 환경+검토 |
| T-36 | RUN-02 | 정상 준비와 실행/자료/도구/인증 누락을 각각 재현 | 각각 원인·기준시각·다음 행동 표시; 하나의 ping 성공으로 전체 준비 완료 금지 | Service+Chalk |
| T-37 | RUN-04 | 지원/미지원 OS·앱, 연결 끊김, AI 한도/권한 거부 학생을 동일 명단에 둠 | 지원·연결·AI 가능 상태를 분리, 신호 없는 학생 unknown; 누락 학생을 명단에서 숨기지 않음 | 플랫폼+운영 보드 |
| T-38 | RUN-05 | 수정 중 네트워크/실행 환경 실패 후 재시도·복구 | 파일/입력/현재 연결 보존, 복구 가능 다음 행동; 조용한 데이터 초기화·중복 외부 실행 없음 | 장애 주입+App |
| T-39 | CLS-03 | 학생 산출물의 파일/위치/revision에 피드백하고 이후 파일 수정/삭제 | 원 위치·버전 근거 유지, 현재 위치 불일치는 명시; 다른 파일/새 버전에 조용히 재부착 금지 | 공유 API+UI |
| T-40 | CLS-04 | 학생이 범위를 승인한 강사 수정, 거부·철회·만료·수정 대상 변경 대조 | 허용 범위만 수정, 변경 이력/복구 전 snapshot 보존; 승인 없는 수정과 확대 거부 | 권한+실제 App |
| T-41 | CLS-05 | 선택 결과 A로 공동 리뷰, 결과 B 미선택·A 철회/만료·타 수업 접근 | A만 허용된 대상에게 표시; B/철회 자료·원문 자동 공개 없음 | 공유 API+Chalk |
| T-42 | EDU-01 | 단계별 목적·선택·검수 과제를 보며 작업, 충분한 기존 목표/모호한 목표 대조 | 필요한 판단을 안내하고 이미 명확한 목표는 재설문 없이 진행; 과제 열람/AI 문장을 인간 선택으로 기록하지 않음 | 실제 모델+App |
| T-43 | EDU-02 | 힌트→함께 수행→독립 시도 전환과 실행 중 변경, 다른 수업 도움 설정 주입 | 다음 실행의 도움 방식·출처가 일치, 입력 보존; 권한 확대·타 수업 지침 혼입 없음 | 실제 모델+정책 |
| T-44 | EDU-05 | 직접/도움받은/전문가 위임의 근거 있는 사례와 출처 없는 사례를 비교 | 도움 조건과 판단 주체를 구분; 미관찰은 unknown, AI 설명/제출 수를 자립 등급으로 승격하지 않음 | 합성 기록+사람 검토 |
| T-45 | REQ-03 | 같은 요청을 기존 안내/선택 확장/기본 개발로 분류하고 이유 수정, 권한 없는 변경 시도 | 요청자에게 분류·이유·다음 행동 표시; 권한 없는 변경 거부, 분류가 개발 완료 표시를 만들지 않음 | API+UI |
| T-46 | REQ-04 | 수정 후보를 강사가 요청 당시 예제로 재실행해 해결/미해결 판정, 예제/버전 불일치 대조 | 실제 대상 revision과 강사 확인 기록 연결; PR 병합/다른 예제 통과만으로 해결 완료 금지 | 강사 인수 |

1. PR 1 — 저장 및 권한 계약: 기존 모델 확인 후 초안/버전/리허설 상태 추가. T-01/02/04/07/08/10/11/21 통과.
2. PR 2 — Chalk 작성 화면: 홈페이지 수업 생성, 예제·단계 편집, 준비 상태, 버전 확정 UI. 학생 간 예제 격리 T-03 포함.
3. PR 3 — Studio 진입 및 리허설: 학생 권한 실행, 환경 검사, 기존 참여 흐름 연결. T-05/06/09/22/23 통과.
4. PR 4 — 홈페이지 종단 검증: 수정·모바일·복구·배포·수업 종료 후 접근. T-12/13/14/15/19 통과.
5. PR 5 — 운영 지원: 기존 board 보존, 선택적 도움 요청·기능 요청·학습 제출. T-16/17/18/20 통과.

PR은 구현 분할 제안이며 아직 생성하지 않았다. 각 단계는 관련 테스트와 기존 회귀 검사를 통과한 뒤 다음 단계로 진행한다.

<a id="g2-run-20260922"></a>

### G2 커리큘럼 → 실행 실행 기록 · 2026-09-22

위 계획 표는 고치지 않는다. 여기에는 [G2 계약](../requirements/chalk-authoring.md#g2-curriculum-runtime-20260922)의
해당 부분을 실제로 돌린 결과만 적는다. 모든 계정·커리큘럼은 합성이고 모델 공급자는 기록기다(실제 모델 호출 0건).

| Test | 이번에 확인한 범위 | 결과 | 근거 |
|---|---|---|---|
| T-24 (BASE-02) | 초안 → 영향 확인 → 후보 고정 → 학생 조건 리허설 → 확정 → 운영 보드 선택지까지 강사 화면에서 이동. 코드 발급·후보 고정은 "준비 완료 아님", 편집은 보존 | PASS (브라우저, 실제 Mac) | `e2e/classroom/authoring-g2.mjs` 7건, `e2e/classroom/mac-curriculum.mjs` |
| T-26 (BASE-04) | 도움 방식·작업 화면·허용 기능·대상·예제의 저장/재열기/확정 버전 재사용 | PASS 부분 — 필수 항목 하나씩 삭제 재현은 기존 authoring 시험 범위, 이번에 새로 돌리지 않음 | `authoring-g2.mjs` ①, `worker/test/authoring-rehearsal.test.mjs` |
| T-07 (VER-02) | 리허설 중 초안 수정 → 이전 후보만 통과, 수정본은 새 후보로 미실행, 이전 통과로 확정 거부. 정책 digest 변경 시 `다시 필요` | PASS (Service·브라우저). 정책 변경은 저장된 digest를 바꿔 모사(컴파일 프로필은 코드) | `authoring-rehearsal.test.mjs`, `authoring-g2.mjs` ③⑥ |
| T-06 (RUN-01) | 리허설은 명단에 등록된 학생 코드로만, 강사 자격 없이. 일반 학생 코드로 보고 거부 | PASS (Service) — 강사 전용 외부 계정 시도는 해당 기능이 없어 NOT RUN | `authoring-rehearsal.test.mjs` |
| T-36 (RUN-02) | 미실행(요청 전 보고 거부)·실패(열지 않은 단계)·지원 안 됨·만료·통과를 각각 재현; 코드 발급·ping만으로 통과 없음 | PASS (Service·브라우저·실제 Mac 미실행/통과) | 위 셋 + `mac/g2-mac-*-rehearsal-not-executed.png` |
| T-43 (EDU-02) | 힌트(기본) → 직접 해보기(학생 선택) → 함께 수정(B 기본); 선택은 다음 턴부터, 진행 중 턴은 이전 기준. 제공하지 않은 방식은 409 | PASS (전송·강제) / 실제 모델의 교수 품질 **NOT RUN** | `mac-curriculum.mjs` provider 기록, `lesson-focus.smoke.mjs` |

**실제 Mac 실행** (`mac-curriculum.mjs`, source·extension `7c7046f`, 셸 0.1.16 사본, Agent SDK 0.3.207 실제 바이너리,
macOS arm64): A(힌트·직접 해보기, 확인 기준 양식, 읽기만)와 B(함께 수정·직접 해보기, 결정과 이유 양식, 읽기·쓰기)를
강사 화면으로 작성·비교·후보 고정 → 각각 실제 Studio 리허설 창에서 요청 1회·세 단계 열기 → 통과 → 확정.
A1(실제 창)에만 A 전송 중 V1으로 시작한 질문(HOLD)은 V1로 끝났고 다음 질문부터 A로 실행됐다. 모델 경계에서 A는
쓰기 도구 없음·기본 `힌트 받기`, 학생이 고른 `직접 해보기`와 저장한 확인 기준이 다음 요청에 실렸다. B는 쓰기 도구·
`함께 수정`·저장한 결정과 이유가 실렸다. A2(연결, 비선택) 바인딩·설정 수신 0, A3(선택, 미연결)는 "접수 — 기기 연결 없음 ·
준비 전"으로 적용 없이 남았다. 재시작 뒤 다음 턴도 B, 기본 수업 복귀 뒤 V1. 학생 파일 변경 0. 증거:
관리 증거 폴더 `report-gap-g2/mac/result.json`과 캡처 17장.

**계측기 기록**: 첫 세 번의 Mac 실행은 질문 표식을 찾는 정규식(`\b`)이 저장한 기준 뒤의 `\nQ-LA2`를 놓친 계측기
결함으로 멈췄다 — 요청 자체는 올바르게 갔다(학생 기록과 공급자 기록으로 확인). 네·다섯 번째는 테스트 호스트의
메모리 비밀 저장소 때문에 재시작 뒤 수업 연결 자격이 사라져 복귀가 전달되지 않았다. 학생이 연결 코드를 다시 넣는
단계를 넣었고, 설치본 Keychain의 자격 유지는 **NOT RUN**이다.

**NOT RUN**: 실제 모델 품질·지연·비용, Windows, 여러 실제 기기, 학교 네트워크, 설치본 Keychain, 운영 D1에서의
`HPS_LESSON_CONFIRMATION` 활성화, 사용자 시각 인수, 나머지 다섯 작업 화면, `learning` 블록 편집. 이 기록은 G3(보고서)의
근거가 아니다.

<a id="g2-mission-run-20260922"></a>

### G2 인수 보정 — 미션 작성 → 학생 표시 → 실행 기록 · 2026-09-22

[미션 계약](../requirements/chalk-authoring.md#g2-mission-20260922)을 돌린 결과만 적는다. 합성 계정·커리큘럼, 모델 공급자는 기록기(실제 모델 호출 0건).

| 층 | 확인한 것 | 결과 | 근거 |
|---|---|---|---|
| Service | 저장·재열기(보존 항목 포함) / 잘못된 learning 6종 거부(점수 포함) / 후보·버전 목록·요청 문맥의 미션 / 리허설 중 미션 수정 → 새 후보·이전 후보는 틀린 헤더로 실패 / 미션 없는 수업 `none` / 보존 항목만 바뀐 차이 | PASS 8 | `worker/test/authoring-mission.test.mjs` |
| Service (U3 전환) | 선택 학생의 다음 턴 v2 미션, 비선택 학생 미션 없음(v1), 진행 중 턴은 v2 미션 유지·다음 턴 v3 미션, `never` 전달 | PASS (기존 9건 안) | `worker/test/classroom-ops-lesson-settings.test.mjs` |
| 판정 대조군 | 양성: 글자 그대로 일치 → 통과. 음성: 이전 버전 미션·미설정 헤더·조건 누락·주차 다름 → `mission_mismatch`, 읽기 없음 → `mission_not_reported` | PASS | 같은 파일 judge 2건 |
| App | 보고에 헤더 읽기를 그린 그대로(길이 제한) 싣고, 없으면 싣지 않음 | PASS | `extensions/hypeproof-chat/test/lesson-focus.smoke.mjs` |
| 브라우저 | 강사가 미션을 켜고 편집·저장 → 빈 미션/기록 종류 누락 거부(포커스 복귀) → 재열기·내보내기·가져오기(보존 항목 이름 표시) → 차이 검토 문장 → 후보 미션 표시 → 빌드된 webview 헤더를 조작한 리허설 실패 → 정직한 헤더 통과 → 통과 뒤 미션 수정은 새 미확정 후보 → 운영 보드 선택지·보내기 확인에 미션 | PASS 7 | `e2e/classroom/authoring-mission.mjs` (CI classroom-ops) |

**실제 Mac 실행** (`mac-curriculum.mjs`, `HPS_G2_RUN=mission`, 셸 0.1.16 사본 + 현재 확장·webview 빌드, Agent SDK 0.3.207 실제 바이너리,
macOS arm64): 강사 화면에서 A(1주차 ‘예약 안내 첫 판을 만들고 확인 기준을 먼저 정한다’, 완료 조건 2개)와 B(2주차 ‘진료시간을 고치고 왜
바꿨는지 남긴다’, 완료 조건 1개)를 보이는 칸으로 작성했다. 차이 검토가 미션·완료 조건 변화를 문장으로 보였고, 실제 리허설 창의 헤더
읽기가 후보와 일치(`match`)해 통과·확정됐다. 학생 A1 실제 창: V1은 "미션이 정해지지 않았습니다."(요청 문맥에도 미션 없음), V1로 시작한
질문은 끝까지 미션 없이 끝났고, 다음 턴부터 A의 미션이 헤더와 공급자 요청에 함께 나타났다. B 전송 뒤 다음 턴부터 B의 미션, 재시작 뒤에도
B, 기본 수업 복귀 뒤 다시 미션 없음. 완료 조건은 모두 ☐. A2(연결·비선택)·A3(미연결) 바인딩 0, 학생 파일 변경 0. 작업 양식 입력칸은 흰
기본 상자가 아니라 테마 색이다. 증거: 관리 증거 폴더 `report-gap-g2/mission-completion/`.

**NOT RUN**: 실제 모델이 미션을 어떻게 가르치는지, 설치본 Keychain, Windows·여러 기기·학교 네트워크, 운영 활성화, 사용자 시각 인수,
`observe`·`never` 등의 편집 칸, 나머지 다섯 작업 화면, G3.

## 검증 환경과 증거

- 합성 병원 자료와 가상 학생 두 명, 강사 두 명 사용. 운영 데이터·운영 토큰 사용 금지.
- 지원 OS 범위는 첫 구현에서 확정하고 OS·아키텍처·Studio 버전을 기록한다. 실제 기기 검증을 브라우저 에뮬레이션으로 대체하지 않는다.
- 자동 검증은 API/파일/상태 전이 중심, E2E는 사용자가 끝까지 수행하는 주요 경로 중심으로 제한한다.
- 기존 chalk npm test와 typecheck는 실행 가능한 체크아웃에서 수행한다. README에 적힌 명령을 실행 결과로 간주하지 않는다.
- 증거 형식: Test ID, commit SHA, 환경, 실행 일시, PASS/FAIL/BLOCKED, 관측 결과, 로그 또는 화면. 비밀과 학생 원문 제외.
- 미구현/환경 부재/실패를 구분한다. 조건 없는 skip을 PASS로 계산하지 않는다.

## 출시 게이트

첫 구현 및 기본 홈페이지 경로에 해당하는 P0 테스트 전부 PASS, 권한·학생 격리·복구 실패 0건, 지원 플랫폼 실기 검증 완료. 강사 1명과 시험 학생 2명이 명령어·설정 파일 편집 없이 수업 생성부터 결과물 확인까지 수행한다. 공개 배포·운영 반영은 검증된 변경과 실행 증거를 검토한 뒤 수행한다.


## Architecture coverage additions

T-07/T-08 must exercise the declared session-design schema and old-client
compatibility, reject malformed/incompatible content with visible loss of
capability, and prove unaffected classes continue. T-10/T-11 must prove storage
atomicity with concurrent requests rather than trusting a mutable KV pin.
These additions are acceptance criteria, not claims that those tests exist.

## Coverage and status

The original T-01~23 cover the first vertical path and its highest-risk boundaries.
T-24~46 add the previously unlinked requirements. With the classroom-admin AT/DT
scenarios, all 79 authoring/admin/design requirement IDs now have a named scenario.
This is design coverage only. Before an implementation slice is declared complete,
link each applicable scenario to executable tests or actual manual evidence.
Unexecuted requirements remain planned; no blanket PASS or inferred completion.

P0 release requires all applicable P0 requirements and their scenarios to have
evidence. A documentation PR needs documentation
validation only. A product PR must update actual test paths and results.

## API slice execution record

- `worker/test/authoring.test.mjs`: 19 checks passed locally on Node 24, real Service routing, signed tokens, and real SQLite. Covers owner/cohort/profile denial (T-01), draft save/reopen (T-02), incomplete freeze rejection (T-04), frozen document preservation (part of T-08), retry/conflict behavior (T-10/T-11), and existing admin reachability (T-21).
- `chalk/test/authoring-forward.test.mjs`: passed locally; Service verdict and header filtering preserved for authoring GET/PUT.
- Worker and Chalk existing test suites passed locally; typechecks passed.
- `worker/test/authoring-d1.test.mjs`: passed on the actual Mac with Node 24 on 2026-09-06; local workerd/D1 migration, CAS, immutable-version reopen and overwrite rejection. PR #706 CI worker/test also passed before merge.
- T-07 rehearsal invalidation, T-08 active-class version binding, actual UI and Electron flows, student participation, and production D1/deployment are NOT RUN and not implemented by this slice.
- Contract and rollback: [ADR 0004](../adr/0004-chalk-authoring-storage.md). No full product requirement is inferred complete from these subsets.

## Chalk authoring surface slice (#712)

`e2e/chalk-authoring/run.mjs` drives Chromium through Chalk HTTP forwarding to real Service routes and SQLite: Module draft import, form editing, save/reload, immutable version read, concurrent 409 with local edit preservation, 401/403 negative controls, mobile layout and no browser credential storage. Passed locally on Mac. This is instructor UI evidence, not student Electron or public deployment evidence. GitHub support links prepare a draft; receipt and assignment only exist after the instructor submits on GitHub.

## Version delivery (#739)

- T-08/T-09: `worker/test/authoring.test.mjs` exercises signed frozen-version delivery, owner/student/roster/duration denial, legacy-token compatibility, draft-versus-version separation, checksum rejection and revoked-token denial. Tool permissions remain identical.
- `e2e/chalk-authoring/run.mjs` now executes instructor mint → student `/learn` via actual Service routing/SQLite; 375/390/768/1280/1440px, keyboard hint, cleared credentials, 401 and changed-identity clearing.
- `e2e/lesson-studio/mac.mjs`: actual installed Mac shell with development extension, synthetic signed credential and local Service. This checks lesson display and explicit task insertion; it does not claim LLM completion or a shipped binary.
- Session-wide model/tool pinning, automated readiness/rehearsal evidence, all ADM/AT/DT acceptance and Windows actual-device testing remain outside this slice. Issuing another credential does not revoke existing credentials or replace the session.

Execution on 2026-09-07: Worker/Chalk full suites, both typechecks, extension smoke suite/typecheck, webview build, local authoring/classroom D1, instructor/student browser flow and the actual Mac 0.1.51 test-copy navigation passed. Mac initially failed with a stale/rejected development extension; bundle hash assertions now reject that setup. Evidence paths: `/tmp/lesson-*.log` and `e2e/test-results/{chalk-authoring,lesson-studio}/`. These are local results; production delivery and a released App containing the lesson panel are separate gates.

## Simplified entry verification

`npm --prefix e2e run test:chalk-simple` uses synthetic issuer credentials, the
actual Chalk/Service routes and in-memory SQLite. It exercises server-verified
choices, automatically named new drafts/versions, save/freeze/reopen, forged-token
denial with edit preservation, and the negative path where clearing a visible setting
removes the hidden target and blocks create/save until the setting is reselected without
discarding curriculum edits. It also checks no credential storage and 390/1280px layout.
This is local evidence; production deployment and live classroom behavior are separate.

<a id="feedback-loop-20261005"></a>

## Feedback loop — a person's feedback, the learner's answer, the retrospective and the next draft (#1013) · 2026-10-05

First slice of ledger item `feedback-loop` ([#1013](https://github.com/hypeproof/hypeproof-studio/issues/1013)): AE-42/AE-43 in
[learning-agent-experience](../requirements/learning-agent-experience.md) and CH-05/EDU-03 here. The requirement rows are not
changed; this section records what was built and what was run. Everything sits behind the Service switch
`HPS_FEEDBACK_LOOP=enabled`. Unset (the default), the new routes answer 404 `feedback_loop_unavailable`, no 0039 table is read or
written (the suite checks this on a database without the 0039 tables), share reads keep their exact shape, and `/authoring` hides
section 07 once it connects. Migration `0039-feedback-loop.sql` must be applied before the switch is turned on (it is 0039 because
0038 is the Curriculum Runtime review migration of #1398, developed at the same time). It is not in `deploy-worker.yml`: applying it
to production D1 and turning the switch on is Jay's decision (human-only step).

| Step | Contract (observable) | Rows |
|---|---|---|
| Learner's answer | After a person answered one of the learner's shares (status `answered` or `resolved`, non-empty feedback), the learner may record 고치기 / 그대로 두기 / 보류 and a reason on `/sharing` (`POST /v1/classroom/shares/:id/response`). Optional, nothing pre-selected, written once per feedback text (bound to its sha256): the same answer again is a replay, a different one is `already_answered`. Refused before any answer (`no_human_feedback`) and on an expired share (404). Feedback saved while still "검토 중" (the `/manage` default) is shown to the learner without a form; a submit that races a return to "검토 중" reads "강사가 아직 답변을 마치지 않았습니다…" and keeps the input. The answer shown (on `/sharing`, on `/manage` and to a retrospective) is the one bound to the feedback text as it is stored now, whatever the share's status: a return to "검토 중" with the same text leaves it current, and feedback edited back to a text the learner already answered shows that answer again, not a newer one. Only when no answer is bound to the current text is the newest shown, marked "이전 피드백에 대한 결정", and a new answer is allowed once the feedback is answered again. The reason is masked for credentials before storage. The share's status, revision and the learner's separate "해결됐어요" confirmation are untouched. The instructor sees the answer in the `/manage` share detail and in `/authoring` 07 "내용 보기" (both the audited share view); withdrawal and expiry delete it with the share (`ON DELETE CASCADE`) | AE-43 |
| Lesson of a share | With the switch on, a new share records the lesson its sender was executing when they sent it (`classroom_share_lessons`: course, version, lesson sha256, source; no content; deleted with the share). It is decided by the chat gate's own resolver (`resolveEffectiveLesson`): the learner code's lesson, or the setting the learner is switched to where settings are enforced. Both are checked: under `HPS_LESSON_BINDINGS=enforce`, a learner switched to another frozen version by a lesson setting (saved, sent, held by the device and switched through the existing routes) records that version with source `setting`, and a learner of the same class who was not switched records the code's version with source `token`. A code that names no lesson, a share sent before the switch, or a failed write leaves no record, and that share reads `lesson: unknown` | AE-42 |
| Sources | `GET …/authoring/:course/retrospectives/sources` lists only shares sent to this instructor, in the course's profile and cohort, unexpired, and not recorded under another course: metadata, the recorded version (or none), and which parts hold something, each with whose words it is (`learner`, `ai`, `tool`, `artifact`, `human`). Never content; `/authoring` reads content through the existing instructor share route, which writes the view audit the learner can see | AE-43, ADM-07/14 |
| Retrospective | `hps-lesson-retrospective/1` about one frozen version: hypothesis, findings that cite share parts by reference (never a copy), keep/revise/hold decisions per step or for the whole lesson with reasons, and the instructor's notes on what was not observed (all masked for credentials before storage). A cited share must have been sent after the version was frozen (`source_before_version`) and, where its lesson was recorded, under this course and version (`source_other_lesson`); a cited learner decision must answer the feedback as it reads now (`learner_response_stale`). Recomputed by the Service on every read: the version's digest and per-step help condition; a finding is `observed` only on the learner's own words (question, prompt, verification, their answer to feedback), decided by the measurement core's one predicate `isHumanEvidence` over each part read as an event. The instructor's own feedback (actor `teacher`), an AI answer, a tool line or a URL never make a finding observed (`no_person_source`); feedback sets `human_feedback: present`, otherwise it is unobserved. A finding resting on a share whose lesson was not recorded reads `lesson_unconfirmed`; one citing a decision about feedback that was later edited or cleared reads `stale_learner_response`, and a cleared feedback part reads `part_empty`, not withdrawn. `assisted` only on a cited help request; `independent` is refused (`unsupported_independence`); the denominator (current roster, learners with a cited source, the rest unobserved; help use and stopping reported unobserved, not zero). A withdrawn or expired source reads unavailable on the next read and its finding falls back to unobserved. Score-shaped keys are refused. Request bodies may be up to `RETRO_BODY_MAX` (about 635 KiB: every field at its limit at six JSON bytes per unit); a larger body is 413 `too_large`. At most 50 retrospectives about one version of a course (429 `limit_reached`); the count is per version, so a course that runs for many weeks, each next draft frozen as a new version, is never closed by its history. The list shows the newest 50 and says when there are more (`has_more`) | AE-42, AE-43 |
| Next draft | `POST …/retrospectives/:id/next-draft` writes the frozen version's content (Service bindings stripped, the same reuse `/authoring` offers) as a new draft revision and marks the retrospective applied, in one batch whose second statement lands only with its own draft write. The draft saves again as an ordinary draft body. Refused while a cited share is no longer readable or is not evidence about the version (`source_unavailable`), when the draft moved (`draft_changed`), when the version no longer reads the same (`lesson_unavailable`), for an independent course whose execution template is not reviewed now (`template_not_reviewed`), when the course now runs on another profile than the version (`profile_changed`, which also refuses editing the retrospective and writing a new one), or a second time (`already_applied`). The frozen version, its rehearsals and its confirmation are never written; nothing is frozen or confirmed automatically. An applied retrospective is immutable (`retrospective_applied`); a correction is a new one | AE-42, CH-05, VER-01 |
| Next rehearsal | The retrospective names the first version frozen from that draft revision onward (by draft revision; a candidate frozen later does not replace it, whatever its name) and its learner-condition rehearsal state (`readinessOf`, the G2 store) | AE-42, VER-02 |

**Share lifetime.** A share lives at most 24 hours (the learner's 5–1440-minute duration, capped by the learning code) and is then
purged. After that the findings citing it read unobserved, and "다음 초안 시작" is refused (`source_unavailable`) until the
instructor removes those citations. `/authoring` 07 states the window. Whether a retrospective may start a draft over expired (not
withdrawn) sources, or instructors need a longer-lived reference, is an open product decision for Jay.

### Run record

Synthetic accounts and shares only. No model call, no real class, no person's real feedback, no installed Studio, no production
database. Source: branch `feat/feedback-loop` (`099fe830`, `3a6c8269`, the review-round-1 fix `2d51e1c0` and the review-round-2
fix commit on top of it) on origin/main `4291e796`, macOS arm64, Node 24.4.1, Chromium (Playwright). Regression, rerun after
review round 2: worker `npm test` and `typecheck`, chalk `npm test` and `typecheck`, the D1 suites `test:feedback-loop:d1`,
`test:classroom:d1`, `test:authoring:d1`, `test:classroom-ops:d1`, the browser suites `test:classroom`, `test:classroom-ops`,
`test:classroom-ops-help`, `test:classroom-authoring-g2`, `test:classroom-authoring-mission`, `test:chalk-authoring`, and
`scripts/next-work.py --check` and `scripts/check-registry.py` pass on the same tree.

| Test | What ran | Result | Evidence |
|---|---|---|---|
| T-28 (CH-05) | Selected share A cited by part; share B to another instructor, a share of another class (other profile), an expired one and an unknown id refused with one answer (`source_unavailable`); a share sent before the version was frozen and one recorded under another course of the same profile refused by name; A's help request withdrawn after citing → the next draft is refused and nothing is written; the instructor removes it, then the draft starts from the version that ran, never from the drifted draft; no freeze or confirmation happens on its own | PARTIAL. The permission and withdrawal half PASS (synthetic: Service SQLite, local workerd/D1, Chromium). The model-generated draft half is NOT RUN, because it is not built: the next draft is the run version's content and holds no reference to record A (only the retrospective row links to A), and no real-model check ran | `worker/test/feedback-loop.test.mjs`, `worker/test/feedback-loop-d1.test.mjs`, `e2e/classroom/feedback-loop.mjs` |
| T-20 (EDU-03, EDU-04) | EDU-03: a submission with its change reason and checks (the existing share fields) is cited part by part with its origin. EDU-04 (an independent task different from the demo, and the scope of help used) has no record to cite yet | EDU-03 part PASS (synthetic); EDU-04 NOT RUN (not built); instructor evaluation NOT RUN | same |
| T-44 (EDU-05) | Direct / helped / expert-delegated: only the refusal half exists (`independent` refused, `assisted` only on a help request, a missing record stays unknown) | refusal controls PASS; the self-reliance record and the human review NOT RUN (not built) | `worker/test/feedback-loop.test.mjs` |

Worker (`npm --prefix worker run test:feedback-loop`, 26 checks) adds, for review round 1: the measurement core's predicate decides
every part's evidence (the instructor's feedback beside an AI answer reads `unobserved`, `no_person_source`, `human_feedback:
present`); the switch-off checks run on a database with the 0039 tables dropped and fail on any attempt to reach them; each share
records its lesson (a learner code from the existing 학생 초대 route records `token`, a code without a lesson records nothing); the
earlier/other-course/unknown-lesson cases; the "검토 중" and expired-share refusals; credential masking in the learner's reason and in
every retrospective text field; the stale-decision mark and refusal; a next draft from a version with a feature policy saves as an
ordinary draft; an unreviewed independent template is refused at next draft; a changed version document leaves the retrospective
unreadable for view, edit and next draft; a Korean doc at every field limit is accepted and a larger body is `too_large`.
Review round 2 adds: which answer a reader sees (rules, and a route check: feedback A → B → A shows the answer to A again on
`/sharing`, on `/manage`, in a conflict and to a retrospective; a third, unanswered text shows the newest answer marked as earlier and
refuses citing it; a return to "검토 중" with the same text keeps the answer current while a new one is refused); the lesson of a share
where settings are enforced, on its own fixture (a learner switched to S2 through the lesson-setting routes records S2 `setting`, an
unswitched learner S1 `token`, and each version's retrospective takes only its own share); "next" stays the first candidate after a
later one is frozen; `profile_changed` at next draft, edit and create after the course moved to another profile; the per-version
limit and `has_more`; inherited names (`constructor`, `__proto__`, …) refused as parts. The D1 suite (`test:feedback-loop:d1`, 2
checks) adds the enforced-setting case on a second local D1 database that holds the whole schema.

Browser (`npm --prefix e2e run test:classroom-feedback-loop`, 9 checks): the learner records 고치기 and a reason on `/sharing` at 390px
(nothing pre-selected, one answer per feedback text); feedback still "검토 중" shows no form, and an answer taken back to "검토 중"
after the form appeared is refused by name with the input kept; the instructor sees the decision in the `/manage` share detail;
`/authoring` 07 is hidden while the switch is off and shown when it is on; it lists only the shares sent to the instructor with the
version each was sent under and whose words each part is, and opening one writes a view audit; the saved retrospective shows 관찰 1
"관찰됨 — 학생이 쓴 말이 근거입니다", 관찰 2 (an AI answer alone) "미관찰", 관찰 3 (a help request) "도움을 받음", 관찰 4 (the AI answer and
the instructor's own feedback) "미관찰 … 사람의 피드백 있음", and the denominator; after the learner withdraws the help request the finding
reads "근거였던 공유가 철회되었거나 만료되어 볼 수 없습니다" and "다음 초안 시작" is refused; after the instructor removes it the next
draft starts from the version that ran (the drifted title is replaced, the run version byte-identical); freezing the edited draft and
issuing a rehearsal code shows "다음 후보 … · 리허설: 리허설 중"; no horizontal scroll at 390px, no page errors; and (review round 2) a
course with 51 retrospectives (50 about one version, one about the next) loads as "돌아보기 50개(최근 50개만)". Screenshots:
`e2e/test-results/classroom-feedback-loop/fl-01…05`.

**Planted defects** (each applied alone to the source, the suite rerun, the source restored; every one turned it red). First slice:

| Suite | Planted defect | Red at |
|---|---|---|
| worker (SQLite) | an AI answer counted as a person's words | rules: whose words |
| worker | the recipient boundary dropped when citing | `share-other-teacher` |
| worker | expiry ignored when citing | `share-expired` |
| worker | `independent` accepted | `unsupported_independence` |
| worker | an answer allowed before any feedback | "no answer from a person yet" |
| worker | the next draft taken from the current draft | "the next draft starts from the version that ran" |
| worker | the applied mark not tied to its own draft write | "a stale draft revision changes nothing" |
| worker | a withdrawn source still starts a draft | "a withdrawn share cannot start the next draft" |
| worker | a withdrawn share still named | "nothing about a withdrawn share is shown" |
| worker | `assisted` without a help request | "a submission is no record of help" |
| D1 | no `ON DELETE CASCADE` on the answers | the withdrawal count |
| D1 | `CREATE TABLE` without `IF NOT EXISTS` | the second apply |
| D1 | the answer insert without `ON CONFLICT DO NOTHING` | the duplicate answer (UNIQUE constraint) |
| Chalk | the learner's answer not forwarded | `POST …/response` |
| Chalk | retrospectives widened to `DELETE` | `DELETE …/rt-…` |
| browser | an AI answer labelled as a person's feedback | the sources list |
| browser | the learner's decision pre-selected | "nothing is pre-selected" |
| browser | the next draft kept the drifted draft | "the editor now holds the version that ran" |

Review round 1 (a scripted run: one exact replacement per defect, suite rerun, file restored and its hash checked). Where a pure
rule check went red first, the same defect was rerun with the rule checks skipped to show the route check catches it as well:

| Suite | Planted defect | Red at |
|---|---|---|
| worker | the instructor's feedback counted as evidence about the learner (by origin, or by giving feedback the actor `user`) | rules: whose words; route: "negative control (review F1)" |
| worker | no freeze-time check | rules: which version; route: "sent before the version existed" |
| worker | the recorded lesson ignored | rules: which version; route: "recorded under another course of the same profile" |
| worker | an unrecorded lesson read as this version | rules; route: "reads 'lesson unknown'" |
| worker | `/sources` offers shares recorded under another course | "sources: … never one recorded under another course" |
| worker | the lesson never recorded | "switch on: each share records the lesson" |
| worker | the lesson recorded with the switch off | "switch off … WITHOUT migration 0039" (an attempt to reach a dropped table) |
| worker | the switch check after the read in `responsesFor` | "switch off … WITHOUT migration 0039" (500 on the share read) |
| worker | `hasFeedback` without its status check | rules-skipped run and full run: "AE-43 boundaries" (feedback under review) |
| worker | no expiry check when answering | "an expired share takes no answer" |
| worker | the learner's reason not masked | "a credential pasted into the reason is masked" |
| worker | the hypothesis / a finding text / a decision reason / a note not masked (four runs) | "a credential in the instructor's own text is masked" |
| worker | the next draft keeps the Service binding | "the Service binding is stripped and the draft saves" |
| worker | no template admission at next draft | `template_not_reviewed` |
| worker | the view ignores the base digest / the edit ignores it (two runs) | "a changed document leaves it unreadable" |
| worker | the old 64 KiB body cap | "a doc at every field limit in Korean is accepted" |
| worker | a stale decision accepted at write / not marked at read (two runs) | rules; route: probe P4 check |
| D1 | no `ON DELETE CASCADE` on the lesson record | "the lesson record goes with the share" |
| D1 | the lesson never recorded | the lesson record on D1 |
| browser | the decision form for any feedback (the first slice's predicate) | "feedback still under review offers no decision form" |
| browser | the reason map dropped (every 409 reads "기록이 변경됐습니다") | "강사가 아직 답변을 마치지 않았습니다" |
| browser | the `/manage` detail without the learner's decision | "피드백에 대한 학생의 결정" |
| browser | section 07 never hidden | `#retro` hidden with the switch off |
| browser | the page labels a finding observed on feedback alone | "관찰 4 · 미관찰" |

Review round 2 (the same scripted method; script and results kept outside the repository). The round-2 reviewer's own set (an
unrecorded lesson read as this version, a stale revision accepted, a second answer overwriting, the rehearsal state never read, the
freeze-second boundary, the `/manage` detail without the answer, a stale decision accepted at write, the learner's answer counted as
AI, expiry ignored in the view, help use reported as 0, a resolved share refused) was rerun on this tree and every defect turned it red:

| Suite | Planted defect | Red at |
|---|---|---|
| worker | the share's lesson resolved without its class run (`classRunId: null`, the code-only path) | "lesson of a share where settings are enforced" |
| worker | the resolver skipped: the code's lesson recorded | "lesson of a share where settings are enforced" |
| D1 | `classRunId: null` | the enforced-setting lesson record on D1 |
| worker | the answer shown chosen by time only, never the one bound to the current text | rules: which answer; rules-skipped run: route "which answer is shown" |
| worker | the fallback picks the oldest answer | rules: which answer; rules-skipped run: route "which answer is shown" |
| worker | `/sharing` and `/manage` compare the answer only while the share is answered | "which answer is shown" (back under "검토 중") |
| worker | the retrospective compares the answer only while the share is answered | "which answer is shown" ("the retrospective reads the same answer as current") |
| worker | "next" picks the newest candidate / orders by version name (two runs) | "the first candidate and its rehearsal, not the newest" |
| worker | no `profile_changed` guard at next draft | "the course moved to another profile" |
| worker | parts checked with `in` | rules: the doc (`invalid_source`) |
| worker | the limit counted per course | "retrospective limit" (another version refused) |
| worker | the list never says there are more | "retrospective limit" (`has_more`) |
| browser | the page drops the "(최근 50개만)" note / the Service never sets `has_more` (two runs) | "list: … says it shows only the newest 50" |

**NOT RUN:** a real person's counter-argument and the learner's reasoning about it (AE-T37 "사람 실습"), an instructor's review of a
real class (AE-T34), the Studio App help panel (the learner can answer only on the `/sharing` web page in this slice), the
model-generated draft (T-28's model half), EDU-04/05 records, class cohorts opened from a template (their shares live in the class
cohort and are not offered to the template course's retrospective in this slice), Windows, an installed Studio, production D1 and
the switch in production.

### Trying it on the dev host

**Fastest check (one command, no app, no model key):** `cd e2e && npm run test:classroom-feedback-loop`. It runs the real Chalk
pages and the Service in-process and writes `e2e/test-results/classroom-feedback-loop/` (screenshots and `result.json`).

**By hand** (written from the scripts, not executed end to end; the command above is the executed path):

```bash
# 1. Service: switch on, schema applied to the local D1 (a fresh local database can take schema.sql instead)
echo 'HPS_FEEDBACK_LOOP=enabled' >> worker/.dev.vars
(cd worker && npx wrangler d1 execute hypeproof-studio --local --file=migrations/0039-feedback-loop.sql)
# 2. an adult class (sharing is refused for minors): roster and open session
HPS_COHORT=dental-pilot-2026-a HPS_PROFILE=dental-copyclone-2026-s1 HPS_USER=learner-a bash scripts/dev-stack.sh
# 3. Chalk on :8788 and an instructor code for teacher-a
(cd chalk && cp ../worker/.dev.vars .dev.vars && npx wrangler dev --env dev --port 8788)
HPS_SIGNING_SECRET="<from worker/.dev.vars>" node --experimental-strip-types worker/scripts/issue-issuer-token.ts \
  --instructor teacher-a --cohorts dental-pilot-2026-a --profiles dental-copyclone-2026-s1 --max-hours 12 --days 1
```

| Step | Who · where | Expected |
|---|---|---|
| 1 | Instructor · `http://localhost:8788/authoring`: connects, opens or writes the course, freezes a version, then "학생 초대 · 참여 코드 발급" for `learner-a` | A learner code bound to that version (a code from `dev-stack.sh` names no version: its shares read "보낸 수업의 버전 기록 없음") |
| 2 | Learner · `/sharing` with that code: shares a 결과물 제출 to `teacher-a` with 변경 이유·검수 내용 | "공유했습니다" |
| 3 | Instructor · `/manage` 공유 기록: opens it, writes 피드백 and 다음 조치, sets 검토 상태 to 답변 완료 and saves (left at 검토 중, the learner sees the text but no decision form yet) | The learner's card shows the feedback |
| 4 | Learner · `/sharing`: under the feedback, picks 고치기 (or 그대로 두기 / 보류), writes 이유, presses "결정 남기기" | "내 결정: 고치기 — …"; the form is gone for that feedback; `/manage` shows "피드백에 대한 학생의 결정" in the share detail |
| 5 | Instructor · `/authoring` 07 "돌아보기 불러오기" | The share is listed with "버전 …", "AI 응답(AI 응답)", "강사 피드백(사람의 피드백)", "피드백에 대한 학생의 결정(학생이 쓴 말)" |
| 6 | Instructor: picks the version, writes 가설, adds 관찰 citing the change reason + feedback + decision, a second citing only the AI answer, a third citing the AI answer and the feedback, a 결정 for a step, saves | "관찰 1 · 관찰됨 — 학생이 쓴 말이 근거입니다", "관찰 2 · 미관찰 — 학생이 쓴 말이 근거에 없습니다 …", "관찰 3 · 미관찰 … 사람의 피드백 있음", the 분모 line |
| 7 | Learner · `/sharing`: "공유 철회·삭제"; instructor: reopens the 돌아보기 | The cited part reads "철회·만료되어 볼 수 없음"; "다음 초안 시작" is refused until that source is unchecked and saved |
| 8 | Instructor: "이 돌아보기로 다음 초안 시작" | The editor holds the version that ran; the 돌아보기 shows "다음 초안 revision N"; after 04 freezes it and issues a rehearsal code, "다음 후보 … · 리허설: 리허설 중" |

With `HPS_FEEDBACK_LOOP` unset, step 5 has no section 07 to open: `/authoring` hides it after connecting.

**Where the data is.** D1 `classroom_share_responses` (the learner's answers), `classroom_share_lessons` (the version each share was
sent under), both deleted with their share, and `lesson_retrospectives` (the instructor's words and share references; `applied_*`
names the draft revision it started). Share content stays in `classroom_shares` and is read only through the audited instructor route.

<a id="feedback-loop-records-20261006"></a>

## Feedback loop, slice 2 — the learner's independent-task record and self-reliance (#1013) · 2026-10-06

Second slice of ledger item `feedback-loop` ([#1013](https://github.com/hypeproof/hypeproof-studio/issues/1013)): EDU-04 and EDU-05
here, and the part of AE-42 that reports help use. The requirement rows are not changed. Everything stays behind
`HPS_FEEDBACK_LOOP=enabled`, and no migration is added: both records live inside the share the learner chooses to send. This
supersedes slice 1's "EDU-04/05 not built"; the human parts below are still NOT RUN.

| Step | Contract (observable) | Rows |
|---|---|---|
| Independent task | On a 결과물 제출 the learner may add `independent_task` to the share content: the task in their words (how it differs from the demonstration; required, at most 2,000 characters), the help they used (one or more of `none`, `demonstrate`, `hint`, `co_edit`, `ai_made`, `person`; the middle three are the lesson's own help strategies, `HELP_MODES` without `independent`, which is a strategy and not help; `none` stands alone) and an optional note (at most 2,000). Nothing is pre-selected. The help list is stored in a fixed order, so the same choice is the same share on a retry | EDU-04, EDU-03 |
| Self-reliance | `self_reliance`: 1 to 10 items, each a piece of work (at most 500), the learner's judgment `direct` (직접 할 일), `helped` (도움을 받아 할 일) or `expert` (전문가에게 맡길 일), and an optional note (at most 1,000). Nothing is pre-selected; `/sharing` refuses a row without a judgment before anything is sent, and the Service refuses it too (`invalid_how`). A share may carry only this list (L5's 운영 판단 메모) | EDU-05 |
| One envelope | Both records are part of what the learner consents to send: the share's recipient, view audit, withdrawal, expiry and purge apply unchanged, and a correction is a new share. Credentials are masked before storage. Records go with a submission only (`record_needs_submission` on a help request). Exact keys, every refusal named (`invalid_independent_task`, `invalid_task`, `invalid_help`, `help_none_with_other`, `invalid_help_note`, `invalid_self_reliance`, `invalid_work`, `invalid_how`, `invalid_reliance_note`); score-shaped keys refused (`unsupported_score`). While the switch is on, the student body cap grows by the most the records can add (`RECORDS_BODY_MAX`, six JSON bytes per unit) | ADM-03/07/14 boundaries unchanged |
| Switch off | A body naming a record is refused exactly as an unknown field was before (400 `select supported content fields`), `GET /v1/classroom/shares` names no `share_records`, the body cap is the old one, and `/sharing` never shows the section. Turning the switch off after a records share was stored makes that share non-retryable: a retry of the same body is refused the same way (400), while the stored share stays listed for the learner, readable in the instructor's audited view and withdrawable (probed 2026-10-06; accepted as is, review r1) | — |
| Who reads them | The learner on their own `/sharing` card (내 독립 과제 기록 (자기 보고), 내 자립 범위 정리 (내 판단)). The instructor in the `/manage` share detail (독립 과제 기록 · 학생의 자기 보고, 자립 범위 정리 · 학생의 판단) and in `/authoring` 07 "내용 보기", both the audited share view. The instructor list and `/sources` carry no record text, and the retrospective view carries none either: of a cited task record it says only whether it names help (`self_reported_help`, a category derived on each read), and only once this instructor has opened that share through the audited view (a `view` row of theirs in `classroom_share_audit`, which the learner sees in 누가 열람). Before that the source reads `record_not_opened: true`, and nothing drawn from the record's content is shown or relied on (review r1: the content leaves only after the view audit, as on the share detail route). The Studio App's help panel reads only its own fields and ignores both keys | AE-43 boundaries, ADM-07 |
| Retrospective | Both are citable parts with origin `learner`, so a finding citing one is observed: the learner's own words. `assisted` now stands on a cited help request or on a cited `independent_task` part that names help (`assistance_basis`: `help_request`, `learner_report`); another part of the same share is no basis. Any help but `none` names help: `ai_made` (the AI made it), the lesson's AI help strategies and `person` all read `self_reported_help: help`, so the finding does not tell AI 대행 from 도움받은 수행; which help the learner named stays in the record, shown in the audited view. A record that says only `none` reads as the learner's self-report (`self_reported_help: no_help`) and is never a basis for `assisted` or `independent`; `independent` stays refused. A record this instructor has not opened is no basis: `assisted` on it is refused `record_not_opened` (409), the same answer whatever it says. Withdrawal or expiry takes the basis with the share (`assistance_basis_unavailable`) | AE-42, EDU-04/05 |
| Denominator | `coverage.help_reported` counts learners, from the task records this retrospective cites: any opened record naming help puts a learner under `with_help`, opened records all saying only "no help" under `no_help`, and a cited record not opened yet (with none opened that names help) under `not_opened`, labelled `source_state: self_reported`. A learner without a cited record is in none of them (unknown, never "no help"). `help_use`, what the Service itself observed, stays `unobserved` | AE-42 |

### Run record (slice 2)

Synthetic accounts and shares only; no model call, no real class, no person's real work or review, no installed Studio, no
production database. Source: branch `feat/feedback-loop-2` on origin/main `4eaa3111`, macOS arm64, Node 24.4.1, Chromium
(Playwright). Rerun on the same tree: worker `npm test` and `typecheck`, chalk `npm test` and `typecheck`, the D1 suites
`test:feedback-loop:d1`, `test:classroom:d1` and `test:authoring:d1`, the browser suites `test:classroom`, `test:classroom-ops-help`
and `test:classroom-feedback-loop`, `scripts/next-work.py --check`, `scripts/check-registry.py`, and hype-align
`align.py check --item feedback-loop` ("chain intact").

| Test | What ran | Result | Evidence |
|---|---|---|---|
| T-20 (EDU-04) | A 결과물 제출 with the result URL, the change reason and checks, and the independent-task record (the task, the help used): stored in the learner's words, read back by them and, audited, by the instructor, cited in a retrospective; a "no help" record never becomes independence; no level or grade anywhere in the view | EDU-04 record PASS (synthetic: Service SQLite, Chromium). The instructor's evaluation of a real independent task NOT RUN | `worker/test/feedback-loop.test.mjs`, `e2e/classroom/feedback-loop.mjs` |
| T-44 (EDU-05) | Direct, helped and expert-delegated rows recorded and shown as the learner's judgment; the help condition (a help request, the learner's record) and who judged kept apart; a learner without a record unknown; "no help", an AI answer and a submission never promoted to independence or a grade | synthetic record and controls PASS; the human review NOT RUN | same |

Worker (`npm --prefix worker run test:feedback-loop`, 31 checks; 5 new): the record rules (exact keys, every refusal by name, `none`
alone, a fixed help order, masking of every learner-written string, whose words, what a record says about help); the help basis
in a finding and in the denominator; the switch-off case extended (a record refused as an unknown field, no `share_records`, the
old body cap); the route (stored shape and order, masked credentials, retry with the same help in another order, a conflict on
other records, the audited instructor read, named refusals writing nothing, a record-only share); the retrospective (sources list
the record parts as the learner's words without their content; `assisted` on a record naming help; `no_help` shown and never a
basis; `independent` refused; `source_part_empty` on a share without a record; withdrawal drops the basis and the count); and the
body cap (every field and record at its limit as escaped control characters accepted past the old cap, a larger body `too_large`).

Browser (`npm --prefix e2e run test:classroom-feedback-loop`, 12 checks; 3 new): on `/sharing` at 390px the section shows only for a
결과물 제출 and only where the Service names the records (hidden with the switch off), nothing is pre-selected, "도움 없이 했습니다"
clears the other help and the other help clears it, a row without a judgment is refused before anything is sent with the input
kept, the sent records come back on the learner's card, and the form resets; `/manage` shows both records in the share detail;
`/authoring` 07 lists the record parts as 학생이 쓴 말 without content, "내용 보기" shows them (an audited view), a finding citing
the record with 도움을 받음 reads "도움을 받음(학생이 적은 도움 · 자기 보고)", a "no help" record reads "자기 보고: 도움 없이 했다고
적음(혼자 해낸 것을 관찰한 것은 아님)", the 분모 line counts both apart from what the Service observed, and 도움을 받음 on a "no help"
record is refused in the instructor's words with nothing written. Screenshots: `e2e/test-results/classroom-feedback-loop/fl-06a`,
`fl-06`, `fl-07`, `fl-08`.

**Planted defects** (slice 2; a scripted run: one exact replacement per defect, the suite rerun, the file restored and its hash
checked; every defect turned its suite red). The library defects were rerun with the pure rule checks skipped, so that the route
checks had to catch them alone. All did except one, marked below.

| Suite | Planted defect | Red at |
|---|---|---|
| worker | "no help" accepted beside other help | rules: the records; route (rules skipped): `help_none_with_other` |
| worker | records accepted on a help request | rules; route: `record_needs_submission` |
| worker | help stored in the order it was ticked | rules: "the same choice is the same stored record"; route: the stored help order |
| worker | records stored unmasked | "a credential in a record is masked before storage" |
| worker | records accepted with the switch off | the switch-off check (`select supported content fields`) |
| worker | the body cap widened with the switch off | "the cap only widens while the switch is on" |
| worker | the body cap never widened | the records body check (413 on a body the widened cap allows) |
| worker | "no help" counted as a basis for `assisted` | rules: help in a finding; route: `unsupported_assistance` expected and not given |
| worker | any part of a share with a help record is a basis | rules; route: `unsupported_assistance` on the change-reason part |
| worker | a missing record read as "no help" | rules only. No route can show it: a record part is cited only where a record exists, and every stored record names help or "none" |
| worker | a learner counted under both "help" and "no help" | rules: the denominator; route: "each learner once" |
| worker | the self-report attached to every part of the share | rules; route: "the self-reliance list says nothing about help" |
| worker | records never listed as parts | rules: `shareParts`; route: the sources list |
| worker | `share_records` named with the switch off | "no share_records key while the switch is off" |
| worker | the retrospective view never reads the record | the record finding (`assisted` from `learner_report`) |
| worker | the write check never reads the record | the retrospective citing a record that names help (400) |
| worker | a help request no longer a basis (the slice 1 path) | rules: whose words; route: the slice 1 retrospective (400) |
| browser | "도움 없이" not exclusive on the page | "\"도움 없이\" stands alone" |
| browser | records offered whatever the Service says | "switch off: no records offered" |
| browser | records offered on a help request | "records go with a 결과물 제출 only" |
| browser | the `/manage` detail without the records | the wait for "독립 과제 기록 · 학생의 자기 보고" times out |
| browser | the basis of 도움을 받음 not shown | step 3: "도움을 받음(도움 요청)" |
| browser | reported help missing from the 분모 line | the 분모 line with "독립 과제 기록에 적은 도움(학생의 자기 보고)" |
| browser | the self-report missing from the source line | "자기 보고: 도움 없이 했다고 적음(혼자 해낸 것을 관찰한 것은 아님)" |
| browser | "내용 보기" cannot show a record | the wait for "독립 과제 기록 · 학생이 쓴 말" times out |

### Review round 1 (slice 2) · 2026-10-06

- **Content only after the view audit** (major). The retrospective read `self_reported_help`, `coverage.help_reported` and the
  `learner_report` basis out of a record's content with no view audit, and its write check answered a "help" record and a "no
  help" record differently, so it could be used as a probe. Now the category is read only for a share this instructor has opened
  through the audited share view (a `view` row of theirs). Before that the source reads `record_not_opened`, the learner counts
  under `help_reported.not_opened`, and `assisted` on that record is refused `record_not_opened` (409) whatever it says. The
  retrospective writes no audit row of its own, so the learner's 누가 열람 list shows exactly the views that released the content.
- **AE-T34's help sources** (major). `ai_made` and the lesson's AI help strategies now run end to end. Rules: both name help. Route
  (`share-aimade`, `share-strategies`): refused while unopened; opened through the audited view, with the help kept as the learner
  named it; then `assisted` stands on each, and both learners count under `with_help`. Browser: 07 "내용 보기" shows "AI가 대신
  만들었습니다", and 도움을 받음 stands on that record only after it was opened. The finding still reads AI 대행 and 도움받은 수행 alike
  (`help`); whether it should tell them apart is left open. The AE-T34 note in [AE testing](learning-agent-experience.md) is
  narrowed to what ran.
- **Minor.** The `help_note` and `work` limits and a blank self-reliance note are in the rules check, and the two limits in the
  route's refusal table too. On `/sharing`, the 도움 내용 the learner typed is asserted in the stored record and on the card, and
  removing a row now resets the request id the way typing does: after a send whose answer was lost, the next send is a new share,
  not a 409. Accepted as is: the switch-off retry (contract table above). Not changed here: the instructor `PUT /shares/:id`
  returns the full content without a view audit. That is pre-existing and outside this slice.

Runs on the tree of this round's commit (macOS arm64, Node 24.4.1, Chromium), all green: worker `test:feedback-loop` (32 checks), `test:feedback-loop:d1`
(3; new: the audit lookup on D1 itself), browser `test:classroom-feedback-loop` (13; new: step 10, the resend after a lost answer),
worker `npm test` and `typecheck`, chalk `npm test` and `typecheck`, `test:classroom:d1`, `test:authoring:d1`, the browser suites
`test:classroom`, `-ops`, `-ops-roster`, `-ops-selection`, `-ops-lesson-settings`, `-ops-help`, `-ops-results`, `-ops-g1`,
`-ops-g1-wrap`, `-authoring-g2`, `-authoring-mission`, `-report` and `test:chalk-authoring`, `scripts/next-work.py --check`,
`scripts/check-registry.py`, and `align.py check --item feedback-loop` ("chain intact"). Two browser suites fail on this Mac for
reasons outside this change. `test:classroom-ops-distribution` times out in the worktree because esbuild's directory walk finds
`/Users/jaylee/node_modules/react` (19.1.0) before the suite's `nodePaths` React (18.3.1); the same tree copied under `/private/tmp`
passes 7 of 7. `test:chalk-simple` times out at `simple.mjs:45` ("리허설 후보") the same way at the branch base `4eaa3111`.

**Planted defects** (review round 1; the same scripted method; all 20 turned their suite red). The library defects were rerun with
the two record-rule checks skipped; the route checks caught all but one, marked below.

| Suite | Planted defect | Red at |
|---|---|---|
| worker | `help_note` over its limit accepted | rules; route: `invalid_help_note` |
| worker | the `work` limit raised to the task's 2,000 | rules; route: `invalid_work` |
| worker | `ai_made` read as no help | rules: help sources; route: `unsupported_assistance` on share-aimade |
| browser | `ai_made` read as no help | 도움을 받음 on the opened AI-made record refused |
| worker | the lesson's AI help strategies read as no help | rules; route: `unsupported_assistance` on share-strategies |
| worker | a blank self-reliance note kept | rules only (cosmetic: a retry still compares equal) |
| browser | `/sharing` drops the 도움 내용 | the stored record's `help_note` |
| worker · browser · D1 | the category read without the audited view | rules: `reportedHelpSeen`; route: f3 not opened; browser: "아직 열어 보지 않은 기록"; D1: `record_not_opened` |
| worker | the write check treats every record as opened | `record_not_opened` expected on share-nohelp |
| worker | the view treats every record as opened | f3 not opened |
| worker | the audit lookup dropped (nothing reads as opened) | the citation of the opened share-task refused |
| worker | the unopened refusal not named | rules; route: share-nohelp |
| worker | an unopened learner counted as "no help" | rules: the denominator; route: student-b with one record not opened |
| worker | unopened learners not counted | rules; route: `not_opened: 1` |
| browser | 07 hides the not-opened source line | "아직 열어 보지 않은 기록 — …" |
| browser | 07 drops not-opened learners from the 분모 line | the 분모 line |
| browser | 07 has no words for `record_not_opened` | the refusal in the instructor's words |
| browser | `/sharing` row delete keeps the request id | step 10: "기록이 변경됐습니다" instead of a new share |

**NOT RUN:** a real learner's independent task, the instructor's evaluation of it (T-20) and a person's review of self-reliance
cases (T-44); AE-T34 and AE-T37, which need a real class and a real person's counter-argument; the Studio App (the learner records
these only on the `/sharing` web page; the App's help panel neither offers nor shows them); the model-generated draft (T-28's model
half, still not built, so CH-05 stays partial); class cohorts opened from a template; Windows, an installed Studio, production D1
and the switch in production.

### Trying it on the dev host (slice 2)

**Fastest check:** `cd e2e && npm run test:classroom-feedback-loop` (step 9 writes `fl-06a` … `fl-08`; `fl-08a` is a record not
opened yet). **By hand,** after the
slice 1 setup above (switch on, an adult class, Chalk on :8788, a learner code from "학생 초대"):

| Step | Who · where | Expected |
|---|---|---|
| 1 | Learner · `/sharing`: 공유 목적 "결과물 제출" | "독립 과제 기록 (선택)" and "자립 범위 정리 (선택)" appear; they do not for 도움 요청, and never with the switch off |
| 2 | Learner: writes the task, ticks "AI 힌트를 받았습니다" and "강사·동료에게 도움을 받았습니다" (ticking "도움 없이 했습니다" clears the others), adds two rows (직접 할 일, 전문가에게 맡길 일), agrees and shares | The card shows "내 독립 과제 기록 (자기 보고)" and "내 자립 범위 정리 (내 판단)" |
| 3 | Instructor · `/manage` 공유 기록 → "공유 기록 열기" | "독립 과제 기록 · 학생의 자기 보고" and "자립 범위 정리 · 학생의 판단" under the shared content |
| 4 | Instructor · `/authoring` 07 "돌아보기 불러오기" | The share lists "독립 과제 기록(학생이 쓴 말), 자립 범위 정리(학생이 쓴 말)" |
| 5 | Instructor: a 관찰 citing that share's 독립 과제 기록 with 도움 = 도움을 받음, saved | Step 3 opened the share (an audited view the learner sees under "누가 열람했는지 확인"), so: "관찰 1 · 관찰됨 … · 도움을 받음(학생이 적은 도움 · 자기 보고)", and the 분모 line says "독립 과제 기록에 적은 도움(학생의 자기 보고): 받았다고 적은 학생 1명 · …" |
| 6 | A second learner shares a record with only "도움 없이 했습니다"; the instructor cites it in 07 without opening it | With 도움을 받음: refused, "근거로 고른 독립 과제 기록을 아직 열어 보지 않았습니다. …", nothing saved, and that learner's 누가 열람 stays empty. Without it: "아직 열어 보지 않은 기록 — ‘내용 보기’로 연 뒤 다시 열면 학생이 적은 도움이 보입니다", and the 분모 line counts "아직 열어 보지 않은 기록의 학생 1명(도움 여부 모름)" |
| 7 | Instructor: "내용 보기" on that share, then reopens the retrospective | "자기 보고: 도움 없이 했다고 적음(혼자 해낸 것을 관찰한 것은 아님)". Cited with 도움을 받음 now: refused, "‘도움을 받음’은 도움 요청 공유나, 도움을 받았다고 적은 독립 과제 기록을 근거로 고를 때만 적을 수 있습니다." |

**Where the data is.** Inside `classroom_shares.content_json` (keys `independent_task` and `self_reliance`), deleted with the share.
No new table.
