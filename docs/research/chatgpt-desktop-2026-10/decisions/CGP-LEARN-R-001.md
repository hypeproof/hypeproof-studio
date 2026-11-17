## CGP-LEARN-R-001: learning block attached by the confirmed lesson (2026-10-28, agent-selected under DEC-18/19/20)

- Contract check first: the pinned Service (`@hypeproof/service-testkit` 0.1.2, `worker/src/lib/session-design.ts` and `learning-design.ts`) accepts the optional step key `ui` with the seven `STEP_UI_KINDS` and serves it unchanged on `/v1/profile` (`test/service-integration/session-design-learning.test.mjs`). `steps[].materials[]` would be refused (`invalid step fields`), so DEC-19's `ui` field is the only home. Not blocked.
- A block is the step's `ui` value, exactly one of the seven kinds. Anything else (other case, unknown word, an object) is not a block. `ui` carries no parameters, so a block's content is the step's own text; parametric block types (REQ-CGP-LEARN-04) need a Service contract and stay open.
- Identity: the element that draws the block carries `data-hps-material`, `data-hps-material-step` and `data-hps-material-version`, so REQ-CGP-LEARN-02's canvas check and REQ-CGP-LEARN-11's report have a block identity to use.
- Kinds this Studio cannot draw yet (`canvas_editor`, `canvas_preview`, `evidence_note`, `coach_request`, `metric_board`) keep the existing honest notice, now with the block identity. No new component is built in this row.
- DEC-18 is applied at authoring time (an AI-drafted `ui` reaches learners only in a confirmed version, any cohort). Coach-selected blocks at answer time are not built: no Service turn contract carries one, and REQ-CGP-LEARN-01 keeps v1 lesson-attached only.
- Seats: every seat that draws the lesson rail (classroom lesson, personal with a lesson, instructor rehearsal). Default state: on (identity attributes only; no new data flow, no visual change).

