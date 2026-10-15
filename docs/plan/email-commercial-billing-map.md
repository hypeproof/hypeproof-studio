# Email workshop: reuse the existing purchase system

2026-10-15 source audit. Scope: EA-07/08 and step 7 of
[email automation delivery](email-automation-next-steps.md). This records
implementation facts, not a verified live sale or selected commercial offer.

Sources: Studio `720be6610200bc8da81686bd3eb20591d6407d88`, Service integration
`abf79a8bbe8a64e71f738366c9138f7c722c210f`, and Lab remote main
`c1274f543aa9e29354a8f994067c5c187137d245`, inspected with `git show` without
switching or changing its working tree. Focused tests used synthetic providers;
public-site checks used GET only. No order, charge, refund or entitlement was
created on a live service.

## Existing path and reuse boundary

| Stage | Existing source / behavior | Commercial interpretation |
| --- | --- | --- |
| Catalogue | Studio `extensions/hypeproof-chat/src/passPurchase.ts` reads `/v1/purchase/products`; Service `worker/src/lib/purchase.ts` validates configured KRW products with duration and request allowance. | Reuse this product source. A fixture's KRW50,000 and 600 requests are not proof of the deployed offer. |
| Order | Service `createOrder` stores a price/duration/allowance snapshot, 30-minute order deadline and hash of a one-time-issued order secret. | Server owns the price. No card details or buyer contact are stored by this module. |
| Checkout | Studio validates the checkout URL against configured `hypeproofChat.siteBase` (default `https://hypeproof-ai.xyz`). Service uses `HPS_PURCHASE_CHECKOUT_URL`, serves `/orders/:id/checkout` and directs the browser to an external page. | Reuse the site checkout; do not add a second payment UI inside the email workflow. |
| Capture | Service `tossProvider` confirms with Toss server-to-server using the order's idempotency key, then compares order, amount and paid state. Return-query parameters alone grant nothing. | Browser success is not payment evidence. |
| Recovery | Service `confirmOrder` checks stale confirmation against the gateway. Studio preserves uncertain/confirming orders and uses order-secret-bound polling. | Do not encourage another purchase while the first payment is unknown. |
| Claim | `/orders/:id/claim` issues an individual native grant; explicit reissue rotates its code while retaining prior usage and window. | Reuse this delivery/recovery behavior. Reissuing does not renew the pass. |
| Expiry | Native grant validity and request allowance gate paid AI; the usage window starts at first use and is constrained by credential expiry. | Display both the start/credential deadline and actual usable window accurately. |
| Refund reconciliation | Toss webhook triggers a server lookup; verified cancellation marks the order refunded and revokes its native grant. `PARTIAL_CANCELED` is also treated as canceled by this adapter. | This is receipt/revocation processing, not a customer refund-request flow or a refund policy. Partial refunds currently end access. |
| Subscription contracts | Service `access-contracts.ts` separately stores approved plan revisions, immutable ownership, explicit periods and none/calendar renewal; duplicates/late events cannot refill a period. | A contract engine is not a recurring payment adapter. Do not advertise automatic renewal from its existence. |

Purchase routes answer 404 unless `HPS_PURCHASE=enabled`, gateway key,
checkout URL and product configuration are all valid. A source-level path is
not evidence that those settings or migration `0043-purchase-orders.sql` are
active in production. Read operational configuration without printing secrets.

The current Lab source includes `/studio/checkout` and web purchase routes. This
supersedes the earlier audit of stale local main `91234155`:

- `checkout/start/route.ts` validates the product and sales switch, then stores
  the order secret in an HttpOnly, SameSite=Lax cookie scoped to
  `/studio/checkout` (Secure on HTTPS, two-hour lifetime). The redirect carries
  only the order ID. A server-only shared key can bind rate limiting to the
  buyer address rather than the website's server address.
- `studioCheckout.ts` accepts only the Service's order shape and return origin.
  `PayButton.tsx` opens Toss's card window; Service performs confirmation.
  The page says the purchase is one-time and does not renew automatically.
- `checkout/done/page.tsx` reads the order again: a forged `result=paid` cannot
  produce paid status or a claim. `checkout/claim/route.ts` requires the secret
  cookie, calls the existing claim API and stores the returned participation
  code in a separate HttpOnly cookie for 24 hours. Explicit reissue replaces a
  lost code. These mechanisms do not authenticate a previous workshop identity.

At approximately 15:56–15:58 KST on 2026-10-15, public pricing and refund pages
returned HTTP200. A read-only GET to `/v1/purchase/products` returned the same
three amounts and allowances as Lab's `STUDIO_PUBLIC_OFFER`/`studioOffer.ts`:
KRW33,000 / 200 requests, KRW55,000 / 350, and KRW108,900 / 700; each duration is
720 hours. Amounts include VAT. The first Python-default request returned403;
a browser User-Agent with JSON Accept returned200. This is catalogue/HTTP
evidence, not payment-window, consent, gateway or refund acceptance. Current
deployment SHA and the selected email-enabled product profile remain unverified.

