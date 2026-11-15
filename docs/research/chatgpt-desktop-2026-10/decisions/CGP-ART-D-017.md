## CGP-ART-D-017: 따라 보기 toggle design (2026-10-27, agent choice)

- Already met on main by CGP-ART-R-017 (REQ-STUDIO-PREVIEW-FOLLOW); no product change. This row adds a computed, frame-sampled test (`live-follow-design.smoke.mjs`) for each design clause: accessible name "따라 보기" with an eye icon (slashed when off), smooth scroll ending within 300 ms, one-frame jump under reduced motion, a 2 px outline that hugs the element for about 1 s, and an announcement on every toggle change.
- "In the preview toolbar": kept as decided for R-017. The integrated browser's toolbar is VS Code chrome with no patch for this row, so the toggle stays a fixed control on the served page (top right).
- Learner 44 px target and 14 px text win over any smaller toolbar control size. Timing: 250 ms scroll (inside the 300 ms cap), 1,000 ms outline.
- Default state: on (local display only; no data flow).

