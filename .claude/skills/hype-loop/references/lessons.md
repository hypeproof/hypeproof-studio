# Lessons baked into hype-loop

Each lesson below came from a real failure in Jay's earlier hand-run loops. Each one is
enforced as a **check** (`loopctl.py` refuses), a **rule** (in the tick prompt), or a
**default** (in the charter interview). Sources are Jay's Claude Code memory files
(`~/.claude/projects/<project>/memory/<name>.md`) or Studio rule files
(`.claude/rules/*.md`). Where no file exists the source is the session itself
(2026-10-19).

| # | Lesson | Becomes | Where | Source |
|---|---|---|---|---|
| L1 | Inherited claims are leads, not evidence. A runbook agent called the Studio release repo private and a blocker; `hypeproof/hypeproof-studio` is public and only the mirror is private. | Rule: verify a claim with a command before acting on it or reporting it, and cite the command | tick prompt R1 | Studio `verification.md` §7; session 2026-10-19 |
| L2 | GitHub budget. `rate_limit` does not show the secondary limit; review fan-outs burned the hour. | Rule: one gh lane at a time; probe with a real read (`gh api repos/<owner>/<repo>/contents --jq length`); no PR straight after a review fan-out; no `gh` in fan-out prompts | tick prompt R2 | Studio `gh-budget.md` §1–5 |
| L3 | State survives only on disk outside `/private/tmp`. A reboot wiped the scratchpad and 11 worktrees' uncommitted work. | Check: `loopctl.py` refuses a volatile `HYPE_LOOP_HOME`. Default: worktrees under `<repo>/.claude/worktrees` when gitignored, else `~/CodeWorkspace/.claude-worktrees/` | loopctl `check_durable_home`; tick prompt R3 | `scratchpad-wiped-on-reboot` |
| L4 | One agent, one worktree, one branch. Two agents on one integration branch collided; a rebase under a running agent wiped its work. | Rule: per-agent worktree and branch; never checkout/rebase/reset a worktree a live agent uses; merge features into integration afterwards, then recompute requirement digests (`config/requirement-work.json` holds sha256 of doc bytes and drifts on every doc merge) | tick prompt R4 | `worktree-branch-ops-during-agents`, `worktree-symlink-git-add-trap` |
| L5 | Tests in the background, no focus change; every Studio app a test opens is quit and cleaned. | Rule: launch Studio only through the quiet launcher; match processes by app path or user-data-dir, never by name; never touch Jay's own Dev/kit app or `.codex-worktrees` | tick prompt R5; harness `docs/BACKGROUND-TESTS.md` | `background-tests-no-focus`, `gui-e2e-local-quiet-policy` |
| L6 | Environment fidelity. The Dev app's in-memory SecretStorage produced a fake "folder bound to another activity" bug, reported twice. | Rule: before calling something a product bug, rule out the instrument and the environment, then reproduce on the shipped path | tick prompt R6 | Studio `verification.md` §6; session 2026-10-19 |
| L7 | Large results go to a Korean HTML artifact; chat gets a link plus 3–5 lines. Chat is Korean; code, commits and docs are English (Studio student copy stays Korean). | Default: the dashboard is a Korean HTML page; the status is 3–5 Korean lines | dashboard template; tick prompt R7 | `~/.claude/CLAUDE.md` Language Policy |
| L8 | Speed comes from routing models by role and cutting tool waits. Last run: 33 Opus agents, 3h32m, 51–54% of time waiting on tools. | Default: Opus implement/verify, Sonnet e2e/clerk/report, Haiku gh lane; reuse test logs; small PRs; scripted ship step | interview Q-models; tick prompt R8 | session 2026-10-19 (agentstats) |
| L9 | Visibility. Jay had to ask "진행상황은?" during a silent 3.5 h run. | Rule: every tick and every phase over 20 min posts a short status. `status` always answers from the ledger, never from memory | tick prompt R9; `loopctl.py status` | session 2026-10-19 |
| L10 | Autonomy contract: ask once, then run. | Default: the charter interview is the only question round; stop only for data-loss risk, a live class, or a human-only step, and give click-by-click steps for that step (the auto-mode classifier blocks some console settings and publish clicks) | interview; tick prompt R10 | `autonomous-loop-merge-policy`, `hypeproof-autonomous-mandate` |
| L11 | Secrets are never printed. | Check: `loopctl.py` refuses a charter, instruction or tick summary that looks like a token. Rule: generate into `~/hps-secrets` (mode 600); prefer CLIs over browser fields; clear the clipboard after use | loopctl `secret_hits`; tick prompt R11 | `~/.claude/CLAUDE.md`; session 2026-10-19 |
| L12 | Production writes need a live-class check, a backup and a restore point. D1 migrations are manual and some are not re-runnable. Deploy flags-off, then flip. | Check: freeze hook at start and every tick. Rule: backup + restore point before prod writes; flags off first | loopctl `freeze_state`; tick prompt R12 | `service-zero-percent-version-probe`; session 2026-10-19 |
| L13 | hype-pr refuses `free-start/` branches; `prepare` must run last; `gh pr edit --body-file` strips the prepared footnote. | Check: charter `branch_prefix` may not start with `free-start/`. Rule: prepare after the final push; re-add the footnote after a body edit | loopctl `validate_charter`; tick prompt R13 | Studio `gh-budget.md` "hype-pr 함정"; `hype-pr-harness-checkout` |
| L14 | Releases: macOS only by default; reuse caches; repack the extension when the VS Code base is unchanged. | Default in the interview; rule in the tick prompt | interview Q-scope; tick prompt R14 | `studio-release-e2e-discipline`, `studio-release-reach` |
| L15 | Decide reversible defaults yourself and record them; ask only what changes the plan. | Default: the interview skips anything answered by the arguments or context, and records chosen defaults in the charter | interview rules | `hypeproof-autonomous-mandate` |
| L16 | Merge decisions made by a model drift; the PR loop needs script gates with controls. | Check: `scripts/loop/` gates (sense, lock, diff_guard, rbg, classes, merge, canary), each with positive and negative controls and a mutation check | tick prompt R16; references/pr-loop-gates.md | loop plan PLAN-FINAL §2.2, §2.4 (2026-10-19) |

## Why these are checks and not just prose

Prose rules were already in place for L1, L2, L3 and L11 and were still broken. Where a
lesson can be decided by a script, `loopctl.py` decides it and exits non-zero, and
`tests/hype_loop/test_loopctl.py` holds a positive and a negative control for it.
