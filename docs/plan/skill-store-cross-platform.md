# Studio skill store: Mac authoring, Windows reuse

Updated 2026-10-15. Sponsor: TJ. DEC-025 extends the active delivery goal;
this is a design and acceptance contract, not completed implementation.
Requirements: EA-06/07/09, and the reusable-template destination in WAJ-03/06/07/11.
Parent: [delivery goal](email-automation-next-steps.md).

## Required outcome

After feature implementation, a learner creates a useful workplace automation in
Mac Studio, publishes it through the integrated store, and another person finds,
installs, configures and successfully runs that exact version in Windows Studio.
No manual JSON/file transfer, shared Google login, author credentials or company
Cloud IAM is allowed to substitute for this journey. Opening a store card or
downloading bytes is not successful reuse.

The three existing Google account aliases are locolor, locolorbot and TJ. Proposed
test roles are A=locolor/Mac author, B=locolorbot/Windows recipient, C=TJ/independent
recipient and isolation control. Roles may rotate without changing the criteria.
Each must also have a distinct Studio principal: switching only the Google login
inside one Studio participant does not establish store ownership isolation.
Use separate Windows OS users or supported isolated app profiles, sequentially
on one PC if necessary. Preserve the user's request to keep only one Mac Dev app.
Never put actual addresses, participant tokens or Sheet IDs in shared evidence.

Publish and discover inside an explicit test audience. Current runtime supports
cohort-only sharing. The final audience (same class, invited users across classes,
or all Studio users) is a pending product choice; neither a guessed ID nor an
object-storage URL is authorization. All-three-account success plus a separate
unauthorized audience control is required. The third allowed user is not also
the unauthorized audience unless membership is explicitly changed and recorded.

## What is implemented today

Source inspection: Studio runtime `0b57074d`, Service integration `abf79a8b`.

| Layer | Current source fact | Limit |
| --- | --- | --- |
| Store API | Studio `automationStoreClient.ts` calls authenticated `/v1/automations`; HTTPS outside loopback, no redirects | Configured Service origin and active capability are required |
| Storage | Service D1 `automation_recipes`: owner/cohort, JSON, SHA256, request ID, timestamps, unpublish marker; migration0045 | No general executable-package registry or seller marketplace |
| Format | `hps-email-automation/1`: title, description, email category, subject/body templates and four column mappings; max32768 UTF-8 bytes | Fixed placeholders and exact keys; no arbitrary scripts, dependencies or MCP endpoints |
| Privacy | Server and host validate; email/URL/token patterns and secret scan reject known sensitive content | Pattern scanning cannot prove prose contains no private information; author reviews exact public fields |
| Access | Signed Studio student token, roster/cohort/profile/grant/session gates; owner-only unpublish | Personal account tokens currently rejected; cross-cohort invitation/public discovery absent |
| Download | Detail API returns recipe JSON, then Studio validates and installs a local copy | Stored server SHA is not a signed publisher identity; API returns no signed package manifest |
| Local state | Recipe in host globalState by activity namespace; Google/Sheet settings in SecretStorage; durable local send ledger | No automatic credential/approval/state migration with download; Dev memory-only secrets are not Windows protection evidence |
| Execution | Packaged pinned managed GAS runner executes bounded email recipe as recipient Google identity | Future learner-owned GAS web-app packages are a separate executable-code trust boundary |
| Withdrawal | Unpublish hides future list/detail results | Does not remotely delete installed copies, revoke Google consent or guarantee offline execution revocation |

References: Studio `extensions/hypeproof-chat/src/{automationHost,automationStoreClient,googleAutomation}.ts`;
Service `worker/src/routes/automations.ts`, `worker/src/lib/automation-recipe.ts`,
`worker/migrations/0045-automation-recipes.sql`.

## Proposed delivery and trust model

