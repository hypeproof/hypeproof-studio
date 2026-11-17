## CGP-DS-R-032: startup and empty states use only HP marks (2026-10-26, agent-selected: already met, guard added)

- Finding: on `main` every Studio startup and empty surface already draws only HP marks (boot `DisconnectedChat` and start page: `hypeproof-mark.svg`; empty editor: HP watermark; empty chat: text only). The six packaged images are the five HP brand SVGs and a generic chat bubble; no contributed codicon is a vendor glyph.
- Motion: Studio has no startup animation. 0ms with nothing running meets "≤200ms fade with no loop under reduced motion". No fade is added: it would delay the first readable frame for no learner benefit and push every start-page screenshot test into a timing race. The global reduced-motion override in `tokens.css` is the guard that keeps any future animation on these surfaces to one iteration.
- Scope rule: a provider named in copy (a GitHub sign-in button, a model name) is text, not a mark. Rasters cannot be read for a mark, so a new packaged raster fails the audit until a person lists it.
- Not covered: installed-app platform icons (`.icns`/`.ico`, committed in the VSCodium fork) and the native Electron splash; both need an installed-build check.
- Default state: n/a (no behaviour change).

