## CGP-CHAT-R-023: lesson step dividers (2026-10-25, agent-selected conservative implementation)

- Served step = the step the host captured at turn start for the runtime (`turnLesson`, the `x-hps-lesson-step` value). The divider names exactly what the coach was told, never the step the learner looks at later.
- The first served step also gets a divider: it is the boundary the transcript starts under, and the jump needs a target for it. Unmarked lines (history from before this change, app-answered shortcuts, tool lines) neither start nor break a run; there is no backfill. A re-sent id drops its old mark at the start of the send and is stamped again only on the model path, so a re-send answered by an app shortcut (or in instructor mode) shows no boundary rather than a stale one (verify FAIL fix, 2026-10-25).
- The mark (lesson digest, step id, 1-based number, cleaned title capped at 60 characters) is stored beside the transcript in workspace state, at most 400 per workspace, keyed by the user message id. The task file is unchanged, so older builds still read it.
- "지금 단계로" targets the latest divider of the rail's step on screen (the first step when none is picked) in the lesson on screen. When that step has no divider yet, there is no button. It scrolls only (instantly under reduced motion): no focus move, no step change, no host message.
- Seats: learner seats with a served lesson. Personal workspaces have no lesson (`personalWorkspace` requires no lesson), and instructor mode draws no lesson rail, so neither gets dividers.
- The button sits in region A's footer as a quiet 44px button at the 14px floor (DEC-29), next to 남은 단계, never a second Primary (SX-04).
- Default state: on (display only; no new data leaves the device, no permission change).

