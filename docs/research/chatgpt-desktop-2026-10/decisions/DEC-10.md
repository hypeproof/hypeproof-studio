## "먼저 계획 보기": per-class switch (DEC-10, CGP-CHAT-R-004, REQ-STUDIO-PLAN-FIRST) (2026-11-09)

Jay decided that availability follows the class: a per-class switch is added (the register's "availability follows the cohort profile").
- Service field (decided): the cohort profile carries an optional `plan_first: { available: boolean }`, absent = available, served on `/v1/profile` only when explicitly `false` so every existing cohort is served byte-identical (hypeproof-service#341).
- Studio reading (decided): only an explicit `available === false` counts; an older Service, a missing field and a profile not yet loaded all keep today's behavior.
- With the switch off: the chip, the tools-menu item and the pill are hidden on both seat types, the mode is off for every turn, and the host refuses to turn it on.
- A learner who had it on (agent-selected): it is turned off visibly (one status line in the chat pane, shown once for that task), and a waiting plan or an unspent approval is dropped so nothing is left pending and nothing runs on a stale approval.
- Not covered: a lesson-level switch (lesson feature narrowing keeps what `allowed` lists, so adding the key would switch it off for every saved lesson); real-app validation is NOT RUN.
- Confirmed by Jay: yes (2026-11-09).

