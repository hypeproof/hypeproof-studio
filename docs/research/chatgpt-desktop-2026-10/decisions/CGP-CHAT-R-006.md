### CGP-CHAT-R-006 — local attempt selection (2026-10-22)

Agent-selected, not human-confirmed: record the optional choice only in extension
local globalState, keyed by activity/task scope. Store learner actor, root/attempt
IDs and timestamp; no answer text, score, upload or instructor recipient. Selecting
an answer and choosing it are separate actions: browsing changes next-turn history;
the chosen marker stays until explicitly choosing another attempt. Preserve retry
request IDs for accounting and group them only for display/history projection.
Use the existing version sidecar for full attempt transcripts, with a plain selected
conversation for older builds. Same-session images remain in memory and are not
introduced into durable storage. No grant or minor-seat safety policy is widened.

