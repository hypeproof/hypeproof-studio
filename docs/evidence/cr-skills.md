# cr-skills evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (an open question on a row, and its dependencies are not complete). 2026-10-05. Owner: jayleekr.
Item: `cr-skills`, issue [#1396](https://github.com/jayleekr/hypeproof-studio/issues/1396), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1454](https://github.com/jayleekr/hypeproof-studio/pull/1454), squash-merged as `c7d388fcc458319f6d74b5664dcaaef83377c27a`. The implementation's run record and claim table are in [curriculum-runtime-2026-10-02-skills.md](../testing/curriculum-runtime-2026-10-02-skills.md); decisions, rule readings and residuals are in the [plan](../plan/curriculum-runtime.md#deviations-and-decisions-recorded-by-cr-skills). The first report for this item, the review round 3 controls re-run at `c7d388fc` with 27 planted defects, all caught, was never merged (commit `7b5343cf` on branch `chore/record-cr-skills`); its planted-defect section is carried below.

## Not recorded

`cr-skills` depends on `cr-memory`, `cr-evidence`, `cr-publish` and `cr-verify`, none of them complete ([cr-verify.md](cr-verify.md) and the reports it leads to), and one of its rows waits on a decision:

| Row | State at `bed32b89` | What closes it |
|---|---|---|
| CR-46 | Claimed in the run record under the plan's reading of "touches only what the current evidence requires": every change cites evidence the student selected, that evidence is usable for a team, and the path is a file of the product version (an added file stays in the version and is used by an edit). CR-T43's canonical positive still reads "touches only files tied to the fixture evidence"; files are not derived from the participant events' page paths, so an in-version change that cites a selected item but has nothing to do with it is not caught. Narrowing the row narrows CR-46's acceptance. | Jay's decision, open since PR #1454: edit CR-T43 to the implemented reading, or require files derived from the evidence. |

Rows the run record claims, positive controls green again here: CR-43, CR-44, CR-45, CR-47, with the rule readings and residuals the plan records. CR-02, partial there because the switch-off baseline was BLOCKED by F1: the baseline passes at `bed32b89` (`09-preview.spec.ts` with the switch off, 18 of 18; [cr-browser.md](cr-browser.md)), and the in-app switch-off test of this item passes (below).

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md).

Evidence classes (MC-38): **synthetic** for the worker suites (SQLite, local workerd D1 and R2; planted model answers) and the extension smoke. For `skills-app.spec.ts`, **live-host** for the App (the coach route) and **synthetic** for the Service and the model (`app-service.mjs` with `publish`; the scripted agent answers a skill prompt only from what the prompt carried). No real model, real phone or classroom.

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0; `cr-skills (worker SQLite): OK`, 23 checks |
| `cd worker && npm run test:cr-skills:d1` (local workerd D1 and R2) | exit 0; 23 checks, `cr-skills (worker local workerd D1): OK` |
| extension smoke `cr-skills` | `8 cr-skills checks passed` |
| in-app `skills-app.spec.ts` (16:55–16:58, with the whole CR config) | 2 of 2: "CR-T02 in-app, switch off: the skills command is not reachable" and "CR-T02 on + CR-T42 in-app: the Experiment skill runs through the coach route with its tag and capability; a planted bad answer is refused". The 2026-10-02 report had this spec last passing at the round 1 head and NOT RUN for review rounds 2 and 3; it passes at `bed32b89`. |

The extension's `npm test` stops at `test:instructor-render` on this Mac (`react` 19.1.0 from `~/node_modules` against the webview's 18.3.1), the environmental failure the 2026-10-02 report already noted; every `*.smoke.mjs` file passes before it.

## The first report's 27 planted defects (2026-10-02, at `c7d388fc`)

Carried from commit `7b5343cf` (the first report, never merged; the one wording change is "this report does not" to "that report did not" in the last sentence), so that main holds the run this report cites. Not re-run at `bed32b89`.

Scratch runner `mut-skills.py` (in the session scratch directory, not committed): each defect planted alone by exact-anchor replacement (anchor count checked to be 1), the owning suite run (`worker/test/cr-skills.test.mjs` on SQLite, or `extensions/hypeproof-chat/test/cr-skills.smoke.mjs`), the file restored before the next plant. The baseline before the plants and the run after them were green for both suites. D1–D25 are in `worker/src/skills/curriculum/rules.ts`; D26–D27 in `extensions/hypeproof-chat/src/skillView.ts`. The round 3 plant they correspond to in the run record is given in brackets where there is one.

