## DEC-SHELL-R-016: HP Dark, HP Light, 기기 설정 따르기 (2026-11-14, agent choice)

- Mechanism (agent choice): VS Code's own theme settings, with no extension-side theme engine. HP Light is a second
  contributed theme. The device option is `window.autoDetectColorScheme` with the HP pair as preferred themes. VS Code
  switches the workbench and every webview in one step, so there is no reload and no second source of truth.
- #725 (agent reading): the row never overwrites a theme the learner chose themselves. An explicit non-HP
  `workbench.colorTheme` in user or workspace settings shows as `직접 고른 테마`, disabled, and the host refuses writes.
  An HP theme written by this row counts as an HP choice, so the row can change it again.
- Palette (agent choice): Paper `#F4F6F0`, forest ink `#151D19` and a darker green `#3C6E2F` for the focus ring and
  links, because lime on Paper is 1.2:1. Lime stays the CTA fill with forest text. Each pair is measured in
  `hp-light-theme.smoke.mjs`.
- Default: unchanged (HP Dark), so nobody's screen changes until they choose.
- Only the extension (agent choice, Jay's constraint): `contributes.themes`, `configurationDefaults` and webview CSS.
  There is no product.json and no vscodium-base change. The default theme was already an extension `configurationDefaults` key.
- Live follow and no startup flash: these come from VS Code itself (`window.autoDetectColorScheme` switches on the OS
  change; the window paints the last theme's colours before the workbench loads). They are not measurable headless and
  are NOT RUN here. They need the installed app on macOS and Windows.
- Contrast found by the existing instrument: under HP Light, `text-contrast-computed` flagged `charts.green` (4.33:1),
  `editorInfo` (2.87:1) and the fixed light-red error ink (1.82:1 on every light host theme). HP Light now sets those
  keys, and the error banner takes the host error colour on light themes. Measuring every row also flags the attachment
  ×. Its dark circle is a `::before` that the instrument does not read as a backdrop (white on a dark disc), so it is an
  instrument limit, not a defect. HP Light is therefore measured like the default light themes.

Confirmed by Jay: no.

