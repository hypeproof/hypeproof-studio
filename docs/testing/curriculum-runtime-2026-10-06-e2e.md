# Curriculum Runtime run record — `cr-e2e` (#1400), first slice

Status: run record, 2026-10-06. Item `cr-e2e`, epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), first slice (`Refs #1400`): `cr-gateway` and `cr-deck`, which the item depends on, have not landed, and the live run with a real phone is Jay's. Row definitions: [curriculum-runtime.md](curriculum-runtime.md). Decisions and deviations: [plan](../plan/curriculum-runtime.md#deviations-and-decisions-recorded-by-cr-e2e). How to try it: [curriculum-runtime-dev.md](curriculum-runtime-dev.md#cr-e2e--the-prd-14-loop-week-1--week-2-1400). Not a completion record: nothing here is recorded in the ledger.

## Claims

| | Rows | Why |
|---|---|---|
| Met in this run, on the reference Mac | CR-59 | CR-T55 in the Studio app: preview refresh after a save, p50 260 ms (n=30, p95 269 ms, max 269 ms, no failure), under 2 s; the planted 3 s delay read as a miss (p50 3,262 ms, n=3). Decision 9's measurement, in the app |
| Met in this run, on the reference Mac | CR-60 | CR-T56 in the Studio app: element capture to the chat's queued element, p50 28 ms (n=30, p95 34 ms, max 35 ms), every crop the element's border box (244×100 px for a 122×50.5 px button at 2×); the planted full-page screenshot read as a miss |
| Partial, remainder named | CR-02 | CR-T02's whole inventory as it stands: every command, proxy tool and Worker route of every item from `cr-browser` to `cr-review` unreachable with the switch off and present with it on, in the app; the stored-bytes exception; the Worker half; `09-preview.spec.ts` on both preview paths with the switch off. Open: the surfaces `cr-gateway` and `cr-deck` will add (the walk reads the inventory, so it covers them when it runs again after they land), Jay's answer on the director's five-minute palette window (open question 2 of #1537), and `25-mid-stream-reveal.spec.ts` (not run, below) |
| Partial, remainder named | CR-71 | CR-T66's scripted run: steps 1–14 PASS and step 15 PARTIAL, each step reading the previous step's record; the planted break stops the loop at step 10. Open: step 15's stored proposals (CR-56, `cr-deck`) and the live run on a real Mac with a real phone (Jay) |

## What was run

