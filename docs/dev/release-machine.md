# Machine release evidence adapter (#3629; Harness #519)

This slice delivers portable signed evidence, frozen policy derivation and private
transport. Host/workflow integration is #3631; native observation production is
#3632. The following requirements describe the connected target. Enrollment stays
shadow until those integrations and actual native prerequisites are verified.

## Requirements

- `ST-REL-PUB-01`: only an actively enrolled Studio release can use machine
  publication. Complete effective PASS needs no per-candidate human approval.
  FAIL belongs to the existing developer loop; BLOCKED belongs to an attributed
  human resolver. Ordinary commits and products without a release contract do not
  obtain this capability. Missing evidence is never a manager-override fallback.
- `ST-REL-PUB-02`: the single committed `releases/<version>.md` record freezes every
  black-box checkbox, candidate case procedure/expected result and required P0.
  Candidate `release-platforms.json` fixes the platform matrix. Reviewed case
  applicability may make an installer case Mac-only; no case or platform disappears.
- `ST-REL-PUB-03`: a private Ed25519-attested engine bundle binds the exact release
  PR/head, candidate/RC/version, full Service SHA, actual Harness commit, complete
  tool/checklist digests, required matrix and signed reports. The publisher reruns
  the existing engine against actual package/evidence bytes and fresh capacity.
  Cached READY, comments, manual approvals, changed keys/policy, expired evidence,
  a replacement RC or a newer stable release cannot substitute for those gates.
- `ST-REL-PUB-04`: reuse the existing publisher and accepted RC bytes without a
  rebuild. Preserve exact-head PR merge, live-class freeze, public Service checks,
  accepted package/installer verification and final observed publication. Unknown
  operations are reconciled; an admitted issue, merged fix or prepared draft is
  not a published release.

## Design

