# Studio skill store: Mac authoring, Windows reuse

Updated 2026-10-16. Sponsor: TJ. DEC-025 extends the active delivery goal;
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

Baseline source inspection: Studio `0b57074d`, local Service `abf79a8b`.
Current Mac runtime: `9b4dd233` (main05efefdb integration, conversational withdrawal
and learner wording). Native reconnect, bot-owned Sheet preview and App/instructor6/6 are verified;
prior three-principal store observations retain their original revision boundaries.
The served private Windows candidate is now `e3ab008b` (same extension code as
3d8c0b38), shell720be661 / SDK0.3.299, through private R2 gateway7a9c50d2. Stored
app/SDK full byte counts and hashes, final manifest readback and23 online access
controls pass. Actual archive extraction, SDK verification, profile backup and
exact-receipt handover from six prior pilots through32ba0ac2 passed in local
PowerShell. Complete authenticated HTTP download and native Windows remain open.
The candidate predates native9b4dd233 and the source622cc4e4 re-publication fix.
Old32ba0ac2 KV transport is retained for rollback; its prior incomplete transfer
is historical evidence, not a current e3 download result. R2 serves installer
files only and does not migrate the skill catalog from D1.
Native three-principal store evidence below was recorded on `3f1a3f20`.
The online Service remains pinned to
`email-local-accepted-ffef7bc-peer`. Later observations below are revision-bound.

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

The next delivery sequence is explicit: finish the local feature/lifecycle gaps,
freeze and verify one Windows candidate, then execute SS-01–12 with actual Windows
recipients. Same-content re-publication has a local recovery implementation and
actual Service-route proof below; native acceptance remains pending. Version2, update and rollback now have a local implementation and three-principal
integration proof (checkpoint below); native acceptance and fork provenance remain
open. Successful import or withdrawal alone does not close SS-08. Store acceptance remains part of the active delivery
goal, not a follow-up that can be omitted when the email feature passes.

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

That earlier Mac session was attached to the local Service on port8794. All three
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
and Stop-race fixtures pass. The later online3f1a3f20 observation below confirms
corrected native narration; the historical local observation did not.

Evidence: `/tmp/hps-email-mvp/native-store-20261015/receipt.json`, with sanitized
`publish-card.txt` and `publish-result.txt`. No mail, Google reconnect or model
gateway allocation was used; the coach used the existing local CLI subscription.
This supports the local portion of SS-02/03 only. All complete SS gates above
remain NOT_RUN, including same-Service Mac-to-Windows reuse.

## Online Mac authoring and publication — 2026-10-15

Online Mac follow-up at `06c1d92b` used the normal participation-code UI with the
existing `peer` principal and a separate online workspace. The app now targets
the same private Service as Windows. The local-CLI development provider correctly
refused a remote Service, so testing switched to the Service-funded SDK. The old
Mac test copy lacked both the seeded native0.3.299 binary and vendored JS closure;
both were restored from the pinned official seed and the verified Windows
candidate's platform-independent vendor tree. Import and ad-hoc signature checks
passed; no production package was changed.

The first actual online model turn failed `skill_save`, then incorrectly attempted
publication and Google setup. The private Google setup card was cancelled and the
turn stopped. That attempt created no online publication, Google connection or email. Its original malformed input was not retained,
so the precise validation cause is unconfirmed. Source inspection did confirm
that only the local-CLI prompt described the exact recipe shape; the shared SDK
tool description omitted it and returned an undifferentiated error. The follow-up
adds the recipe contract to the tool and fixed save-specific recovery guidance.
Automation89/89 and types/build pass; the following native retry confirms saving
and publication with the declared contract.
The attempt settledUSD0.031423, held0, leavingUSD0.301911 of this subject's existing
USD0.333334 allocation. Evidence: `native-store-20261015/online-attempt.json` under
the same protected temporary evidence root. No cap was increased.

The retained single Mac Dev app was restaged to `3f1a3f20` and a fresh normal
conversation created “온라인 스토어 재사용 시험” from scratch. The host saved the
exact bounded recipe, displayed its content in the private publication card,
and published only after the checkbox/share-button action. Native tool success
was followed by “공유 완료되었습니다”; the earlier missing-approval narration did
not recur. No Google setup was attempted in this successful flow.

