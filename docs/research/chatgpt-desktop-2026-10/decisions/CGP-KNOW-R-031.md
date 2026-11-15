## CGP-KNOW-R-031: one-time memory notice (2026-11-01, agent-selected conservative implementation)

Applies DEC-01 and DEC-02 (ruled by Jay 2026-10-28). Built as REQ-STUDIO-MEMORY-NOTICE on the R-030 store and the R-005 binding; also covers DES-KNOW-49 (CGP-KNOW-D-031).

- "The first time memory is used": the first time a request in the activity would carry memory, which is the R-005 binding plus a store holding at least one item `contextItems()` returns. An empty store uses nothing and shows nothing. REQ-KNOW-44 (CGP-KNOW-R-026) injects only after this notice's record exists, so the learner reads the notice before any request carries memory.
- "Seen" means 확인 pressed, not drawn. The record is the one R-026 already reads: workspaceState `hps.memoryNotice.v1`, activity id → `true`. The host writes it only when the notice is due now for the activity open now; at most 500 activities are kept.
- Seats: personal and trial activities through the R-005 binding, minor cohorts included (DEC-02); class, lesson and instructor seats have no store and no notice. "Surface: Both" needs nothing in Chalk: DEC-02 removed every Chalk, instructor or guardian enablement step, and Chalk gets no memory toggle.
- Placement: a card above the composer, not a modal. It is information, not a gate: the composer stays usable and focus is not taken. A turn sent before 확인 simply carries no memory (R-026 gate).
- Copy states only what the code keeps: the files are in `.hypeproof/memory/` of the activity folder; the readers are the learner and the AI coach that receives memory with a question (R-026); deletion is in 내 작품 → 기억. It makes no claim about servers or other people, because request logging belongs to other rows.
- Learner floors: 14px text and a 44px 확인 win over any register size (owner rule).
- Record helper: `memoryNotice.ts` holds `MEMORY_NOTICE_KEY` and `memoryNoticeSeen`; R-026 (not merged) defines the same key and reader in `memoryUse.ts`. Whichever lands second should import them from `memoryNotice.ts`.