`config/release-automation.json` is a default-branch reviewed enrollment and key
policy, separate from candidate-controlled input. Its initial mode is `shadow`:
it grants no machine publication and does not silently provision keys or promote
the currently failing RC. `active` requires actual pinned Harness/tool revisions,
platform reporter keys, a bundle attestor and included capacity. These are setup
prerequisites, not a human approval of every PASS. Mac-specific observation and
installation work remains Harness #516; the current Windows driver automates
BB-004 and reports unsupported cases as BLOCKED (#517).

`machine-publication.mjs` derives the existing engine policy from the frozen
checklist and reviewed matrix. Engine `testRevision` is the actual 40-character
Harness source commit and `rubricRevision` is the candidate commit. The full
64-character tool/checklist digests remain in the policy's `desktopContract`;
they are never truncated into a fake Git SHA.

The candidate's Service dependency pin is separate from the accepted runtime.
The real accepted `service-v2026.11.08-1+d95f0ea5` maps through its annotated
Service tag to full source `d95f0ea5d234f593b74984440ab6ce59f25a6f20`, independently
of Studio's dependency pin. Fixed authorized Service GETs resolve the exact
base/full version/tag object/peeled source; the coordinator attests this mapping.
Engine `serviceSha` is that full runtime source. The publisher compares the RC's
immutable acceptance receipt with the mapping and requires current health to equal
the full accepted deployment version. It never manufactures a full SHA from a
suffix or expands its publication token to private Service access. Only the fixed
Service GETs may use an existing read token/member login; never a mutation.

The signed transport body contains the existing ledger/policy/intent/contract,
attestor ID and UTC creation time. It introduces no second decision engine.
Reporter signatures still authorize each required platform/test. The bundle
signature authorizes a trusted coordinator's portable snapshot, including quota
and failure history; it does not prove a screen or provider invoice independently.
The reporter/attestor adapters must obtain real native observations and real
included-capacity receipts before signing. Generated test keys do not enroll a
production role. Keep private keys outside the checkout and capture directory.

Files resolve by SHA-256 under an owned `blobs/` directory, so original host paths
are never rewritten inside signed reports or used as remote fetch paths. The
adapter verifies synchronous actual bytes/size and rejects linked files. Package
bytes are reused from the existing RC download; the private store does not get a
second copy of large App packages. Original raw captures stay in private evidence.

Only `hypeproof/hypeproof-studio-releases` and an immutable 40-character commit are
accepted. The fixed prefix is `blackbox/machine/<release-pr>/bundle.json` plus
`blobs/<sha256>`. Transfers cap the bundle at 5 MiB, a proof at 25 MiB and all
proofs at 100 MiB. One repository-scoped App capability reads private evidence;
the Studio workflow capability publishes Studio. No cross-repository write token
or personal-token write is introduced. The existing bot App must already be
installed on the private repository; missing access is BLOCKED.

`release-promote` accepts `pr` plus `machine_evidence_commit` from the existing
release coordinator. It authenticates the bundle, downloads the existing accepted
RC files, revalidates the full machine engine before external steps, and passes
the same immutable evidence identity to `verify-unified-release`. Final publish
fetches/verifies again using default-branch code. Its early source check is only
`AUTHENTICATED_SOURCE`, never publication authority. The final gate verifies
actual bytes, current Service, policy and complete machine intent. An active
release cannot fall back to writer approval/override; separately admitted hotfixes
and unenrolled/shadow releases retain their existing gates.

## Producer and operator contract

The native producer must first validate original reports through the pinned
Harness desktop validator, aggregate the complete matrix and apply authenticated
human resolutions from the product CAS registry without rewriting observations.
It must populate the existing engine ledger with the permitted reporter role,
actual source identities/files and successfully settled included-capacity work.
An unresolved FAIL/BLOCKED cannot create the required engine intent. A fix merge
requires a new RC and fresh acceptance. Neither routing READY nor an unsigned
desktop export is accepted as this bundle.

Given that complete ledger and its current intent, export only explicit owned
evidence (the command creates no keys, reports or manager approvals):

```bash
node scripts/release/machine-evidence.mjs export --pr RELEASE_PR \
  --store PRIVATE_ENGINE_STORE --policy PRIVATE_POLICY --intent PRIVATE_INTENT \
  --attestor CONFIGURED_ROLE --key PRIVATE_ED25519_KEY --packages RC_PACKAGE_DIR \
  --source-evidence OWNED_CAPTURE_ROOT --service-version ACTUAL_ACCEPTED_SERVICE_VERSION \
  --out NEW_PRIVATE_BUNDLE_DIR
```

Publish that verified directory only to the fixed private prefix using the
existing evidence writer, observe the immutable commit, then let the existing
release coordinator dispatch `release-promote.yml` with the exact PR and commit.
Capacity reservation must precede this workflow dispatch and cover its complete
bounded attempt; UNKNOWN dispatch responses must be observed, not blindly replayed.
The receiver/publisher does not replace Harness operation accounting.

## Verification and rollout

The existing mandatory `promote.test.mjs` imports machine controls. They use
throwaway keys, actual files and the real engine to prove portable verification,
complete required policy, signature/source/Service/byte drift, fixed immutable
transport, shadow no-effects and machine promotion without human review. Changed
machine authority is refused even with a valid human review. Existing release
regressions remain required. Workflow controls bind default-branch code, private
scoped transport and final validation after downloaded bytes. Gates read current
remote RC refs. Original PR-head sources missing after squash/branch deletion are
read from the immutable exact-head contents API, never editable PR body. Machine
and freeze gates run again in the actual `--draft=false` step after SDK/installer/
notes preparation, followed by an observed published-release read.

Default enrollment remains shadow until the reporter/attestor roles, confirmed
capacity, pinned producer, Mac native adapter and an actual complete RC run are
observed. This code does not turn fixture results or the existing FAIL/BLOCKED RC
into acceptance. Linux/Windows protocol controls are distinct from real Mac
installation, real provider usage, complete desktop checks and actual publication.
Protected workflow/policy changes require the repository's existing maintainer
review/merge and workflow-authorized bot credential; neither is fabricated here.
