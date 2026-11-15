## CGP-KNOW-D-009: task menu move item (DES-KNOW-14, 2026-10-27, agent choice)

- Already met on main by CGP-KNOW-R-009 (`TaskMenu.tsx`); no product code changed. The row is closed by proof: `test/task-menu-keyboard-browser.smoke.mjs` sends key events through the DevTools protocol into headless Chromium (never the OS) and reads the browser's own accessibility tree.
- "Reason announced" is read as the accessible description the browser computes for the focused item (`aria-describedby`), plus the reason being drawn while the item has focus. A hidden reason would still be in the description, so both are checked.
- "Keyboard navigable" is the menu-button pattern already built: ArrowDown/ArrowUp or Enter opens on the first item; arrows wrap; Home/End; Escape returns focus to the toggle; Tab closes. Tab-closes is also kept by the menu's focus-out close, so removing only the Tab branch is an equivalent change, not a gap.
- 44px rows stay guarded by `task-menu-computed.smoke.mjs` (unchanged).
- Default state: unchanged (personal task-workspace seats; classroom seats have no task rail).

