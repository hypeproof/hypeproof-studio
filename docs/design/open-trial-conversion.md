# Open free trial → subscription (P4 design)

Status: design proposal, 2026-10-18. Not implemented, not reviewed by legal, no
requirement row changed yet. Baselines: Studio `origin/main` `033f917e`, hypeproof-service
`a08cf7a`. §2A also reads hypeproof-service `origin/main` `2cf66dc` (2026-10-18 22:56 KST),
cited as `svc-main:`, because the account system merged there after the baseline. Plan:
[trial-diagnosis-2026-10-18](../plan/trial-diagnosis-2026-10-18.md) §P4. Report:
[trial-diagnosis-report-2026-10-18](../plan/trial-diagnosis-report-2026-10-18.md); its
decision rows are merged into §10 here, which is the single decision table.

Jay's decisions this design takes as given (2026-10-18):

1. The trial is usable by **everyone**, with **no issued code**.
2. The free trial exists to **convert** users to a paid plan.

Everything else below is a proposal with a named decision owner (§10).

Evidence labels: **[CODE]** read in source, **[PROBE]** read-only production request
today, **[DOC]** a document's claim not re-derived, **[INFERRED]** follows from code but not
observed, **[SKILL]** method taken from a third-party skill (`onboarding`, `signup`,
`paywalls`, `pricing`, `onboarding-design`, `a-b-test-design`, read 2026-10-18), filtered
through `docs/PRODUCT-INTENT.md`.

---

## 1. Summary

