## CGP-CHAT-D-023: step divider design (2026-10-26, agent-selected)

- D56 is met on main by the CGP-CHAT-R-023 build (full-width hairline, centred "n단계: {name}", `role="separator"` with no focus stop, a 44px "지금 단계로"); the layout smoke measures each clause in headless Chromium.
- Gap fixed: each hairline segment keeps at least 24px (`flex: 1 0 space-4`), so a long title wraps instead of erasing the line in a narrow (360px) chat column. Measured at 360, 800 and 1420 px, dark and light.
- "In the header" = region A's lesson header (`header.hp-mission`) footer, next to 남은 단계, not the task top bar: the button belongs to the lesson and the top bar is shared with personal seats that have no lesson.
- Default state: on (display only).

