## CGP-DS-R-030: tabular figures in Chalk (2026-10-26, agent choice under the owner rules)

- Scope is the row's three nouns read literally on the pages that have them: seat tables (/manage, /board), usage (/budgets) and timers (/console countdown, /manage help-queue ages and "N분 전"). Counters next to them (roster summary, state filters, help badge) are included because they change while the instructor watches.
- Scoped by container, not set on `body`: prose and identifiers elsewhere keep proportional figures, which read better in Korean running text.
- Controls inside the scope are named with `*` because Chromium's UA `font` reset on buttons and inputs drops an inherited numeric variant (the computed test caught this).
- /board and /console were already met; the computed test now guards them.
- Default state: on (styling only).

