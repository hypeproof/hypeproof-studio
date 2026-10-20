# 실행 결과 형식 `hps-blackbox-run/1`

에이전트 사전 테스터(또는 사람)가 릴리스 PR 에 남기는 블랙박스 실행 결과. 사전 테스터 댓글의
`<details>` 안 ` ```json ` 블록에 들어간다. 검사기:

```bash
node scripts/release/validate-blackbox-run.mjs run.json
node scripts/release/validate-blackbox-run.mjs comment.md --selected <컷 아티팩트>/cases.json
```

`--selected` 를 주면 선택된 케이스마다 행이 있는지도 본다 — 말없이 건너뛴 케이스는 무효다.
종료 코드 0 유효, 1 무효, 2 사용법 오류. 대조군은 `scripts/release/test/select-cases.test.mjs`.

## 필드

| 필드 | 형식 | 규칙 |
|---|---|---|
| `schema` | `"hps-blackbox-run/1"` | 고정 |
| `pr` | 정수 | 릴리스 PR 번호 |
| `head_sha` | 40자 hex | 테스트한 PR 의 head 커밋. 승인은 이 커밋에만 해당한다 |
| `rc_tag` | `vX.Y.Z-rc.N` | 설치한 rc |
| `tester` | `{kind: "agent"\|"human", name}` | 누가 돌렸나 |
| `machine` | `{os, arch}` (선택) | 예: `{"os": "macOS 15.6", "arch": "arm64"}` |
| `started_at`, `finished_at` | ISO 8601, 시간대 포함 | |
| `cases[]` | 아래 | 한 케이스에 한 행, 중복 없음 |
| `p0_verdict` | `"승인 보류 권장"` \| `"P0 실패 없음"` | P0 FAIL 이 하나라도 있으면 반드시 `승인 보류 권장`, 없으면 반드시 `P0 실패 없음` |
| `suggested_cases[]` | `{title, journey, why}` (선택) | 새 케이스 초안. 사람이 `cases.yaml` 에 옮길지 정한다 |

### `cases[]`

| 필드 | 규칙 |
|---|---|
| `id` | `BB-nnn` |
| `priority` | `P0` / `P1` / `P2` (케이스북 값 그대로) |
| `result` | `PASS` / `FAIL` / `BLOCKED` |
| `attempts` | 1 또는 2. **FAIL 은 2** — 깨끗한 프로필에서 한 번 다시 해 본 뒤에만 FAIL |
| `screenshot` | PASS·FAIL 에 필수. 경로 또는 업로드 URL. 스크린샷 없는 PASS 는 PASS 가 아니다 |
| `note` | FAIL·BLOCKED 에 필수. 무엇을 봤는지, 무엇에 막혔는지 |

BLOCKED 는 규칙상 멈춘 경우(예: 구매 케이스는 Google 로그인 화면에서 멈춘다)나 환경 문제다.
판정은 사람이 한다([README 판정 규칙](README.md#판정-규칙)).

## 예

```json
{
  "schema": "hps-blackbox-run/1",
  "pr": 2140,
  "head_sha": "0123456789abcdef0123456789abcdef01234567",
  "rc_tag": "v2026.1021.0-rc.1",
  "tester": {"kind": "agent", "name": "codex-pre-tester"},
  "machine": {"os": "macOS 15.6", "arch": "arm64"},
  "started_at": "2026-10-21T17:30:00+09:00",
  "finished_at": "2026-10-21T18:05:00+09:00",
  "cases": [
    {"id": "BB-001", "priority": "P0", "result": "PASS", "attempts": 1, "screenshot": "BB-001.png"},
    {"id": "BB-007", "priority": "P0", "result": "BLOCKED", "attempts": 1, "note": "Google 로그인 화면에서 멈춤 (사전 테스터 규칙)"}
  ],
  "p0_verdict": "P0 실패 없음",
  "suggested_cases": []
}
```
