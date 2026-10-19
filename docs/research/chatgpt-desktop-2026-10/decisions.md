# Decisions taken by the parity loop

Jay, 2026-10-19: decision-blocked rows proceed with the recommended option. Each choice
is recorded here before the slice that depends on it merges, so it can be reversed.

| DEC | Choice | Why | Default state | Confirmed by Jay |
|---|---|---|---|---|
| DEC-14 | Minor cohorts: chat links open only in the integrated safe-session browser; adults: modal naming the host before the system browser. A blocked click does not notify the instructor | README section 3 #1: the system browser bypasses the safe-session allowlist; the confirm adds one click for adults | On (safety tightening, no new data flow) | no |
| DEC-25 (interim) | Until the Service sends the class window end time, the whole active class seat counts as the class window for the update hold | The client has no window end; a restart mid-lesson costs the lesson. A learner can still dismiss the banner and update outside a class seat | On (holds only; no new data flow) | no |
| DEC-08 | Edit-and-resend keeps the original as version 1 and records an edit_resend event; both attempts stay in the observation record | The original prompt, its answer and its turn record are evidence of how the learner iterated (ADAPT); overwriting them would erase the first attempt. The event holds ids and lengths only, no text | On | no |
