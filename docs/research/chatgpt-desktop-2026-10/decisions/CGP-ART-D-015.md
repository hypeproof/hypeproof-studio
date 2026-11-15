## CGP-ART-D-015: deck present-mode look (DES-ART-15, 2026-10-27, agent choice)

- Already met on main by CGP-ART-R-015 (`deckGenerator.ts` present mode, #2823); no product code changed. The row is closed by proof: `test/deck-present-letterbox-browser.smoke.mjs` measures what the R-015 smoke left unmeasured.
- "Black letterbox" is read from screenshot pixels, not CSS: bands above/below (1000x900, 800x800) and left/right (1600x600), light and dark scheme, every sample rgb <= 2, with the slide face itself painted so a black sample cannot be a blank page.
- "Bottom-right position text": the control group's right and bottom edges sit 16 px from the window edges and the `{n} / {total}` text lies in the right half and bottom quarter. The text is part of the control group (이전, n / total, 다음, 발표 끝내기), so it hides and returns with it.
- "Auto-hides after 2 s idle": shown at 300, 1000 and 1600 ms and hidden by 2350 ms after entering, a mouse move, a key and a pointer press; a keyboard-focused control (Tab, :focus-visible) is never hidden.
- "Toast and maximized-panel fallback": a top-level window whose fullscreen request rejects, throws or is missing shows the status line and fills the window, centred; the status line idles away with the controls and returns on mouse move. The preview-iframe refusal stays covered by the R-015 smoke.
- Accepted as is: while shown, the control group overlays the slide's bottom-right footer when the slide fills the window width; it hides after 2 s, which is the design's answer to the overlap.
- Default state: unchanged (on wherever the deck skill writes a deck; display only, no new data flow).