| | Planted defect | Result (failing check, assertion) |
|---|---|---|
| — | none (positive control) | GREEN (rc 0), both suites |
| D1 | a claim's text is not compared with the cited statement (the first cited statement is taken) [P1] | RED: CR-T44 negative, expected `claim_not_cited_statement`, got only quantity problems |
| D2 | Q&A answer sentences not checked against the claims [P2] | RED: CR-T44 negative, expected `qa[0].answer: answer_not_claims` |
| D3 | the "N 중 M" / "M of N" ratio pairing dropped [P6] | RED: CR-T44 negative, expected `flow[0].show: unsupported_quantity:3/3` |
| D4 | "분의" fractions dropped [P6] | RED: CR-T44 negative, expected `unsupported_quantity:2/3` ("삼분의 이") |
| D5 | "열에 아홉" native ratios dropped [P6] | RED: CR-T44 negative, expected `unsupported_quantity:9/10` |
| D6 | Korean magnitudes and approximate amounts dropped [P7] | RED: CR-T44 negative, expected `unsupported_quantity:수백` |
| D7 | English magnitudes dropped | RED: CR-T44 negative, expected `unsupported_quantity:hundreds` |
| D8 | "전원" dropped from the share words | RED: CR-T44 negative, `quantitiesIn` unit case "전원이 통과 -> 전원" |
| D9 | destructured `{ ai } = window.hypeproof` not detected [P4] | RED: CR-T44 negative, the destructured product |
| D10 | optional chaining `hypeproof?.ai` not detected | RED: CR-T44 negative, `await window.hypeproof?.ai.chat(p)` |
| D11 | bracket access `hypeproof['ai']` not detected | RED: CR-T44 negative, `window.hypeproof['ai'].chat(p)` |
| D12 | provider SDK imports not detected | RED: CR-T44 negative, `import OpenAI from 'openai'; …` |
| D13 | Cohere hosts dropped from the provider list | RED: CR-T44 negative, `fetch('https://api.cohere.ai/v1/chat', {})` |
| D14 | HTML prose scanned as script [P14] | RED: CR-T44 negative, "page prose is not a call" |
| D15 | any `catch` in the file counts as handling [P5] | RED: CR-T44 negative, the unrelated `try { JSON.parse }` case (`unhandled` deep-equal) |
| D16 | the `product_has_no_ai` refusal restored [P3] | RED: CR-T44 negative, "a review of a product with no detected call is not refused" |
| D17 | a partial review of a no-call product accepted | RED: CR-T44 negative, expected `case_missing:wrong` |
| D18 | an unread source with no review accepted | RED: CR-T44 negative, expected `sources_not_read:late.js` |
| D19 | an added file need not be used by an edit [P11/P12] | RED: CR-T43 negative, expected `add_not_used:admin.js` |
| D20 | added paths not confined to the version folder [P11/P12] | RED: CR-T43 negative, expected `path_outside_version` for `../../worker/src/index.ts`, got only `add_not_used` |
| D21 | presupposed Korean comparisons ("…보다 나은가요") not leading [P8] | RED: CR-T44 negative, expected `leading_question` |
| D22 | English "thanks to … / save you" not leading [P8] | RED: CR-T44 negative, expected `leading_question` |
| D23 | nominal-style answers read as labels [P9] | RED: CR-T44 negative, expected `note_fields[1]: not_a_label` |
| D24 | a past-tense result in a note field read as a label [P10] | RED: CR-T44 negative, expected `note_fields[1]: not_a_label` |
| D25 | `questions[].purpose` not checked [P15] | RED: CR-T44 negative, expected `questions[0].purpose: purpose_not_a_label` |
| D26 | App: the demo flow drops its claim lines [A1] | RED: smoke, panel/result lines deep-equal |
| D27 | App: a new refusal code without its Korean line [A2] | RED: smoke, `claim_not_cited_statement` |

All 27 RED, the unmutated control GREEN, `git status --short` empty afterwards. The pre-implementation red (on `origin/main` `8d2138e4` both suites stop with `ERR_MODULE_NOT_FOUND`) and the K1–K19, R1–R12, P1–P15 and A1–A3 plants are the implementer's, recorded in the run record; that report did not re-run them beyond the 27 above.

## NOT RUN

- The 27 planted defects of `7b5343cf` (carried above): not repeated at `bed32b89`, because nothing is recorded for this item.
- A real model answering any skill; a real phone or classroom; the dev host by hand.
- Any production D1, R2, Worker route or host.
- GitHub was not read by the recorder.

## Follow-ups carried from the run record (not changed here)

- The residual readings in the plan's `cr-skills` deviations.
- CR-T43's canonical wording versus the rule's narrower reading (above).
- The extension's `test:instructor-render` inside a worktree under `$HOME` (environmental).
