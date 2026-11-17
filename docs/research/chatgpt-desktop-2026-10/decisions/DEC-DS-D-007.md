## DEC-DS-D-007: spacing ladder and the primary CTA step (CGP-DS-D-007, 2026-10-22; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Ladder names | `--hp-space-n` by multiple of the 4px unit (1, 2, 3, 4, 5, 6, 8); step 1 directly references the unit, others use `calc(var(--hp-space) * n)` | The name says the size without a lookup, a skipped 7 makes the missing 28px step visible, and the ladder follows the unit | On | no |
| Existing off-ladder spacing | Kept (as DEC-DS-R-010). The guard covers declarations that use the unit or a ladder step | Moving 5, 6, 7, 10px values redraws every surface; that needs a design review | On | needed for a grid migration |
| What is a primary CTA | `.studio-primary`, `.hp-cta-primary`, `.hps-trial-end-card-primary`, `.hps-verify-primary` (the test panel's 테스트 시작, the learner's one action there): the classes that carry the one Primary per screen (SX-04). The composer's send button stays 44×44 (DES-CGP-DS-21) | The narrowest set the code already marks as Primary; no new visual hierarchy is invented | On | no |
| How a CTA reaches 48px | `min-height: var(--hp-control-cta)`; padding and font unchanged | The start page's button already drew 49px; the other two grow 4px, and the Google account override grows from 40px to 48px | On | no |
| 32px step | Defined, not applied; no Studio instructor row moves onto it in this row | The row is about learner surfaces; restyling instructor rows is a separate visual change | n/a | no |
| Audit report location | `HPS_AUDIT_REPORT`, default `<tmpdir>/hps-hit-target-audit/report.md` (+ `.json`), never inside the repo | Generated output in a working tree has leaked into main before | On | no |