The [source-backed distribution research](skill-store-distribution-research.md)
compares official pricing, access semantics, n8n/Open VSX/ORAS/Sigstore/TUF patterns
and licenses. Recommendation: current D1 recipes first, private R2 for larger
reviewed packages later. Supabase remains an evaluated alternative.


Prefer the existing Service identity/policy and D1 catalogue as the authority.
Keep small bounded recipes in D1. If images, sample datasets or reviewed code
bundles are needed, evaluate private R2 objects behind that same Service; adding
another vendor must solve a demonstrated requirement. Compare Supabase Storage
and Postgres/RLS as an alternative, not a second simultaneous source of truth.
Existing subscriptions are user-reported; exact plans, quotas and unused credits
have not been inspected. Free distribution to learners does not mean zero cost.

Separate three things: **shareable template**, **recipient's configuration**, and
**execution records**. Only the first travels through the store. Connections,
source/output folders, Sheet IDs, triggers, approval snapshots, recipient lists
and send/execution history belong to the recipient. Any optional synthetic sample
must be explicitly identified as sample data and independently scanned.

For expanded packages, propose a versioned manifest with package ID, immutable
version, author principal, audience, license, schema/runtime kind, minimum Studio
version, supported OS/runtime, entrypoints, declared capabilities/scopes/domains,
file paths/sizes/digests and a Service release/provenance record. A release points
to immutable bytes; latest is a selection pointer, never an overwrite of v1.
Canonicalization must be specified before hashing/signing. A hash proves byte
integrity; a trusted signature binds an issuer, not harmlessness or correctness.
Do not describe this future manifest/signature as implemented today.

Upload goes to quarantine → schema/path/size/secret/license checks → reviewable
preview → authorized publication → immutable download → local validation →
explicit install → private recipient setup → preview/test → approved execution.
Validate server-side and client-side. Download URLs, if used, are short-lived
bearer capabilities; never persist them as public catalogue links or put tokens
in logs. Explain that already downloaded bytes cannot be recalled by expiry.

The bounded email recipe remains non-executable. Future GAS source, HTML or
`SKILL.md` instructions are untrusted code/content: never execute during listing,
preview or installation. Require source review and declared capability checks;
separate author-requested privileges from Service grants and Google consent.
No embedded install scripts, arbitrary dependencies, shell hooks or remote MCP
servers in the first expanded package. For personal GAS, create recipient-owned
resources and separate consent/deploy/test steps; never reuse the author's
deployment, trigger owner or execution identity.

Use explicit update with a version/diff/permission summary and rollback target.
Updates must preserve recipient settings and ledgers, invalidate affected previews
and approvals, and request consent only for genuinely new permissions. Withdrawal
blocks new downloads; a security quarantine needs an online deny rule and visible
offline limits. Never silently execute a quarantined cached version as fallback.
Rollback cannot clear an unknown/sent outcome or restore a withdrawn privilege.
Retain author/license provenance on forks and define what may be redistributed.

## Acceptance: Studio-connected store, not an isolated API

All rows below are **NOT_RUN for this new three-account/cross-platform gate**.
Historical two-account tests remain supporting evidence at their recorded SHA.

