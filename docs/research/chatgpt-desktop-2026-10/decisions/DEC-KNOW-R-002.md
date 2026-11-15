## DEC-KNOW-R-002: activity home views (CGP-KNOW-R-002, 2026-10-25; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What the "activity home" is | The task workspace rail of personal and trial seats. 작업 is today's rail (새 작업, search, task list); 자료 is the R-003 자료 list | Studio has no separate project page; the activity is the "project" (CGP-KNOW-01) and its rail is where the learner already moves between tasks | On | no |
| One place for the 자료 list | On those seats the chat column's closed 자료 card is left out; the "함께 보낼 자료" line above the composer stays. Classroom keeps the card in the coach rail | Two copies of one list invite a second, stale press target; classroom layouts must not change (REQ-STUDIO-TASK-WORKSPACE scope) | On | no |
| Seats with no list | No tabs; the rail is unchanged, even if 자료 was remembered | An empty view that can do nothing is noise; R-003's gate decides whether the list exists | On | no |
| Persistence | The webview state (as the panel sizes, CGP-SHELL-R-012), per host scope digest, at most 50 seats | A presentation choice; nothing for the host to store, and it survives hiding the panel and reloading the window | On | no |
| Draft safety | Switching is local state only: no host message, no remount of the conversation | The row's acceptance (20 switches, byte-identical draft); keeping the composer mounted is stronger than restoring it | On | no |
| Selected-state presentation | Weight 600 and a 2px underline in the text colour; forced colours keep Canvas/CanvasText with a 2px Highlight underline instead of the shared selection fill | Not colour only (DES-KNOW-02). The shared `[aria-selected]` Highlight fill sits under Chrome's text backplate and hid the label (measured 1:1) | On | no |
| Activity title | Not added above the tabs | DES-KNOW-02 ("under the activity title") is CGP-KNOW-D-002; this row ships the behaviour | n/a | no |

