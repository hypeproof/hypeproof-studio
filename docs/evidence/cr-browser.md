# cr-browser evidence report

Status: evidence for the `cr-browser` completion record (CR-02–CR-11, CR-68; CR-T02–CR-T11, CR-T63), written by the record sweep. 2026-10-05. Owner: jayleekr.
Item: `cr-browser`, issue [#1391](https://github.com/jayleekr/hypeproof-studio/issues/1391), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1428](https://github.com/jayleekr/hypeproof-studio/pull/1428) (`0d0633ca`, partial) and finished by PR [#1433](https://github.com/jayleekr/hypeproof-studio/pull/1433), squash-merged as `1557e0381a320a6921d8b90fc6e205312f031450`. Two files its in-app runs go through, `e2e/tests/09-preview.spec.ts` and `e2e/fixtures/app.ts`, were changed by PR [#1508](https://github.com/jayleekr/hypeproof-studio/pull/1508) (F1, issue [#1506](https://github.com/jayleekr/hypeproof-studio/issues/1506)). This report re-runs every test the record names at `bed32b895edc5eceb9fcb9c8cd089cc238c02ed0`, the `origin/main` commit the sweep branched from; the implementation's run record with all review rounds is [curriculum-runtime-2026-09-30-evidence.md](../testing/curriculum-runtime-2026-09-30-evidence.md), and the 2026-10-01 version of this file holds the run at `1557e038`.

## Why it can be recorded now

The 2026-10-01 record was refused upstream: `cr-recon`'s completion was reopened and CR-T01 still mapped CR-59/CR-60 to this item. #1508 revised the recon for decision 9, and the sweep re-records `cr-recon` first (see [cr-recon.md](cr-recon.md)).

Three hand edits to `verification_inputs` come with this record (this item had no completion, so nothing reopened):
- `docs/requirements/curriculum-runtime.md` and `docs/testing/curriculum-runtime.md` are removed. `align.py` at Harness `4df7d3c` refuses a requirement document, or a test document holding the completion's test pins, as a verification input: the completion pins the rows of CR-02–CR-11, CR-68 and of the eleven tests instead, so an edit to another row (each later item adds rows and status-line clauses) no longer reopens it.
- The directory `e2e/curriculum-runtime/fixtures/kiosk-practice` is replaced by its six tracked files (`index.html`, `style.css`, `app.js`, `escape.html`, `redir.html`, `typo.html`): `record` pins files and refused the directory.
- Three shared e2e suite files are removed: `e2e/curriculum-runtime/playwright.config.ts` (its `testMatch` lists every item's in-app spec, so every CR slice from this one to `cr-skills` edited it, and each later item that adds an in-app spec will), `e2e/fixtures/app.ts` (the fixture of the whole e2e suite; 9 commits since 2026-09-01, 7 of them not CR work) and `e2e/tests/09-preview.spec.ts` (a main-suite spec). Pinned whole, they would reopen this completion on the next CR slice or fixture change. The runs below went through them as they are at `bed32b89`: sha256 `05e65623…`, `46892a2a…` and `bd1118dd…`. `e2e/fixtures/app.ts` stays in `implementation_paths`; this item's own instruments (in-app spec and service, smokes, fixture app, real-Chromium script, worker tests) stay pinned.

## Completion boundary

- CR-59 and CR-60 are `cr-e2e`'s (Jay's decision 9) and are not claimed.
- Shared rows, per the plan ("For a shared row, an earlier item runs the cases of its CR-T row that its own code reaches"): CR-02, the cases of the surfaces this item adds (five CR tools, the pick and results commands, the delete-command exception) and the switch-off preview baseline; the walk of every item's inventory and the HTML generation regressions with the switch off are `cr-e2e`'s. CR-03 is re-checked by `cr-verify`. CR-11, agent browser actions on the live-server origin; the runner's cases are `cr-verify`'s, published test origins `cr-publish`'s. CR-68, agent browser-tool steps; verify runs are `cr-verify`'s.

## Verdict

PASS at `bed32b89` for CR-T02–CR-T11 and CR-T63 at the layers below, each with a planted defect that turns it red. Evidence classes (MC-38): **synthetic** for the unit and smoke suites and real Chromium; **live-host** for the App in the in-app specs (integrated browser, proxy loop, local record, command palette) with a synthetic account, session and scripted agent. No real model, no real device or phone.

## Reviewers

| Label | Role |
|---|---|
| `cr-browser:review:acceptance:r3`, `cr-browser:review:adversarial:r3`, `cr-browser:review:regression-conventions:r3` | independent review, round 3 of the finish (PR #1433) |
| `cr-unblock:review:r1` | independent review, round 1 of PR #1508: the `09-preview.spec.ts` and `e2e/fixtures/app.ts` changes the runs below go through |
| `cr-record-sweep:review:r1` | independent review of the runs at `bed32b89` and of this record, round 1 of the sweep (ledger, evidence truth and conventions lenses). It repeated part of the runs: the record in a clone of the branch, `app-layer.spec.ts` in the app (3 of 3) with two plants (an outline never painted, red; B13's plant, green, see Findings), real Chromium (55 of 55) and the carrier smokes. Its findings are applied in this version. Named as `reviewed_by` |

The recorder is a record-only agent that did not write the implementation or the #1508 changes.

## Environment

2026-10-05, Apple M3 Pro, macOS 15.7.4 (Darwin 24.6.0), Node v22.22.1. Worktree `chore/cr-record-sweep` cut from `origin/main` = `bed32b89`; `npm ci` in `packages/measurement`, `worker`, `extensions/hypeproof-chat`, its `webview-ui` and `e2e`. No pinned file differs from `bed32b89`.

App: a scratch copy of HypeProof Studio 0.1.51 (`d4db9049`), marked `LSUIElement` (`scripts/prep-test-app.sh`), with the extension and webview built at `bed32b89` injected (`e2e/classroom/mac-devhost.mjs reinject`: 4 bundle hashes equal to the build; `dist/extension.js` `8f00ca64…`, the same bytes as #1506's `00590823` build). Every app run waited for 5 minutes without input with the screen unlocked (`GATE=idle`), held the machine-wide app lock (`app-lock.sh`) and ran quiet (off-screen, not focusable, in-memory secret storage, temporary user data). The fix round for review r1 (18:11–18:16) ran its in-app controls from a scratch clone at `bed32b89` through the same copy and gates. Service: `app-service.mjs` for the CR specs (switch on or off per test); `scripts/dev-stack.sh` (local `wrangler dev`, dev-only signing secret, no provider key; cohort `kids-workshop-2026-a`, switch off) for `09-preview.spec.ts`.

## Positive controls (unmutated tree)

| Test | Contract layer | Run at `bed32b89` | Result |
|---|---|---|---|
| CR-T02 | Playwright e2e + worker D1 | in-app `app-layer.spec.ts` "CR-T02 in-app, switch off" and "CR-T02 exception in-app" · `09-preview.spec.ts`, switch off, both preview paths, `--repeat-each=3` · smokes `cr-switch` (12), `cr-host` (21) · worker `cr-switch.test.mjs` | all pass: 2 of 2 in-app, 18 of 18 preview checks (17:01–17:04), `cr-switch (CR-T02 Worker half): OK` |
| CR-T03 | unit | smoke `cr-provider-neutral` | `5 provider-neutral checks passed` |
| CR-T04 | extension smoke | smoke `experiment-browser` (35) · real Chromium `test:cr-browser` | pass · 55 of 55 |
| CR-T05 | extension smoke | the same | pass |
| CR-T06 | extension smoke | the same | pass |
| CR-T07 | Playwright e2e | in-app "CR-T02/07/08/09/10/63 in-app, switch on" · real Chromium | pass: five steps to the order screen, step 4 disabled reported at step 4 |
| CR-T08 | Playwright e2e | the same in-app test · smoke `experiment-browser` · real Chromium | pass |
| CR-T09 | Playwright e2e | the same in-app test · smoke `element-pick` (12) · real Chromium | pass |
| CR-T10 | unit | smokes `artifact-version` (6), `cr-host` · worker `cr-browser-refs.test.mjs` (16 of 16) · the same in-app test | pass |
| CR-T11 | extension smoke | smokes `experiment-browser`, `cr-provider-neutral` (parity) · real Chromium | pass |
| CR-T63 | Playwright e2e | the same in-app test · smoke `experiment-browser` | pass |

The in-app run (16:55–16:58) was the whole CR config, 14 tests: `app-layer.spec.ts` 3 of 3 and the other items' specs as their reports say. Supporting gates at the same tree, all exit 0: `extensions/hypeproof-chat` `npm test` through all 130 `*.smoke.mjs` files and the review, Chalk and `test:activity-resume` suites (the one exception, `test:instructor-render`, fails on this Mac only: `react` 19.1.0 resolves from `~/node_modules` while the webview pins 18.3.1, the environmental failure the `cr-skills` record noted; CI has no `~/node_modules`), extension typecheck, `worker` `npm test` and typecheck, the eight D1 suites of `pr-ci.yml`, `validate-profiles`, the cohort-harness self-test (23 of 23, `teen-cr` among them), `next-work.py --check`, `check-registry.py`.

## Negative controls

Scratch runner `mutate_browser.py`: each defect planted alone by exact-anchor replacement (anchor count checked to be 1), its carrier suites run, the file restored byte-identical (sha256 checked) before the next. The clean tree ran every carrier green before the first plant and after the last; `git status` was clean afterwards. The fix round for review r1 (18:06–18:10) ran every plant again, in a scratch clone at `bed32b89`, with B13n added: each gave the result below, the controls before and after were green, and the clone was clean afterwards.

| Plant | Test | File | Result |
|---|---|---|---|
| none (control, before the first plant and after the last) | — | — | every carrier green: smokes `experiment-browser` 35, `cr-switch` 12, `cr-host` 21, `cr-provider-neutral` 5, `element-pick` 12, `artifact-version` 6; worker `cr-switch.test.mjs` OK; real Chromium 55 of 55 |
| B1 the App switch accepts any truthy `enabled` | CR-T02 | `curriculumRuntime.ts` | SURVIVED (`cr-switch` green); see Findings |
| B2 the delete command's enablement also requires the switch | CR-T02 | `package.json` | RED: `cr-switch` "gated on exactly 'bytes are stored', never on anything else"; `cr-host` "enabled by 'bytes are stored'" |
| B3 the Service no longer requires an adult lower age bound | CR-T02 | `worker/src/lib/moderation.ts` | RED: worker `cr-switch.test.mjs` "switch ON for a mixed-age [15, 40] or unknown-age workshop cohort: no CR tool or contract (adult lower bound)" |
| B4 a type import of `@anthropic-ai/sdk` in the browser-tool module | CR-T03 | `experimentBrowser.ts` | RED: `cr-provider-neutral` "no browser-tool module (or anything it reaches) imports a provider SDK" |
| B5 the viewport requirement removed from the observation check | CR-T04 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T04 negative"; real Chromium `FAIL CR-T04 negative control: an observation with the viewport removed is an error` |
| B6 records read across every document generation | CR-T05 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T05 negative" (`L2 must be clean`) |
| B7 the stale-ref guard ignores the document generation | CR-T06 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T06 negative" (`no CDP action reached the page for a stale ref`) |
| B8 `browser_click` dispatches no press or release | CR-T07 | `experimentBrowser.ts` | RED in real Chromium, but first at CR-T06 (`select changes what the next observation shows`: the drink list appears only after the start click), after which the script stops before CR-T07. CR-T07's own check is turned red by the same plant in the app (IA3) |
| B9 an earlier request's records keep their step | CR-T08 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T08: an earlier request's error is never reported at a step of the request now running" (`turn 2 reports no failure: - [console/error] 단계 3 turn1-step3-error`) |
| B10 ambiguous twins mapped by their text | CR-T09 | `elementPick.ts` | RED: `element-pick` "CR-T09 negative" (`live-DOM twins make a text match a guess`) |
| B11 the record builder's version check loosened | CR-T10 | `browserResult.ts` | SURVIVED (`artifact-version` green); see Findings |
| B11b the artifact version pattern accepts any string | CR-T10 | `browserResult.ts` | RED: `artifact-version` "CR-T10 negative" (`Missing expected rejection.`) |
| B12 every origin allowed once any is | CR-T11 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T11 negative" (`https://example.com/`); `cr-provider-neutral` parity |
| B13 `AutomationIndicator.show()` draws nothing (the outline then appears only when `withHidden` redraws it after a step's evidence screenshot) | CR-T63 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T63 unit positive: outline drawn during each step, cleared for the screenshot and after the step" (actions sent with no indicator: `Input.dispatchMouseEvent`, `Runtime.callFunctionOn`, `Page.reload`) |
| B13n `draw()` a no-op: the outline is never painted (fix round) | CR-T63 | `experimentBrowser.ts` | RED: `experiment-browser` "CR-T63 unit: browser_navigate that opens the first tab draws the outline once the page exists" (`the outline is drawn after the new tab loads`) |

In the app, each plant its own build injected into the same copy, gated and quiet like the positive runs:

| Plant | Test | Run | Result |
|---|---|---|---|
| IA1 the delete command's enablement and palette entry also require the switch (`package.json`, as B2) | CR-T02 | 17:18–17:19, "CR-T02 exception in-app" | RED at `app-layer.spec.ts:141`: 12 stored screens after the switch-off relaunch, expected 0 (nothing could delete them) |
| IA2 `show()` draws nothing (B13's plant) | CR-T63 | 17:19, then four times in the fix round (18:12–18:14), "… switch on" | Not a reliable control. RED at `app-layer.spec.ts:193`, "CR-T63: the outline was painted while agent steps ran", at 17:19 and in two fix-round runs (0 of 99 and 0 of 101 sampled frames with the outline); passed in the other two (1 frame of 101, 1 of 100), as it did in review r1's run. See Findings |
| none, the clean build injected again (`dist/extension.js` `8f00ca64…`) | — | 17:19–17:20, whole `app-layer.spec.ts` | 3 of 3 passed |
| IA3 `browser_click` dispatches no press or release (B8) | CR-T07 | 17:23, "… switch on" | RED at `app-layer.spec.ts:189`, "CR-T07 positive: five steps, order screen" (the flow stopped at step 1). The clean build was injected again afterwards (bundle hashes equal to the build) |
| none, the clean build (fix round, from a scratch clone at `bed32b89`) | — | 18:11, "… switch on" | passed; 44 of 106 sampled frames with the outline |
| IA2n `draw()` a no-op: the outline is never painted (B13n) | CR-T63 | fix round, 18:14 and 18:15, "… switch on" | RED both times at `app-layer.spec.ts:193` (0 of 99 and 0 of 101 frames), after the CR-T07 flow and the CR-T08 negative passed and with the sampler's instrument control (frames sampled during the flow) met |
| none, the clean build injected again (`8f00ca64…`) | — | fix round, 18:15–18:16, whole `app-layer.spec.ts` | 3 of 3 passed; 43 of 103 frames with the outline. The app copy holds the clean build |

## Findings

- B1 survived: `cr-switch.smoke.mjs` checks "only an explicit true" with `{ curriculum_runtime: { enabled: "true" } }` and no adult tier, so the tier check alone returns false and a loosened `enabled !== true` passes. The Service serves the switch as a boolean (`curriculumRuntimeAllowed`), so no shipped path reaches the App with a string. Test gap, follow-up; not changed here, because the smoke is one of this completion's pinned inputs.
- B11 survived and B11b did not: `missing_artifact_version` is enforced twice (when the record is built and when its event text is written), so removing one check is caught by the other. Defence in depth, not a gap.
- Three pinned test files are also pinned by later items' packets (`record` warned): `e2e/curriculum-runtime/app-service.mjs` (`cr-evidence`, `cr-memory`, `cr-skills`), `extensions/hypeproof-chat/test/cr-switch.smoke.mjs` (`cr-memory`, `cr-skills`) and `worker/test/cr-switch.test.mjs` (`cr-evidence`, `cr-memory`). They hold the CR-T02 switch-off inventory, which every later item extends, so the next slice that adds its surfaces there reopens this completion; it is then re-verified and re-recorded (`--replace`), or the epic narrows these inputs. Shared files that no other item lists draw no warning; the three of them that later work edits (`playwright.config.ts`, `e2e/fixtures/app.ts`, `09-preview.spec.ts`) are not pinned (see "Why it can be recorded now"), so a change to them leaves this completion complete.
- The in-app CR-T63 check is weaker than CR-68's negative ("an automation step with no indicator visible fails"): `app-layer.spec.ts:193` asks that some frame sampled anywhere in the five-step flow shows the outline (`during.some(…)`), not that each step does. With B13's plant (`show()` draws nothing, so the outline appears only for the moment between a step's evidence screenshot and its end) the in-app test passed in review r1's run and in two of four fix-round runs, and failed in the other two and at 17:19: whether a sampled frame lands in that moment decides it. IA2 is therefore not counted as a control. The unit layer catches the plant every time (B13), so per-step coverage of CR-T63 is the unit layer's; the in-app layer shows the outline painted during the flow (43–44 of about 105 frames on the clean build), gone after it, and missing when it is never painted (IA2n). Follow-up: a per-step in-app assertion, then a re-record with `--replace`. `app-layer.spec.ts` is a pinned input, so it is not changed here.
- CR-10 is recorded on recon R4's definition of an artifact version, with the limitation the run record lists ([known limitations](../testing/curriculum-runtime-2026-09-30-evidence.md)): the file set holds static references only (HTML, CSS, JS imports). A file the page loads dynamically (`fetch('menu.json')`, an image `src` built in script) is not in it, so editing only such a file makes no new version, and results before and after that edit carry the same version: partial coverage of CR-10's "marked as belonging to the earlier version". This is the accepted reading the completion rests on, not a case CR-T10 tests.
- In the app's clean five-step flow, each action result says "확인된 것 없음 — 단, 관찰이 페이지가 뜬 뒤에 시작돼 …": the preview document loaded before the event log attached, a limitation the run record lists. It changes no CR-T row of this item; for `cr-verify` it turns the first criterion of a session into "확인 안 됨" (see [cr-verify.md](cr-verify.md)).

## NOT RUN

- CR-T55 and CR-T56 (`cr-e2e`, decision 9).
- The HTML generation specs and the full switch-off inventory walk with the switch off (`cr-e2e`). No item has run CR-T02's positive case "the HTML generation specs pass with the switch off" yet: the run record and #1508 left it to `cr-e2e` as well, and which `e2e/tests` specs count as HTML generation specs is not listed anywhere. `cr-e2e`'s packet carries the case ("The existing preview and HTML regressions are re-run with the switch off"); the recon strategy row gives it only "CR-T02 (full inventory)". Until it runs, CR-02's "existing HTML creation behaves as before" rests on `09-preview.spec.ts` alone.
- Any real device or phone; a real model behind the in-app rows (the agent is scripted).
- GitHub was not read by the recorder (the API budget belongs to the shipping agent); main CI at `bed32b89` is not re-read here.
