## CGP-CHAT-D-016: turn render fallback shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-016 TurnBoundary already draws the D50 shape; no product code changed. The row is closed by proof, not by new UI.
- "Inside the turn" = in the failing row's own slot, between its neighbouring rows and within the transcript column. The box does not repeat the coach label: the row's message could not be rendered, so its speaker header is not claimed.
- Proof: `turn-boundary.smoke.mjs` measures solid borders on all four sides (CanvasText under forced colours), exactly two 44px buttons, raw text >= 14px (learner minimum), and walks real keyboard Tab/Shift+Tab across the box to the following answer (personal: Enter on its copy button works) or the composer (classroom).
- Default state: unchanged (on, both seats; no new data flow).

