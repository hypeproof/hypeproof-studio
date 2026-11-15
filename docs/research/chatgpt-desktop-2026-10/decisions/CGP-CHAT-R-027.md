## CGP-CHAT-R-027: find in chat (2026-10-25, agent-selected conservative implementation)

- Placement: D80 asks for a bar "sticky at the top of the transcript". An overlay would cover the first lines (the first match could not be scrolled out from under it), and a sticky row inside the scroller would add a flex gap. The bar is a row in the chat column right above the transcript; opening and closing shift `scrollTop` by its height, so the text on screen and the distance to the bottom do not change. Only a reader within the bar's height of the very top sees the text move on close (nothing to compensate with).
- Focus on Esc: D80 (previously focused element) wins over REQ-CGP-AGENT-48 (composer). The composer is the fallback when that element is gone.
- Scope: user and coach message bodies on screen, in reading order. Tool lines, hidden retry versions and interface chrome inside a body (buttons, status lines, screen-reader-only text) are not searched. A collapsed code pill registers its code: its matches count, and arriving at one opens the pill (it stays open, like any learner toggle).
- Matching: plain text, case-insensitive with offset-preserving folding; no regex, no NFKC; controls, bidi characters, U+2028/2029 and BOM are dropped; 200 code-unit cap.
- Painting: CSS Custom Highlight API, so no DOM is changed and streaming re-renders are untouched; the current match is also underlined (not colour-only); forced colours use Mark/Highlight. Without the API the count and navigation still work.
- Shortcut: Cmd+F (macOS) / Ctrl+F (others), handled on the document before the VS Code webview host sees it; not while a modal dialog is open or during IME composition. No other keys are bound (CGP-CHAT-R86 lists Cmd/Ctrl+F only).
- Seats: every seat that draws the transcript, including the instructor's nested panel. Default state: on (local display only; nothing leaves the device, no permission change).

