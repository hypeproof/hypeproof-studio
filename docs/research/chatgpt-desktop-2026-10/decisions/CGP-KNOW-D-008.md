## CGP-KNOW-D-008: emoji/colour picker design met on main (2026-10-26, agent choice)

- DES-KNOW-13 was built with CGP-KNOW-R-008: the picker opens from the open task's menu, every
  colour shows its Korean name, the selected one has a ring and a check. No product change.
- "3:1 against panel" is read as both surfaces a swatch is drawn on: the task list (already
  measured) and the picker dialog (not measured before). Both now pass in dark and light.
- "2px focus ring" on the selected swatch is measured as the drawn ring width (border plus inset
  spread in one colour), not only its presence; forced colours keep a 2px Highlight border.
- Only the test and the contract text change; four CSS mutations that main's test let through
  (3px ring, low-contrast picker swatch, hidden check, forced-colours ring dropped) now fail.

