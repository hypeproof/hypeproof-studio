## CGP-KNOW-D-016: file info popover (DES-KNOW-29, 2026-10-27, agent choice)

- Parent CGP-KNOW-R-016 / REQ-KNOW-29 had no implementation on main (its only mention was a "Not built" line in REQ-STUDIO-ARTIFACT-PROVENANCE), so this slice builds the turn links the popover needs: `REQ-STUDIO-ARTIFACT-INFO` in `docs/studio-requirements.md`. The R-016 row itself is not claimed here; its verifier can judge it against this section.
- Surface: the only listing of work-folder files is 작업 자료 → "작업 폴더의 파일" (personal/trial task workspace). Each row gets 정보; the popover sits in flow under the row (no overlay, no new scroller). The 내 작품 drawer (DES-KNOW-20, CGP-KNOW-D-011) was built in parallel and has no 정보 button yet; classroom chat has no task workspace.
- Links come only from recorded coach-turn events (task id + assistant row id stored on `ai_*` events at turn end) and are resolved against the task store when the popover asks, not when the list is drawn: the turn's row is appended after the turn-end ledger write, so resolving with the list would have shown a fresh turn as gone.
- Dead-link texts: "대화를 찾을 수 없어요" (the REQ-KNOW-29 wording) plus a reason; archived tasks name 보관함 instead of failing, because they open only through 다시 열기 (CGP-CHAT-R-025). Host writes attributed to the AI and events recorded before this change carry no place and read as plain text (not built: links for them).
- Learner floors win over the research row: 14px text, 44px for 정보, the link and 닫기. Link colour is the theme's link colour, underlined; LinkText in forced colours.
- Escape is caught by a native listener on the list: the narrow 작업 자료 dialog has its own native Escape handler on an ancestor, which would otherwise close the whole panel (found by the render test).
- Default state: on for personal task-workspace seats (read-only; no new data destination; ids and paths stay in the local ledger).

