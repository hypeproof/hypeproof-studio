# cr-evidence evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (its dependencies are not complete). 2026-10-05. Owner: jayleekr.
Item: `cr-evidence`, issue [#1394](https://github.com/jayleekr/hypeproof-studio/issues/1394), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1444](https://github.com/jayleekr/hypeproof-studio/pull/1444), squash-merged as `03f66650e818bf50667774245d6978d282abc8ce`. The implementation's run record and claim table are in [curriculum-runtime-2026-10-02-evidence-capture.md](../testing/curriculum-runtime-2026-10-02-evidence-capture.md); the 2026-10-02 version of this file holds the review round 3 controls re-run at `03f66650` and its 23 planted defects.

## Not recorded

`cr-evidence` depends on `cr-publish`, which depends on `cr-verify`; neither is complete ([cr-publish.md](cr-publish.md), [cr-verify.md](cr-verify.md)), and `align.py record` refuses an item whose dependency is not complete.

Its own rows at `bed32b89`, from the run record's claim table and this run:
- Claimed there, positive controls green again here: CR-23–CR-28, CR-65 (the event-schema half `cr-publish` left), CR-67, CR-69, CR-72, CR-74; CR-70, whose call enforcement `cr-gateway` re-checks (a shared row).
- CR-02, partial there because the switch-off baseline was BLOCKED by F1: the baseline passes at `bed32b89` (`09-preview.spec.ts` with the switch off, 18 of 18 on both preview paths; [cr-browser.md](cr-browser.md)), and the in-app switch-off test of this item passes (below).

No row of this item is known to be unmet. When `cr-verify` and `cr-publish` are complete, this item still needs a record run of its own at that commit (the report must name it) with its planted defects repeated.

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md).

Evidence classes (MC-38): **synthetic** for the worker suites (SQLite, local workerd D1 and R2), the extension smoke and `evidence-runtime.real.mjs` (real Chromium). For `evidence-app.spec.ts`, **live-host** for the App and **synthetic** for the Service, its storage and the participants (`app-service.mjs` with `publish`; participant visits are scripted HTTP calls through the published runtime). No real model, real phone or production host.

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0; `cr-evidence: all checks passed`, 36 checks |
| `cd worker && npm run test:cr-evidence:d1` (local workerd D1 and R2; the last step, as in `pr-ci.yml`) | exit 0 in 86 s; 36 checks, `cr-evidence: all checks passed` |
| `cd e2e && npm run test:cr-evidence` (`evidence-runtime.real.mjs`, real Chromium) | exit 0; 4 of 4: CR-T23, CR-T62, CR-T67 and CR-T19 (events after revocation) in the browser |
| extension smoke `cr-evidence` | `cr-evidence smoke: 4 passed` |
| in-app `evidence-app.spec.ts` (16:55–16:58, with the whole CR config) | 2 of 2: "CR-T02 in-app, switch off: the evidence command is not reachable" and "CR-T27 in-app: an observed claim opens the three sessions it cites; a claim whose source no longer resolves shows 확인 필요". This spec was NOT RUN in the 2026-10-02 version of this file. |

## NOT RUN

- The 23 planted defects of the 2026-10-02 version of this file: not repeated, because nothing is recorded for this item.
- A real phone (CR-T23's browser half is Chromium emulating one).
- Production R2's conditional put, migrations 0032/0033 and the daily sweep in production (no deploy; Jay's decision).
- Any real model, production host, D1 migration or route.
- GitHub was not read by the recorder.
