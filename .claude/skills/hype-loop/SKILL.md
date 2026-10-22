---
name: hype-loop
description: "Run a recurring in-session loop: N rounds of an instruction every 30 minutes (or another interval), with a charter interview up front, a script-owned ledger in ~/.hypeproof/loop, STOP and done-count stops, a Korean HTML dashboard republished every tick, and resume after a session restart. Use whenever Jay asks for N rounds / every 30 minutes / 반복 실행 / 루프 돌려 / 30분마다, or says /hype-loop start, status, stop or resume, even if he does not name the skill. Not for one-off tasks or launchd/cloud schedules."
---

# hype-loop

Turns Jay's hand-run loop (a ledger, a `CronCreate` at an off-minute, a long prompt of
rules, a dashboard, a Korean status) into four commands. The model runs the
instruction; `scripts/loopctl.py` owns every count, check and file, so the loop does
not depend on what the model remembers.

Claude Code only: it needs `CronCreate`/`CronDelete`/`CronList`, `AskUserQuestion` and
the `Artifact` tool. Every lesson behind the rules is listed with its source in
[references/lessons.md](references/lessons.md).

`LOOPCTL` below means `python3 <this skill dir>/scripts/loopctl.py`. Every command
prints one JSON object; a non-zero exit means "do not proceed" and `.error` says why.

## Commands

### `/hype-loop start [<N>] [--every 30m] [-- <instruction>]`

1. **Interview first.** Follow [references/interview.md](references/interview.md):
   `AskUserQuestion`, up to 4 questions per call, recommended option first, skip what
   the arguments or context already answer. With no instruction, run the full
   interview. This is the only question round the loop gets, so cover goal, done
   condition, scope, rounds and interval, autonomy (merge, PRs now or later, deploy,
   prod writes), verification bar, models and budget, and reporting.
2. Write the charter to `~/.hypeproof/loop/charter-draft.json` and the instruction to
   `~/.hypeproof/loop/instruction-draft.md`. Run
   `LOOPCTL charter-check --charter <c> --instruction-file <i>` and show its Korean
   `summary` to the person as a short block.
3. Call `CronList` and collect the live ids. Run
   `LOOPCTL start --charter <c> --instruction-file <i> --confirmed --existing-crons <ids>`.
   `start` refuses without a valid charter or `--confirmed` (exit 3), under a STOP file
   (4), when the same instruction or a live cron already runs (5), during a live-class
   freeze (6), on low disk (7), or with a ledger home under `/tmp` (2). Report the
   refusal; do not work around it.
4. `CronCreate` with `cron = .cron_expr`, `prompt =` the contents of `.prompt_path`,
   `recurring = true`. Then `LOOPCTL bind-cron <loop-id> --cron-id <id>`.
5. Publish `.dashboard_path` with the Artifact tool (load `artifact-design` first if it
   is not loaded; the template already follows its contract). Store the URL with
   `LOOPCTL set-dashboard <loop-id> --url <url>`.
6. Tell Jay in Korean: loop id, schedule, first fire time, dashboard link, how to stop.

The cron minute defaults to an off-minute (`7,37 * * * *` for 30m) so the loop does not
fire with every other :00/:30 job.

### Each tick

The cron prompt ([assets/tick-prompt.md](assets/tick-prompt.md), rendered per loop)
does: `tick-begin` → run the instruction under the fixed rules R1–R15 → `tick-end` →
republish the dashboard → 3–5 Korean lines. `tick-begin` returns `stop` once `done`
reaches N or a STOP file exists; the tick then deletes its own cron, runs `finalize`
(writes `final-report.md`) and posts the final report. A tick that finds the previous
one still running (under 25 min) skips instead of overlapping.

### PR-loop ticks

If the instruction implements, ships or merges PRs, each tick runs the deterministic
gates in `scripts/loop/` (harness) in the order PREFLIGHT → SENSE → ADVANCE → START →
VERIFY → SHIP → RECORD. Read [references/pr-loop-gates.md](references/pr-loop-gates.md)
for the commands, what each exit code means, and the change classes (only `low`
auto-merges by default). The scripts decide merge eligibility, not the model.

### `/hype-loop status [<loop-id>]`

Run `LOOPCTL status` (add `--all` for finished loops). Answer only from its output:
progress, state, last tick, hours left on the cron, pending stop, dashboard link. Never
answer "how far along is it" from memory.

### `/hype-loop stop [<loop-id>]`

`LOOPCTL stop <loop-id>` writes the per-loop STOP file. In the session that owns the
cron, `CronDelete` the returned `cron_id`, then `LOOPCTL finalize <loop-id>` and
republish the dashboard. From another session, the STOP file alone is enough: the next
tick sees it and cleans up. `touch ~/.hypeproof/loop/STOP` stops every loop.

### `/hype-loop resume [<loop-id>]`

Session crons die with the session and expire 7 days after creation. After a restart,
`CronList`, then `LOOPCTL resume <loop-id> --existing-crons <ids>`. It refuses if the
loop is finished, stopped, or its cron is still live. Otherwise `CronCreate` with the
returned `cron_expr` and prompt, and `bind-cron` the new id. The ledger keeps `done`, so
the count continues. Ticks also renew the cron themselves when it has under 12 hours
left (`renew_cron: true`).

## Files

| Path | Owner |
|---|---|
| `~/.hypeproof/loop/<loop-id>/ledger.json` | `loopctl.py` only |
| `~/.hypeproof/loop/<loop-id>/tick-prompt.md` | rendered at start/resume |
| `~/.hypeproof/loop/<loop-id>/dashboard.html` | rendered at every tick-end |
| `~/.hypeproof/loop/<loop-id>/final-report.md` | `finalize` |
| `~/.hypeproof/loop/STOP`, `<loop-id>/STOP` | Jay or `stop` |

`HYPE_LOOP_HOME` overrides the root (tests use it). `HYPE_LOOP_FREEZE_HOOK` or the
charter's `freeze_hook` names a command that exits non-zero during a live class.

## Adopting a hand-made loop

A `{target, done, log[]}` ledger such as `~/.hypeproof/loop/ticks.json` can be adopted:
run the interview (most answers come from the old cron prompt), then
`LOOPCTL import-legacy --source <ticks.json> --charter <c> --instruction-file <i> --confirmed --legacy-cron-id <old>`.
`CronCreate` the new prompt, `bind-cron`, and only then `CronDelete` the old cron.
