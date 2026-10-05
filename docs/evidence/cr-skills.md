# cr-skills evidence report

Status: tests re-run by the record sweep at `bed32b89`; not recorded (an open question on a row, and its dependencies are not complete). 2026-10-05. Owner: jayleekr.
Item: `cr-skills`, issue [#1396](https://github.com/jayleekr/hypeproof-studio/issues/1396), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1454](https://github.com/jayleekr/hypeproof-studio/pull/1454), squash-merged as `c7d388fcc458319f6d74b5664dcaaef83377c27a`. The implementation's run record and claim table are in [curriculum-runtime-2026-10-02-skills.md](../testing/curriculum-runtime-2026-10-02-skills.md); decisions, rule readings and residuals are in the [plan](../plan/curriculum-runtime.md#deviations-and-decisions-recorded-by-cr-skills). The first report for this item, the review round 3 controls re-run at `c7d388fc` with 27 planted defects, all caught, was never merged: it is commit `7b5343cf` on branch `chore/record-cr-skills`.

## Not recorded

`cr-skills` depends on `cr-memory`, `cr-evidence`, `cr-publish` and `cr-verify`, none of them complete ([cr-verify.md](cr-verify.md) and the reports it leads to), and one of its rows waits on a decision:

| Row | State at `bed32b89` | What closes it |
|---|---|---|
| CR-46 | Claimed in the run record under the plan's reading of "touches only what the current evidence requires": every change cites evidence the student selected, that evidence is usable for a team, and the path is a file of the product version (an added file stays in the version and is used by an edit). CR-T43's canonical positive still reads "touches only files tied to the fixture evidence"; files are not derived from the participant events' page paths, so an in-version change that cites a selected item but has nothing to do with it is not caught. Narrowing the row narrows CR-46's acceptance. | Jay's decision, open since PR #1454: edit CR-T43 to the implemented reading, or require files derived from the evidence. |

Rows the run record claims, positive controls green again here: CR-43, CR-44, CR-45, CR-47, with the rule readings and residuals the plan records. CR-02, partial there because the switch-off baseline was BLOCKED by F1: the baseline passes at `bed32b89` (`09-preview.spec.ts` with the switch off, 18 of 18; [cr-browser.md](cr-browser.md)), and the in-app switch-off test of this item passes (below).

## Runs at `bed32b89`

Environment, app copy and gating: as in [cr-browser.md](cr-browser.md).

| Command | Result |
|---|---|
| `cd worker && npm test` | exit 0; `cr-skills (worker SQLite): OK`, 23 checks |
| `cd worker && npm run test:cr-skills:d1` (local workerd D1 and R2) | exit 0; 23 checks, `cr-skills (worker local workerd D1): OK` |
| extension smoke `cr-skills` | `8 cr-skills checks passed` |
| in-app `skills-app.spec.ts` (16:55–16:58, with the whole CR config) | 2 of 2: "CR-T02 in-app, switch off: the skills command is not reachable" and "CR-T02 on + CR-T42 in-app: the Experiment skill runs through the coach route with its tag and capability; a planted bad answer is refused". The 2026-10-02 report had this spec last passing at the round 1 head and NOT RUN for review rounds 2 and 3; it passes at `bed32b89`. |

The extension's `npm test` stops at `test:instructor-render` on this Mac (`react` 19.1.0 from `~/node_modules` against the webview's 18.3.1), the environmental failure the 2026-10-02 report already noted; every `*.smoke.mjs` file passes before it.

## NOT RUN

- The 27 planted defects of `7b5343cf`: not repeated, because nothing is recorded for this item.
- A real model answering any skill; a real phone or classroom; the dev host by hand.
- Any production D1, R2, Worker route or host.
- GitHub was not read by the recorder.

## Follow-ups carried from the run record (not changed here)

- The residual readings in the plan's `cr-skills` deviations.
- CR-T43's canonical wording versus the rule's narrower reading (above).
- The extension's `test:instructor-render` inside a worktree under `$HOME` (environmental).
