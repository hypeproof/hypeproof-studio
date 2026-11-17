## CGP-KNOW-R-028 / CGP-KNOW-D-028: per-task memory switches (2026-11-14, agent-selected)

Requirement: `docs/studio-requirements.md` "Task memory switches" (REQ-STUDIO-TASK-MEMORY-SWITCHES).

- **Place (agent choice).** The switches sit in the personal settings dialog, under the memory list, not in the rail's
  per-task menu. That menu is a `role="menu"` holding only `옮기기`, and native checkboxes do not belong in a menu. The
  dialog already shows the activity's memory, and DES-KNOW-46 asks for native checkboxes with visible labels.
- **Defaults (agent choice).** Both are on, which is today's behaviour. DEC-01 keeps memory always on, and no profile key
  serves per-task defaults, so none is invented. A served default can be read later without changing the ledger.
- **Lock (agent choice).** "쓰기 locks after the first send" is read as: once the task has any message. The host decides
  it from the task's message count, and the webview cannot unlock it.
- **Keep off covers:** the `remember` tool, the one memory write path, and the SDK runtime's file tools aimed at
  `.hypeproof/memory/`.
- **Shell (agent choice).** The SDK runtime also denies any shell command that names `.hypeproof` while keep or use is
  off. This is a coarse, deny-only check, chosen over parsing shell syntax.
- **Path check (verifier should-fix).** File-tool targets are compared after the real path of their deepest existing
  folder is resolved, with case folded on macOS and Windows, so case variants and symlinked folders count.
- **Read side (verifier should-fix).** With use off, the SDK's `Read`, `Grep`, `Glob` and `NotebookRead` are denied on
  the memory folder or on a pattern that names `.hypeproof`.
- **Known gaps (agent choice: state them rather than claim more).**
  - Write side: quote or escape splitting, interpreter one-liners, names built at run time, the local runtime's shell,
    and a `Write` through a dangling symlink. These are covered once #4059 (#4014's turn-end check) lands.
  - Read side: the same shell forms, ancestor searches whose pattern does not name the folder, the local runtime. These
    stay open, and the row stays partially met for reads.
- **Storage.** `workspaceState`, booleans per scope and task. Nothing leaves the device.
- **Seats.** Minors on personal and trial activities get the same switches, because memory is on for them too (DEC-02).
  Class, lesson and instructor seats have no memory store and so no switches.
- Confirmed by Jay: no.

