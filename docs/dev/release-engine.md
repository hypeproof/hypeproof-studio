# Local daily release coordinator (#1757)

The coordinator resumes an existing `release-cut` candidate from a private local
ledger and produces an exact-manifest **promotion intent**. It does not start
builds, call models, create GitHub issues, sign approvals, or publish releases.
Those external adapters remain separate. No dependency, service or runner is added.

## Requirements

`REQ-STUDIO-RELEASE-ENGINE` implements a bounded first part of the daily delivery
plan: pinned candidate identity, complete evidence, zero incremental cost,
rotating manager approval and recoverable event decisions. It follows
[human judgment and evidence](../PRODUCT-INTENT.md) and preserves the
[existing App acceptance gates](unified-release-and-migration.md).

- Every required artifact and black-box test comes from trusted policy, never
  from a candidate's requested subset. Missing, FAIL, BLOCKED and NOT_RUN refuse
  approval. Candidate, Service, test/rubric revision, bytes and evidence are bound.
- An explicitly signed approval binds the manifest and evidence digests to the
  on-duty manager's roster revision and term. Rotation, revocation, expiry,
  changed bytes or a newer channel intent invalidate promotion. Jay is the first
  manager; roster dates and keys must be configured by the operator.
- Reserve verified free/included capacity before an external operation. Unknown,
  stale or exhausted capacity refuses new work. Record failure, cancellation and
  timeout consumption. Unknown outcomes keep their reservation. Incremental cash
  cost must be zero; a manager cannot override it or enable paid fallback.
  Every policy-required work stage/resource needs a successful settled attempt;
  arbitrary stage names cannot reset retries or hide missing model/storage costs.
- A repeated event is idempotent. The same candidate inputs cannot obtain a new
  attempt allowance by changing run ID, version or channel sequence. Failures
  deduplicate by repository, test revision, classification and stable signature,
  across candidates; product fixes are limited to one reserved attempt.
- Unit fixtures never establish installed-App, provider billing or publication
  acceptance. The approved synthetic acceptance **cohort** is allowed for an
  observed App run; mock execution is not.

## Design

`scripts/release/engine/core.mjs` makes provider-independent decisions.
`store.mjs` hashes actual files, serializes local writers, atomically persists the
ledger with fsync, and recovers claims whose same-host owner PID is demonstrably
dead. A live/unknown/foreign writer is never evicted by time. This is a single
host on a local filesystem, not a shared drive or distributed database.

Events have `{id, type, data}`. A reused ID with a changed payload is rejected;
retry a deliberately changed input with a new event ID. The event result and
reservation commit in the same ledger transaction. `duplicate: true` never
authorizes an external operation to run again. After a crash between dispatch and
receipt, reconcile the existing operation before settling it or requesting a
bounded retry. The engine does not claim exactly-once external effects.

The private ledger and policy are trusted operator inputs. Ed25519 signatures
establish which configured key attested a report/approval; they do not prove a
screen was observed, authenticate a GitHub account, or protect against a local
administrator rewriting both policy and ledger. Keep verifier and manager private
keys outside this checkout/ledger and outside each other's execution roles.

## Run locally

Requires Node 22+ and a local writable directory. Use an operator-reviewed copy
of [the policy template](../../scripts/release/engine/policy.example.json), with
actual Ed25519 public keys and non-overlapping manager UTC terms. The placeholder
template intentionally refuses execution. Changes to the test/artifact/key
contract require a new candidate; roster changes invalidate old approval.

Use an existing `release-cut` `plan.json`; no new smoke or paid request is started.
`dry-run` plans are accepted as local input, but trial `--since` plans are refused.
The plan's S1–S5 smoke PASS is never substituted for installed-App acceptance.
Create `inputs.json` with actual 40-character `serviceSha`, `testRevision`,
`rubricRevision`, and a strictly increasing positive channel `sequence`.

```bash
node scripts/release/engine/cli.mjs init \
  --store /private/release-ledger --policy /private/release-policy.json \
  --plan /private/release-cut/plan.json --inputs /private/inputs.json

node scripts/release/engine/cli.mjs artifact \
  --store /private/release-ledger --policy /private/release-policy.json \
  --candidate CANDIDATE_ID --artifact mac --file /private/candidate.zip \
  --event mac-artifact-1

node scripts/release/engine/cli.mjs ingest \
  --store /private/release-ledger --policy /private/release-policy.json \
  --event-file /private/event.json

node scripts/release/engine/cli.mjs status \
  --store /private/release-ledger --policy /private/release-policy.json \
  --candidate CANDIDATE_ID
```

`manifest --candidate ID` prints the manifest and digest for the verifier.
`approval-request --candidate ID --expires UTC_TIME` emits the precise body for
the manager to review and sign; it cannot sign or approve. A signed envelope is
`{body, signature}`, where `signature` is base64 Ed25519 over UTF-8
`canonical(body)` exported by `core.mjs`. Evidence uses the same encoding.
`--out` saves a result to a previously absent file. BLOCKED exits with code 2.

## Event adapter contract

