## CGP-DS-D-011: motion names, exit curve and loop exception (2026-10-24, owner decision)

- Confirm: `--hp-dur-confirm: 160ms` is added as an alias of `--hp-dur-content` (one value, two names). Existing uses are not renamed.
- Move: `--hp-dur-move: 240ms` is added for in-place movement. No transition moves an element in place today (the chevron turn is a 140ms press, the runner bar's height change is a 180ms entry), so nothing uses it yet.
- Exit: `--hp-ease-exit: cubic-bezier(.4, 0, 1, 1)` replaces the `ease-in` keyword on the dialog exit (Studio `modalSurface.css` and the Chalk copy in `sharing.html`). It is the only dialog or popover exit in the product.
- Loops: looping pending indicators (runner, shimmer, breathe, response and classroom dots) are the "bounded pending" exception to the 300ms cap. They must stop under `prefers-reduced-motion` and `workbench.reduceMotion`; the global override already sets one iteration and 0.01ms, and `test/motion-computed.smoke.mjs` measures it.
- No spring or bounce: no cubic-bezier with y outside [0, 1], no `linear()` easing, no spring keyframe names. The runner hop and dust keyframes are looping status animations, covered by the loop exception.

