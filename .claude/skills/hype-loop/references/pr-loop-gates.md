# PR-loop ticks: which gate runs where

Read this when the loop's instruction implements, ships or merges pull requests
(REQ-HARNESS-LOOP, SAFE, SI in the loop plan). A loop that only reports or
researches does not need it.

The gates are deterministic scripts in the harness under `scripts/loop/`. A model
decides what to build and reads diffs. A script decides whether something may
merge. If a script says no, the answer is no: report its JSON and do not work
around it. Every script prints one JSON object; `GATES` below means
`python3 <harness>/scripts/loop`. Gate config lives in `<harness>/loop/gates/`.
Only Jay or a human-merged harness PR changes it, never the loop.

## Order inside one tick

Run the phases in this order. Work already in flight finishes before new work
starts, because a PR that is almost merged is worth more than a fresh claim.

| # | Phase | Run | Proceed when | Otherwise |
|---|---|---|---|---|
| 0 | PREFLIGHT | `GATES/sense.py preflight --tick-id <loop>-<n>` | `action: run` | `stop`: run the hype-loop stop path. `skip` (`skipped:dup` / `skipped:overlap`): end the tick with one Korean line. `restart_suggested`: tell Jay once |
| 1 | SENSE | `GATES/sense.py sense --queue <queue.json> --out <tick>/sense.json` | `action: sensed` | `local_only`: GitHub is blocked or erroring. Skip ADVANCE merges and SHIP and keep the local work |
| 2 | ADVANCE | For each in-flight PR: `GATES/merge.py ... --apply` (see below) | exit 0 `merged` | exit 3 `waiting`: leave it for later in this tick or the next. Exit 10 `blocked`: a red check goes to a fixer. Propose-only class or `needs_human` goes to Jay's queue. Exit 4: STOP or freeze, so stop merging |
| 3 | START | Only with active WIP under the cap, no freeze and enough disk: one builder per item, each in its **own** worktree and branch `loop/<item>-<slug>` | builder pushes a head SHA with `test.log` | builder stalls: release the item with a reason |
| 4 | VERIFY | `GATES/diff_guard.py --repo <wt> --base origin/main --head <sha> --out <tick>/guard.json`, then `GATES/classes.py` with the same arguments, then `GATES/rbg.py --repo <wt> --base origin/main --head <sha> --cmd '<test cmd with {file}>' --out <tick>/rbg.json`, then the verifier agent (reader, no `gh`) writes `verifier.json` with `sha`, `verdict`, `tests_run`, `skipped_base` and `skipped_head` | guard `clean`, rbg `proven`, verifier `PASS`, all for the same SHA | guard `needs_human` or a propose-only class: park the item. Guard `blocked` or rbg `needs_human`: send it to a fixer (at most 3 rounds, then Jay) |
| 5 | SHIP | `hype-pr` inspect/prepare/create through the gh lane. Run prepare last, after the final push | PR open, then watch CI until the tick deadline | |
| 6 | MERGE (same tick) | `GATES/merge.py --repo hypeproof/<r> --pr N --head <sha> --sense sense.json --verifier ... --rbg ... --guard ... --classes ... --repo-path <wt> --tick-id <id> --apply` | `merged` | as in ADVANCE |
| 7 | RECORD | `GATES/lock.py release --name tick --owner <tick-id>`, then the usual `loopctl.py tick-end` | | |

`merge.py` without `--apply` is a dry run and never writes. With `--apply` it
re-checks STOP and the live-class freeze immediately before the write, then runs
`gh pr merge --squash --match-head-commit <sha>`. That is the only merge command
the loop uses, and the repos allow squash only. Never call `gh pr merge` yourself.

## Why each rule is shaped this way

- **One gh lane.** Every GitHub call goes through `sense.gh_lane()`, which holds
  `~/.hypeproof/gh.lock` across sessions. SENSE reads every in-flight PR in one
  GraphQL query. The limit is probed with a real read of repository contents,
  because `gh api rate_limit` cannot see the secondary limit and shows green
  while the lane is blocked.
- **Inherited claims are leads.** `merge.py` takes nothing on trust. The
  verifier verdict, the red-before-green proof, the guard and the class must each
  name the PR's current head SHA. The PR state comes from this tick's SENSE read,
  not from what an agent reported.
- **State outside /tmp.** Locks, the gh-lane log, merges and red-before-green
  worktrees live under `~/.hypeproof/loop`. The scripts refuse a volatile home.
- **One worktree per agent.** `rbg.py` makes and removes its own detached
  worktrees. It never checks out, resets or cleans the builder's worktree.
- **Background tests, quiet Studio.** `rbg.py` removes secrets from the test
  environment and refuses a test command that launches Studio without
  `scripts/studio-launch.mjs` (see `docs/BACKGROUND-TESTS.md`).
- **Never print secrets.** Every gate redacts token-shaped strings from its
  output, and `diff_guard` blocks a diff that adds one.

## Change classes (D1)

`classes.py` gives a PR the riskiest class of any file it touches. Until Jay
records otherwise in `loop/gates/change-classes.yaml`, only `low` (scripts, tests,
pure helpers, non-carve-out docs) can merge automatically. Every other class is
propose-only and parks with the evidence it waits on: E-layer evidence, a Codex
acceptance or human review.

## Daily canary

`GATES/canary.py build --sandbox <dir>` creates 12 planted defects and 2 good
changes on blind local branches. The answer key goes outside the sandbox. The
verifier judges each branch blind, and `GATES/canary.py score` compares its
verdicts with the key. A catch rate below 100% or any good change marked FAIL
exits 12, which trips the breaker: write STOP and tell Jay. `canary.py mech`
checks the library itself. Two of the defects (a deleted guard and an inverted
condition) are clean to the scripts on purpose, so only a reader can catch them.
