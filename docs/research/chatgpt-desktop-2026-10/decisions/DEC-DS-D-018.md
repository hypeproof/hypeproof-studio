## DEC-DS-D-018: persistent Chalk list actions (2026-10-22; agent implementation choice)

DES-CGP-DS-23 keeps existing native buttons, links and their Korean names. A decorative
currentColor arrow is drawn with CSS beside action labels, avoiding a second DOM renderer
or changes to handlers and accessible names. Disclosure summaries keep their existing
state chevrons. The row floor is 44px; menu density is a separate row.
Only the existing sidebar, seat/board lists, roster preview and instruction-diff list
scroll containers get the 16px/32px fade.
Matching padding protects end rows. Focus-within and forced-colors remove the fade;
keyboard visibility takes priority over decoration. No theme palette, permissions,
minor-safety policy, Service API or human agreement changes.

DEC-DS-D-018 addendum (2026-10-22, CI round 2): the 44px floor must not cost the ops-g1 requirement
(8 complete seat rows at 1280x720, `e2e/classroom/ops-g1-layout.mjs`). The seat row was 44px of target plus a
1px cell border (45px), and the 16px fade padding moved the first row down, so 7 rows fit. Chosen: keep the 44px
target and the 16px/32px fade as specified, and draw the row divider as a zero-height cell pseudo-element so the
row is exactly 44px. Rejected: shrinking the fade padding (departs from the D-018 text), a negative margin on
`#ops-seats` (overlaps the bulk panel above, only 6px apart), and a forced row height (squeezes the narrow grid card).

