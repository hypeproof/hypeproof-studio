## CGP-SHELL-R-020: example project ideas after a no-idea answer (2026-10-26, agent-selected conservative implementation)

- Trigger: client-side and narrow. The learner's latest message must be short (at most 30 characters) and end in a no-idea phrase, and the coach message before it (or the greeting, for the first message) must end in a question about what to make or do. Anything uncertain shows nothing, so NAT-03's one-question flow is unchanged. The answer is still sent to the coach as typed.
- Seats: personal task workspaces only (personal, trial, free, pass). Lesson and classroom seats already have a task, and the instructor console is not a learner seat.
- Ideas: six Studio-owned, generic sentences (no customer, cohort or capability wording). No Service profile key was added; a profile-supplied list would need a Service contract that does not exist.
- One picker at a time: when the coach's reply already parses as reply choices, the idea list is not shown.
- Placement: below the coach's reply after the turn ends. `내가 정할래요` sits right after the list, at the newest end of the conversation that the pane follows, so it stays in view in a 320x500 pane where a heading-row button would scroll away. Profile follow-up chips give way while the list is shown. Columns follow the chat pane (studio-chat container), not the window: one column below 640px, two at 640px and wider.
- Pick: same ownership rule as reply choices (keeps typed text, a second pick replaces the first, never sends). Inert during Korean IME composition and while a missing folder holds the draft read-only. The chosen mark is derived from the composer text, not stored.
- Classifier: `없어요` counts only alone or after an ideas/plans subject (`아이디어가`, `하고 싶은 게`, `딱히`…), never `시간이 없어요`; a goal question needs a what-word plus make/do (or `목표가 뭐`), so `저장하고 싶으세요?` is not one. Dismissal is remembered per task and answer in webview state (bounded to 200 keys).
- Sizes: 44px targets and 14px text (owner rule).
- Default state: on for personal seats (local display only; no new data flow, nothing leaves the device).
- Fix 1 (owner decision, after a failed verification): ideas are for STARTING a project, never mid-work, and the trigger is structural, not only wording.
  - Start of the task: no work made yet. Any tool row other than a look-only one (thinking, the pending line, read, search, web) counts as work, so a written or edited file, a preview, a command or an unknown row hides the list. An assistant message with a fenced block (the chat fence opens a preview) counts too, and so does a known artifact in the task (a picked surface, an open world, a publish).
  - Early conversation: the no-idea answer must be among the learner's first 3 messages (`IDEA_OFFER_MAX_LEARNER_TURNS = 3`). Three is small on purpose: a goal question is asked at the start, and a late one is almost always a detail question.
  - Detail and choice questions are never goal questions: `...으로/로 만들까요`, `더`, `부터`, `다음에`, `어느 쪽`, `어떻게`; a what-word followed by a noun other than the whole thing (`어떤 색`, `어떤 파일 이름`, `어떤 모양`); and any question that points at an existing thing (`이/그/저/이번/방금/위/아래/여기`, `...의`, `...에서`, `안에`, `부분`). If either of the closing two questions is such a question, nothing is offered.
  - When in doubt, show nothing (unchanged).