A read-only authenticated readback then used all three distinct Studio principals:
each listed and fetched the same version1 and exact reviewed recipe; only `peer`
was the owner. Canonical recipe SHA256:
`108ccb87a3065b9030a98d55b1c1f63714cad8e3a86ce78ddfdd2d44562d0bc9`.
Publication remains available for Windows acceptance. Recipients here used API
reads, not native installation; Google aliases are not yet mapped to these grants.
This passes the bounded email author's native save/review/publication steps only.
It does not pass SS-01–12 as a whole, recipient execution or the expanded GAS flow.

Current subject funding after both online turns:USD0.060136 spent,0 held,
USD0.273198 remaining ofUSD0.333334. The existing pool andUSD3 ceiling are unchanged.
The new activity has no Google connection; memory-only Dev credentials from earlier
runs are not restart-persistence evidence. No new email was sent.

Evidence under `/tmp/hps-email-mvp/native-store-20261015/`:
`online-publish-card.txt`, `online-success.txt`, `online-publication.json` and
`online-reviewed-recipe.json`. Earlier `receipt.json` is local-only evidence and
`online-attempt.json` records the failed first SDK attempt; neither is overwritten.
Runtime3f1a3f20 now has all18 CI checks passing after one classroom-browser
failed-job rerun. Inspection found the retention test could confuse a command
from the preceding scenario with its new click; the follow-up test helper waits
for an ID absent before that click. This changes no packaged application code.

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
selection follows the completed research recommendation; no new paid service,
public bucket, permission grant, production rollout or sender payout is authorized
by this design update. Ask about Windows access at execution time, not now.

### Private installer transport preparation (not a skill-store migration)

The unexplained incomplete32ba0ac2 download motivates a bounded comparison with
R2 streaming. `scripts/email-test-r2-download.mjs` now provides a local-only
candidate handler: every request rechecks the existing participant allowlist and
pinned Service access grant, then reads only two immutable, digest-addressed
archives named by a pinned manifest. It denies expired pilots, partial requests,
wrong manifests, wrong sizes and available checksum mismatches; it forwards the
R2 stream without assembling the ZIP in Worker memory. Public responses contain
only selected manifest fields, never operator metadata. The client must still
hash the full bytes before extraction; an HTTP200/header is not that verification.

The handler and existing authorization suite pass13 local controls, including
real composition of allowlist/grant checks, revoked access after a prior success,
missing/malformed storage, stream cancellation and metadata privacy. CI now runs
these controls. A dedicated `hps-studio-email-test-20261015` bucket now exists:
r2.dev is disabled, no custom domains are attached, and the `install/` lifecycle
expires objects and incomplete multipart uploads after seven days. The prepared
handler additionally enforces its fixed seven-day deadline. The first large upload
terminated with HTTP401 and a subsequent GET confirmed no app object. A small
synthetic PUT then succeeded with the existing authorization; no new permission
was requested. The single retry completed: app196648104 bytes and SDK121940997 bytes were
read back with exact SHA256 values, then the manifest was published and read back.
Token expiry remains a possible, unproven cause
of the first failure. Gateway7a9c50d2-650f-4659-b9f9-bdf11135662a now serves the
R2 candidate; the existing pinned Service test version and production traffic
allocation were preserved. All23 online access controls pass. Complete HTTP body
verification is still required before claiming successful delivery or a performance
improvement. The authenticated HTTP/2 app GET terminated at300.02s with
28818717 bytes and curl28 (timeout); the partial digest is not an archive hash.
The HTTP/1.1 comparison also ended with curl28 at300.02s and11611200 bytes.
Neither protocol completed the archive. Continue on the Windows network rather
than repeat the same Mac transfer; the root cause is not established. R2 object readback does not pass gateway delivery. Actual Windows
remains a separate gate.
The preparation receipt and live upload checkpoint are under
`/tmp/hps-email-mvp/windows-current-e3ab008b/`; a running process is not upload success.


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
Windows PowerShell startup timeout passed the failed-job rerun. At that observation the Mac
app was0b57074d. The private online Windows
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
and local gateway checks. The gateway version at that observation was
`b61bcf9c-22fc-4d2f-a2af-da5d4dd43a2c`. These preparation results do not complete
SS-01–12: native Google mapping, Windows execution and the expanded workflow
remain open. The subsequent Mac author observation is recorded above.

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

