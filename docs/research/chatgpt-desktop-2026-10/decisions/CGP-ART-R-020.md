## CGP-ART-R-020: task activity summary (2026-10-26, agent choice)

- Source of truth: one entry per coach tool call of the task that reached a successful tool_result. Refused, failed, unanswered and post-stop calls make no entry, and prose or tool-line labels are never parsed. A count with no event cannot exist.
- Verbs: Read = 읽음. Write to a path absent at tool_use time = 만듦, otherwise 바꿈. Edit, MultiEdit and NotebookEdit = 바꿈. WebFetch, browser_open and browser_navigate to an http(s) page off this machine = 웹 페이지. The learner's own loopback preview and about:blank are not web pages. WebSearch = 검색. Grep, Glob, Bash and others are not counted.
- Chips count distinct targets per verb. A file created and then edited appears under both, because both events happened.
- Storage: entries ride on the turn's last persisted history line in the task store (local, same file as the conversation). They are never sent to the model and nothing new leaves the device.
- Not counted: provider-hosted search on the proxy route (no client tool event) and calls of an older edited version that is no longer shown (the summary follows the visible conversation).
- Review link: only created or changed files that the open turn review (REQ-ART-02) lists get 바뀐 곳 보기. Older turns have no restore-point comparison, so they get a note instead of a link.
- Seats: every seat that draws the transcript (personal, trial, pass, classroom and lesson, and instructor). Default state: on (local display only; no permission change). Target and text floors follow the owner rule (44px, 14px).