- **Entry.** Replace the operator (roster append + mint) with a **server-trusted mint
  event**. §2A compares the plan's options A/B/C. The recommendation (D15) is **A, account
  sign-in**: Google sign-in through the account system (Service #99/#124, merged on
  `origin/main` but default-off; Studio #1702 unmerged), then a **free entitlement** minted
  once per `(provider, subject)` the way `activatePass()` mints a paid pass (D18). Sign-in is
  not an issued code, so it meets decision 1, and the account links the trial to a later order
  across devices and web checkout, which serves decision 2. A satisfies US-04 as written
  [INFERRED].
  B (email OTP) is kept only as a second sign-in provider inside A. The install, network and
  global counters of C′ stay as secondary rate limits.
- **Interim (C′, D17).** If the trial must go live before the account launch gates clear,
  `POST /v1/trial/claim` (§3), modeled on `claimSeat()` (`svc:lib/purchase.ts:358-391`), mints
  the same `native_trial` grant with no identity at entry: install + network + global budget
  checks. It **conflicts with US-04 as written** ("본인 자격과 발급 이력"); §3.1 proposes the
  amendment for the interim only. Under C′ the daily cap is the real control, a script can
  exhaust the free trial for a day, and conversion is measurable only for in-App purchases.
  C′ is sunset when A launches.
- **Cost.** The current allowance is "40 attempts in 1 h" with Opus-class models allowed
  and no currency cap [CODE]. Measured trial/pass traffic costs about **$0.02 per request on
  Sonnet 5.5**, so a fully used 40-request trial costs about **$0.9**. A **realistic worst
  case** is about **$12 per trial on Sonnet 5.5 and about $30 on Opus 5 / 4.8** [INFERRED]:
  the per-request input limit is **200,000 bytes** of request body [CODE], which is roughly
  50–70K tokens at 3–4 bytes per token. An adversarial body at 1–2 bytes per token approaches
  an upper envelope of $35 (Sonnet 5.5) to $88 (Opus 5 / 4.8); that envelope is not the
  expected bound. Either way the worst case is far above the typical cost, so an open trial
  needs a **per-trial currency ceiling**, a **global daily ceiling wired to the existing
  cohort pause**, and a **free-tier model list**.
- **Minors.** "Everyone" breaks the compliance argument in `docs/age-verification.md`.
  That argument rests on "no public signup, no anonymous access" [DOC]. It is **already
  broken today**: anyone can buy a pass on the web and get a seat in the same adult,
  unmoderated cohort (§6.4). The open trial widens that gap; it does not create it. The trial
  profile is adult (`audience.age_range [19,99]`), so **no moderation runs** on it [CODE].
  Shipping to minors needs: an age question, moderation on the open-trial profile, a PIPA
  under-14 path, and adult/guardian payment. **This is the gating legal item.**
- **Conversion.** Activation must mean what `PRODUCT-INTENT.md` means: a real result on the
  user's own task **plus** a visible judgment by the user. It must not mean "sent a
  message". The offer appears **at the limit**, as an inline card the person chooses to
  open. REQ-L12 ① already forbids a limit or error opening the purchase screen by itself.
  Upgrades carry files over today. Conversation carry-over needs a **REQ-L12 ⑫** amendment
  ("대화 기록은 새 활동으로 시작한다"); US-09 already allows user-confirmed reuse (§7.3).
- **Subscription.** Today's passes are 30-day, request-counted and **explicitly
  non-recurring** ("자동으로 다시 결제되지 않아요", REQ-L12 ②) [CODE/DOC]. A recurring plan
  needs a Toss billing key, an account (#1701, PR #1702 draft) and legal review of
  auto-renewal rules. Ship the open trial against **existing passes first**. Subscription
  comes later as a separate phase.

---

## 2. What exists and what this design reuses

| Piece | Today | Reuse for open trial |
|---|---|---|
| Grant | `native_trials` row: window, `request_limit`, `requests_used`, lease, revoke (`svc:lib/native-trial-grants.ts`) [CODE] | Same table and gate. Add `owner_id='open-trial'`, plus the new turn and currency columns (§4) |
| Server-trusted mint | `claimSeat()`: roster add → `issue({native_trial:true})` → `createNativeGrant(owner 'purchase')` [CODE] | Same three steps behind a new trust event (§3) |
| Roster self-heal | Gate re-adds `owner_id==='purchase'` seats dropped by a racing KV write (`chat-gate.ts:210-215`) [CODE] | Must extend to `open-trial`, or the open trial must stop depending on the roster (§3.3) |
| Kill switch | `getCohortPause` → 503 `cohort_paused` (`chat-gate.ts:216`) [CODE] | The global daily cap trips this automatically (§5.3) |
| Order rate limit | `bumpRateCounter` 120 per 10 min per address on `/v1/purchase/orders` [CODE] | Same KV counter primitive for claim limits |
| Entry path in the App | A purchased code goes through the normal code → preview → "이 활동 시작하기" path (REQ-L12 ⑥) [DOC] | Same: the claim returns a code, and the App never shows it to the user |
| Pass products | [PROBE] `GET /v1/purchase/products`: 라이트 ₩33,000/200 req, 기본 ₩55,000/350, 넉넉 ₩108,900/700; each 720 h | Conversion target for phases 1–3 |
| File carry-over on purchase | REQ-L12 ⑫: a new pass inherits the default `workspace_root` (`~/HypeProofTrial`); the conversation starts as a new activity [DOC] | Already the trial's folder, so files carry over |
| Usage ledger | `usage_log` per request (tokens_in/out/cache_read/cache_write), `/admin/cohorts/:id/usage` [CODE/PROBE] | Cost settlement for the currency ceiling and the funnel |

Prerequisites this design does **not** solve (independent fixes, plan §P3):

1. **Code-free install with the SDK binary.** Two of three install paths need a code. The
   public zip lacks the binary the trial requires. The likely result is a misleading 409
   `trial_requires_sdk` (#1617) or, when the saved model selection is lesson- or
   profile-scoped, `선택한 모델의 실행 환경을 사용할 수 없습니다…`
   (`chatPanelProvider.ts:5359-5360`) [INFERRED; not observed end to end]. Either way,
   without this fix "no issued code" stops at installation.
2. **Non-member update path.** The update check needs a member `gh` login (PRA-01).
3. **Honest missing-binary error.** The current copy blames the Studio version.

---

## 2A. Access options compared (plan §P4 A/B/C)

The plan names three trust events to replace operator vetting. §3 was first drafted as an
anonymous install-and-network check, which is closest to C, without weighing A or B. This
section compares four options and recommends one; §3 then details the entry flows:

- **A. Account sign-in.** Google sign-in (Studio PR #1702 + Service #99/#124) gives a server-held
  identity, and a free entitlement is minted against it.
- **B. Email OTP.** A one-time code sent to an email address. A verified address gets one
  self-serve grant (roster + mint), with no account.
- **C. Anonymous device grant.** No trust event. Device id plus IP limits.
- **C′. This design's §3 variant.** C plus a per-install idempotent claim, a per-/24 network
  limit, a global daily cap wired to cohort pause, and an app-version check.

Every option shares the cost guardrails (§4, §5.3). The trust event changes **who can draw
on the global daily cap, and how cheaply**. It does not change the money bound.

### 2A.1 Corrections the comparison depends on

**A-1. A does not go through `claimSeat`, and a ₩0 product cannot exist today.** The plan's row
says "Google/email sign-in → `claimSeat`". The code says otherwise:

- `svc:lib/purchase.ts:152` `parseProduct` rejects `amount < 100`. A ₩0 product makes
  `purchaseConfig` return null, which switches **all** purchasing off. Toss confirm
  (`purchase.ts:110-127`) also has nothing to capture at ₩0. [CODE]
- On Service main, account-owned orders cannot use the claim route at all:
  `svc-main:routes/purchase.ts` `/orders/:id/claim` returns
  `409 account_activation_required` when `order.account_id` is set. [CODE]
- Account passes are minted by `svc-main:lib/accounts.ts` `activatePass()`: `addToRoster` →
  `INSERT OR IGNORE INTO native_trials … owner_id 'purchase'`, bound to the account session. [CODE]
- So A is "a **free entitlement** on an account, minted the way `activatePass` mints a paid
  one". It needs a new free-entitlement row or table: one per account, with no order and no
  provider. It is not a ₩0 SKU.

**A-2. The Service half of the account system merged today, after this design's baseline.**

- `264564e` "feat(accounts): add gated personal accounts and owned Studio passes (#99)" landed
  on Service `origin/main` at 2026-10-18 22:31 KST. `2cf66dc` (#124: refresh, callback and
  operational safeguards) landed at 22:56. [CODE: `git merge-base --is-ancestor`]
- Both are **default-off**: `HPS_ACCOUNTS`, `HPS_ACCOUNT_EMAIL` and
  `HPS_ACCOUNT_GUEST_CHECKOUT` in `svc-main:env.ts`. They need migration
  `0047-personal-accounts.sql`. [CODE]
- The #99 commit message says: "No production flags, schema or deployment were changed". It
  lists what remains as launch work: "Public Google signup, … actual payment/refund, legal
  approval, transactional email, retention purge, released Mac/Windows sign-in". [DOC]
- The Studio half, branch `origin/feat/account-system-preview-20261015` (PR #1702), is **not**
  an ancestor of Studio `origin/main` `1d0b6e95` (local refs as of 23:06 KST). Its newest
  commit is from 23:05 KST. [CODE]
- ctx-trial records #1701 as OPEN and #1702 as OPEN draft [DOC; GitHub not re-read, gh not
  used]. Lab companion hypeprooflab#1258: state unknown.

**A-3. The §5.3 capacity column was off (now corrected there).** §5.3 first converted
₩100k / ₩300k / ₩1M into "≈ 55 / 165 / 550 trials at the per-trial ceiling". At ₩2,100 per
trial the figures are **47 / 142 / 476**. Applying the one-request overshoot (§5.3 reserve
≈ $0.48, so a trial can reach ≈ $1.98 ≈ ₩2,775) gives a floor of **36 / 108 / 360**. All of
these use the placeholder R = ₩1,400.

### 2A.2 Comparison

| | **A. Account (Google) → free entitlement** | **B. Email OTP → roster + mint** | **C. Anonymous device grant** | **C′. This design (§3)** |
|---|---|---|---|---|
| **Trust event** | A verified Google identity: Lab's OAuth bridge calls `upsertAccount`, which needs `provider:'google'` and `email_verified:true` (`svc-main:lib/accounts.ts:138-140`). App sign-in uses the device flow (`/auth/device/start`, `/poll`; table `device_sign_ins`). Uniqueness key is `account_identities` PK `(provider, subject)` [CODE] | Control of one mailbox for a few minutes | None. A client-generated device id | C plus server-side KV counters: 1 per `install_id`, ≤ 5 per /24 per 24 h, a global daily cap, and an `app_version` floor |
| **Reused code** | Accounts, consents, sessions, device sign-in, export and delete (`svc-main:routes/accounts.ts`). `activatePass` is the mint template (roster → `native_trials`). `accountRate` and `account_rate_limits` handle limits. `purchase_orders.account_id` and the `account_passes` view link orders. Gate self-heal already covers `owner_id 'purchase'` (`svc:lib/chat-gate.ts:211-215`) [CODE] | The mint triple in `claimSeat` (`svc:lib/purchase.ts:358-391`): `addToRoster` → `issue({native_trial:true})` → `createNativeGrant`. The admin route does the last two (`svc:routes/admin.ts:367,378`) but only checks the roster (`:365`); the operator appends separately (G2a). Call the functions in-process, not through the admin HTTP route, which needs Basic or issuer auth. `bumpRateCounter` (`svc:routes/purchase.ts:98`). `EMAIL_RE` (`svc:lib/classroom-delivery.ts:22`). The Resend adapter (`svc:lib/classroom-delivery-resend.ts`) [CODE] | The same mint triple. `createNativeGrant` upsert for idempotency. `bumpRateCounter` [CODE] | The same as C, plus cohort pause (`chat-gate.ts:216`) as the global stop [CODE] |
| **New code** | A free-entitlement row/route ("one per account, ever"). App entry "AI 체험하기 → 로그인". Start gate refuses under-14 (already in `upsertAccount`) | OTP table with expiry and attempt cap. Send and verify endpoints. A new reviewed email template: Resend refuses unlisted template revisions. Address normalization. Disposable-domain list. Lab or App form | `POST /v1/trial/claim`. `install_id`. KV counters | §3.1–§3.3 in full, including the roster bypass |
| **Dependencies** | Service #99/#124 merged but off (A-2). Studio #1702 unmerged. Lab #1258 unknown [DOC]. Launch gates per #99: Google provider acceptance, legal, released-app sign-in, retention purge. Migration 0047 in prod | **No transactional email exists in prod.** The Resend adapter says: "No account exists yet: nothing here has been run against the real API, a sandbox or a real inbox" (`classroom-delivery-resend.ts:6-7`) [CODE]. Needs a sending domain (SPF/DKIM) and deliverability checks [INFERRED] | None beyond the design's Phase 0/1 | Same as C |
| **Shared prerequisites (all options)** | Code-free install with the SDK binary (#1617). Open-trial profile and cost guardrails (§4, §5.3). Roster scale fix (§3.3): `activatePass` also writes the single KV roster value | ← | ← | ← |
| **Sybil cost per extra trial** | One more Google account. Google raises the cost of bulk account creation (phone checks at volume) [INFERRED]. This is the highest per-identity cost of the four | One more working mailbox. Near zero with disposable domains or `+tag`/dot aliases unless normalized and blocked; still cheap after that [INFERRED] | **About zero.** A script POSTs random device ids | One more /24 per 5 claims. Rotating residential or cloud proxies, and IPv6 /48s, make this cheap [INFERRED]. `install_id` is client-generated, so it stops reinstalls by honest users, not scripts |
| **Abuse loss, bounded by §5.3** | Money: ≤ daily cap (D2) for every option. Per identity: ≤ ≈ ₩2,775 (ceiling plus one overshoot, A-3) | ← | ← | ← |
| **Who exhausts the cap** | An attacker needs about 36–108 Google accounts per day to drain a ₩100k–₩300k cap | 36–108 accepted mailboxes per day | One script, in minutes | 8–22 distinct /24s per day (36–108 ÷ 5) |
| **Effect of a drained cap** | Real users get "오늘 무료 체험이 모두 찼습니다…" until 00:00 KST. Abuse becomes **denial of the trial**, not open-ended spend | ← | ← | ← |
| **Second use of a grant** | The grant is a bearer token for `/v1/messages`: a free Sonnet proxy worth ≤ the per-trial ceiling. Same in all four. Shrinking the free model list (§4) lowers its value | ← | ← | ← |
| **Friction before first value** [INFERRED: from the flows; not walked] | "AI 체험하기" → age and three required consents (terms, privacy, overseas transfer: `upsertAccount` refuses without them) → browser: Google account picker → confirm the device number → back in the App → preview → "이 활동 시작하기". About 6–7 actions and **one App↔browser switch**. People without a Google account cannot enter | "AI 체험하기" → age → type email → consent → mail app → read and type a 6-digit code → preview → start. About 7–9 actions, **one App↔mail switch** and a delivery wait. Fails silently on spam folders | "AI 체험하기" → age → preview → start. About 3 actions, no switch | Same as C. A "venue" bypass is needed for classrooms sharing one address |
| **Friction at purchase** | None added. The account already exists and owns the pass (`account_passes`) | An account, or guest checkout with the email typed again | Guest checkout today. An account later if subscription needs one (§7.4) | Same as C |
| **PII held / PIPA** | **Most data, and the most compliance machinery already built.** `accounts.email`, `display_name`, the Google `subject`. Versioned consents in `account_consents` (terms, privacy, overseas_transfer, marketing). Self-service export (`/me/export`) and delete (`DELETE /me`). Retention flags (`HPS_ACCOUNT_RETENTION_*`) [CODE]. Legal review of the wording is still a launch gate [DOC] | An email address with no account around it. Needs its own collection consent, retention and deletion rules, plus disclosure of the processor and overseas transfer (Resend). Nothing is built [INFERRED] | Salted hashes of the device id and network prefix. Whether these are personal data is open (§11) | Same as C |
| **Overseas-transfer consent for model calls** | Captured at signup (`overseas_transfer` is required) [CODE] | Needs a new consent screen | Needs a new consent screen. No account to record it against | Same as C |
| **Minors** | Age is self-declared. The schema allows only `age_band '14+'` (`0047` CHECK), and `upsertAccount` refuses anything else with `403 age_restricted` [CODE]. Under-14 is told "수업 참여 코드를 받아 시작해 주세요" (#1702 `docs/age-verification.md` §Personal-account preview) [DOC]. 14–18 reach the adult, unmoderated profile, the same gap passes already have (§6.4) | The age question must come **before** the address is collected; an under-14 email needs guardian consent (§6.3 row 1) [INFERRED] | Self-declared; nothing to tie it to | §6.1 question; under-14 is a dead end until D10 |
| **US-04 as written** ("서버가 확정 정책으로 본인 자격과 발급 이력을 검증") | Met. The identity and issuance history are the account [INFERRED] | Partly met: mailbox control is weak identity | **Conflicts.** US-04 needs a rewrite | Conflicts (§3.1) |
| **`age-verification.md` argument** | The #1702 branch already rewrites it for "public signup for 14+ only" [DOC] | Needs a rewrite | Needs a rewrite. "no anonymous access" becomes false | Same as C |
| **Trial → order link** | **Native.** Entitlement and order both carry `account_id` (`purchase_orders.account_id`, `svc-main:lib/purchase.ts` `createOrder(…, accountId)`) [CODE]. Survives reinstall, a second device and web checkout on the Lab | Only if the buyer types the same email at checkout (orders store no email today), or the App forwards a trial id. Normalization errors split people | Only through the App-held `trial_id` sent with the order (new `purchase_orders.trial_id`, §8.1). **Lost** when the buyer pays on the Lab web checkout or another device, or reinstalls | Same as C |
| **Re-trial rule** | 1 per Google subject, ever. Account deletion must not reset it, so keep a hash of `(provider, subject)` after `DELETE /me` [INFERRED; today's delete removes the identity row] | 1 per normalized address | Unenforceable | 1 per install, per honest user |

### 2A.3 What the table says

1. **Money is bounded by the same caps under every option.** The per-trial ceiling and the
   global daily cap (§5.3) are what keep spend finite. The trust event only decides how
   cheaply a stranger can **use up** the day's cap and lock real users out. C and C′ hand that
   lever to anyone with a script or a few proxies. A makes it cost a batch of Google accounts
   per day.
2. **A's real cost is friction, and it lands where Jay's goal needs it anyway.** A subscription
   needs an account (§7.4). Under C′ the account step moves to the moment of purchase, and the
   trial→purchase link then depends on the App relaying a `trial_id`. Under A the step comes
   before first value, and the link is free and survives web checkout.
   - P0 found that **no** link exists today (report §2) (`pass-<orderhash>` ids, `access_accounts` = 0 rows).
   - Converting users is the trial's purpose (Jay, decision 2).
   - So measurability carries more weight than in a generic growth trade-off.
3. **B is the weakest standalone option.** It has most of A's friction (a context switch,
   typing, a wait) and an identity almost as cheap as C's. It adds a new PII store with no
   compliance machinery and depends on an email provider that has never sent a message from
   prod. B is worth keeping only as **a second sign-in provider inside A**, for people
   without Google. In that form it writes into `accounts`/`account_identities` with
   `provider 'email'` and does not get a parallel grant path.
4. **C′'s checks are still useful, as secondary limits.** Per-install and per-network
   counters cost little and slow down scripted abuse under any option. Under A they become
   rate limits on accounts, not the trust event.
5. **Every option needs the §3.3 roster fix.** `activatePass` and `claimSeat` both write the
   single KV roster value. That write pattern, not the trust event, is the scale risk.
6. **Cross-cutting catch:** a free window longer than 1 h is classified as a pass.
   `isPassGrant` is `duration_ms > 3600000` (`svc:lib/native-trial-grants.ts:28-30`). That
   affects:
   - the 240 s timeout
   - pass wording in gate errors (`chat-gate.ts:218-220`)
   - the owner console's `trial`/`pass` split (`owner-usage.ts:62-68`, P0 §4)

   The D5 24 h window and the E2 24 h arm (§3.4) therefore need an explicit `purpose` on the
   grant (`svc-grant-purpose-timestamps`) under any option, before they ship.

### 2A.4 Recommendation for Jay

**Make A the public entry. Run B only as a fallback sign-in inside A. Do not ship C or C′ as
the public trust event. Keep C′'s install and network counters as secondary limits.**

Reasons:

- **It meets both of Jay's decisions.** Signing in is not an issued code, so the trial is open
  to everyone with no operator in the loop (decision 1). A is the only option that links a
  trial to a later order without App-side plumbing, across devices and through web checkout
  (decision 2).
- **Most of it is already built.** It is off and unlaunched, but merged on Service main today:
  consents (including overseas transfer), the 14+ age gate, export, delete, device sign-in,
  and account-owned passes. C′ would build a second, parallel compliance story from zero.
- **It is the only option where using up the day's free budget costs an attacker more than a
  script.**
- **US-04 and the #1702 rewrite of `age-verification.md` already describe this shape.** C′
  needs both rewritten.

What it costs, stated plainly:

- **Launch moves behind the account launch gates:** Google provider acceptance, legal review
  of consent wording, Studio #1702 merged and released, and migration 0047 in prod. C′
  depends on none of these.
- **About 3–4 more actions and one browser switch before first value**, and no entry for
  people without a Google account until B-as-provider exists. This is INFERRED. With n = 0
  real trial users (P0), nobody knows how many people that loses. Measure it in the T25 pilot
  (≥ 5 adults): time and drop-off between "AI 체험하기" and the first message.
- **One new piece:** a free-entitlement mint on accounts ("1 per Google subject, ever", kept
  across account deletion as a hash). The ₩0-product route in the plan does not work (A-1).

Choose C′ instead (D17) only if the trial must be live **before** accounts can launch, with
explicit acceptance of three things:

- the daily cap, not identity, is the real control
- a scripted attacker can close the free trial for a day at no cost to them
- conversion is measurable only for people who buy inside the App

If that interim is chosen, plan from day one to migrate entry to A when accounts launch. US-04
and `age-verification.md` must be rewritten for the interim either way.

Decision rows: D15 (trust event), D17 (C′ as interim) and D18 (free-entitlement rule under A)
in §10.

### 2A.5 Follow-ups this section creates elsewhere in the design

Applied in this revision:

- §1 "Entry": A is the primary path; C′ is the interim (D17).
- §3.1: A's entry flow added; the US-04 amendment and lazy identity apply to C′ only.
- §5.3: capacity column corrected (A-3).
- §10: D15 aligned with the report; D17–D21 added.

Still open (not rewritten yet):

- §3.2: under A, the trust event is the account, and `install_id` and network counters become
  rate limits (§5.3). The table still describes C′.
- §3.3: unchanged. The roster bypass is needed for `activatePass` seats too.
- §6: under A, the under-14 refusal and copy already exist in Service and in #1702. §6.1's
  question becomes the signup age declaration.
- §7.4 and §9 Phase 4: under A, accounts are a Phase 2 dependency, not only a Phase 4 one.
- §8.1: under A, `trial_id` on orders is redundant. Key events by a hash of the `account_id`.
- §11: Studio #1702 / Lab #1258 merge and release state (GitHub not read here).

---

## 3. Entry: account sign-in (A), zero-gate claim as interim (C′)

### 3.1 Flow

Primary path, option A (§2A.4, D15). Depends on the account launch gates: Service #99/#124
flags on, migration 0047 in prod, Studio #1702 merged and released, Google provider
acceptance and legal review of the consent wording.

```
Start page "AI 체험하기"
  → device sign-in (#1702: /auth/device/start, /poll) → browser: Google account picker
    → age declaration (14+ only; under-14 refused by upsertAccount, 403 age_restricted)
    → required consents: terms, privacy, overseas_transfer
  → Service: free entitlement, 1 per (provider, subject) ever (D18), minted like activatePass()
    → addToRoster/skip (§3.3) → native_trials row in studio-open-trial (FREE_LIMITS)
  → existing preview → "이 활동 시작하기" → empty workspace ~/HypeProofTrial → chat
```

Interim path, option C′ (D17). Ships only if the trial must go live before the account launch
gates clear, and is sunset when A launches. The rest of §3.1 and §3.2 describe this path.

```
Start page "AI 체험하기"
  → (age question, §6.1)
  → App: POST /v1/trial/claim {install_id, age_band, app_version}
  → Service trust checks (§3.2) → addToRoster/skip (§3.3) → issue(native_trial) → createNativeGrant(owner 'open-trial', FREE_LIMITS)
  → App stores code in SecretStorage (never shown, never sent to webview — same rule as REQ-L12 ③)
  → existing preview → "이 활동 시작하기" → empty workspace ~/HypeProofTrial → chat
```

- The user never sees or types a code. "수업에 참여하기" keeps the code field. The P0 code
  path of US-04 ("유효한 기존 코드로 체험/수업을 확인·시작한다") stays unchanged. This holds on
  both paths.
- **US-04 under A.** US-04 (`docs/requirements/unified-studio-experience.md:18`) says: "코드
  없는 공개 체험은 서버가 확정 정책으로 **본인 자격과 발급 이력**을 검증한 뒤 기존 권한 경로로
  발급한다". Under A the account is the identity and the per-subject entitlement record is the
  issuance history, so the row holds as written [INFERRED]; only the free-entitlement rule
  (D18) needs to be named in it.
- **Conflict with US-04 under C′ (P1 public issuance).** C′ collects no identity at entry, so
  it cannot verify "본인 자격" in the sense of a person.
  It verifies the issuance history of an **install** and a **network**, under a global
  budget. That is weaker than the row as written, and the design must not claim to satisfy
  it unchanged.
- **Proposed US-04 amendment, C′ interim only** (Phase 2, §9). Replace "본인 자격과 발급
  이력" with a definition of the confirmed policy that matches the trust event:
  - eligibility = the server-held install/network/global checks of §3.2, plus the
    self-declared age band (§6.1), not a verified person;
  - issuance history = per-install and per-network claim records (hashed), checked before
    each mint;
  - the row states explicitly that it **does not** prevent one person from claiming again
    by reinstalling on another device or network, and that the per-trial and global
    currency ceilings (§5.3) bound the cost of that abuse.

  If A ships first, this amendment is not needed. If C′ ships as the interim, the amended
  row must be reverted to the identity wording when A replaces it (D15, D17).
- **Idempotent claim.** Under A, the same `(provider, subject)` gets the **same** entitlement
  back. Under C′, the same `install_id` gets the **same** grant back. This holds after
  a lost response, a double click or a re-entry (US-04: "응답 유실/중복 클릭/재진입이 권한·한도를
  중복 생성하지 않는다"). Implement it as `createNativeGrant` upsert keyed on
  `(cohort, profile, user_id = 'ot-' + H(install_id))`. Reissue already keeps usage
  (`MIN(issued_expires_at)`, `requests_used` kept) [CODE].
- **Identity at entry (A), lazy identity only under C′.** Under A the account is asked for
  **before** first value. That goes against [SKILL] signup ("show value before asking for
  commitment", "defer collection") and costs about 3–4 more actions and one App↔browser switch
  [INFERRED, §2A.2]. It is accepted because the trial exists to convert (decision 2): a
  subscription needs an account anyway (§7.4), and only an account links a trial to a later
  order across devices and web checkout. A collects only what the account system already holds
  (email, display name, Google subject, versioned consents), which keeps PRODUCT-INTENT
  "Minimum necessary intervention" within the account's existing scope. Measure the drop-off
  between "AI 체험하기" and the first message in the T25 pilot.
  Under the C′ interim, entry asks for no name, email or phone, and an account (#1701) is
  requested only at checkout. That is the lazy-identity pattern the skill recommends, bought at
  the cost of the trial→order link (§2A.3 item 2).

### 3.2 Trust event (what replaces operator vetting)

The operator's real job today is anti-Sybil: a vetted person gets one seat [CODE, ctx-trial
§3]. Without an identity, no single check replaces that. The design stacks cheap checks and
**accepts bounded abuse**, priced in §5:

| Check | Where | Default proposal | Notes |
|---|---|---|---|
| Per-install | `install_id`: random 128-bit, created on first run, kept in SecretStorage | 1 free trial per install, ever | Defeated by reinstall or a new OS user. Raises the cost of abuse; it is not proof of a new person |
| Per-network | KV counter on `H(cf-connecting-ip /24 or /48)` | ≤ 5 claims per 24 h | A classroom or venue shares one address (the comment at `routes/purchase.ts:40` says this for orders). Allow an operator-held "venue" bypass. Do not raise the default |
| Global | Daily claim count and daily currency spend (§5.3) | Owner-set | Hard stop through cohort pause |
| App provenance | `app_version` ≥ the minimum with the SDK binary | Refuse with a clear update message | Avoids the 409 dead end |
| Optional step-up | Email OTP or phone, **only** when per-network or global pressure trips | Off at launch | An A/B lever, not an entry gate |

Out of scope: device attestation, CAPTCHA. Nothing in the repo provides either, and both
add friction before value.

Server-side storage rule: the Service keeps only **hashes** of `install_id` and the network
prefix, salted with a server secret and rotated. The raw IP is not stored beyond the
existing Cloudflare request logs. §8 covers PII.

### 3.3 Roster at public scale (design risk)

The roster is **one KV value per cohort**. A concurrent write can drop an entry
(`chat-gate.ts:212` comment) [CODE], and memory records about 60 s of propagation lag after
an append [DOC/memory]. Thousands of open-trial seats would mean:

- every chat request reads a growing single value
- every claim does a read-modify-write that races with every other claim

Proposal: for grants whose `owner_id` is server-trusted (`purchase`, `open-trial`), the
**grant row is the allowlist**. The gate accepts `isCurrentNativeGrant(grant) &&
owner_id ∈ {purchase, open-trial}` without a roster lookup. Operator-issued seats keep the
roster. This is a **security-relevant gate change**: Service owner review is required, and
the REQ change goes in NAT-02.

### 3.4 Clock and allowance semantics

| Today [CODE] | Proposal | Requirement |
|---|---|---|
| Clock starts at the first gated request, which is `/v1/profile` during code verification (`chat-gate.ts:209-230`) | Clock starts at the **first admitted `/v1/messages` reservation**. `/v1/profile` and `/v1/activity` read the grant but do not start it | NAT-11 modify |
| Window 1 h | 24 h from first message (A/B arm: 1 h vs 24 h vs none-with-turn-cap) | NAT-11 modify, AB experiment E2 |
| 40 **attempts**: each SDK tool step and each failed call counts (5 user turns used 10 requests) [DOC] | Count **user turns**. The App sends `x-hps-turn-id` (UUID per user message); the Service counts distinct turn ids. Free allowance proposal: **10 turns**. Hidden guards per turn: **≤ 15 attempts** and the currency ceiling | NAT-11, MU-04 modify |
| Failed attempts are charged | A failed attempt that **reached** the provider still costs money and counts against the **currency** ceiling. It does **not** consume a user turn. A failure before dispatch costs nothing | NAT-11 |

Why turns: the user can see and plan turns. "40 requests" silently drains during one long
tool loop. A lying client can only reuse turn ids, and the per-turn attempt guard plus the
currency ceiling bound that.

**A 24 h window is a pass in today's code.** `isPassGrant` is `duration_ms > 3600000`
(`svc:lib/native-trial-grants.ts:28-30`, `NATIVE_TRIAL_LIMITS.duration_ms` = 1 h) [CODE]. A free
grant minted with a 24 h window is therefore treated as a bought pass everywhere that function
or the same threshold is read:

- request timeout 240 s instead of 60 s (`nativeRequestTimeoutMs`), which also raises the
  realistic worst-case output per request in §5.2 from about 3.9K tokens to the 8,192 cap
- pass wording ("이용권…") in the exhaustion, revoked and expired errors
  (`middleware/native-trial-budget.ts:164-166`, `lib/chat-gate.ts:218-220`)
- the `pass` block in `/v1/profile` (`routes/chat.ts:503`), which the App labels as a pass
- dispatch purpose `pass` in `usage-dispatch.ts:17` and the owner console's `trial`/`pass`
  split (`owner-usage.ts:66`, `duration_ms<=3600000`), so free use is counted as paid use
- image edits refused with `media_budget_not_supported` (`routes/image-edits.ts:46`)

So the 24 h proposal (D5) and the 24 h arm of E2 **must not ship until
`svc-grant-purpose-timestamps` lands** (explicit `purpose` set at mint; `isPassGrant` and owner
usage read it, falling back to `duration_ms` only for legacy rows; diagnosis report
Appendix A fix card). Until
then only the 1 h window is safe.

---

## 4. Free-tier model restriction

The trial profile allows Opus 5.5, Opus 5, Opus 4.8/4.6/4.5, Sonnet 5.5/5/4.5, Haiku 5.5,
and the `hypeproof-*` aliases. It allows effort up to `high` and `web_search` (2 uses)
[CODE `svc:profiles/studio-native-trial.ts`]. For a free, open, abuse-exposed tier:

- **Allowed:** `claude-sonnet-5-5` (default, via `hypeproof-default`) and `claude-haiku-5-5`
  (fallback / helper calls).
- **Removed on the free tier:**
  - all Opus models (2x Sonnet 5.5 cost per token)
  - `claude-opus-4-5-20251101` and `claude-sonnet-4-5-20250929`: no current price in the
    claude-api skill table or the Service price set, so they are **unpriced**, and an
    unpriced model cannot sit under a currency ceiling
- **Effort:** `low`/`medium` only.
- **`web_search`:** off on the free tier. It is billed per search ($10 per 1,000 [SKILL
  claude-api, managed-agents list cost]) and has no meter in the trial ceiling yet. AB's
  design also keeps hosted tools off the managed path until metered [DOC].
- **Display.** The model menu shows only allowed models. Do not show locked models as a
  teaser: that would be a feature-gate paywall during work (§7.2).
- This is a new **profile** (`studio-open-trial`), not a change to `studio-native-trial`.
  Passes and operator codes keep their current model rights. The pass profile must not move
  with the free one; the existing profile comments warn about exactly this spread hazard.

---

## 5. Cost and abuse

### 5.1 Prices used (never from memory)

| Model | Input | Output | Cache read | 5 m write | 1 h write | Source |
|---|---|---|---|---|---|---|
| Sonnet 5.5 | $2 | $10 | **$0.10 or $0.20** | $2.50 | $4 | claude-api skill (cached 2026-10-06) lists $0.20; the Studio repo's `docs/requirements/access-budget-settlement.md:64-67` (§Claude 5.5) and `svc:scripts/compare-providers.mjs:62-77` use $0.10, and the Studio doc records the conflict |
| Opus 5.5 | $4 | $20 | $0.20 | $5 | $8 | Both sources agree |
| Haiku 5.5 (≤100K prompt) | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 | Both; the >100K card is $0.50/$2.50/$0.05/$0.625/$1 |
| Opus 5 / 4.8 | $5 | $25 | $0.50* | $6.25* | $10* | Skill table (in/out). *Derived at the documented 0.1x / 1.25x / 2x multipliers, not quoted |
| Web search | $10 per 1,000 searches | | | | | claude-api skill (managed-agents list cost) |

Per MTok, USD. Do not approve a free-tier price revision until the Sonnet 5.5 cache-read
conflict is resolved. The Studio doc already says "승인 전에 확인한다".

**No approved price revision exists for the trial's models.** `config/usage-prices/` (Studio
repo) holds only `haiku55-20261016.json`: `fx: null`, a one-day window, and a revision id
ending in `-draft` although it says `publication: approved` [CODE]. There is no revision for
**Sonnet 5.5** (the trial default), Sonnet 5, or any Opus model. The gap is wider than the
two unpriced legacy models in §4.

**FX.** The repo has no FX revision, and the AB requirement forbids operational defaults
("공급자 요율/환율/상한의 운영 기본값은 없다"). KRW figures below use a **placeholder
R = ₩1,400/USD** for planning only. The owner sets a real `fx` revision before enforcement.

### 5.2 What a trial costs

Measured profile: [PROBE] `GET /admin/cohorts/studio-native-trial/usage` (read-only,
2026-10-18), 67 records, 2026-09-08 → 2026-10-18. The cohort mixes trial, pass and test seats
(`unattributed_session_records: 67`), so treat these numbers as an indication only.

| Model | n | Mean tokens per successful request: in / out / cache read / cache write |
|---|---|---|
| claude-sonnet-5-5 | 37 (8 users, all 200) | 179 / 668 / 13,281 / 5,461 |
| claude-sonnet-4-6 | 27 (3 users; 4 failed with tokens) | 96 / 2,290 / 18,526 / 8,228 |
| claude-opus-5-5 | 3 (1 user, internal probe `probe-55-a`, 2026-10-14) | 21 / 45 / 3,478 / 8,039 |

The 3 Opus 5.5 records are short internal probe calls. They cost $0.042 per request on
average and $0.069 at most (cache writes as 5 m), so they say nothing about real Opus use.
The Opus rows below reprice the Sonnet 5.5 profile instead.

Cost per request and per trial, using the Sonnet 5.5 mean profile with cache writes as 5 m.
The two right-hand column pairs are bounds, not measurements:

- **Realistic worst case** [INFERRED]. The 200,000-byte body limit
  (`svc:middleware/native-trial-budget.ts:82-93`) counts **bytes**, not tokens. Typical JSON,
  English or Korean runs about 3–4 bytes per token, so a full body is about 50–70K tokens,
  priced here as a 1 h cache write. The trial's 60 s timeout truncates billed output at
  about 3.9K tokens (65 tok/s, per the code comment). Two sources add input beyond the body
  and are not in this figure: the Service-side system prompt (`svc:routes/messages.ts:434`)
  and `web_search` results.
- **Adversarial envelope**. The previous "theoretical bound": 200K input tokens as a 1 h
  write plus 8,192 output tokens. It needs a body at about 1 byte per token, so it is an
  upper envelope, not the expected bound.

| Model | Mean / request | 40 requests (today's allowance) | 40 × largest observed request | Realistic worst case / request | × 40 | Adversarial envelope / request | × 40 |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | $0.022–0.023 (≈ ₩31–33) | **$0.88–0.93 (≈ ₩1,250–1,300)** | **$3.0** (largest: $0.076) | ≈ $0.24–0.32 | **≈ $12** | $0.88 | $35 |
| Opus 5.5 | $0.044 | $1.76 | — (only 3 probe records; $2.8 from those) | ≈ $0.48–0.64 | ≈ $22 | $1.76 | $71 |
| Opus 5 / 4.8 | $0.058 | $2.33 | — (no records) | ≈ $0.60–0.80 | **≈ $30** | $2.21 | $88 |
| Haiku 5.5 | $0.0012 | $0.05 | — (no records) | ≈ $0.012–0.016 (≤100K card) | ≈ $0.6 | $0.22 (>100K card) | $8.8 |

The largest single request in the probe across all models is a `claude-sonnet-4-6` row.
Priced at Sonnet 5.5 rates, 40 of it would cost about $6.3.

Reading the table:

- The **attempt cap does not bound money**. The realistic worst case is about 13x the
  typical fully used Sonnet 5.5 trial ($12 vs $0.9), and about 33x with Opus 5 / 4.8. The
  adversarial envelope is about 40x.
- Removing Opus from the free tier halves the typical cost and cuts the worst case by about
  2.5x ($30 → $12).
- "40 requests" is the **full allowance**, not an observed trial. Observed use in the mixed
  cohort is 37 Sonnet 5.5 requests across 8 users, about 4.6 per user.

### 5.3 Proposed ceilings (owner sets the numbers)

| Control | Proposal | Mechanism |
|---|---|---|
| Per-trial ceiling | **$1.50 provider cost (≈ ₩2,100 at R)**: about 1.6x the mean 40-request Sonnet trial | New grant column `cost_ceiling_micro` + settled `cost_used_micro`. Admission refuses when `cost_used + reserve(next) > ceiling`. `reserve(next)` = per-request bound for the free profile. Settlement comes from `usage_log` tokens × approved price revision. Overshoot is limited to one request's settled cost |
| Per-request bound (free profile) | Input 100K tokens, output 8,192 | Lowers `reserve(next)` to about $0.48 on Sonnet 5.5 (100K × $4 + 8,192 × $10). The 200 KB byte limit stays as the parser guard |
| Global daily ceiling | Owner-set KRW per day, e.g. ₩100k / ₩300k / ₩1M ≈ **47 / 142 / 476** trials at the per-trial ceiling (₩2,100), or **36 / 108 / 360** if every trial also takes the one-request overshoot ($1.50 + $0.48 reserve ≈ $1.98 ≈ ₩2,775). At the mean full 40-request Sonnet 5.5 trial (₩1,233–1,308, §5.2) it is ≈ 76–81 / 229–243 / 765–811. All at the placeholder R = ₩1,400 | Daily KV/D1 counter of settled + reserved free-tier cost. On crossing: pause cohort `studio-open-trial` (503 `cohort_paused`), alert, auto-unpause at 00:00 KST |
| Claim rate | Per install 1; per network /24 ≤ 5 per 24 h; global claims per hour ≤ N | KV counters (§3.2) |
| Concurrency | 1 per grant (exists) | Unchanged |
| Kill switch | Cohort pause (exists) | The new profile has its own cohort, so pausing the free trial never pauses passes or classes |

Two copy cases:

- **Paused.** The user sees "오늘 무료 체험이 모두 찼습니다. 내일 다시 시작할 수 있습니다. 만든
  파일은 그대로 있습니다." The current "체험이 일시정지되었습니다." does not say what to do.
- **Ceiling reached before the turn limit.** It reads like the turn limit. Never surface
  money to the user (§7.2).

### 5.4 Unit economics (for the conversion target)

- Pass revenue net of 10% VAT: ₩30,000 / ₩50,000 / ₩99,000. **[INFERRED]** The round
  ex-VAT figures suggest the listed prices include VAT. Toss fees are not in the repo.
- Pass provider cost at the mean Sonnet profile: 200 × ₩31 ≈ ₩6,200. With Opus at the same
  unit ≈ ₩12,400 [AB-10 DOC: "Opus 5.5 의 토큰 단가는 Sonnet 5.5 의 두 배"].
- Contribution per 라이트 conversion: **₩23,800** (₩30,000 − ₩6,200, Sonnet-class pass use)
  or **₩17,600** (Opus-class pass use). Both assume all 200 requests are used. The Toss fee is
  not in the repo; an **illustrative** 3.4% of ₩33,000 (₩1,122) moves the Sonnet figure to
  ₩22,678 [ASSUMPTION].

**Proposed free tier, not today's allowance.** The figures below price the tier this design
proposes: 10 user turns (D5), Sonnet 5.5 + Haiku 5.5 only (D6), the $1.50 ceiling (D1) and a
100K-input per-request bound (§5.3). They replace the earlier 40-attempt figures (5.5% / 9%).
Inputs: `GET /admin/cohorts/studio-native-trial/usage` (2026-10-18, 67 rows) and the §5.1
prices, 5 m cache writes, cache read $0.10 (low) / $0.20 (high), **R = ₩1,400 placeholder**.

Attempts per turn [DOC + INFERRED]:

- [DOC] Haiku persona: 5 turns → 10 requests (2.0 per turn).
- [INFERRED] `jay-rc-test-20261018`, the only real App session on Sonnet 5.5 (15 rows,
  internal): 5 turns → 15 requests (3.0 per turn: 2.2 coach + 0.8 helper; per-turn sizes
  2/1/2/3/7). Turns are grouped by gaps > 10 s between request end and next start. The result
  is the same at 5 s and 20 s.
- [INFERRED] B1 (`pass-6f5…`, internal, Sonnet 4.6): 6 turns → 23 requests (3.8 per turn),
  including 4 × 502 and 4 × 8,192-token outputs.

Per-request cost is not flat. In that session, every coach request reads only the
20,064-token system prefix from cache. It re-writes the conversation after it at 1.25x
(`cache_write` 967 → 9,153 over the session) instead of reading it at 0.1x. The cost of a turn
therefore grows with conversation length. Fitted to the observed 5-turn cost ($0.285), the
conversation grows by about 1,180 tokens per turn [INFERRED].

| Scenario: one trial, all 10 turns used | Cost per trial | ₩ at R | Break-even → 라이트 (₩23,800 / ₩17,600) | Daily cap ₩100k / ₩300k / ₩1M (trials) |
|---|---|---|---|---|
| Low: 2 req/turn × flat mean $0.022 | $0.44–0.47 | 616–655 | 2.6% / 3.5% | 162 / 487 / 1,623 |
| **Central: measured session, growth-fitted** | **$0.68–0.73** | **954–1,027** | **4.0% / 5.4%** | **104 / 314 / 1,048** |
| Central, helper calls on Haiku 5.5 | $0.59–0.64 | 827–889 | 3.5% / 4.7% | 120 / 362 / 1,208 |
| Central, conversation cache hit fixed | $0.40–0.46 | 559–650 | 2.3% / 3.2% | 178 / 536 / 1,789 |
| Heavy (B1 profile repriced; $1.74–1.83 raw) | capped $1.50 | 2,100 | 8.8% / 11.9% | 47 / 142 / 476 |
| Every trial at the ceiling | $1.50 | 2,100 | 8.8% / 11.9% | 47 / 142 / 476 |
| Ceiling + one-request overshoot ($0.48) | $1.98 | 2,775 | 11.7% / 15.8% | 36 / 108 / 360 |

₩ and the break-even and cap columns use the low cache-read price. Break-even = trial cost ÷
contribution per conversion. It is the share of **started** trials that must buy 라이트.
Daily-cap figures are trial-equivalents of spend per day: a 24 h trial spreads across two
counter days.

Reading it:

- **Expected cost per trial ≈ $0.7 (≈ ₩1,000) at full use.** The 5-turn session the model
  was fitted to cost $0.285–0.31 (≈ ₩400–430; break-even ≈ 1.7%). The turns a real user
  takes are unmeasured: no external person has held a free grant (P0). Treat full use as the
  planning number.
- **Break-even target: ≈ 4–5% expected, ≈ 9–12% if every trial maxes out.** With the
  illustrative Toss fee the central figure is 4.2%. This is the number the funnel (§8) has to
  beat. It ignores abuse, support and refunds.
- **The ceiling binds only heavy or abusive use.** Central use sits at about 45–49% of $1.50.
  The floor capacity of the daily cap (every trial adversarial) is **36–47 / 108–142 /
  360–476**. Expected capacity is about **104 / 314 / 1,048**. A D1 option: a $1.00 ceiling
  (≈ 1.4x central) raises the floor to 71 / 214 / 714 and lowers worst-case break-even to
  5.9%. The cost is cutting off heavy legitimate users earlier.
- **The conversation cache miss is a cost lever independent of the trial.** Fixing it lowers
  the full-use cost by about 40%. The cause (Service or Agent SDK cache breakpoints) is not
  traced here.
- **FX.** Every ₩ figure scales with R. At ₩1,350–1,450 the central break-even is
  3.9–4.2% and the ₩100k central capacity is 101–108. The $1.50 ceiling is fixed in USD, so
  its ₩ value moves with R.
- **Evidence limits.** One real Sonnet 5.5 session (n = 15 rows), internal users only, turn
  grouping inferred from timestamps, helper class identified by its 13,996-token prefix. The
  pass contribution assumes full use of 200 requests at ₩31 each. The growth model gives ₩32
  per request at 10 turns, so the conservative case is unchanged. Recompute on the first
  2–4 weeks of open-trial `usage_log` rows.

---

## 6. "Everyone", including minors

### 6.1 Age question (minimal, no identity)

The first screen after "AI 체험하기" asks one question. The answer is self-declared, stored
on the grant as `age_band`, and never sent with conversation content.

> "만 14세 이상인가요?"  → `만 14세 이상입니다` / `만 14세 미만입니다`

- 14+ → open trial.
- Under 14 → guardian path (§6.3). Until legal approves that path, show:
  "만 14세 미만은 보호자 동의 후 시작할 수 있습니다. 보호자와 함께 신청해 주세요." Add one
  link to a Lab page. This is a dead end by design until the decision in §10 is made.
- A second band (`만 19세 미만` → minor-safe defaults, guardian payment) is needed if 14–18
  must be treated differently. Proposal: treat everyone under 19 as a minor for payment
  (§7.5). Use under-14 only for the consent split.

### 6.2 Moderation gap

- Gateway moderation runs only when `isMinorCohort(profile)` is true (`svc:lib/moderation.ts:123`). That
  needs `minor_cohort: true` or an `audience.age_range` upper bound below 18 [CODE].
- `studio-native-trial` inherits `audience.age_range: [19, 99]`, so **nothing is screened**.
- The SDK path does screen inbound text for minor cohorts (`svc:routes/messages.ts:456`).
  ctx-trial §3 said "only the proxy route", which is imprecise. **Streaming outbound
  moderation does not exist on any path** (REQ-O3 "documented follow-up") [CODE/DOC].
- Do **not** set `minor_cohort: true` on the open profile to get moderation. That flag also
  turns on kids-track runtime limits, which would change the adult experience:
  - output cap
  - effort pin
  - context trim
  - hidden thoughts

  Commit #1527 kept exactly these keyed on the flag [DOC; not re-verified, the Service
  shallow clone has no history].
- Proposal: add a profile field `moderation: 'always'`, read by `isMinorCohort`'s callers as
  "screen anyway", and set it on `studio-open-trial`. Cost: zero tokens, deterministic
  (REQ-O2), with a low false-positive rate under the REQ-O7 regression list. It applies to
  everyone, because the age answer is unverified.
- **Open item:** outbound streaming moderation for a population that includes minors.
  Options: buffer per sentence on the free profile only, or accept the inbound screen plus
  the system prompt. This is a safety/legal decision, not an engineering default.

### 6.3 Legal items (flag; not legal advice)

| Item | Why it matters here | Owner |
|---|---|---|
| **PIPA Art. 22-2**: personal data of a child under 14 needs a legal guardian's consent | Any personal data on the server for an under-14 user needs verified guardian consent. That covers hashed install/network ids (personal data or not?) and conversation content sent to the model provider (overseas transfer). The design minimizes collection but cannot by itself decide whether hashed device ids are personal data | Legal + Jay |
| **Overseas transfer notice** (model provider) | The open trial sends user text to Anthropic, so a privacy notice and consent wording are needed for everyone, not only minors | Legal |
| **Anthropic minors guide** (#282 licensing comment, `docs/age-verification.md`) | The current argument is "only intended users; no public signup". An open trial must re-argue through: AI disclosure, moderation (§6.2), monitoring/reporting, safety education, ToS flow-down and intended-user gating. Rewrite REQ-O6 | Jay (doc owner per `age-verification.md`) |
| **Minors' contracts**: a minor's purchase without a legal representative's consent can be voidable under Korean civil law | Payment must come from an adult or guardian (§7.5). Refund exposure otherwise | Legal |
| **E-commerce Act / dark-pattern and auto-renewal rules** | A recurring plan needs: price and renewal disclosure, renewal notice before charging, and cancellation as easy as signup. Verify current statute and enforcement decree text with counsel; this design does not cite article numbers from memory | Legal |
| **Toss billing-key contract** | Recurring card charges need a separate merchant agreement and product review | Jay / business |

### 6.4 The gap already exists through public pass purchase

The open trial is not the first public path to an unmoderated adult cohort:

- `/v1/purchase/products` is public and live [PROBE], and #1617 mentions web buyers [DOC].
- A paid order is claimed through `claimSeat()` (`svc:lib/purchase.ts:358`), which mints a
  seat in the **same** `studio-native-trial` cohort [CODE]. No age is asked.
- That cohort inherits `audience.age_range: [19, 99]`, so `isMinorCohort` is false and no
  gateway moderation runs (§6.2) [CODE].

Consequences:

- `docs/age-verification.md:28-30` ("There is no public signup, no anonymous access, and no
  path from the open internet to a model response") is **already inaccurate**. REQ-O6 is
  stale **now**, not only after the open trial ships.
- The REQ-O6 rewrite and the moderation decision (D8) apply to passes too, and should not
  wait for Phase 2. A paid seat is a smaller channel than a free claim, but it is the same
  gap.
- The age question (§6.1) and the guardian-payment rule (§7.5) should cover the pass
  checkout as well as the free claim.

---

## 7. Conversion

### 7.1 Activation (consistent with PRODUCT-INTENT)

[SKILL onboarding] says to define the aha moment by early actions that predict later paid
conversion, measured on full cohorts. PRODUCT-INTENT constrains *which* actions qualify:
"Useful work first", "Human judgment stays visible", and "Evidence over claims, not
self-assessment". It also rules out a fixed scenario or score.

**Activation (candidate, v0).** Within the trial, both of:

1. **Real result.** At least one successful tool result in the user's workspace: a file
   written or edited, a preview opened, or a page published. A chat-only reply does not
   count.
2. **Visible judgment after the result.** At least one later user turn after (1). Proxies
   for "the user looked and decided": turn count after the result, a file opened, a
   preview viewed, or an approval accepted/denied. Not the content.

Measured from metadata only (§8). Validate it as a hypothesis: compare paid conversion of
activated vs non-activated trials on a mature cohort before adopting it. "First message
sent" is a funnel step, never the activation.

### 7.2 Offer timing

Constraints already in the requirements:

- REQ-L12 ①: the purchase screen opens **only when a person presses**. Limits, expiry and
  errors must not open it.
- INT-ACCESS-05: no unnecessary upgrade pressure; results stay usable after limits.
- CU-13 / CU-14: show only confirmed remaining values; files, conversation and export stay
  readable at the limit; no automatic charge.

| Moment | Proposal | Why |
|---|---|---|
| During work, including right after the first artifact | **No offer.** No locked-model teasers, no banners | [SKILL paywalls] "not during onboarding / not in a flow". PRODUCT-INTENT: useful work first |
| Approaching the limit (≤ 3 turns left) | Passive, factual line in the chat header: "무료 체험 요청 {n}번 남음". No button | CU-13. Lets the user plan the last turns. Not a prompt |
| At the limit | **Inline end-of-trial card** in the chat (not a modal, SX inline-progression rule). Facts first, one Primary, a clear escape | [SKILL paywalls] value-before-ask, respect the no |
| After the trial, on the next app launch | The start page shows the trial as a finished activity, with "이어서 하려면 이용권으로 시작하기" as one of the three equal choices (REQ-L12 ①, SX-04) | No re-prompting. The cool-down is the user's own return |

Proposed end-of-trial card copy (합니다체, the start/chat register; the purchase screen
itself stays 해요체 per REQ-L12 ②):

> **무료 체험을 모두 사용했습니다**
> 만든 파일은 `~/HypeProofTrial` 에 그대로 있습니다. 대화도 계속 볼 수 있습니다.
> 이어서 작업하려면 이용권이 필요합니다. 라이트 이용권은 30일 동안 AI 요청 200번입니다.
> [이용권 살펴보기]   (secondary) [오늘은 여기까지]

- No countdown, scarcity, guilt or "you'll lose" copy.
- No pre-checked upsell.
- The `pass` block price and request count come from the Service, never hardcoded.

### 7.3 Carry-over on upgrade

| Item | Today | Proposal |
|---|---|---|
| Files | Carried: a new pass inherits the default `workspace_root` `~/HypeProofTrial` (REQ-L12 ⑫) [DOC] | Keep. Requires the open-trial profile to use the **same** `workspace_root` as the pass profile |
| Conversation | A new activity; the trial transcript stays readable under the old activity (REQ-L12 ⑫: "파일은 그대로 남고 대화 기록은 새 활동으로 시작한다"; US-09: no automatic mixing) [DOC] | Add an **explicit, user-confirmed** "체험에서 하던 대화 이어가기" on first entry to the pass. It shows the trial transcript as read-only history and seeds the coach with a summary the user can see. US-09 already allows this ("자료 재사용은 사용자가 범위/대상을 확인한 별도 행동"), so US-09 is cited unchanged. The text to amend is **REQ-L12 ⑫**: keep "새 활동으로 시작한다" as the default and add the user-confirmed carry-over as an exception |
| SDK session resume | Different `user_id` (`pass-…` vs `ot-…`), so different grant and credentials [CODE] | Do not resume the SDK session across credentials. Start fresh, with the transcript summary |
| Usage | Separate grants; the pass starts full | Unchanged (US-11: one cost source per request) |

### 7.4 Recurring subscription vs 30-day passes

| | 30-day passes (today) | Recurring subscription |
|---|---|---|
| Identity | None. Each order mints a `pass-<order>` seat [CODE] | Requires an account to carry the entitlement across periods (#1701 / PR #1702, default-off, not merged [DOC ctx-trial; not re-verified]) |
| Payment | Toss one-time card (REQ-L12) | Toss **billing key** plus scheduled charges, failure retries, dunning |
| User promise | "자동으로 다시 결제되지 않아요" (REQ-L12 ②) | Must state renewal date, amount and cancellation path before payment. Cancellation in-app must be as easy as purchase |
| Allowance | Requests per 720 h, no rollover, no extension rule on re-purchase [DOC] | Monthly allowance reset. Rollover and refund rules are unset commercial values ("아직 확정되지 않은 상업 값") |
| Minors | Guardian can buy on the web and hand over a code [INFERRED; the web checkout's code hand-off is not verified here] | Guardian-owned account and subscription; the child seat is linked |

Recommendation:

- Phases 1–3 convert to **passes**. They already work end to end against Toss test keys.
  Production gateway acceptance is not claimed [DOC].
- Phase 4 adds a monthly plan **alongside** passes, not instead of them. Passes stay the
  low-commitment option and the guardian-friendly one.
- [SKILL pricing] warns against ultra-low pricing. The ₩33,000 entry is already near the
  prosumer bucket. Do not discount it to lift trial conversion before §8 data exists.

### 7.5 Guardian purchase

- Under 19 (self-declared): the end-of-trial card's Primary becomes
  "보호자에게 결제 요청하기". It produces a link or QR to the Lab checkout for the same
  product. The guardian pays on their own device. The code returns to the child's app
  through the existing order-secret claim (REQ-L12 ③–⑦), or is entered by hand.
- No child payment UI. No storage of guardian contact data unless legal requires it for
  consent records (then a separate, minimal store; `classroom-admin.md` already models
  guardian-consent records for classes).
- Proposed copy: "결제는 보호자가 해 주세요. 보호자 휴대폰으로 결제 페이지를 열 수 있는
  QR을 보여 드립니다."

### 7.6 No dark patterns; deliberate friction stays

- **Keep:**
  - approval friction: TUX-HOST-02 strong confirm for destructive shell, write/browser
    approvals (TUX-HOST-03/04)
  - one question at a time when the request is unclear (NAT-03)
  - observation behind consent

  These are intended friction (judgment visible) and are not conversion levers.
- **Do not add:**
  - auto-opened paywalls
  - countdown timers
  - pre-selected higher tiers beyond the Service's single `recommended` flag
  - confirmshaming escape text
  - hidden renewal
  - harder cancellation than purchase
  - showing money or token counts as a measure of the learner
- Plan rule (§P2): growth advice that removes intended friction is rejected and logged with
  the principle it conflicts with.

---

## 8. Funnel events, definitions, A/B

### 8.1 Events (no minors' PII)

Rules:

- Key everything by `trial_id = H(grant id)`. No name, email, phone, raw IP or raw
  `install_id`.
- No message text (`analytics.log_user_messages: false` stays).
- `age_band` is a coarse self-declared category only.
- Most events derive server-side from rows that already exist. App-side events go through
  the existing trace endpoint (`/v1/trace/event`) with the same key.

| Event | Source | Fields |
|---|---|---|
| `trial_entry_viewed` | App | app_version, os |
| `trial_age_answered` | App | age_band |
| `trial_claim` | Service | outcome: granted / reused / refused (reason: install, network, global, paused, app_version) |
| `trial_first_message` | Service (first reservation; also clock start) | model, latency to claim |
| `trial_tool_result` | App (tool activity) | kind: write/edit/preview/publish, ok |
| `trial_activated` | Derived | per §7.1 |
| `trial_limit_near` / `trial_limit_reached` | Service | turns_used, cost bucket (not amount) |
| `offer_viewed` / `offer_clicked` / `offer_dismissed` | App | surface: end_card / start_page; guardian flag |
| `order_created` / `order_paid` / `pass_claimed` | Service (`purchase_orders`) | product_id |
| `pass_first_message` | Service | |
| `pass_week2_active` | Derived | retention proxy |

Link between a trial and a later order: the App holds both the trial grant and the order
secret, and sends `trial_id` on order creation. That needs a new nullable
`purchase_orders.trial_id` column. No identity is involved.

### 8.2 Definitions

- **Trial start** = `trial_first_message` (not claim). Claims without a message measure the
  entry, not the trial.
- **Activation rate** = activated / trial starts, measured within 24 h of start.
- **Conversion** = `order_paid` within **14 days** of trial start, linked by `trial_id`.
  Report visitor→paid (from `trial_entry_viewed`) as well as trial→paid ([SKILL onboarding]:
  decide on visitor→paid, not trial→paid).
- **Paid retention** = `pass_week2_active` and repurchase within 45 days.
- **Cost per conversion** = Σ free-tier settled cost / conversions. Compare it with §5.4.
- Immature cohorts (less than 14 days since start) are reported separately and never counted
  as non-converted.

### 8.3 A/B design

Volume caveat ([SKILL a-b-test-design], "when not to A/B test"):

- At an assumed 3% baseline conversion, detecting +2 pp (3% → 5%, α 0.05, power 0.8) needs
  about **1,500 trial starts per arm**:
  n = (1.96 + 0.84)² · (0.03·0.97 + 0.05·0.95) / 0.02² ≈ 1,501
- At 50 starts per day, a two-arm test takes about 2 months.
- So: run **qualitative walkthroughs and the T25 human pilot first**. Start with one test
  only, and only after the funnel shows volume.

| # | Hypothesis | Variants | Primary | Guardrails |
|---|---|---|---|---|
| E1 | If the allowance is counted in user turns (10) instead of attempts (40), activation rises, because long tool loops no longer exhaust the trial before a result | attempts-40 vs turns-10 | Activation rate | Cost per trial, 429 rate |
| E2 | If the window is 24 h instead of 1 h (clock at first message in both), conversion rises, because users return to finish their own task | 1 h vs 24 h. The 24 h arm needs `svc-grant-purpose-timestamps` first: today `isPassGrant` classifies it as a pass (§3.4) | 14-day conversion | Cost per conversion, abuse refusals |
| E3 | If the end card adds one factual line about what the trial produced, `offer_clicked` rises without more dismiss-and-leave | card A vs card A + result line | Offer click → paid | Complaints, report-problem rate |

Excluded from testing: anything that weakens approvals, adds pressure (timers, auto-open)
or hides the escape. Those are design decisions, not experiments.

---

## 9. Phased rollout and requirement changes

| Phase | Scope | Requirement rows (add / modify) | Exit evidence |
|---|---|---|---|
| **0 — Independent fixes** (valid under any access model) | Clock at first `/v1/messages`; turn-based counting; code-free install with SDK binary; honest missing-binary error; non-member updates | **NAT-11 modify** (clock source, turns + per-turn guard); **MU-04 modify** (failed provider attempts count toward cost, not turns); **US-01 modify** (public artifact includes the SDK binary); **TUX-COND-02 / TUX-HOST-07 modify** (non-member update path) | Clean-account install observed (plan P0); synthetic grant shows clock unchanged after `/v1/profile` |
| **1 — Cost guardrails** (before any open entry) | `studio-open-trial` profile and cohort; free model list; web_search off; per-trial currency ceiling; global daily cap → auto-pause; approved Sonnet/Haiku 5.5 price revisions + FX revision | **AB-19 add** (per-grant currency ceiling with reserve-then-settle, overshoot ≤ 1 request); **AB-20 add** (global daily free-tier ceiling → cohort pause, auto-resume); **MU-09 add** (free tier: priced models only, no Opus, effort ≤ medium, no hosted tools); **AB-01 note** (FX revision required before enforcement) | Planted-overspend control: a synthetic grant with a tiny ceiling refuses the next request (negative control). A normal trial completes under the ceiling (positive control) |
| **2 — Open entry, 14+** | `POST /v1/trial/claim`; install/network/global limits; roster bypass for server-trusted grants; age question; moderation `always` on the open profile; start-page copy | Under A (D15): **US-04** kept as written, naming the free-entitlement rule (D18); entry depends on the account launch gates (§3.1). Under the C′ interim (D17): **US-04 modify** (P1 policy now defined: replace "본인 자격과 발급 이력" with install + network + global checks and hashed per-install/per-network issuance records, state that a reinstall is not prevented and the currency ceilings bound it; idempotent claim; §3.1); **US-19 add** (open-trial claim contract); **NAT-01/02 modify** (entry without code; grant row as allowlist for `open-trial`/`purchase`); **TUX-SP-11 add** (zero-gate entry: one Primary, no code field, age question); **REQ-O8 add** (`moderation: 'always'` profile flag); **REQ-O6 rewrite** (intended-user argument for an open product) | Legal sign-off on §6.3 rows 2–3; T25 human pilot with ≥ 5 adults; funnel events live |
| **3 — Conversion surface** | End-of-trial card; approaching-limit line; guardian payment link; trial→order linkage; conversation carry-over | **TUX-COND-07 add** (end-of-trial card: facts, one Primary, escape; never auto-open); **REQ-L12 modify** (⑫ add user-confirmed conversation carry-over as an exception to "대화 기록은 새 활동으로 시작한다"; guardian checkout hand-off); **US-09** and **CU-13/14** cited unchanged (US-09 already allows user-confirmed reuse) | Production pass purchase accepted on a released app (REQ-L12's own open item) |
| **4 — Under-14 and subscription** | Guardian consent flow; monthly plan with Toss billing key; account linkage | **US-20 add** (guardian consent before under-14 grant); **AB-21 add** (recurring entitlement: period reset, renewal notice, in-app cancel, no rollover unless contracted); **REQ-L13 add** (in-app subscription purchase/cancel); depends on #1701 | Legal sign-off on §6.3 rows 1, 4, 5; Toss billing contract |

Order matters: **Phase 1 must ship before Phase 2.** An open claim on today's profile has
no currency bound (§5.2).

---

## 10. Decisions and owners

| # | Decision | Proposal | Owner |
|---|---|---|---|
| D1 | Per-trial ceiling | $1.50 provider cost (≈ ₩2,100) | Jay |
| D2 | Global daily free-tier ceiling | Pick from ₩100k / ₩300k / ₩1M | Jay |
| D3 | FX revision for enforcement | Owner-published `fx` revision | Jay (Service price approval) |
| D4 | Sonnet 5.5 cache-read price ($0.10 vs $0.20) | Verify on the pricing page, then approve | Service owner |
| D5 | Free allowance and window | 10 turns, 24 h from first message (E1/E2 to refine). The 24 h window waits for `svc-grant-purpose-timestamps`; without it `isPassGrant` (`duration_ms > 1 h`) makes the grant a pass (§3.4). Until then 1 h | Jay |
| D6 | Free model list | Sonnet 5.5 + Haiku 5.5; no Opus; no web_search | Jay |
| D7 | Roster bypass for server-trusted grants | Grant row as allowlist | Service owner (security review) |
| D8 | Moderation for everyone on the open profile; outbound streaming gap | `moderation: 'always'`; streaming decision open | Jay + legal |
| D9 | Under-14 at launch | Blocked with guardian message until D10 | Jay + legal |
| D10 | Under-14 guardian consent method | Legal to specify | Legal |
| D11 | Payment by minors | Under 19 → guardian checkout only | Jay + legal |
| D12 | Subscription timing | Phase 4, after accounts (#1701); passes stay | Jay |
| D13 | Network claim limit default and venue bypass | ≤ 5 per 24 h per /24; operator bypass | Jay |
| D14 | Activation definition v0 | §7.1, validate on a mature cohort | Jay (product), Codex acceptance |
| D15 | Trust event for the open trial (was "trust event vs US-04") | A (account sign-in); B only as a second provider; C′ counters as secondary limits (§2A.4) | Jay |
| D16 | REQ-O6 / moderation for paid passes before Phase 2 | Treat the pass gap (§6.4) as current, not future | Jay + legal |
| D17 | Ship C′ as an interim before accounts launch? | Only with explicit acceptance of the drained-cap risk and in-App-only conversion measurement; sunset when A launches; US-04 amendment (§3.1) only on this path | Jay |
| D18 | Free-entitlement rule under A | 1 per `(provider, subject)` ever; hash kept after account deletion | Jay + legal (retention of the hash) |
| D19 | Public update channel for non-members | Read the public release the Lab download already serves, or a Service/Lab proxy; the private mirror stays for members | Jay |
| D20 | Interim request path (plan decision 2) | Name the mailbox and a response time; confirm receipt | Jay |
| D21 | Visual identity across Lab → install → App → chat (report §3 problem D10, impeccable Q2) | Bring the start page's identity into the end-state cards first; full chat theming later | Jay |

D15–D21 match the report's §10 rows. This table is the single decision table; the report's
§10 lists only what is new or changed in its revision.

---

## 11. Open questions this design does not answer

- Funnel baseline: **answered by P0, and it is empty.** All 17 `native_trials` grants in
  production are internal probes (14) or paid passes (3); real free-trial users are
  **n = 0** at every stage [PROBE, report §1 and §2]. The trial has never been offered to
  anyone, so there is no conversion rate to compare with the 5.5% break-even. The open
  question is now what the first real cohort converts at, measured with the §8 events.
- Whether hashed install/network identifiers are personal data under PIPA. This decides how
  much of §6.3 applies to adults too.
- Whether the Lab web checkout hands a guardian a code for another device. Not verified
  here.
- Real Toss fees and refund rates for the unit economics.
- Whether the measured token profile (mixed trial/pass/test, n = 37 on Sonnet 5.5) holds for
  real first-time users, who may run longer tool loops.
