## DEC-SHELL-D027: export progress and result path (CGP-SHELL-D-027, 2026-10-28; agent choice, not a new human agreement)

- Met on main for progress and the result line (R-028); proved by the host-flow test with a 120-file folder (one progress notification, counts reported at 50 and 100) and the existing 320/800/1420 entry geometry smoke.
- "Progress for > 1 s operations" is read as "the notification is up for the whole run"; it opens at once rather than after 1 s, because the folder dialog has just closed and a late notification would leave a silent gap.
- Gap fixed, conservative: the result line's folder is a display copy. Hidden characters become `�` (shown, not dropped, so the path stays honest), `[`/`]` become full-width only when `](` would form a link, and paths over 120 characters keep both ends. The real path is used only by "폴더 열기". No new setting, data flow or host message.
- The native notification itself is drawn by the workbench; its width at a 320 px window is an owner-run check, not built.