## Concrete gaps for workshop-to-paid continuity

1. **Stable identity is not supplied by a new order.** `createOrder` constructs
   `user_id = 'pass-' + order-id prefix`; `claimSeat` issues a `native_trial`
   credential for that new seat. It does not bind the purchase to the existing
   workshop account. EA-07 requires stable learner identity across entitlement
   changes. Define and test an authenticated account/seat link using existing
   access-account contracts; preserve Google connection, saved recipe, cohort
   access and send ledger without silently copying private data to a new user.
2. **The paid profile may not permit email automation.** `parseProduct` requires
   an individual-grant profile on its own cohort, but not EA-11 capability.
   Test the actual selected product/profile before promising paid continuation.
   A new cohort also changes recipe-store visibility.
3. **A one-time pass is not monthly auto-billing.** The inspected purchase
   routes contain no recurring-charge scheduler, billing-key enrolment or
   subscription-cancel endpoint. Preserve the email MVP exclusion of monthly
   auto-billing; use explicit repurchase only if that is the chosen offer.
4. **Refund ownership and execution need an operational procedure.** The
   webhook can observe a gateway refund, but does not initiate one. Record who
   receives requests, verifies ownership, performs an authorized provider
   refund, reconciles the receipt and confirms access state. Do not label
   Studio's stop-purchase button as refund or cancellation of a paid pass.
5. **Request counts and token costs are different meters.** A 600-request grant
   is not a currency cap. Preserve the class and individual server budget
   controls and unresolved reservations. Do not infer margin from one measured
   authoring conversation or the marketing price benchmark.

Lab `web/src/lib/pricing.ts` now exposes `STUDIO_PUBLIC_OFFER`, tested against
the public offer module. Its basic pass costs KRW55,000 including VAT, while the
email plan's KRW50,000 is a quality benchmark. The workshop's 30-day grant,
ordinary one-hour trial and any public free-trial offer are separate contracts;
do not copy one duration or allowance across them.

## Continuity integration constraints confirmed from current code

The follow-up source inspection at Service `abf79a8b` and Studio runtime
`0b57074d` narrows the required bridge; it does not implement or activate it.

- Service already has immutable `access_accounts` and `access_seats` plus
  `accountForToken()` in `worker/src/lib/access-contracts.ts`. An account token
  proves identity only; token issuance creates no paid entitlement. Reuse this
  ownership contract rather than treating a Google email or new order ID as
  proof of workshop ownership.
- `PUT /admin/access/accounts/:id/seats` explicitly refuses a new link after
  class/seat budgets or reservations exist (`seat_link_requires_budget_migration`).
  The current synthetic class has initialized budgets. Retrofitting its identity
  by inserting a link would evade the existing migration guard; a transfer must
  preserve settled usage, outstanding reservations and the existing caps.
- `worker/src/routes/automations.ts` currently rejects account tokens, requires
  a cohort-bound student and stores owner/visibility as `(cohort_id, user_id)`.
  Merely issuing a personal account token therefore cannot preserve store access.
  A future bridge must separately specify private recipe ownership and retained
  cohort membership; payment must not grant access to a different class.
- The purchase route still creates a fresh `pass-...` seat for each order. An
  authenticated binding must be fixed before checkout, retained through lost
  responses/reissue and checked at claim. A supplied learner ID, Google callback
  or paid return query alone cannot authorize the binding.

Before this bridge ships, its acceptance must cover both a new class linked
before budget creation and an already-used class with unresolved reservations;
wrong-account claim, duplicate payment callbacks, lost claim response, refund,
expiry and explicit repurchase must preserve ownership and usage without
replaying a previous mail approval. These are implementation gates, not executed
continuity tests. No selected product, recurring charge or production migration
is inferred from this audit.

## Executed focused regression checks

On 2026-10-15, without real payments or paid AI:

- Service `worker`: `npm run test:purchase`, **8/8 pass** at `abf79a8b`.
  Covers disabled configuration, confirmed capture, duplicate/uncertain
  recovery, claim/roster recovery, forged returns, provider refund revocation
  and buyer rate limits.
- Studio: `node test/pass-purchase.smoke.mjs` and
  `node test/start-page-purchase.smoke.mjs`, **both pass** at `720be661`.
  Covers pending-order persistence, trusted checkout origin, secret-before-open,
  recovery and claim handling. This is not a live checkout test.
- Lab: unchanged `studioCheckout.test.ts`, `studioWebPurchase.test.ts` and
  `studioOffer.test.ts`, **15/15 pass** at `c1274f54`. Ran extracted source in an
  isolated directory with Vitest4.1.11; no full site build or route/browser test.
  Validates order/result parsing, one-time claim/reissue request construction,
  gateway-unavailable responses and source/public-price consistency.

Local audit artifacts: `/tmp/hps-email-billing-audit-c1274f5/` (`SOURCE.json`,
`live-readonly.json`). These checks establish the reusable purchase baseline;
they do not close the workshop-to-paid identity boundary below.

