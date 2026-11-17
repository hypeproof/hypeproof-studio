## CGP-KNOW-R-023: view and delete each memory item (2026-10-30, agent-selected conservative implementation)

Applies DEC-01 (the learner reads and deletes the local memory files). Built as REQ-STUDIO-MEMORY-MANAGER on the R-030 store and the D-030 기억 view.

- Home: the file list of the 기억 filter in the 내 작품 drawer, which already shows each item's text and time. The settings-dialog list of DES-KNOW-41 (CGP-KNOW-D-023) may move or repeat it.
- Source task link: resolved by the host on every listing from the task line R-025 added. Only a task in the task list is a link (it closes the drawer and sends the existing `taskSelect`). An archived task is named in words, because the store opens archived tasks only through 보관함's 다시 열기; a missing task and a file with no task line say so in words. The source line is shown on every seat with the view, minors included (DEC-02): a task title is the learner's own and is already in the task rail.
- "Typed or second confirmation": a second native modal confirm, not typing. Typing a phrase is a barrier for elementary learners; two host modals, each with one 취소, keep the guard in the host where the webview cannot skip it.
- 모두 지우기 deletes what the learner saw: the webview sends the names it listed, the host keeps those it still lists and pins each identity before the first confirm. A file added, replaced or removed meanwhile is kept, and the line says how many files remain without guessing why. Unlisted files (unsafe names, links) are never touched; the first confirm says how many there are.
- "Absent from the next request payload": no request carries memory (R-030 rule; injection waits for REQ-KNOW-44 and REQ-KNOW-49). Proven as the store contract instead: `contextItems()` is the only reader a request may use and has no cache, and tests read it right after each delete and after 모두 지우기. This is a contract test, not a payload capture; REQ-KNOW-44 must build its injection on that reader.
- Default: on for every seat with the memory view (learner's own privacy action; no new data flow).

