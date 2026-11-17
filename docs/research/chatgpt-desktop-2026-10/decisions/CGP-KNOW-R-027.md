## Coach `remember` tool (CGP-KNOW-R-027, REQ-KNOW-45 / DES-KNOW-45) (2026-11-08)

Jay, 2026-11-08: add a coach `remember` tool so the coach can save short notes to the activity's memory store, personal activities only, on by default with no flag. Class and team activities never write personal memory (CGP-KNOW-R-005); minors on a personal activity are included (CGP-KNOW-R-022). This makes the #3596 timeline line and undo reachable. Confirmed by Jay: yes (2026-11-08).
- One tool on every runtime that has tools: the Agent SDK runtime (in-process MCP server `hypeproof_memory`) and the local CLI runtime. Both write through `recordTurnMemoryWrite()`, so the file, the timeline line and 되돌리기 are one call (agent-selected).
- Approval (agent-selected): the call is treated as a work-folder write (`writeFile` kind, `.hypeproof/memory/`), so the existing preset decides: no new prompt for an adult on auto, minors keep their preset. The tool never takes a path; an `item` name must be a plain memory file name.
- Note limits (agent-selected): plain text, one run, 300 characters, well under the store's 2000.
- Guidance (agent-selected): Studio-side in the tool description. The Service composes the SDK runtime's system prompt, so the same sentence in the served coach prompt is a Service follow-up, not part of this change.
- #3596 follow-ups (agent-selected): a replaced file above the 16 KiB restore cap is refused before any write (every accepted replacement is undoable); an undone line is rewritten in the stored turn so a reload does not offer 되돌리기 again.
- Still open: receipts live in the extension host's memory, so 되돌리기 on a line from before a window reload answers the calm "unknown" sentence.

