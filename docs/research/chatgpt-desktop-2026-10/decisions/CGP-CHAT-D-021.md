## CGP-CHAT-D-021: lesson tip presentation (2026-10-26, agent choice)

- Found on main: the presentation shipped with CGP-CHAT-R-021 (#2767). This row adds no product code; it proves the D19 clauses on the real App in headless Chromium and fills the test gaps (a pending send, a long hint, forced colours, one line at column widths).
- "Single row": one row element in the composer column's flow. At 800px and wider the badge, text and both buttons share one line. At 320px the two buttons wrap under the text inside the same row; 44px targets and the 14px text minimum win over a single visual line.
- "Never overlaps the composer": the row is in flow (never absolutely positioned) and the text is clamped to two lines, so a long hint cannot push the composer off screen at base or xlarge text.
- "Hidden while a turn is running": also hidden while a send is pending (posted, before the host starts the turn), and back if the host rejects the send.
- Default state: unchanged (on wherever a served lesson step has a hint); no new data flow.

