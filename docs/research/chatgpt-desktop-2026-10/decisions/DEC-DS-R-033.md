## DEC-DS-R-033: colour emoji font stack (CGP-DS-R-033, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What "timeline and status lines" means after CGP-DS-R-018 | Icons in those lines stay stroke icons; emoji that remain text (labels, task marks, world faces, messages, answers) use the colour emoji stack | CGP-DS-R-018 already replaced status glyphs with the stroke set and is merged; redrawing them as emoji would undo it | On | no |
| Where the faces go | Appended at the consumer after the host or role font (`var(--vscode-font-family, var(--ds-c-typography-ui)), var(--ds-c-typography-emoji)`), not folded into the role primitives | In the app `--vscode-font-family` is always set and would bypass a role-only change; the token tier rule keeps semantic tokens one primitive each | On | no |
| Order | Emoji faces last | Apple Color Emoji maps 0-9, `#` and `*`; first in the stack it would draw numbers as emoji (the test checks the platform face of digits) | On | no |
| Faces | Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji; no Segoe UI Symbol | The row asks for colour glyphs; Segoe UI Symbol is monochrome | On | no |
| Code and technical text | Unchanged | Code follows the editor font (CGP-DS-R-007); URLs and ids are fixed-width on purpose | n/a | no |

