## DEC-SHELL-R014: start page learner settings sheet (CGP-SHELL-R-014, 2026-10-26, agent-selected conservative implementation)

- Rows: only rows whose behaviour exists are drawn: 글자 크기 (CGP-DS-R-009 text size), 움직임 줄이기 (`workbench.reduceMotion`) and 알림 (`hypeproofChat.osTaskNotices`, default off). 화면 밝기(테마), 팁 보기 and 내 작업 내보내기 wait for REQ-SHELL-16 / 19 / 28: drawing them now would be switches that do nothing. The cap stays six and the order follows REQ-SHELL-14.
- 고급 설정: hidden and host-refused for a minor cohort (`isMinorProfile`, which fails closed on an unknown tier, on the connected or previewed profile) and for a free start answered under14. With no seat and no under-14 answer it stays, because the start page "설정" reached the editor for adult/staff setup before this row. This is a navigation guard, not a security boundary: the editor's own menu entry and shortcut are out of scope.
- Surface: the existing chat settings dialog (`ChatPreferences`) is reused instead of the DES-SHELL-13 right-side sheet; the sheet geometry is CGP-SHELL-D-013's row.
- Text size row: the stored size is the personal-chat size (classroom chat keeps the base size), so the row says "혼자 하는 활동의 대화 글자 크기예요." for every seat. Superseded 2026-11-14 by CGP-SHELL-R-017: the size applies to every chat seat and the start page, and the row says "대화와 시작 화면의 글자 크기예요.".
- Default state: on for every seat; no new data flow, no new permission; notices stay off until the learner turns them on.

