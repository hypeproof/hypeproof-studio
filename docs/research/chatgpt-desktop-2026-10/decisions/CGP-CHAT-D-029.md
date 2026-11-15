## CGP-CHAT-D-029: undo toast shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-029 toast (`UndoToast.tsx`, REQ-STUDIO-REMOVAL-UNDO) already draws the D85 shape; no product code changed. The row is closed by proof, not by new UI.
- "Bottom-center inside the chat panel, above the composer" = rendered by the chat panel itself, centred in the chat column, directly above the composer card (gap ≤24px), inside the panel's own box; content width ≤360px.
- "Paused on hover/focus": while the pointer is over the toast or focus is inside it, no timer runs; when both end, a full 6 s starts again. Resuming the remainder could leave a learner who just moved away a fraction of a second, so the hold never shortens the offer.
- Proof: `removal-undo-browser.smoke.mjs` measures, on personal and classroom seats, dark and light, 320/800/1420px and forced colours: centring, the gap to the composer, containment in the panel, a 44px 되돌리기, ≥14px text on the personal seat, `role="status"`; and in time: still offered at 5.5 s, gone after 6 s, held by a real pointer hover and by focus, gone a full 6 s after focus leaves. Mutations (no focus hold, focus never released, 3 s lifetime, no 44px floor, no centring, no role) each fail it.
- Default state: unchanged (on, every seat that draws the composer; no new data flow).

