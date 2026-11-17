| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| CGP-LEARN-R-005 (`text_list` param kind) | The learning-block catalog gets a `text_list` param kind, used by `stage_stepper` v1: 2–8 items, each a title of at most 40 characters and a sentence of at most 60; the Service validates every item with its safe-text check; the list is pinned at confirm with the lesson version; the learner has no field to edit it. The catalog contract change is approved for this scope only | Jay 2026-11-14 | Not built | yes (2026-11-14) |
## CGP-LEARN-R-005 / R-006 in Chalk: authoring box_spacing and stage_stepper (2026-11-15, agent-selected)

- **Offered only when served.** The two kinds appear in the work-surface select only when the features read's `step_ui_catalog` lists them in a shape the page can edit. The coordinator asked for this because the Service halves (#509, #510) are not deployed yet, so a save with either kind would be refused today. Before the read, or on a Service without them, a stored value is kept and named, and its params are saved unchanged.
- **Studio version note.** When offered, the option ends with ` — 학생 Studio 최신 버전 필요`, and a note under the choice points at the seat version column on 수업 운영 (CGP-SHELL-R-034, `업데이트 필요`). No version number is invented. The coordinator chose a label over merge order alone, because a learner on an older Studio sees the unsupported notice.
- **box_spacing: presets only.** 시작 상태 lists the catalog's presets and nothing else; there is no free numeric entry. A carried value that matches no preset is kept as `지금 값 유지 (직접 설정)`.
- **stage_stepper: the Service judges the text.** Chalk enforces the catalog's counts and lengths (`maxlength`, the add and remove limits) and trims surrounding spaces. It does not repeat the Service's safe-text and link rules; a 400 `invalid_step_ui` is shown at the input its `field` names.
- **Switching types keeps the draft.** What was typed for a type is kept on the step while another type is selected, so switching back does not lose it. Only the selected type's params are saved.
- **Order.** This merges after Studio #4166, which draws the two blocks.
- Not covered: the deployed Service, and a real screen reader.
- Confirmed by Jay: no.

