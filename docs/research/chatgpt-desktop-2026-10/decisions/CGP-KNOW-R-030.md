## CGP-KNOW-R-030: memory as files inside the activity (2026-10-29, agent-selected conservative implementation)

Applies DEC-01 and DEC-02 (ruled by Jay 2026-10-28). Built as REQ-STUDIO-ACTIVITY-MEMORY-FILES.

- Location: `.hypeproof/memory/` inside the activity folder (the learner's task-workspace root, the same root the activity trash binds). The team-brain alternative in REQ-KNOW-48 is not used: class activities keep their own stores (REQ-KNOW-07), and this row adds none.
- Seats: every learner seat with a task workspace (personal, trial; minors included per DEC-02). Instructors and seats without a task workspace get no panel. No setting, no Service field.
- Delete is permanent, not a move to the activity trash: a deleted memory must not stay inside the activity where a later reader could find it. The native confirm says it cannot be undone.
- Delete is allowed under a restricted folder choice (REQ-KNOW-18): it is the learner's own privacy action on Studio's own store and never an AI tool write.
- Hostile input fails closed: a linked `.hypeproof` or `memory` folder refuses the whole store; files with names outside a plain allowlist, links, hard links and folders are counted, never read or deleted by Studio.
- Context: the store exposes `contextItems()` (fresh disk read, no cache) but no request carries memory in this row. Injecting it before the REQ-KNOW-49 first-use notice and the REQ-KNOW-44 count would use memory without telling the learner. Writes from turns come with REQ-KNOW-45 (timeline line with undo); `append()` is the only write path they may use.
- UI home: a section of 내 작품 under the activity trash. DES-KNOW-48 (CGP-KNOW-D-030, a 기억 filter in the same drawer) may restyle it. (Superseded by CGP-KNOW-D-030 below.)

