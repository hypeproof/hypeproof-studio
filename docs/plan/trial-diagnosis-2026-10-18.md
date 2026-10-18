# Trial (체험판) diagnosis plan — 2026-10-18

Baseline: Studio `origin/main` `033f917e`, hypeproof-service `a08cf7a`.

## Status (2026-10-19)

The diagnosis ran on 2026-10-18 (P0–P4, two critic rounds). Findings:
[trial-diagnosis-report-2026-10-18.md](./trial-diagnosis-report-2026-10-18.md). P4 design:
[open-trial-conversion.md](../design/open-trial-conversion.md). Open review gaps are in
report §11; decisions for Jay are in report §10 and design §10. Epic:
[#1782](https://github.com/hypeproof/hypeproof-studio/issues/1782).

| Phase | State | Evidence | What is missing |
|---|---|---|---|
| P0 funnel baseline | partial | Report §2: real users at every stage = **0**; 17 grants are 14 internal probes + 3 paid passes; pass orders 27 → 1 retained | Lab page views were never collected; mailbox count (no approved source); release `download_count` (one `gh` call); raw-zip install on a clean macOS account; Toss console check of the retained ₩55,000 |
| P1 walkthrough | partial | Report §0/§3: headless Playwright over 14 Lab pages, real Service + Agent SDK + built webview headless (15 screens), static kit walk (Mac, Windows) | No real person (T25 NOT_RUN), no real Electron run, no clean macOS account or Windows VM, no wall-clock UI timing |
| P2 heuristic review | done | Report §3/§4: two blind raters (weighted κ 0.69), impeccable critique/audit/onboard (detector not run, marked DEGRADED), WCAG 2.2 checklist on 7 pages, accidental vs intended friction | Keyboard walk, screen reader, zoom and contrast themes not tested |
| P3 synthesis | done | Report §1, §3, §5 (verdict), §8 fix list, Appendix A fix cards | — |
| P4 access options | partial | Design §2A (A/B/C/C′ compared, A recommended), §5 cost and §5.4 unit economics, §7 conversion; report §6/§6a | Decisions D1–D4, D15, D17–D24 are Jay's (report §10) |
| P5 hand-off | partial | Report and design committed on this branch; epic and the draft PRs below | US-04 P1 / NAT requirement rewrites; §8a items not yet started; all of §8b (open entry, cost ceiling, conversion) |

Draft PRs for report §8a (independent fixes), none merged:

| Fix | PR | Issue |
|---|---|---|
| ind-trial-end-notice | [#1765](https://github.com/hypeproof/hypeproof-studio/pull/1765) | #1764 |
| ind-banner-expiry-state | [#1767](https://github.com/hypeproof/hypeproof-studio/pull/1767) | #1766 |
| ind-sdk-error-text | [#1769](https://github.com/hypeproof/hypeproof-studio/pull/1769) | #1768 |
| ind-missing-sdk-error | [#1771](https://github.com/hypeproof/hypeproof-studio/pull/1771) | #1770 |
| ind-trial-busy-policy | [#1773](https://github.com/hypeproof/hypeproof-studio/pull/1773) | #1772 |
| ind-trial-vocabulary | [#1775](https://github.com/hypeproof/hypeproof-studio/pull/1775) | #1774 |
| ind-trial-card-disclosure | [#1777](https://github.com/hypeproof/hypeproof-studio/pull/1777) | #1776 |
| ind-update-check-copy | [#1779](https://github.com/hypeproof/hypeproof-studio/pull/1779) | #1778 |
| svc-profile-trial-status | [hypeproof-service#125](https://github.com/hypeproof/hypeproof-service/pull/125) | — |
| ind-trial-status-ui | [#1781](https://github.com/hypeproof/hypeproof-studio/pull/1781) | #1780 |

Merge-order notes from the PR bodies: #1765 and #1767 both edit `errorBannerPresentation.ts`;
#1769, #1771 and #1775 all touch `coachDegradedNotice` / the 429 stall copy, and whichever
lands later keeps a single solo-seat check.

Blocked fixes: none.

Open decisions for Jay:

- D15 trust event: A (account sign-in) recommended; B only as a second provider; C′ counters
  as secondary limits.
- D17 ship C′ as an interim before accounts? Only if the drained-cap risk and in-App-only
  conversion measurement are accepted.
- D18 free entitlement under A: 1 per (provider, subject) ever; hash retained after deletion
  (legal).
- D19 public update channel for non-members.
- D20 interim request mailbox and response time.
- D21 visual identity across Lab → install → App → chat.
- D22 trial/pass install contents: app + SDK seed only vs member toolchain, after a skills
  audit (report only).
- D23 raw binaries: buy Developer ID/Authenticode and notarize, or route all non-members
  through the kit (report only).
- D24 Lab funnel analytics provider and consent model (Jay + legal; report only).
- D1/D2 ceilings, using the report §6a planning numbers (central ₩954–1,027 per trial;
  break-even 4.0–5.4%); D3/D4 price and FX revisions.
- One-minute checks: the Toss merchant console for the retained ₩55,000 (INFERRED live);
  one `gh` call for release `download_count` when the GitHub budget is free.

## Why

Jay's working hypothesis: **requiring an issued code is the trial's main problem; the
trial should be free to use.** This plan tests that hypothesis instead of assuming it,
and finds the other problems that would remain even if it is right.

## What is already established (from code, 2026-10-18)

| # | Fact | Source |
|---|---|---|
| F1 | No path to the trial without an operator-issued code. In-app copy says so. | `StartPage.tsx:76,136` |
| F2 | The code gate reaches installation too: the Lab kit needs a code; the public zip lacks the SDK binary the trial requires (409 `trial_requires_sdk`, "최신 Studio" copy). | Lab `studio/install/kit/route.ts`, svc `native-trial-budget.ts:76`, #1617 |
| F3 | Issuing a code is two raw admin API calls (roster append + mint). No console, skill or script. Profile is `dashboard_hidden`. | svc `routes/admin.ts:276-387` |
| F4 | Verifying the code starts the 1 h clock, before "이 활동 시작하기". | svc `chat-gate.ts:209-230` |
| F5 | 40 attempts/h, failed attempts and each SDK tool step count (5 turns → 10 requests). No reset. | svc `native-trial-grants.ts:4-10` |
| F6 | Paid passes already self-serve: payment → `claimSeat()` adds roster + mints the same grant. A free trial = same mechanism with a different trust event. | svc `lib/purchase.ts:358-391` |
| F7 | No currency cap, no IP/device limit, Opus-class models allowed on trial grants. | svc `native-trial-budget.ts`, profile |
| F8 | Code gate is deliberate; "코드 없는 공개 발급" is an open decision (US-04 P1: identity, age/consent, re-trial, allowance, payer, abuse). | `docs/requirements/unified-studio-experience.md:8,18` |
| F9 | No real person has done the trial (T25 NOT_RUN). Update checks fail for non-members. Public docs/Lab copy are stale. | testing docs, `updateTransport.ts`, `docs/INSTALL.md` |

Not established: **whether the code is the *main* barrier.** No funnel data has been pulled.

## Phases

### P0 — Funnel baseline (data, not opinion)

- Pull from production, read-only: `native_trials` rows (issued / `started_at` /
  `requests_used` / expired / exhausted), owner console `/admin/owner/usage` trial split,
  pass purchases.
- Count trial requests from the Lab mailto. Ask Jay for the source; the Gmail connector is
  the Sonatus account and must not be used.
- Observe the raw-zip install once on a clean user account (F2 is inferred, not observed).
- Output: funnel table *discover → request → code → install → verify → first message →
  first artifact → expiry/exhaustion → pass*. Unknown stays unknown.

### P1 — Walkthrough audit (two personas, real app)

Personas: adult non-developer with a code; adult non-developer without a code. Minors are
out of scope for a public trial until age/consent (US-04 P1) is decided.

| Stage | Surface | Tool |
|---|---|---|
| Discover/request | Lab `/studio/trial`, `/studio/install`, `/download` | Playwright MCP / claude-in-chrome |
| Install | kit script, raw zip, Gatekeeper | manual run + screen recording |
| First run → first task | Studio start page, chat panel | `e2e/observe/` + remote-debugging port (CDP) |
| End of trial | expiry, exhaustion, pass upsell | synthetic grant with short limits |

Each step records time, words read, decisions asked of the user, and dead ends.

### P2 — Heuristic + design review with external skills

Read every SKILL.md before use. Install project-locally into the worktree or scratchpad,
never globally. Refuse installers that register hooks. Run report-only, with no
auto-fix or auto-commit.

| Lens | Skill | Repo (stars, 2026-10-18) |
|---|---|---|
| Nielsen 10 heuristics, severity 0–4 | `heuristic-evaluation` | Owl-Listener/designer-skills (~3k) |
| Visual/technical audit, onboarding critique | `critique`, `audit`, `onboard` | pbakaus/impeccable (~82.6k) |
| Trial/signup funnel | `onboarding`, `signup` | coreyhaines31/marketingskills (~55k) |
| Screenshot critique, a11y baseline | `design` plugin | anthropics/knowledge-work-plugins |
| Accessibility depth | `accessibility-compliance` | wshobson/agents |

Source research: `scratchpad/ctx-skills.md` (session-local).

**Filter rule.** Generic growth advice ("remove friction") conflicts with deliberate
friction: approvals and judgment prompts. Every recommendation is tagged
*accidental friction* (fix) or *intended friction* (keep, maybe explain better), with
the Product Intent principle cited (`docs/PRODUCT-INTENT.md`). Korean microcopy and
non-developer comprehension are checked by hand. No skill covers them.

### P3 — Diagnosis synthesis

- Problem map: access, install, clock/allowance, copy/docs, upgrade path, learning value.
- Rank by reach × severity, using P0 data where it exists.
- Split into *independent fixes* (valid under any access decision), for example:
  - clock starts at first message
  - SDK binary in the public zip
  - honest missing-binary error
  - Lab links and copy
  - non-member update path
- and *access-model decision* (below).

### P4 — Free-trial access options (decision for Jay)

| Option | Trust event | Reuses | Main risk |
|---|---|---|---|
| A. ₩0 product | Google/email sign-in (PR #1702) → `claimSeat` | purchase flow, grants | depends on unmerged account system |
| B. Instant self-serve code | email OTP on Lab → auto roster + mint | admin mint, roster | email farming |
| C. Anonymous device grant | none; device id + IP limits | grant ledger | Sybil abuse, cost |

Every option needs these:
- a per-trial ₩ ceiling (compute from the current price table, not memory)
- a model restriction for free use (Sonnet/Haiku vs Opus)
- a global daily ₩ cap with the existing cohort-pause kill switch
- an age/consent rule

### P5 — Hand-off

- Diagnosis report.
- Epic via `hype-intent`.
- US-04 P1 / NAT requirement updates via `hype-pr`.
- Implementation goes to separate worktrees, after reserving files on the epic.

## Decisions needed from Jay

1. P0 production read access: OK to query prod D1/owner console read-only?
2. Where do trial requests arrive (mailbox) and can they be counted?
3. Free-trial cost ceiling per user and per day.
4. Adults only for the public trial?
5. Is skill installation into a worktree acceptable, given the security notes?
