# Email workshop: reuse the existing purchase system

2026-10-15 source audit. Scope: EA-07/08 and step 7 of
[email automation delivery](email-automation-next-steps.md). This records
implementation facts, not a verified live sale or selected commercial offer.

Sources: Studio `9416321d290afc02b642b32fda6d013724ffbc54` integration worktree;
Service `origin/main` `dbcd1a8ede5f0564e4ab191a52334fc3b1cb7c35` read with
`git show` without switching its working tree; Lab local main
`912341557b2342a0172106f473144d4fd043daf4`. No payment, external mutation or
test execution was performed for this audit.

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

The locally available Lab tree contains `/studio/trial`, product and installer
pages, but no `/studio/checkout` implementation. Therefore the latest checkout
source, actual deployed checkout URL, payment consent copy and support/refund
page remain **uninspected**, not proven missing from production. Obtain the
current website revision and inspect its server-side order-secret handling
before modifying or claiming acceptance of the browser purchase flow.

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

Lab `web/src/lib/pricing.ts` has older Day/Cohort/Solo ladder values and an
included-token margin concern. The email plan's KRW50,000 quality benchmark,
the workshop's 30-day grant, the ordinary one-hour trial, and a public free-trial
offer are separate inputs. Resolve the actual product contract against current
pricing source and gateway configuration; do not copy one number across them.

## Acceptance evidence template

Run existing Service `worker/test/purchase.test.mjs` and Studio
`test/pass-purchase.smoke.mjs` / `test/start-page-purchase.smoke.mjs` on the
integrated revisions before adding duplicate tests. Then cover the actual
new continuity boundary with synthetic gateway responses and no paid AI.

| Scenario | Required result | Evidence |
| --- | --- | --- |
| Workshop ends, no purchase | No charge or automatic entitlement; saved work remains accessible under policy. | not_run |
| Exact selected pass purchased | Explicit offer/consent, provider-confirmed amount, one grant, expected email capability. | not_run |
| Return URL forged or wrong amount | No entitlement from browser-supplied success. | not_run |
| Payment response lost, app restarts | Same pending order recovered; no second charge or duplicate grant. | not_run |
| Claim answer lost | Explicit reissue preserves prior window and usage. | not_run |
| Workshop-to-paid identity | Same authorized learner, preserved local work/Google connection/ledger; intended cohort recipe access; no cross-account exposure. | not_run |
| Pass expires/exhausts | New paid AI denied; no automatic personal/cohort funding switch; work/export access follows requirements. | not_run |
| Provider refund or partial refund | Verified gateway record, accurate refunded state and access revocation; no claim/reissue restores it. | not_run |
| Proposed recurring renewal | Keep unavailable until its contract, consent, charge and cancellation behavior are separately implemented and accepted. | not_run |

Each completed row records Studio/Service/site SHA, selected product revision,
synthetic or gateway-test mode, timestamp, observed result and a redacted
artifact reference. Provider test acceptance is separate from a real charge;
never record raw order secrets, credentials or customer identities here.
