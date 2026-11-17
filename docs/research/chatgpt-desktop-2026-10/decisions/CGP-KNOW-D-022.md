## CGP-KNOW-D-022: the memory state line in the settings dialog and the activity header (2026-11-01, agent-selected)

Builds DES-KNOW-40 on REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-R-022); DEC-01, DEC-02.
- "Activity header disclosure" is read as an always-visible statement in the task heading (owner preference 2026-11-01: an always-visible activity header disclosure on personal seats), not a collapsed widget: a collapsed control would hide the state behind a press. It is text, with no tab stop.
- Seats: exactly where the memory store binding exists (R-022's "no store, no line"): personal and trial activities, every cohort, minors included. The host serves `memoryState` from that binding; no profile field is read (tests include profiles whose fields say "off" or "teacher decides").
- Narrow headers: the state words never shrink and the folder gives way before anything else. Fix round 1 (verify): the first build let the folder and the activity line shrink together and moved the state only at ≤480px, so the kind was cut at 481-495px and the name at 641-800px, and a negative margin glued "켜짐·" at 641-700px. Now at ≤1100px the state takes a band under the heading, at its end (the band the coach run state also reserves at ≤480px), and the folder is visually hidden there (full line in the tooltip and the accessible text); above 1100px the row has room for the activity line, the state and the folder. The row gap separates the state from "· folder". A width sweep compares the heading with and without the line at every width from 320 to 1420px.
- Settings: one paragraph before the nickname field, the same words and folder; not a control.
- Learner floors: 14px, 4.5:1, both themes; measured in headless Chromium.
- Default: on wherever the store exists (no switch exists to default).

