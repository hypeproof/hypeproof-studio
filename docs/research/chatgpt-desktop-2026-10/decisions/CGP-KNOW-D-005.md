## CGP-KNOW-D-005: the memory scope in the activity header (2026-11-04, agent-selected)

Builds DES-KNOW-07 on REQ-STUDIO-ACTIVITY-MEMORY-STATE (CGP-KNOW-D-022) and the scope of REQ-STUDIO-ACTIVITY-MEMORY-SCOPE (CGP-KNOW-R-005); DEC-01, DEC-02.
- Words: the existing state line gains its scope, "AI 기억: 켜짐 · 이 작업 공간 안에서만". "켜짐" stays because R-022 and D-022 require the state; the scope is the one the store enforces (R-005: this personal or trial activity, fixed at creation).
- No class wording: "AI 기억: 이 수업 안에서만" is not shown anywhere. A class or lesson seat has no memory store (R-005), so the line would promise a class memory Studio does not keep; "no store, no line" (D-022) holds. When a class store exists, it gets its own binding and its own line.
- Tooltip and disclosure: one sentence, "AI 기억은 이 작업 공간의 .hypeproof/memory/ 폴더에만 남고, 수업 활동에서는 이 기억을 읽거나 쓰지 않아요.", as the tooltip of the state and of the folder, and as screen-reader-only text. The line stays text with no tab stop (D-022), so no collapsed control is added; the 기억 view already shows the scope label (R-005).
- Narrow: above 480px the state and scope sit on one line (in the row above 1100px, in the band under the heading at 1100px and below). At 480px and below the coach run state shares that band, so the state takes at most half of it at its end; when it does not fit there, the scope words move to a second line as a unit, breaking only between words; the band is two lines tall there. No scope word is cut. Residual: a fallback font much wider than the tested one could need a third line at 320px; not measured.
- Settings: the 대화 설정 paragraph gets the same scope words before the folder.
- Floors: 14px (above the register's 11-13px, the learner floor wins), 4.5:1 in both themes, forced colours; measured in headless Chromium. The state keeps D-022's primary text colour rather than "secondary": it is the learner's privacy statement, and the folder after it stays muted.
- Default: on wherever the store exists (no switch).

## CGP-KNOW-D-005 follow-up: the temporary task's header phrase (2026-11-08, agent-selected)

Refines the CGP-KNOW-D-005 section above for a "기록 없이 묻기" task (CGP-KNOW-R-029: it reads memory, DEC-02, and writes none).
- Words: the header keeps "AI 기억: 켜짐 · 이 작업 공간 안에서만" and appends "· 이 작업은 기억에 남기지 않아요" in that task only. Hiding the line would hide that memory is still read; "꺼짐" would be false.
- Tooltip and screen-reader text add "이 작업은 기억을 읽기만 하고 새로 남기지 않아요."
- Narrow: the phrase is its own unbreakable element. At 480px and below it takes its own line under the state, the state may use the full band width and the band grows to three lines (tokens only); the verifier measured 3 lines in a 2-line slot at 320px with the phrase inside the scope words, which this replaces. Settings paragraph unchanged.
- Confirmed by Jay: no

