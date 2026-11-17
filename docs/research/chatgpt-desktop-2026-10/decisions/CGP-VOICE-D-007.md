## CGP-VOICE-D-007: compact control corner snapping (2026-10-27, agent-selected)

- Already met on main by CGP-VOICE-R-008: four corners 16px from the visible viewport edges, the move eases only when motion is allowed, and the `옮기기` button's tooltip (`title`) and accessible description carry the keyboard help.
- 150 ms: kept at `--hp-dur-press` (140 ms). The design scale has no 150 ms step and literal durations are not allowed; 140 ms is within the row's 150 ms. The curve is `--hp-ease` (`cubic-bezier(.19, 1, .22, 1)`), an ease-out curve.
- Proof, not a rewrite: `voice-compact-corner.smoke.mjs` slows the timeline through the CDP Animation domain and reads the transitions a real move starts (top/translate, 100-150 ms, ease-out shape, control seen between corners), checks a reduced-motion move starts none, and compares the tooltip and description with the help text. No product code changes.
- Default state: n/a (VoicePanel is still unmounted; voice is not shipped).

