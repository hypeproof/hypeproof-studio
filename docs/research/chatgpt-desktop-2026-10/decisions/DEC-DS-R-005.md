## DEC-DS-R-005: every hover/pressed fill is a foreground layer; one control boundary (CGP-DS-R-005, 2026-10-21; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| Filled controls | Their own foreground (`currentColor`) at 8% / 14%, drawn as a `background-image` over the resting fill | A layer of the text colour over a filled button would not be its own ink. `currentColor` resolves on the control, so one token serves every fill (checked in Chromium: a red-on-blue button gets `color(srgb 1 0 0 / 0.08)`) | On | no |
| Personal chat ghost buttons | Leave the host's `list.hoverBackground` for the text layer `--hp-bg-control-hover` (supersedes DEC-DS-D-003's carve-out) | DEC-DS-D-003 kept them on the host key to avoid restyling the workbench. This change is in the webview only and the layer still follows the host through its foreground: `#29342C` for `#253526` (HP), `#323233` for `#2A2D2E` (Dark+), `#E7E7E7` for `#E8E8E8` (Light+) | On | no: no workbench colour changes |
| Field and secondary boundaries | `--hp-border-control-default` replaces the host input/panel/widget borders, `--tw-line` and the notice literals | No default theme's input or panel border reaches 3:1 (the HP theme's own `input.border #526448` is 2.5:1 on `#18231C`), and DEC-DS-D-002 already fixed the control boundary for that reason | On | no |
| Light host themes | Bind the control boundary to the Paper control line (`#76837A`) under `body.vscode-light` / `body.vscode-high-contrast-light` | `#748F79` is 2.8:1 on the Light+ error notice tint; the Paper value is 3.1:1 there and 4.0:1 on white. No new palette value | On | no |
| Secondary-filled buttons with no border | Get the control boundary (voice buttons; their `#2C3C2B` fill is 1.4:1 on the forest) | A secondary button must be found by its edge | On | no |
| Exception | The `/manage` seat row's action button takes the Primary style while its row is current or hovered | It is an emphasis tied to the row (also on `aria-current`), not a state layer of the hovered control | On | no |

