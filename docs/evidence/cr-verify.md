# cr-verify evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (rows not met, below). 2026-10-05. Owner: jayleekr.
Item: `cr-verify`, issue [#1392](https://github.com/jayleekr/hypeproof-studio/issues/1392), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1437](https://github.com/jayleekr/hypeproof-studio/pull/1437), squash-merged as `74eb2309f8807d4185798f3601ff84c8b2d6f6e9` (`Refs #1392`). The implementation's run record is [curriculum-runtime-2026-10-01-evidence.md](../testing/curriculum-runtime-2026-10-01-evidence.md); the 2026-10-01 version of this file holds the review round 3 controls re-run at `74eb2309` and its 13 planted defects.

## Not recorded

The sweep records an item only when every row it cites is met. `cr-verify` has open rows, so it is not recorded, and neither are the items that depend on it (`cr-publish`, `cr-evidence`, `cr-memory`, `cr-skills`): `align.py record` refuses an item whose dependency is not complete.

| Row | Why it is not met | What closes it |
|---|---|---|
| CR-15 | No vision judgment step exists: a criterion that needs visual judgment stays "확인 안 됨" (run record: CR-T15 PARTIAL, CR-15 not claimed). | An implementation change in `cr-verify` (a vision step whose verdicts are labelled as vision-based), or Jay narrowing CR-15. |
| CR-61 | CR-T57 is ten five-step verify runs on the reference Mac, the first run's model time included; only the Studio half (re-tests, which call no model) was measured, on 2026-10-01. The first run's time with a real provider was never measured. | A real-provider run on the reference Mac. It needs a provider key on the dev Service and Jay's go-ahead to spend it. |
| CR-12, CR-14, CR-16, CR-81, and the runner cases of CR-11 and CR-68, at the in-app layer | `verify-app.spec.ts` fails at `bed32b89`, below. | A `cr-verify` follow-up, product and spec. |

CR-02's switch-off baseline, BLOCKED by F1 in the run record, passes at `bed32b89`: `09-preview.spec.ts` with the switch off, 18 of 18 on both preview paths ([cr-browser.md](cr-browser.md)).

The record is withheld by the sweep's rule, not by the tool: with `cr-browser` complete, `align.py record cr-verify --dry-run` at `bed32b89` accepts the packet (7 files and 22 rows pinned). `align.py` checks links, test ties and pins, not whether a row's acceptance is met.

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md) (same worktree, build and runs).

| Command | Result |
|---|---|
| `cd worker && npm test` (`cr-verify.test.mjs` among 68 files) | exit 0; `cr-verify.test.mjs` 22 of 22 |
| `cd extensions/hypeproof-chat && npm test` (130 smoke files) | `cr-verify.smoke.mjs` `40 cr-verify checks passed`, `verify-panel.smoke.mjs` `7 verify panel checks passed`, `cr-switch` 12, `cr-provider-neutral` 5 (the one failing step is the environmental `test:instructor-render`, see [cr-browser.md](cr-browser.md)) |
| in-app `verify-app.spec.ts` | 1 passed, 2 failed, in three gated runs: with the whole CR config (16:55–16:58, a smoke suite running alongside), alone (17:04–17:05), and alone with `e2e/fixtures/app.ts` from before #1506 (`00590823`, 17:07–17:08, #1506's protocol for a red spec among the 24 it did not re-run). The same two tests fail at the same assertions in all three, so neither load nor #1506's fixture change is the cause. |

The passing test: "CR-T02 in-app, switch off: no verify command or tool is reachable".

### In-app failure 1: the first criterion of the session reads "확인 안 됨"

"CR-T12, CR-T63, CR-T76, CR-T14 positive and CR-T57 timing in-app", at `verify-app.spec.ts:198`: three typed criteria give `["not_verified", "pass", "pass"]`, expected three passes. A scratch diagnostic run (a dump of the Service's verify log and the panel rows added before the assertion; the spec restored afterwards, sha256 checked) shows the runner's answer for criterion 1, "주문 시작을 누르면 음료 고르기가 보인다":

`[확인 안 됨] … — 콘솔 기록이 너무 많거나 늦게 읽기 시작해 일부를 읽지 못했어요` with `✓ 확인한 것: 있어야 함: combobox "음료 고르기"`.

The expectation was met; the run is not verified because its records are partial. The runner's step 0 navigates to the preview (`runCriterionPlan`), but the first observation of the session carries `recordsPartial` (`PageEventLog.attachedLate`): the event log attached after the page had loaded. Since review round 3 (`droppedRecords`/`recordsPartial` carried into the verdict), a run that would pass on an incomplete log is "not verified" instead (`evaluate` in `verification.ts`: "a clean run on an incomplete log is not a pass"; a fail or a warning stands), so the first criterion of this run cannot pass. Criteria 2 and 3 of the same run pass. The spec last passed at review round 2 (`ed2acfb5`); round 3 was covered by the smoke and unit layers, whose scripted CDP page attaches before the load. Product follow-up: a fresh start that the log observes from the load (or a reload when the first observation is partial), with an in-app check.

### In-app failure 2: the CR-T16 re-test carries two held results

"CR-T14 negative, CR-T16, CR-T76 recheck and CR-T11 runner in-app", at `verify-app.spec.ts:280`: after the fix, the re-test shows four rows, `[pass test_observed]`, `[pass retest_confirmed]`, `[not_verified test_observed]`, `[pass test_observed]`, where the spec expects the first two, and then "검증됨". CR-T16 itself holds: criterion 2 is `retest_confirmed` on the fixed version (`sha256:cc6ceb45…` after `sha256:7187b0db…`), and the fix request carried the report, criterion 2 and v0. The two extra rows are the CR-T11 external-origin criterion (not verified, out of scope) and the CR-T14 flaky criterion, both run earlier in the same session on v0. Review round 3 made a re-test re-run every open result of that version the latest run does not hold (`VerifySession.retest`, "a re-test after 테스트 시작 with fewer criteria never drops it"), so they ride along, and the version is not "verified" while one of them is not a pass. The spec predates that behaviour. Spec follow-up: run CR-T16 in its own session, or expect the held rows; whether an earlier version's open results should follow a re-test onto the fixed version is a `cr-verify` design question to settle with it.

The diagnostic runs changed nothing committed: `git status` was clean after each.

## NOT RUN

- The 13 planted defects of the 2026-10-01 version of this file: not repeated, because nothing is recorded for this item.
- CR-T57 with a real provider (CR-61), and its Studio half at `bed32b89` (the timing section of the failing test was not reached).
- A vision judgment step (CR-15 vision half).
- Any real device or phone; any real model (the in-app agent is scripted).
- GitHub was not read by the recorder.
