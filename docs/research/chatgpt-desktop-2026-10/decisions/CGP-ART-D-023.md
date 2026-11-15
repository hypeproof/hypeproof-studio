## CGP-ART-D-023: deck PDF menu item and progress (DES-ART-23, 2026-10-27, agent choice)

- Already met on main by CGP-ART-R-023 (`chatPanelProvider.deckPdf`, `src/deckPdf.ts`); no product code changed. The row is closed by proof in `test/deck-pdf-host.test.mjs`.
- "Deck menu item": the deck skill has no menu of its own; its commands live in the command palette, so "PDF로 저장" stays the command "HypeProof: 덱 PDF로 저장" next to "팀 브레인으로 덱 만들기" (CGP-ART-R-023 choice kept). No button inside `deck.html`: it has no host channel and is the audience-facing page.
- "Card action 폴더에서 보기": the page card action from CGP-ART-R-010, unchanged (covered by `page-card.test.tsx` and `page-card-host.test.mjs`).
- "Progress within 300 ms": the first line "덱을 PDF로 저장하고 있어요 (0 / N장)" is posted before the preview server, the tab or the capture is awaited. The R-023 test only checked it once the tab was attached, so moving the line after the server start passed; the new case holds the preview server open and requires the line within 300 ms with no tab opened. It replaces in place (the page notice, `role="status"`, `aria-live="polite"`), so per-slide progress does not stack lines.
- "Failure says why": a failed slide names `deck/NN.md` (R-023 test); the new case also pins the preview-server failure and the tab-open failure to their own reasons, and checks the command is free again after a failure.
- Default state: unchanged (on wherever the deck skill is on; no new data flow).

