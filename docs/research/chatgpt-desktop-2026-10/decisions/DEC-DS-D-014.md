## DEC-DS-D-014: shared focus geometry (2026-10-22; agent implementation choice)

Reuse the semantic `--hp-ring-focus-default` role established by D-001; do not resurrect the removed
`--hp-ring` alias. `focusGeometry.css` owns an important outline so legacy page-specific 3px rules cannot
win, but with low specificity (exemptions in `:where()`), and the offset is an inherited custom property
that a scroll scope sets once, so the inset needs no selector that out-ranks the base (the first
checkpoint's scope rules lost to the base). It sits after the role tokens in Studio's bundle and is
appended to the Chalk transport. Focus changes the ring only: a keyboard-focused control keeps its own
fill, text and icon colours in every state (hover, pressed, selected), so the primary CTA stays lime.
Because an inset ring would then sit on the control's own fill, the accent-filled controls
(primary CTA, Send, Save, Run, Retry) keep the outside +2px offset even inside a scroll scope; the 2px
gap separates the ring from the fill, so the ring has to contrast with the surface only. Any ring that
is inset (-2px) must also reach 3:1 against the control's fill. This supersedes the round-2 design that
repainted every focused control with the neutral surface pair. Forced colors are the one exception:
the browser already replaces author fills there, so Canvas/CanvasText with a Highlight outline keeps
a Highlight-filled selected control from swallowing the ring, and the -2px scroll inset stays.

The four theme kinds require >=3:1 against the surround. The browser checks (computed style, forced
:focus-visible over CDP) run in the `extension-test` CI job with `FOCUS_REQUIRE_BROWSER=1`, on the
runner's preinstalled Google Chrome, so a missing browser fails the job instead of skipping them;
the parsed stylesheet/token guards run without Chromium; the browser checks remain required owner evidence when the sandbox
cannot start Chromium. No safety, permissions, Service behavior, copy or publication is changed.

