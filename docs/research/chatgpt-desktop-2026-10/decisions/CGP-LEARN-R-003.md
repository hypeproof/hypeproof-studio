## CGP-LEARN-R-003: live text equivalent for every block (2026-10-29, agent-selected under the owner rules)

- "Catalog validator" in Studio is the block catalog `MATERIAL_TEXT` (`lessonFocus.ts`) over the seven `ui` kinds plus the check `materialTextGaps()`; Studio has no other block catalog, and parametric types (REQ-CGP-LEARN-04) are still open.
- The state sentence describes the block's state (empty, written, which field is missing, saved, changed after saving, cleared), not every keystroke. A polite region that re-read the field on each key would talk over VoiceOver's own typing echo; the field's value is already read by the screen reader. Every control change that changes the state updates the sentence in the same mounted region (measured under 500 ms in headless Chromium).
- The text is visible, not screen-reader only (DES-CGP-LEARN-03), at the 14px floor in primary text colour. The rest of DES-CGP-LEARN-03 (200 % zoom) is left to that design row.
- "Saved" is shown only after the host answers with the saved work, never on the press itself, so the sentence never claims a save that did not happen.
- Undrawable kinds get a title and say there is nothing to operate; their state never changes. No new component is built.
- (c) VoiceOver run: NOT RUN in this row (needs a person at the real desktop); the browser test checks the accessible names and descriptions a screen reader would read.
- Default state: on, every seat that draws the lesson rail; display only, no new data flow.

