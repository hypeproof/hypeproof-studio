## DEC-DS-R-026: logical CSS ratchet (CGP-DS-R-026, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What "new" means | A ratchet: the 102 physical declarations on main are grandfathered in `config/logical-css-baseline.json`, counted per file by property and normalised value | The acceptance asks for 0 new ones. Converting the shipped ones would move nothing in LTR but touches 15 files of geometry that DEC-27 keeps; a per-value count still catches a copied or swapped declaration while a selector rename does not fail | On | no |
| Stale baseline entries | Fail until the baseline is shrunk with `--update`; `--update` refuses to grow it | Slack left by a removed declaration could otherwise be reused by a new one in the same file | On | no |
| Carriers | Webview `.css` and TSX `style={{}}`; Chalk `.css`, HTML `<style>` and `style=""`, exported `…Css` template literals | These are every place component CSS is authored today; JS positioning from measured rects and the generated token transport are not authored CSS | On | no |
| Properties | Exactly the acceptance list: margin-left/right, padding-left/right, left, right | text-align, float, borders and shorthands belong to the design row CGP-DS-D-023 and would grow the baseline | On | no |
| Escape hatch | `logical-css: physical <reason>` on the same line | Some placements are physical on purpose (e.g. centring with translateX, which does not flip in RTL) | On | no |
| Tooling | A repo script plus a static smoke, not Stylelint | The repo has no Stylelint; Chalk's CSS lives in HTML and TS strings that Stylelint would not read without custom syntaxes | On | no |

