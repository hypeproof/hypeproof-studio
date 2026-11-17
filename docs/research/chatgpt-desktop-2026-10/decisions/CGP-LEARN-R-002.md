## CGP-LEARN-R-002: a learning block stays out of the canvas and never judges (2026-10-28, agent-selected)

- Already met on main by the R-001 block (the step's `ui`, drawn only in `LessonStepPanel`). This row adds no behaviour; it proves the three acceptance clauses with behavioural tests and records the rule as REQ-STUDIO-LEARNING-BLOCK-NO-JUDGMENT.
- "Work canvas" is read as SX-05/SX-13 define it: the editor area (the learner's files, preview, test results) and every editor-area panel the extension creates. The chat surface's rail is not the canvas, also when the start page hands its editor tab to the conversation (`openInEditor`): that tab is the chat surface. `canvas_editor` and `canvas_preview` blocks keep their notice in the rail.
- "Block assets" are the words the block element shows: text plus spoken attributes, empty and with the learner's saved lines, for all seven kinds. A whole-bundle string scan of `LessonStepPanel` would flag the instructor rehearsal's 통과 line, which is drawn outside the block; the rendered block is audited instead, and the rehearsal line is the control that the audit sees verdicts.
- Capability labels are read from `@hypeproof/measurement-core/capability-models` (both models, keys and Korean labels), never copied into the test.
- "No evidence from block interaction alone": a block save writes only the workflow line `lesson_work_saved` (lesson version, step id, kind); no `evidence_type`, no ops observer call. REQ-CGP-LEARN-08's `criterion_set` (only when the step's design lists it) is not built here.
- Seats: classroom, personal with a lesson, instructor rehearsal. Default state: unchanged (on).

