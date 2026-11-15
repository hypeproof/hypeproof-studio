## CGP-KNOW-D-029: the "기록 없이 묻기" band's title (2026-11-02, agent-selected; lead brief)

Builds DES-KNOW-47 on REQ-STUDIO-TEMPORARY-TASK (CGP-KNOW-R-029, #3383). Measured on main 009b2f32d first.
- Already met: the band is across the top of the task, above the heading. It stays in place while the transcript scrolls to its end and its middle, and it is never covered, at 320, 800 and 1420. It is distinct: a 2px solid rule, its own background and a lock glyph. Text contrast is 7.36:1 dark, 4.98:1 light and 21:1 in forced colours. It has no motion, and no interactive element (so no target size applies). The unavailable control with its reason is R-029's.
- Gap, wording only: the register's title is "기록이 남지 않는 작업", but the Service still logs the request on cohorts with `log_user_messages` (contract #12, blocked-external), so an unscoped title would promise more than the client keeps. The title is "이 기기에 기록이 남지 않는 작업": the register's words, scoped to this device. The lines under it are unchanged: "이 기기에 기록을 남기지 않아요…" (also the menu item's tooltip) and that the request still reaches the Service. The browser smoke pins the title and refuses an unscoped "기록이 남지 않는…" line.

