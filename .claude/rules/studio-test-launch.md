# Studio test launches — background only, always cleaned up

Loaded when a test, harness or script opens the Studio app. Source: Jay,
2026-10-19 ("run tests in the background; if you open Studio, always clean up").
Enforced by `scripts/check-studio-launches.mjs` in PR CI (`repo-controls`).

## The only way to open Studio from test code

| From | Use |
|---|---|
| Playwright (`_electron`) | `launchStudio(electron, options, meta)` |
| Node spawn of the binary | `spawnStudio(binary, args, options, meta)` |
| Shell / Python | `node scripts/studio-launch.mjs run --label X --secret-storage os -- <binary> [args]` |

All from `scripts/lib/studio-launcher.mjs`. `meta` is
`{ label, secretStorage: 'inmemory' | 'os', quiet?, foreground?, interactive? }`.

## What the launcher guarantees

- **Background**: on macOS the main process starts paused (`--inspect-brk` on a
  loopback port); the launcher sets the activation policy to `prohibited` and
  makes `show()`/`focus()` inactive before VS Code's code runs, then resumes it.
  Measured 2026-10-19: without this, 4 of 9 real launches left the app frontmost and
  every launch activated it briefly; the packaged shell ignores a `-r` preload. The
  bundle is also marked `LSUIElement` (a disposable copy in place; the installed
  app, the in-tree build, studio-dev states, Jay's Dev kit and `.codex-worktrees`
  are never modified, an APFS-clone copy under the launch root is used instead).
  Windows are off-screen, transparent and click-through; CDP still drives and
  captures them. `HPS_LAUNCH_QUIET_HOOK=0` turns the paused start off.
- **Focus is checked, not assumed**: from before the launch, a watcher polls
  `lsappinfo front` every 100 ms; if one of the run's processes becomes frontmost
  it hides that app (focus returns) and the run fails.
- **Isolation**: run id, run dir and temp `--user-data-dir` / `--extensions-dir`
  under `~/Library/Caches/hps-test-launches` (outside `/private/tmp`, survives a
  reboot or a scratchpad wipe). Override with `HPS_LAUNCH_ROOT`.
- **Cleanup** on normal exit, failure, SIGINT, SIGTERM, SIGHUP: kills the process
  tree it started — descendants of its pids plus processes whose command line
  carries its user-data-dir or run dir. Never by name. Refuses a profile already in
  use by a process it did not start.
- **Manifest** (pids, dirs, ports, servers) in each run dir; `sweep` cleans runs
  whose owner is dead, `sweep --owner-tree PID` also runs owned inside an aborted
  suite, `check --session ID` fails a suite that left anything behind
  (Playwright `global-teardown.ts` and `scripts/e2e-quiet.sh` do this).
  `sweep --apps` also removes unused cached app copies.

## Secret storage is a test-fidelity decision

`--use-inmemory-secretstorage` avoids the keychain prompt on ad-hoc signed copies,
but the secrets live only as long as the window. Any flow that reloads or reopens
a window (opening a workspace folder, a restart test, a second window) loses
them and the app claims again — this produced a fake product bug once. Use
`secretStorage: 'os'` for those flows.

## Exceptions

- `foreground: true`: the test needs real focus (e.g. `e2e/accounts/mac-return.mjs`).
  Refused unless `HPS_LAUNCH_ALLOW_FOREGROUND=1` or CI — run it only when nobody
  is at the machine. `foregroundOptIn` is for a caller that already requires its
  own explicit opt-in (feedback-native `--allow-foreground`).
- `interactive: true`: a person works in the window (a dev host). Visible, still
  tracked and cleaned up.
- Human launchers that outlive their script (`studio-dev.py run`, `cr-dev-kit.sh`,
  `review-pr.sh`, installers) carry `studio-launch: interactive -- <reason>` on
  the line or the line above. Tests never use them.
