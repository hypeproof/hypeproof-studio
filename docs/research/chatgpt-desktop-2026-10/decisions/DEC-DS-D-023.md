## DEC-DS-D-023: logical CSS design list (CGP-DS-D-023, 2026-10-28; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| "Stylelint or equivalent" | Widen the DEC-DS-R-026 ratchet lint, not Stylelint | Same reason as DEC-DS-R-026: no Stylelint in the repo, and Chalk CSS lives in HTML and TS strings | On | no |
| Added findings | `text-align: left/right`; four-value `margin`/`padding`/`inset` whose right and left components differ | These are the physical forms of the row's four names (`text-align:start`, `*-inline`); shorthands with one to three values or equal sides are already symmetric | On | no |
| Existing declarations | Grandfather the 67 on main (baseline 102 -> 169) with one `--allow-grow` | Same as DEC-DS-R-026: converting is invisible in LTR but rewrites geometry DEC-27 keeps; the ratchet still stops new ones and stale slack | On | no |
| Left out | `float`, `clear`, `border-left/right`, `scroll-margin`/`scroll-padding` | Not in DES-CGP-DS-29's list; adding them would grow the baseline for no named acceptance | On | no |

