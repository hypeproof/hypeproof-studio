# Charter interview

`/hype-loop start` must not schedule anything until a charter exists and the person has
seen its summary. The interview is the only question round in the loop's life (L10):
everything the loop would otherwise stop to ask is asked here, once.

## How to ask

- Use the `AskUserQuestion` tool. Up to 4 questions per call, so the whole interview is
  usually 2–3 calls. Put the recommended option first and label it "(권장)".
- Ask in Jay's chat language (Korean by default). Keep the charter's values in English
  where they are engineering terms, so the tick prompt stays English.
- Skip a question when the arguments or the conversation already answer it. Example:
  `/hype-loop start 20 --every 30m -- <text>` answers rounds, interval and the
  instruction; do not ask them again.
- For reversible choices, pick the default, record it, and do not ask (L15). Ask only
  what would change the plan.
- `/hype-loop start` with no instruction runs the full interview, starting with the goal.

## Question bank

| Key | Question (Korean, as asked) | Recommended first option | Other options |
|---|---|---|---|
| `goal` | 이 루프가 끝났을 때 무엇이 달라져 있어야 하나요? | (context-specific summary of what Jay asked) | free text via "Other" |
| `done_condition` | 언제 "끝"으로 보나요? | 지정 횟수 완료 또는 작업 큐가 빔 | 특정 PR/이슈 머지; 실제품에서 확인; 횟수만 |
| `scope` | 어디까지 건드려도 되나요? (repo·경로) | 현재 repo만 | Studio+Service; harness 포함; 경로 지정 |
| `rounds` + `interval` | 몇 번, 얼마 간격으로? | 20회, 30분 | 10회 30분; 48회 30분(하루); 직접 입력 |
| `autonomy.merge` | 머지는? | allowed — CI 초록 + 검증 통과 시 (`autonomous-loop-merge-policy`) | ask; never |
| `autonomy.prs` | PR은? | allowed now | later (Jay가 나중에, 브랜치 push만); never |
| `autonomy.deploy` | 배포는? | ask | allowed (flags off 먼저, L12); never |
| `autonomy.prod_writes` | 운영 데이터 쓰기는? | never | ask; allowed (라이브 수업 확인 + 백업 후) |
| `verification` | 검증 기준은? | 새 테스트가 base에서 실패하고 head에서 통과 + 독립 검증자 | 기존 테스트 통과만; 실제품 확인까지 |
| `models` | 모델 배치는? | Opus 구현·검증 / Sonnet e2e·기록·보고 / Haiku gh 레인 (L8) | 전부 Opus; 전부 Sonnet |
| `budget` | 예산 한도는? | 틱당 에이전트 ≤6, 주간 사용량의 40% | 제한 없음; 직접 입력 |
| `reporting` | 보고는 어떻게? | 매 틱 한국어 3–5줄 + HTML 대시보드 갱신 | 대시보드만; 끝날 때만 |

Optional keys the interview may fill without asking when context makes them obvious:
`branch_prefix` (never `free-start/`, L13), `integration_branch` (L4), `freeze_hook`
(the live-class check command, L12), `release_targets` (default `macOS arm64`, L14),
`priorities` (ordered list), `human_steps` (how to hand a step to Jay, L10).

## Charter file

Write the answers to `~/.hypeproof/loop/charter-draft.json` (not the scratchpad; L3):

```json
{
  "goal": "Drain Studio REQ-ready items into merged PRs",
  "done_condition": "20 ticks or next-work.py reports nothing ready",
  "scope": ["hypeproof/hypeproof-studio"],
  "rounds": 20,
  "interval": "30m",
  "autonomy": {"merge": "allowed", "prs": "allowed", "deploy": "ask", "prod_writes": "never"},
  "verification": "red-before-green test plus independent verifier",
  "models": "Opus implement/verify, Sonnet e2e/clerk/report, Haiku gh lane",
  "budget": "<=6 agents per tick",
  "reporting": "Korean 3-5 line status each tick + HTML dashboard",
  "priorities": ["live/prod issues", "ready requirements"],
  "defaults_chosen": ["release_targets=macOS arm64 (L14)"]
}
```

Then run `loopctl.py charter-check --charter <file> --instruction-file <file>`. It
validates the charter and prints a Korean summary. Show that summary to the person as
a short block. Treat the person's next message as confirmation unless it changes
something; then pass `--confirmed` to `start`.
