## DEC-KNOW-D-002: activity title above the 작업/자료 tabs (CGP-KNOW-D-002, 2026-10-26; agent choice, not a new human agreement)

| Decision | Choice | Why | Default | Human approval |
|---|---|---|---|---|
| What the title says | The activity's name from the host; the activity kind ("개인 작업", "AI 체험", "이용권", "무료 사용") when the name is blank after cleaning | The chat header already says kind · name; the rail heading names the "project" like ChatGPT's project home | On | no |
| Where | An `<h2>` directly above the tablist, only on seats that draw the tabs | Seats without the tabs keep today's rail (DEC-KNOW-R-002 scope) | On | no |
| Untrusted name | Whitespace collapsed; controls, bidi marks/overrides/isolates, U+2028/2029, zero-width and filler characters dropped (ZWJ/ZWNJ kept); NFC; 80 grapheme clusters with "…"; `dir="auto"` and `unicode-bidi: isolate` | The name is host data; a bidi override must not reorder the rail, an invisible name must not draw an empty heading | On | no |
| Size | One line at body size (16px, weight 600), ellipsized; full name as text (accessible name) and tooltip | Above the 14px learner floor; a long Korean name must not push the tabs down | On | no |
| "320px: full-width segments" | The two segments fill the tablist and the tablist fills the rail's row at every width; at 320px the rail is the full-width drawer | The control lives in the rail, so its full width is the rail's | On | no |

