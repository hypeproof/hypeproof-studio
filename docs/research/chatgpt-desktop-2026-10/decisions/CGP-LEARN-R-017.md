## CGP-LEARN-R-017: help-queue keyboard triage in Chalk (2026-10-26, agent choice under the owner rules)

- "Resolve-and-advance" = save the open request as 답변 완료 · 학생 확인 대기 (`status: answered`) and open the next one. The instructor cannot mark a request resolved: the share contract lets only the learner move it to `resolved` (classroom-admin ADM-05), and the key never claims more. The visible button says "답변 완료로 저장하고 다음 요청".
- Documented key: `E` (also ㄷ on the Hangul 2-set layout, same physical key). J/↓ next, K/↑ previous, Enter opens (the row's native button), `?` toggles an inline sheet, Esc closes the sheet. The ends do not wrap.
- Selection is keyboard focus on the row's "요청 열기" button, not a separate state, so Tab, Enter, mouse and screen readers keep the same control; the selected row is drawn with the shared focus ring colour, 2px, inside the row edge.
- Scope of the listener: the help region and the open record only, never page-wide. No key fires in input, textarea, select or contenteditable, while composing (`isComposing` or keyCode 229) or with Ctrl/Alt/Cmd. Next/previous only in the list, so arrows in the open record keep their meaning.
- E needs a written next action (the existing form already requires it); without one nothing is sent and the cursor moves to the field. Next = the next row below, else the nearest above; with nothing left the saved record stays open with "이 화면에 남은 응답할 요청이 없어요." because the empty queue region folds away.
- Races: bound to the open request's id and revision; one save per press burst; a save that lands after the instructor opened another record moves nothing; a 10 s re-render keeps focus on the same request id.
- Sizes: 44px targets; Chalk text stays on its 12px floor (instructor surface, not learner chat).
- Default state: on (local keyboard handling only; no new data flow, endpoint or permission).

