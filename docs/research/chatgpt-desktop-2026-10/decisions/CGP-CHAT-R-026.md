## CGP-CHAT-R-026: task search (2026-10-25, agent-selected conservative implementation)

- Where it runs: the host searches the task file it already holds in memory (`TaskWorkspaceStore.search`). The webview holds only the open task's messages, so a webview-only search could not find other tasks. Nothing is written, no task is switched, and no model, Service or network request is made.
- What is searched: task names and the text of user and assistant messages. Tool lines, system notices and superseded answer versions (the edit-and-resend sidecar) are not searched. They are not the conversation the learner reads, and a result has to be something the transcript can scroll to.
- Results: one per task, at the task's latest matching message (newest first, at most 50). The date is the matched message's time. The rail shows only tasks whose title did not match (see the reconciliation below); title matches stay in the KNOW-R-001 list.
- Opening: a result in another task goes through the normal `taskSelect` path and its gates (a running turn still blocks it). The jump waits until that task's messages are on screen, then scrolls the transcript and stops "follow latest". Focus stays where it was (the rail on wide windows; the narrow rail dialog returns focus to its toggle). A refused or failed switch (a task error, or another task shown) drops the jump.
- An unreadable task file answers "cannot search" (`작업 기록을 읽지 못해 지금은 찾을 수 없어요`), never "no match". The webview asks once typing pauses (150 ms), because the host scans every task on the thread that also runs the live turn.
- Adds to the title filter in the same field instead of replacing it (owner reconciliation below). The empty state follows CGP-CHAT-D79: `찾는 대화가 없어요`.
- The answer goes only to the view that asked, outside the broadcast `post()` path, because that path invalidates open approval prompts.
- Seats: personal and trial task workspaces. Classroom seats have no task list, so no search.
- Default state: on (local read only; no new data leaves the device, no permission change).

## CGP-CHAT-R-026 × KNOW-R-001 reconciliation (2026-10-25, owner)

- Context: KNOW-R-001 (#2800, merged) made the 작업 찾기 field a webview-only title filter with no host message. CHAT-R-026 (#2782) replaced that filter with a host search over titles and message text. Both rows touched the same field and the same requirement text.
- Decision (conservative merge of both rows): the KNOW-R-001 title filter stays exactly as is: instant, local, NFC and case folded, IME-safe, scoped per activity.
- CHAT-R-026's message-text search is an addition on top of it. Only a committed, non-blank query (never while an IME composition is open), after a 150 ms pause, posts one `taskSearch` to the host.
- Tasks that match only in message text appear as a separate group, `찾은 대화`, under the filtered title list, with snippets. A task that already matched by title is not listed twice; a host answer that matched only the name is not shown again.
- No-match lines: the title filter's `찾는 이름이 없습니다. 다른 이름으로 찾아보세요.` keeps its place under the list heading; the message group adds `찾는 대화가 없어요` only when nothing matched at all, and the unreadable-file line when the host cannot search.
- Requirement text: KNOW-R-001's no-host-message rule now covers the title filter and composition, and points to CHAT-R-026 for the committed full-text query. `task-rail-search.smoke.mjs` asserts zero posts while composing and for a blank query, and exactly one `taskSearch` per committed query; `task-search-browser.smoke.mjs` asserts no task is listed twice.

