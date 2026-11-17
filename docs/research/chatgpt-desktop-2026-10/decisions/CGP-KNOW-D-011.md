## CGP-KNOW-D-011: 내 작품 drawer (DES-KNOW-20, 2026-10-27, agent choice)

- Built as REQ-STUDIO-MY-WORKS-DRAWER. The drawer reuses the provenance inventory (REQ-STUDIO-ARTIFACT-PROVENANCE) and its seat gate, so it exists on task-workspace seats only (personal, trial); classroom and lesson seats have no task rail.
- "Drawer from the rail": a native modal `<dialog>` on the rail's side, full height, at most 360px wide, opened by a `내 작품` button in the rail. Modal so that "focus contained" holds by construction (the page behind is inert); Escape and the close button return focus to the opener, else the rail toggle (on the narrow rail the rail closes as the drawer opens).
- "At 320px list only": read with the rail's own fold point (CGP-KNOW-D-001): windows of 360px or less show the list and no `목록`/`격자` switch. The grid choice is not remembered across openings (list is the default each time).
- Thumbnails, conservative: only PNG, JPEG, GIF or WebP of at most 512 KB whose bytes match, read by the host inside the canonical work folder (no links, `..`, dot or empty segments, control characters) and sent as a `data:` image; the webview renders nothing else. HTML gets the page glyph instead of a rendered thumbnail, because rendering a page would run it and could load network resources. SVG is never a thumbnail (it can name outside resources).
- "Last change" is the time of the latest recorded event in the provenance ledger (`마지막 기록 …`); a file with none reads `바뀐 때 기록 없음` instead of a filesystem time the ledger did not record.
- Text stays at 14px (the learner floor), rows and controls at 44px.
- Not built: opening a file from a row (REQ-KNOW-20, CGP-KNOW-R-011), trash actions inside the drawer (they stay in the 작업 자료 panel, CGP-KNOW-D-013).
- Default state: on wherever the task workspace is (no new write path; one new read-only host message bounded to the work folder).