| Gate | Positive observation | Required rejection or recovery |
| --- | --- | --- |
| SS-01 Identity/audience | Three distinct Studio principals and Google accounts; declared audience visible | Wrong cohort/invite, expired/revoked token, direct ID and download URL cannot expose private packages |
| SS-02 Mac authoring | A creates a source-grounded automation, tests synthetic input, publishes exact reviewed contents through Studio | Missing prerequisites, cancellation, embedded identifiers/secrets/code in bounded recipe rejected; no silent publish |
| SS-03 Store discovery | B and C locate A's package in their Studio store; author/version/requirements clear | Unpublished or unauthorized package absent from list and detail; invented success state prohibited |
| SS-04 Windows install | B installs the same immutable package through Studio on real Windows; saved after restart | Corrupt bytes, unknown schema, incompatible runtime, unsafe paths or permission escalation fail before execution; retry is idempotent |
| SS-05 Recipient setup | B supplies own Google resources privately; setup guide names only missing fields | No author credential, Sheet, deployment, trigger, approval or ledger transferred; copied absolute Mac paths rejected |
| SS-06 Useful execution | B runs on its own different synthetic dataset and matches an independently prepared expected result | A's private data is denied; output reports missing/invalid input accurately; deterministic steps make no model requests |
| SS-07 Third-user reuse | C independently installs and runs, with different settings; B unchanged | C cannot edit/unpublish A's package or read B's settings, results or history; Google-only account switch is insufficient proof |
| SS-08 Version/fork | A publishes v2; B explicitly updates while C remains pinned to v1; compatible rollback works | Tampered/replaced v1, hidden added scope, stale approval, ledger reset and duplicate execution blocked; recipient forks retain provenance |
| SS-09 Withdrawal | A unpublishes; future discovery/download blocked; cached-copy state explained | Unpublish must not pretend to erase installed code or revoke Google; security quarantine follows explicit offline policy |
| SS-10 Network/restart | Interrupted fetch/install recovers without half-installed active package; app restart preserves local setup | No credential in logs/cache/public URL; no automatic retry of unknown external side effect |
| SS-11 Expanded workflow | After WAJ implementation, a real course-need template is published on Mac and creates B-owned GAS web app/resources on Windows | Downloading local comparison HTML or the email recipe cannot pass personal deployment/background-processing acceptance |
| SS-12 Cost/operations | Record storage, requests, egress, scans/builds, support, retention and expected20/1000-user load | Free tier or paid subscription alone cannot establish capacity, zero costs, abuse controls or commercial OAuth approval |

For email, successful execution means recipient-specific **no-send preview**.
The previously authorized one self-mail was already sent; this gate grants no
new send. If a send becomes necessary, prepare the exact new recipient/content
for separate approval. For comparison/report templates, inspect the actual
generated result against an independent answer; background execution additionally
requires closing Studio/browser and observing the recipient-owned scheduled run.

One receipt per row: date, Studio shell/extension/Service/runner revisions,
package/version/digest, author/recipient aliases, OS, audience, action, expected
versus observed, pass/fail/not_run and redacted evidence reference. Keep actual
account mappings protected locally. Cover allow and deny cases at the API and
actual Studio UI; mocks, a website catalogue and package hashes alone do not pass.

## Private test environment readiness

The private online gateway now admits exactly three separately provisioned Studio
principals through one operator-owned allowlist used by API and installer routes.
Missing/invalid configuration, duplicates, more than three entries and removed
credentials fail closed. The legacy single-participant secret is retained only
for explicit rollback; a configured list supersedes it. Installer downloads also
recheck the token through the pinned Service access route, so a stale allowlist
alone cannot bypass token expiry/revocation or roster denial. Failures/version
mismatches block download before object lookup; response bodies are not forwarded.
Store API calls retain Service's separate signature/cohort/grant/ownership checks.

The gateway still forwards to the previously approved remote Service revision
`email-local-accepted-ffef7bc-peer`; the local audit uses `abf79a8b`. The updated
client's bounded recipe contract was exercised against both. No production
traffic, remote schema, existing budget or Google connection was changed. The
third Studio grant is a test identity, not proof of a third Google account login.
Map and verify all three actual Google aliases during native acceptance, retaining
one Mac Dev app. Do not reuse one Studio code across all three Google accounts.

## Native Mac publication observation — 2026-10-15

The retained Mac app at `0b57074d` listed three existing recipes through the
conversation's real `email_skill_list` tool, then displayed the exact stored
recipe in its private publication card. The privacy checkbox and explicit share
button were exercised. Local Service `abf79a8b` persisted the exact reviewed title,
description, placeholder templates and four column names, with no unpublish marker.
This republished an already-imported recipe; it is not new-from-scratch authoring.

