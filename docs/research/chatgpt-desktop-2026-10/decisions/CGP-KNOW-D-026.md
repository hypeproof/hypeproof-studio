## CGP-KNOW-D-026: "기억 사용 N" chip in the action row, opening the shelf's 기억 tab (2026-11-01, agent-selected)

Builds DES-KNOW-44 on REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026): no second list, no new host message.
- "Answer metadata row": the personal answer's action row (copy, preview, retry, verdict, then the elapsed receipt). The chip goes after the controls and before the elapsed time, and keeps its border so it reads as a chip, not as one more ghost action.
- "Source shelf": the task's 작업 자료 panel (`#task-sources`), which citations already open. It gains tabs 출처 / 기억 only while a chip has chosen an answer of this task, so the panel looks unchanged until memory is used. 자료 always opens it on 출처.
- One list: the R-026 list moves into `MemoryUseList`, drawn by the shelf tab and by the in-place fallback for a seat without the shelf. Both mount per opening and read again.
- Focus and return: the chip uses the citation path (`previewSource`'s reading position, `sourceTrigger`, `pendingFocus` on `#task-source-title`), so the side panel focuses the heading, the narrow sheet keeps its modal rule (focus on its first control, Tab trapped), and closing returns to the chip.
- Glyph: a new stroke `bookmark` icon at 16px (DES-KNOW-45 names the same glyph for memory writes).
- Reduced motion: nothing here animates; the global reduced-motion rule covers any inherited transition (test asserts no running animation and at most 1ms).