### Windows candidate for the native store fixes

A local candidate now pins shell720be661 / extension3f1a3f20 / SDK0.3.299,
including explicit publication acknowledgment and SDK recipe/save recovery.
PowerShell fixtures inspect both real archives, verify seven extension file
hashes and packaged resources, preserve profile backups and accept upgrades only
from exact receipts for682dfd37,9d535c87,0b57074d andf90b65e3. Fourteen download
controls and the current three-participant gateway controls pass locally.
Candidate artifacts: `/tmp/hps-email-mvp/windows-current-3f1a3f20/`.
Private gateway29267565-35ea-4eed-9387-e4a05493c00b now serves3f1a3f20.
The three-principal access helper and pinned remote Service binding are unchanged.
Sixteen immutable download chunks and the manifest passed upload/readback with
a7-day TTL. All23 current three-principal manifest/profile/download metadata,
outsider/revoked/anonymous denial and exact installer-script checks pass. Complete
end-user archive download/hash readback initially failed to complete. HTTP/1.1 was stopped
after more than360s; a separate bounded HTTP/2 attempt received41432480 of
196646585 bytes in180.03s and exited28 (timeout). Neither proves the full archive
hash. All source archive hashes and16 upload-chunk readbacks passed; those do
not substitute for this end-user download gate. The transport cause is unconfirmed.
Compare the current temporary KV installer transport with private R2 delivery
before treating this as20-seat classroom readiness; do not assume a protocol
change alone fixes it. No R2 migration or new subscription was performed.

A subsequent bounded1200s-per-file HTTP/2 retry completed at2026-10-15
20:10:52KST: app196646585 bytes in76.39s and SDK121940997 bytes in35.41s,
both exact pinned SHA256. This closes the current archive-download integrity
gate, not the unexplained latency variation or real Windows execution gate.
`online-verification.json` records the successful full read;
`download-interrupted.json` and `http2-progress.json` retain earlier failures.
This preparation does not establish native Windows installation or credential reuse.

The retention-test helper correction passed all18 local AT-41 browser result cases.
The installer/test follow-up commit is `d1a8d6a5`; it does not change runtime3f1a3f20.

### Private Service version routing recovery — 2026-10-15

At20:14:35KST a new default Service deployment omitted the existing zero-percent
email test version. The private gateway then returned503 for all three profiles
because its expected-version check failed. The public health route stayed200;
no participant credential was blamed, rotated or widened. This is separate from
the earlier slow archive transfers, whose cause remains unconfirmed.

Cloudflare applies a version override only when that version is in the active
deployment, including at0%; otherwise it follows the default traffic split.
The gateway's marker check therefore prevented silent execution on the new
unvalidated default. See [official version override semantics](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).

A fresh deployment read and dry run preceded recovery: retain the newly deployed
production version at100% and reattach the exact prior test version at0%.
The post-change deployment read confirmed both percentages. No Service code,
schema, participant tokens, budgets, Google permissions or default traffic
allocation changed. All three profile reads subsequently returned200.
Readback artifacts are under `native-store-20261015/`: `reattach-receipt.json`,
protected before/after deployment records and apply/dry-run logs. All23 current access controls passed again after recovery; the separate
`windows-current-3f1a3f20/access-after-reattach.json` retains that readback.

Before the Windows/classroom run, verify that the intended test version remains
in the active deployment and that private health/profile match it. Do not silently
adopt the default Service version after a later deploy. This dependence on the
production deployment list makes the current zero-percent mechanism a temporary
pilot arrangement; a separately versioned test Service with explicit resource
bindings is a follow-up design, not an implemented isolation guarantee.

### First native recipient import — 2026-10-15 20:24KST

In the same single Mac Dev app3f1a3f20, the distinct `original` Studio principal
joined through the normal participation-code UI using its own workspace and
existing funded allocation. A normal SDK conversation listed the actual catalogue,
selected the author's retained item, displayed its exact title/body/column mapping
in a private import card, and installed it only after “이 스킬 가져오기”.
The coach reported installation complete; the actual quest advanced to2/6 and
left Google/Sheet/execution stages pending. No Google connection or email occurred.

