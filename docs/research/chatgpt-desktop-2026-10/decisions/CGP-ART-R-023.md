## CGP-ART-R-023: deck PDF export (2026-10-26, agent-selected conservative implementation)

- Where: a command, "HypeProof: 덱 PDF로 저장", next to the deck skill's "팀 브레인으로 덱 만들기" in the command palette (the deck skill's only menu today). No button inside `deck.html`: the deck page has no host channel, and CGP-ART-R-015 (present mode, open PR) owns its toolbar.
- How: the served deck in a background integrated-browser tab over CDP, one 1280x720 JPEG per drafted slide, assembled into an image-only PDF by `src/deckPdf.ts`. No core patch and no new permission; the notes layer is removed from the export document and the PDF has no text layer.
- All or nothing: a failed slide, a reload or a changed `deck.html` writes no file. Output is always `deck.pdf` beside `deck.html` (overwritten on the next export); no save dialog.
- 폴더에서 보기 (REQ-ART-23 (2)) stays the page card's action from CGP-ART-R-010; for a page in the served root it reveals that root. Nested pages keep revealing their own folder (more useful than the root; owner may ask for the root instead).
- Default state: on wherever the deck skill is on (`learning_wiki.enabled`); no new data flow off the machine.
- Owner verification: the export inside the installed Studio (integrated browser CDP `Emulation.setDeviceMetricsOverride` and capture on a background tab) was not run; the fallback without emulation is covered in headless Chromium.

## CGP-ART-R-023 gap: 폴더에서 보기 on the deck PDF result (2026-11-14, #4057 §7.2)

Confirmed by Jay: no. The coordinator set the scope: offer 폴더에서 보기 on the PDF result, reveal the exported file inside the seat's served root, reuse the existing reveal path and its path-safety checks, and never reveal anything outside the root. The choices below are the agent's.

- **Where (agent choice).** One quiet button under the saved notice, outside its polite region, so the region still reads only the sentence. It is the page notice's single optional action. There is no new card, and the other notices are unchanged.
- **What is revealed.** `deck.pdf` itself, selected in its folder by `revealFileInOS`. The record is the served root the export used (canonical) and the file's path under it, so the file reveal always stays inside that root.
- **Path safety (reuse).** The page card's walk is now `resolveFileInFolder` and `recheckFileInFolder`. The page variants keep their page-type check and their behaviour. The webview sends no path.
- **Root identity (verify-r004 on #4066).** The walk re-canonicalized the root at use time, so a root path swapped for a link after it was recorded moved the whole walk. `WalkOptions.exactRoot` refuses a recorded canonical root that no longer canonicalizes to itself. The deck PDF reveal and the page card gate (open, reload, reveal) use it. The page card case predates this PR and is fixed here, because the walk is shared. The roots an `exactRoot` walk checks are recorded through `recordedRoot`, which is canonicalFolder's form: the page card's turn root and the deck PDF's served root (round 2). JS realpath keeps a Windows `c:` and the opened case, and would make every legitimate walk fail.
- **Refusal copy (agent wording).** "저장한 PDF를 찾지 못했어요. 다시 PDF로 저장해 주세요." is used for every refusal, because the fix is the same each time.
- **Not changed.** The page card's own 폴더에서 보기: a nested page still reveals its own folder.
- **Not covered:** the installed App's OS file manager. `revealFileInOS` is a fixture in the host test.

