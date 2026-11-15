## CGP-AGENT-R-030: performance trace recording (2026-10-25, agent-selected conservative implementation)

- Default state: off. Machine setting `hypeproofChat.performanceTraceEnabled=false`; the start command is disabled until it is on. Turning it on for any seat is the owner's decision. Even when on, only an instructor or a resolved non-minor seat can start (an unknown workshop tier counts as a minor, so it fails closed).
- What is recorded: numbers only. Per turn (bound to its stream id): start offset, time to first chunk, total time, chunk count, outcome; once a second: extension-host RSS and heap, event-loop lag. No prompt, answer, error text, file name, path or stream id. Ten-minute auto-stop, 200-turn cap.
- Send path: no Service change. 보내기 reuses the existing problem-report route (`POST /report`) with the summary in its schemaless `attachments` (`kind: "perf_trace"`, at most 6,000 characters, under the route's 8,192-character cap) and the note as the description; the shared outbound confirmation (REQ-KNOW-09) lists items and sizes first. A dedicated trace upload (the full file) would need a Service route and is not built.
- Surfaces: native, like 문제 신고하기. Start is a VS Code modal with the consent text (one 기록 시작 button); the pill is a red status bar item; the review is a modal with 내 컴퓨터에만 두기 first. The in-panel pill and dialog of DES-CGP-AGENT-64 (CGP-AGENT-D-026) stay with that design row; the status bar item does not meet its 44px target.
- Consent text: added as §8 of `docs/session-log-consent.ko.md`; the start dialog uses the same lines and a test compares them. The text promises no retention period, because the report route's retention was not verified.
- Kept files are not deleted automatically and there is no viewer; both are follow-ups.

