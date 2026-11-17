## CGP-DS-D-009: elevation numbers already met, now pinned (2026-10-28, agent decision within DES-CGP-DS-13)

- The design row's numbers were built by CGP-DS-R-012 (above): `--ds-p-elevation-raised-*` is `0 1px 2px`, `--ds-p-elevation-overlay-*` is `0 4px 8px -2px`, alpha 30% dark / 10% light. No product change.
- The existing computed test only held "dark alpha >= .2, at most two geometries, light lighter than dark", so a wrong blur, a .22 dark alpha, a .15 light alpha, the composer on the overlay level or a shadow on a chat bubble all passed. `elevation-computed.smoke.mjs` now asserts each surface's exact level, the exact alpha per theme and that inline content (user bubble, assistant answer) is `none` in every theme run.
- "none (inline)" is read as message content in the flow; the HC and forced-colors rules are unchanged.

