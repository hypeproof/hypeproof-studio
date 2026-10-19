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
| P5 hand-off | partial | Report and design committed on this branch; epic, the draft PRs below (iterations 1–3) and the three integration PRs | US-04 P1 / NAT requirement rewrites; §8a decision-gated items (studio-public-update-path, lab-trial-request-ack, svc-price-revisions, lab-age-statement, studio-trial-install-profile, studio-release-signing, lab-funnel-analytics); §8b decision-gated items (D15 entry variants, ot-legal-open-access, ot-launch-enable, ot-order-trial-link, ot-guardian-checkout, Phase 4) |

Iteration 1 — draft PRs for report §8a (independent fixes), none merged:

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

Iteration 2 — draft PRs for the remaining decision-free §8a items and §8b Phases 1–3, none
merged, no reviewers requested ("X on Y" = stacked on Y). Summary on the epic:
[#1782 comment](https://github.com/hypeproof/hypeproof-studio/issues/1782#issuecomment-6259099084).

| Section | Fix | PR | Issue | Flag |
|---|---|---|---|---|
| §8a | svc-clock-first-message | [service#126](https://github.com/hypeproof/hypeproof-service/pull/126) | — | `HPS_TRIAL_CLOCK_AT_MESSAGE` |
| §8a | svc-grant-purpose-timestamps | [service#127](https://github.com/hypeproof/hypeproof-service/pull/127) | — | none; migration 0049 before deploy |
| §8a | svc-conversation-cache | [service#128](https://github.com/hypeproof/hypeproof-service/pull/128) | — | none |
| §8a | studio-public-sdk-seed | [#1786](https://github.com/hypeproof/hypeproof-studio/pull/1786) | #1785 | none |
| §8a | studio-sdk-seed-on-demand | [#1800](https://github.com/hypeproof/hypeproof-studio/pull/1800) on #1786 | #1799 | setting, default off |
| §8a | studio-installer-seed-fail-closed | [#1788](https://github.com/hypeproof/hypeproof-studio/pull/1788) | #1787 | none |
| §8a | studio-installer-korean | [#1802](https://github.com/hypeproof/hypeproof-studio/pull/1802) on #1788 | #1801 | none |
| §8a | studio-win-posix-shell-detect | [#1790](https://github.com/hypeproof/hypeproof-studio/pull/1790) | #1789 | none |
| §8a | lab-install-links | [lab#1290](https://github.com/hypeproof/hypeprooflab/pull/1290) | lab#1289 | none |
| §8a | lab-install-kit-copy | [lab#1304](https://github.com/hypeproof/hypeprooflab/pull/1304) on lab#1290 | lab#1303 | none |
| §8a | lab-install-a11y | [lab#1306](https://github.com/hypeproof/hypeprooflab/pull/1306) on lab#1290 | lab#1305 | none |
| §8a | lab-studio-landing | [lab#1292](https://github.com/hypeproof/hypeprooflab/pull/1292) | lab#1291 | none |
| §8a | lab-pricing-clarity | [lab#1294](https://github.com/hypeproof/hypeprooflab/pull/1294) | lab#1293 | none |
| §8a | lab-terminology | [lab#1296](https://github.com/hypeproof/hypeprooflab/pull/1296) | lab#1295 | none |
| §8a | lab-trial-page-order | [lab#1298](https://github.com/hypeproof/hypeprooflab/pull/1298) | lab#1297 | none |
| §8a | lab-banner-a11y | [lab#1300](https://github.com/hypeproof/hypeprooflab/pull/1300) | lab#1299 | none |
| 1 cost | ot-open-profile | [service#129](https://github.com/hypeproof/hypeproof-service/pull/129) | — | unreachable until entry |
| 1 cost | ot-cost-ceiling | [service#130](https://github.com/hypeproof/hypeproof-service/pull/130) | — | `HPS_TRIAL_COST_CEILING` |
| 1 cost | ot-daily-cap | [service#135](https://github.com/hypeproof/hypeproof-service/pull/135) on service#129 | — | `HPS_OPEN_TRIAL_DAILY_CAP` |
| 1 cost | ot-moderation-always | [service#131](https://github.com/hypeproof/hypeproof-service/pull/131) | — | profile field |
| 1 cost | svc-turn-allowance | [service#132](https://github.com/hypeproof/hypeproof-service/pull/132) | — | `HPS_TRIAL_TURN_ALLOWANCE` |
| 1 cost | studio-turn-id | [#1792](https://github.com/hypeproof/hypeproof-studio/pull/1792) | #1791 | header only |
| 2 entry | ot-grant-allowlist | [service#133](https://github.com/hypeproof/hypeproof-service/pull/133) | — | `HPS_GRANT_ALLOWLIST`; Service owner security review first |
| 2 entry | ot-funnel-events | [service#134](https://github.com/hypeproof/hypeproof-service/pull/134) | — | with `HPS_OPEN_TRIAL` |
| 2 entry | studio-funnel-events | [#1794](https://github.com/hypeproof/hypeproof-studio/pull/1794) | #1793 | follows Service offer; needs service#134 |
| 2 entry | lab-open-install-kit | [lab#1302](https://github.com/hypeproof/hypeprooflab/pull/1302) | lab#1301 | `HPS_STUDIO_OPEN_INSTALL` |
| 2 entry | lab-open-trial-page | [lab#1308](https://github.com/hypeproof/hypeprooflab/pull/1308) on lab#1298 | lab#1307 | `STUDIO_OPEN_TRIAL` |
| 3 conversion | ot-end-card | [#1796](https://github.com/hypeproof/hypeproof-studio/pull/1796) | #1795 | follows Service offer |
| 3 conversion | ot-conversation-carryover | [#1798](https://github.com/hypeproof/hypeproof-studio/pull/1798) | #1797 | Service field `conversation_carryover.available` (not yet sent) |
| 3 conversion | lab-trial-to-pricing | [lab#1310](https://github.com/hypeproof/hypeprooflab/pull/1310) on lab#1308 | lab#1309 | `STUDIO_OPEN_TRIAL` |

Iteration-2 merge-order notes from the PR bodies:

- Service migrations: service#127, #130 and #134 each added `0049-*.sql`; service#135 added 0050.
  Resolved in iteration 3: 0049–0052 in that order. Sibling Service branches also add flags to `worker/src/env.ts`.
- Lab `web/src/app/studio/trial/page.tsx` is edited by lab#1296 and lab#1298 (and the stack
  above lab#1298); the second to merge resolves the conflict.
- Cross-repo: #1794 needs service#134; lab#1302 serves a code-free kit only after a release
  ships #1786's seed (503 until then); the lab#1298 "time starts at code entry" line changes
  if service#126's flag is enabled.
- Follow-ups named in PR bodies: NAT-11 text (service#126), the Service change that sends
  `conversation_carryover.available` (#1798), lab-open-install-scripts (lab#1302); the
  traceability owner on #1800 is a guess (JinyongShin) for Jay to confirm.

Iteration 3 — gap fixes from the iteration-2 retro, defect fixes from the background e2e,
and one integration PR per repo. All drafts, none merged, no reviewers, no force push.
Summary on the epic:
[#1782 comment](https://github.com/hypeproof/hypeproof-studio/issues/1782#issuecomment-6261013894).

| Gap | PR | Change |
|---|---|---|
| svc-migration-renumber | [service#127](https://github.com/hypeproof/hypeproof-service/pull/127), [#130](https://github.com/hypeproof/hypeproof-service/pull/130), [#134](https://github.com/hypeproof/hypeproof-service/pull/134), [#135](https://github.com/hypeproof/hypeproof-service/pull/135) | Migration allocation: 0049 service#127, 0050 service#130, 0051 service#134, 0052 service#135 |
| studio-ind-main-sync | [#1769](https://github.com/hypeproof/hypeproof-studio/pull/1769), [#1765](https://github.com/hypeproof/hypeproof-studio/pull/1765) | Synced with `main` |
| svc-open-profile-moderation | [service#136](https://github.com/hypeproof/hypeproof-service/pull/136) | New |
| svc-carryover-field | [service#137](https://github.com/hypeproof/hypeproof-service/pull/137) | New; sends `conversation_carryover.available` for #1798 |
| seed-on-demand-switch | [service#138](https://github.com/hypeproof/hypeproof-service/pull/138), [#1800](https://github.com/hypeproof/hypeproof-studio/pull/1800) | New Service SDK seed offer; #1800 updated |
| lab-open-install-scripts | [lab#1312](https://github.com/hypeproof/hypeprooflab/pull/1312) on lab#1302 | New (lab#1311); `HPS_STUDIO_OPEN_INSTALL` |
| studio-funnel-fixture-regen | [#1794](https://github.com/hypeproof/hypeproof-studio/pull/1794) | Fixture regenerated from Service `4a5cf78`; stale again after service#134 moved to `a97bedc` |
| clock-flag-copy | [#1804](https://github.com/hypeproof/hypeproof-studio/pull/1804), [lab#1298](https://github.com/hypeproof/hypeprooflab/pull/1298) | New #1804 (#1803); lab#1298 clock line follows `HPS_TRIAL_CLOCK_AT_MESSAGE` |
| lab-studio-landing-retest | [lab#1292](https://github.com/hypeproof/hypeprooflab/pull/1292) | Retest note only |

Defects from the e2e run and where they are fixed:

| e2e case | Defect | Fixed on |
|---|---|---|
| E2E-END-02 | Cost-ceiling refusal shows a generic error banner instead of the end card | #1796, #1765 |
| SVC-TURN-02 | `/v1/profile` trial status counts attempts, not turns, with the turn allowance on | [service#139](https://github.com/hypeproof/hypeproof-service/pull/139) (new, on service#132) |
| SVC-COST-02 | `/v1/profile` trial status ignores the cost ceiling | service#130 |
| SVC-FUN-03 | Funnel `trial_limit_near` / `trial_limit_reached` use attempts as turns | service#134 |
| E2E-SDK-04 | SDK install notice asks a no-code open-trial user for a code | #1771 |
| SVC-OFFER-01 | `GET /v1/trial/offer` (TUX-SP-12) has no Service implementation | service#125, service#139 |

The e2e run has not been repeated on the fixed heads; each fix is covered by its branch tests.

Integration PRs (merge one of these, or the drafts in the order its body lists):

| Repo | PR | Head | Contains | Tests |
|---|---|---|---|---|
| Service | [service#140](https://github.com/hypeproof/hypeproof-service/pull/140) | `ac690db` | all 15 trial branches | typecheck pass; 147 pass / 2 fail, the same 2 as `main` (`cr-publish`, `owner-dom`) |
| Studio | [#1806](https://github.com/hypeproof/hypeproof-studio/pull/1806) (#1805) | `917ad1eb` | all 19 `fix/trial-*` branches | tsc, extension `npm test`, `e2e/trial-ux` 56/0, start-page, native-trial-checks, photo-only-send, `next-work.py --check` |
| Lab | [lab#1314](https://github.com/hypeproof/hypeprooflab/pull/1314) (lab#1313) | `f64a51db` | all 12 `fix/trial-lab-*` branches | not re-run (no branch changed) |

hype-pr refuses `trial/` branch names, so the Studio and Lab integration PRs open from
`chore/open-trial-integration-20261019` at the same commit.

Background e2e summary (headless; Service `80d22e4`, Studio `bdfa21ff`; 80 pass / 6 fail):

| Area | Case | Result | Observed |
|---|---|---|---|
| Studio | trial-ux | PASS | 56/0 |
| Studio | start page ON / OFF | PASS | both |
| Service ON | SVC-CLOCK-01 | PASS | profile read leaves `started_at` null; first message starts the window |
| Service ON | SVC-TURN-01 | PASS | 3-attempt tool loop = 1 turn; 4th turn gets 429 `trial_exhausted` |
| Service ON | SVC-TURN-02 | FAIL | profile status counts attempts |
| Service ON | SVC-COST-01 | PASS | 2 admitted at 3,000 micro-USD; 3rd gets 429 `trial_cost_exhausted`, not charged |
| Service ON | SVC-COST-02 | FAIL | profile status ignores the cost ceiling |
| Service ON | SVC-EXP-01 | PASS | 403 `trial_expired` |
| Service ON | SVC-MOD-01 | PASS | 400 `moderation_block`, 0 upstream calls |
| Service ON | SVC-SEED-01 | PASS | `sdk_seed.fetch=true` |
| Service ON | SVC-FUN-03 | FAIL | limit events count attempts |
| Service ON | SVC-OFFER-01 | FAIL | no `/v1/trial/offer` |
| Studio on real Worker | E2E-END-01 | PASS | end card with 이용권 살펴보기; nothing auto-opens; press emits 1 request |
| Studio on real Worker | E2E-END-02 | FAIL | cost-ceiling refusal shows the generic banner |
| Studio on real Worker | E2E-END-03 | PASS | |
| Studio on real Worker | E2E-EXP-01 / 02 | PASS | time-ended card, no 🔌; ⏳ notice |
| Studio on real Worker | E2E-SDK-01 / 02 / 03 | PASS | Korean install notice with `retry:false`; seed decision `offer`; real 409 `trial_requires_sdk` gets the Korean remedy |
| Studio on real Worker | E2E-SDK-04 | FAIL | install notice asks for a code |
| Studio on real Worker | E2E-FUN-01 / 02 | PASS | rows hold only a keyed hash; Service rejects email and text fields with 400 |
| Studio on real Worker | E2E-SP-ON | PASS | |
| Negative control, flags OFF | mint, events, products, clock, attempts, seed, funnel, start page | PASS | open-trial mint 400; `/v1/trial/events` and `/v1/purchase/products` 404; clock and attempt counting as today; no `sdk_seed`; 0 funnel rows; start page identical ON vs OFF |

Not scored: with flags OFF, `/v1/profile` still adds an ungated `trial` block. Deviations: a
synthetic purchase catalogue in the ON run, expiry simulated by aging a local D1 row, Studio
host helpers called directly (no Extension Host). No REPORT.md was written; the evidence
files stayed in the session scratchpad.

Iteration-3 follow-ups: regenerate #1794's fixture against service#134 `a97bedc`; decide
whether the ungated `/v1/profile` `trial` block needs a flag; service#130's GitHub base is
still `main`, so its diff also shows service#125's commits.

Blocked fixes: none.

Open decisions for Jay (they also gate legal review, ot-legal-open-access, and launch enable,
ot-launch-enable):

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
