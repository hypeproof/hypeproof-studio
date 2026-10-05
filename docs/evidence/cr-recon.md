# cr-recon evidence report

Status: evidence for the `cr-recon` completion record (CR-01, CR-T01), re-recorded by the record sweep. 2026-10-05. Owner: jayleekr.
Item: `cr-recon`, issue [#1390](https://github.com/jayleekr/hypeproof-studio/issues/1390), epic [#1388](https://github.com/jayleekr/hypeproof-studio/issues/1388), record sweep [#1507](https://github.com/jayleekr/hypeproof-studio/issues/1507).
Delivered by PR [#1420](https://github.com/jayleekr/hypeproof-studio/pull/1420), squash-merged as `5e82f590c8200b45b26a97809cf8e289c9df0ac7`. PR [#1508](https://github.com/jayleekr/hypeproof-studio/pull/1508) (issue [#1506](https://github.com/jayleekr/hypeproof-studio/issues/1506)) revised the recon page and CR-T01's frozen control inputs for Jay's decision 9 and was squash-merged as `bed32b895edc5eceb9fcb9c8cd089cc238c02ed0`. This report re-runs CR-T01 at `bed32b89`, the `origin/main` commit the sweep branched from, and replaces the completion recorded on 2026-09-29 at `5e82f590` (that run's report is `5e82f590`'s version of this file).

## Why the completion is replaced

At `bed32b89`, `align.py check --doc curriculum-runtime` reports `BROKEN cr-recon`: `completion no longer holds (changed since recorded: docs/plan/curriculum-runtime-recon.md, docs/requirements/curriculum-runtime.md, worker/test/fixtures/cr-recon/frozen-inputs.json)`. The old completion pinned the whole requirements document, which every later slice edits, and #1508 changed the page and the fixture it pins. The new completion is written by `align.py` at Harness `4df7d3c` (#271, harness#270), which pins the CR-01 row and the CR-T01 row instead of both documents, and the verification inputs and this report as files.

## Verdict

PASS for CR-T01 at `bed32b89`. Evidence class: doc check (the CI layer of the testing contract). The verdict was re-run by the recorder, not copied from #1508.

## Reviewers

| Label | Role |
|---|---|
| `cr-recon:review:acceptance:r3`, `cr-recon:review:adversarial:r3`, `cr-recon:review:regression-conventions:r3` | independent review of the recon, round 3 of PR #1420 |
| `cr-unblock:review:r1` | independent review, round 1 of PR #1508 (#1506): the decision 9 revision of the recon page and the regenerated frozen inputs this completion pins; its four minor findings were fixed in that PR |
| `cr-record-sweep:review:r1` | independent review of this re-run and record, round 1 of the sweep (ledger, evidence truth and conventions lenses): it re-ran the record in a clone of the branch and CR-T01, and its findings are applied in this version. Named as `reviewed_by` |

The recorder is a record-only agent that wrote neither the recon nor its revision.

## Environment

2026-10-05, Apple M3 Pro, macOS 15.7.4 (Darwin 24.6.0), Node v22.22.1. Worktree `chore/cr-record-sweep` cut from `origin/main` = `bed32b895edc5eceb9fcb9c8cd089cc238c02ed0`. No pinned file differs from `bed32b89`; this branch adds the evidence reports and the ledger record only.

## Positive control

| Command (from the worktree root) | Result |
|---|---|
| `cd worker && node --experimental-strip-types test/cr-recon.test.mjs` | exit 0. `cr-recon (CR-T01): OK — verdict read at this tree (docs/plan/curriculum-runtime-recon.md differs from the one cr-recon's completion pins) · 10 areas · 73 map entries · 84 matrix rows · 11 decisions · 34 negative controls each caught, on the frozen inputs and a temp directory · external not checked here: 10` |
| the same with `HPS_VSCODE_SRC=<vscodium-base/vscode, HEAD 560a9dba9, VS Code 1.116.0>` `HPS_VSCODIUM_SRC=<vscodium-base, holding 59e57927>` `HPS_LAB=<hypeprooflab worktree whose web/src/app/api/gallery equals Lab origin/main 4cbf7651>` | exit 0, the same line ending `external not checked here: 0`. The external checkouts were only read (`git show`, file reads). |
| `cd worker && npm test` (CR-T01 and the registry trace `cr-traceability.test.mjs` among 68 files) | exit 0; `cr-traceability: OK — 84 requirements · 80 tests · 52 reuse IDs resolved · both directions agree` |

## Negative controls

Built into CR-T01: 34 planted defects, each reported exactly once, on the page plus the frozen inputs and on a temporary directory (the count is in the positive-control line).

Planted by the recorder in this worktree before the record, while the verdict reads the tree, one at a time (scratch runner `mutate_recon.py`); every touched file was restored byte-identical (sha256 checked) before the next plant. The clean tree passed before and after; `git status` was clean afterwards. The fix round for review r1 (18:18–18:19) ran R1–R5 again in a scratch clone at `bed32b89`: the same results, the clean control green before and after.

| Plant | Result |
|---|---|
| R1 `CdpSession` renamed in `extensions/hypeproof-chat/src/cdpSession.ts` (3 occurrences) | exit 1: ``map M1.5: extensions/hypeproof-chat/src/cdpSession.ts: symbol `CdpSession` not found`` and ``matrix CR-08: … symbol `CdpSession` not found`` |
| R2 CR-47 dropped from `cr-skills` in `config/requirement-work.json` | exit 1: `matrix CR-47: cr-skills does not cite CR-47 in the ledger` |
| R3 `extensions/hypeproof-chat/src/liveServer.ts` moved aside | exit 1: `map M3.2: … path does not exist`, `matrix CR-54: … path does not exist`, `matrix CR-59: … path does not exist` |
| R4 the recon matrix row CR-59 back on `cr-browser` (decision 9 undone in the page) | exit 1: `matrix CR-59: cr-browser does not cite CR-59 in the ledger` |
| R5 the frozen inputs at the pre-decision 9 projection (`00590823`'s file) | exit 1: `worker/test/fixtures/cr-recon/frozen-inputs.json is not the projection of the verdict's inputs` |

## Read modes after the record (simulation)

In a scratch worktree at `bed32b89`, `align.py record cr-recon --replace --commit bed32b89 --pr 1420 --tests CR-T01` was run with a placeholder report and reviewer `sim-reviewer` (`pinned: 7 files, 2 rows in 2 documents`) and committed in that worktree only; a depth-1 clone was taken from that commit through a temporary local branch. All of it was removed afterwards (scratch runner `sim_recon.sh`). The real record pins the same page, fixture and rows, so it selects the same modes.

| Case | Result |
|---|---|
| full checkout, clean | exit 0, `verdict read at commit bed32b895edc (the page and frozen inputs are the ones cr-recon recorded at bed32b895edc)`, `INFO this tree still matches the recorded map` |
| full checkout, `CdpSession` renamed later | exit 0, verdict read at the commit; `INFO this tree differs from the recorded map in 2 place(s)`: M1.5 and CR-08, to be recorded as deviations in the plan |
| full checkout, the recon page edited (CR-59 back on `cr-browser`) plus the rename | exit 1: the page no longer matches its pin, so the tree is checked: M1.5, CR-08 and `matrix CR-59: cr-browser does not cite CR-59 in the ledger` |
| `--depth 1` clone, as `pr-ci.yml` checks out, clean | exit 0, `verdict NOT RE-RUN (this clone lacks bed32b895edc, where cr-recon was recorded (shallow checkout))`, the tree still matches |
| `--depth 1` clone, frozen inputs tampered (`CR-47` → `CR-470`) | exit 1: `frozen-inputs.json is not the projection of the verdict's inputs` |

## Ledger state before the record

| Command | Result |
|---|---|
| `align.py check --studio <this worktree> --doc curriculum-runtime` (Harness `4df7d3c`) | exit 1: `BROKEN cr-recon`, the completion above no longer holds; no other finding |
| `next-work.py --check` with Harness `539560f1` (the pin in `requirement-work.yml`), `44e6bbb` (the Harness main checkout, which `scripts/next-work.py` reads when `HYPEPROOF_HARNESS` is unset) and `4df7d3c` (`align-main`; `~/.cache/hypeproof/harness` since 17:01) | exit 0 with each |

Readers of completions with `rows`: a `discover.py` from before row pins counts none of them. Offline (a local snapshot with every issue open, no GitHub read), `539560f1` and `44e6bbb` show `cr-recon` ready and `cr-browser` waiting on it, where `4df7d3c` shows both complete. `requirement-work.yml` runs `next-work.py --check`, which reads ledger integrity only, so CI is green with either pin. Moving the CI pin to `4df7d3c` or later is a follow-up (ledger contract §4).

## Open PRs and ownership

GitHub was not read by the recorder (the API budget belongs to the shipping agent). Local git only: of the remote branches updated since 2026-09-25, two touch the recon page, its fixture, CR-T01 or the ledger, neither by another person: `chore/cr-unblock` (#1508, merged as `bed32b89`) and `feat/sx-p0-curriculum-first-2` (the SX lane of the same run; it edits the ledger entry `sx-p0-curriculum-first` only). The open-PR check of the 2026-09-29 record (no open PR on #557, #1018, #1172, #1020 or #1009) is not repeated here.

## Not inspected

- By the recon (§8): Chalk (`chalk/`), `packages/measurement` beyond its CI job, Windows, the real-phone path, production configuration, the Lab gallery DB schema.
- By this record: the CDP probe (`e2e/curriculum-runtime/cdp-probe.mjs`) was not re-run; it is a supporting run of the recon, not CR-T01. GitHub was not read.
- Findings F2–F10 and the open decisions stay as the recon records them (§9); F1 was closed by #1508.
