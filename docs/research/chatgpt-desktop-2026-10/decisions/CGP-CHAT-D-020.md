## CGP-CHAT-D-020: sketch canvas design (2026-10-26, agent choice under the owner rules)

- Width: the sketch keeps the shared `hp-modal` geometry (CGP-DS-D-020): at least 320px wide whenever the viewport has room (≥352px), and at ≤390px the shared bottom sheet spans the viewport. "Fits 320px with 16px gutters" is read as the sheet's content (title, tools, hint, canvas, buttons) staying ≥16px from both viewport edges with no horizontal overflow; the sheet's 20px padding gives that. No sketch-only override of the shared sheet.
- Undo shortcut: Cmd+Z on macOS, Ctrl+Z elsewhere (same platform rule as the find bar), matched on the physical key too so a Korean input source works. Shift (redo) and Alt are not undo; there is no redo. It is handled anywhere in the dialog and stopped there, so it never reaches the host editor's undo. It does nothing while a stroke is down, while the PNG is being saved, during IME composition, or while the discard question is open.
- Canvas name: exactly `그림판`; the drawing and undo instructions moved to `aria-describedby` on the visible hint.
- Already met on main and now measured: tools ≥44px with ≥14px text, discard confirm focusing "계속 그리기".
- Default state: on (local drawing only; no new data flow).

