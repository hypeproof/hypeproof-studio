## CGP-CHAT-D-017: paste chip in the D06 chip family (2026-10-26, agent choice under the owner rules)

- Label: D07's `붙여넣은 글 · N줄` replaces R07's `붙여넣은 글 (N줄)`; the design row owns the visual wording and the requirement text is updated to match. The line count uses grouping (`1,234줄`).
- Family: the chip carries the D06 chip class and reuses its name-button and × styling (font, border, colours, 44px icon-only ×). The test compares computed styles against a real D06 file chip rendered beside it, so the two cannot drift apart silently.
- Placement: the paste list stays directly above the composer card, not inside it. D06 counts chips toward the card's 192px growth cap, and an expanded 240px editor cannot fit inside that cap. The list itself scrolls at 40vh.
- Narrow columns: the line count is the point of the label, so the row wraps (`입력창에 펼치기` and × move to the next line) instead of ellipsizing the label at 320px.
- Kept from R-017: `입력창에 펼치기` stays a text button (R07 requires converting back to inline). The × now has the accessible name `붙여넣은 글 빼기` instead of the visible word `삭제`; removal undo (CGP-CHAT-R-029) is unchanged.
- Editor: plain textarea, `field-sizing: content` with a 240px max (`--ds-c-studio-paste-editor-max`), then its own vertical scroll. 14px text minimum and 44px targets hold in both seats.
- Default state: on (display only; no new data flow).

