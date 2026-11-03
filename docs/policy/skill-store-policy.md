# Skill store policy

Commercial and eligibility rules of the public skill store ([Epic #3418](https://github.com/hypeproof/hypeproof-studio/issues/3418), [Intent](../intents/skill-store.md)).
This document is the human-readable source. Its machine copy is `STORE_POLICIES` in
`hypeproof/hypeproof-service` `worker/src/lib/store-policy.ts`; the two must carry the same version and values.

## How this policy changes

- A change is a PR that adds a new version section here and a matching `STORE_POLICIES` entry in the Service, with its own `effective_at`. Old versions are never edited.
- A version applies to orders created at or after its effective time. Every order, ledger line and refund records the `policy_version` it was computed under, so an earlier sale is never recomputed.
- Requirement rows cite keys from this document, not values. A value change does not reopen a requirement.
- A new key needs a code change in the Service; a new value for an existing key does not.

## v1

Effective 2026-11-02 00:00 KST (`effective_at` = 2026-11-01T15:00:00Z). Sponsor: TJ, 2026-11-02.
Tax, tier, fraud-block and report values come from desk research on 2026-11-02 (official PG documentation and secondary tax sources). The sponsor accepted them as starting values to be revised; trust their direction more than their exact numbers until the tax-accountant and PG written answers in #3419 arrive.

### Sponsor rows (2026-11-02)

| Key | Value |
|---|---|
| `items.types` | skills (first slice); later learner works, official templates/courses |
| `visibility` | public browse; account required to buy or install |
| `sellers` | any user |
| `price.max_exclusive_krw` | 5,000,000 (nothing at or above) |
| `tier.new` | mobile identity verified: cap 100,000 KRW per item, payout hold 14 days |
| `tier.standard` | ≥10 sales, ≥30 days since first listing, 0 disputes: cap 500,000 KRW, hold 7 days |
| `tier.verified` | KYC + mail-order registration + human review of the item: cap 3,000,000 KRW, hold 7 days |
| `tier.minor` | cap 100,000 KRW fixed; payout to a linked adult |
| `fraud.shared_signal` | payment blocked when buyer and seller share device, card or IP |
| `fraud.seller_monthly_cap_krw` | 10,000,000 (PG guarantee-insurance exemption) |
| `pg.fee` | deducted from the gross before the split |
| `split.seller_bps` / `split.commission_bps` | 8000 / 2000 (commission VAT included) |
| `referral.partner_bps` / `referral.instructor_bps` | 500 / 500, paid by HypeProof out of its commission; HypeProof keeps 1000 |
| `referral.no_origin` | no origin lecture: HypeProof keeps the whole commission; seller stays at `split.seller_bps` |
| `attribution` | partner company and instructor of the lecture through which the seller first joined; permanent |
| `payout.schedule` | monthly |
| `payout.min_krw` | 10,000 (smaller balances roll over) |
| `refund.window_days` | 7; full refund only if never run; no refund after the first run |
| `refund.after_split` | not yet settled: reverse in the ledger; already paid: net against next month's settlement |
| `tax` | displayed price includes VAT. The seller is the supplier and reports VAT/income on sale proceeds; no withholding on seller proceeds. HypeProof reports its commission (VAT included) as taxable sales. Instructor share: 3.3% business-income withholding and monthly simplified payment statements. Partner share: tax invoice. Referral fees are paid only on sales past the refund window. To be confirmed by a tax-accountant written inquiry; if HypeProof is found to be the supplier, this row changes in v2 |
| `run.model_cost` | buyer's own usage |
| `updates` | free for buyers; notified, applied by the buyer's choice; old version keeps working |
| `listing.auto_publish_max_krw` | 500,000 (automated checks, then immediate publish up to this price; above it, human review before listing) |
| `reports.auto_unlist` | 3 reports from distinct buyers, then operator review |
| `minor.buy` | 14–18: free skills only, no paid purchase |
| `minor.sell` | 14–18: may upload, sell and view their own settlement history; payout to a linked adult |
| `linked_adult.verification` | mobile identity verification plus a family-relation document upload |
| `store.under_14` | instructor-code-only classroom cohorts (`docs/age-verification.md`): no store access (default until decided) |

### Implementation starting values (not sponsor-set)

The Service needs these keys to enforce the rows above. They were chosen by the Delivery Captain on 2026-11-03 and need sponsor confirmation.

| Key | Value | Why |
|---|---|---|
| `tier.none.cap_krw` | 0 | An account without mobile identity verification may list free items only, because `tier.new` requires verification. |
| `listing.allowed_tools` | `read`, `write`, `browser` | "Service-approved tools" for CGP-AGENT-38. Shell is left out because a store skill should not ask a buyer to approve arbitrary commands written by a stranger. A buyer's own profile still gates every tool. |
| `pg.fee_rate_bps` | 340 (3.4%) | Placeholder estimate of the card fee. The real fee comes from the PG contract (#3419 step 6); until then the ledger's `pg_fee` line is an estimate. |
| `age.adult_min` / `age.minor_min` | 19 / 14 | Korean civil adulthood and the account minimum. Age is a self-declared birth year until a verified source exists; the ambiguous year at a boundary counts as the younger group. |

## Rollout switch (not a policy value)

Who can reach the store is a Service secret, `HPS_STORE_ACCOUNTS`: a comma-separated list of account ids, or `*` for every account. Accounts outside it get the same 404 as a store that is off, so the App draws no entry. Unset in production means closed. Opening the store to everyone is a secret change to `*`; it needs no code change or App release. Live gateway keys are a separate, reviewed code change gated on #3419. Independently of this switch, production has no custody keyring until the external KMS of design v1 F10 exists, so the store answers 404 there.

## Not yet enforced in the first slice

`updates`, `payout.schedule` (no transfer exists; the ledger only records amounts), `refund.after_split` for already-paid balances, `linked_adult.verification`, and the `tax` handling of referral payouts. They take effect when the work that needs them ships after #3419.
