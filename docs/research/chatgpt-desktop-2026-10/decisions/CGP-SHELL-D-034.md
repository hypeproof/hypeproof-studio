## CGP-SHELL-D-034: what's-new panel is dismissible and short (2026-10-28, agent-selected: already met, proved)

- Already met on main: the CGP-SHELL-R-035 build draws `새로운 기능` as a non-modal row above the composer with the lines as a `<ul>` and a 44px `새로운 기능 닫기` close button (close ChatIcon). No product code changes.
- "≤ 3 bullets, ≤ 40 chars" is enforced where the lines enter: `learnerNotes()` keeps at most 3 clean lines and drops (never cuts) a line over 40 characters; the webview draws what the host sends. The layout test now renders the shipped `LEARNER_RELEASE_NOTES` instead of a copy, so a fourth or overlong shipped line fails it (and `whats-new.test.tsx`).
- "Bullets" means visible markers: each line is a `list-item` with a non-`none` marker and at least 1em of room inside the row, so the marker is not clipped by the border.
- "Not modal" means in flow (`position` static or relative), not inside a dialog, `role="dialog"` or `aria-modal`, nothing `inert`, no open dialog, and the composer centre stays hit-testable while the panel shows. The panel never takes focus (already asserted).
- "Light/dark" is read as readable in both: heading and line text measure ≥ 4.5:1 against the row (composited over the page) in Dark+ and Light+, in both seats at 320/800/1420 px. Forced colours keep the existing system-border check.
- Proof: seven planted mutations (no marker, marker clipped, absolute overlay, `role="dialog"` + `aria-modal`, a fourth shipped line, a 41-character shipped line, low light-theme contrast) each fail `whats-new-layout.smoke.mjs`.
- Default state: n/a (no behaviour change).

