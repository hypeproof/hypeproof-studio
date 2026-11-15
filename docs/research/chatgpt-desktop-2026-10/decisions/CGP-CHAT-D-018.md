## CGP-CHAT-D-018: `@` file list popover (2026-10-26, agent-selected conservative implementation)

- "Above the caret": the popover's bottom edge sits above the composer card, and its inline start is the drawn position of the `@` that opened it (clamped into the card). It never sits between caret lines, so it never covers the draft being written; at narrow widths it spans the card.
- "Max 6 rows visible": the list viewport is 6 × the shared 44px menu item height; rows are exactly 44px and single-line, so long names ellipsize (file name first in strong weight, folder muted). The full path is the row's accessible name and hover tooltip.
- Text is the caption size (14px base), the learner floor, per the menu token contract (REQ-CGP-DS-24); the 14px minimum wins over any smaller register spec.
- Closing: Escape (unchanged) and focus leaving the composer, except while a pick is in flight so its acknowledgement still lands. A refused pick refocuses the composer so the keys work again. No new keys, host messages, seats or file capability; the R-018 gate is unchanged.
- Forced colours: the chosen row keeps Canvas/CanvasText with a 2px Highlight border (the home-tab pattern). The Highlight fill showed the words as black boxes under Chromium's Canvas text backplate, and `forced-color-adjust: none` is reserved for QR codes (CGP-DS-R-016).
- Default state: on wherever R-018 already offers the list (personal or adult profile with the read grant); no new data flow.

