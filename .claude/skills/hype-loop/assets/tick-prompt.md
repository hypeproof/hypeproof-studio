[hype-loop tick] loop={{LOOP_ID}}

You are running one tick of a recurring loop. The ledger is owned by a script; never
edit it by hand. Answer Jay in Korean; write code, commits and docs in English.

## 1. Begin
Run: python3 {{LOOPCTL}} tick-begin {{LOOP_ID}}
It prints one JSON line.
- action "stop": CronDelete .cron_id, run `python3 {{LOOPCTL}} finalize {{LOOP_ID}}`, republish
  {{DASHBOARD}} with the Artifact tool (same file path), post the final 3-5 line Korean report
  with the dashboard link and final-report.md path, and end the turn.
- action "skip": post one Korean line with .reason and end the turn.
- action "run": continue. If .renew_cron is true, CronCreate the same cron (.cron_expr) and this
  same prompt, CronDelete the old .cron_id, and `python3 {{LOOPCTL}} bind-cron {{LOOP_ID}} --cron-id <new>`.

## 2. Run the instruction (tick .tick of {{TARGET}})
{{INSTRUCTION}}

## Charter (agreed up front; do not re-ask any of it)
{{CHARTER_SUMMARY}}

## Fixed rules (each comes from a past failure; see hype-loop references/lessons.md)
R1 Verify before you act or report. A claim from a STATUS file, runbook, earlier tick or
   another agent is a lead. Re-derive it with a command and cite that command.
R2 GitHub: at most one agent calls gh or the GitHub API at a time (the gh lane, Haiku).
   Probe limits with a real read, not `gh api rate_limit`. Fan-out prompts say "no gh".
   Do not open a PR right after a review fan-out.
R3 Durable state only: ledger and charter live in ~/.hypeproof/loop/. Worktrees go under
   <repo>/.claude/worktrees when gitignored, else ~/CodeWorkspace/.claude-worktrees/. Never
   under /private/tmp. Check `df -h /System/Volumes/Data` before fanning out builders.
R4 One agent = one worktree + one branch. Never checkout, rebase or reset a worktree a live
   agent uses. Merge feature branches into an integration branch afterwards, then recompute
   requirement digests (config/requirement-work.json). Stage explicit paths, not `git add -A`.
R5 Tests run in the background with no focus change. Launch Studio only through the Studio
   quiet launcher; every app a test opens is quit and its user-data-dir removed on every exit.
   Match processes by app path or user-data-dir, never by name. Never touch Jay's own running
   Dev or kit app, /Applications instance, or .codex-worktrees. See docs/BACKGROUND-TESTS.md.
R6 Before calling a failure a product bug, rule out the instrument and the environment
   (e.g. Dev-app in-memory SecretStorage). Reproduce on the shipped path.
R7 Long output goes to the dashboard or a Korean HTML artifact; chat gets a link and 3-5 lines.
R8 Route models by role: Opus implement/verify, Sonnet e2e/clerk/report, Haiku gh lane.
   Reuse test logs, keep PRs small, use scripted ship steps.
R9 Post a 1-line Korean progress note for any phase longer than 20 minutes.
R10 Do not ask Jay mid-loop. Stop only for data-loss risk, a live class, or a human-only step;
   for the last, write click-by-click steps (the auto-mode classifier blocks some console
   settings and publish clicks) and continue other work.
R11 Never print a secret. Generate secrets into ~/hps-secrets (mode 600). Prefer CLIs over
   browser fields. Clear the clipboard after use.
R12 Before any production write: live-class check, backup and restore point. D1 migrations are
   manual and some are not re-runnable. Deploy with flags off, then flip flags.
R13 hype-pr: no `free-start/` branch names; run prepare last, after the final push; re-add the
   prepared footnote after any `gh pr edit --body-file`. Obey the charter's PR and merge rights.
R14 Releases: macOS arm64 only unless the charter says otherwise; reuse caches; repack the
   extension when the VS Code base is unchanged.
R15 Choose reversible defaults yourself and record them in the tick summary.
R16 PR work runs the harness gates in this order: PREFLIGHT, SENSE, ADVANCE, START, VERIFY, SHIP,
   RECORD (hype-loop references/pr-loop-gates.md). Merge only through scripts/loop/merge.py --apply,
   which squash-merges at the exact head. A gate's "no" is final for this tick: report its JSON.

## 3. End
Run: python3 {{LOOPCTL}} tick-end {{LOOP_ID}} --tick <n> --status ok|fail|partial --summary "<one English line>" [--links <urls>]
Then republish {{DASHBOARD}} with the Artifact tool using that same file path (the first
publish's URL is stored with `loopctl.py set-dashboard`). Post a 3-5 line Korean status:
tick n/{{TARGET}}, what changed, what is next, blockers, dashboard link.
If tick-end returns "final": true: CronDelete .cron_id, run finalize, republish, and post the
final report instead.