| Type | Required data and effect |
|---|---|
| `quota.observed` | `resourceId`, `periodId`, UTC `startsAt/endsAt/observedAt`, `remainingUnits`, `protectedUnits`, `status: confirmed`, `incrementalUnitCost: 0`, `paidFallback: false`, `evidenceUri`. Operator/provider attestation must establish real account allowance and billing settings. |
| `work.reserved` | `candidateId`, stable `stage`, `attempt` (1..policy limit), `resourceId`, positive `units`. Returns stable `reservationId`; reservation is durable before dispatch. |
| `work.settled` | `candidateId`, `reservationId`, nonnegative `actualUnits/incrementalCost`, `outcome` (`success/failed/cancelled/timeout`). Any overrun persists and blocks the resource. |
| `evidence.recorded` | `candidateId`, signed `envelope` from a permitted reporter. See fields below. |
| `approval.recorded` | `candidateId`, signed approval envelope returned by `approval-request`. Every gate is rerun before acceptance. |
| `approval.revoked` | `candidateId`, signed body with schema `hps-release-revocation/1`, `candidateId`, current `actor/roleRevision`, `approvalDigest`, UTC `revokedAt`. Old approval signatures stay revoked. |
| `failure.observed` | `candidateId`, `kind` (`product/test-contract/environment/quota/infrastructure`), `checkId`, stable sanitized `signature`, `evidenceUri`. Returns one ticket intent with all observations. No issue is created. |
| `fix.requested` | `candidateId`, `failureId`, `reservationId` whose stage is `fix:FAILURE_ID`. Only product failures and one reserved attempt produce a fix intent. No agent is launched. |

A black-box evidence body has schema `hps-black-box-evidence/1`, `candidateId`,
`manifestDigest`, `reporterId`, `testId`, `requirementId`, policy-exact `expected`,
nonempty `observed`, `verdict`, `artifactDigest`, `serviceSha`, `testRevision`,
`rubricRevision`, UTC `startedAt/endedAt`, `execution: observed`, environment
`{kind: installed-app, target, runnerId}`, and `file: {path, sha256, size}`.
`fixture: true`, headless-build evidence, wrong keys and stale report ordering are
rejected. These fields are attestations from a trusted verifier, not automatic
proof from the coordinator. Files must be present, nonempty and match their hash.

Product/test-contract failure observations require investigation and a changed
source or contract candidate. Environment/quota/infrastructure failures remain
diagnostic ticket intents; current required evidence, settled budgets and quotas
still decide readiness. Never relabel a product failure to avoid the gate.

Capacity accounting is deliberately conservative: reservations are not refunded
within a period, even when actual usage is lower. New observations can lower,
never inflate remaining capacity. A new non-overlapping billing period requires
all previous work settled. This may stop early; it cannot establish the provider's
actual invoice without a trustworthy adapter and reconciliation. Unreported work
outside this ledger remains an external risk and is not claimed accounted for.

## Publisher boundary

```bash
node scripts/release/engine/cli.mjs promote-intent \
  --store /private/release-ledger --policy /private/release-policy.json \
  --candidate CANDIDATE_ID --event promote-1 --out /private/promotion.json

node scripts/release/engine/cli.mjs check-intent \
  --store /private/release-ledger --policy /private/release-policy.json \
  --intent /private/promotion.json --tag VERSION --sha CANDIDATE_SHA
```

The intent preserves existing release-cut `version`, `candidate`, `rcTag`, plus
artifact digests and the exact signed approval. `check-intent` rereads the current
ledger, files, quota and roster; a cached intent or duplicate event is not authority
to publish later. The existing tag/PR publish gate in
[PR #1684](https://github.com/hypeproof/hypeproof-studio/pull/1684) must also pass.
Its hotfix bypass cannot stand in for this engine's manager approval. Do not feed
this intent into `create.mjs` (which creates/builds an rc again).

**Workflow wiring is NOT RUN and not included here.** The remote adapter still
needs a durable publication lease/CAS, fresh checks immediately before the side
effect, immutable byte promotion, signed/installed evidence ingestion, exact
Service deployment observation, issue dedupe and quota-provider reconciliation.
Current workflows are not changed to claim these guarantees. The local intent
state is never `PUBLISHED` and does not prove customer update delivery.

## Verification

`node --test scripts/release/test/engine.test.mjs` runs six integrated local
scenarios: CLI restart through intent; required-evidence/byte tamper controls;
two-process quota contention; manager rotation/revocation/expiry/stale intent;
failure dedupe and bounded fixes; SIGKILL recovery, live-lock protection and
event-payload conflict. Tests use generated throwaway keys and fixture evidence,
no network, account credentials or models. Existing release-cut/create tests also
remain required. PR CI runs the engine test in its existing job.

Observed locally on macOS arm64 / Node 24.4.1. Linux CI, Windows coordinator,
Mac/Windows actual installation/update, provider allowance/billing, remote
approval/promotion, customer delivery and seven-day operations remain NOT RUN.
This closes the local decision/persistence slice, not the daily-release program.
