## CGP-LEARN-D-016: run state design row already met (2026-10-27, agent decision)

- Clause by clause the design row was shipped with CGP-LEARN-R-016: one 20px icon and the words at the 14px floor in the chat header, `role="status"` with `aria-live="polite"`, no character, no animation or transition, and colour only on top of distinct words. No product change.
- Gap closed with a test only: "state change announced" depends on the live region staying one mounted node whose words change in place (a region replaced per state is a new region and is not announced). The headless browser smoke now asserts the same node and an in-place text change across all seven states, in both seats, both themes and four widths; remounting the region per state or dropping `aria-atomic` fails it. Its fixed sleeps became condition waits.

