## CGP-VOICE-R-008: compact voice control corners (2026-10-26, agent-selected implementation)

- Not blocked: VoicePanel's compact presentation already exists (unmounted, voice is planned per REQ-R1), so the row is built on that component and needs no Service contract. It is not mounted on any learner screen by this row; seats inherit it when voice ships.
- Home corner: top right. The composer and its send button live at the bottom of the chat webview; a bottom home corner would cover them (VO-47: the work surface stays reachable). The learner may still move it to a bottom corner.
- Keys: ArrowUp/Down pick the vertical side, ArrowLeft/Right the horizontal side, Home resets; taken with focus anywhere in the control. Arrow keys or Home with Shift/Alt/Ctrl/Meta, or during an IME composition, are left alone (shortcuts and Korean input).
- Pointer: no drag (REQ-CGPV-12 "no drag-to-hide"). A `옮기기` button steps clockwise so mouse users can move it without a drag.
- Per window: this webview's sessionStorage (`hps.voice.compactCorner`), read through an exact-match parse; anything else, or blocked storage, gives the home corner without an error.
- Motion: DES-CGPV-12 asks 150 ms ease-out. The design scale has no 150 ms step and literal durations are not allowed, so the move uses `--hp-dur-press` (140 ms) with `--hp-ease`. Under reduced motion the global reduce rule makes it instant.
- Sizes: 44px targets and 14px text (`--hp-font-caption`) win over DES-CGPV-02's 32px and the old 13px compact text.
- Default state: n/a (voice itself is not shipped; no data flow, nothing leaves the device).

