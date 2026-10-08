# goal evidence report

Status: evidence for the `goal` completion record (AE-01; AE-T01, its AE-01 half), written by a record-only agent. 2026-10-06. Owner: jayleekr.
Item: `goal` (학생 목표와 수업 기준 보존), issue [#554](https://github.com/jayleekr/hypeproof-studio/issues/554).
Delivered by PR [#1555](https://github.com/jayleekr/hypeproof-studio/pull/1555) (body `Closes #554`), squash-merged as `1e6257f2b101bbd6444c141bd4e790ad545f8f36`, which was `origin/main` when this record branch was cut. This report re-runs the item's three tests at `1e6257f2`. The implementation's own run record, with both review rounds, is [learning-agent-experience.md#goal-20261006](../testing/learning-agent-experience.md#goal-20261006), and its App probe file is [goal-20261006/app-goal-result.json](goal-20261006/app-goal-result.json).

## Completion boundary

- The packet cites one requirement, AE-01 in `docs/requirements/learning-agent-experience.md`, and PR #1555 delivers the whole row.
- The test is AE-T01 in `docs/testing/learning-agent-experience.md`. Its requirement column names AE-01/02. This completion rests on its AE-01 half only. The AE-02 half (material selection and the request payload) belongs to the `context` item ([#555](https://github.com/jayleekr/hypeproof-studio/issues/555)), and the test document keeps AE-T01's status NOT RUN until that half runs. This record does not change that status.
- Not claimed: AE-T36 (the end-to-end scenario, NOT RUN); the issue text's Intent Card and goal-in-prompt (outside the packet; the PR adds nothing to model requests); the follow-ups #557 and #561 that may read the goal record.
- Known reopen: the completion pins the AE-01 row with the paragraph holding `AE-01/02/36/41은 …`, and the AE-T01 row with the paragraph `AE-T01의 AE-01 절반 …` (see Record). An edit to either row or either paragraph reopens it, and it is then re-recorded with `--replace` (Harness `hype-align` ledger contract §4). The likeliest is `context` (#555) updating AE-T01 when it runs the AE-02 half.

## Verdict

PASS at `1e6257f2` for the AE-01 half of AE-T01 at all three layers of the packet, each layer turned red by planted defects. Evidence classes: **synthetic** for the smoke (pure rules, the real host handler and config path bundled behind a stand-in host, the server-rendered chat screen) and for the built webview in headless Chromium; **live-host** for the App (a copy of the shipped shell with this commit's extension and webview injected) with a synthetic Service, account, lesson seat and fixed-line model. No real model, real student, Windows or phone.

## Reviewers

| Label | Role |
|---|---|
| `goal:review:acceptance:r3`, `goal:review:adversarial:r3`, `goal:review:regression-conventions:r3` | independent review of PR #1555, round 3 (acceptance, adversarial and regression/conventions lenses), as named by the delivery coordinator. `goal:review:acceptance:r3` is named as `reviewed_by` |

The recorder is a record-only agent that wrote neither the implementation, its tests nor its reviews. GitHub was not read; local git only.

## Environment

2026-10-06, Apple M3 Pro, macOS 15.7.4 (24G517, Darwin 24.6.0), Node v24.4.1, Playwright 1.60.0. Worktree `chore/record-goal` cut from `origin/main` = `1e6257f2`; `npm ci` in `extensions/hypeproof-chat`, its `webview-ui`, `e2e` and `worker`; webview `tsc -b && vite build`, extension `npm run build:extension`. Every `node`/`npm` command ran with `NODE_OPTIONS` unset (this Mac's `NODE_OPTIONS` preloads a missing file; an environment fault, not a test result).

Builds at `1e6257f2`, sha256:

| File | sha256 |
|---|---|
| `dist/extension.js` | `2e709ee8ff94992c81ed7c0d1f3fe5975cd31a03c9c8d22a974de083ad4b3931` |
| `webview-ui/dist/assets/index.js` | `bdf7cc70442fcb8ed281877ab02f75fecef7ac101020c868a5108689b2797314` |
| `webview-ui/dist/assets/index.css` | `0f87e7eadaf209d49e86197a3b2911a2f615ddb4d02f9fae1f671972a7497137` |
| `webview-ui/dist/index.html` | `b5e4ef96f4b220ede9314970df919572dc9e3d147db8b5d9f7a62d4a5e5ee0b6` |
| `package.json` | `8de5de66917a828ddec8b610d1af97bcd9b76bc01083d545f969d14a23d84191` |

The four bundles are byte-identical to the ones the implementation's App runs injected at `bc237dcc` (the test document's run record lists the same hashes), so the merged code is the code those runs exercised.

App: a scratch copy of HypeProof Studio 0.1.51 (`d4db9049`) in this lane's own directory, marked `LSUIElement` and ad-hoc re-signed with `scripts/prep-test-app.sh`, with the five files above injected and their hashes checked in the copy. Every App run held the machine-wide app lock (`app-lock.sh`), started behind `scripts/e2e-quiet.sh` with `GATE=idle` (5 minutes without input, screen unlocked) and ran through the e2e fixture's quiet mode with `HPS_QUIET_NO_HIDE=1` (off-screen, never activated, `--use-inmemory-secretstorage`, temporary user data). Service: `e2e/sx/sx-service.mjs`, the real Service router over in-memory SQLite, lesson `sx-week3` `m2026.10.05-1` (sha256 `94c9aced1b5f39d3ce1486db707619698ba3c59629a95445f3e19cd8b477313a`) with completion conditions c1, c2, c3 on a lesson-pinned `/2` seat (`canary-sdk-contract`), a model that answers one fixed line, no network.

## Positive controls (unmutated tree at `1e6257f2`)

| Verification input | Layer | Command (from the worktree root) | Result |
|---|---|---|---|
| `extensions/hypeproof-chat/test/student-goal.smoke.mjs` | rules · real host handler and config path · rendered chat screen | `cd extensions/hypeproof-chat && node --experimental-strip-types test/student-goal.smoke.mjs` | exit 0, `PASS student-goal: 23 checks — rules, host save and config, rendered chat screen` (8 rules, 6 host, 9 screen; the screen layer rendered, not its NOT RUN fallback). Green in all 5 clean runs: alone, and before and after each of the two plant passes below |
| `e2e/sx/goal-browser.mjs` (CI `start-page`) | built webview over time, headless Chromium | `npm --prefix e2e run test:goal:browser` | exit 0, `PASS goal-browser: 7 checks, 4 planted-DOM controls reported`, no page error. Green in all 5 clean runs |
| `e2e/sx/goal-app.spec.ts` | App + synthetic Service | `app-lock.sh env GATE=idle HPS_QUIET_NO_HIDE=1 HPS_APP_PATH=<copy> bash scripts/e2e-quiet.sh env -u NODE_OPTIONS npx playwright test -c sx/playwright.config.ts goal-app` | `1 passed` (12.6 s) at 07:42 KST; `1 passed` (11.1 s) again at 07:53 KST, after the two App plants, with the clean build injected again (hashes checked) |

What the App runs read (DOM probes; the spec also runs each probe once on a planted DOM, and every planted DOM was reported):
- **First session.** Region A shows the lesson's three completion conditions (`기대 조건을 시험 전에 적었다`, `발견한 차이를 근거로 수정을 요청했다`, `같은 조건으로 다시 확인했다`) and the step's acceptance sentence as the lesson writes them, and no goal line. The closed goal block holds no field, and the first `.hp-rail-lesson` is still the lesson card (`이번 단계 안내 · 1. 기대 조건`).
- **Save and change** (the change pressed twice, saved once). Region A reads `내 목표 · 예약 버튼을 눌렀을 때 예약 화면이 바로 열리게 만들기` under the unchanged conditions, and the rail reads the two personal criteria as stored. No condition is checked off, the completion button is never enabled, and the task record's phase stays `assigned` from start to end.
- **Short window** 1280×450 (webview 1280×387). Week, mission, completion conditions, remaining steps and the first action are on screen, and the goal comes after the conditions.
- **Result beside the chat.** With the preview open beside the chat, region A and the rail show the same goal and conditions. With the conversation scrolled to its end (shell `scrollTop` 1235), the goal line is still wholly on screen.
- **Reopen** (a new App process on the same storage). The same goal and criteria come back, also in the editor's fields. With the result beside the chat on the short window (webview 640×387), the goal is inside the header's own scroll and reachable there.
- **Two chat views.** Clearing the goal in the editor chat clears it in both views, and only the editor chat says `저장했어요.`. Text typed in the sidebar survives the editor chat's save, with the "changed on another screen" sentence, and the sidebar's own save then replaces the goal in both views.

The two clean runs read the same probe values, except that the sidebar view's completion button was absent at probe time in the first run and present and disabled in the second; the verdict accepts either (nothing enabled, nothing checked off). The probe records (`e2e/test-results/sx-app/goal-result.json`, sha256 `75bb467070418cac8dc3adf906ed50767add6c75d1aee0075ab60d38ee1186a4` and `b54e060e7001dcdc8d4bfd65a163ca6aa2a6fc6ccccf70f358436141a256f705`) and the screenshots stay local; the screenshots were not used for any verdict. In them the preview pane is empty in the first session, and after the reopen the restored preview tab shows its start page and later `ERR_CONNECTION_REFUSED` for the first process's live-server URL (that server ended with the first process). The spec reads the preview's URL beside the chat in the first session, not its pixels, and does not open the preview again after the reopen, so neither is read as a finding about this item; the restored tab is a follow-up candidate for the preview's own owner.

## Negative controls

Scratch runner `mutate_goal.py`: each defect planted alone by exact-anchor replacement (the anchor occurs exactly once), its carriers run, and the file restored byte-identical (sha256 checked) before the next plant. Webview plants were built with the same vite config into a scratch directory and checked in Chromium through `HPS_WEBVIEW_DIST` after the source was restored; the extension plant was bundled with the package's own esbuild command into a scratch file. The same scratch build commands reproduce the shipped `index.js` and `extension.js` hashes on the clean tree. The pass ran twice (07:45 and 07:46 KST) with the same results; the clean controls were green before and after each pass, and `git status` was clean afterwards.

| Plant | Packet control | File | Result |
|---|---|---|---|
| P1 `storedGoalFor` returns whatever record sits under the key, without checking the lesson and activity it names | another lesson's goal is not restored | `src/studentGoal.ts` | RED: smoke `rules: another lesson's, revision's or activity's goal is never restored` (`a copied record must not pass as B's goal`) |
| P2 `acceptGoalSave` no longer refuses a save made from an older revision | a second view cannot overwrite the goal | `src/studentGoal.ts` | RED: smoke `rules: a save from an older revision, another lesson or past the bounds is refused and stores nothing` (`a second view saving from revision 0 would overwrite revision 1`) |
| P3 `acceptGoalSave` spreads the whole save message into the stored record, so a lesson's fields ride along | a student edit cannot remove a lesson criterion | `src/studentGoal.ts` | RED: smoke `rules: a save stores only the goal and personal criteria, under this lesson revision and activity` (the stored record carries the save message's other keys) |
| P4 the editor treats the goal field as untouched, so another view's save replaces the text typed there | the goal kept across chat views | `src/studentGoal.ts` (webview) | RED: smoke `rules: another view's save keeps text typed here, …`; Chromium, after its first 3 checks passed: `text typed here was not kept with the sentence when another view saved` |
| P5 the host's goal save also goes through the step-move path (`recordStepStart`) | viewing or saving records no completion | `src/chatPanelProvider.ts` | RED: smoke `host: viewing or saving a goal records no completion, step move, observation or class-board event` (`[["task-flow.step"]]` instead of none) |
| P6 the config the host sends on every mount and reconnect carries no stored goal | the goal kept after a reconnect | `src/chatPanelProvider.ts` (extension) | RED: smoke `host: reconnect — a fresh host over the same storage starts the screen from the saved goal`; App at spec line 405, the first save: region A shows no goal line (the panel reads a config whose goal is `null` as a seat without a lesson, so the save answer is not drawn either) |
| P7 the chat panel ignores the goal the config carries and draws save answers only | the goal kept after a remount or a late lesson | `webview-ui/src/ChatPanel.tsx` (webview) | RED: smoke `screen: the chat shows the saved goal and criteria beside the lesson's untouched criteria` (no goal line); Chromium at the first check: `the goal of the config that brought the lesson is not drawn (the panel did not remount)` |
| P8 region A drops the lesson's first completion condition once the learner has a goal | the lesson's criteria stay whole beside the goal | `webview-ui/src/MissionHeader.tsx` (webview) | RED: smoke `screen: the chat shows the saved goal and criteria beside the lesson's untouched criteria` (`기대 조건을 시험 전에 적었다` missing); App at spec line 411, the first save: `region A's lesson criteria changed`. Chromium stays green (7 of 7): its probes read the goal over time, not region A's conditions, which the smoke and the App read |

The App plants ran through the same copy, lock and gate as the clean runs, with the planted bundle injected (P6: `dist/extension.js` `398f9243f7a485e82915d3aa9d2c14b6c8e0e1a47ff4ce045b050013e193b296`; P8: `index.js` `4f38fdf538d77343678716c8930b9f03c6092e8958b5257ef967793b614b2fa9`). Both failed on the first attempt (07:53 KST); the clean build was then injected again for the second clean run above.

## Supporting checks at `1e6257f2`, before the record

| Command | Result |
|---|---|
| `npm run typecheck` in `extensions/hypeproof-chat`; `npx tsc -b` in its `webview-ui` | exit 0, exit 0 |
| `python3 scripts/next-work.py --check` with Harness `0d27ffe` (align-main) and with `539560f1` (the `requirement-work.yml` pin) | exit 0 with each: `17 documents, 560 requirements` |
| `python3 scripts/check-registry.py`, `python3 scripts/check-registry-coverage.py` | exit 0, exit 0 |
| `align.py check --item goal`, `align.py next --item goal` (Harness `0d27ffe`) | exit 0 `chain intact for 1 items`; offline `ready`, P0, no dependencies |

## Record

`align.py record goal --commit 1e6257f2b101bbd6444c141bd4e790ad545f8f36 --pr 1555 --tests AE-T01 --evidence docs/evidence/goal.md --reviewed-by goal:review:acceptance:r3` (Harness `0d27ffe`), first with `--dry-run` on this report before its final edit: `pinned: 6 files, 2 rows in 2 documents · scope 0c4a259d2040`, `goal would be recorded complete (dry run)`. No pinned file is shared with another work item, no document is pinned whole, and this report needs no traceability node.

| Pin | sha256 or row digest |
|---|---|
| `extensions/hypeproof-chat/src/studentGoal.ts` | `54ddc840d45707021b47f457004b9ee3c553bffe7d2a9ac4b76e9a392cb0a65c` |
| `extensions/hypeproof-chat/webview-ui/src/StudentGoal.tsx` | `e54481e1d976dbc7c84d6606088afab512b1b8ac3f2d95ee05ed640bd5f6d2cc` |
| `extensions/hypeproof-chat/test/student-goal.smoke.mjs` | `4474f7451c83599f2bcabd956a6f008990e2d1158d0f0d3b6714c91f24f55ec4` |
| `e2e/sx/goal-browser.mjs` | `9f0ec0723acb33cfd41a13340ef1de983d62911e8a6f75717b3cbe21f443db7d` |
| `e2e/sx/goal-app.spec.ts` | `768bc762c904c2f07153aaa24fcf5beab579ed9c8148b8df5af912f142c42777` |
| this report | the file as committed |
| AE-01 in `docs/requirements/learning-agent-experience.md`: the row with its table header, and the paragraph holding `AE-01/02/36/41은 …` | `ab3eb4f5bd60c9905a024c653deb90b3ebcbaed35257401e3839eb9be57675e8` |
| AE-T01 in `docs/testing/learning-agent-experience.md`: the row with its table header, and the paragraph `AE-T01의 AE-01 절반 …` | `acf98e9163e7941827b79d29e15a10781953c40e6e478bef374052afcb744fe0` |

## Not inspected

- At the App layer, as the implementation's record also states: another lesson revision (a lesson-pinned seat's activity id includes the lesson, so a new revision is a new code and activity and could pass for that reason alone; the revision boundary is checked through the real host handler in the smoke), the refusal sentence on screen (smoke and Chromium), and a lesson that arrives after the chat view was drawn (Chromium).
- AE-T01's AE-02 half (#555), Windows, a real student, a real model, a phone.
- `e2e/lesson-studio/mac.mjs`, the other SX App specs and the classroom-ops browser steps were not re-run by the recorder.
- GitHub (PR checks, issue state, review threads) was not read by the recorder.

## Open decision (not part of this completion)

Goal records of earlier lesson revisions stay on the device with no delete path, like `hps.lessonWork`; the learner can clear only the current lesson's goal. They are the learner's own words and minor cohorts are included. How long to keep them and whether to add a delete path is Jay's decision, raised in PR #1555.