- Code: branch `feat/cr-e2e` off `origin/main` `16b86879`; the in-app runs below at `5ea515eb` (the three specs, the Service harness and the dev kit committed). No product code changed: `git diff 16b86879..5ea515eb -- extensions/ worker/src chalk/` is empty.
- Machine: Apple M3 Pro (`Mac15,6`), macOS 15.7.4, Node 24.4.1 (Playwright and the worker suite), Node 22.22.1 (`scripts/dev-stack.sh`'s wrangler).
- App: a scratch copy of HypeProof Studio 0.1.51 (`d4db9049`, from `/Applications`, never launched from there), the lane's copy `/private/tmp/claude-501/app-cr/`, marked `LSUIElement`, with the extension and webview built from this branch injected and re-signed ad hoc; the injected bundles equal the build (`extension.js` `3021c466…`, webview `index.js` `8b99ebd0…`, `index.css` `42019ae6…`, `index.html` `b5e4ef96…`). Every app run held the machine-wide app lock, waited for five minutes without input with the screen unlocked (`GATE=idle`), ran in quiet mode (off-screen, never focusable, not hidden: `HPS_QUIET_NO_HIDE=1`), with in-memory secret storage and a temporary user data directory.
- Service: `e2e/curriculum-runtime/app-service.mjs` (the real Service router; SQLite D1 and an in-memory R2; `http://{project}.test.invalid:18931` test origins; the scripted coach). For `09-preview.spec.ts`: `scripts/dev-stack.sh` (local `wrangler dev`, a dev-only random signing secret, no provider key), profile `sk-biopharm-kids-2026-grade-3-4-s1` served with `curriculum_runtime: {enabled: false}` and `preview.type: live_server`.
- Evidence classes (MC-38): **live-host** for the App (the integrated browser, its CDP, VS Code's file watcher, the chat and the panels); **synthetic** for the Service account and storage, for the model (the scripted coach answers from what reached it, and only tagged requests) and for steps 7–8 (Chromium on this Mac as a 390 px phone). Executor: the `cr` delivery lane, unattended.

## Results

| Row | Layer and file | Result | Controls |
|---|---|---|---|
| CR-T66 (scripted run) | in-app `e2e/curriculum-runtime/loop-app.spec.ts` | PASS (14 steps) + step 15 PARTIAL, 28.1 s | The table below. Earlier full runs the same day: 2 positive, 2 negative, all as here |
| CR-T66 negative | the same spec, planted break after step 8 | PASS: stopped at step 10 | Steps 1–9 passed; the participant session's key was removed behind the record's back (`/__cr/plant-dangling`, no tombstone), so the Evidence skill's context carried no session; step 10 failed on "the draft's observations cite the step 8 participant session (cited: [note:…])"; steps 11–15 NOT RUN |
| CR-T55 | in-app `e2e/curriculum-runtime/timing-app.spec.ts` | PASS: p50 260 ms, p95 269 ms, max 269 ms, n=30, no failure | Instrument control: the watcher reads the document already shown. Negative: the preview's own browser session (not the default session) held each reload's document request 3 s: 3,262 / 3,265 / 3,258 ms, p50 3,262 ms, read as a miss; the delay was removed afterwards. Earlier run the same day: p50 260.5 ms (n=30), planted p50 3,265 ms |
| CR-T56 | in-app `e2e/curriculum-runtime/timing-app.spec.ts` | PASS: p50 28 ms, p95 34 ms, max 35 ms, n=30 | Every crop checked against the element's box at the page's device pixel ratio (244×100 px = 122.2×50.5 px × 2). Negative: the same tab's full-page capture (1,128×1,588 px = the 564×794 viewport × 2) fed to the same check read "covers the whole viewport" and the sample set a miss. Earlier run the same day: p50 29 ms (n=30) |
| CR-T02 (whole inventory, switch off) | in-app `e2e/curriculum-runtime/switch-app.spec.ts` | PASS | 8 student commands and the stored-bytes exception absent from the learner's palette; the director's command absent with an issuer token stored; none of the 7 CR proxy tools offered; all 40 inventoried Worker routes answered as an unknown route of their kind (status, body and headers; test-origin routes as the test origin's unknown path). Planted into the walk and reported reachable: the HTML preview command (shown), `browser_navigate` (offered), `GET /v1/profile` (200, body and headers differ); an unregistered path passed the route check |
| CR-T02 (whole inventory, switch on) | the same spec | PASS | All 8 student commands and the director's (issuer token stored) shown; all 7 CR proxy tools offered; the delete exception hidden while nothing is stored |
| CR-T02 (stored-bytes exception, cr-browser's) | in-app `e2e/curriculum-runtime/app-layer.spec.ts` (`CR-T02 in-app, switch off`, `CR-T02 exception`) | PASS (2 of 2) | Hidden before anything is stored, shown once 11 blobs were stored, still shown after a relaunch with the switch off while the results and pick commands stayed hidden, its dialog counted and asked, hidden again after the delete |
| CR-T02 (switch-off baseline, preview and HTML creation) | in-app `e2e/tests/09-preview.spec.ts` | PASS (6 of 6) | REQ-D1/D3/D6, REQ-D4 and REQ-D5 (the coach's HTML saved as `index.html`) on the served live path and on the webview path through the spec's forwarder. The spec's planted regressions M1–M6 (#1508) were not planted again |
| CR-T02 (Worker half) | `worker/test/cr-switch.test.mjs` in `cd worker && npm test` | PASS | Every inventoried route answers as an unknown route with the switch off; the planted routes are caught |

### CR-T66, step by step (the run at `5ea515eb`)

| Step | Result | Evidence class | Read (the previous step's record, and where) | Record |
|---|---|---|---|---|
| 1 open v0 | PASS | live-host | — | artifact version v0 `7187b0db` (`app.js`, `index.html`, `style.css`), as the App computes it for the open page |
| 2 v0 in the Experiment Browser | PASS | live-host App, synthetic model | the App's version `7187b0db` (publish panel) | observation of the preview: URL, route, viewport 564×794, document generation, the first screen's three buttons with refs, a screenshot, bound to `7187b0db`; the stored result reads "현재 버전" |
| 3 pick an element, AI edit | PASS | live-host App, synthetic model | the payload bound to `7187b0db` (the chip's text, which the coach received word for word, with the crop) | `index.html` with `#begin` made bigger: v0′ `2ee31cbe` |
| 4 three criteria | PASS | live-host App, synthetic model | v0′ untested (verify panel) | three `criterion_set` events, the student's own, on v0′ |
| 5 AI Verify | PASS | live-host App, synthetic model | the three criteria (report rows) | `hps-verification/1` run on v0′: pass ×3 with their steps, "검증됨" (first run passed, no re-test) |
| 6 publish and start the test | PASS | live-host App, synthetic Service | "검증됨" for v0′ and the run (publish panel) | the test version keyed by v0′ with the report attached, the experiment pinned to it, its hypothesis, the link with its QR |
| 7 a participant opens the link | PASS | synthetic | the share URL (publish panel) | first render at 390 px in 63 ms, no login; a participant session |
| 8 the session and its events | PASS | synthetic | that session (evidence read) | 7 events (1 page view, 4 clicks), a `pp-` pseudonym, version v0′, channel "학교 게시판"; on the stored objects every event is `source_state: real`, attributed to the project, experiment and version, with no identity-like key |
| 9 a manual observation | PASS | live-host App, synthetic Service | the experiment (evidence panel) | an observer note with who, when and where, `source_state: real` |
| 10 the Evidence skill | PASS | live-host App, synthetic model | the session of step 8 and the note of step 9 (the draft's source references, all resolving) | an AI draft: 2 observations, 1 interpretation, 1 assumption, 1 next experiment |
| 11 accept or edit | PASS | live-host App, synthetic Service | the AI draft (evidence panel) | revision 5: observations accepted, the interpretation in the student's words, the assumption accepted; the 10 raw objects (events, sessions, the note) byte-identical before and after |
| 12 the decision | PASS | live-host App, synthetic Service | the 3 reviewed evidence items (memory read, offered by the panel) | the team's decision on those 3 items, slides 2 and 3; still one hypothesis and one experiment, the step 6 ones |
| 13 v1 | PASS | live-host App, synthetic model | the decision, with no version yet (memory read) | v1 `6a29e25c` written by the coach, registered with the panel's own set builder and upload (`register-version.mjs`), named by the decision's `resulting_version_id` (memory read and panel) |
| 14 the Weekly Review | PASS | live-host App, synthetic model | the records of steps 5–13 (the pack's sources, every one resolving) | a cached pack: the experiment and v0′ it tested (whose version record carries the step 5 report), the observed items of steps 10–11, the edited interpretation, "새 버전: v1" with the decision that made it, slides 2 and 3; reopened with 0 model calls |
| 15 the Deck Builder | PARTIAL | live-host App, synthetic model | the decision on slides 2 and 3 (skills panel) | patch proposals for slides 2 and 3 only, each citing the decision's usable evidence, accepted by the Service's gate; nothing stored, because storing and accepting them is `cr-deck`'s (CR-56) |

The synthetic CR-20 figures of this run (not CR-T20): 69 ms from the publish press to the share URL in the panel, 63 ms from opening the share URL to first render in Chromium.

## The dev kit and its parts

| What | Run | Result |
|---|---|---|
| `scripts/cr-dev-kit.sh --dry-run` (with and without `--phone`, `--no-app`) | prints the state, origin or tunnel, Service and app commands; an unknown option exits 2 | as expected |
| `scripts/cr-dev-kit.sh --no-app` | Service on 8787 (health 200), the kiosk in the workspace, the two token files; a published link at `http://prj-….localhost:8787` answered 302 to its `index.html` with the participant snippet; SIGTERM stopped the Service | PASS |
| `scripts/cr-dev-kit.sh --phone --no-app` | ngrok's https address read from its log, a published link opened through the tunnel (302 → `index.html` with the snippet), `/v1/health` and `/__cr/state` answered 404 through the tunnel; SIGTERM stopped the Service and ngrok | PASS. The first try failed on macOS's bash 3.2 (`${PIDS[-1]}`); fixed and re-run |
| Through a shared tunnel host, against `app-service.mjs` directly | `/v1/health`, `/admin/cohorts`, `/__cr/state`, `POST /__cr/plant-dangling` → 404; `/l/<link>/` reaches the Service; loopback keeps `/v1/health` and `/__cr/state` | PASS |
| `scripts/studio-dev.py --inmemory-secrets` (`scripts/test-studio-dev.py`) | the flag only when asked, and `run` passes it through | PASS (20 tests, 1 skipped). Planted: the flag never added → red; always added → red |
| `e2e/curriculum-runtime/register-version.mjs` | `latest` project and decision, an explicit decision, a decision that already names a version, no decision, bad usage | as expected; a refused link leaves nothing uploaded |

## Gates

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0 (`cr-traceability: OK — 84 requirements · 80 tests`, `cr-recon (CR-T01): OK`, `cr-switch (CR-T02 Worker half): OK`) |
| `python3 scripts/next-work.py --check` (Harness at the CI pin `539560f1` and at `0d27ffe`) | exit 0 |
| `python3 scripts/check-registry.py` | OK |
| `align.py check --item cr-e2e` (Harness `align-main`) | chain intact |
| `python3 scripts/test-studio-dev.py`, `local-runtime.smoke.mjs`, `codex-rehearsal.test.mjs`, `scripts/test/review-pr-shell.test.sh` | pass |
| `cd e2e && npm run test:cr-publish && npm run test:cr-evidence` (the `cr-publish / real Chromium` job) | exit 0, exit 0 |

## NOT RUN

- CR-T66's live run on a real Mac with a real phone (steps 7–8 by a person, mobile data, the QR scanned, CR-20/CR-64 timed): Jay's step, prepared in the dev kit and the §14 checklist. With the scripted coach steps 3, 5, 10, 14's AI section and 15 are synthetic and would be NOT RUN in a live run; it needs `cr-dev-kit.sh --phone --real-model`.
- Step 15's stored proposals, accept and reject, and their place in the pack (CR-56, `cr-deck`).
- CR-T02 over the surfaces `cr-gateway` and `cr-deck` will add (not in the inventory yet).
- `e2e/tests/25-mid-stream-reveal.spec.ts` (REQ-D2): it launches the app outside the quiet fixture, which the app-test rules do not allow.
- The dev kit's app launch and `--real-model` by an agent: the launch takes the screen, and a real model spends credit.
- #1436 (`cr-verify` follow-up: CR-15's vision judgment, CR-61): the loop does not need it (its criteria are DOM checks).
- GitHub was not read by this run.

## Findings (not fixed here)

1. No panel registers a product version without starting a test of it, and none names the version a decision made; step 13 uses `register-version.mjs` (the panel's own calls). A control for both is a follow-up for `cr-memory` or `cr-publish`.
2. `cr-browser`'s completion pins `e2e/curriculum-runtime/app-service.mjs` as a whole file and is already reopened on `main` by #1537's edit of it; this slice edits it too. Re-recording `cr-browser` with its own spec files as inputs would stop the cascade.
3. `scripts/studio-dev.py` keeps every replaced development app in the state directory as `previous-<uuid>.inactive` (about 460 MB each), so repeated kit runs grow the disk.
4. The e2e package has 32 pre-existing `tsc` errors (implicit `any` in `app.evaluate` callbacks); `tsc` is not a CI gate there.
