## CGP-LEARN-R-010 / CGP-LEARN-D-010: reset and undo for a learning block (2026-11-14)

This is a Studio-only change with no Service contract. Confirmed by Jay: no (all agent choices).

- **Preset (agent reading).** The blocks this App draws (`criterion_form`, `decision_form`) are catalog v1 with no params, so their preset is empty fields. "처음으로" empties the fields on screen. It does not delete the learner's saved work, which stays until the next 저장. Deleting saved work would be a host write, and REQ-CGP-LEARN-10 (c) rules that out.
- **What one change is (agent choice).** A burst of typing in one field ends on blur, after a 1 s pause, or with a reset or undo. One reset also counts as a change. Undoing keystroke by keystroke would turn a sentence into dozens of steps. The history is held per lesson version and step, and capped at 50.
- **No events (requirement).** Reset and undo post nothing to the host, so they cause no save and no observation event. The browser test counts host messages to check this.
- **Look (agent choice).** Both are the existing quiet button (not Primary, per SX-04), with 44px targets and 14px text. A disabled button uses the muted text token and a dashed boundary, so "visibly distinct" does not rest on opacity alone. The native `disabled` state carries the announcement.
- **Copy.** Each block's controls help names both buttons, and the button labels are the design row's. Both are the agent's wording within the row.
- **Not covered:** a real installed App and a real screen reader.

