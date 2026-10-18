# Trial (체험판) diagnosis report — 2026-10-18

Status: P3 synthesis of the [trial diagnosis plan](./trial-diagnosis-2026-10-18.md), revised
after critic round 1 and its gap fills (r1-0…r1-5), then after critic round 2 and its gap fills
(r2-0, r2-2, r2-4, r2-5, r2-6). Committed on branch `docs/trial-diagnosis-plan-20261018`.
Baselines: Studio `origin/main` `033f917e` (now `1d0b6e95`; no trial-path change, §11),
hypeproof-service `a08cf7a`, hypeprooflab `dad0191`. **Production Service runs `133baa5`**, the
parent of `a08cf7a`; the trial-gate code is byte-identical between the two (§0, r1-3).
Design it builds on: [open-trial-conversion.md](../design/open-trial-conversion.md) (P4).

Jay's decisions taken as given (2026-10-18): (1) the trial is usable by **everyone with no issued
code**; (2) the free trial exists to **convert** users to a subscription.

## 0. How this was made (method)

Synthesis method: the `research-synthesis` skill (themes with prevalence, observation separated
from interpretation, insight → opportunity, open questions), with every finding re-checked by an
adversarial verify pass before it entered this report. A completeness critic then listed nine
gaps; six were filled in round 1 (rows r1-*). A second critic round worked the remaining three
and added a unit-economics gap (rows r2-*); what is still not done is listed in §11.

