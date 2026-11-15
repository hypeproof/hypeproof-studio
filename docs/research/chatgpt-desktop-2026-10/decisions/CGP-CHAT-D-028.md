## CGP-CHAT-D-028: my-questions popover (2026-10-26, agent-selected: met on main, one gap fixed)

- The CGP-CHAT-R-028 build already draws D81: a header button, a numbered list of 44px rows, 10 rows visible before the list scrolls, focus moving to the chosen bubble. No new UI.
- Gap fixed: the list's 440px cap was fixed, so in a short window (800x480) the popover ran 30px past the bottom edge. "Max 10 rows visible" is read as a ceiling: when fewer fit below the header, the list shows the whole rows that fit (at least one, never a half row) and the rest scroll. It is re-measured on window resize while open.
- Pointer: choosing a row with the pointer also moves focus to the bubble (same as the keyboard); no focus ring shows, because the browser shows rings only for keyboard focus.
- Proof: `my-questions-browser.smoke.mjs` measures the popover hanging from the button (aligned to its end edge, under it), a real CDP pointer choice, and 1280x720 and 800x480 windows in both seats.
- Default state: unchanged (on, display only, no new data flow).