Read-only verification of the host's persisted state, keyed by each principal's
fresh Service-verified activity ID, found the exact reviewed recipe in two distinct
activity namespaces. The author's copy was unchanged; the recipient's store view
still marked the publication as not owned by it. This proves native discovery,
review and installation for one recipient on Mac, not Windows execution, three
Google identities or the expanded GAS template path.

Changing workspace in this isolated Dev app lost memory-only activity credentials;
normal re-entry in the selected folder restored the activity. Do not treat this as
successful OS-backed persistence. Keep real Windows restart/credential reuse in
the required gate. The transient Service outage and its recovery above were also
observed through the actual participation screen; existing codes were reused.

Evidence under `native-store-20261015/`: `recipient-original-card.txt`,
`recipient-original-success.txt`, `recipient-original-success.png` and
`recipient-original-receipt.json`. No operator JSON import or duplicate publication
was used. At this observation the third Studio principal had API-only store
evidence; the later native result follows below.

The20:26KST funding readback (`budget-after-native-recipient.json`) records
USD0.060136 author spend andUSD0.026030 recipient spend, totalingUSD0.086166
of the existingUSD1 pool. All three have zero held, overrun and unresolved cost;
no allocation increased and historical usage remains retained.

### Second native recipient import — 2026-10-15 20:57KST

The third distinct Studio principal joined in the same single Mac Dev app3f1a3f20
using a separate `recipient-third-workspace` and its existing funded allocation.
Its normal SDK conversation called the actual store list, selected the retained
author publication and displayed the exact title, description, subject/body and
four column mappings in the private review card. Clicking “이 스킬 가져오기”
completed installation; the tool receipt and coach confirmed success, and the
actual quest advanced from0/6 to2/6 with Google/setup/execution still pending.
No operator JSON transfer, duplicate publication, Google reconnect or mail occurred.

Read-only host-state comparison using fresh Service-verified activity IDs found
three distinct namespaces containing the exact reviewed recipe. The author and
first recipient copies remained unchanged; the third recipient's store view
marked the item as not owned by it. This establishes native Mac discovery and
installation for both recipients, but does not complete SS-07: independent Google
settings/results, Windows execution and the full denial matrix remain outstanding.
Workspace reload again required normal code re-entry because this isolated Dev
app uses memory-only credentials; no Windows credential persistence is claimed.

Evidence under `native-store-20261015/`: `recipient-third-card.txt`,
`recipient-third-success.txt`, `recipient-third-success.png` and
`recipient-third-receipt.json`. The20:58KST readback in
`budget-after-native-third.json` records totalUSD0.113022 spent from the existing
USD1 pool (author0.060136, first recipient0.026030, third0.026856), held0 and
overrun0. No allocation increased. Studio documentation headeb6e6797 had all18
CI checks passing before this evidence-only update; runtime remains3f1a3f20.


### Conversational withdrawal follow-up

Before62aff11d the conversation exposed publish/list/install, while owner withdrawal
was reachable only in the retained inspector. The new source adds `skill_unpublish`
to the SDK and local subscription transports. A private card names the exact
owner publication and explains that installed copies and Google connections
remain. Host checks cover cancellation, Stop at both authorization stages,
revocation, server failure, duplicate answers and unchanged credentials/unknown
send records. Only a successful explicit store receipt can report withdrawal;
only publication quest evidence is invalidated, with a generation guard.

Automation90/90, focused21 checks, types/build and real App browser-card tests pass
locally. At22:12KST, native Mac62aff11d completed the owner withdrawal through
the actual conversation and private review card against local Service2ce0b2e.
An API-created synthetic fixture supplied the target; this is not a new native
publication test. Readback confirmed list absence and detail404; hashes of four
saved recipes and one durable ledger remained unchanged. All18 CI checks pass
at62aff11d. No Google action or mail was performed.

