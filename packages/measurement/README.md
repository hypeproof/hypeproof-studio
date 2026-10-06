# HypeProof measurement package

Codex and Claude Code → local observer → compact immutable event deltas → member server → evidence review. Version 0.3.4 captures execution evidence without sending whole transcripts or running a model. Existing historical snapshot readers and `results` remain compatible.

## Who installs

Every HypeProof member installs and connects this package (decided 2026-10-01, #1377). Register at least one HypeProof work repository (studio, lab or harness); anything beyond that is your choice. What the data may be used for, when profile scores are shown and who can read the records are set in [measurement-core requirements §멤버 설치 의무](../../docs/requirements/measurement-core.md#멤버-설치-의무--2026-10-01-결정). This README covers installation only.

## Connect once

Node 22+ is required. Update your studio clone first (`git pull --ff-only`); older clones have no `packages/measurement`.

```bash
cd packages/measurement
npm ci
npm pack
npm install -g ./hypeproof-measurement-0.3.4.tgz
hypeproof-measure projects --project /absolute/path/to/project
```

Create a scoped connection at https://hypeproof-ai.xyz/members/studio/measurement.
Store its token in a private file only (never in a chat, issue or commit) and pass it on stdin:

```bash
hypeproof-measure connect --token-stdin --project /absolute/path/to/project < /private/path/connection-token
hypeproof-measure install-service
hypeproof-measure status
```

Repeat `--project` for unrelated repositories. Registered Git worktrees sharing an authorized repository's common directory are included under that project's granted hash; unrelated directories are excluded. Exact selected roots keep their own hash. Discovery includes all available Codex dates and Claude project/subagent directories, bounded at 5,000 candidates and 10,000 directories. A limit produces an explicit error, not a silently shortened history.

The existing macOS LaunchAgent runs one cycle every 30 seconds after the prior cycle finishes, survives terminal exit, and starts at login. Other platforms run `watch` under their existing supervisor (below). No additional watcher, host hook, model call, or Windows service is installed. Tokens expire after 30 days; rotate via `connect`. Another owner's outstanding records remain isolated.

### Linux and Windows: run `watch` under a supervisor

`install-service` and `stop` are macOS only. On Linux and Windows both exit with `service_install_requires_macos_use_watch` and change nothing, so `stop` does not pause capture there; stopping the supervisor does. `watch` is the same 30-second loop the LaunchAgent runs. The supervisor starts it by absolute paths because it does not load your shell `PATH` (nvm, npm prefix).

Linux (systemd user service), after `connect`:

```bash
NODE="$(command -v node)"
CLI="$(npm root -g)/@hypeproof/measurement/dist/cli.mjs"
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/hypeproof-measure.service <<EOF
[Unit]
Description=HypeProof measurement watch

[Service]
ExecStart="$NODE" "$CLI" watch
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now hypeproof-measure.service
hypeproof-measure status
```

It starts at login. Logs: `journalctl --user -u hypeproof-measure`. To stop capture: `systemctl --user disable --now hypeproof-measure.service`.

Windows (Task Scheduler, PowerShell). PowerShell has no `<` redirection, so `connect` reads the token from a pipe:

```powershell
Get-Content -Raw $HOME\.private\hp-token | hypeproof-measure connect --token-stdin --project C:\absolute\path\to\project
$node = (Get-Command node).Source
$cli = Join-Path (npm root -g) '@hypeproof\measurement\dist\cli.mjs'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$cli`" watch"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'HypeProof Measurement' -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName 'HypeProof Measurement'
hypeproof-measure status
```

`-ExecutionTimeLimit ([TimeSpan]::Zero)` matters: the default limit (72 hours) would end `watch`. Its console window stays open while it runs; closing it stops capture until the next login or `Start-ScheduledTask`. To stop capture: `Unregister-ScheduledTask -TaskName 'HypeProof Measurement' -Confirm:$false`.

Neither recipe has been run on a member's machine yet (the Linux unit file was only syntax-checked). Report what you see on #1377.

### Install traps

These four were hit during the first member install (#1377):

| Symptom | Cause and fix |
|---|---|
| The member page rejects the connection with `invalid_projects` | It wants the project **id**, not the name: the 64-character SHA-256 `id` printed by `hypeproof-measure projects`. |
| Connected, but `observed_events: 0` | Sessions are matched by the directory they were started in. Start `claude` or `codex` **inside** the registered repository; a session started elsewhere that works on it through absolute paths is never captured. |
| `hypeproof-measure: not found` after a successful `npm install -g` | The npm prefix's `bin` directory is not on `PATH`. Add it, or link the command: `ln -sfn "$(npm config get prefix)/bin/hypeproof-measure" ~/.local/bin/`. On Windows, add the directory printed by `npm config get prefix` to `Path`. |
| Every `npm` command fails with `MODULE_NOT_FOUND` | `NODE_OPTIONS` names a preload file that does not exist. Run `unset NODE_OPTIONS` (PowerShell: `Remove-Item Env:NODE_OPTIONS`) and retry. |

## Use

```bash
hypeproof-measure sync                       # one bounded cycle
hypeproof-measure status                     # counters, backlog, errors; no credentials
hypeproof-measure observations               # online capture sessions/coverage
hypeproof-measure observations --id UUID      # online captured task/activity detail
hypeproof-measure results                    # saved review/results list
hypeproof-measure results --id SNAPSHOT_UUID  # verified frozen review source + result
hypeproof-measure records                    # historical imported snapshot receipts
hypeproof-measure stop                       # macOS: stop service and pause collection
```

`observations` and `results` only read the server. They remain available while capture is paused. Offline or revoked access fails explicitly; no stale-result fallback or review write occurs. Open the member page to select a task, freeze its review source, review the evidence, and record an interpretation. Receipt acceptance proves transfer, not task success, independent human behavior, capability or improvement.

## Local preprocessing and privacy

The observer retains bounded, redacted visible-message excerpts (1,000 characters), model conditions, explicit turn lifecycle, paired tool call/results, and project-relative artifact references. Hidden reasoning is omitted completely. Full commands, environments, stdout/stderr, file contents and patch bodies remain local. Only their safe structural metadata or content digests may transfer. Since 0.3.4 a pasted Lab connection token (`hps_sync_` followed by 43 base64url characters) is redacted like the other known formats. Known-secret redaction is not an anonymity guarantee; visible messages can still contain personal information. Artifact references describe the recorded operation, not proof that a file currently exists or has that version.

Tool status uses explicit structured exit codes/interruption/error fields. Missing execution codes stay `unknown`; assistant claims of success never become a passed test. Background results bind to the original call/task/model when the host supplies a linkage. Human-role input stays `human-unconfirmed`; Codex fork boundaries omit inherited parent content, and Claude sidechain records remain delegated. Unsupported host records, malformed complete lines, hidden content and deliberately clipped excerpts have separate coverage counters (`excerpted` differs from skipped `oversized` records). Known host bookkeeping is counted as intentionally omitted.

## Incremental transport and recovery

`hps-observer-delta/1` sends consecutive complete-line byte ranges with source hashes, stable event IDs, generation, sequence, predecessor digest and per-delta coverage. The exact portable contract and synthetic fixture are `src/observer-contract.mjs` and `test/fixtures/observer-delta.json`.

- Each delta contains at most 250 events and 512KiB. Raw source files are capped at 1GiB; complete lines up to 16MiB are parsed locally, including large compaction bookkeeping. A complete line above that cap is omitted with an oversized count; an unfinished line buffer above 16MiB fails visibly. None of this increases the event excerpt or wire limits.
- A cycle reads at most 64MiB of source ranges, at most 32MiB per source, and queues at most 50 deltas minus existing pending observer batches. Remaining sources are counted as deferred and resume next cycle. Cycles alternate recent-source priority with a persisted round-robin cursor for fair historical backfill. Recent priority takes one source per host and alternates which host goes first, so a larger host history cannot monopolize the recent slots; a 20-second capture budget starts after discovery and is checked between sources. Cold discovery cannot consume that capture allowance.
- Only appended complete lines are normalized. Partial tails wait for completion. An unchanged, fully scanned source requires no transcript content reads; discovery caches unchanged headers. File metadata and directory listings are still inspected.
- Checkpoints persist task/model, pending calls, generation and source offset. Each immutable outbox record contains its checkpoint for crash recovery. Checkpoint advancement follows the durable queue write; upload order is per source/generation/sequence.
- Inode changes, truncation, same-size rewrites, changed prefix or changed checkpoint-tail anchor start a new generation. This is append-log integrity checking, not a continuous whole-file audit: an in-place middle rewrite that preserves checked boundaries while appending can require an explicit rescan.
- More than 500 unresolved calls fails explicitly. A task may remain unassigned when its host supplies no reliable task boundary; no task intent is invented.
- SHA-256 digests bind canonical delta contents; matching `accepted-observer` receipts complete upload. Conflicts/offline errors retain the queue. New deltas are not downloaded back as duplicate full snapshots.

Version 0.2.x queued snapshots still upload to their original endpoint; accepted historical snapshots still import into the separate inbox with receipt/digest checks. Original transcripts are never overwritten. HTTP410 `session_deleted` durably suppresses all future capture for that owner's host/project/session before removing pending records. Only `snapshot_deleted` skips a historical download race; other errors remain visible. Existing local inbox/export/original copies are not purged by server deletion.

## Validation

`npm test` covers append-only bytes, unchanged cycles, retries, checkpoint crash recovery, partial lines, malformed coverage, reset generations, fork/sidechain provenance, background calls, model binding, redaction, artifact bounds, real HTTP receipts, deletion suppression, historical compatibility and read-only results. No real private transcript is used in the committed fixtures.
