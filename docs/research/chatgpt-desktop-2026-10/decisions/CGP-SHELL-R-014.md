## CGP-SHELL-R-014 follow-up: the 내 작업 내보내기 row (2026-11-14)

Confirmed by Jay: no. The coordinator scoped this to the rows that do not depend on #4053. The drawing is an agent choice.

- **Rows.** 내 작업 내보내기 joins because its behaviour shipped (CGP-SHELL-R-028).
  - 화면 밝기 stays with #4053 (CGP-SHELL-R-016).
  - 팁 보기 is not drawn. Tips (REQ-SHELL-19 / CGP-SHELL-R-019) are not built: no trigger and no "팁 그만 보기" exist, so the row would be a switch with nothing behind it (DEC-SHELL-R014).
  - The sheet now draws 4 of the 6 rows, and 5 once #4053 lands.
- **Shape (agent choice).**
  - An action row drawn like "고급 설정" (a 48px button, with the row-name weight), not a toggle, because export is an action.
  - A one-line note under it says what is saved and that the learner picks the folder.
  - The sheet closes first, so the native folder picker is not under a modal.
- **Who sees it (no new policy).** The same seats as the shipped entry: the chat settings dialog draws 내 작업 내보내기 with no seat condition (`ChatPanel.tsx:2719` and `:2750`, CGP-SHELL-R-028), and the palette command is hidden (`package.json`, `when: false`). The row calls the same host function, `ChatPanelProvider.exportMyWork`, so its guards apply unchanged: a work folder must exist, no turn may be running, and one export runs at a time. The row adds no gate and drops none.

## CGP-SHELL-R-014 follow-up: the 팁 보기 row (2026-11-16)

Confirmed by Jay: no. The coordinator required one source of truth with the chat; the drawing and copy are agent choices.

- **Row.** 팁 보기 joins because tips shipped (CGP-SHELL-R-019, #4086). The sheet now draws all six rows REQ-SHELL-14 names.
- **One choice (coordinator).** The row is the chat's own per-seat choice, not a copy: the start page reads `lessonTipsState()` and writes through `setLessonTips()` on the chat provider, the same `LessonTipsPreference` and seat. Every change, from the row, the chat's 팁 그만 보기 / 다시 켜기, its settings checkbox, or a seat switch, fires `onLessonTipsChanged`, and an open sheet redraws. No reload either way.
- **No seat yet (agent choice).** The choice is memory-only for that window, exactly as `lessonTips.ts` does for an empty seat, and the note says so.
- **Shape (agent choice).** A checkbox row like 알림, with the chat dialog's hint wording plus "대화의 '팁 그만 보기'와 같은 설정이에요." so the learner knows it is the same switch.
- Not covered: a real installed App and a screen reader.
