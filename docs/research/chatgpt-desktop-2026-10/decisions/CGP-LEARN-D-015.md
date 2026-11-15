## CGP-LEARN-D-015: checklist output as plain rows (2026-10-27, agent-selected: already met, proved)

- Already met on main: the CGP-LEARN-R-015 build draws `/authoring` completion conditions as an ordered list, one row per item with the sentence, its record kind and row actions. There is no points column, no level header and no number field. No product code changes.
- "Rendered" covers what the instructor sees on the page, what the page saves, and the one-line summary that the version and change views use. A loaded draft whose items carry extra keys (points, level, score, grade) does not draw them, and saving writes back only id, text and record kind.
- The list keeps its 1., 2., 3. ordinals: they number the items and are not points.
- Proof: T-50 `chalk/test/checklist-output.browser.mjs` measures the real served page in headless Chromium at 1420 and 375 px (computed layout, elements, rendered words). Five planted mutations (points cell, level header, kept extra keys, grid columns, level option) each fail it.
- The learner side (Studio MissionHeader, plain list of unchecked items) is unchanged and is already guarded by `extensions/hypeproof-chat/test/sx-mission-header.smoke.mjs` with the SX-35/SX-59 render audit.
- Default state: n/a (no behaviour change).

