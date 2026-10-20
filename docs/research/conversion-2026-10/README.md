# FREE -> PAID conversion and the newcomer's first ten minutes: register and plan

Status: research register and plan, 2026-10-20 (Jay approved the restructure on 2026-10-20).
Bases read: Studio `hypeproof/hypeproof-studio` origin/main `716e91a5`, Service
`hypeproof/hypeproof-service` origin/main `0b43bd6`, Lab `hypeproof/hypeprooflab` origin/main
`6555b52a`. Same shape as `docs/research/chatgpt-desktop-2026-10/` (the CGP parity loop).

## 1. Goal and scope

Goal: more people who start Studio for free reach a paid pass, and every newcomer gets a
first result within ten minutes of pressing install. The loop does this without adding
upgrade pressure ([Product Intent](../../PRODUCT-INTENT.md) INT-ACCESS-01/05) and without
breaking the decisions in `decisions.md` (no login until purchase, no allowance count while
in use, free start never blocks).

In scope: the free seat (profile `studio-open-trial`), the end card, the pass list and
purchase in Studio, the Lab `/studio` pages and web checkout, the code-free installers, the
Service events and owner views that measure all of it.

Out of scope: class and code seats, Chalk, pricing levels, sending email, ads or any
third-party analytics, notarization (deferred, CONV-DEC-05).

## 2. Funnel definition

Seven steps, counted per free seat key (the Service's keyed hash of the grant, or of the
account after sign-in). A step counts once per key ("ever reached"), per KST day of the
event.

| # | Step | Source today | Status |
|---|---|---|---|
| 1 | claim | Service `free_claim` + daily `free_claim_outcomes` | measured |
| 2 | first message | Service `trial_first_message` | measured |
| 3 | 10th turn | Service `trial_limit_reached` only on a refused 11th try | partial (CONV-FUNNEL-R-004) |
| 4 | end card shown | App `offer_viewed {surface: end_card}`: type exists, no caller | not measured (CONV-FUNNEL-R-002) |
| 5 | pass list opened | none; `offer_clicked` is the nearest and the end card skips it | not measured (R-003, R-005, R-006) |
| 6 | Google sign-in | `free_account_linked` only at order creation | not measured (R-005..R-007) |
| 7 | order paid | Service `order_paid` joined through `purchase_orders.free_key` | measured |

Conversion (Service definition, `free-start-conversion.ts:10`): `order_paid` on a key
whose `trial_first_message` is at most 14 days earlier. No query computes it yet
(CONV-FUNNEL-R-008). Nothing reads the funnel tables today; the owner funnel view
(CONV-FUNNEL-R-001) reports a step with no source as `not_measured`, never as 0.

Ahead of step 1 (first ten minutes): Lab `/studio` -> `/studio/install` -> kit served ->
installer ok -> first launch (the claim). First-result time = claim granted -> first
successful `trial_tool_result` (CONV-FIRST10-R-001).

## 3. Register

`register.csv` / `register.md`: 49 rows, `CONV-<AREA>-R-NNN`.

| disposition | rows |
|---|---|
| ready | 22 |
| extend | 11 |
| blocked-decision | 3 |
| blocked-external | 3 |
| already | 10 |

`already` rows carry evidence and need no slice. `extend` rows edit an existing REQ, TUX or
US row and its code. They do not add a parallel requirement.

## 4. Epics

| Epic | Rows | Repos |
|---|---|---|
| C1 Measure the funnel | FUNNEL-R-001..012, OPS-R-001, OPS-R-003 | Service, Studio, Lab |
| C2 End card that converts without pressure | ENDCARD-R-002..008 | Studio (Service for R-004) |
| C3 Purchase continuity | PURCHASE-R-002..006, R-008, R-009 | Studio, Lab, Service |
| C4 Install and the first ten minutes | INSTALL-R-002..005, FIRST10-R-001..005, LAB-R-002/003 | Studio, Lab, Service |
| C5 Money limits and operations | OPS-R-002, OPS-R-004..006 | Service, Lab, Studio |

## 5. Waves

| Wave | Rows | Why this order |
|---|---|---|
| W0 count before changing | FUNNEL-R-001, R-002, R-003, R-004 · OPS-R-001 · OPS-R-004 | A copy or flow change cannot be judged until steps 3 to 5 are counted and the owner can see them |
| W1 the moment of choice | ENDCARD-R-002, R-003, R-005, R-008 · PURCHASE-R-002, R-003, R-006 · FUNNEL-R-005, R-006 | The end card and the sign-in round trip are where free seats stop |
| W2 newcomer path | INSTALL-R-002, R-003 · FIRST10-R-001, R-003, R-004 · LAB-R-002, R-003 · FUNNEL-R-007, R-008 | Install and first-result signals, then the Lab steps ahead of the claim |
| W3 continuity and hygiene | ENDCARD-R-004 · PURCHASE-R-004, R-005, R-008, R-009 · FUNNEL-R-012 · OPS-R-002, R-003, R-006 | Larger cross-repo changes once the funnel shows where they matter |
| Blocked | INSTALL-R-004 (Windows stable), INSTALL-R-005 (notarization), PURCHASE-R-007 (real card run), OPS-R-005 (production values), ENDCARD-R-006 / FIRST10-R-005 (decisions) | Wait on a release, Jay, or production access |

## 6. Division of work with the CGP parity loop

| Topic | Owner | Rule |
|---|---|---|
| Free seat, end card, pass list, purchase sign-in copy, installers, funnel events, owner funnel | Conversion loop (this register) | Branches `feat/conv-*` |
| Chat panel parity, design tokens, Chalk, generic sign-in copy-link fallback (CGP-SHELL-R-022) | CGP loop | Branches `feat/cgp-*` |
| Remaining-count chip next to the composer (CGP-SHELL-R-029) | CGP loop, with a conversion constraint | Never shown on a free seat (profile `studio-open-trial`); recorded as DEC-35 in `../chatgpt-desktop-2026-10/decisions.md` |
| Shared files (`chatPanelProvider.ts`, `startPage.ts`, `StartPage.tsx`, `ChatPanel.tsx`, `docs/studio-requirements.md`) | Whoever has the open PR | The conversion loop skips a row whose files overlap an open `feat/cgp-*` PR and picks the next file-disjoint row |
| GitHub calls | One gh lane across both loops | `.claude/rules/gh-budget.md` |

## 7. How this lands in the repos

This folder is research input, not a requirement document. It sits outside
`docs/requirements/` so the requirement-work ledger does not count 49 rows at once (same
as the CGP register).

- Each slice promotes its rows into the owning requirement document
  (`docs/studio-requirements.md`, `docs/requirements/studio-native-trial-ux.md`,
  `docs/requirements/unified-studio-experience.md`, or the Service/Lab repo's own docs) and
  registers them in `config/requirement-work.json` when a `docs/requirements` file changes,
  **in the same PR as the code and tests**. A row is done when that PR merges. The
  register CSV is not edited for each slice. Progress lives in `~/.hypeproof/loop/conv-progress.json`.
- Service and Lab rows ship as PRs in those repos, opened as `hypeproof-agent[bot]` through
  hype-pr. The loop never deploys, never writes production data and never sends email.
- Decisions: `decisions.md`. Jay's decisions are recorded with their date. The loop
  proceeds with recommended defaults that Jay has not confirmed, records them as
  "Confirmed by Jay: no", and keeps each one reversible.

## 8. Files

- `register.csv`, `register.md`: the 49 rows, with evidence and file lists
- `decisions.md`: CONV-DEC-nn
