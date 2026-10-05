# cr-publish evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (rows not met, below). 2026-10-05. Owner: jayleekr.
Item: `cr-publish`, issue [#1393](https://github.com/jayleekr/hypeproof-studio/issues/1393), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1440](https://github.com/jayleekr/hypeproof-studio/pull/1440), squash-merged as `f5d5d745651f5cf0e943660b2ce85def1ad0024d` (`Refs #1393`). The implementation's run record and claim table are in [curriculum-runtime-2026-10-02-evidence.md](../testing/curriculum-runtime-2026-10-02-evidence.md); the 2026-10-02 version of this file holds the review round 3 controls re-run at `f5d5d745` and its 17 planted defects.

## Not recorded

`cr-publish` depends on `cr-verify`, which is not complete ([cr-verify.md](cr-verify.md)), and has open rows of its own:

| Row | State at `bed32b89` | What closes it |
|---|---|---|
| CR-18 | Emulated phone only (390 px in real Chromium, and in the app); the work item's positive control also needs one real phone. | Human step (Jay): open a published link on a real phone, as the live-run procedure under "§14 procedure (CR-T66)" in [curriculum-runtime.md](../testing/curriculum-runtime.md) describes (QR from Studio, mobile data, no login), and record phone model, OS, browser and screenshots. |
| CR-20, CR-64 | CR-T20 is real Mac + real phone: publish action to published version under 10 s, and to first render on a second device under 60 s, with sample size and p50/p95. Only synthetic timings exist (they claim nothing). | Human step (Jay), the same run: time both with the dev phone path (configurable public base URL and ngrok, per `docs/testing/curriculum-runtime-dev.md`). |
| CR-66 | The published runtime denies camera and microphone in runs (CR-T61); the Experiment Browser half rests on static inspection of the shipped base app, not a run. | A run in the app: a page in the Experiment Browser that calls `getUserMedia` is denied and no automation step grants a device permission. |

Rows the run record left partial that this run closes or hands on:
- CR-02: the switch-off baseline, BLOCKED by F1 in the run record, passes at `bed32b89` (`09-preview.spec.ts` with the switch off, 18 of 18 on both preview paths; [cr-browser.md](cr-browser.md)).
- CR-19: the one open case, a participant event sent with a still-valid session token after its link was revoked, needed `cr-evidence`'s events route. At `bed32b89` it runs in `cr-evidence`'s suites: real Chromium "CR-T19 (events after revocation, browser)" answers 410 with an empty body and stores nothing (22 records before and after), and the worker suite holds it on SQLite and local D1.
- CR-65: the event-schema half belongs to `cr-evidence` (a shared row, re-checked by the second item); this item's pseudonym half ran.

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md).

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0; `cr-publish (worker SQLite): OK`, 22 checks |
| `cd worker && npm run test:cr-publish:d1` | exit 0; 22 checks, `cr-publish (worker local workerd D1): OK` |
| `cd e2e && npm run test:cr-publish` (`publish-runtime.real.mjs`, real Chromium as a 390 × 844 phone) | exit 0; 9 of 9, each planted variant caught (service worker, sibling-link storage wipe, the old snippet's extra sessions) |
| extension smokes | `cr-publish` 6, `test-qr` 3 (CR-T18 positive and negative), `publish-panel` 8, `cr-switch` 12 |
| in-app `publish-app.spec.ts` (16:55–16:58, with the whole CR config) | 2 of 2: "CR-T02 in-app, switch off: the publish command is not reachable" and "CR-T17/CR-T18 in-app: verified only after an all-pass test of this version; one action publishes and the link serves" |

## NOT RUN

- The 17 planted defects of the 2026-10-02 version of this file: not repeated, because nothing is recorded for this item.
- A real phone and the dev phone path through ngrok (CR-18, CR-20, CR-64).
- The Experiment Browser half of CR-66 in a run.
- Any real model, production host, D1 migration or route.
- GitHub was not read by the recorder.