| Input | What it is | Verified by | Refuted findings |
|---|---|---|---|
| P0 funnel | Read-only production D1 `SELECT`s, public GETs, one admin GET (22:45 KST) | `verify-p0-funnel.md`, fresh re-queries ~23:00 KST | 0 (6 corrections) |
| P1 web | Headless Playwright (desktop + iPhone-13 Chromium) + axe over 14 Lab pages, Lab source `dad0191` | `verify-p1-web.md`, re-fetch + probe re-run | 0 (8 corrections) |
| P1 app | Real Service in process, real Agent SDK CLI against exact Service responses, App's own proxy client, built webview in headless Chromium; 15 screenshots | `verify-p1-app.md` | 0 (5 corrections) |
| P4 design | Open-trial → subscription design, read-only prod usage probe | `verify-p4-design.md` | 0 (9 corrections) |
| r1-0 raw zip | Public v2026.1017.0 mac + win zips downloaded and listed (not installed); binary-resolution and catch branches traced in the **shipped** `dist/extension.js` | this synthesis (zip listing re-read) | I2 wording **refuted** (see I2) |
| r1-1 design corrections | verify-p4 corrections applied to the design doc | — | — |
| r1-2 access options | Plan P4 options A/B/C/C′ compared on trust event, reuse, abuse, friction, PII, conversion | spot-checked: Service `origin/main` `2cf66dc` contains #99/#124; `parseProduct` rejects `amount < 100` | 0 |
| r1-3 prod SHA | Public `/v1/health` (12/12 probes `w0.0.0-dev+447f49b7` = Studio #1729 → Service pin `133baa5`); `git diff 133baa5 a08cf7a` | re-ran `/v1/health` and the diff in this synthesis | **1** (see below) |
| r1-4 update path | Real `updateChecker.ts`/`updateTransport.ts` bundled with a `vscode` stub, run headless with and without credentials; anonymous `curl` of the release mirror | — | 0; I5 INFERRED → OBS |
| r1-5 second rater + lenses | Blind second heuristic evaluation (written before reading §3), impeccable critique/audit/onboard via its documented launcher-unavailable path (binary never run), WCAG 2.2 checklist over 7 funnel pages | agreement script `p2lens/agree.py` | 0 |
| r2-0 design reconcile | Design §2A (access options) inserted; design §1/§3/§9/§10 aligned with the report's D15–D21 | — | 0; capacity with overshoot is **360**, not 361 (₩2,775 per trial) |
| r2-2 unit economics | Per-request cost from the 67 prod usage rows repriced at Sonnet/Haiku 5.5; attempts per turn grouped from timestamps; proposed tier (10 turns, Sonnet + Haiku, $1.50 ceiling) modelled; design §5.4 rewritten | scripts `econ/*.py` re-run with `python3 -I` | 0 |
| r2-4 per-step measurements | Per-screen counts for app screens 01–14 from the headless walk; with-code kit install walked statically (Mac fresh / with Homebrew, Windows x64) over Lab `dad0191` and the release's `install.sh`/`install.ps1`; `codesign` and PE-signature reads of the public binaries | — | 0 |
| r2-5 unknown funnel stages | Lab source + live client chunks for analytics; prod D1 schema (127 tables) for tool/artifact columns; Vercel CLI and wrangler token scopes; masked Toss `paymentKey` shapes | — | 0 |
| r2-6 bookkeeping | Plan status line; §11 gap rows | — | — |

**r1-3 correction (applied).** r1-3 concluded that production's trial coach has **no** file,
shell or browser tools, because `sdk_tools` is added to `studio-native-trial.ts` only in `a08cf7a`.
That is wrong: at `133baa5` the trial profile spreads `structuredClone(homepage-practice-s1)`,
which already carries `sdk_tools: { read, write, browser, shell: true, subagents: false }`.
`a08cf7a` writes the same values out explicitly because the practice profile changed
(`subagents: true`, web search on). Production's trial coach therefore has the same tools as
`a08cf7a`. r1-3's main verdict stands: every trial-gate behavior in this report (clock start at
`/v1/profile`, 409 `trial_requires_sdk`, `trial_exhausted`/`trial_expired` messages, no `trial`
block in the profile) runs in production exactly as observed. Service `origin/main` has three
undeployed commits past `a08cf7a` (#122, #99 accounts, #124); none touches a trial file, and the
Studio pin `9e4a5058` (= `a08cf7a` tree) is itself not yet deployed.

Labels used below: **[PROBE]** production read today · **[OBS]** observed in a harness run ·
**[CODE]** read in source · **[DOC]** a document's claim · **[INFERRED]** derived, not observed.
Corrections from the verify passes are applied silently; where a report's headline was wrong,
the corrected wording is used. Raw evidence lives in the session scratchpad
(`p0/`, `p1-web/`, `p1-app/`, `vweb/`, `p4v-usage2.json`, `rawzip-dl/`, `update-probe/`, `p2lens/`,
`econ/`, `gap8/`, `gap-r2-*.md`)
and is not in this repo.

**Inter-rater check.** Two independent heuristic evaluators now cover the app and web flows.
On the 15 matched findings: exact agreement 10/15, within ±1 14/15, quadratic-weighted κ
**0.69** (substantial; n = 15, indicative only), the second rater slightly milder (bias −0.27).
The disagreements were structural, not severity disputes, and §3 was restructured accordingly
(A4 split, U1/D1/D2 merged). Two findings came only from the second rater (A5, A6).

Limits: no real person was observed (T25 NOT_RUN); no real Electron run (quiet-mode build
unavailable for this SHA; the update probe ran the real module headless instead); no clean
macOS account, so the raw-zip error screen is CODE on the shipped bundle, not seen; Windows
UserSetup exe not unpacked; no checkout pressed (would create a production order); no mailbox
count (the Gmail connector is the Sonatus account and was not used); impeccable's detector was
not run (policy), so its critique is marked DEGRADED by the skill's own rule; keyboard walk,
screen reader, zoom and light/high-contrast themes not tested.

## 1. Executive summary

1. **The trial has never been offered to anyone.** All 17 trial grants in production are
   internal probes (14) or paid passes (3). Real users at every funnel stage: **0**. [PROBE]
2. **So "is the code the main barrier?" cannot be answered from data — but it is the first,
   total barrier by construction.** It blocks 100% of no-code visitors at three independent
   points (web, install, app). Removing it alone would **not** produce a working, converting
   trial: other barriers sit behind it, three of them severity 4 (§5).
3. **The end of the trial is a dead end, not an offer.** Limit and expiry end in raw English
   SDK errors, a "🔌 연결이 끊겼어요" banner and a 🚨 신고하기 button; the start page then offers
   "이어서 하기" on a spent trial. The working pass picker is three unlabelled clicks away. Both
   raters put this end state at severity 4; by the peak-end rule it is what a trial user
   remembers at the conversion moment. [OBS]
4. **The public download cannot run the trial, and never updates.** The public zips ship the
   SDK JavaScript but not the native binary; a trial on them fails every turn with "문제가
   발생했습니다… 운영 담당자에게 문의해 주세요." [OBS zip + CODE shipped bundle]. In-app updates need
   a GitHub login to a **private** mirror (anonymous 404); for a non-member the automatic check
   fails silently and the manual check says to run `gh auth login`. [OBS] Even with a code, the
   install is a member toolchain install: on a fresh Mac about 13 actions, 3 terminal prompts
   (one English Homebrew consent, one password) and roughly 10 minutes of English output before
   the app opens, and the Mac installer reports success when the SDK seed fails, which lands the
   trial on the same dead end. Both public binaries are unsigned or self-signed. [CODE + OBS, r2-4]
5. **An open trial today would have no money bound.** 40 attempts with Opus allowed, no
   currency ceiling, no Sonnet/Opus price revision, no FX revision. Typical cost is about
   $0.9 per fully used trial; a realistic worst case is ~$12 (Sonnet) to ~$30 (Opus). [CODE+PROBE]
   The **proposed** tier (10 turns, Sonnet + Haiku 5.5, $1.50 ceiling) costs about
   **₩950–1,030** per fully used trial in the central case and at most ₩2,775 with one-request
   overshoot; it breaks even if **4.0–5.4%** of fully used trials buy a 라이트 pass (8.8–15.8% if
   every trial hits the ceiling). A conversation-cache miss inflates every SDK session by about
   a third; fixing it alone cuts a 10-turn trial by about 40%. [PROBE + INFERRED, n = 1 real
   session, r2-2]
6. **Conversion cannot be measured even after launch** unless the Service links a trial to a
   later order and tags grants by purpose. Of the access options, only account sign-in (option A)
   gives that link natively, and the Service half of accounts merged today, default-off (§6).
   The top and bottom of the funnel are dark as well: the Lab has **never collected page-view
   analytics** in production, and no table records a first artifact per grant; the trace
   endpoint that could carry it refuses trial grants because they have no cohort session. [PROBE+CODE]

## 2. Funnel table (real users; unknown stays unknown)

| Stage | Real users | Internal / paid rows | Source | Notes |
|---|---|---|---|---|
| Discover (Lab visit) | **unknown, and never collected** | — | none exists | GA4 and the custom analytics endpoint ship in code but their `NEXT_PUBLIC_*` ids were unset at build, so nothing loads in production; no Vercel Web Analytics, no Cloudflare beacon; the Redis view counter covers columns only [PROBE + CODE, r2-5]. `/studio/trial` is `noindex` and not in the sitemap [PROBE]. The cookie banner still says "방문 통계와 화면 설정에 쿠키를 씁니다." |
| Request (mailto "[Studio 체험 문의]") | **unknown** | — | not measured | No approved mail source; the request has no confirmation or stated response time (A5) |
| Code issued (grant row) | **0** | 14 admin + 3 purchase = 17 | `native_trials` [PROBE] | Admin mint writes the row at mint time, so every code ever minted is counted [CODE `routes/admin.ts:378`] |
| Install | **unknown** | — | partly measurable | Kit route needs a code (401 `code_required`) [PROBE]; `/api/download/mac` → public zip that cannot run the trial (I1) [OBS]. Public release asset `download_count` exists (all-time upper bound incl. internal, CI and bots; one gh call, **not pulled** under the one-gh-agent rule). Lab `/api/download` and kit hits (Vercel request logs, CLI 403) and Service `/v1/access` checks (Workers Logs, token lacks scope) are dashboard-only [PROBE, r2-5] |
| Verify (`started_at` set) | **0** | 13 + 2 = 15 | [PROBE] | 4 of 5 rows with the real 1 h/40 allowance started with 0 requests — clock starts at verification |
| First message (`requests_used > 0`) | **0** | 9 + 2 = 11 | [PROBE] | |
| First artifact | **unknown, not instrumented** | — | none exists | No column in `usage_log`, `model_usage_requests` or `usage_request_settings` records a tool result; `usage_request_attribution`, `trials`, `turns`, `validations` are empty for the cohort; `/v1/trace/event` needs an active cohort session (403 `session_inactive`), so trial grants cannot write trace events at all; artifact pings are KV with a TTL, latest only [PROBE + CODE, r2-5]. Only proxy: `requests_used` |
| Exhausted / expired | **0** | 4 exhausted (limits 1–5, deliberate) / 8 expired | [PROBE] | |
| Trial → pass | **undefined (0 trials) and unmeasurable** | — | [PROBE+CODE] | Orders mint `pass-<orderhash>` identities (`lib/purchase.ts:255` in `createOrder`); `access_accounts` = 0 rows; nothing links an order to a trial |
| Pass orders (separate funnel) | **origin unknown** | 27 created → 22 expired unpaid (30 min TTL) + 2 failed → 3 paid → 2 refunded → **1 retained (₩55,000)** | `purchase_orders` [PROBE] | B1/B2 internal by timing [INFERRED]; B3 origin unknown. Toss mode from the masked `paymentKey` prefix shape: B1 likely **test**, B2 / the failed 10-15 order / B3 likely **live**, so the retained ₩55,000 is probably real money [INFERRED, low–moderate confidence, r2-5]; not established revenue until Jay checks the Toss merchant console (2026-10-17 15:26 KST, ₩55,000) |

Cost observed so far (whole cohort, 67 usage records): **$2.65** at 5-min cache-write rates
(**$3.48** at 1-h rates); ₩2–₩100 per request at an **assumed** ₩1,400/USD. Every Sonnet 5.5
attempt (55 across all cohorts) is `unpriced` in the cost ledger. [PROBE]

Measurement defects found while building this table (fixed in §8a/§8b): no `created_at` on
grants; owner console labels internal probes as `pass` (66 of 67 records), never `test`; no
trial → order link; owner usage needs SSO, so agents can only reproduce it in SQL (intended);
no Lab page-view analytics ever collected; no first-artifact record, and trial grants cannot
write trace events (r2-5).

## 3. Problem map

Ranking: **score = reach × severity**. Severity is the Nielsen 0–4 scale used in P1, cross-checked
by a second blind rater (§0). Reach: **4** every prospective user · **3** every trial user ·
**2** a subset at one moment (buyers, end of trial on one path, mobile) · **1** edge case.
"Pre-open" means the problem only bites once the open trial ships, but must be fixed before it
does. Restructured after r1-5: A4 split into A4a/A4b; U1, D1 and D2 merged into one end-state
row (D1/D2 kept as sub-IDs because fixes cite them); A5, A6, D10 added. Round 2 added I7–I11
(r2-4 install walk), C8 (r2-2) and U6 (r2-5), re-stated I4's cause, and re-ranked.

| Rank | ID | Area | Problem | Sev | Reach | Score | Friction | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | A1 | Access | No self-serve entry: web offers only a mailto ("현재 공개 체험 코드의 자동 발급은 제공하지 않습니다."); app says "지금은 발급받은 체험 코드가 필요합니다." / "공개 가입은 아직 지원하지 않습니다."; no operator tool to mint | 4 | 4 | 16 | was intended (US-04 P1), **accidental** under decision 1 | W-01, P1-07, P0-1, F3, H-01 |
| 1 | I1 | Install | Every install path fails for a no-code non-member: kit needs a code; `install.sh` pulls from the private `hypeproof-studio-releases` (anon 404); the public mac and win zips (`/api/download/mac` → v2026.1017.0) vendor the SDK **JS** but contain **no native `claude` binary**, and nothing in the app fetches it [OBS r1-0] | 4 | 4 | 16 | accidental | W-02, P4-04, r1-0 |
| 3 | U1 | End state (incl. D1, D2) | The trial ends in an error, not an offer. **U1** no conversion path: `passSpentNotice` never matches the trial sentence; `paidPassEndNotice` needs `profile.pass`; start page says "코드 발급 담당자에게 새 체험을 요청해 주세요." **D1** raw SDK English in the coach bubble: "API Error: Request rejected (429) · …", "Failed to authenticate. API Error: 403 …", "Claude Code returned an error result: …", with futile "다시 한 번 부탁…" and 🚨 신고하기. **D2** expiry titled "🔌 연결이 끊겼어요" because the `isConn` regex matches `시간` | 4 | 3 | 12 | accidental | P1-01, P1-03, P1-04, H-03, H-04 |
| 3 | C4 | Cost (pre-open) | Attempt cap does not bound money: Opus allowed, effort to `high`, `web_search` on, no currency ceiling, no global cap | 4 | 3 | 12 | n/a (control missing) | P4-01, P0-7, P1-11 |
| 3 | A4b | Access | Discovery: trial page `noindex, nofollow`, not in the sitemap; trial CTA last on the product page and labelled "준비 중" | 3 | 4 | 12 | accidental | W-05 |
| 3 | A5 | Access | The only request path is a mailto with no confirmation and no stated response time ("직접 전송하기 전에는 문의가 접수되지 않습니다.") | 3 | 4 | 12 | accidental (interim until open entry) | H-19 |
| 3 | I3 | Install | The only non-member installer `/studio/install` is linked only from `checkout/done`; the trial page links the member `/install` and `/download`, whose "설치 시작" copies a `gh` command and only then says "현재 설치 파일은 비공개입니다" | 3 | 4 | 12 | accidental | W-03, H-11 |
| 3 | I4 | Install | Non-developer burden. Cause (r2-4): the kit runs the **member toolchain installer** for a trial user. Fresh Mac: ~13 actions and 3 prompts before the app (code, English "Homebrew not found. Install it now (also triggers Xcode CLT)? [Y/n]", "Mac 암호:"), Homebrew + CLT + gh + node@22 + python@3.11, all fail-closed, ~10 min; answering n or a non-admin account dead-ends. Windows: ~11 actions, 1 certain prompt plus 0–k UAC; `-ExecutionPolicy Bypass` ×3. Only the app and the SDK binary are needed to chat (bundled skills not audited). Raw-download path adds a 4-step Gatekeeper bypass | 3 | 4 | 12 | accidental | W-06, H-13, r2-4 §2 |
| 3 | L1 | Learning value | No human has done the trial (T25 NOT_RUN); all suites are green while U1, I2 exist | 3 | 4 | 12 | evidence gap | ctx-trial §4, P1-app §5 |
| 10 | C1 | Clock | The 1 h clock starts at "코드 확인하기" (`/v1/profile` → `startNativeGrant`), before "이 활동 시작하기"; never disclosed | 3 | 3 | 9 | accidental | P1-05, P0-9, P4-06, H-06 |
| 10 | C2 | Allowance | No allowance visible: no time/requests left; an exhausted trial reopens as a normal "이어서 하기" card | 3 | 3 | 9 | accidental | P1-06, H-05 |
| 10 | U2 | Upgrade | No trial → paid path on the web; no subscription product ("구독은 준비하고 있어요.") | 3 | 3 | 9 | accidental vs decision 2 | W-04, P4-11 |
| 10 | U5 | Measurement | Conversion unmeasurable: no trial → order link, no grant timestamps, purpose inferred from `duration_ms` (`isPassGrant` = `duration_ms > 1 h`, so any free window over 1 h is treated as a pass) | 3 | 3 | 9 | accidental | P0-2, P0-4, P0-8, r1-2 |
| 10 | C5 | Cost | No approved Sonnet 5.5 / Opus / FX price revision; Sonnet 5.5 cache-read price conflict ($0.10 vs $0.20) | 3 | 3 | 9 | n/a | P0-6, P4-07 |
| 10 | A3 | Access (pre-open) | KV roster is one value per cohort with documented write races; unfit as the allowlist for thousands of open seats (`claimSeat` and the new account `activatePass` both write it) | 3 | 3 | 9 | accidental | P4-05, r1-2 |
| 10 | I5 | Install | No updates without a member GitHub login. The release mirror is **private** (anonymous 404), so removing the client token gate alone would still 404. Automatic check fails with **no UI**; manual check says "업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해주세요. 비공개 릴리스 접근 권한이 필요합니다. GitHub CLI에서 gh auth login을 실행하거나 HPS_RELEASE_TOKEN을 설정한 뒤 Studio를 다시 시작해 주세요." [OBS r1-4] | 3 | 3 | 9 | accidental | ctx-trial §5.7, r1-4 |
| 17 | I2 | Install | Missing native binary on a trial seat. Default case: the App falls back to the proxy, the Service answers 409 `trial_requires_sdk` ("이 체험은 최신 Studio에서 실행해 주세요."), and the client **discards** that sentence and shows "문제가 발생했습니다. 다시 시도하거나 운영 담당자에게 문의해 주세요." on every turn, plus once "만들기와 미리보기는 그대로 되지만… 스태프를 불러주세요". After picking a model: "…Studio의 Agent SDK 설치를 확인하거나 강사에게 알려주세요." After picking a pass: the raw developer string "agent-sdk runtime selected but no claude CLI binary is available (set hypeproofChat.sdkBinaryPath or run scripts/seed-sdk-binary.sh)…" None gives an install path [CODE shipped bundle; screen not observed] | 4 | 2 | 8 | accidental | P1-02, r1-0, H-07 |
| 17 | A2 | Access (legal) | Minors: trial/pass cohort is adult (`age_range [19,99]`) so no moderation runs; public pass purchase already reaches it; open trial widens the gap; web never states an age rule | 4 | 2 | 8 | gating intended, silence accidental | P4-02, P4-03, W-12 |
| 17 | A6 | Access | "AI 체험하기" reveals the code requirement only after it is chosen; the card says only "참여 코드에 연결된 활동과 이용 조건이 적용됩니다." | 2 | 4 | 8 | accidental (interim) | H-02 |
| 17 | I7 | Install | The Mac installer reports success when the SDK seed fails: `seed_sdk` and `hps doctor` only warn ("SDK: not seeded (Studio self-heals on first launch)"), but the extension has no downloader (only a "future in-app downloader" comment at `sdkCoachHelpers.ts:562`). The install ends "설치를 마쳤습니다" and the trial dead-ends on screen 13 (I2). `install.ps1` fails closed on the same condition | 4 | 2 | 8 | accidental | r2-4 M12–M13 [CODE] |
| 17 | U6 | Measurement | The Lab has never collected page-view analytics in production (GA ids unset at build), and no table records a first artifact; `/v1/trace/event` refuses trial grants (no cohort session). The cookie banner claims analytics cookies that are never set | 2 | 4 | 8 | accidental | r2-5 §1, §4 [PROBE+CODE] |
| 17 | D10 | Design | Four visual identities across Lab (zinc + purple) → `/download` (emerald) / `/install` (blue) → App start page (lime on deep green) → chat (stock VS Code grey, blue "Send"). The brand stops at the chat door | 2 | 4 | 8 | open question (§10, D21) | r1-5 impeccable critique |
| 23 | C3 | Allowance | 40 **attempts**: each SDK tool step and each failed provider call counts (5 turns → 10 requests [DOC]) | 2 | 3 | 6 | failure charging intended (cost); attempt unit accidental | P4-06, P0-10 |
| 23 | C7 | Allowance | 9-model picker incl. five Opus models shown to non-developers | 2 | 3 | 6 | accidental | P1-11 |
| 23 | U3 | Upgrade | "AI 요청 N번" undefined; trial allowance never shown, not even before code entry; trial not framed as the step before a pass | 2 | 3 | 6 | accidental | P1-10, H-18 |
| 23 | D6 | Copy | Trial page leads with 6+ restrictions and no allowance; mobile CTA at 1,376 px on a 664 px viewport | 2 | 3 | 6 | **intended** honesty, accidental order | W-11 |
| 23 | L2 | Learning value | Activation undefined; "first message" is not activation per PRODUCT-INTENT | 2 | 3 | 6 | n/a | P4 §7.1 |
| 23 | I8 | Install | Both raw downloads are unsigned or self-signed: Mac "HypeProof Studio Local Signing", `TeamIdentifier=not set`, not notarized (macOS 15: System Settings → Open Anyway + password); Windows UserSetup exe has no Authenticode signature (SmartScreen). Only the kit path avoids this, and the kit needs a code | 3 | 2 | 6 | accidental | r2-4 §2c [OBS] |
| 23 | I9 | Install | The middle of the install is English: 8 step headers on Mac, 9 on Windows, the Homebrew Y/n consent, the WSL "[y/N]" prompt and the doctor result, contrary to the Korean student-copy rule | 2 | 3 | 6 | accidental | r2-4 M6–M13, W7–W13 [CODE] |
| 23 | I10 | Install | Lab install copy does not match the kit: "아래 세 줄" for a 6-line block; "수업 참여 코드 칸" vs the trial branch's "체험 참여 코드"; Spotlight (page) vs Finder (`PUBLIC_MAC_STEPS`); a '"PC 보호" 창' warning the kit path never produces. The code is typed twice (terminal, then app) and echoed in clear text (`read -r`, `Read-Host`) while the page says "코드는 다른 사람에게 보여 주지 마세요" | 2 | 3 | 6 | accidental | r2-4 §4 items 3–4 [CODE] |
| 23 | C8 | Cost | Conversation cache miss: in the only real SDK session every coach request reads exactly the 20,064-token system prefix while cache writes grow 967 → 9,153, so the conversation is re-written at 1.25× instead of read at 0.1× (+32% at 5 turns; ≈ −40% at 10 turns if fixed). Affects passes too. Cause (Service vs Agent SDK breakpoints) not traced | 2 | 3 | 6 | accidental | r2-2 [PROBE, n = 1] |
| 23 | L3 | Learning value | 1 h / 40 attempts may end before a result plus a judgment turn (~10–20 turns [INFERRED]) | 2 | 3 | 6 | bound intended, size untested | ctx-trial §3, P4 E1/E2 |
| 33 | A4a | Access | `/studio` is a bare English 404 ("This page could not be found.") whose `<title>` still reads "HypeProof AI — 교육자를 위한 AI 제품" (WCAG 2.4.2) | 1 | 4 | 4 | accidental | W-05, H-12 |
| 33 | D3 | Copy | Classroom/operator vocabulary in a solo trial: 스태프, 운영 담당자, 강사; "Jay" in hover titles | 2 | 2 | 4 | accidental | P1-09 |
| 33 | D4 | Copy | Web ↔ app drift: Start/Plus/Max vs 라이트/기본/넉넉; the code has five names (체험 코드, 체험 참여 코드, 참여 코드, 수업 참여 코드, 토큰); done page names "수업 확인하기"/"수업 시작하기" (app: "코드 확인하기"/"이 활동 시작하기"); "토큰까지 넣었으면" | 2 | 2 | 4 | accidental | W-08, W-09, H-09, H-10 |
| 33 | D5 | Copy | Pricing omits device requirements and the 200/350/700 request unit | 2 | 2 | 4 | accidental | W-07 |
| 33 | D7 | Copy | Translucent cookie banner covers trial copy and the first pricing CTA on mobile. Cause: the opaque variant is whitelisted only for `/identity` and the product page, so every funnel page gets the 4%-white `.glass` banner (`CookieConsent.tsx:71-72`, `globals.css:67-71`); it likely also obscures focus (WCAG 2.4.11) | 2 | 2 | 4 | accidental | W-13, H-14, r1-5 |
| 33 | D8 | Accessibility | Serious contrast on `/download` (12 nodes), `/install` (4), `/studio/pricing` (5), `/studio/install` (2), 404 (2); install `<code>` blocks not keyboard-scrollable (2.1.1); cookie preference toggles have no accessible name and no `aria-pressed`/`role="switch"` (4.1.2) [CODE]; `/download` "복사됨 ✓" not in a live region (4.1.3) [CODE]; the same copy action is labelled "명령 복사" / "복사" / "설치 시작" (3.2.4) | 2 | 2 | 4 | accidental | W-14, r1-5 §3 |
| 33 | I6 | Install | `/download` stale: "워크숍 참가자용", private prerequisite shown after the click, `jayleekr/` link, duplicated Windows fallback | 2 | 2 | 4 | accidental | W-10 |
| 33 | U4 | Upgrade | Upgrade keeps files but starts a new conversation (REQ-L12 ⑫) | 2 | 2 | 4 | accidental | P4-10 |
| 33 | D9 | Copy | English chrome: "Send", "GET STARTED", "MAKE · VERIFY · OWN" | 1 | 4 | 4 | accidental | P1-12, H-15 |
| 42 | C6 | Allowance | `trial_busy` without a bounded SDK busy policy: 11 retries in 186 s ending in raw text (lease held throughout; production likelihood INFERRED) | 2 | 1 | 2 | accidental | P1-08, H-08 |
| 42 | I11 | Install | Windows `Ensure-PosixShell` checks only `C:\Program Files\Git\bin\bash.exe` (`install.ps1:684`); a user-scope Git can push the user into the English "Install Ubuntu on WSL…? [y/N]" prompt (admin + reboot), and the doctor passes anyway on the inbox `wsl.exe` stub | 2 | 1 | 2 | accidental | r2-4 W9 [CODE + INFERRED; winget scope unverified] |
| 44 | — | low | 19 px text buttons (2.5.8 not established), `/studio/checkout` with no order, EN toggle chrome-only, owner usage needs SSO (intended), code field looks cleared while checking (security tradeoff, H-16), "~/HypeProofTrial" shell path (H-17), chat placeholder 3.0:1 and missing-SDK warning 4.4:1 [pixel estimate, harness theme only] | 1 | 1–2 | ≤2 | mixed | P1-13, W-15, W-16, P0-5, r1-5 |

### Themes (prevalence across the inputs)

| Theme | Problems | Inputs reporting it | Interpretation |
|---|---|---|---|
| The gate is everywhere | A1, I1, I3, A4b, A5, A6 | 5 of 5 (incl. second rater) | The code is enforced at web, install and app layers; each needs its own fix |
| The ends are broken | U1 (D1, D2), C2, I2, I5 | app, design, raw zip, update probe, second rater | Every terminal state fails "what happened / what to do next"; peak-end lands on failure |
| Cost has no ceiling | C4, C5, C7, C3, C8 | funnel, app, design, unit economics | Money is bounded only by attempts, which does not bound money; the cache miss inflates every session |
| Nothing is measured | U5, U6, L1, L2 | funnel, app, design, read-only source survey | Conversion cannot be reported even after launch; the top (page views) and the activation point (first artifact) were never recorded |
| Copy and identity drift between surfaces | D3–D10, I6, I9, I10, A4a | web, app, second rater, install walk | No shared terminology table or token source between Lab and App |
| Distribution assumes membership | I1, I2, I4, I5, I7, I8, I11 | raw zip, update probe, install walk | Binary, installer, toolchain and updates all come from member-only sources; only the code-gated kit avoids unsigned-binary friction |

## 4. Accidental vs intended friction

Every recommendation was filtered through `docs/PRODUCT-INTENT.md` (plan §P2 filter rule).

**Intended — keep (explain better at most):**

| Friction | Principle | Note |
|---|---|---|
| Approval modals for write/shell (TUX-HOST-02/03/04), one question at a time (NAT-03) | Human judgment stays visible | Not a conversion lever; do not A/B; onboarding "skip steps" advice does not apply |
| A bounded allowance | INT-ACCESS | The defect is that it is invisible and has no exit (C2, U1), not that it exists |
| Failed provider attempts still cost (`native-trial-grants.ts:158`) | cost honesty | Keep charging **cost**; stop consuming a user **turn** (P4 §3.4) |
| Honest limits on the trial page; "자동으로 다시 결제되지 않아요"; refund wording | Evidence over claims, INT-ACCESS | Reorder (allowance first), do not delete |
| Trial page step "AI가 제안한 작업과 권한을 확인하고, 만든 파일을 직접 열어봅니다." | Human judgment stays visible | Keep |
| Age gating of minors until legal decides | US-04 P1 | The *silence* about it is accidental (W-12) |
| Owner usage behind SSO (P0-5) | security | Keep; agents reproduce the query read-only |
| Code gate for classes ("수업에 참여하기") | classroom control | Unchanged by the open trial |
| Masked code field that clears while checking (H-16) | secret hygiene | Keep masking; at most show a pending label |

**Accidental — fix:** everything else in §3. Growth advice rejected by the filter: auto-opening a
paywall at the limit (REQ-L12 ①), countdown timers, locked-model teasers during work,
pre-selected higher tiers, confirmshaming escapes, removing approvals to speed activation.

## 5. Verdict: is the issued code the MAIN barrier?

**Answer: it is the first and total barrier, by construction — not by measurement. It is not
sufficient: removing it alone would hand users a trial that cannot install, cannot run on the
public download, never updates, burns its clock before work starts, ends in an error, and has no
cost bound.**

Evidence for "first and total":
- Real users at every stage = 0; no real person has held a trial grant [PROBE P0-1]. The code's
  effect is "the trial was never offered", not "people tried and bounced".
- It is enforced at three independent layers: web (mailto only, W-01), install (kit 401
  `code_required`, W-02), app (StartPage dead end, P1-07). Reach 100% of no-code visitors.
- The only self-serve route anywhere is **paying** ₩33,000+ (W-01, W-04).

Evidence against "main" in the sense of "fix this and the trial works":
- **I1 (sev 4) [OBS]:** the public mac and win zips carry no native SDK binary and the App has no
  downloader; `install.sh` pulls from a private releases repo [PROBE].
- **I2 (sev 4) [CODE on the shipped bundle]:** on those zips every trial turn ends in a generic
  "운영 담당자에게 문의" error; the Service's own "최신 Studio" sentence is discarded.
- **U1 (sev 4, both raters):** at the limit or expiry there is no buy action, the copy is raw
  English or a false "연결이 끊겼어요", and the start page points to a code issuer [OBS].
  Decision 2 (convert) fails here even with a perfect entry.
- **C4 (sev 4, pre-open):** opening entry on today's profile exposes Opus with no money bound.
- **I5 (sev 3) [OBS]:** a non-member never receives an update and is not told.
- **I4/I7 (sev 3/4) [CODE, r2-4]:** even the with-code kit is a member toolchain install
  (~13 actions, an English Homebrew consent and a password on a fresh Mac), and on Mac a failed
  SDK seed still reports success and ends on the I2 screen.
- **C1/C2 (sev 3):** the hour starts at verification and the allowance is invisible [OBS].
- All of the Service behaviors above hold in production: prod runs `133baa5`, whose trial-gate
  code is identical to the observed `a08cf7a` (r1-3, re-checked).
- Unfalsifiable from prod: n = 0 at every stage, so no comparison of drop-off between the code
  step and later steps is possible. Only an instrumented launch (§8b Phase 2 funnel events) can
  answer "main" quantitatively.

Implication: Jay's decision 1 is correct and necessary. The work order is
**independent fixes (§8a) + cost guardrails (Phase 1) before open entry (Phase 2)**, with the
conversion surface (Phase 3) shipped before the open trial is announced. Which trust event opens
entry is a separate decision (§6).

## 6. Access options (plan P4 A/B/C) — what replaces the code

Full comparison: design §2A (inserted by r2-0 from the r1-2 draft). Summary:

| | A. Account (Google) → free entitlement | B. Email OTP → roster + mint | C. Anonymous device grant | C′. Design §3 (C + per-install claim, ≤ 5 per /24 per 24 h, daily cap, app-version floor) |
|---|---|---|---|---|
| State of code | Service #99/#124 merged on `origin/main` 2026-10-18, **default-off** (`HPS_ACCOUNTS`…), migration 0047, not deployed [CODE]; Studio #1702 unmerged [CODE refs]; Lab #1258 unknown | No transactional email in prod; the Resend adapter has never sent a message [CODE] | Mint triple exists | Mint triple exists |
| Cost to drain a ₩100k–₩300k daily cap | ≈ 36–108 Google accounts per day | ≈ 36–108 accepted mailboxes | One script, minutes | 8–22 distinct /24s [INFERRED] |
| Friction before first value [INFERRED] | ~6–7 actions + one App↔browser switch; no entry without a Google account | ~7–9 actions + mail switch + wait | ~3 actions | ~3 actions |
| Trial → order link | Native (`account_id` on both), survives web checkout and a second device | Only if the same email is retyped | Only via an App-relayed `trial_id`; lost on web checkout | Same as C |
| PII / consent machinery | Built: consents incl. overseas transfer, export, delete, 14+ gate [CODE] | New store, nothing built | Hashes only; PII status open | Same as C |
| US-04 "본인 자격과 발급 이력" | Met | Partly | Conflicts | Conflicts |

Corrections the comparison depends on:
- The plan's "₩0 product → `claimSeat`" does not work: `parseProduct` rejects `amount < 100`
  (one bad product disables all purchasing), and on Service main account-owned orders use
  `activatePass`, not `claimSeat` [CODE, re-checked]. Option A needs a **free-entitlement** row
  ("1 per `(provider, subject)`, ever"), not a ₩0 SKU.
- The design's §5.3 capacity column is off: at ₩2,100 per trial, ₩100k / ₩300k / ₩1M =
  **47 / 142 / 476** trials (not 55 / 165 / 550); with one-request overshoot (₩2,775),
  **36 / 108 / 360**. Design §5.3 now carries these figures (r2-0).
- Money is bounded by the same per-trial ceiling and daily cap under every option. The trust
  event decides only how cheaply a stranger can **use up** the day's cap and lock real users out.

**Recommendation (for Jay, D15):** make **A** the public entry; run **B only as a second sign-in
provider inside A**; keep C′'s install and network counters as secondary rate limits. A meets
both decisions (sign-in is not an issued code; it is the only option that links trial to order
across devices), most of it is already built, and it is the only option where draining the free
budget costs more than a script. Its costs: launch waits for the account launch gates (Google
provider acceptance, legal review of consent wording, #1702 merged and released, migration 0047
in prod), and about 3–4 more actions plus a browser switch before first value — unmeasured;
measure it in T25. Choose **C′ as an interim** only if the trial must go live before accounts,
accepting that the daily cap is the real control, a script can close the trial for a day, and
conversion is measurable only for in-App purchases (D17); plan its sunset when A launches.

Cross-cutting: `isPassGrant` = `duration_ms > 1 h`, so a free window longer than one hour (the
E2 24 h arm) is classified as a pass (240 s timeout, pass wording, owner console split) under
any option. Grants need an explicit purpose/kind (folded into `svc-grant-purpose-timestamps`).

### 6a. Unit economics of the proposed free tier (r2-2; full table in design §5.4)

Inputs: the 67 production usage rows repriced at Sonnet 5.5 ($2 / $10, cache read $0.10–0.20)
and Haiku 5.5; FX placeholder ₩1,400/USD (no `fx` revision exists; ₩1,350–1,450 tested); the
proposed tier from the design (10 turns, Sonnet + Haiku 5.5, $1.50 ceiling, reserve ≈ $0.48);
라이트 pass ₩33,000 incl. VAT → ₩30,000 net, contribution ₩23,800 (Sonnet) / ₩17,600 (Opus-class),
Toss fee unknown.

| Scenario (10 turns used) | ₩ per trial | Break-even share buying 라이트 | Trials per day at ₩100k / ₩300k / ₩1M |
|---|---|---|---|
| Low (2 requests/turn, flat) | 616–655 | 2.6% / 3.5% | 162 / 487 / 1,623 |
| **Central (growth-fitted real session)** | **954–1,027** | **4.0% / 5.4%** | **104 / 314 / 1,048** |
| Central, cache miss fixed (C8) | 559–650 | 2.3% / 3.2% | 178 / 536 / 1,789 |
| Every trial at the ceiling | 2,100 | 8.8% / 11.9% | 47 / 142 / 476 |
| Ceiling + one-request overshoot | 2,775 | 11.7% / 15.8% | 36 / 108 / 360 |

- Attempts per turn: 2.0 [DOC], 3.0 in the only real App SDK session, 3.8 in a heavy pass
  session [INFERRED grouping]. This is why `svc-turn-allowance` counts turns, not attempts.
- The ceiling binds only heavy or abusive use; central use is about half of $1.50.
- Caveats: n = 1 real Sonnet 5.5 session, all users internal, turns-used distribution unmeasured
  (full use is the planning number), 5-minute cache writes assumed. Recompute on the first 2–4
  weeks of open-trial `usage_log`.

## 7. Segments

| Segment | Characteristics | Needs | Size |
|---|---|---|---|
| Adult non-developer, no code | Arrives from Lab home/product page | One entry, a code-free installer that includes the binary, a visible allowance, updates, a next step at the end | unknown (no analytics); 100% of today's prospects |
| Adult with a code (internal/partner) | Operator-issued | Clock that starts at work; honest end states | 14 internal grants to date |
| Pass buyer | Pays on web or in app | Device requirements and unit before paying; consistent names; working install; no raw developer error if installed from the zip | 3 paid orders, origin mostly internal |
| Parent / minor | Arrives via `/kids-edu` or the child story | An age rule, a guardian path | unknown; legally gated |

## 8. Fix list

Every item is sized for one PR with tests. Studio PRs that change behavior update
`docs/studio-requirements.md` / the cited requirement doc in the same PR (repo rule).
Service flags follow the existing `HPS_<NAME> === 'enabled'` convention (default off).
Studio surfaces for the open trial render only when the Service advertises them (the same
pattern as `purchase?.available` at `StartPage.tsx:120`), so the Service flag is the switch.
Service PRs target `origin/main` `2cf66dc`, which already contains the default-off account
system; every Service fix reaches users only through a pin bump and deploy (prod is `133baa5`).

### 8a. Independent fixes (valid under any access model)

| ID | Repo | Fix | Addresses | Flag | Decision |
|---|---|---|---|---|---|
| ind-trial-end-notice | studio | Trial-aware end notices: match the trial sentences/codes for exhausted and expired, point to "이용권으로 시작하기" when the Service sells passes (never auto-open); replace the code-issuer copy at `proxyClientHelpers.ts:154` | U1 | no | no |
| ind-banner-expiry-state | studio | `errorBannerPresentation`: trial expiry/exhaustion are account states, not 🔌 | U1 (D2) | no | no |
| ind-sdk-error-text | studio | Drop `<synthetic>` CLI error text from the coach bubble; map known Service codes to Korean; strip "Claude Code returned an error result:" from the banner; show the sentence once | U1 (D1) | no | no |
| ind-missing-sdk-error | studio | Missing binary on an SDK-only seat: no proxy fallback; one actionable install message for all three branches (default 409, model picked, pass picked); `classifyError` keeps the Service's 409 `trial_requires_sdk` sentence; `SdkUnavailableError` never reaches the user as English; no "스태프"/"강사" for solo seats; no false degraded notice | I2 | no | no |
| ind-trial-busy-policy | studio | Attach the bounded SDK busy policy (`SDK_BUSY_*`) to native trial seats | C6 | no | no |
| ind-trial-vocabulary | studio | Replace classroom/operator words for trial/pass seats; "Send" → Korean; remove "Jay" from titles | D3, D9 | no | no |
| ind-trial-card-disclosure | studio | Until open entry ships, the "AI 체험하기" card says before selection that a code is needed and what the allowance is | A6, U3 | no | no |
| ind-update-check-copy | studio | Non-member update failure: no `gh auth login` / `HPS_RELEASE_TOKEN` instruction, no "잠시 후 다시 시도" for a permanent access failure; automatic check surfaces a passive "새 버전은 홈페이지에서 받을 수 있어요" line once instead of failing silently | I5 | no | no |
| svc-profile-trial-status | service | Add a `trial` status block (`ends_at`, `request_limit`, `requests_used`, `state`) to `/v1/profile` for non-pass native grants | C2, U3 | no (additive) | no |
| ind-trial-status-ui | studio | Show the allowance on the candidate card and a passive remaining line in the chat header; exhausted/expired start card instead of "이어서 하기" | C2, U3 | no | no |
| svc-clock-first-message | service | Start the grant at the first admitted `/v1/messages` reservation; `/v1/profile` and `/v1/activity` read without starting | C1 | `HPS_TRIAL_CLOCK_AT_MESSAGE` | no |
| svc-grant-purpose-timestamps | service | `native_trials.created_at` + explicit `purpose` (`trial`/`pass`/`test`/`internal`) set at mint; owner usage and `isPassGrant` use it instead of `duration_ms` | U5 | no (migration) | no |
| studio-public-sdk-seed | studio | Release workflow publishes the per-platform native binary seed as a public release asset with a sha256, beside the public zips (which already vendor the SDK JS); `verify-branding.sh` still forbids it inside the app bundle | I1, I2 | no | no |
| studio-sdk-seed-on-demand | studio | When no binary is found, offer to fetch the public seed into extension storage (sha256 verified) instead of failing | I1, I2 | setting, default off | no |
| studio-public-update-path | studio | Without a member credential, check a **public** feed (the public release the Lab download already serves, or a Service/Lab proxy) — not the private mirror, which 404s anonymously | I5 | setting, default off | **yes (D19 channel)** |
| lab-install-links | lab | Route every non-member "설치 안내" link to `/studio/install`; fix `/download` meta, owner link, duplicate fallback; `/studio/checkout` no-order link | I3, I6, W-15 | no | no |
| lab-studio-landing | lab | `/studio` becomes a Korean landing/redirect; Korean 404 with nav and a "not found" `<title>` | A4a | no | no |
| lab-pricing-clarity | lab | Pricing states device requirements and 200/350/700 requests; pass names follow the Service labels | D5, D4 | no | no |
| lab-terminology | lab | Done/download copy uses the App's labels ("코드 확인하기", "이 활동 시작하기"); one name for the code; drop "토큰" | D4 | no | no |
| lab-trial-page-order | lab | Trial page: allowance first, limits second, CTA in the first mobile screen | D6, A4b | no | no |
| lab-banner-a11y | lab | Cookie consent: opaque banner on `/studio/*`, `/download`, `/install`; named toggles with `aria-pressed`/`role="switch"`; banner does not obscure focused content; honour reduced motion | D7, D8 | no | no |
| lab-install-a11y | lab | Install pages: serious contrast fixed; `tabindex="0"` on command blocks; `/download` copy status in a live region; one label for the copy action | D8 | no | no |
| lab-trial-request-ack | lab | Until open entry ships, the request path confirms receipt and states a response time | A5 | no | **yes (D20 mailbox, response time)** |
| svc-price-revisions | service | Approve Sonnet 5.5, Haiku 5.5 and Opus price revisions and an FX revision | C5 | — | **yes (pricing)** |
| lab-age-statement | lab | One sentence on trial/pricing about who may use them, linking parents to classes | A2 | — | **yes (legal)** |
| studio-installer-seed-fail-closed | studio | Mac `install.sh`: a missing or failed SDK seed fails the doctor like `install.ps1` does, with a Korean stop message and the recovery command; drop the false "self-heals on first launch" text until an in-app fetch exists | I7, I2 | no | no |
| studio-installer-korean | studio | Student-facing installer output in Korean on both platforms: the Homebrew consent, the WSL prompt, step headers, the doctor verdict and the done line; tool output itself unchanged | I9 | no | no |
| studio-trial-install-profile | studio | Kit mode for trial/pass installs only what the chat needs (app + SDK seed); member toolchain (Homebrew/CLT, gh, node, python, winget extras) stays for class kits | I4 | no | **yes (D22 toolchain)** |
| studio-win-posix-shell-detect | studio | `Ensure-PosixShell` also finds a user-scope Git; the doctor does not count the inbox `wsl.exe` stub as a shell | I11 | no | no |
| lab-install-kit-copy | lab | `/studio/install` copy matches the kit (line count, the start-page branch name, one Terminal instruction, no SmartScreen warning on the kit path); the kit scripts read the code masked | I10 | no | no |
| studio-release-signing | studio | Developer ID signing + notarization for the public Mac zip, Authenticode for the Windows exe, or route every non-member to the kit and stop linking raw binaries | I8 | — | **yes (D23)** |
| svc-conversation-cache | service | Trace and fix the conversation cache miss on SDK requests (Service `cache_control` handling vs Agent SDK breakpoints); fix lands in whichever repo owns the cause | C8 | no | no |
| lab-funnel-analytics | lab | Page-view counting on `/studio/*`, `/download`, `/install` with a consent model legal accepts; until then the cookie banner stops claiming analytics cookies | U6 | provider env vars | **yes (D24)** |

### 8b. Open trial → subscription (from the P4 design, phased)

Order matters: **Phase 1 ships before Phase 2** (P4 §9). Phases 1–3 convert to the existing
30-day passes; Phase 4 adds a recurring plan. Phase 2 has two variants depending on D15: the
account path (A, recommended) or the anonymous claim (C′, interim). Items specific to one
variant are marked.

| Phase | ID | Repo | Fix | Flag | Decision |
|---|---|---|---|---|---|
| 1 cost | ot-open-profile | service | `studio-open-trial` profile + cohort: Sonnet 5.5 + Haiku 5.5 only, effort ≤ medium, no `web_search`, same `workspace_root` as passes, `dashboard_hidden` | unreachable until entry | no |
| 1 cost | ot-cost-ceiling | service | Per-grant `cost_ceiling_micro` with reserve-then-settle; overshoot ≤ 1 request (AB-19) | `HPS_TRIAL_COST_CEILING` | no (numbers set at launch) |
| 1 cost | ot-daily-cap | service | Global daily free-tier ceiling trips cohort pause; auto-resume 00:00 KST (AB-20) | `HPS_OPEN_TRIAL_DAILY_CAP` | no |
| 1 cost | ot-moderation-always | service | Profile field `moderation: 'always'` honored by the inbound screen (REQ-O8) | profile field | no |
| 1 cost | svc-turn-allowance | service | Count user turns via `x-hps-turn-id` with a hidden per-turn attempt guard; failed provider calls cost money but not a turn (NAT-11, MU-04) | `HPS_TRIAL_TURN_ALLOWANCE` | no |
| 1 cost | studio-turn-id | studio | App sends `x-hps-turn-id` per user message on SDK and proxy paths | header only | no |
| 2 entry (any) | ot-grant-allowlist | service | Server-trusted grants (`purchase`, `open-trial`, account entitlements) skip the KV roster; operator seats keep it (NAT-02); needs Service owner security review | `HPS_GRANT_ALLOWLIST` | no |
| 2 entry (A) | ot-account-free-entitlement | service | Free entitlement on an account: one per `(provider, subject)` ever, minted like `activatePass` into the open-trial cohort; hash kept after account deletion | `HPS_OPEN_TRIAL` + `HPS_ACCOUNTS` | **yes (D15, D18)** |
| 2 entry (A) | ot-studio-account-entry | studio | "AI 체험하기" → device sign-in (#1702) → free entitlement → preview → start; under-14 refusal copy from #1702 | follows Service offer | **yes (D15; needs #1702)** |
| 2 entry (C′) | ot-claim-endpoint | service | `POST /v1/trial/claim`: idempotent per install, install/network/global limits, mints `owner_id='open-trial'` (US-19). Under A, its counters become rate limits | `HPS_OPEN_TRIAL` | **yes (D15/D17)** |
| 2 entry (C′) | ot-studio-claim-client | studio | `install_id` in SecretStorage; claim client; code stored, never shown or sent to the webview | follows Service offer | **yes (D15/D17)** |
| 2 entry (C′) | ot-studio-zero-gate | studio | "AI 체험하기" zero-gate path with the age question; no code field; paused copy (TUX-SP-11) | follows Service offer | **yes (D15/D17)** |
| 2 entry (any) | lab-open-install-kit | lab | Kit route serves a code-free kit that installs from public assets | `STUDIO_OPEN_INSTALL` | no |
| 2 entry (any) | lab-open-trial-page | lab | `/studio/trial` becomes the open-trial landing (indexable, sitemap, one CTA to `/studio/install`) | `STUDIO_OPEN_TRIAL` | no |
| 2 entry (any) | ot-funnel-events | service | Funnel events keyed by a hash of the account id (A) or grant id (C′): entry outcome, first message, first tool result (first artifact), limit near/reached; derived activation (§7.1 of P4). Needs a grant-scoped event route: `/v1/trace/event` refuses trial grants (403 `session_inactive`, r2-5) | with `HPS_OPEN_TRIAL` | no |
| 2 entry (any) | studio-funnel-events | studio | App events via the grant-scoped route from ot-funnel-events (not the session-only `/v1/trace/event`): entry viewed, age answered, sign-in started/completed (A), tool result kind, offer viewed/clicked/dismissed | follows Service offer | no |
| 2 entry | ot-legal-open-access | service | Privacy/overseas-transfer notice, REQ-O6 rewrite (passes now, D16), US-04 rewrite if C′, under-14 rule, outbound-moderation decision | — | **yes (legal)** |
| 2 entry | ot-launch-enable | service | Turn the flags on in production with owner-set ceilings | — | **yes (D15 + pricing + legal sign-off)** |
| 3 conversion | ot-end-card | studio | Inline end-of-trial card: facts, one Primary "이용권 살펴보기", escape "오늘은 여기까지"; price/unit from the Service; never auto-open (TUX-COND-07) | follows Service offer | no |
| 3 conversion (C′) | ot-order-trial-link | service | Nullable `purchase_orders.trial_id`; App sends it on order creation. Redundant under A (`account_id` links both) | with `HPS_OPEN_TRIAL` | **yes (only if C′)** |
| 3 conversion | ot-conversation-carryover | studio | Explicit, user-confirmed "체험에서 하던 대화 이어가기" on first pass entry; REQ-L12 ⑫ amended | setting, default off | no |
| 3 conversion | lab-trial-to-pricing | lab | Trial page → pricing link; "체험해 보기" entry on pricing | `STUDIO_OPEN_TRIAL` | no |
| 3 conversion | ot-guardian-checkout | studio | Under-19 end card Primary "보호자에게 결제 요청하기" (QR to Lab checkout) | — | **yes (legal)** |
| 4 subscription | ot-subscription | service | Recurring plan: Toss billing key, renewal notice, in-app cancel (AB-21, REQ-L13); depends on the account launch (#99/#124, #1701/#1702) | — | **yes (legal + contract)** |
| 4 subscription | ot-under14-consent | service | Guardian consent before an under-14 grant (US-20) | — | **yes (legal)** |

Scope, acceptance and tests per item: Appendix A.

## 9. Recommendations

1. **Ship 8a's Studio end-state fixes first** (ind-trial-end-notice, ind-banner-expiry-state,
   ind-sdk-error-text, ind-missing-sdk-error). They help today's pass buyers and every internal
   trial, need no decision, and remove the two app-side severity-4 rows (U1, I2).
2. **Fix distribution for non-members in parallel**: studio-public-sdk-seed →
   studio-sdk-seed-on-demand, lab-install-links, ind-update-check-copy now; decide the public
   update channel (D19) so studio-public-update-path can follow. In the same stream, make the
   kit honest and light: studio-installer-seed-fail-closed and lab-install-kit-copy need no
   decision; studio-trial-install-profile waits on D22 and studio-release-signing on D23.
   Without these, decision 1 stops at installation and trial users are stranded on their first
   build.
3. **Build Phase 1 behind flags now**; it is the precondition for any open entry.
4. **Decide the trust event (D15).** The recommendation is A (account sign-in); it moves the
   account launch gates onto the trial's critical path. If the trial must open before accounts,
   take C′ explicitly as an interim (D17).
5. **Get the numbers and the legal sign-off** that block launch: D1/D2 ceilings (§6a gives the
   planning numbers), D3/D4 price + FX revisions, D8–D11 minors and privacy, D16 pass moderation
   now, D24 analytics consent. Two one-minute checks close open facts: the Toss merchant
   console for the retained ₩55,000 (live or test), and one `gh` call for release
   `download_count` when no other session holds the GitHub budget.
   Trace svc-conversation-cache before the ceilings are fixed: it moves the central cost by
   about 40%.
6. **Run T25 with ≥ 5 adults on a flagged internal build before announcing**, measuring time and
   drop-off between "AI 체험하기" and the first message (the friction cost of A), then let funnel
   events decide whether A/B tests are worth running (≈1,500 trial starts per arm needed).

## 10. Decisions for Jay (new or changed in this revision)

Design §10 now carries D1–D21 (r2-0); D15 and D17–D21 below match it word for word. D22–D24
are new in round 2 and exist **only in this report** until copied into design §10:

| # | Decision | Proposal | Owner |
|---|---|---|---|
| D15 | Trust event for the open trial (was "trust event vs US-04") | A (account sign-in); B only as a second provider; C′ counters as secondary limits | Jay |
| D17 | Ship C′ as an interim before accounts launch? | Only with explicit acceptance of the drained-cap risk and in-App-only conversion measurement; sunset when A launches | Jay |
| D18 | Free-entitlement rule under A | 1 per `(provider, subject)` ever; hash kept after account deletion | Jay + legal (retention of the hash) |
| D19 | Public update channel for non-members | Read the public release the Lab download already serves, or a Service/Lab proxy; the private mirror stays for members | Jay |
| D20 | Interim request path (plan decision 2) | Name the mailbox and a response time; confirm receipt | Jay |
| D21 | Visual identity across Lab → install → App → chat (impeccable Q2) | Bring the start page's identity into the end-state cards first; full chat theming later | Jay |
| D22 | What a trial/pass install must contain (I4) | App + SDK seed only; the class toolchain (Homebrew/CLT, gh, node, python) stays for class kits, after an audit of what the bundled skills need | Jay |
| D23 | Raw binaries for non-members (I8) | Either buy Apple Developer ID + an Authenticode certificate and notarize, or stop linking raw binaries to non-members and send everyone through the (open) kit | Jay (cost) |
| D24 | Lab funnel analytics (U6) | A page-view counter on the funnel pages under a consent model legal approves; fix the banner copy now | Jay + legal |

## 11. Status of plan decisions and review gaps

Plan decisions (plan §"Decisions needed from Jay"):

| # | Plan decision | Status |
|---|---|---|
| 1 | Prod read-only access | Approved 2026-10-18; used in P0 and r1-3 |
| 2 | Where trial requests arrive; countable? | **Open** — not answered; D20 |
| 3 | Per-user and per-day cost ceiling | Moved to design D1/D2 |
| 4 | Adults only? | Moved to design D9/D11 (D16 for passes now) |
| 5 | Skill installation | Superseded: skills installed in `~/.claude/skills` |

The plan file's status line now says the diagnosis ran and links this report and the design.
Design §2A (access options) is now inserted into the design doc (r2-0), and design §10 carries
D15–D21 with the report's wording.

Critic round 1: gaps 1 (raw zip), 2 (design corrections), 3 (options), 4 (prod SHA),
5 (update path) and 6 (lens depth) are filled above. Gaps 7–9 were worked in round 2:
- **Gap 7, per-step measurements: filled, with limits (r2-4).** There is now a per-screen
  table for app screens 01–14 (new text, read time, decisions, clicks, dead ends). The
  with-code kit install was walked statically for macOS (fresh, and with Homebrew) and for
  Windows x64, and compared with the raw download.
  - Results: about 10–13 actions before the app, plus 6 in the app before the first send.
  - New findings, all from code:
    - The Mac installer reports success when the SDK seed fails ("self-heals on first
      launch", but there is no in-app downloader), so the trial dead-ends on screen 13.
      `install.ps1` fails closed on the same condition.
    - The middle of the install is in English, including the Homebrew Y/n consent.
    - The Lab install page copy does not match what happens ("세 줄", "수업 참여 코드 칸",
      Spotlight vs Finder, a SmartScreen warning the kit does not produce).
    - The code is typed twice and echoed in clear text.
    - Trial users receive the full member toolchain.
    - The Windows Git path is hard-coded.
    - Both raw downloads are unsigned or self-signed (observed).
  - Still not done: wall-clock timing of UI steps, a real Electron run, a Windows VM or a
    clean macOS account, a comparison of the served kit scripts with the Lab clone (outbound
    HTTPS was blocked), and the winget scopes, so the UAC count is INFERRED.
- **Gap 8, unknown funnel stages: investigated (r2-5).**
  - Discover: **no data was ever collected.** GA4 is unconfigured in prod, and there is no
    Vercel or Cloudflare analytics.
  - Install: release asset `download_count` exists but was not pulled. It is an upper bound
    and needs one gh call, deferred under the one-gh-agent rule. Lab `/api/download` and kit
    logs (Vercel) and Service `/v1/access` logs (Workers Logs) exist, but this session's
    tokens can read them only through the dashboard.
  - First artifact: **not instrumented** for trial grants. A trace needs a session.
  - Toss mode: [INFERRED, low–moderate confidence] the retained ₩55,000 order (B3) is likely
    live and B1 likely test, from the `paymentKey` prefix shape. A 1-minute check in the
    merchant console confirms it (Jay).
  - The §2 funnel table now carries these refinements.
- **Gap 9, bookkeeping: done.** The decisions table is above, the plan status line is
  updated, and §6 now points to design §2A.
- **Round-2 gap 3, unit economics of the proposed tier: done (r2-2).** Summary in §6a, full
  table in design §5.4; new problem C8 (conversation cache miss).
- **Carried into the problem map and fix list:** I7–I11, C8, U6 (§3), eight new §8a items, and
  the grant-scoped event route in ot-funnel-events / studio-funnel-events.
- **Still open:** release `download_count` (one gh call), Toss console check, served kit scripts
  vs the Lab clone, winget scopes on a Windows VM, wall-clock UI timing, a real Electron run.

## 12. Questions for further research

- Real-user drop-off by stage (needs Phase 2 events; today n = 0).
- Whether B3 (the only retained ₩55,000) is an external buyer; Toss mode is INFERRED live
  (r2-5) and needs the merchant console.
- Release asset `download_count` per version (upper bound on installs; one gh call).
- Why the SDK conversation misses the cache (C8), and whether the growth model fitted on one
  session holds.
- The raw-zip error screen on a clean macOS account (branches are CODE on the shipped bundle);
  Windows UserSetup exe contents.
- A logged-in **non-member** update check (expected 404; no such credential was available).
- Whether the Lab web checkout hands a guardian a code usable on another device.
- Whether hashed install/network ids are personal data under PIPA.
- Friction cost of account sign-in before first value (option A), measured in T25.
- Whether the measured token profile (n = 37 Sonnet 5.5 requests, 8 users, mixed) holds for
  first-time users with longer tool loops.
- Real-app behavior (window reload on workspace switch, SecretStorage, clock across reload,
  contrast under real themes) via the quiet-mode Electron harness.

## Appendix A. Fix cards (scope · acceptance · tests)

Studio test layers: extension `test/*.smoke.mjs` / node tests, headless webview harness
(`e2e/trial-ux`, `e2e/start-page`). Service: `worker/test/*.test.mjs`. Lab: `vitest` + headless
Playwright. Every scorer gets a positive and a negative control (verification.md rule 2).
All runs are background/headless.

### 8a. Independent

- **ind-trial-end-notice** (studio). Scope: `src/passPurchase.ts` (`passSpentNotice`), `src/proxyClientHelpers.ts:154` trial_expired copy, `src/chatPanelProvider.ts` `handleSendError`. Acceptance: with the exact observed SDK error text for exhausted ("…개인 체험의 총 요청 한도에 도달했습니다.") and expired, the chat shows a trial-ending notice naming files kept and "이용권으로 시작하기"; the purchase screen never opens by itself (REQ-L12 ①, CU-13/14); start page after expiry no longer says "코드 발급 담당자". Tests: smoke with strings from `sdk-exhausted.json`/`sdk-expired.json` (positive), classroom 429 text (negative); `e2e/trial-ux` TUX-SP-05 asserts the pass pointer.
- **ind-banner-expiry-state** (studio). Scope: `webview-ui/src/errorBannerPresentation.ts`. Acceptance: "개인 체험 시간이 끝났습니다…" → account-state icon/title, not "연결이 끊겼어요"; network timeouts still 🔌. Tests: unit table with both strings (positive + negative control).
- **ind-sdk-error-text** (studio). Scope: `src/sdkCoachHelpers.ts` stream consumer (`<synthetic>` assistant error), banner text builder. Acceptance: no "API Error:", "Failed to authenticate", "Claude Code returned an error result" reaches bubble or banner for 401/403/429/409; the Service's Korean sentence is shown once (not in both bubble and banner). Tests: replay `sdk-*.json` raw types through `consumeSdkStream`; negative control: a normal assistant message still renders.
- **ind-missing-sdk-error** (studio). Scope: `src/chatPanelProvider.ts` SDK catch branch (`033f917e` :5358-5395; `origin/main` ~:5529) and `handleSendError`, `src/proxyClient.ts` `classifyError`/`friendlyTransportMessage`, `src/coachIdentity.ts:120`, `noteSdkFallback`. Acceptance: on a seat whose profile requires the SDK and with no resolvable binary, no proxy fallback runs; all three branches (no selection → 409; model picked; pass picked) show one Korean message with cause (작업 도구가 설치되지 않음) and remedy (설치 안내 / seed download when enabled); a 409 `trial_requires_sdk` that does arrive keeps the Service's sentence; `SdkUnavailableError` text never reaches the user; no "스태프"/"강사"/"운영 담당자" on trial/pass seats; "다시 시도" not offered (US-01). Tests: proxy client fed the exact 409 body; `SdkUnavailableError` × {no selection, model picked, pass picked} matrix (positive); classroom seat still gets its existing copy (negative control).
- **ind-trial-busy-policy** (studio). Scope: `src/sdkCoach.ts:806`, `sdkCoachHelpers.ts` `sdkBusyPolicyFor`. Acceptance: a persistent `trial_busy` ends within the bounded policy with `SDK_BUSY_*` copy, not raw text. Tests: SDK-busy replay with a lease held forever (negative) and released after one retry (positive).
- **ind-trial-vocabulary** (studio). Scope: `ChatPanel.tsx:1384,1392,2067,2081`, `StartPage.tsx:74,139`, `sdkCoach.ts:859`, `coachIdentity.ts:120`, `proxyClient.ts:262`. Acceptance: trial/pass seats see no 스태프/강사/운영 담당자/Jay; classroom seats unchanged; Korean send label. Tests: smoke string assertions per seat type; update existing assertions that quote old copy (no string-literal translation elsewhere).
- **ind-trial-card-disclosure** (studio). Scope: `webview-ui/src/StartPage.tsx` candidate card. Acceptance: before "AI 체험하기" is chosen, the card states that a code is needed today and the allowance (1시간 · 요청 40번 wording from the Service, not hard-coded); removed automatically when the Service advertises open entry. Tests: `e2e/start-page` text assertion with offer off (positive) and on (card replaced, negative).
- **ind-update-check-copy** (studio). Scope: `src/updateTransport.ts` `releaseToken` error, `src/updateChecker.ts:430-435` scheduler catch, `extension.ts:581-601` command handler. Acceptance: with no member credential the manual check says the update is available from the homepage (no `gh auth login`, no `HPS_RELEASE_TOKEN`, no "잠시 후 다시 시도"); the automatic check shows one passive line per version instead of nothing; member path unchanged (PRA-01, TUX-COND-02). Tests: the r1-4 headless harness (bundled module + `vscode` stub) with credentials absent (positive) and present (control).
- **svc-profile-trial-status** (service). Scope: `routes/chat.ts` profile serializer, `lib/native-trial-grants.ts`. Acceptance: non-pass native grants return `trial {ends_at|null, request_limit, requests_used, state}`; pass grants unchanged; reading it does not start the clock under `HPS_TRIAL_CLOCK_AT_MESSAGE`. Tests: `native-trial-grants.test.mjs` fresh/started/exhausted/expired cases.
- **ind-trial-status-ui** (studio). Scope: `webview-ui/src/activityLabel.ts`, `StartPage.tsx`, chat header. Acceptance: candidate card states the allowance; header shows a passive remaining line (no button); exhausted/expired grants show an ended card, not "이어서 하기" (CU-13, TUX-SP). Tests: `e2e/trial-ux` scenarios fresh/near-limit/exhausted; negative: pass seats keep `passSummary`.
- **svc-clock-first-message** (service). Scope: `lib/chat-gate.ts:224-230`, `middleware/native-trial-budget.ts`, NAT-11 text. Acceptance: flag on → `started_at` null after `/v1/profile` and `/v1/activity`, set at the first admitted reservation; flag off → today's behavior. Tests: invert `native-trial-grants.test.mjs:1163` under the flag; keep the old test for flag off.
- **svc-grant-purpose-timestamps** (service). Scope: D1 migration, `createNativeGrant`, `routes/admin.ts` mint, `lib/purchase.ts` `claimSeat`, `lib/accounts.ts` `activatePass` (Service main), `lib/owner-usage.ts:62-68`, `lib/native-trial-grants.ts:28-30` `isPassGrant`. Acceptance: new grants carry `created_at` and `purpose`; owner usage and `isPassGrant` use `purpose` when present and fall back to `duration_ms` for legacy rows; a free grant longer than 1 h is not a pass; admin mint can mark `internal`. Tests: `owner-usage.test.mjs` with an internal 2 h probe (must not be `pass`) and a real pass (must be `pass`); `isPassGrant` with a 24 h `trial` grant (negative).
- **studio-public-sdk-seed** (studio). Scope: `.github/workflows/release.yml`/`mirror-release.yml`, `scripts/seed-sdk-binary.sh`. Acceptance: each public release carries the `claude-agent-sdk-<platform>` native seed + sha256 for the shipped `SDK_BINARY_VERSION`; the app bundle still contains no native SDK package (`verify-branding.sh`, REQUIRE_SDK_VENDOR). Tests: workflow dry-run/assert script on the artifact list; verify-branding negative control.
- **studio-sdk-seed-on-demand** (studio). Scope: `src/sdkCoach.ts` `resolveSdkBinary` (`sdkCoachHelpers.ts:738` order), a new pure helper. Acceptance: setting on + no binary → user-confirmed download into the seeded location with `.verified.json`, sha256 checked, then SDK runtime; mismatch refuses. Tests: helper unit with good/bad hash; no network in tests (fixture server). Reproduce only on a clean account: the dev machine already has seeded binaries.
- **studio-public-update-path** (studio, needs D19). Scope: `src/updateTransport.ts`. Acceptance: no `gh`/token → the check reads the public channel chosen in D19 and succeeds; it never calls the private mirror anonymously; member path unchanged (PRA-01, TUX-COND-02, TUX-HOST-07). Tests: the r1-4 headless harness with credentials absent (positive) and member token (control); anonymous private-mirror call asserted absent.
- **lab-install-links** (lab). Scope: trial, product, pricing, checkout pages, `app/download/page.tsx`, `lib/studio-install.ts`. Acceptance: no non-member page links member-only `/install`; `/download` meta and owner fixed; fallback printed once. Tests: vitest link table; Playwright crawl asserts hrefs.
- **lab-studio-landing** (lab). Scope: `app/studio/page.tsx` (new) or redirect, not-found. Acceptance: `/studio` 200 in Korean with one CTA; 404 has nav, Korean text and a "not found" title. Tests: Playwright status, text and title.
- **lab-pricing-clarity** (lab). Scope: `app/studio/pricing/page.tsx`, `lib/studioOffer.ts:46-48`. Acceptance: device requirements and request counts (from the Service catalog) visible before payment; names equal Service labels. Tests: vitest catalog mapping; Playwright text.
- **lab-terminology** (lab). Scope: `checkout/done/page.tsx:63-64`, `download/page.tsx:118`, trial page. Acceptance: labels match `StartPage.tsx`; one name for the code; no "토큰". Tests: vitest snapshot of strings against a shared terminology table.
- **lab-trial-page-order** (lab). Scope: `app/studio/trial/page.tsx`. Acceptance: allowance in the first block; CTA above the fold at 390×664. Tests: Playwright mobile bounding-box assertion.
- **lab-banner-a11y** (lab). Scope: `components/CookieConsent.tsx:71-72` (opaque whitelist), `:285-327` (toggles), `globals.css:67-71`. Acceptance: opaque banner on the funnel pages; toggles have accessible names and `aria-pressed` or `role="switch"`; the banner does not cover the trial copy, the first pricing CTA or a focused element on mobile; reduced motion honoured. Tests: Playwright + axe with the details panel opened; mobile bounding-box overlap check (positive) and a page with the banner dismissed (control).
- **lab-install-a11y** (lab). Scope: `app/download/page.tsx`, `InstallButton.tsx:60`, `install/CopyCommand.tsx`, `/studio/install`. Acceptance: axe 0 serious on `/download`, `/install`, `/studio/install`, `/studio/pricing`; command blocks focusable; copy status announced; the copy action has one label across the three pages. Tests: Playwright + axe (wcag2aa, wcag22aa); label table assertion.
- **lab-trial-request-ack** (lab, needs D20). Scope: `app/studio/trial/page.tsx` request section. Acceptance: the page states the response time and what happens after sending; a confirmation is shown or sent. Retired when open entry ships. Tests: Playwright text.
- **svc-price-revisions** (service, needs decision). Scope: `config/usage-prices/*`, D1 revisions. Acceptance: approved Sonnet/Haiku/Opus 5.5 revisions and an `fx` revision; Sonnet 5.5 cache-read conflict resolved (D3, D4, AB-01). Tests: settlement test pricing a recorded attempt.
- **lab-age-statement** (lab, needs decision). Scope: trial and pricing pages. Acceptance: approved wording states who may use the trial/passes and routes parents to classes (US-04 P1). Tests: Playwright text.
- **studio-installer-seed-fail-closed** (studio). Scope: `scripts/install.sh` `seed_sdk` (:681, :703) and the doctor (:758). Acceptance: when the seed is missing or fails, the doctor fails with a Korean stop message naming the stage and the recovery command (parity with `install.ps1:1080`); no "self-heal" text while the app has no in-app fetch; members get the same fail-closed behavior. Tests: shell harness with the seeder stubbed to fail (non-zero exit, message present) and to succeed (control: exit 0); no network.
- **studio-installer-korean** (studio). Scope: user-facing `confirm`/`warn`/`die`/header strings in `scripts/install.sh` (e.g. :340) and `Confirm-Or`/headers in `scripts/install.ps1` (e.g. :706). Acceptance: every prompt a learner must answer and every step header is Korean; package-manager output untouched; log/debug lines may stay English. Tests: a static check that every `confirm`/`Confirm-Or`/`Read-Host` literal contains Hangul (positive) and a fixture English prompt that the check rejects (negative control).
- **studio-trial-install-profile** (studio, needs D22). Scope: `scripts/install.sh` / `install.ps1` kit mode, kit manifest. Acceptance: a trial/pass kit installs the app and the SDK seed only, with no Homebrew, password, gh, node or python step on a stock Mac; class kits unchanged; the bundled skills and coach shell tasks a trial learner meets are audited first and the result recorded. Tests: kit-mode dry run asserting the dependency list for trial vs class (both directions).
- **studio-win-posix-shell-detect** (studio). Scope: `scripts/install.ps1` `Ensure-PosixShell` (:684) and doctor (:1023). Acceptance: a user-scope Git under `%LOCALAPPDATA%` is found without the WSL prompt; the inbox `wsl.exe` stub alone does not pass the doctor. Tests: Pester (pwsh) with mocked paths: machine Git, user Git (positive), neither with WSL stub (negative). Confirm the winget scope on a Windows VM in CI, not locally.
- **lab-install-kit-copy** (lab). Scope: `web/src/app/studio/install/page.tsx`, `lib/public-studio-install.ts`, `public/install/studio/install-mac.sh`, `install-win.ps1`. Acceptance: the line count matches the command block; the code field is named as on the start page branch the user will choose; one Terminal instruction across pages; no SmartScreen warning on the kit path; code input masked (`read -rs` / `-AsSecureString`). Tests: vitest comparing the stated line count with the block; Playwright text; shell check that the prompt does not echo (pty harness).
- **studio-release-signing** (studio, needs D23). Scope: `build-mac.yml`, `build-windows.yml` signing steps (secrets in CI only). Acceptance: `codesign -dv` shows a Developer ID with a TeamIdentifier and `spctl` accepts the notarized app; the Windows exe has a valid Authenticode signature; or, if D23 chooses routing, no non-member page links a raw binary. Tests: CI assertion step on the built artifacts; unsigned-artifact negative control.
- **svc-conversation-cache** (service). Scope: request path that forwards SDK `cache_control` (`routes/messages.ts`), Studio SDK options if the cause is there. Acceptance: replaying the recorded 5-turn session's request shapes, `cache_read` grows across turns instead of staying at the 20,064-token prefix; cost model for 10 turns moves toward the "cache fixed" row of §6a. Tests: unit on the forwarded body asserting a breakpoint on the latest conversation block (positive) and a fixture without one (negative); post-deploy read-only usage query.
- **lab-funnel-analytics** (lab, needs D24). Scope: `components/Analytics.tsx`, `lib/analytics.ts`, `CookieConsent.tsx` copy, env config. Acceptance: page views on the funnel pages are counted under the consent model legal approves; until then the banner does not claim analytics cookies. Tests: Playwright asserting the beacon only after consent (or never, before D24) and banner text.

### 8b. Open trial → subscription

- **ot-open-profile** (service). Scope: `profiles/studio-open-trial.ts`, registry, prompt reuse. Acceptance: allowed = Sonnet 5.5 + Haiku 5.5 aliases only; effort ≤ medium; `web_search` off; `sdk_tools` stated explicitly (not inherited by spread); `workspace_root` equals the pass profile; `studio-native-trial` unchanged (MU-09). Tests: profile contract test (positive) and a test that `studio-native-trial` still lists Opus (control against spread drift).
- **ot-cost-ceiling** (service). Scope: grant columns `cost_ceiling_micro`/`cost_used_micro`, `native-trial-budget.ts` admission, settlement from `usage_log` × price revision. Acceptance: tiny ceiling refuses the next request (negative control); normal trial completes (positive); overshoot ≤ one request; unpriced model refused (AB-19). Planning numbers: §6a (central ₩954–1,027 per 10-turn trial, ceiling $1.50). Tests: D1 tests with a fixture revision.
- **ot-daily-cap** (service). Scope: daily counter, `getCohortPause` wiring, scheduled resume. Acceptance: crossing the cap pauses only `studio-open-trial` (503 `cohort_paused`); resumes 00:00 KST; passes and classes unaffected (AB-20). Capacity figures use 47/142/476 (or 36/108/360 with overshoot), not 55/165/550. Tests: clock-injected unit.
- **ot-moderation-always** (service). Scope: `lib/moderation.ts:123`, `routes/messages.ts:447-456`, `Profile` type. Acceptance: `moderation:'always'` screens inbound on SDK and proxy routes without kids-track limits (REQ-O8). Tests: REQ-O7 regression list on an adult profile with the flag; control without it.
- **svc-turn-allowance** (service). Scope: `native-trial-grants.ts`, `native-trial-budget.ts`, `x-hps-turn-id`. Acceptance: flag on → distinct turn ids counted; per-turn attempt guard; failed provider call costs money but not a turn (NAT-11, MU-04). Tests: replay a 5-turn/10-attempt run → 5 turns used; guard trips on a runaway loop.
- **studio-turn-id** (studio). Scope: SDK request header injection, `proxyClient.ts`. Acceptance: one UUID per user message, stable across tool steps and retries. Tests: smoke capturing outgoing headers over a tool loop.
- **ot-grant-allowlist** (service). Scope: `lib/chat-gate.ts:211-215`. Acceptance: `open-trial`/`purchase`/account-entitlement grants pass without roster read; operator seats still require roster; revoked grants refused (NAT-02). Tests: matrix of owner × roster × revoked; Service owner security review.
- **ot-account-free-entitlement** (service, needs D15/D18). Scope: Service main `lib/accounts.ts` (`activatePass` as template), new entitlement row/route, `routes/accounts.ts`, migration. Acceptance: with `HPS_ACCOUNTS` and `HPS_OPEN_TRIAL` on, a signed-in 14+ account gets exactly one free grant in `studio-open-trial` (owner e.g. `account-trial`, purpose `trial`); a second request, a second device or a delete-and-recreate of the same `(provider, subject)` gets none; flags off → route 404. Tests: one-per-subject, delete-and-recreate (negative), flag-off 404, under-14 refused.
- **ot-studio-account-entry** (studio, needs D15 and #1702). Scope: `StartPage.tsx`, `startPage.ts`, #1702 device sign-in. Acceptance: when the Service advertises the account trial, "AI 체험하기" leads to sign-in, then the free entitlement, then preview; no code field; refusal and paused copy; offer off → today's flow (TUX-SP-11). Tests: `e2e/start-page` offer on/off with a stubbed device sign-in; under-14 branch.
- **ot-claim-endpoint** (service, C′ only). Scope: `routes/trial-claim.ts`, KV counters, `createNativeGrant(owner 'open-trial')`. Acceptance: flag off → 404; same `install_id` → same grant (lost response, double click); network limit ≤ 5/24 h; paused/global refusal reasons; minimum `app_version` (US-04 rewritten, US-19). Tests: idempotency, rate-limit, refusal-reason tests.
- **ot-studio-claim-client** (studio, C′ only). Scope: new `trialClaim.ts` (pure) + host wiring, SecretStorage. Acceptance: code never in webview messages or logs (REQ-L12 ③); retries reuse the claim. Tests: smoke asserting no code in posted messages; idempotent retry.
- **ot-studio-zero-gate** (studio, C′ only). Scope: `StartPage.tsx`, `startPage.ts`. Acceptance: when the Service advertises the open trial, "AI 체험하기" shows one Primary and the age question ("만 14세 이상인가요?"), no code field; under-14 shows the guardian message; paused shows the day-full copy (TUX-SP-11). Tests: `e2e/start-page` offer on/off; under-14 branch.
- **lab-open-install-kit** (lab). Scope: `app/studio/install/kit/route.ts`, `studioInstallAccess.ts`. Acceptance: flag on → no-code kit installs from public assets including the native seed; flag off → 401 `code_required` unchanged. Tests: vitest route tests both ways.
- **lab-open-trial-page** (lab). Scope: `app/studio/trial/page.tsx`, robots, sitemap. Acceptance: flag on → indexable, in sitemap, one CTA to `/studio/install`; flag off → today's page. Tests: Playwright both modes.
- **ot-funnel-events** (service). Scope: event writer, a grant-scoped event route (trial grants have no cohort session, so `routes/trace.ts:222-224` refuses them), derived activation query. Acceptance: events keyed by a hash of the account id (A) or grant id (C′), no PII or message text; a trial grant without a session can write an event; first tool result per grant is recorded; activation = tool result + later turn (P4 §7.1). Tests: unit asserting event payload keys (negative: no raw ids); trial grant without session accepted (positive) and a revoked grant refused (negative).
- **studio-funnel-events** (studio). Scope: calls to the grant-scoped event route from ot-funnel-events. Acceptance: entry/age/sign-in/tool-result/offer events carry only allowed fields; nothing is sent to the session-only `/v1/trace/event` from a trial seat. Tests: smoke capturing payloads.
- **ot-legal-open-access** (needs decision). Scope: REQ-O6, `docs/age-verification.md`, privacy notice copy, US-04 if C′. Acceptance: legal sign-off on PIPA/overseas transfer, outbound moderation decision, pass moderation now (D8–D10, D16).
- **ot-launch-enable** (needs decision). Scope: production env flags, ceilings, pin bump + deploy. Acceptance: D15 decided, D1/D2 numbers set, price + FX revisions approved, legal sign-off, T25 run with ≥ 5 adults.
- **ot-end-card** (studio). Scope: chat end-state component, `passPurchase.ts`. Acceptance: inline card with facts from the Service catalog, one Primary "이용권 살펴보기", escape "오늘은 여기까지"; never opens by itself; no countdown (TUX-COND-07, REQ-L12 ①②). Tests: `e2e/trial-ux` limit scenario; negative: card absent mid-work.
- **ot-order-trial-link** (service, C′ only). Scope: `purchase_orders.trial_id`, `createOrder`. Acceptance: nullable link stored when supplied; no identity added. Tests: `purchase.test.mjs` with and without `trial_id`.
- **ot-conversation-carryover** (studio). Scope: first pass entry, transcript store, REQ-L12 ⑫ (US-09 already allows user-confirmed reuse). Acceptance: explicit user-confirmed action shows the trial transcript read-only and a visible summary seed; SDK session not resumed across credentials. Tests: smoke for confirm/decline.
- **lab-trial-to-pricing** (lab). Scope: trial and pricing pages. Acceptance: trial → pricing link; pricing "체험해 보기" entry (flagged). Tests: Playwright hrefs.
- **ot-guardian-checkout** (needs decision). Scope: end card under-19 branch, QR to Lab checkout. Acceptance: D11 approved; no child payment UI.
- **ot-subscription** (needs decision). Scope: Toss billing key, AB-21, REQ-L13; depends on the account launch. Acceptance: renewal notice, in-app cancel as easy as purchase, legal sign-off.
- **ot-under14-consent** (needs decision). Scope: US-20 guardian consent flow. Acceptance: legal-specified consent method (D10).
