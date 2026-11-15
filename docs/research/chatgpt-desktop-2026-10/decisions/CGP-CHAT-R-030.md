## CGP-CHAT-R-030: shortcut sheet scope (2026-10-25, agent choice)

- What is listed: only keys the chat webview binds today (Enter send/queue, Shift+Enter newline, Esc close, Alt+Shift+J conversation while the personal task layout is mounted, `?` this sheet), each with the platform's modifier name. The acceptance names Esc stop, Cmd/Ctrl+F and focus composer as examples, but none of them is bound on main; the row's own rule ("lists only bound keys") wins, so they are not listed and not built here. Binding Esc to stop would overload the key that closes panels and cancels IME syllables, and find belongs to a search row. Each later binding adds its row in `chatShortcuts.ts` in the same change.
- Where: the personal 대화 설정 dialog and the classroom detail dialog (opened from the access chip) get a 키보드 단축키 button; `?` opens it in every ChatPanel seat (instructor mode included) when focus is outside text fields, dialogs, menus and lists; a seat without the settings dialog has only `?`.
- Rebinding: the sheet does not read VS Code keybindings (REQ-CGPV-29's "reflects user rebinding" is not claimed).
- Side fix: the classroom settings dialog had no surface colour outside `.tw-workspace`; it now falls back to the theme sidebar/editor colour so the page no longer shows through.
- Default state: on; display only, no host message, file or network request.

## CGP-CHAT-R-030 gaps: Esc stops an answer, Alt+Shift+K focuses the composer (2026-11-14, agent-selected)

Requirement: `docs/studio-requirements.md` "Keyboard shortcut sheet (CGP-CHAT-R-030)".

- **Esc (agent choice).** It stops only while an answer streams, through the same path as the stop button.
  - Every other Escape owner comes first: an IME composition, dialogs, open menus and lists, the find bar, the voice
    panel and voice conversation, dictation recording, the microphone cards (`.hps-voice-card`: mic denied, recovered
    text), a visible tooltip (that press closes the tooltip only; the chat notes it in window capture, before tooltips.ts hides it, and no other Escape owner changes), and another text field's own Escape. A message parked
    during the stream goes back into the composer, as with the stop button.
  - The decision waits until the event's dispatch has finished, so a listener that handles Escape later still wins.
- **Focus key (agent choice): Alt+Shift+K (⌥ Option+⇧ Shift+K).** It is matched by the physical key, so macOS Option
  layouts work. VS Code has no default binding for it and neither macOS nor Windows reserves it, and it sits beside the
  chat's existing Alt+Shift+J and Alt+Shift+M. Shift+Esc was rejected: VS Code binds it in editor contexts, and a
  webview forwards keys to the workbench.
- **Scope.** Studio only, in every ChatPanel seat. The instructor panel and other surfaces are unchanged. Both rows
  appear in the sheet only now that the keys are bound.