## Acceptance evidence template

The focused checks above cover existing behavior. Complete the actual new
continuity boundary with synthetic gateway responses before any live pilot.

| Scenario | Required result | Evidence |
| --- | --- | --- |
| Workshop ends, no purchase | No charge or automatic entitlement; saved work remains accessible under policy. | not_run |
| Exact selected pass purchased | Explicit offer/consent, provider-confirmed amount, one grant, expected email capability. | not_run |
| Return URL forged or wrong amount | No entitlement from browser-supplied success. | Synthetic Service checks pass; Lab forged-paid helper passes; live not_run |
| Payment response lost, app restarts | Same pending order recovered; no second charge or duplicate grant. | Service recovery and Studio persistence fixtures pass; real restart with gateway not_run |
| Claim answer lost | Explicit reissue preserves prior window and usage. | Service/Studio synthetic checks pass; browser request-construction check passes; live not_run |
| Workshop-to-paid identity | Same authorized learner, preserved local work/Google connection/ledger; intended cohort recipe access; no cross-account exposure. | not_run |
| Pass expires/exhausts | New paid AI denied; no automatic personal/cohort funding switch; work/export access follows requirements. | not_run |
| Provider refund or partial refund | Verified gateway record, accurate refunded state and access revocation; no claim/reissue restores it. | Synthetic provider refund/revocation pass; live/partial-refund operational acceptance not_run |
| Proposed recurring renewal | Keep unavailable until its contract, consent, charge and cancellation behavior are separately implemented and accepted. | not_run |

Each completed row records Studio/Service/site SHA, selected product revision,
synthetic or gateway-test mode, timestamp, observed result and a redacted
artifact reference. Provider test acceptance is separate from a real charge;
never record raw order secrets, credentials or customer identities here.

## Main integration follow-up — 2026-10-15

Service `acfd637` merges main `38d8879` into the email branch, retaining the new
revoked-native-grant rejection in access admission and the existing paid recovery
harness. Automation/native-grant/purchase checks passed42/42. The broader run
passed125 commands; the orchestrator group required explicit workshop fixture
integration and then passed all nine commands. Typecheck and dry-run build pass;
The documentation follow-up2ce0b2e passed all13 remote CI checks, including
premerge. No real payment, migration or remote deployment occurred.
This integration does not bind a new purchase to the existing workshop identity:
the continuity gaps and acceptance rows above remain open.


## Concrete continuity design boundary — 2026-10-16

Read again at Servicefa7472b and Studiofd6f276e. This is the proposed bridge,
not a shipped payment path or an approved offer.

`activityIdentity()` hashes native-trial/classroom mode, cohort, user, account
claim, profile and lesson identity. Studio hashes that verified activity ID and
Service origin to locate the recipe, Google settings and durable send ledger.
Keeping only the same user name is insufficient: changing trial mode, profile or
account-token shape also selects a different activity. Do not weaken this
isolation or copy credentials to make paid continuation appear seamless.

The intended path keeps the existing verified workshop activity and lets the
learner explicitly select a personal funding contract. The existing
`accessChoices()` already supports account-linked seats where the course policy
allows personal funding. A payment grants funding only; it must not create or
extend membership in another cohort. Recommended implementation boundaries:

1. Bind authenticated account ownership to the order before checkout in a
   separate immutable order-owner record. Preserve the existing per-order seat
   and unique user constraint for legacy unbound purchases; do not rewrite old
   orders or accept a client-supplied workshop user ID as identity proof.
2. For a bound purchase, provider-confirmed payment activates exactly one
   account-owned access contract with the selected approved plan revision and
   explicit period. Claim/reissue returns recovery of that contract, not a new
   activity identity. Keep legacy native-pass claims unchanged.
3. Link new workshop seats before budget initialization. Already-used seats
   require a dedicated atomic migration that preserves old subject charges,
   outstanding reservations and concurrency/cap enforcement. The existing
   `seat_link_requires_budget_migration` guard stays in place until that migration
   has race/restart evidence. An order or login must never reset these amounts.
4. Refund/expiry disables only the paid contract. The current legacy refund
   path revokes its purchase native grant; attaching that to an existing class
   credential could revoke unrelated classroom access. Bound contracts need
   separate receipt-backed revocation and cannot replay prior email approval.
5. Keep the activity's existing Google/Sheet settings and hashed send ledger in
   place. Refresh credentials only through the authorized existing identity;
   never retain a pending preview/send approval across funding or token changes.

Required evidence extends the table above: unchanged verified activity ID and
local namespace across explicit funding selection; independent paid/class
expiry and refunds; wrong-account denial at create/claim; concurrent duplicate
callbacks; unresolved pre-link reservations; same recipe/store ownership and
an unchanged unknown-send record. A selected email-enabled paid plan, its price,
limits and support/refund terms remain human/product decisions. No real payment
or production migration was performed for this design.
