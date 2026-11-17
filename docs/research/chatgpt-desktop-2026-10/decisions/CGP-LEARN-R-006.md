| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| CGP-LEARN-R-006 (first parametric type) | `box_spacing` v1 is the first parametric block type for the bounded-controls row | Agent choice; the loop coordinator accepted it. Jay did not choose it | Not built on `main` | no (agent choice) |
## CGP-LEARN-R-006 / R-005 (D-006 / D-005): the parametric blocks in Studio (2026-11-15, agent-selected)

Confirmed by Jay: no. The coordinator chose box_spacing v1 as the first parametric type. Jay approved `text_list` for stage_stepper only.

- **One spec, checked (coordinator).** Studio's v1 specs (`blockParams.ts`) are tested against the Service's published snapshot, vendored byte-for-byte with a sha256 pin, not hand-copied. A Service checkout gives a live comparison too.
- **Fail closed (agent choice).** Served params are re-validated, and anything off draws the unsupported notice.
- **Styles (coordinator).** The preview is a React style object from clamped numbers only. A served "8px;background:url(x)" reaches no DOM even with re-validation bypassed, which a test shows.
- **Caption (coordinator).** It is computed from the same clamped values under content-box sizing, with the 0 and maximum cases tested.
- **Controls (agent choice).**
  - Native ranges, with keys handled in code so that PageUp/PageDown are 10 % everywhere. A segmented radio group for 4 options, and the overflow list for more.
  - Reset and undo follow R-010: one drag or one run of keys is one change. Everything is local only.
- **Stepper (agent choice).**
  - The whole block takes focus for ←/→. There is no timer.
  - Stage text is drawn as text nodes only. The caption repeats the stage title, which is text too.
- **After verify (#4166, agent choice).**
  - The box preview scrolls, so it is a registered focus scroll scope (inset ring), like the other scrolling containers.
  - Stage text uses the Service's single-line safe-text rule, checked against the shared case list.
  - The SX audit's `stage_position` allowance covers only a stepper position: single digits within 2–8 stages, no score word before it and no judgment word after 단계. "3 / 4 단계 통과" and "90 / 100 단계" are flagged.
- **Not covered:** a real installed App and a real screen reader. Chalk authoring is the next PR.

