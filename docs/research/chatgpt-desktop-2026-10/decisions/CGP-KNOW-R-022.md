## CGP-KNOW-R-022: memory state line (2026-10-29, agent-selected conservative implementation)

Applies DEC-01 and DEC-02 (ruled by Jay 2026-10-28). Built as REQ-STUDIO-ACTIVITY-MEMORY-STATE on the CGP-KNOW-R-030 store.

- "The file store exists" means the store's view exists for this seat (a learner task workspace: personal, trial; minors included). No view means no line: instructors, seats without a task workspace, classroom lesson seats, an unloaded profile and a task switch in progress. Class activities show no personal-memory line (REQ-KNOW-07).
- Home: the head of the memory section in 작업 자료 (under 내 작품), visible before the list is opened. The settings dialog and the activity header disclosure of DES-KNOW-40 are left to CGP-KNOW-D-022, which may move or repeat the line.
- Unreadable store (the folder is a link or not a folder): the line still reads "AI 기억: 켜짐" (the policy state) and the reason Studio read nothing moves out of the folded list so it shows next to it.
- No switch anywhere: no profile field is read for memory, the extension contributes no memory setting, and the line is a paragraph with no control. Tests pin this with minor, teen, kids and "memory off" profiles.
- Learner floors: the line is 14px at 4.5:1 (computed in headless Chromium).

