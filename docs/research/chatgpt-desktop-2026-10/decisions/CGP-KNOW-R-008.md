## CGP-KNOW-R-008: task emoji and colour (2026-10-25, agent choice)

- Where: the personal task menu (대화 메뉴) of the open task. The task list has no per-row
  context menu; adding one would be a new navigation pattern. Classroom and lesson seats have no
  task workspace, so they get nothing.
- What: fixed lists only (12 emoji, eight colours with Korean names, or none), stored as ids.
  Free emoji input was not built: it would need bidi/control/length hygiene and could carry text
  into the list. The host re-validates every request.
- Storage: a sidecar next to the task file, so the strict task-file schema of earlier builds
  keeps reading the workspace after a downgrade; only the marks are lost. A mark does not change
  `updatedAt`, so a cosmetic choice does not reorder the list.
- Accessibility: the mark is `aria-hidden`; the title stays the accessible name; the title is
  always drawn, so colour is never the only cue. Colours were picked for at least 3:1 against
  the task list in each theme (measured in the browser test).
- Default state: available to personal and trial learner tasks; no new data flow (local file
  only, no Service call).

