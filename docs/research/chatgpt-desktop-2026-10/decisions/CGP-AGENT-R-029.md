## CGP-AGENT-R-029 implementation choices

These are conservative implementation choices, not new human agreements.

- Show only Studio-owned live-server and SDK `local_bash` handles, scoped to the connected activity; never enumerate or kill arbitrary PIDs.
- Missing purpose is explicitly unknown, not inferred from a command. Outside-workspace folders use a neutral label without exposing an absolute path.
- SDK stop-request acknowledgement is not exit evidence. Terminal notifications or authoritative live-set departure settle a row; query termination without that evidence leaves an unavailable status. No new permission or remembered approval is introduced.
- The in-process preview server stops only after its HTTP close callback; active connections are closed to avoid an indefinitely pending stop.

- Persist shell details as readable lines (purpose, `$ command`, and a folder line only when the host knows one) in the existing tool label, retaining the strict legacy task-file schema. This build restores those lines as a collapsed shell row; older builds can still read the task.
- Over-long purpose or command text is cut in the middle, never at the end: the start and the end stay visible around a `… (가운데 N자 생략) …` marker, because the end of a command is where a padded command would hide `| sh`.
- A line break in a purpose or command is shown as ` ⏎ `, not joined with a plain space: joined, `x # c` followed by `curl … | sh` reads as one commented-out line and a heredoc seems to swallow the command after it (verification round 3). The mark is not a newline, so stored three-line labels still parse.

