# 운영자 사용량 읽기 검증 (#800)

REQ-L5와 [설계/감사](../design/usage-observation-audit.md)의 첫 구현 단위만 검증한다.

| 검사 | 실행 | 상태 |
|---|---|---|
| 실제 라우팅/SQLite의 범위 합계·캐시 쓰기·오류 토큰·0/미확인·빈 기록·503·입력 제한·학생/강사 거부·코호트 격리·읽기 전용 | `node --experimental-strip-types worker/test/usage-observation.test.mjs` | PASS |
| CLI SQL/출력·실패 응답 대조와 기존 실패 비용 포함 계약 | `worker/test/usage-report.test.mjs`, `worker/test/usage-log-status.test.mjs` | PASS |
| 전체 Worker 테스트/typecheck | `npm --prefix worker test && npm --prefix worker run typecheck` | PASS; 이후 CLI parser 변경은 위 두 관련 검사 재실행 |
| 실제 Admin HTML/Service의 390/1280px, 표 키보드 이동, 저장 문자열 escape, 빈 결과/조회 실패/이전 Service, 쓰기 요청 없음 | primary e2e에서 `node --experimental-strip-types --experimental-sqlite <worktree>/e2e/admin-usage/run.mjs` | PASS |
| 공급자 실제 usage/청구 대조·가격 revision·예약/정산 동시성·학생/강사 예산 화면·실제 강의 파일럿 | #800 후속 범위 | NOT RUN / 미구현 |

실기는 합성 사용자와 로컬 SQLite만 사용한다. 모델 호출·운영 D1·운영 세션 변경은 없다.
[보존한 화면과 실행 로그](../research/usage-observation-2026-09-08/README.md)는 에이전트가
직접 열어 검수했다. 실제 사람의 사용성 평가나 학습 효과 검증으로 분류하지 않는다.

## Owner console release extension (2026-10-14)

Service implementation and OU-01–07 acceptance are in
[hypeproof-service#76](https://github.com/hypeproof/hypeproof-service/pull/76),
head `40caf3921e97d7b02df895b877ba408f40835121`. This extends REQ-L5 and
ADM-08 with `/admin/owner`: a full selected-period view including trials, passes,
synthetic tests and unclassified history. The browser entry is now
`https://hypeproof-ai.xyz/admin/owner`, using existing Lab Google/GitHub SSO with
fresh active HypeProof membership per read. All member roles are authorized by
the Owner as of 2026-10-15.
Lab integration: [hypeprooflab#1247](https://github.com/hypeproof/hypeprooflab/issues/1247).

- PASS: Service Hono/SQLite controls and full premerge with the scoped SSO gate.
- NOT RUN: new SSO head CI and independent verification at documentation time.
- PASS: implementation-agent Chrome observation with synthetic local SQLite: filters,
  person/model drill-down, CSV, responsive layout and stale-data clearing.
- PASS: `node scripts/test-owner-console.mjs` exercises read-only release-smoke
  behavior: empty data, purpose aggregates, denied access, redirects, broken payloads,
  network failure and sanitized output. This uses a fake HTTP transport.
- NOT RUN: production deployment, authenticated production usage, provider invoice
  reconciliation, and human usability acceptance. The canonical merge policy currently
  requires one non-author approval for Service #76.

Studio's `deploy-worker` pins the reviewed Service head and runs the smoke controls
for dry-run and production. A real verified deployment additionally runs
`node scripts/verify-owner-console.mjs` using the dedicated
`HPS_OWNER_SERVICE_SECRET` shared with the Worker and Lab server. It only reads
HTML and aggregates, logs no identities or credentials, requires unauthenticated
requests to fail, and fails closed on malformed responses or authentication failure.
It accepts an empty ledger without asserting ingestion completeness.

Set the shared read credential on Lab, Worker and Studio Actions before
deployment. Lab uses the existing active-member ledger without a separate allowlist. Owner routes reject Basic, student/issuer tokens
and client-supplied Access headers. Other API authentication is unchanged.

Do not dispatch production until Service #76, the Lab SSO PR and the Studio release
PR meet their merge gates. Keep the normal activity-compatibility and live-session gates. Rollback
is the prior Studio deployment ref with Service `399109c0d310f6860457cfbfe789bb1b973a4943`;
this feature introduces no migration and never changes stored usage or cost data.