The Mac session is currently attached to the local Service on port8794. All three
private online principals receive404 for this local publication ID. This is an
environment boundary, not evidence of failed cross-account authorization: the
Mac local store and the Windows gateway store have distinct backing state. Before
the final journey, connect author and recipients to the same intended test Service
and verify their distinct principals. Do not copy the JSON through an operator API
and label that Studio-to-store transfer. Preserve existing local Google bindings
when selecting the online activity; any missing new-activity connection remains
a separate setup step.

The native coach incorrectly said it could not confirm the card approval after
the host had completed it. The follow-up source change returns a minimal
`approvalConfirmed` receipt only after approved publication succeeds and explains
its scope in the shared MCP tool description. Approval/cancellation/store-failure
and Stop-race fixtures pass; corrected native narration is NOT_RUN. The running
Mac and pinned Windows package have not been restaged for this receipt change.

Evidence: `/tmp/hps-email-mvp/native-store-20261015/receipt.json`, with sanitized
`publish-card.txt` and `publish-result.txt`. No mail, Google reconnect or model
gateway allocation was used; the coach used the existing local CLI subscription.
This supports the local portion of SS-02/03 only. All complete SS gates above
remain NOT_RUN, including same-Service Mac-to-Windows reuse.

## Execution sequence and decisions

1. Finish feature implementation and the current local gate. Inventory current
   store/runtime gaps; retain existing approvals and sent/unknown records.
2. Finish storage/security research and choose one incremental architecture;
   resolve visibility and executable-package policy before widening publication.
3. Local Mac author publication and three-identity API/UI controls with synthetic
   data. Then freeze one package and installer candidate.
4. When Windows is available: B install/run/restart, C isolation/reuse, then
   v2/update/rollback/withdrawal. Capture actual product evidence and fix failures.
5. Expanded WAJ templates repeat the same route after their implementation; do
   not mark the entire store complete from email-only evidence.

Public versus invited sharing is the only immediate product question. Provider
selection is an engineering recommendation pending research; no new paid service,
public bucket, permission grant, production rollout or sender payout is authorized
by this design update. Ask about Windows access at execution time, not now.


## Implementation/evidence follow-up — 2026-10-15

Three synthetic Studio principals used real HTTP against local Service `abf79a8b`
and persisted D1:19 checks passed for author publish, retry/conflict, two peers'
list/detail, peer unpublish denial, private-address/extra-code-field rejection,
author unpublish, all-three future-read denial and tombstone replay rejection.
Only the new test publication was withdrawn. No mail, Google calls or real account
provisioning occurred. Receipt: /tmp/hps-email-mvp/store-three-principal-audit/receipt.json.
These API observations support SS-02/03/07/09; they do not pass the three-real-account
native Windows journey or the unauthorized-cohort case.

Source follow-up after84404b34 closes a client-side validation gap: the shared
store client previously returned an HTTP200 JSON recipe unchecked. The conversation
path had an additional validator, but the inspector could accept the unchecked
recipe. The client now requires the requested item/version, validates the recipe,
applies publication privacy/placeholder/control-character restrictions and the
existing shared secret scanner before returning data. Malformed JSON and rejected
content produce fixed errors without remote payload text.

A failing control reproduced acceptance of an extra executable field before the
fix. Focused checks now reject that field, private addresses/URLs/token text, unknown
placeholders, hidden columns, mismatched item IDs and unsupported wire versions.
The actual inspector controller plus real store client preserves old work/settings
on rejection; valid import clears the source binding and neither path calls Google
or sends mail. Automation suite88/88, extension typecheck and host build passed.
This is source/API evidence. Runtimef90b65e3 passed all18 remote checks; one
Windows PowerShell startup timeout passed the failed-job rerun. The running Mac
app remains0b57074d to preserve its current connection. The private online Windows
candidate now includes extensionf90b65e3 on shell720be661 with SDK0.3.299.

