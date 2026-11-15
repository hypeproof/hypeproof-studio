## CGP-CHAT-D-026: task search design (2026-10-26, agent choice)

- Found on main: the field (44px, >=14px, top of the task list), bold snippet matches and the `찾는 대화가 없어요` empty state were built by CGP-CHAT-R-026; `task-search-browser.smoke.mjs` already measures them. The title-filtered list (KNOW-R-001) listed matching tasks without marking the match, so "results list with highlighted match" held for only one of the two groups.
- Built: the matched part of each filtered title is a `<strong>` (weight 600 against the 400 title, not colour only), every occurrence, computed with the filter's own key (NFC, case folded) per grapheme cluster, so a decomposed title marks its stored characters and an emoji is never split. The parts always join back to the exact title; the accessible name is unchanged.
- No query, no marking: the row renders the plain title exactly as before (no extra spans), so other rail styles and tests are untouched. The archive view shares the field, so its filtered titles are marked too.
- Default state: on (display only; no host message, no stored state).

