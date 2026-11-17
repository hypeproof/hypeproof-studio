## CGP-CHAT-D-027: find bar shape (2026-10-26, agent-selected: already met on main)

- The CGP-CHAT-R-027 find bar already draws D80; no product code changed. The row is closed by proof plus one missing guard.
- "Sticky at the top of the transcript" keeps the R-027 reading: a row in the chat column directly above the scroller (not an overlay, not a sticky row inside it), so it is always at the transcript's top edge and never covers a match. Measured: its bottom edge within 12px of the scroller's top, inside the column, at 320/800/1420px.
- 44px controls and `n/m`: the input and the three buttons measure >= 44px with >= 14px text (learner minimum); the count reads `n/m` and `0/0`.
- Esc: the existing test only returned focus to the composer, which is also the fallback, so "always focus the composer" passed it. `chat-find-browser.smoke.mjs` now opens the bar from a focused transcript button and requires Esc to return there, and falls back to the composer when that element is removed while the bar is open.
- Default state: unchanged (on in every seat that draws the transcript; no new data flow).

