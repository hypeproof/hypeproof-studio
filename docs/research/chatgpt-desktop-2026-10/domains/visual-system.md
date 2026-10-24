# ChatGPT desktop design system → HypeProof Studio / Chalk (CGP-DS)

Target: ChatGPT macOS desktop v26.1013.40934 (`openai-codex-electron`). Evidence comes from the
shipped renderer: 322 CSS files in `webview/assets/` (2.75 MB) and `webview/index.html`.
Analysis scripts are in `(local scratch) ` and intermediate dumps in `(local scratch) `.
Nothing from the bundle was executed.

Evidence labels: **observed** means the value or rule appears verbatim in the shipped CSS/JS.
**inferred** means it is my reading of how the app behaves. CSS shows that a style ships. It
does not show which surfaces a given user sees, because feature flags and window types
(`data-codex-window-type=electron|browser|extension|chrome-extension`) gate it.

Studio evidence: `studio@origin/main:extensions/hypeproof-chat/src` contains **no CSS**. The chat
webview styles (`webview-ui/src/styles.css` 1277 lines, `start.css`, `localReview.css`, per
`docs/design/studio-learning-experience.md` "현재 구현" table) are **not in the snapshot**.
Studio's current state is therefore cited from design and requirement docs plus
`chalk/src/ui/manage.html`, which is the only shipped stylesheet in the snapshot. A bounded
search is not proof of absence.

---

## 0. ChatGPT design language: quantified extraction

