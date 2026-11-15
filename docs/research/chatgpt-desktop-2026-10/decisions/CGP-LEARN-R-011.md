## CGP-LEARN-R-011 (c) / CGP-LEARN-D-011: collapse a learning block, partial (2026-11-14)

Confirmed by Jay: no. These are agent choices within the design row, and the coordinator set the scope.

- **Scope (coordinator, 2026-11-14).** Only the collapse half ships, and the row stays partial. The report half needs a Service and Chalk route, because `/v1/report` goes to the operator and not to the lesson's instructor. It also needs a decision on the 0–300 learner field for minor cohorts.
- **Menu (agent choice, following DES-CGP-LEARN-11).**
  - The overflow menu is drawn now, with one item, so the report item lands in the same place later.
  - The button is the existing quiet button with the dots icon, named "자료 메뉴: <title>".
  - Keyboard handling is the same as the rail's task menu (TaskMenu.tsx).
  - The button is on the open card only, in the head after 닫기. The card geometry tests ruled out two other placements:
    - A fourth column in the closed head gave the title 0px in a 280px rail.
    - A button in the caption row made the open card taller, which pushed the caption under the mission header at 480px / 200 %.
  - The closed card stays DES-CGP-LEARN-01's one row.
  - The menu opens in flow as a row under the head instead of floating, keeping DES-CGP-LEARN-01's "nothing is positioned".
- **Collapsed row (agent choice).**
  - "접은 자료: <title>" and "다시 보기", 44px.
  - The body stays mounted and hidden, so the rehearsal read-back is unchanged.
  - The polite state line is not drawn, so a block the learner put away is not announced.
  - Restoring gives back the open card, which is the state it was collapsed from.
- **Seat (coordinator follow-up, 2026-11-14; key order is an agent choice).** Classroom PCs are shared, so the set is stored with its seat as `{ seat, keys }`. The seat is the Service `activity_id`, else the lesson capability receipt id, else the local activity id. A different seat sees nothing, and on its first render it replaces the stored set, so the previous learner's set is cleared rather than hidden. #4023's bare-array state is dropped.
- **Persistence (agent choice).** Collapse state lives in the webview's own state (`patchWebviewState`), keyed by lesson version and step, bounded to 50. It survives a hide/show re-mount, which plain React state would not. A new lesson version starts with every block shown. Nothing is posted to the host (coordinator: local state only, no evidence event).
- **Not covered:** a real installed App and a real screen reader.

## CGP-LEARN-R-011 (a)(b) / CGP-LEARN-D-011: report a learning block to the class instructor (2026-11-15)

Confirmed by Jay: no. These are agent choices; the coordinator set the scope (the report half of the row, Service then Chalk then Studio).

- **Channel (agent choice).** The report is a classroom-ops event `material_report` on the learner's existing class connection, not `/v1/report`. `/v1/report` goes to the operator and fans out to Discord and the GitHub triage job; the class connection reaches the run's own instructor and nobody else. `classroom_shares` was not used either: its kind CHECK would need a migration, and Service deploys are blocked on migrations. ops event kinds are validated in code, so no migration is needed.
- **No learner text, for any seat (agent choice; deviates from DES-CGP-LEARN-11's optional 0–300 field).** The ops board's contract is that a learner's words never reach it (the evidence event carries provenance only). An adult-only field would break that for the same board, and a minor seat must not get a new free-text field. The learner picks one of three reasons: `wrong` 내용이 틀려요, `broken` 열리지 않아요, `unclear` 이해하기 어려워요. The optional field stays deferred until Jay decides whether it should exist and through which consented path.
- **Block identity (agent choice, revised after verify-3956).** Course, lesson version, step, block type and pinned version, all checked by the Service (catalog and the seat's lesson). There is no params digest: a client-chosen hex was a 32-byte free-text channel to the instructor, and the frozen lesson version already pins the params. The host builds the identity from the served lesson; the webview sends a step and a reason only.
- **Who sees the item (agent choice).** Only a window with a live class connection (inbox run present, not offline, not ended) to a Service that names `material_report`. Without one there is no instructor to reach, so the item is not drawn. Instructor windows and rehearsals never draw it. If the outbox refuses or the connection drops after the item was drawn, the learner is told it was not sent or not confirmed.
- **Inline, not modal (DES-CGP-LEARN-11).** A row under the card head, the same in-flow placement as the menu. The reasons are native radios, so arrow keys work without custom handling. The actions are quiet buttons (SX-04).
- **Instructor side (agent choice).** Chalk `/manage` lists reports in the seat drawer as "자료 신고", after the evidence. The only control is "확인함", on the existing review route (`coach` capability, revision CAS). There is no seat-list badge yet, so an instructor finds reports by opening the seat. That is a follow-up candidate.
- **Reaches the run instructor first (agent choice; the row says "lesson owner").** The report goes to the class run's instructors, who can differ from the course author. The run instructor is the person who can act during the class (pause, tell the learner, use another block), and the run board already carries the seat. A course-level list for the author, across runs, is not built. It needs a new author-facing route and a decision on aggregating reports from several runs. It is a follow-up candidate.
- **Flood limits (coordinator; numbers are agent choices).** One report per block version per learner on a seat, and at most 5 accepted per learner in any 24 h. Both are enforced by the Service inside the INSERT statement, so concurrent windows cannot both pass. A repeat gets "이미 선생님께 전달한 자료예요", and the cap gets its own line telling the learner to speak to the teacher.
- **No false "sent" (coordinator).** Studio says "선생님께 전달했어요" only after the Service's sync answer names that event's seq as accepted. It offers the item only after the Service names `material_report` in `event_kinds`, so before the Service change is deployed the item does not appear. A missing answer is "확인하지 못했어요", never sent.
- **Ids from the lesson only (agent choice, found while listing the visible fields).** The Service checks course, version and step against the lesson the seat runs. An id-shaped field (`[A-Za-z0-9_-]`, up to 128 characters) could otherwise carry a minor's words, such as `teacher_is_mean`, to the instructor. The visible fields are listed in the classroom-admin row "Material report".
- **Not covered:** a real installed App, a real class run end to end, and a real screen reader.