Both complete online app/SDK downloads match pinned sizes and SHA256; anonymous
downloads deny401, and install/update scripts match the canonical installer.
PowerShell fixtures inspect the actual archives, preserve the previous profile
and recognize only exact receipts for682dfd37,9d535c87 and0b57074d handover.
Only the existing private download gateway changed; remote Service binding and
production traffic remained unchanged. Evidence directory:
`/tmp/hps-email-mvp/windows-current-f90b65e3/` (candidate, upload, deployment,
installer-online and online-verification receipts; installer fixture log).
This does not implement signatures, generic bundles or version-management UI,
and does not pass actual Windows execution or three-real-account store acceptance.

### Online three-principal preparation

The private online Service/D1 passed19 publication, retry/conflict, exact two-peer
download, owner-only withdrawal and all-three subsequent denial controls. The
only new audit publication was withdrawn and its direct fetch returned404.
Separately,23 access controls passed: each principal obtained the samef90b65e3
installer manifest and exact app/SDK HEAD metadata and an automation-enabled
profile; anonymous, unlisted and previously revoked peer credentials were denied
for store/manifest/download; install/update scripts matched the canonical bytes.
The revoked credential was also absent from the gateway list, so this live case
alone does not isolate Service revocation; the actual download helper's focused
control covers a listed token receiving Service401/403 and fails closed.

The third grant was issued through roster append and token issuance, with no
budget mutation or model/mail call. Existing peer access choices were unchanged.
Actual gateway/API/download tests and four shared-helper controls passed; CI now
includes the shared helper. Evidence: `/tmp/hps-email-mvp/store-three-account-gateway/`
contains `deployment-receipt.json`, `store-api-receipt.json`, `access-receipt.json`
and local gateway checks. Current gateway version is
`b61bcf9c-22fc-4d2f-a2af-da5d4dd43a2c`. These preparation results do not complete
SS-01–12: native Google mapping, Mac author UI, Windows execution and the expanded
workflow still require their own observations.

### Three-participant test funding

The initial read found only the peer funded. A complete, non-truncated audit of
all four prior period ledgers reconciled the three participant views with117
actual request records:1972794 microUSD spent/held in total. Existing unpriced
attempts remain reserved, including ended-but-unpriced requests; no estimate was
substituted for provider evidence and nothing was released.

The prior active test contract was suspended before activating a new private
validation contract using the already approved plan/price and unchanged end date.
Its1000000-microUSD pool is split333333 /333334 /333333 across the existing
original/peer and new third subjects. Aggregate concurrency remains1 for these
sequential test accounts. The prior exposure plus the new full limit is2972794
microUSD, below the previously approved3000000-microUSD overall pilot ceiling.
This is a private test allocation, not a new purchase, commercial renewal, reset
of learner usage or approval of the proposed20-person class budget.

Fresh Service access views show exactly one active, available source for all
three participants and the exact allocations with zero new spent/held amounts.
All117 historical attempt records, native trial request counts and tokens are
unchanged. The migration made zero model calls, sent no mail and created no
payment. It does not prove the next SDK response, Google execution or Windows
installation succeeds. Existing installations may need to select the new active
test pass once; Google connections and saved recipes were not migrated or erased.

Receipt: `/tmp/hps-email-mvp/store-budget-readiness/allocation-receipt.json`.
Protected HTTP receipts and a durable journal retain each operation. The root
creation returned HTTP201; the initial harness expected200 and stopped. Recovery
read that successful receipt and the existing empty pool, then allocated its
three children without replaying contract/root creation or increasing the limit.
Runtime/helper revisione36ff624 has all18 remote CI checks passing; later evidence
commits have their own CI state.

After allocation, the same23 live profile/download/denial controls passed again.
Installer bytes and candidate revision remained unchanged; no Google or model
execution was used for that confirmation.
