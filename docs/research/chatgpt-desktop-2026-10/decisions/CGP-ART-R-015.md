## CGP-ART-R-015: deck present mode (2026-10-25, agent-selected conservative implementation)

- Where: inside `deck.html` itself (a constant inline script), so it works in the Studio preview and any browser without a new host message, permission or iframe attribute. The preview iframe sandbox is unchanged (no `allowfullscreen`, no popups).
- Fullscreen: requested; when refused, DES-ART-15's fallback (a status line, then the slide fills the window). No toast component exists in a standalone deck page, so the status line is the toast.
- Presenter window: not built. REQ-ART-15 (3) applies only if one is opened, and the preview has no popup permission. Notes are therefore hidden everywhere while presenting. Follow-up if Jay wants a presenter view.
- Scaling: slide sizes read `--vw` (1vw on the scrolling deck); present mode pins it to a 1280 px design width and scales the 1280x720 frame, so text stays proportional on any window.
- Idle: 2 s (DES-ART-15); a keyboard-focused control is never hidden. Ends clamp; no wrap.
- Default state: on wherever the deck skill already writes a deck (learningWikiEnabled); display only, no new data flow.

