# cr-memory evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (a row not met, and its dependencies are not complete). 2026-10-05. Owner: jayleekr.
Item: `cr-memory`, issue [#1395](https://github.com/jayleekr/hypeproof-studio/issues/1395), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1450](https://github.com/jayleekr/hypeproof-studio/pull/1450), squash-merged as `ab1caeba19b9a39727a9d6603fa23cc2e29fe5d7`. The implementation's run record and claim table are in [curriculum-runtime-2026-10-02-memory.md](../testing/curriculum-runtime-2026-10-02-memory.md); decisions and deviations are in the [plan](../plan/curriculum-runtime.md#deviations-and-decisions-recorded-by-cr-memory). The 2026-10-02 version of this file holds the round 3 controls re-run at `ab1caeba` and its 19 planted defects.

## Not recorded

`cr-memory` depends on `cr-evidence`, `cr-publish` and `cr-verify`, none of them complete ([cr-verify.md](cr-verify.md), [cr-publish.md](cr-publish.md), [cr-evidence.md](cr-evidence.md)), and one of its own rows is open:

| Row | State at `bed32b89` | What closes it |
|---|---|---|
| CR-35 | Partial in the run record: Project and Problem, Stakeholders, Hypotheses, Experiments, Observations and EvidenceItems (by reference), Decisions, ProductVersions, Metrics and DeckSlides are stored and linked; WeeklyReviews (`cr-review`'s pack) and AIUsage (`cr-gateway`'s per-project attribution, CR-34) are not, and the memory read names both as `not_in_this_read`. The plan does not list CR-35 among the shared rows. | Jay or the epic: make CR-35 a shared row that `cr-review` and `cr-gateway` extend (a plan and ledger change), or wait for those items and re-run CR-T35 here. |

Rows the run record claims, positive controls green again here: CR-36–CR-38, CR-40–CR-42, CR-75–CR-78, CR-82; CR-39 (CR-T80 re-run); CR-79 with its recorded deviation (revisions kept in the Hypothesis document rather than as a `decision_revised` learning event, accepted by the round 2 acceptance reviewer). CR-02, partial there because the switch-off baseline was BLOCKED by F1: the baseline passes at `bed32b89` (`09-preview.spec.ts` with the switch off, 18 of 18; [cr-browser.md](cr-browser.md)), and the in-app switch-off test of this item passes (below).

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md).

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0; `cr-memory (worker SQLite): OK`, 24 checks |
| `cd worker && npm run test:cr-memory:d1` (local workerd D1 and R2) | exit 0; 24 checks, `cr-memory (worker local workerd D1): OK` |
| extension smoke `cr-memory` | `5 cr-memory smoke checks passed` |
| in-app `memory-app.spec.ts` (16:55–16:58, with the whole CR config) | 2 of 2: "CR-T02 in-app, switch off: the memory command is not reachable" and "CR-T36 in-app: close, delete chat history, reopen — the same hypotheses, experiments, decisions and versions". This spec was NOT RUN in the 2026-10-02 version of this file. |

## NOT RUN

- The 19 planted defects of the 2026-10-02 version of this file: not repeated, because nothing is recorded for this item.
- Migration 0034 on production D1, any production R2, Worker route or host (Jay's deploy decision, with 0032 and 0033).
- Any real model, real phone or classroom.
- GitHub was not read by the recorder.

## Follow-ups carried from the run record (not changed here)

- R29: a participant event with no session id is counted into a metric result (a surviving plant).
- `closeExperimentAfterDeletion` and `finishExperimentDeletion` (`cr-evidence`) still write the experiment row without a revision guard.
- The `addHypothesis` race path is covered only by review.
