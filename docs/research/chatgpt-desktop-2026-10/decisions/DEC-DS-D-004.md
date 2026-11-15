## DEC-DS-D-004: the status chip (CGP-DS-D-004, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Where the chip lands in Studio | The evidence drawer's source-state label, the one learner surface that shows real / simulated / self_reported / unverified | It was 12px muted text with no chip; other status marks (`tw-task-state`, verify states) are separate rows | On | no |
| `blocked` in Studio | In the vocabulary (danger, ban icon, 막힘 from Chalk's board) but drawn on no Studio surface | The row names five states; no learner surface shows a blocked state today, and inventing one is out of scope | n/a | no |
| Intent colours | success = `--vscode-charts-green` (fallback `#4ec9b0`), caution = the warn role, info = the body text role, neutral = the muted role, danger = `--vscode-errorForeground` (fallback `#f48771`). Lime is not used | SX-04 keeps lime for the one Primary CTA and the current step. All are colours Studio already draws | On | no |
| Soft fill share | 14% of the intent colour over the surface (neutral 10% plus a dashed edge) | Tinted but clearly not solid; label and icon contrast hold on the app and panel surfaces | On | no |
| Label colour | The body text role, not the intent colour | Keeps ≥4.5:1 on every fill over the app and panel surfaces of the HP palette (measured in `test/status-chip.smoke.mjs`; other host themes are not measured); the icon carries the intent | On | no |
| Label size | `--hp-font-caption` (14px at the default text size) | The learner's text-size choice (CGP-DS-R-009) still grows it; the icon stays 16px | On | no |
| Chalk | Same geometry and soft fill on the board/manage seat chip; Unicode glyphs replaced by 16px stroke SVGs | The row is Both; the seat chip is Chalk's status chip and already carries blocked | On | no |

