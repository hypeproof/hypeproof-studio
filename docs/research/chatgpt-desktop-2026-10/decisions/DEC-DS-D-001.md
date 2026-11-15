## DEC-DS-D-001: semantic colour role names (CGP-DS-D-001, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Which names follow `--hp-{text\|bg\|border\|ring}-{role}-{state}` | The Studio colour roles in `tokens.css`, the names components read. The numbered `--ds-s-*` tier of CGP-DS-R-001 stays a value transport, not a role API | Renaming the generated tier gives no reader a clearer name and churns every alias | On | no |
| Legacy names | Removed, not kept as aliases. Each use was renamed by the property that paints it, so one old name can map to several roles (`--hp-accent` → bg/border/text accent). `start.css` `--studio-*` aliases removed | Two names for one role would let new CSS keep the old vocabulary. Rendered values are unchanged | On | no |
| States | `default`, `hover`, `selected`, only where a component already had that state | No invented states | On | no |
| Type scale | `--hp-text-{caption,body,lead,step}` renamed to `--hp-font-*` | Otherwise `--hp-text-body` (a size) collides with `--hp-text-{role}-{state}` (a colour) | On | no |
| Light and dark | Dark = forest on `:root`; light = Paper on the reading surfaces (SX-54). Paper binds every role explicitly, including roles whose value is unchanged | The row names exactly these two. Host light themes keep DEC-27 (branded values are equal in both host themes) | On | no |
| Chalk | Pages keep their page-local palettes and alias names. The token file is injected first on every route (CGP-DS-R-001) | Chalk ships three distinct palettes; one role vocabulary would merge them, which is a palette change nobody approved | Unchanged | needed for a Chalk palette merge |
| `--tw-*` | Kept (DEC-27): personal workspace follows the host theme | Already decided | Unchanged | no |

