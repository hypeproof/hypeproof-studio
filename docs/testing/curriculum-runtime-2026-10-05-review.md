# Curriculum Runtime run record — `cr-review` (#1398)

Status: run record, 2026-10-05. Item `cr-review`, epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388). Row definitions: [curriculum-runtime.md](curriculum-runtime.md). Decisions and deviations: [plan](../plan/curriculum-runtime.md#deviations-and-decisions-recorded-by-cr-review). No row here is a completion; completion needs the ledger record and a reviewer other than the implementer.

## Claims

| | Rows | Why |
|---|---|---|
| Claimed | CR-48, CR-49, CR-50, CR-51, CR-52, CR-53 | Every positive and negative control of CR-T45, CR-T46, CR-T47 and CR-T49 ran, on SQLite and on local workerd D1 and R2; CR-T48 ran in the app (the director's decision and next experiment written from the review screen, found in Venture Memory after reopening), with its Service half and its negatives in the worker suite. The readings the rows leave open are stated in the plan's deviations: nine sections composed by rule and a model only in the next-experiment section (so CR-T46's "once per stale section" is once per stale model section), "director decision needed" composed by rule, and the classroom report pattern followed without calling its modules |
| Partial, remainder named | CR-62 | CR-T58 ran with a planted provider latency (synthetic), not against a recorded provider: ten full regenerations with an 8 s provider pass the 30 s target and report Studio's share apart, and a 35 s provider is a provider-caused miss. A run against a recorded or live provider under normal conditions is not done |
| Partial, remainder named | CR-02 | Review surfaces only: the five routes, the two commands and the four webview messages are off with the switch off and reachable with it on, in the Worker and in the app. CR-T02's `09-preview.spec.ts` switch-off baseline was not re-run here; the record sweep and `cr-e2e` re-run the whole inventory |

So the PR says `Refs #1398`. The set the completion record names is exactly this table: claimed CR-48, CR-49, CR-50, CR-51, CR-52, CR-53; CR-62 and CR-02 partial.

## What was run

- Code: branch `feat/cr-review` off `origin/main` `4f937bdc`; Service commit `b17f2de0`, App commit `6e855906`, e2e commit `a96172e1`. The submitted SHA is the branch head that carries this file.
- Machine: Apple M3 Pro, macOS 15.7.4. Node 24.4.1 for the development runs, Node 22.23.1 (the major `pr-ci.yml` pins) for the gates and the planted-defect runs. HypeProof Studio 0.1.51 copy (from `/Applications`) with this branch's extension and webview injected (the injected `extension.js` hash equals the build's), prepared with LSUIElement=1, run through `GATE=idle scripts/e2e-quiet.sh` behind the lane's app lock with the screen unlocked: the gate passed on the first attempt, and `review-app`, `memory-app` and `skills-app` ran together, 6 passed in 1.0 min at 20:25 KST.
- Evidence classes (MC-38): **synthetic** = unit, smoke and worker layers (the real Service router over SQLite, or local workerd D1 and R2 with `--d1`; the model is a planted answer; provider latency is planted); **live-host (app) / synthetic (Service and model)** = `e2e/curriculum-runtime/review-app.spec.ts` in the Studio app with `app-service.mjs publish`, whose scripted model answers the Experiment skill's prompt from the prompt alone.
- No real model answered the Experiment skill for a pack, and no real provider latency was measured. No real phone or classroom run; none is named by these rows.

## Results

| Row | Layer and file | Result | Controls |
|---|---|---|---|
| CR-T45 | worker `cr-review.test.mjs` (the pack builder and the commit route) | PASS | Week 2 fixture (a published kiosk, two participant sessions and two notes, an accepted draft with two observations, an interpretation and two assumptions, v1, a team decision on slides 2 and 3 that made v1, citing one observation and the interpretation, with one assumption): ten sections in the PRD's order; every factual claim names a source in a known form that resolves; observed, interpreted and assumed items each in their own section; "deck slides affected" names slides 2 and 3 with the team decision and says "아직 제안된 슬라이드 수정이 없어요."; an empty section says why in words. A Project with an experiment and no evidence says "이 주에 기록된 관찰이 없어요." instead of claiming. Negative: planted packs with a claim without a source (an observation, a product change), a claim in another section's class (an interpretation among the observations, an AI number among the metrics), a source in no known form (`chat:turn-3`), a deck section without "no proposal" and a missing section are each caught exactly once by `packProblems`, and the commit route checks the pack (422 `invalid_pack`) before it inserts anything. R4–R9 caught |
| CR-T46 | worker (SQLite and local workerd D1/R2), through the App's `ReviewSession`; the real coach route on SQLite | PASS | An interpretation edited after preparing marks exactly `interpretation` and `next_experiment` stale; preparing again regenerates those two, asks the model once and carries the other eight over unchanged (same `generated_in`). A new metric marks only `metrics` stale and preparing makes no model call. With nothing stale no revision is written. Instrument controls: a planted revision that rewrites every section, and one that leaves a stale section as it was, are both caught by the same comparison. Model section: an answer to other records is refused (409 `inputs_changed`) and the App starts over once; an answer the Experiment skill's gate refuses stores the fact sections and keeps the AI section "not generated", with the refusal named; a stale pack is never shown as current. On the real coach route: one upstream call per stale model section with `x-hps-skill: experiment@1.0.0` and `x-hps-capability: reasoning.high` and no model, none when only facts are stale. R2, R3, R18, R19, A4, A10 caught |
| CR-T47 | worker | PASS | Opening the pack fresh and stale, as a member and as a director, records zero calls on a spy over every model path the pack builder can reach (provider hosts, `/v1/chat/completions`, `/v1/messages`) and writes nothing; the stale pack opens with its stale sections. Instrument control: a planted call is counted. R1, R20 (Service), A1 (App) caught |
| CR-T48 | in-app `review-app.spec.ts`; worker Service half | PASS | In the app: the learner's App prepares the pack (fresh, ten sections; the Experiment skill's request sent `experiment@1.0.0` / `reasoning.high` and no model). A second App signed in with the director's issuer token only opens "주간 리뷰 (디렉터)", sees the team, opens its pack and writes the decision with one observation as evidence and a next experiment. The learner's App, reopened with its workspace state deleted (chat history and remembered Project with it), shows "디렉터 결정" and the draft under 실험; the Service's memory read gives actor `director`, `decided_by: cr-director`, the observation `ev:…/o1`, `review: {week: 1, revision: 1}` and a `status: draft` week-2 experiment named by `next_experiment_id` (`review-result.json`). This run's controls: no director decision before the director writes one; the chat history is gone after the deletion. Service half: the same after reopening on SQLite and local workerd D1; a retried submission answers the stored decision (200 `reused`) and writes nothing. Negatives: a student token gets the unknown route and nothing is written; evidence outside the pack (an AI draft the team has not reviewed), an assumption cited as evidence, a revision the director did not read, a next experiment with no hypothesis, and a director outside the scope are refused with nothing written. R10–R12, A2, A11 caught |
| CR-T49 | worker | PASS | Four teams of one directed cohort show fresh, stale, missing and fresh; the stale team lists `observed`, `decision_needed`, `next_experiment`; zero model calls. A prepared team of another cohort under a profile the scope does not cover never appears, its own director sees only it, and a student gets the unknown route. Instrument control: a planted overview listing that team is caught by the same check. R3, R13, R20 caught |
| CR-T58 | worker (SQLite and local workerd D1/R2), through the App's `ReviewSession` | PARTIAL (synthetic only) | Ten full regenerations with an 8,000 ms planted provider latency all pass the 30 s target with Studio's share reported apart: SQLite p50 2 ms, p95 2 ms, max 2 ms; local workerd D1 p50 155 ms, p95 321 ms, max 321 ms (Studio's share; the provider's 8 s is planted). Negative: a 35,000 ms planted provider is `miss_provider`, never a Studio pass, and the panel line says "AI 응답이 늦었어요"; the stored revision carries the App's figures. A3 caught. Not run: a recorded provider |
| CR-T02 (review surfaces) | worker `cr-review.test.mjs`; extension `cr-switch.smoke.mjs`, `cr-review.smoke.mjs`; in-app `review-app.spec.ts` | PARTIAL (CR-02 partial) | Off: each of the five routes, with real ids and a student, a director or no token, answers exactly as an unknown route (status, body, headers) and nothing is written; the director probe the App uses follows the switch, and a student token is never a director. Instrument control: a planted review route that answers with the switch off is caught. A director gets the unknown route on `prepare` with the switch on (members prepare). In the app, with both tokens stored, neither "HypeProof: 주간 리뷰" nor "HypeProof: 주간 리뷰 (디렉터)" is in the palette (control: the existing HypeProof Chat commands are found) and the director probe answers 404. On: the routes answer and both commands open. R14, A5–A8 caught |
| CR-69 (packs; a regression check, not a row of this item) | worker | PASS | Deleting a participant session or an experiment's data deletes the Project's packs and the receipt counts them; a pack stored while its evidence was being deleted is taken back (409 `evidence_changed`), and the same preparation without the deletion stores its pack (control); without migration 0038 the deletion paths and the memory read find no pack instead of failing, and any other storage failure is not swallowed. R15–R17 caught |

## Controls red on the pre-implementation tree

- On `origin/main` `4f937bdc` (exported with `git archive`, outside the worktree) with this branch's test files copied in: `worker/test/cr-review.test.mjs` exits 1 before any case (`ERR_MODULE_NOT_FOUND` for `worker/src/lib/curriculum/review.ts`); `extensions/hypeproof-chat/test/cr-review.smoke.mjs` exits 1 (`ERR_MODULE_NOT_FOUND` for `src/reviewSession.ts`); this branch's `cr-switch.smoke.mjs` exits 1 after two checks: the provider has no `weeklyReview` handler.
- Planted defects, each applied to this branch's committed tree, the relevant suite run under Node 22, then the file restored byte for byte; the baseline with nothing planted is all green (worker 14 cases, App smoke 4 checks, switch smoke 13 checks). Every one turned its suite red:

| | Defect planted | Turned red |
|---|---|---|
| R1 | opening a pack calls a model | CR-T47 |
| R2 | every fact section is regenerated, fresh or not | CR-T46, CR-T46 on the real coach route |
| R3 | a pack always reads fresh | CR-T46, CR-T47, CR-T48 Service half, CR-T49 |
| R4 | observed claims lose their sources | CR-T45, and every case that prepares a pack (the commit refuses it) |
| R5 | "deck slides affected" does not say "no proposal" | CR-T45, and every case that prepares a pack (the commit refuses it) |
| R6 | the pack check accepts a deck section without "no proposal" | CR-T45 negative |
| R7 | the pack check accepts a claim in another section's class | CR-T45 negative |
| R8 | the pack check accepts a factual claim without a source | CR-T45 negative |
| R9 | the commit stores a pack without checking it | CR-T45 negative |
| R10 | the director's decision is stored as the student's | CR-T48 Service half |
| R11 | a decision may cite evidence outside the pack | CR-T48 negatives |
| R12 | a decision may be written from a revision the director did not read | CR-T48 negatives |
| R13 | the overview lists every team, not the directed ones | CR-T49 |
| R14 | the director gate ignores the switch | CR-T02 switch off |
| R15 | deleting an experiment's data keeps the packs | CR-69 with packs |
| R16 | deleting a participant session keeps the packs | CR-69 with packs |
| R17 | no evidence check after the pack is stored | CR-69 with packs |
| R18 | the commit takes an answer to other records | CR-T46 model section |
| R19 | the Experiment skill's gate is skipped on commit | CR-T46 model section |
| R20 | the overview calls a model | CR-T47, CR-T49 |
| A1 | opening the panel asks the model | App smoke (student) |
| A2 | the decision is sent with the student's token | App smoke (director) |
| A3 | a slow provider counts as a pass | App smoke (CR-62 verdict), CR-T58 |
| A4 | a race is not started over | App smoke (student), CR-T46 model section |
| A5 | the director key turns on without the Service | App smoke (director), CR-T02 switch off |
| A6 | the review command skips the switch | switch smoke |
| A7 | the review command is always enabled | switch smoke |
| A8 | the director's messages trust the student's switch | switch smoke |
| A9 | the AI's section is not named as the AI's | App smoke (panel render) |
| A10 | the panel marks every section stale | App smoke (panel render) |
| A11 | the form offers unreviewed AI items as evidence | App smoke (director) |

## Gates

Run on the code commits above under Node 22.23.1: the `pr-ci.yml` jobs that build or test what this branch touches (worker, extension and webview, the real-Chromium e2e job, the workflow-file checks, the studio dev fixtures) and the browser jobs of `classroom-ops.yml` and `start-page.yml`, whose paths it touches. Not run: the measurement, chalk, dev-channel and deploy-freeze jobs and the unified-release and launcher steps, which cover packages and scripts this branch does not change.

| Gate | Exit | Note |
|---|---|---|
| worker `npm test` | 0 | includes `cr-review.test.mjs` on SQLite and `cr-traceability.test.mjs` |
| worker `test:authoring:d1`, `test:classroom:d1`, `test:native-trial:d1`, `test:classroom-ops:d1` | 0 each | |
| worker `test:cr-publish:d1`, `test:cr-memory:d1`, `test:cr-skills:d1`, `test:cr-review:d1`, `test:cr-evidence:d1` | 0 each | cr-review 13 cases on D1 (the real coach route case runs on SQLite only); cr-evidence last, after its TIME_WAIT drain |
| worker `typecheck`, `validate-profiles`; cohort-harness self-test | 0 each | |
| extension `typecheck`; webview `npm run build` | 0 each | |
| extension `npm test` | 1 | Every `test/*.smoke.mjs` (including `cr-review`, `cr-switch`), `test:classroom-ops:review` (41), `test:chalk-tools` (20), `test:chalk-generator` (20) and `test:chalk-judge` (9) passed; it stops at `test:instructor-render` (0 of 17), the pre-existing local cause recorded by `cr-skills`: esbuild resolves `react` 19 from `~/node_modules` above the worktree. The same unmodified script passes 17 of 17 on this branch's head exported outside `$HOME`, and in the worktree with `react` aliased to the webview's copy; `test:activity-resume`, after it in the chain, passes on its own |
| e2e `test:cr-publish`, `test:cr-evidence` (real Chromium) | 0 each | |
| e2e `classroom/mac-devhost.test.mjs`, `test:classroom`, `test:classroom-ops`, `-roster`, `-selection`, `-lesson-settings`, `-help`, `-results`, `-g1`, `-g1-wrap`, `test:classroom-authoring-g2`, `-mission`, `test:classroom-report` | 0 each | |
| e2e `test:classroom-ops-distribution` | 1 in the worktree, 0 outside `$HOME` | Times out mounting `InstructorInbox` (untouched by this branch): its esbuild bundle takes `react` from `~/node_modules` beside the webview's own copy (two Reacts, checked with the bundle's metafile). The same spec passes, all seven checks, on this branch's head exported outside `$HOME` |
| e2e `test:start-page`, `test:trial-ux`, `test:voice:popup` | 0 each | |
| `python3 scripts/next-work.py --check` (`HYPEPROOF_HARNESS` = the Harness cache) | 0 | |
| `python3 scripts/check-registry.py` | 0 | |
| `align.py check --item cr-review` | 0 | chain intact |
| `scripts/check-workflow-shells.py`, `scripts/check-mirror-timeout.py` | 0 each | `pr-ci.yml` gained one step |
| studio dev fixtures: `scripts/test-studio-dev.py`, `worker/test/codex-rehearsal.test.mjs` | 0 each | |