### 0.1 Token architecture (observed, `app-shared-dc7535e633d7.css`)
- **2,769 distinct custom properties.** They sit in three tiers:
  1. Primitives: `--gray-0…1000` (25 steps), and the 7 hues `--{green,red,pink,orange,yellow,purple,blue}-25…1000`,
     each with an alpha series `-a25…a300` built from `color-mix(in oklab, hue-400 N%, transparent)`.
     The alpha neutrals are `--alpha-0…70` over `--alpha-base` (#0d0d0d light / #fff dark).
  2. Semantic: `--color-{text|background|border}-{primary|secondary|info|warning|caution|danger|success|discovery}-{soft|soft-alpha|surface|solid|outline|ghost}-{hover|active}`,
     plus `--color-ring-*`, `--color-border{-subtle,-strong}`, `--color-text{-secondary,-tertiary,-disabled,-inverse}`.
  3. App and host bridge: `--app-color-*` and `--color-token-*`. The `--color-token-*` layer is
     re-pointed at **305 distinct `--vscode-*` variables** under `:root[data-codex-window-type=extension]`.
     Examples: `--font-ui-family: var(--vscode-font-family)`, `--color-token-focus-border: var(--vscode-focusBorder)`,
     `--color-token-editor-background: var(--vscode-editor-background)`. The same component code
     therefore renders inside a VS Code host theme.
- **Light/dark in one declaration:** `var(--lightningcss-light, X) var(--lightningcss-dark, Y)` under
  `[data-theme=light|dark]` (367 dark selectors and 25 light), with a `prefers-color-scheme` fallback, plus
  `@container style(--theme-variant:dark)` (243 rules).
- **Tailwind v4 layer order** declared in index.html: `@layer theme, base, components, utilities`.

### 0.2 Color (observed values)
| Role | Light | Dark | Contrast (computed) |
|---|---|---|---|
| Body text `--color-text` | gray-750 #282828 | #dcdcdc | 14.7:1 on #fff; 14.2:1 on #0d0d0d |
| Secondary text | gray-500 #5d5d5d | #afafaf | 6.6:1 / 8.9:1 |
| Tertiary text | gray-400 #8f8f8f | #8f8f8f | **3.2:1 on #fff (fails 4.5:1)** / 6.0:1 |
| App foreground `--app-color-text-foreground` | #1a1c1f | gray-fixed-150 | 17.1:1 |
| Surface / under-surface | #fff / #f9f9f9 | #181818 / #000 | none |
| Border default | foreground 8% (color-mix) | same | about 1.2:1 (decorative only) |
| Focus ring `--color-ring` | blue-500 #0169cc | blue-400 #0285ff | 5.4:1 / 4.9:1 |
| Danger text | red-700 #911e1b | red-500 | 8.7:1 |
| Status intents | info=blue, warning=orange, caution=yellow, danger=red, success=green, discovery=purple | | |
| User message bubble bg | alpha-05 | alpha-08 | none |
| Modal backdrop | #0000004d | #00000080 | none |

### 0.3 Typography (observed)
- Families: `--font-sans-default: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. The
  proprietary **"OpenAI Sans"** ships as woff2 in weights 400/500/600 (`OpenAISans-{Regular,Medium,Semibold}-*.woff2`),
  gated by the `useOpenAISans` setting. `"OpenAI Serif"` also appears. Mono stack: `ui-monospace, "SFMono-Regular", "SF Mono", menlo, consolas, "Liberation Mono", monospace`.
  Separate tokens: `--font-ui-family`, `--font-content` (`--codex-content-font-family`), `--font-code-family`.
- UI scale (Tailwind overrides): `--text-xs 11px`, `sm 12px`, `base 14px`, `lg 16px`, `xl 28px`, `2xl 36px`, `3xl 48px`.
  App-specific: `--text-control-label 13px/18px w510`, `--text-heading-{sm 18, md 20, lg 24, app 28}`, `--text-card-title 22/28 w510`.
- Design-system scale (`--font-text-*`): 3xs 8/12, 2xs 10/14, xs 12/18, sm 14/20, md 16/24, lg 18/29. Headings: xs 16/24 through 5xl 72/72, weight 600.
  Tracking is tight on headings (-0.025em). Labels use -0.08 to -0.26px.
- Most frequent declared `font-size`: 14px (55), 12px (45), then 13px, 15px, 16px. Line-height: 20px (50).
- Settings schema (observed in `app-shared-52443cbe9ac4.js`): `sansFontSize` default 14, range **11–16**; `codeFontSize` default 12,
  range **8–24**; separate "Content font size" for pages.
- Text wrapping: `overflow-wrap:anywhere` (58), `text-wrap:pretty` (13), `text-wrap:balance` (4). **`word-break:keep-all`: 0 occurrences.**
  No `:lang(ko)` and no `line-break` rules.

### 0.4 Spacing, sizing, radius, elevation (observed)
- Base unit `--spacing: .25rem` (4px). Control heights `--control-size-4xs…3xl` = 20, 22, 24, 26, 28, 32, 36, 40, 44, 48px.
  Gutters run 6–16px. Icon sizes in controls are 14–24px. `--icon-leading-size: 16px`.
- Layout: toolbar 46/36/40px, titlebar 44px, nav row 36px, settings row 64px.
  Sidebar `clamp(240px, pref 275px, min(520px, 100vw − 320px))`. Thread column `--thread-content-max-width: 40rem` (640px),
  gutter `clamp(12px, 3cqi, 24px)`, markdown wide blocks capped at 64rem / 80vh.
- Radius base: 2, 4, 6, 8, 10, 12, 16, 20, 24px, multiplied by `--corner-radius-scale` (1; Codex surfaces 1.25), with
  `corner-shape: superellipse(1.5)` where supported. Composer 24px (`radius-4xl`), message bubble **22px**, menu 20px,
  dialog/popover 12px, tooltip 16px, pills 9999px.
- Elevation: 4 geometries (`0 1px 2px -1px` … `0 8px 16px -4px`). Shadow alpha is **light .08/.08/.10/.12** and **dark .20/.20/.36/.30**.
  The hairline is 1px, dropping to **0.5px at ≥150dpi**. Composer elevation: `0 0 0 1px #0000000a, 0 2px 8px #0000000a, 0 4px 80px 8px #00000006`.
  Backdrop blur 1–16px on menus and dialogs.

### 0.5 Breakpoints and responsiveness (observed)
- Viewport: `--breakpoint-xs 20rem, sm 40rem, md 48rem, lg 64rem, xl 80rem, 2xl 96rem`.
- **701 `@container` rules**, with the main threshold at 28rem (85). Named containers include `thread-content`, `settings-row` and `browser-toolbar`.
  Components respond to their pane width rather than the window width.
- Input modality: `(hover:hover)` 140, `(hover:hover) and (pointer:fine)` 42, `(pointer:coarse)` 8 (raises icon actions to ≥40px), `(hover:none)` 7.

### 0.6 Motion (observed)
- Durations: `--transition-duration-basic .15s`, `moderate .2s`, `relaxed .3s`. Tailwind default is .15s. Modal enter **.6s** and exit **.3s**.
  Streaming text uses `--animation-duration-streaming-text .7s`, the pulsing dot 1.25s, and the startup shimmer 2.2s.
- Easings: `--cubic-enter (.19,1,.22,1)`, `--cubic-exit (.8,0,.4,1)`, `--cubic-move (.65,0,.35,1)`, `--ease-enter-snappy (.23,1,.32,1)`,
  and `--ease-spring-snappy linear(…)` (a 20-point spring).
- 232 distinct keyframes.
- **Reduced motion:** 106 `(prefers-reduced-motion:reduce)` and 90 `(…:no-preference)` blocks across 53 files.
  There is an app-level **tri-state setting** "Reduce motion: Off / On / System" (`settings.general.appearance.reducedMotion.*`).
  It is implemented as `[data-reduced-motion=true|false]` on root (147 selectors). The OS media query applies only when the
  attribute is absent: `:where(:root:not([data-reduced-motion]) …)`. The startup loader in index.html also disables its fade and shimmer under reduced motion.

### 0.7 Accessibility primitives (observed)
- `:focus-visible` appears 587 times and `:focus-within` 228 times. The ring is `outline: 2px solid var(--color-ring)` with an offset of 2px (65 rules).
  Inset rings use offsets of −1 or −2px.
- `(forced-colors:active)` appears 68 times, using `canvas`/`canvastext` borders, including on the typing bubble. `(prefers-contrast:more)` appears once and `(prefers-reduced-transparency:reduce)` 3 times.
  A "Contrast" slider exists per theme (`settings.general.appearance.chromeTheme.contrast`).
- JS: `aria-live` 31, `role:"status"` 64, `role:"alert"` 27, `aria-busy` 34 (main bundles).
- Non-color cue setting: "Diff markers: Color / +/-" (`settings.general.appearance.diffMarkerStyle.*`).
- "Use pointer cursors" defaults **off**, giving native-app arrow cursors (`usePointerCursors` default `!1`).
- `scrollbar-gutter: stable` (8), `font-variant-numeric: tabular-nums` (22).

### 0.8 Icons (observed)
- **Lucide-style SVGs** on a 24×24 grid with `stroke-width="2"`, round caps and currentColor (2,248 of 2,322 SVGs use viewBox 0 0 24 24; 3,274 `lucide-*` JS chunks).
  There is also a separate product icon set sized by key (`presentation[16]`), plus OpenAI logo assets (`openai_logo_bold_bounding_box-*.svg` and the "blossom" path inlined in index.html).
- Lucide is ISC-licensed. The OpenAI marks and custom product glyphs are proprietary.

### 0.9 Components (observed tokens)
| Component | Key values |
|---|---|
| Composer | radius 24px; min-height 44px (`--min-height-composer`); line-height 20px; gutter 12px (compact 8); bg `surface-elevated-secondary`; placeholder opacity .5; buttons 28px (sm 20px), gap 4px; expanded max = `min(100svh − toolbar − 128px, 100cqh − 64px, 48rem)`; attachments inset 8px |
| Message | user bubble radius 22px, alpha 5%/8% bg; assistant prose unboxed; `.message-list` gap 4px, top padding 20px; typing bubble 56px wide |
| Sidebar | width clamp above; row 36px; row actions `opacity 0` until hover/focus; top and bottom scroll fade masks (16px/40px); optional translucency |
| Menu | radius 20px; gutter 6px; item radius 14px (radius − gutter); font 13px; item padding 4×8; backdrop blur 16px; `shadow-xl` + 0.5px ring |
| Dialog | width 250–450px; radius 12px; padding 20px; backdrop dim plus 1px blur; bottom-sheet variant (`--modal-out-y 100%`) |
| Tooltip | radius 16px; padding 4×8; 14px, line-height 18px, tracking −0.15px; inverted solid background in light mode; shortcut chip |
| Toast | content-width, `max-width:100%`, centered offset vars; live-region roles in JS |
| Loading | shimmer sweeps, pulse, skeleton keyframes; all wrapped in reduced-motion guards |

### 0.10 RTL and i18n (observed)
- Logical properties dominate: `padding-inline` 628, `margin-inline` 375, `inset-inline` 264, `padding-block` 247, against about 160 physical left/right declarations.
  There are 92 `[dir=rtl]` variants, and icon mirroring via `:lang()` over 19 RTL languages. Radix primitives flip menus and arrow keys by `dir`.
- About 70 locale bundles ship, including `ko-KR-*.js` (3.1 MB of Korean strings).
- IME: composer, title and menu handlers return early when `isComposing || keyCode===229` (27 and 14 occurrences), covering **Enter and Escape**.

---

## 1. Token and component comparison: ChatGPT vs Studio/Chalk

| Dimension | ChatGPT desktop (observed) | Studio / Chalk today (cited) | Gap |
|---|---|---|---|
| Token file | 3-tier, 2,769 props, one source | Planned `webview-ui/src/tokens.css` with 10 `--hp-*` tokens (studio-learning-experience.md "디자인 시스템"). Today `start.css` has 4 `--studio-*`, `styles.css` uses `--vscode-*` with hard-coded fallbacks, "공용 토큰 파일은 없다". Chalk `manage.html` hard-codes hex and also uses `--ink-*` vars | No single token source |
| Palettes | One semantic set, light and dark | **Three differing panel/canvas values**: SX learning `#151D19`/`#202C24`; CC-R1 `#151D19`/`#18231C`; CP-R1 personal chat `#202226`/`#17191d` with focus `#799ed7` (task-workspace.md) | Conflicting truths |
| Host-theme bridge | `--color-token-*` → 305 `--vscode-*` vars | Rule in chalk-instructor-mode.md: use only `--vscode-*` and `styles.css` tokens, with named vars pointing at `--vscode-*`. CP-R1 says host light/HC values override the fallbacks | Pattern exists; mapping is not specified |
| Body text | 14px UI; markdown follows the chat font size | 16px/1.625 body; controls 13–14px; metadata 11px (CC-R1). DES-02: body ≥16, labels ≥14, titles 22–28 | 11px metadata conflicts with DES-02 |
| Line length | 640px column | 740px (CP-R1) | about 46 Hangul syllables at 16px |
| Spacing unit | 4px | Not specified. Chalk uses 4/6/8/10/12/14/16/18/20px ad hoc | No scale |
| Radius | 2–24px scale × multiplier | Chalk 6/7/8/999px; composer "rounded" (unspecified) | No scale |
| Elevation | 4 levels, alpha by theme | Not specified | none |
| Focus | 2px ring, 2px offset, 4.9–5.4:1 | Chalk: `outline 2px solid #D5F279; offset 2px` (11.6:1 on panel); DES-11 requires boundary and focus 3:1 | ALREADY in Chalk |
| Targets | 20–48px controls; coarse pointer ≥40px | 44px targets (DES-06, CC-R1, CG-05) | Studio stricter |
| Motion durations | 150/200/300ms; modal 600/300 | 180ms entry, 160ms copy, 140ms press, pending dots ≤3.8s (CP-R1) | Comparable |
| Reduced motion | Tri-state app setting overrides OS | OS media query only (CP-05, task-workspace.md) | No app override |
| Forced colors | 68 rules | "host high-contrast values override" (CP-R1); no rule inventory | Unverified |
| Status semantics | 6 intents × variants; diff +/- option | SX-50: icon + text; lime/amber/blocked red; `● 실제 / ◌ 가상 / ◐ 자기 보고 / ? 미확인` | Studio stronger on non-color cues |
| Icons | Lucide 24/2px stroke plus proprietary set | Unicode/emoji glyphs (☐☑⚠●◌◐); 18px assistant art; 16px action glyphs (CC-R1) | No icon system |
| Composer | 24px radius, 44px min, cap by viewport | One rounded surface, grows to 192px, keeps a 96px transcript reserve (CP-R1) | ALREADY |
| Message bubble | user 22px radius alpha bubble; assistant unboxed | "user compact rounded surface; assistant quiet identity mark" (CP-R1) | ALREADY (values unspecified) |
| Korean line breaking | none (no keep-all) | none found (searched docs for `keep-all`: 0) | Both missing |
| IME | Enter **and Escape** guarded | Enter guarded (TUX-CHAT-03, CP-06, CG-04) | Escape not specified |
| Secondary CTA boundary | outline border alpha 16–25% | `.hp-cta-secondary` = transparent + `--hp-line #35483A` → **1.75:1 on #151D19** | **Fails DES-11 3:1** |

---

## 2. Feature inventory

| ID | Feature | What it does (observed/inferred) | Evidence | Studio/Chalk today | Verdict | Surface |
|---|---|---|---|---|---|---|
| CGP-DS-01 | Three-tier token system | Primitives → semantic role×variant×state → app (observed) | `app-shared-dc7535e633d7.css` `:where(:root),:where([data-theme])` blocks (413 + 264 + 236 props) | Planned `tokens.css` with 10 tokens (studio-learning-experience.md); none shipped in snapshot | ADAPT | Both |
| CGP-DS-02 | Host-theme bridge to VS Code | Semantic tokens re-pointed at 305 `--vscode-*` vars in extension mode (observed) | `:root[data-codex-window-type=extension]{--font-ui-family:var(--vscode-font-family);…}` | Rule in chalk-instructor-mode.md L126-127; CP-R1 fallback note | ADOPT | Studio |
| CGP-DS-03 | Light/dark single-declaration tokens | `light-dark` pairs per token, `[data-theme]` plus OS fallback (observed) | `--lightningcss-light/dark`; index.html `prefers-color-scheme` | Dark HP theme (#725); Paper surface for growth; CP-R1 light/dark at 320px (CG-05) | ADAPT | Both |
| CGP-DS-04 | Alpha-derived neutrals | Borders and hovers = foreground 5–25% via `color-mix(oklab)` (observed) | `--color-token-border: color-mix(… 8%)`, `--alpha-*` | Fixed hex (`#35483A`, `#3A4A3E`) | ADAPT | Both |
| CGP-DS-05 | Six status intents | info/warning/caution/danger/success/discovery × soft/surface/solid/outline/ghost (observed) | `--color-text-danger…`, `--color-background-caution-soft…` | lime/amber/blocked-red plus `source_state` labels (SX-21, SX-50) | ADAPT | Both |
| CGP-DS-06 | Accent color picker | 8 accents + custom, per light/dark (observed) | `settings.appearance.chatGptAccent.*` | none | REJECT: lime is reserved for the single primary CTA (SX-04); choice adds noise for children | Studio |
| CGP-DS-07 | Proprietary brand typeface | OpenAI Sans woff2 400/500/600, toggled by `useOpenAISans` (observed) | `@font-face{font-family:OpenAI Sans;src:url(./OpenAISans-Regular-*.woff2)}` | system sans (CC-R1) | REJECT: proprietary, not licensed for reuse | Both |
| CGP-DS-08 | Separate UI / content / code font tokens | `--font-ui-family`, `--font-content`, `--font-code-family` (observed) | `:root,:host` block; settings "Content font", "Code font" | System sans plus editor monospace (CP-R1); not tokenized | ADOPT | Both |
| CGP-DS-09 | Semantic type scale with paired metrics | Size, line-height, weight and tracking per step (observed) | `--font-text-sm-size .875rem` / `-line-height 1.25rem` … | 16/1.625, 13–14, 11 (CC-R1); DES-02 minimums | ADAPT (larger floor) | Both |
| CGP-DS-10 | User text-size settings | UI 11–16px (def 14), code 8–24 (def 12), content size (observed) | `eZ={sans:{min:11,max:16},code:{min:8,max:24}}`; `settings.general.appearance.sansFontSize.row` | VS Code zoom; 200% zoom tests (AE-T03, CU-16) | ADAPT | Studio |
| CGP-DS-11 | 4px spacing unit and control-size ladder | `--spacing .25rem`; control 20–48px (observed) | `--control-size-*`, `--control-gutter-*` | None in Studio docs; Chalk ad hoc | ADOPT | Both |
| CGP-DS-12 | Radius scale with global multiplier | 2–24px × `--corner-radius-scale`; superellipse (observed) | `--radius-*-base`, `--codex-corner-shape: superellipse(1.5)` | Chalk 6/7/8/999 | ADAPT | Both |
| CGP-DS-13 | Theme-aware elevation | 4 levels; dark alpha ×2–3; 0.5px hairline on HiDPI (observed) | `--shadow-alpha-*`, `(resolution>=150dpi)` | none | ADAPT | Both |
| CGP-DS-14 | Container-query layout | 701 `@container` rules; pane-width thresholds 28/36/43rem (observed) | `@container thread-content not (width>=43rem)` | 320/390/1280 viewport tests; chat lives in a resizable side panel | ADOPT | Studio |
| CGP-DS-15 | Motion tokens | 150/200/300ms; enter/exit/move curves; spring (observed) | `--cubic-enter (.19,1,.22,1)` etc. | CP-R1 140/160/180ms and 3.8s cap, not tokenized | ADAPT | Both |
| CGP-DS-16 | Reduced-motion tri-state | App Off/On/System overrides OS (observed) | `settings.general.appearance.reducedMotion.*`; `[data-reduced-motion]` 147 selectors | OS media only (CP-05) | ADAPT (bind to VS Code setting) | Studio |
| CGP-DS-17 | Forced-colors / high contrast | `canvas`/`canvastext` fallbacks (observed) | 68 `(forced-colors:active)` blocks | "HC values override" (CP-R1); no tests | ADOPT | Both |
| CGP-DS-18 | Focus-visible ring | 2px solid ring, 2px offset; inset −2px in tight rows (observed) | `outline:2px solid var(--color-ring)` ×24; offset 2px ×65 | Chalk lime ring; DES-06/11 | ALREADY (Chalk), ADOPT (Studio token) | Both |
| CGP-DS-19 | Stroke icon system | 24-grid, 2px stroke, currentColor; 16px leading size (observed) | 2,248 SVGs with `viewBox="0 0 24 24"`; `lucide-*` chunks | Unicode/emoji state glyphs; 16px actions (CC-R1) | ADAPT (codicons or Lucide, not OpenAI icons) | Both |
| CGP-DS-20 | Pointer-cursor preference | Default arrow cursor; opt-in pointer (observed) | `usePointerCursors` default false | VS Code default | REJECT: learners need the pointer affordance; no setting | Studio |
| CGP-DS-21 | Composer surface | One rounded elevated surface; min 44px; capped growth (observed) | `--composer-radius: var(--radius-4xl)`, `--min-height-composer` | CP-R1 one rounded surface, ≤192px, 96px reserve | ALREADY (+ADAPT placeholder contrast) | Studio |
| CGP-DS-22 | Message presentation | User bubble 22px radius alpha bg; assistant unboxed prose; 640px column (observed) | `--message-bubble-radius:22px`, `--thread-content-max-width:40rem` | CP-R1 740px column; user rounded surface | ADAPT (column width) | Studio |
| CGP-DS-23 | Sidebar list rows | 36px rows; hover-revealed actions; fade masks; translucency (observed) | `--sidebar-row-action-opacity:0`, `--sidebar-scroll-mask-image` | Chalk `.side` 14px pad; Studio uses VS Code sidebar | ADAPT (no hover-only) | Chalk |
| CGP-DS-24 | Menu styling | radius 20, gutter 6, 13px, blur 16, nested radius (observed) | `--menu-radius`, `--menu-item-radius: calc(menu-radius − gutter)` | Tools menu above composer (CG-IMPL-R1); no tokens | ADAPT | Both |
| CGP-DS-25 | Dialog and bottom sheet | 250–450px, radius 12, padding 20, enter 600ms / exit 300ms (observed) | `--dialog-max-width:450px`, `--modal-enter-duration:.6s` | Studio prefers inline (SX-52); native dialog for settings (CC-R1); narrow-drawer focus trap | ADAPT | Both |
| CGP-DS-26 | Tooltip styling | radius 16, 14/18px, inverted bg, shortcut chip (observed) | `--tooltip-*` | none specified | ADAPT (never the only label) | Both |
| CGP-DS-27 | Toasts and live regions | content-width toast; `role=status/alert`, `aria-live` (observed) | `._toast_1dz2c_1`; JS role counts | "quiet real-state feedback" (CG-05); copy confirmation (CP-R1) | ADAPT | Both |
| CGP-DS-28 | Loading and streaming motion | shimmer, pulse, 0.7s streaming text fade (observed) | `--animation-duration-streaming-text:.7s`, `--animate-token-pulsing-dot` | No token replay; pending dots ≤3.8s (CP-R1); REQ-M35 shimmer line | ALREADY | Studio |
| CGP-DS-29 | Logical properties and RTL | inline/block properties; `[dir=rtl]`; RTL `:lang()` icon flip (observed) | counts in §0.10 | Not specified; KO/EN only | ADOPT (logical props) / DEFER (RTL) | Both |
| CGP-DS-30 | IME composition guards | Enter **and Escape** ignored while composing (observed) | `(e.key==="Enter"||e.key==="Escape")&&(isComposing||keyCode===229)` | Enter only (TUX-CHAT-03, CP-06) | ADAPT (extend to Escape/shortcuts) | Both |
| CGP-DS-31 | Line-breaking rules | `overflow-wrap:anywhere`, `text-wrap:pretty/balance`; no keep-all (observed) | stats §0.3 | Not specified (no `keep-all` in docs) | ADAPT (add Korean keep-all) | Both |
| CGP-DS-32 | Density modes | compact/form/comfortable via `data-density` (observed) | `[data-density=compact]` ×15 | none | REJECT for Studio (one comfortable density); DEFER for Chalk tables | Studio/Chalk |
| CGP-DS-33 | Theme customization suite | import/export theme string, separate light/dark, contrast slider, translucent sidebar, font smoothing (observed) | `settings.general.appearance.chromeTheme.*` | VS Code themes | REJECT: cosmetic choice load; VS Code already offers themes | Studio |
| CGP-DS-34 | Non-color diff markers | Color vs `+/-` symbols setting (observed) | `settings.general.appearance.diffMarkerStyle.*` | SX-50 icon + text; SX-16 before/after | ADOPT (symbols always on) | Studio |
| CGP-DS-35 | Tabular numerals | `tabular-nums` on counters and tables (observed) | 22 rules | Chalk seat table, usage counts | ADOPT | Chalk |
| CGP-DS-36 | Stable scrollbar gutter | `scrollbar-gutter: stable` keeps width (observed) | 8 rules | UX13 2 CSSpx anchor requirement | ADOPT | Studio |
| CGP-DS-37 | Hover/pointer media gating | Hover effects only under `(hover:hover)`; coarse pointer ≥40px (observed) | 140 / 8 rules | "no hover-only actions" (CP-R1), 44px | ALREADY | Both |
| CGP-DS-38 | Branded startup loader | 56px mark, 180ms fade, 2.2s shimmer, reduced-motion off (observed) | index.html `.startup-loader` | HP watermark SVG (#725) | ADAPT (HP mark only) | Studio |
| CGP-DS-39 | Window chrome tokens | drag regions, 44px titlebar, 46px toolbar (observed) | `-webkit-app-region`, `--height-titlebar` | VS Code owns chrome; HP shell defaults (#725) | ALREADY | Studio |
| CGP-DS-40 | Math typesetting fonts | KaTeX fonts bundled (observed) | 49 `@font-face`, KaTeX_* | none | DEFER: no math curriculum yet | Studio |
| CGP-DS-41 | Emoji font stack | Apple / Segoe / Noto Color Emoji (observed) | `._emoji_d1c6r_1{font-family:Apple Color Emoji,…}` | Emoji in timeline lines (REQ-M35 `🖼️`) | ADOPT | Both |
| CGP-DS-42 | Placeholder and tertiary text contrast | Placeholder opacity .5; tertiary #8f8f8f = 3.2:1 on white (observed) | `--opacity-composer-placeholder:.5`, `--color-text-tertiary` | DES-11 4.5:1 | ADAPT (do not copy; enforce 4.5:1) | Both |

Counts by primary verdict (42 rows): **ADOPT 11** (02, 08, 11, 14, 17, 18, 29, 34, 35, 36, 41), **ADAPT 21** (01, 03, 04, 05, 09, 10, 12, 13, 15, 16, 19, 22, 23, 24, 25, 26, 27, 30, 31, 38, 42),
**ALREADY 4** (21, 28, 37, 39), **DEFER 1** (40), **REJECT 5** (06, 07, 20, 32, 33).
Split verdicts: 18 is already done in Chalk, 21 needs placeholder contrast work, 29 defers RTL, and 32 defers dense rows for Chalk.

---

## 3. Requirements (ADOPT/ADAPT rows)

Product Intent principles (docs/PRODUCT-INTENT.md): 1 Useful work first, 2 Human judgment stays visible,
3 Learning is embedded, 4 Minimum necessary intervention, 5 Evidence over claims, 6 Adapt not script,
7 Capability models are hypotheses. SX IDs come from docs/requirements/studio-learning-experience.md.

| REQ ID | Requirement (testable, one behavior) | Acceptance criteria | Priority | Traces to |
|---|---|---|---|---|
| REQ-CGP-DS-01 | Studio chat webview and Chalk resolve every color, font, size, radius, shadow and duration from one token source with primitive → semantic → component tiers | A lint over `webview-ui/src/**/*.css` and `chalk/src/ui/*.html` finds 0 hex/rgb literals outside the token file(s). Each semantic token has a light and dark value | P0 | 1, SX-49 |
| REQ-CGP-DS-01a | The three conflicting palettes (SX `#202C24`, CC-R1 `#18231C`, CP-R1 `#17191d`/`#202226`) are reconciled into one documented set | One design decision record names the canonical panel/canvas/focus values. task-workspace.md and studio-learning-experience.md cite it. 0 divergent literals remain | P0 | SX-49 |
| REQ-CGP-DS-02 | Every semantic token in the Studio webview has a `--vscode-*` source and an HP fallback | Mapping table checked in. Switching VS Code theme between Dark+, Light+, HC Dark and HC Light changes the chat surface colors with no reload | P0 | 1, 4 |
| REQ-CGP-DS-03 | Webview follows the host theme kind (light/dark/high-contrast) | `body.vscode-light/dark/high-contrast(-light)` each map to a token set. Screenshots at 320/390/1280 in all four kinds | P1 | 1 |
| REQ-CGP-DS-04 | Hover and pressed fills derive from the foreground via `color-mix`; boundaries that identify a control never do | Hover/pressed tokens use `color-mix`. Every input or secondary-button boundary measures ≥3:1 against its background | P0 | DES-11 |
| REQ-CGP-DS-05 | Status is expressed as named intents (info/caution/danger/success plus `source_state`), each with text, icon and color | Every status chip renders an icon and a Korean label. A grayscale screenshot still distinguishes all intents | P0 | 5, SX-21, SX-50 |
| REQ-CGP-DS-08 | UI, content (chat prose), and code fonts are separate tokens | Changing `editor.fontFamily` changes only code blocks; changing the content token changes only prose | P1 | 1 |
| REQ-CGP-DS-09 | Learner text uses a semantic scale whose smallest step is 14px | Computed styles: no visible text <14px on learner surfaces. Body 16px. Metadata rises from 11px (CC-R1) to 14px | P0 | DES-02 |
| REQ-CGP-DS-10 | Learner can choose a chat text size (기본 / 크게 / 아주 크게) | Setting persists across restart. 16/18/20px body. No horizontal overflow at 320px with the largest size | P1 | 1, 4 |
| REQ-CGP-DS-11 | Spacing uses a 4px unit; interactive control heights come from a ladder whose learner minimum is 44px | Token file defines `--hp-space` = 4px and control sizes. Audit finds no hit target <44×44 on learner surfaces | P0 | DES-06 |
| REQ-CGP-DS-12 | Radii come from one scale; nested radii are computed (outer − inset) | Composer, bubble, menu, dialog and chip radii reference scale tokens. Nested items use `calc()` | P2 | none |
| REQ-CGP-DS-13 | Elevation uses ≤3 named levels with theme-specific alpha | Dark theme shadows are visibly present (alpha ≥ 0.2). HC themes replace shadows with 1px borders | P2 | none |
| REQ-CGP-DS-14 | Chat layout responds to pane width via container queries | Resizing the side panel 280→720px with a fixed window switches compact/regular layout at the documented thresholds | P1 | 1 |
| REQ-CGP-DS-15 | Motion durations and easings are tokens | CP-R1 durations (140/160/180ms, ≤3.8s) are expressed as tokens. 0 raw durations in component CSS | P1 | 4 |
| REQ-CGP-DS-16 | Reduced motion honors an explicit app/VS Code preference, falling back to the OS | With OS reduce=off and the Studio/VS Code reduce-motion setting=on, all nonessential animation stops. With the setting on "system", the OS value applies | P0 | 4, CP-05 |
| REQ-CGP-DS-17 | High-contrast/forced-colors renders every control and state | Under VS Code HC themes and macOS Increase Contrast, every button, input, bubble and status chip has a visible border or system color | P1 | DES-11 |
| REQ-CGP-DS-18 | Focus ring is one token (2px solid, 2px offset) that is visible in every theme | Tab through the chat: every focusable element shows a ring with ≥3:1 against adjacent colors | P0 | DES-06, DES-11 |
| REQ-CGP-DS-19 | Icons come from one licensed stroke set, sized 16/20/24, using currentColor | Inventory of icons with license (codicons CC-BY-4.0, or Lucide ISC with notice). 0 OpenAI-derived glyphs | P1 | SX-50 |
| REQ-CGP-DS-21 | Composer placeholder text meets 4.5:1 | Placeholder measured ≥4.5:1 in every theme (do not use opacity .5) | P0 | DES-11 |
| REQ-CGP-DS-22 | Prose column is capped near 40 Hangul syllables per line | max-width ≤ 40em of the content font (about 640px at 16px). The user bubble max width is ≤ 85% of the column | P1 | DES-02 |
| REQ-CGP-DS-23 | Chalk sidebar/list row actions are visible without hover | Row actions are visible or reachable by keyboard and touch. 0 actions with `opacity:0` that appear only on `:hover` | P0 | DES-06 |
| REQ-CGP-DS-24 | Menus share one style token set, with item height ≥44px on learner surfaces | Tools menu items ≥44px tall, ≥14px text. Keyboard arrows, Home/End and Escape work | P1 | DES-06 |
| REQ-CGP-DS-25 | Dialogs are reserved for destructive or settings flows; any dialog traps focus and restores it to its opener | Escape closes. Focus returns to the opener. Inline progression for everything else (SX-52) | P0 | SX-52 |
| REQ-CGP-DS-26 | Tooltips never carry the only label of a control | Every icon button has a visible label or an `aria-label` plus visible text in learner mode. Tooltip appears on focus as well as hover | P0 | DES-06 |
| REQ-CGP-DS-27 | Transient confirmations use a live region and persist ≥4s or until dismissed | Copy confirmation announced via `role=status`. Errors use `role=alert` and do not auto-dismiss | P1 | 5 |
| REQ-CGP-DS-29 | New CSS uses logical properties | Lint: 0 new `margin-left/right`, `padding-left/right`, `left/right` in component CSS | P2 | none |
| REQ-CGP-DS-30 | IME composition never triggers Enter-send, Escape-close or any single-key shortcut | During Korean composition, Enter, Escape, and Cmd+Enter do nothing beyond committing the syllable (synthetic `isComposing`/229 plus physical macOS 2-set test) | P0 | SX-19, TUX-CHAT-03 |
| REQ-CGP-DS-31 | Korean prose wraps at word (eojeol) boundaries; long tokens still wrap | `word-break: keep-all; overflow-wrap: anywhere` on prose, labels and buttons. Headings use `text-wrap: balance` | P0 | DES-03 |
| REQ-CGP-DS-34 | Before/after and diff views show symbols as well as color | Added/removed lines carry `+`/`−` (or 추가/삭제) markers by default | P1 | SX-16, SX-50 |
| REQ-CGP-DS-35 | Numeric columns and counters use tabular figures | Chalk seat table, usage and timers use `font-variant-numeric: tabular-nums` | P2 | none |
| REQ-CGP-DS-36 | Transcript scroller reserves a stable scrollbar gutter | Content width does not change by more than 0px when the scrollbar appears (supports UX13 2 CSSpx) | P1 | UX13 |
| REQ-CGP-DS-38 | Startup and empty states use only HP marks | No third-party brand mark in Studio assets. Startup animation ≤200ms fade with no loop under reduced motion | P2 | none |
| REQ-CGP-DS-41 | Emoji render with the OS color emoji stack | Emoji in timeline and status lines render as color glyphs on macOS and Windows | P2 | none |
| REQ-CGP-DS-42 | No text token below 4.5:1 is used for readable text | Contrast test over the token pairs. Tertiary and muted tokens are ≥4.5:1 on every surface they appear on | P0 | DES-11 |

---

## 4. Design requirements (measurable)

| DES ID | Visual/interaction requirement | Acceptance (measurable) |
|---|---|---|
| DES-CGP-DS-01 | Token file `tokens.css` is imported first; semantic names follow `--hp-{text|bg|border|ring}-{role}-{state}` | Snapshot of computed `:root` shows ≥ every role used in components. Light (Paper) and dark (forest) both defined |
| DES-CGP-DS-02 | Mapping, for example: `--hp-text: var(--vscode-foreground, #F2F4E8)`, `--hp-ring: var(--vscode-focusBorder, #D5F279)`, `--hp-bg: var(--vscode-sideBar-background, #151D19)`, `--hp-code-bg: var(--vscode-textCodeBlock-background, …)` | Under the HP theme the fallback-free values equal the HP palette. Under Light+ every text pair is ≥4.5:1 |
| DES-CGP-DS-04 | Hover = text color at 8%, pressed 12–16% (light) or 12–20% (dark) over the surface; control boundary token ≥3:1 | Secondary CTA border changes from `#35483A` (1.75:1) to a token ≥3:1 on `#151D19` (for example `#6E8270`, which needs verification) |
| DES-CGP-DS-05 | Status chip: 16px icon + 14px label, 4px radius, 8px inline padding, soft background | Grayscale capture distinguishes real/simulated/self-reported/unverified/blocked |
| DES-CGP-DS-09 | Learner scale: 14 / 16 / 18 / 22 / 28px; line-height 1.5 (labels), **1.65–1.75 (Hangul prose)**; tracking 0 for Hangul; weights 400/600 only | Computed styles: Hangul text has `letter-spacing` ≥0. Body line-height ≥1.6 |
| DES-CGP-DS-10 | Text size: 16 / 18 / 20px body; controls scale proportionally; 44px targets unchanged | 320px width at 20px body: 0 horizontal overflow, composer send button visible |
| DES-CGP-DS-11 | Spacing ladder 4, 8, 12, 16, 20, 24, 32px; control heights 32 (non-learner dense), 44 (learner default), 48 (primary CTA) | Hit-target audit report from automated DOM measure |
| DES-CGP-DS-12 | Radii 4 / 8 / 12 / 16 / 24 / full; composer 16–24px; user bubble 16–20px; dialog 12px | Values reference tokens. Inner radius = outer − padding |
| DES-CGP-DS-13 | Elevation: none (inline), 1 (cards: `0 1px 2px`), 2 (menus/popovers: `0 4px 8px -2px`, alpha .10 light / .30 dark) | HC: shadow none plus 1px `--vscode-contrastBorder` |
| DES-CGP-DS-14 | Container thresholds: compact <28rem (448px), regular ≥28rem, wide ≥43rem | Panel width sweep 280/360/448/600/720px captured |
| DES-CGP-DS-15 | `--hp-dur-press 140ms`, `--hp-dur-enter 180ms`, `--hp-dur-confirm 160ms`, `--hp-dur-move 240ms`; enter `cubic-bezier(.19,1,.22,1)`, exit `cubic-bezier(.4,0,1,1)`; no springs or bounces on learner surfaces | 0 animations >300ms except the bounded pending indicator (≤3.8s total). Owner decisions 2026-10-24 (CGP-DS-D-011, decisions.md): `--hp-dur-confirm` is a second name for `--hp-dur-content` (160ms); `--hp-dur-move` 240ms exists with no in-place movement transition using it yet; `--hp-ease-exit` is used by the dialog exit; looping pending indicators (runner, shimmer, breathe, dots) are the bounded-pending exception and stop under reduced motion |
| DES-CGP-DS-16 | Reduced-motion state is on `<html data-reduced-motion=true|false>` set by the host; CSS gates with `:not([data-reduced-motion])` plus the media query | Three-way test: system / on / off × OS reduce on/off = 6 captures |
| DES-CGP-DS-17 | Forced colors: buttons `border:1px solid ButtonText`, bubbles `border:1px solid CanvasText`, focus `outline-color: Highlight` | Windows HC and VS Code HC captures show every control boundary |
| DES-CGP-DS-18 | Focus: `outline: 2px solid var(--hp-ring); outline-offset: 2px`; inset −2px inside scroll containers | Ring ≥3:1 against both the control and the surrounding surface in 4 theme kinds |
| DES-CGP-DS-19 | Icon sizes 16 (inline), 20 (toolbar), 24 (empty states); 1.5–2px stroke; `currentColor`; status glyphs move from Unicode to icons with the same labels | Icon inventory table with source and license. Visual diff before and after |
| DES-CGP-DS-21 | Composer: radius 20px, min-height 48px, padding 12px, send button 44×44 inside; placeholder uses `--hp-text-muted` (≥4.5:1), not opacity | Measured placeholder contrast is listed per theme |
| DES-CGP-DS-22 | Prose max-width 40em; user bubble radius 18px, background = text at 6–8%, max-width 85%; assistant unboxed with an 18px identity mark | 390px and 1280px captures with a 300-character Korean paragraph |
| DES-CGP-DS-23 | Chalk list rows ≥44px; actions are persistent icon+label buttons; scroll fade mask 16px top, 32px bottom | Keyboard-only run reaches every row action |
| DES-CGP-DS-24 | Menu: radius 12px, 4px gutter, items 44px (learner) / 32px (Chalk dense), 14px text, separator 1px border token | Arrow/Home/End/Escape/type-ahead tested. Escape during IME composition does not close |
| DES-CGP-DS-25 | Dialog 320–480px, radius 12px, padding 20–24px, backdrop dim 40% dark / 30% light, enter 180ms, exit 120ms; ≤390px becomes a bottom sheet | Focus trap and return tested. No dialog for non-destructive learning steps |
| DES-CGP-DS-26 | Tooltip: 14px, radius 8px, padding 4×8, delay 500ms hover / immediate on focus; shortcut shown as text | Screen reader announces the button label without the tooltip |
| DES-CGP-DS-27 | Toast: bottom of the chat pane, content-width ≤ 360px, 14px, icon + text; success auto-hides at 4s; error persists | `aria-live` capture; 0 toasts for routine progress (timeline lines instead) |
| DES-CGP-DS-29 | Use `padding-inline`, `margin-inline`, `inset-inline`, `text-align:start` | Stylelint rule `liberty/use-logical-spec` (or equivalent) on new files |
| DES-CGP-DS-30 | IME guard covers Enter, Escape, Tab, Arrow-up history and Cmd/Ctrl+Enter | Physical test on macOS 2-set Korean and Windows MS IME: compose "안녕" then press each key |
| DES-CGP-DS-31 | `:lang(ko)` prose: `word-break:keep-all; overflow-wrap:anywhere; line-break:strict`; headings `text-wrap:balance`; paragraphs `text-wrap:pretty` | A 40-syllable heading wraps between eojeol at 320px. A 120-char URL wraps without overflow |
| DES-CGP-DS-34 | Diff: `+`/`−` gutter glyph plus green/red tint at ≤15% alpha; removed text also struck through | Grayscale capture distinguishes add and remove |
| DES-CGP-DS-36 | `scrollbar-gutter: stable` on the transcript; thin scrollbar uses `--vscode-scrollbarSlider-*` | Scroll appearance causes 0px reflow (measured paragraph x) |
| DES-CGP-DS-42 | Muted tokens: forest `#ACB9A5` (8.4:1 on #151D19 / 7.1:1 on #202C24, OK); CP-R1 `#a4aab3` (6.8:1 on #202226, OK); never ChatGPT-style 3.2:1 tertiary | Automated contrast table in CI over every token pair actually used |

---

## 5. Where Studio should intentionally differ

| Area | ChatGPT choice | Studio/Chalk choice | Why |
|---|---|---|---|
| Base size | 14px UI, user range 11–16px, 13px labels with negative tracking | 16px body (18/20 optional), 14px floor, no negative tracking on Hangul | Elementary readers (CLAUDE.md language table). DES-02 16/14. Hangul syllable blocks lose legibility below 14px and with tight tracking |
| Line height | 20/14 ≈ 1.43 for UI, 1.5 for markdown | 1.65–1.75 for Hangul prose | Hangul has no ascender/descender rhythm; CC-R1 already uses 1.625 |
| Line breaking | No keep-all (Latin-first) | `word-break:keep-all` plus `overflow-wrap:anywhere` | Default CJK breaking splits words mid-syllable-group, which hurts child readability |
| Column | 640px | ≤40em (about 40 syllables) | Similar measure, defined in em so it scales with the text-size setting |
| Typeface | Proprietary OpenAI Sans | OS system UI (Apple SD Gothic Neo / Malgun Gothic via `system-ui`); optional bundled **Pretendard (SIL OFL 1.1)** only after a licensing/CSP decision | License; offline webview CSP (`font-src` local only) |
| Accent | User-picked accent (8 + custom) | Fixed lime for exactly one primary CTA per screen | SX-04 single CTA; choice is noise for learners |
| Density | compact / comfortable / form | One comfortable density (44px targets) for learners; Chalk may use 32px dense rows only with keyboard parity | DES-06; touch use in classrooms |
| Cursor | Arrow by default | Pointer on interactive elements | Affordance for children |
| Hover reveal | Sidebar row actions hidden until hover | Always visible or keyboard-reachable | CP-R1 "no hover-only actions"; touchpads and tablets |
| Status | Color intents (6) | Icon + Korean label + color; `source_state` vocabulary | SX-21, SX-50, Principle 5 |
| Motion | Expressive (600ms modal, springs, particle bursts, 232 keyframes) | ≤180ms state changes, no springs, no celebratory particles, bounded pending ≤3.8s | Principle 4; attention of young learners; SX-29 (no badge or celebration consumption) |
| Theming | Own theme engine + VS Code bridge in extension mode | VS Code theme is the source; HP theme is one VS Code theme | Studio is a VSCodium fork; respect user and HC themes |
| Customization | Theme import/export, contrast slider, translucency, font smoothing | Only text size plus reduced motion | Minimum choice surface; Principle 4 |
| Placeholder/tertiary | 50% opacity, #8f8f8f (3.2:1) | ≥4.5:1 always | DES-11 |
| RTL | Full RTL support | Logical properties only; RTL deferred | KO/EN audience (ui-philosophy §3) |
| Toasts | Frequent transient toasts | Timeline lines for progress; toasts only for confirmations | REQ-M35 timeline pattern; Principle 5 (real-state feedback) |

**VS Code theming constraints to respect:** the webview receives `--vscode-*` vars and `body.vscode-{light,dark,high-contrast,high-contrast-light}`.
`--vscode-font-size` defaults to 13px, so Studio must not inherit it for prose. `window.zoomLevel` scales the webview. CSP limits fonts and images to the extension origin.
The editor monospace (`--vscode-editor-font-family`) should drive code blocks.

---

## 6. Licensing and asset constraints (flagged)

| Asset | Status | Rule |
|---|---|---|
| OpenAI Sans / OpenAI Serif (`OpenAISans-*.woff2`) | Proprietary typeface | **Do not copy, bundle or reference.** Requirements name qualities (system UI sans, 400/600), not the face |
| OpenAI "blossom" mark (index.html inline SVG), `openai_logo_*.svg` | Trademark | Do not reuse or imitate. The startup pattern (mark + shimmer) may be reproduced only with HP marks |
| Custom product icon set (`presentation[16]` etc.) | Proprietary | Do not extract |
| Lucide icons | ISC license | Usable with license notice, sourced from upstream Lucide, not from this bundle |
| VS Code codicons | CC-BY-4.0 (icons) / MIT | Preferred inside Studio for theme consistency |
| KaTeX fonts | MIT / OFL | Usable from upstream if math is ever needed (CGP-DS-40 DEFER) |
| Carlito | SIL OFL | Not needed |
| emoji-datasource (`webview/licenses/emoji-datasource.LICENSE`) | MIT | Not needed; Studio uses the OS emoji font |
| Color, spacing and timing values | Not copyrightable as such | The requirements above specify Studio's own values (forest/lime palette, own scales). Do not adopt ChatGPT's gray ramp wholesale as a brand identity |

---

## 7. Open questions / unknowns

1. **Studio webview CSS is not in the snapshot** (`webview-ui/src/styles.css`, `start.css`, `localReview.css`). Every "Studio today" cell for the chat panel comes from docs.
   The actual composer radius, bubble color, focus style and reduced-motion rules need a read of `origin/main` webview-ui.
2. **Palette conflict:** SX learning surface (`#202C24` panel), CC-R1 (`#18231C`) and CP-R1 personal chat (`#202226`/`#17191d`, focus `#799ed7`). Which one is canonical, and is the personal-chat palette intentionally separate from the learning surface?
3. Does VSCodium expose `workbench.reduceMotion` to extension webviews, or must the host read it and `postMessage` it? (Not verified.) The same question applies to `window.zoomLevel` and to a dedicated chat text-size setting.
4. Is `.hp-cta-secondary` (transparent + `#35483A` border = 1.75:1) already shipped? If so, it fails DES-11 today.
5. Pretendard (OFL) bundling versus system font only: this needs a size, CSP and licensing decision. The Windows `system-ui` fallback is Malgun Gothic, whose Latin glyphs are weaker.
6. ChatGPT's 22px user bubble and 640px column suit adult reading. The best measure for elementary Korean readers (35 versus 40 syllables per line) should be tested with real learners, not assumed.
7. Which ChatGPT window type (`electron`, `browser`, `extension`) a given user sees depends on flags. The extension-mode token bridge is observed in CSS, but whether a VS Code extension build of this renderer ships publicly is not confirmed by these files.
8. CC-R1 "metadata 11px" contradicts DES-02 (labels ≥14px). The question is whether DES-02 applies to the personal chat surface or only to Chalk.


## Font role implementation decision (CGP-DS-R-007)

REQ-CGP-DS-08 uses independent named UI/content/code roles over the shared
primitive-semantic-component tiers. Host editor font changes apply to code only;
prose cannot change nested action controls. Chalk's generated transport includes
its typography consumer rules; explicit technical identifiers remain fixed-width.
No proprietary font, network font load or new learner setting is introduced.

## Studio pane-width adoption (CGP-DS-R-013)

REQ-CGP-DS-14 / DES-CGP-DS-14 are implemented by the named `studio-chat` container.
See `REQ-STUDIO-CHAT-CONTAINER` in studio-requirements.md for the exact 448/688 CSS-pixel
boundaries, the separate 1024px code-diff threshold, and the outer-workspace scope boundary.
Local computed evidence is `test/chat-container-layout.smoke.mjs`; native acceptance is not
implied by that headless result.

## Studio learner menus (CGP-DS-R-022)

REQ-CGP-DS-24 uses the shared learner-menu tokens and computed browser guard described in
REQ-STUDIO-MENU-TOKENS. The tools and personal header menus retain their own placement
and actions. DES-CGP-DS-24 type-ahead and Chalk dense-menu work remain separate; local
computed evidence does not imply installed-app or owner acceptance.

## Confirmed copy feedback (CGP-DS-R-025)

REQ-CGP-DS-27 is adopted for Studio and Chalk copy outcomes in
REQ-STUDIO-COPY-FEEDBACK. Studio success lasts at least4s; Chalk success persists; copy
errors are alert regions without automatic dismissal. Existing trash/online timers meet
the floor. Native announcements and DES-CGP-DS-27 toast geometry remain separate evidence.
