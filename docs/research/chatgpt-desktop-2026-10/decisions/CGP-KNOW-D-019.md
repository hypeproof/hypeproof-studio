## CGP-KNOW-D-019: low disk space bar (DES-KNOW-35, 2026-10-27, agent choice)

- Already met on main by CGP-KNOW-R-019 (`LowDiskBar.tsx`, `ChatPanel.tsx`); no product code changed. The row is closed by proof: `test/low-disk-bar-persist-browser.smoke.mjs` mounts the real ChatPanel with the shipped CSS in headless Chromium and sends key and mouse events through the DevTools protocol (never the OS).
- "Not dismissible while below threshold" is read as: no learner gesture removes the bar while the host's last answer is a notice. Tested gestures: Escape on the disclosure (folded and open), in the composer and on the page; clicks and a double click on the bar; Delete and Backspace on its control; a task switch or config re-post; focus and visibility events (the panel asks the host again and keeps the bar until it answers); a new low measurement replaces the amounts in the same single bar. Only the host's null removes it, and the next low answer brings it back.
- "No upgrade/purchase button" is read from the browser's accessibility tree inside the bar: exactly one control (button 공간 확보 방법), no link, no close-named button, and no node whose name carries purchase wording. The R-019 test only listed DOM `button, a, [role=button]`.
- "≤2 lines at 320px" counts the text node's own line boxes (Range client rects) instead of height / line-height, and any clipping (ellipsis, line clamp, hidden overflow, text outside the bar) fails, so the rule cannot be met by hiding words.
- Mutations run on a scratch copy, each caught: an Escape listener that hides the bar, a 닫기 button, a double-click hide, clearing on config, a 용량 추가 link, a 9em text column (4 lines), ellipsis, a 2-line clamp.
- Default state: unchanged (on in every seat, local measurement only).