## Ledger impact

- `cr-browser`'s completion (recorded for `bed32b89`) already does not hold on `origin/main` `4f937bdc`: #1525 changed `worker/test/measurement-core-local-record.test.mjs`, one of its pinned inputs. This branch changes two more of its pinned inputs: `e2e/curriculum-runtime/app-service.mjs` (it also writes a director's issuer token next to the learner's) and `extensions/hypeproof-chat/test/cr-switch.smoke.mjs` (the inventory every CR item extends). Re-recording `cr-browser` has to cover both.
- `cr-review`'s ledger entry now lists the files this slice changed as `implementation_paths`, in place of the three classroom report modules it does not call and two whole directories, and this record, its tests and its core files as `verification_inputs`.

## NOT RUN

- A real model answering the Experiment skill for a pack (every answer here is planted or scripted).
- CR-T58 against a recorded or live provider (CR-62's "normal provider conditions"). Human step: in a real switch-on cohort with a real provider, the teams prepare their week's packs ("주간 리뷰 준비하기"). The first revision of a team's week is a full regeneration, and the timing the App measured is stored with it (`timing` in the `cr_weekly_reviews` document); ten such first revisions, read back, are the live run, and a recording of those provider answers makes the recorded-provider run.
- `09-preview.spec.ts` as CR-T02's switch-off baseline (not re-run in this slice).
- Real Mac with the dev host (`studio-dev.py`) by hand; the dev-host rows in [curriculum-runtime-dev.md](curriculum-runtime-dev.md#cr-review--weekly-review-1398) were written from the code and these runs.
- Migration 0038 on any remote D1 (Jay's deploy decision).
