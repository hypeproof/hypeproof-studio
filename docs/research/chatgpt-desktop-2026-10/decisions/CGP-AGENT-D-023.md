## CGP-AGENT-D-023: checkpoint dialog (DES-CGP-AGENT-53, 2026-10-27, agent choice)

- Prefill, focus with the whole text selected, Enter newline, IME-safe Cmd/Ctrl+Enter and no push control were already built by CGP-AGENT-R-027 (`TurnReviewBar.tsx` `CheckpointSection`).
- Gap closed: "primary 저장 지점 남기기" was drawn exactly like 취소. It now takes the theme's button fill, the same treatment as the edit form's Save (`.hps-edit-save`), with fill-ink hover/pressed layers, a ring outside the fill in the transcript scroll scope, and the SX-04 step-down beside a lesson mission's Primary.
- Proof in a real browser: `test/checkpoint-keyboard-browser.smoke.mjs` sends key, IME composition and text events through the DevTools protocol (never the OS). keyCode 229 is tested apart from `isComposing`, because the commit keystroke can carry 229 after the composition ended.
- Equivalent change, not a gap: dropping `preventDefault` on Cmd/Ctrl+Enter adds no newline in Chromium (the browser inserts no text for a modified Enter); the mini-dom test still requires the event to be handled.
- Default state: unchanged (adult website-track seats only; local display change, no new data flow).

