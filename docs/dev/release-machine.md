# Machine release publisher and native producer (#3631, #3632; Harness #519)

This slice connects the portable adapter (#3629) to the existing publisher and
workflows. The native producer is #3632 and the RC-ready coordinator is Harness #526.
Enrollment remains shadow until those integrations and real native prerequisites
are verified. This code does not activate the currently failing candidate.

## Requirements

- `ST-REL-PUB-01`: only an enrolled Studio release uses machine publication.
  Complete effective PASS needs no per-candidate human approval; FAIL uses the
  existing developer loop; BLOCKED uses attributed human decisions. Ordinary
  commits and products without release contracts obtain no capability. An active
  evidence failure cannot fall back to writer approval/override.
- `ST-REL-PUB-02`: committed `releases/<version>.md` freezes every black-box
  checkbox and candidate case procedure/expectation, including all required P0s.
  Candidate platform configuration fixes the matrix; reviewed applicability may
  make an installer case Mac-only, without silently dropping a case/platform.
- `ST-REL-PUB-03`: private signed evidence binds the exact PR/head, candidate/RC,
  actual source/tool/checklist identities, complete matrix, native reports and
  current capacity. The existing engine checks actual package/evidence bytes.
  Cached READY, comments, expired evidence, changed policy, a replacement RC or
  newer stable release cannot authorize publication.
- `ST-REL-PUB-04`: reuse the existing publisher and accepted RC bytes without a
  rebuild. Keep exact-head merge, Service/installer acceptance and live-class
  freeze. Revalidate at the actual publication boundary and observe publication;
  issue admission, a merged fix and a draft do not constitute a release.

## Design

Default-branch `config/release-automation.json` supplies reviewed enrollment,
reporter/attestor keys and included-capacity policy. Initial `shadow` grants no
machine publication. `active` requires actual Harness/tool pins and configured
roles; it cannot substitute fixture keys or provision production keys silently.

The same engine consumes the complete frozen checklist/matrix. `testRevision` is
the actual 40-character Harness commit and `rubricRevision` the candidate commit;
full tool/checklist digests remain in `desktopContract`, never truncated into fake
Git SHAs. Signatures attest configured roles' observations and coordinator quota/
failure history, not independent proof of screens or provider invoices. Private
keys stay outside the checkout and capture store.

Dependency and runtime Service revisions remain separate. The producer resolves
the accepted deployment's annotated Service tag through fixed authorized GETs,
then attests its exact base/full version/tag object/peeled full commit. Engine
`serviceSha` uses that runtime source. The publisher checks the immutable accepted
receipt and exact current health version. It neither manufactures a full SHA from
a suffix nor expands its publication token to private Service. Only those fixed
GETs may use a Service read token/member login, never a mutation.

Signed original paths remain unchanged; remote proofs resolve by SHA-256 under
owned `blobs/`, with actual byte/size checks and linked-file refusal. Packages reuse
the existing RC download. Raw captures stay private. Transport accepts only
`hypeproof/hypeproof-studio-releases` at an immutable commit and prefix
`blackbox/machine/<pr>/bundle.json` plus `blobs/<sha256>`. Caps: bundle 5 MiB,
proof 25 MiB, total proofs 100 MiB. The evidence App token is scoped to that one
repository with contents:read; the Studio publication token remains separate.

The connected workflow receives the exact PR/private commit from the existing
coordinator. Its early `AUTHENTICATED_SOURCE` check is not publication authority.
Before effects, the host checks current remote RC refs and exact frozen source;
deleted release-branch heads use immutable SHA contents, never editable PR body.
Final machine/freeze gates run again after SDK/installer/notes preparation at
`--draft=false`, followed by an observed release read. Unenrolled/shadow and
separately admitted hotfix lanes retain their existing gates.

## Producer and operator contract

The pinned native producer must reuse the existing desktop validator, apply only
current authenticated CAS resolutions without rewriting original observations,
and populate the existing engine with real signed reports, identities/files and
successful settled included-capacity receipts. FAIL or unresolved BLOCKED cannot
produce an intent. An unsigned desktop export or routing READY is insufficient.

Export a complete ledger/intent and explicit owned evidence without creating keys,
reports, approval or publication:

```bash
node scripts/release/machine-evidence.mjs export --pr RELEASE_PR \
  --store PRIVATE_STORE --policy PRIVATE_POLICY --intent PRIVATE_INTENT \
  --attestor ROLE --key PRIVATE_KEY --packages RC_PACKAGE_DIR \
  --source-evidence OWNED_CAPTURE_ROOT --service-version ACCEPTED_FULL_VERSION \
  --out NEW_PRIVATE_BUNDLE_DIR
```

Use the existing private evidence writer, observe its immutable commit, then let
the existing coordinator dispatch `release-promote.yml`. Existing cumulative
`Session.operation` quote/reservation must cover that bounded attempt before
dispatch. UNKNOWN responses are observed instead of replayed; no second solver,
provider, schedule or paid fallback is introduced.

## Verification and rollout

Mandatory `promote.test.mjs` imports generated-key/actual-file controls for complete
policy, signatures, Service/source/byte drift, immutable transport, shadow no-
effects and machine PASS without human review. They prove protocol decisions,
not installed-App acceptance or publication. Full release regressions remain
required. Workflow controls check trusted code, scoped transport and final gates.

The current Windows driver automates BB-004 and reports unsupported work BLOCKED
(Harness #517); native Mac work remains #516. Reporter/attestor setup, confirmed
capacity, pinned producer and a complete real RC run must precede activation.
The existing FAIL/BLOCKED RC is not made passing. Protected policy/workflow changes
retain maintainer review/merge and workflow-authorized credentials.

## Native producer CLI (#3632)

Default stays shadow without keys/pins. Live effect revalidation is supplied by #3638. No model calls, dispatch or publication. `machine-evidence.mjs prepare-current
--pr N --packages DIR --sequence N --out FILE` reads product/accepted Service facts;
sequence comes from Harness product CAS.

`native-producer.mjs` accepts these explicit private inputs:

- `context`: `--input` publisher JSON, `--context` current product JSON, `--packages`,
  persistent `--store`, exclusive `--out`. Returns candidateId/stage reservationIds.
- `attest`: `--input`, `--context`, approved `--harness`, raw `--snapshot`, owned
  `--run-directory`/`--evidence-root`, native `--target`, `--reporter`, private `--key`, `--out`.
- `assemble`: `--input`, `--context`, `--packets` directory-list JSON, `--packages`,
  shared `--store`, `--attestor`, private `--key`, exclusive `--out`.

Attest checks actual native host, platform role, official Harness origin/commit/full
tool digest and pinned `desktop_cli.py export`, owned captures, cleanup and accepted
Service. Human resolution fills only BLOCKED/NOT_RUN/missing observations. Its proof
schema is `hps-native-human-proof/1`: matching actor/caseId/platform/identity,
execution human-observed, cleanup status PASS, accepted service {base,version}, ISO
startedAt/endedAt and files {owned relative path,sha256,size}; include PNG and nonempty
AX JSON. recordedAt follows execution. Original observations stay separate.

Assembly preserves actual capacity IDs/times and blocked overruns in persistent
transact/applyEvent; @candidate resolves to its engine ID. All captures travel signed;
packages stay cached. Controls use generated keys/files and known exporter output.
Mac #516 and real all-PASS installed-App acceptance remain NOT RUN.

## Live publisher CAS revalidation (#3638)

Before effects, currentMachineAuthority fetches the fixed Studio candidate and
product registry refs and exact-SHA state.json. typed-double-v1 covers both complete
semantic states: checks, attributable resolutions, policy/roster, capacity,
accounting, supersession and global failure history. Exclude only top-level
revision and this reserved operation status/result/finishedAt. Its immutable
publish-pass request/quote/reserved budget and prepared bundleDigest/evidenceCommit/
dispatchKey must still match separately. A provider receipt never changes a verdict.
Thus UNKNOWN to DONE settles normally, while a new same-candidate FAIL invalidates
an unexpired old PASS bundle immediately.

The parent and final child workflows carry machine_dispatch_key and set
HPS_MACHINE_DISPATCH_KEY alongside HPS_MACHINE_EVIDENCE_COMMIT. Active authority
requires the exact 64-hex key. Parent run-name is release-promote-<pr>-<key> for
read-only UNKNOWN reconciliation; never blindly repeat dispatch. The parent
checkout is pinned to the dispatch GITHUB_SHA, and both must equal the
reserved workflowHead before effects. The validated parent passes its head as
machine_parent_workflow_head to both child gates; the later squash merge GITHUB_SHA
does not replace that original parent identity.
Controls cover complete-view drift, excluded bookkeeping, fixed immutable reads,
receipt/dispatch mismatch, independent Python vectors and native manual proof.
Real publication remains NOT RUN; default enrollment remains shadow.


## Canonical merge delegation (Harness #544)

Active machine effects additionally read current Harness main and immutable
policy/repos.yaml plus policy/release-merge-authority.json using only the separate
HPS_MERGE_POLICY_READ_TOKEN. Both workflows mint this capability for Harness alone
with contents:read. The reviewed raw JSON SHA-256 and full known rule must match;
the same index commit must retain Studio's product/public-product/main entry and
delegation pointer. Missing token/files, unlink, retirement or changed rule block.

Every tag/draft/merge/final-publication guard checks the current exact PR head's
rollup against all canonical required names, and refuses any current red/pending/
unknown check or latest failing control-plane gate. CI SUCCESS/SKIPPED/NEUTRAL
semantics match the canonical monitor; native evidence still requires strict PASS.
Blocking labels and any current changes-requested reviewer remain holds. Ordinary
source approvals and shadow/legacy behavior are unchanged; this rule delegates
only the existing exact same-repository release-record shape with complete machine proof.
Checks use explicit GraphQL context pagination with final-page proof and stable head
identity; review history uses complete paginated REST reads.


Check reruns are ordered across proven distinct runs of one issuer and immutable workflow
identity, using run number and creation chronology (preserving fractional seconds).
Same-run duplicate display names remain incomparable: parallel jobs can share a name,
and neither check ID nor mutable workflow runAttempt proves per-job supersession.
Every blocker in that run remains until a proven later distinct run supersedes it;
this is technical evidence ambiguity, not an additional human approval requirement.
Completion timestamps never establish recency. Unknown/incomparable metadata stays
in the gate, including control-plane results. Status contexts use creation time.
Query fields are documented in GitHub's [Checks schema](https://docs.github.com/en/graphql/reference/checks#checkrun)
and [Actions schema](https://docs.github.com/en/graphql/reference/actions#workflowrun).


## Active release-record review requests (#3647)

Active cut creation/update writes machine-oriented publication instructions, keeping
all case procedures and unchecked observations. Shadow copy remains unchanged.
After creation/update, a paginated GraphQL read binds the exact Studio head,
single-parent RC record and sole version file. Only ReviewRequest.asCodeOwner=true
User/Team requests are removed with the existing product App capability. Each delete
rechecks provenance/head; manual false/unknown requests, holds, changes-requested
reviews and ordinary source PR ownership remain. Uncertain deletion is observed on
retry rather than blindly repeated. Global CODEOWNERS and draft behavior are unchanged.
The [official ReviewRequest schema](https://docs.github.com/en/graphql/reference/pulls#reviewrequest)
and a read-only real shadow PR inspection confirmed the provenance field. No real PR
requests are modified during protocol controls; installed-App rollout remains #3643.
