## CGP-CHAT-R-025: task archive (2026-10-25, agent-selected conservative implementation)

- Archive = hide, never delete. An archive sidecar beside the task file records task id and time; the task document, versions and verdicts are not touched, so older builds still read the task file and a downgrade only lists archived tasks again.
- Only the open task is archived (the task menu acts on what is on screen), against the current revision; the host flushes its draft first, as on a task switch. Next open task = the most recently updated listed one, else a new empty task.
- "A running task must be stopped first": the host refusal is the task-switch refusal (stream, settling stop, approval, verification run); the menu item is disabled while streaming.
- 보관함 lives in the task rail as a separate view (DES-CHAT-77), entered from a "보관함 N" button shown only when something is archived. 다시 열기 is the quiet neutral 44px button at the 14px floor (DEC-29), no red.
- Seats: personal task workspaces only (no lesson, not instructor). Class seats have no task list; nothing on any seat deletes a task permanently.
- Default state: on (local display state only; no data leaves the device, no permission change).

