---
title: Host theme kinds verification
product: studio
doc_type: testing
status: canonical
owner: core
version: 0.1.0
last_reviewed: 2026-11-12
audience: maintainers
source_paths:
  - extensions/hypeproof-chat/test/host-theme-kinds-computed.smoke.mjs
  - extensions/hypeproof-chat/test/host-theme-mapping.smoke.mjs
  - extensions/hypeproof-chat/test/elevation-computed.smoke.mjs
quality_gates:
  - executable-commands
---

# Host theme kinds verification (CGP-DS-R-004)

Requirement: `docs/studio-requirements.md` "Host theme kinds (CGP-DS-R-004)", REQ-CGP-DS-03.

## Command

```bash
cd extensions/hypeproof-chat
FOCUS_REQUIRE_BROWSER=1 HOST_THEME_KINDS_EVIDENCE=/tmp/host-theme-kinds \
  node --experimental-strip-types test/host-theme-kinds-computed.smoke.mjs
```

It runs in `npm test` with every other `test/*.smoke.mjs`. Without a headless Chromium it prints
`NOT RUN`; with `FOCUS_REQUIRE_BROWSER=1` (CI) that is a failure. `HOST_THEME_KINDS_EVIDENCE` is
optional and writes 108 screenshots (`<surface>-<kind>-<width>.png`).

## What it loads

| Surface | Source | Sits on |
|---|---|---|
| chat | bundled stylesheet from `webview-ui/src/main.tsx` + `ChatPanel` rendered with react-dom/server | side bar |
| start | the same stylesheet + `StartPage` in `.studio-start` | editor |
| preview shell | `PreviewProvider.show()` with a `vscode` stub; the review bar with a notice is shown | editor |
| artifact history | `artifactHistoryHtml` | editor |
| image comparison | `imageEditComparisonHtml` | editor |
| personal continuation | `personalContinuationHtml` | editor |
| slide studio | `slideStudioHtml(slideStudioView(...))` | editor |
| visitor preview | `visitorPreviewHtml` | editor |
| work takeaway | `workTakeawayHtml` | editor |

Automation, local review and skill store load the same bundle as the chat and the start page, so
the chat and the start page stand for them.

Each page gets what VS Code gives a webview: the theme colours as `--vscode-*` on `<html>` (the
keys in `test/lib/vscode-default-themes.mjs` plus the colour-registry defaults the panels read),
the kind class on `<body>`, a default style that sets the body colour and font from the theme, and
the surface behind the webview. Kinds: Dark+, Light+, HC Dark, HC Light (both high-contrast
classes), and the HypeProof Studio theme at 390px. Widths: 320, 390, 1280px.

## Checks

- Chat token set per kind: text, app, ring and CTA roles equal the theme's own keys; elevation
  .30 dark, .10 light, none in high contrast; four distinct sets. HP theme: the forest palette.
- Start screen: forest in every kind.
- Inline panels: the painted page is the theme's `editor.background`.
- Text: >= 4.5:1, composited over every painted layer (gradient stops count as possible
  backgrounds; the darkest and lightest are kept), with colour alpha and ancestor opacity.
- High contrast: an outer shadow needs a solid, opaque, >= 1px border on every side.
- Colours are normalised through a canvas (Chromium serialises `color-mix()` as
  `color(srgb ...)`). No glyph is sampled, so fonts do not change the result.

Not measured (counted in the output): disabled controls, symbol-only text, 1px screen-reader
text, raster background images, frame contents.

## Negative controls

A fixed dark page in a panel, a label at opacity .5, a high-contrast shadow without a border, the
chat text role pinned to forest in Light+, the start screen bound to the host, a dark elevation in
HC Dark, two kinds with one token set. Each must fail, or the test fails.

## Result (2026-11-12, Ubuntu worker, headless Chromium)

With the final test and the `origin/main` 4f1602fb2 sources the smoke fails with 28 findings:
the preview shell paints `#1B1B2A` in every kind (13 pages), its review notice is 4.37:1 in
Light+ (3), and the slide studio's secondary text is 4.4:1 in Light+ (12). Painting the editor
surface also exposed the placeholder at 3.18:1 in Light+, fixed in the same slice. With the
changes: 117 pages, 1394 text elements, 108 screenshots, 7 negative controls, 0 failures, 25 s.
