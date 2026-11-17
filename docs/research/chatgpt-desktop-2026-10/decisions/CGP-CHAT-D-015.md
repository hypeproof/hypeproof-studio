## CGP-CHAT-D-015: elapsed time placement (2026-10-26, agent-selected conservative implementation)

- "The turn's status line" = the personal answer action row (복사 · 미리보기 · 다시 받기 · verdict). Studio has no other per-turn status line, and the action row is where a finished answer's state lives. The receipt is the row's last item, after every control, so it never sits between controls.
- Where a turn has no action row (classroom seat, a turn ending on a tool row, a no-answer stop), the receipt stays its own one-line status under the turn (unchanged from CGP-CHAT-R-015).
- Secondary text = the muted text token at the 14px caption size, normal weight, not a control (no button, no 44px target needed). It wraps under the controls in a narrow pane; it is not pushed to the far edge, so it reads with its row.
- No live counter: nothing time-shaped is shown during the run; the pending dots rule (end within 3.8s) is unchanged and now measured in the same test.
- Default state: on, both seats; no new data flow.

