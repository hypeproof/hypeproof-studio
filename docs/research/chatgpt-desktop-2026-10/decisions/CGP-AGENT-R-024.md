## CGP-AGENT-R-024 / CGP-AGENT-D-011: new help-request notice and attention-list rows in Chalk (2026-11-11)

Agent implementation choice for the Chalk half of the help-request notification and the attention-list row layout. Help requests already reach `/manage` (the 10 s `kind=help` read behind the keyboard triage), so no Service read or push was added. Confirmed by Jay: no.

- Notification source (agent choice): the existing 10 s poll, so the notice appears at most about 10 s after receipt. A push channel would need a new Service contract and was not invented. If a push exists later, the notice builder is the only part to feed.
- "New" (agent choice): the first read of a class is a silent baseline; later unseen requests that are not older than the baseline's newest are new. Older pages loaded later are not announced. Another class's requests are never listed, so they cannot notify.
- Content: seat and student (already shown in the list) plus the step the board already shows for a single request; never request text. Nothing is logged or sent anywhere; the notice is page state.
- No browser/OS Notification (agent choice, replaces an earlier opt-in design after verifier FAIL on #3718): /manage skips its 10 s refresh while the tab is hidden, so a hidden-tab notification could never fire, and seat/student IDs of minors must not reach lock screens or projectors. The in-console notice and the 새 항목 mark are the only channel and work while the tab is visible.
- Rows (D-011): bold title, muted next-step summary, relative time, one action; "새 항목" with a dot for new requests. The second "좌석 상세" button was removed to keep a single action; seat detail stays on the roster row. Row copy ("요청을 열어 답해 주세요", "새 도움 요청 N건", the button labels) is the agent's wording.
- Deviation from the register text (agent choice): the register says "unread dot + 새 항목"; the mark is cleared when the request is opened, not when the notice is closed.

