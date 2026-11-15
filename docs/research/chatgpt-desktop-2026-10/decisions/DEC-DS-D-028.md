## DEC-DS-D-028: the contrast table and its fixes (2026-10-22; agent implementation choice)

DES-CGP-DS-42 asks for an automated contrast table "over every token pair actually used". The
choices below are the agent's, taken conservatively (raise contrast, never lower it); none is a
new human agreement or a palette change for the HypeProof Studio theme.

| Question | Choice | Why | Default | Human needed |
|---|---|---|---|---|
| How Studio pairs are found | Every `color:` declaration in the webview CSS, on its own background or on each surface of its scope (chat, personal, branded, Paper), in a committed stylesheet test | A rendered audit sees only the states it drives; the stylesheet covers every rule, so it over-approximates instead of missing pairs | On | no |
| Which themes | The HypeProof Studio theme as VS Code delivers it (its keys plus the registry's dark defaults), no theme at all (CSS fallbacks), and the eight VS Code default themes for muted text | The shipped theme is what learners see; fallbacks must not be a quieter palette; muted text is what this row is about. Non-muted text under other themes stays with `host-theme-mapping.smoke.mjs` | On | no |
| How Chalk pairs are found | Real Chromium over every served page at 1280/390 px, hidden blocks revealed, `<details>` opened, colours read back from the cascade; a CI step in the existing real-Chromium job | Chalk pages layer a dark palette over an older light one, so a static reading of their CSS reports pairs that never render. Script-built rows from Service data are not covered (listed in the requirement) | On | no |
| Muted text that read `--vscode-descriptionForeground` directly | Reads `var(--hp-text-muted-default)`; `--tw-muted` takes the role's light value on light theme kinds | The role already carries CGP-DS-D-002's light fix (Light+ `#717171` is 4.4:1 on `#F3F3F3`). Dark themes get the same host value as before | On | no |
| Error text fallbacks | `#f48771` (the status chip's danger value) instead of `#c62828` / `#e55` | `#c62828` was 2.6–3.1:1 and `#e55` 4.2:1 on forest; only the no-theme fallback changes (`#f48771` is 5.9–7.2:1) | On | no |
| Publish "verified" colour | Primary text instead of `#2e7d32` | The sentence names the state in words (SX-50); green text at 4.5:1 does not exist for both Light+ and forest with one value | On | no |
| Classroom "Stop" label | The app surface colour on the error fill | Error colours are light in dark themes and dark in light ones, the opposite of the app surface, so the pair holds in both; white on the dark-theme `#F48771` was 2.5:1. Light themes are unchanged (their app surface is white) | On | no |
| Text dimmed with `opacity` | Not allowed outside disabled controls, animation frames and icons; of the 24 rules that faded, 21 take the muted role and 3 stop fading | Opacity makes contrast depend on whatever lies underneath, which a token table cannot see; `.hps-hint` at .7 was 2.7:1 on Light+. CGP-DS-R-019 already says this of placeholders | On | no |
| Pressed muted controls | Keep the hover text colour (the body text) | Muted on the pressed layer was 3.6–4.4:1; the hover state of the same controls already switched | On | no |
| Icons | 3:1, not 4.5:1 | WCAG 1.4.11: an icon is a graphic; its label carries the words | On | no |
| Studio ancestor surfaces | A leading part of the selector, plus a listed set of TSX parent/child classes | A name prefix alone mistakes variants (`.hps-naming-btn-ghost`) for children; the list was read from the TSX | On | no |
| Chalk placeholders | Each page's existing secondary ink at full opacity | Chromium's default `#757575` was 3.3–3.7:1 on the dark fields; existing tokens only, so the Chalk transport is unchanged | On | no |
| Chalk authoring eyebrow and toggles, board button | The page's existing dark muted / quiet-control inks; page ink on the blue accent | They were left on the light-page inks (3.0–3.5:1) and white on `#5B8DEF` (3.2:1); existing tokens only | On | no |

