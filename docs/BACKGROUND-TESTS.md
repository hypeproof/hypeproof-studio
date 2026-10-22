# Background tests and Studio cleanup

Shared rule for every agent (Claude Code, Codex, OpenClaw) in every HypeProof repo.
Jay, 2026-10-18 and again 2026-10-19: "테스트할때는 백그라운드로해주고, studio를 연다면
꼭 리소스 정리도하고". Other sessions are developing on the same machine while tests run.

## Rules

1. **Background, no focus change.** Tests, walkthroughs and verification runs never
   open a visible window or take focus. Prefer headless browsers and the quiet app
   harness. A "five-second check" in a visible window counts as a violation.
2. **Studio only through the quiet launcher.** Any HypeProof Studio or Dev app that a
   test, script or agent opens is launched through the Studio quiet launcher (Studio
   repo, branch `feat/quiet-studio-launcher-20261019`, landing in `hypeproof-studio`).
   Its contract:
   - **Launch through the launcher**: it starts the app hidden and inactive, with a
     scratch `--user-data-dir` and extensions dir it owns, and records the PID and paths.
   - **Cleanup on every exit**: normal end, failure, timeout or signal, the launcher
     quits the app it started and deletes the scratch dirs, servers and temp builds.
   - **`sweep`**: a command that finds and removes leftovers from earlier crashed runs.
     Run it before and after a test batch.
   - **Raw-launch guard**: a check that fails when a test or script launches Studio
     directly (`open -a`, the app binary, `_electron.launch`) instead of through the
     launcher.
   Until that branch lands, follow the same contract by hand.
3. **Match processes by path, never by name.** Kill or quit only processes whose
   executable path or `--user-data-dir` is one your run created. `pkill -f "HypeProof"`
   or any name match is forbidden.
4. **Hands off what is not yours.** Never quit, kill or modify Jay's own running Dev or
   kit app, the `/Applications` instance, or anything under `.codex-worktrees/`. The only
   exception is an app Jay explicitly asked you to keep open for him.
5. **Work in a worktree.** Do implementation in a git worktree under
   `<repo>/.claude/worktrees/` when that path is gitignored, else under
   `~/CodeWorkspace/.claude-worktrees/`. Never under `/private/tmp`, which a reboot wipes.
   Remove the worktree after its branch is pushed.

## Report

When a run opened any app, the final report says what was opened and confirms it was
quit and cleaned, with the `sweep` output.