A prompt-only follow-up3d8c0b38 prevents copying internal receipt fields into the
learner reply. After restaging the same Mac app, an actual no-action summary
request produced natural-language results without those keys/IDs. Its SDK/local
transport19 checks, types/build pass; its separate CI is still pending. Evidence:
`native-store-withdrawal-20261015/{receipt.json,confirmation.txt,success.txt,
learner-summary.txt,learner-summary.png}` under `/tmp/hps-email-mvp/`.
The served Windows32 candidate does not include this follow-up. This does not
implement version updates or rollback. The current Service rejects reuse of an
unpublished request ID. The later local recovery below addresses new publication
intent without restoring that tombstone; native acceptance remains separate.


### Same-content publication after withdrawal: local recovery

The original content-only request ID stayed permanently withdrawn. The client now
recognizes only Service409 `error.code=publication_unpublished` as that terminal
state. It prepares a new request ID in a private, activity-namespaced journal and
reports that a fresh sharing review is needed. It makes no replacement POST in
that failed call. A subsequent conversational request must pass the existing
private confirmation again; cancellation/Stop/revocation cannot publish. The
inspector similarly clears only the terminal request and requires a newly reviewed
action. An ordinary conflict or unknown network result never rotates the ID.

The conversation journal contains only content digests/request IDs and uses the
existing cross-window lock plus atomic0600 file writes, separately from the send
ledger. A restart or lost response reuses the prepared ID. Corrupt storage refuses
dispatch; no Google credentials, recipe content or recipient data enter this file.
The old publication remains withdrawn, and the replacement is a new version1
publication; this is not version2, an update chain or rollback support.

Focused host/client/journal tests and the91-test automation suite pass, as do
extension typecheck/build. A local integration ran the actual Service route with
its migration-backed SQLite database: publish→withdraw→terminal replay→new
publication→response loss→retry left exactly one visible replacement; a second
principal could read it but could not withdraw it. No Service source/schema change,
Google action, mail or live store mutation was required. Evidence under
`/tmp/hps-email-mvp/`: `republish-automation-tests.log`, `republish-typecheck.log`,
`republish-build.log`, `republish-service-integration.log` and its script.
This is local functional evidence, not a native Mac or Windows re-publication PASS.


## Immutable revisions checkpoint — 2026-10-16

Local Servicee76d1c2 adds re-runnable migration0046:
`automation_recipe_versions(recipe_id,family_id,release_version,parent_id)`.
It references existing inert `automation_recipes`; both insert in one atomic D1
batch. Legacy rows remain v1 without rewriting them. The metadata table is included
in schema and backup coverage. No remote migration or active Service change has
been performed. Ops' canonical schema still needs the reviewed addition.

- Publish optionally binds the latest owned `parentId`. Each revision has a new
  immutable ID and digest; identical retry returns the same receipt. Conflicting
  parents or concurrent authors cannot overwrite a release.
- Latest discovery returns one card per family. `/:id/versions` returns visible
  versions to the same authorized cohort. Withdrawing the newest revision never
  silently makes an older version the latest. Exact older IDs remain usable while
  those versions are published.
- Studio keeps package `formatVersion:1` separate from the release number. It
  checks downloaded SHA256 and lineage before installation. Legacy v1 responses
  remain supported; old Studio clients reject v2, so upgrade recipients first.
- Conversation tools use the existing publication and installation review cards.
  `skill_publish(parentId)` names the next version; `skill_list(id)` shows history;
  `skill_install(id)` confirms the exact selected version for update or rollback.
  The local CLI and SDK both preserve optional arguments. Installing never sends
  mail, replaces credentials or transfers approvals/ledgers.

The actual Studio client/publication helper/import controllers were exercised with
Service routes and SQLite under three signed synthetic principals: A publishes
v1/v2; B updates to v2 then restores v1; C stays on v1. Owner checks, replay,
withdrawal and zero Google execution passed. Host tests also cover rollback
cancellation and unchanged private connections. API15/readiness3, local D1 batch
rollback/concurrency, classroom-ops10 commands, Studio automation91/local-runtime8,
types and builds pass. Logs are under `/tmp/hps-email-mvp/store-version-*`.

SS-08 remains PARTIAL: native Mac/Windows evidence, recipient fork provenance and
coordinated migration/release are outstanding. Hash verification detects altered
content against the API receipt; it does not independently authenticate a publisher
or replace Service authorization. General executable packages remain out of scope.
