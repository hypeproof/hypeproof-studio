# Trial (체험판) diagnosis plan — 2026-10-18

Status: plan only. No diagnosis has run yet. Baseline: `origin/main` `033f917e`,
hypeproof-service `a08cf7a`.

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
