# Operating contract

Canonical source: `hypeproof/hypeproof-harness`. Studio owns the managed build
receipt and signed acceptance engine. Harness owns portable instructions and
operational coordination. Shared state is not a signed acceptance ledger.

## Setup and execution

Copy the example JSON files from `scripts/hype-release/examples/` to private scratch.
Fill actual GitHub logins and exact source PRs, SHA, version, changes and rollback.
Set `modelExecution: disabled`; no API key or model SDK is needed. Keep canonical
policy and shared state in an explicitly allowed HypeProof repository. Use a trusted
policy revision: a caller-authored roster is coordination, not protection from repo
administrators. Repository access controls and the product publisher remain authoritative.

Set a shell array with common flags, then invoke the desired command:

```bash
release=(python3 scripts/hype-release/release.py --candidate /tmp/rc-candidate.json --policy /tmp/rc-policy.json --state-repo hypeproof/hypeproof-harness)
"${release[@]}" init
"${release[@]}" prepare --checkout /path/to/exact/studio-candidate
"${release[@]}" build --checkout /path/to/exact/studio-candidate --operation build-1 --quote /tmp/rc-quote.json --plan
# Copy candidateDigest and requestDigest into a confirmed, unexpired cost quote.
# The evidence must bound both workflows at this source revision; do not guess $0.
"${release[@]}" build --checkout /path/to/exact/studio-candidate --operation build-1 --quote /tmp/rc-quote.json
"${release[@]}" status
"${release[@]}" reconcile --operation build-1
"${release[@]}" collect --directory /tmp/rc-packages
"${release[@]}" check --file /tmp/check.json
"${release[@]}" tokens --file /tmp/token-observation.json
"${release[@]}" cost --file /tmp/cost-observation.json
"${release[@]}" report --directory /tmp/rc-report
"${release[@]}" upload --directory /tmp/rc-report --operation report-1 --quote /tmp/report-quote.json --plan
# Confirm this separate exact operation quote, then repeat without --plan.
"${release[@]}" handoff --to another-manager --note 'Packages verified. Windows native install BLOCKED; next: use a permitted Windows device.'
```

`notes --file notes.json` accepts exactly `name` and `body`, and uses the same
`--operation/--quote/--plan` contract. Apply it **before** generating reports because
editing a draft can change its URL. `ticket --check-id ID` uses the same contract.
`retry-build --run ID --attempt N` accepts only the exact failed build and leaves
UNKNOWN until read-only reconciliation observes N+1. Never blindly retry an UNKNOWN
write, even if its HTTP response said timeout. Partial report upload stays UNKNOWN; reconciliation only reads. Use
`resume-upload --operation report-1 --quote /tmp/resume-quote.json --directory /tmp/rc-report`
with the original report bytes and a fresh exact-request quote. This recovery
reserves an additional bounded attempt before creating missing exclusive-name assets.
Matching uploaded digests are reused; conflicting or incomplete provider assets
remain blocked for inspection. Missing is not proof that
an in-flight action cannot still finish. No generic unlock/force-publish bypass exists.

A DONE operation with identical input is reusable without repeating side effects.
A new operation ID consumes a new cost reservation and a bounded attempt, except
that a candidate may have only one initial `build` operation. Quotes
bind the whole request, expiry and candidate, not merely an adapter's name. Quote
correctness is a release-manager attestation; this tool cannot enforce provider-side
billing or claim a final invoice. Use provider limits and actual observations too.

### Desktop build recovery

`build --plan` binds the exact candidate's committed platform/workflow bytes,
managed tag marker and trigger modes. The supported mixed producer creates one
tag for Mac and sends one Windows dispatch with that tag as the workflow ref,
the full source SHA as both source inputs, `managed_draft=true`, and the final
release version. The Windows write uses a separate repository-scoped Actions
broker grant. No extra Mac dispatch, signing override or publication is allowed.
The dispatcher requests a run ID using GitHub's documented
[`return_run_details`](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
option; a lost/empty response still requires exact run observation, never replay.

Each tag/dispatch intent is committed with the existing state CAS before its
effect. A successful tag is retained when Windows has not started. `reconcile`
only reads provider records; missing, truncated, multiple or mismatched run
evidence remains UNKNOWN. If Windows has no saved intent, the current owner may
resume that unattempted step with the original checkout and a new whole-build
quote, using the same operation ID:

```bash
"${release[@]}" resume-build --operation build-1 --checkout /path/to/exact/studio-candidate --quote /tmp/build-resume-quote.json --plan
# Confirm the original request digest and fresh whole-build upper bound, then:
"${release[@]}" resume-build --operation build-1 --checkout /path/to/exact/studio-candidate --quote /tmp/build-resume-quote.json
```

The reservation stays at least as large as either whole-build quote; it is not
reset by partial success. Resume count and total budget remain bounded. An
already-attempted dispatch cannot be resent even if no run is visible yet.
`BUILD_RUNS_OBSERVED` means both exact runs exist; it does not mean successful
builds, package acceptance or deployment. Collection still requires both complete
platform receipts and original bytes, including Mac signing. S1/S3/S4/S5, no
automatic managed-draft acceptance and all existing publication gates remain.
Legacy tag-only UNKNOWN operations are observed under their original request;
never reinterpret them as permission for a new dispatch.

Shared state lives on one `ops/release-state/<identity>` orphan branch containing
only `state.json`. Each non-forced ref update compares the exact prior commit; a stale
writer stops. No workflow files are added, and state commits do not trigger this
repository's main/PR CI. Access errors are never treated as successful execution.
For offline role rehearsal use `--local-state /tmp/rc-state.git --actor manager-a`
instead of `--state-repo`; remote commands are rejected in that mode.

## Handoff and recovery ownership

Only the current authenticated owner can mutate state, reconcile or resume an
operation. Another manager may read status first. UNKNOWN operations block handoff:
the outgoing owner resolves them, then hands off, and the incoming owner rereads
status. The helper has no forced takeover, impersonation or generic UNKNOWN unlock.
If the outgoing owner is unavailable, record the ownership blocker and involve the
repository's authorized operator through the existing policy; do not edit the shared
branch to bypass ownership or transfer credentials. This is an explicit operational
limit, not permission to leave a candidate advertised as ready.

For a partial upload, run the following as the current owner before preparing a
fresh resume quote. It reads the original request and verifies local original bytes:

```bash
"${release[@]}" resume-upload --operation report-1 --directory /tmp/rc-report --quote /tmp/resume-quote.json --plan
```

Copy the returned `kind`, `candidateDigest` and `requestDigest` into the quote example,
record a fresh provider-backed upper bound and validity window, and repeat without
`--plan`. Plan never reads the quote file or performs writes. Do not regenerate the
original report directory during recovery. `check.json` and `cost-observation.json`
examples are included beside the policy example; replace their placeholders.

A rebuilt artifact with changed bytes must not replace an existing candidate asset.
Cut a new immutable RC tag and collect its full package set. Old report/signature
remain evidence for the old bytes. Reuse only unaffected source/host claims whose
complete identity matches; obtain the existing engine's new artifact-bound manifest,
evidence and approval before promotion. There is no waiver that turns an old PASS
report into acceptance of a new package.

Official Mac collection additionally requires the final
`HypeProof-Studio-darwin-arm64.signing.json` receipt, byte-identical to the receipt
in the exact successful build run's `hypeproof-studio-macos-signing-receipt`
Actions artifact. Harness pins Apple team `RZBNT9ZB67` and bundle
`ai.hypeproof.studio`, verifies final ZIP/source/run/attempt identity and retains
`state.macSigning`. Local-only or expired/mismatched evidence blocks official
promotion. Historical records remain readable as `legacy`, never relabelled
official. The existing publisher rechecks before dispatch and preserves the
receipt alongside package bytes. See `docs/RELEASE-MAC-SIGNING.md` in Harness.
This Mac verdict does not change or complete the separate TestFlight state.

## Evidence and acceptance

Evidence keys:
- source: repository, source SHA, test revision, acceptance revision;
- package: all source fields plus package SHA-256;
- installed-app: all package fields plus OS, architecture, environment revision,
  and Service revision. Include certificate trust/policy, app settings/theme and
  account/profile capabilities in environmentRevision where they affect the claim.

A comment alone does not require retesting. A changed package, host, certificate
trust, Service or requirement can require it even at the same source SHA. Reuse only
unaffected claims. Every recorded check has expected, observed, evidence and verdict:
PASS, FAIL, BLOCKED or NOT_RUN. Records are observations, not signed authorization.
The independent verifier is a different agent/session; a person still owns final
acceptance. Browser fixture, native package launch, real authenticated flow and
human acceptance have distinct boundaries.

`promote-check --checkout ... --engine-store ... --engine-policy ... --intent ...`
compares the collected artifact roles/digests/sizes to the existing signed intent,
then invokes Studio's `check-intent`. Private signing keys and engine secrets stay on
the authorized host. Securely hand off the existing engine store/artifact references
through the organization's approved mechanism; a shared observation JSON does not
replace that ledger. The publisher must check again just before its actual side
 effect. This command never creates a stable tag, changes a channel, or marks human
acceptance complete.

## Release dependency check

Every Studio RC runs the Harness release dependency ledger before `promote-check`.
It answers whether every requirement of every live release, plus this candidate,
has a live provider (for example: the Service line this app's `@hypeproof/service-contracts`
pin needs). It is deterministic, read-only and makes zero AI calls. Run it from the
canonical Harness checkout (sibling `../hypeproof-harness` or `$HYPEPROOF_HARNESS`):

```bash
python3 "$H/scripts/release-deps/release_deps.py" check \
  --candidate studio=<candidate source sha> \
  --fact hypeproof-studio-db=<live D1 migration head> \
  [--client-versions /tmp/client-versions.json] \
  --json > /tmp/rc-release-deps.json
```

- Exit 0 (PASS) is required before `promote-check`. Exit 1 (FAIL) lists each unmet
  requirement with what was needed and offered: fix the product or ship the provider
  first; do not edit the registry to make it pass. Exit 2 (BLOCKED) means something
  could not be read (missing manifest, unreadable tag, missing fact): resolve it, never
  treat it as PASS.
- The candidate SHA must be pushed; use `--candidate studio=path:/abs/checkout` only for
  a local rehearsal, and do not record that run as evidence.
- `--client-versions` is an export of Service `GET /owner/client-versions`, fetched with
  the release manager's own authorized owner access. Without it the check assumes every
  release from the last 14 days plus the newest older one is still installed.
- Keep `/tmp/rc-release-deps.json` as evidence: record a check whose `evidence` points
  to it and whose verdict is the JSON `verdict`. It binds the registry digest, the
  telemetry digest and every release SHA checked. A new candidate SHA, a Service release,
  a DB migration or new telemetry can change the answer, so rerun it for the exact
  candidate immediately before promotion.

Registry, manifest format and the client-version mapping are documented in
`scripts/release-deps/README.md` in the Harness.

## Test access and token meaning

There are three independent credentials/quotas:
1. GitHub sign-in: each manager's own `gh` identity. Use least required repository
   contents/issues/actions permissions; never distribute a personal token in a skill.
2. Studio participation code: links a permitted profile and test seat in Service.
   RC profiles are isolated, so connect explicitly through AI 체험하기 / 체험 참여 코드.
   Issuance requires existing issuer/admin authority, roster and lifetime checks.
3. Model usage: the deterministic release helper uses **zero AI calls**. An optional
   agent diagnosis uses the already signed-in authorized provider; stop when its
   quota ends. Do not silently switch to API billing. Subscription percentage is
   account-wide allowance, not tokens or dollars for one RC. Record unknown token
   counts as null. API costs, if separately authorized outside this helper, belong
   in the candidate cost record, never hidden behind a subscription claim.

Reports distinguish committed upper bounds, repository-day reported cost and
operation-attributed final costs. Updated observations do not erase earlier high
water costs. No claim that a 1-hour/40-attempt participation code guarantees $1.
Don't test by changing customer seats, revoking other tokens, or putting secrets
in downloadable RC assets. If network/security policy denies issuance, preserve
that BLOCKED state and use the normal authorized sign-in/issuance path.

## Distribution

`sync.sh` vendors this skill and helpers to consumer repositories. Global Codex:

```bash
python3 scripts/hype-release/install.py --target "$CODEX_HOME/skills"
python3 scripts/hype-release/install.py --target "$CODEX_HOME/skills" --apply
```

Specify the actual configured skills directory if CODEX_HOME is unset. The check
reports CURRENT / UPDATE / LOCAL_CHANGES. Apply refuses unmanaged/differing copies
before changing anything. To adopt old unmodified canonical copies, explicitly pass
`--adopt-revision <trusted-Harness-commit>`; byte-for-byte equality is required.
Previous copies are kept beside the installation as hidden backups. Receipts bind
source revision, dirty-working-tree status and every installed file hash. A local
install or fixture pass does not mean teammates have installed it, main merged,
or remote provider operations have been exercised.

## Failed native CI evidence (Harness #660)

For a **terminal failed** `studio-native-mobile.yml` run, use the separate
read-only collector below. It does not prepare a release, mutate manager state,
dispatch/rerun a workflow, or turn failed CI into a successful native gate.

```bash
python3 "$CANONICAL_CHECKOUT/scripts/hype-release/native_evidence.py" \
  --run-id <REST-run-id> --attempt <exact-attempt> --expected-head <40-char-PR-head> \
  --platform ios --studio-repo /path/to/trusted/local/studio \
  --verifier-sha <separately-trusted-local-origin-main-SHA> \
  --output /private/task/evidence \
  --archive <identity-artifact-id>=/private/already-downloaded-identity.zip \
  --archive <ios-artifact-id>=/private/already-downloaded-ios.zip
```

The archive arguments are optional, but use them when another owner has already
downloaded these exact artifacts. Each archive must match fresh REST artifact
ID/name/run/head, selected-attempt job time window, provider SHA-256 and length.
The same verified bytes in the collector cache are also reused. A partial,
tampered, expired, missing supplied or unknown archive is preserved and refused;
it is never silently overwritten or downloaded again. Coordinate ownership
before new downloads; resource-wrap large archive processing, after already
queued evidence work. There is no credential fallback or automatic retry.

The local Studio repository must contain the expected head Git object. The
collector imports only the operator-pinned **origin/main**
`verify-native-candidate.py` Git object, never a failed PR script, artifact code
or modified working file. It reuses that verifier's identity parser/checks, then
compares the expected head's native tree/workflow to CI identity, exactly as the
existing gate does. The CI-reported tested checkout SHA is recorded separately
and may name an ephemeral PR merge absent from local Git. Full merge ancestry
is **not evaluated**; release ancestry gates are unchanged. Missing expected-head
objects block; fetch them separately through the normal read-only source path.
This diagnostic source binding does not establish trust in a PR's test claims.

All provider reads use the existing `NativeGitHub` Actions profile and REST
schemas. `gh run view --json` is not a REST run document. Outputs are local and
private under `run-<id>/attempt-<n>/collections/<execution-id>`; archives have
immutable artifact-ID cache paths. Each execution keeps its metadata, partial
files and terminal receipt without overwriting earlier observations.
Use a POSIX host and an owned private output directory: existing managed
directories with group/other access are refused without changing permissions.
This also contains incomplete downloads. Supplied external archives remain
read-only and untouched; their owner's existing access policy remains in force.

For iOS, failed test IDs from `native-journeys.json` select exact rows in the
existing `journey-attachments/manifest.json`, including AX/video whose
`isAssociatedWithFailure` is false. Only selected attachments and bounded
producer logs/receipts are copied. Traversal, absolute/backslash paths,
duplicates, symlinks, encrypted members and excessive expansion are refused.
Before `ZipFile` allocates entries, a bounded end-record read refuses ZIP64,
multidisk, ambiguous layout, more than 20,000 declared entries or a central
directory above 2 MiB; the byte bound applies even to a forged small entry count.
No app, script, binary plist or video is executed or decoded. Raw contents stay
in local files, not stdout or publication. Review/redact before sharing any
logs, screenshots, AX or video; they can contain customer words.

`COLLECTED` means the failed-case files were selected, **not** that the failure
was diagnosed or the app passed. `PARTIAL` retains available logs when build/setup
failed or a case/manifest is missing; Android currently collects logs only and
is explicitly partial. `FAILED` preserves bytes when identity, bounds, extraction
or the final attempt recheck fails. Partial/failed exit nonzero. Visual review,
physical audio, native acceptance and release eligibility remain separate.

Offline regressions: `python3 -m unittest discover -s tests/hype_release -p
'test_native_evidence.py'`. Controls cover REST/schema confusion, exclusive-file
collision recovery, exact cached-byte reuse, malformed/stale identity, failed-case
selection, hostile archives and private partial receipts. They make no live
provider, simulator or release claim.

## Native TestFlight operation (Harness #579)

This adapter uses the existing Studio native candidate gate and Apple workflow;
Harness does not implement signing, provisioning or a second approval engine.
Copy `examples/native-candidate.json` and replace its source/PR/change placeholders.
There is no RC tag or desktop version in this candidate. The first supported target
is Studio iOS, `studio-apple-testflight.yml`, `apple-native-preview`, ref `main`.
The original v1 operation requires the exact app source to remain that ref's tip
immediately before dispatch. The v2 operation below independently pins the tested
app source and the trusted main workflow source, so unrelated main changes do not
require testing a different app candidate.
Malformed native workflow/source identity is refused before account attribution,
broker loading or coordination-store access, as well as at the existing state gate.
Preparation also requires the workflow's `workflow_dispatch` to declare the three
string inputs `expected_sha`, `operation_id` and `request_digest` (Studio #3768).
An older workflow is refused before any execution reservation or Actions dispatch;
Studio's independent legacy/manual invocation remains unchanged.

Use a trusted Harness checkout containing the canonical Actions broker client from
Harness #553. Native operations run that checkout's `scripts/hype-release/release.py`
and load its sibling `scripts/agent-identity/agent-auth.py`. Installed skill callers
invoke the same canonical command below; a copied release runtime without that
broker refuses native operations. No CLI or candidate field selects an alternative
authentication module, and the broker is never copied into the skill runtime. An old
client, failed broker or incorrect grant blocks execution without credential fallback.

Within one native command, each repository/profile reuses its own in-memory grant.
The validated provider expiry must cover the existing request timeout; an expiring
grant is replaced before a request, never in response to a failed mutation. No token
is saved or shared between commands. Normal return and exception unwinding revoke
grants acquired by the command; abrupt process/host loss relies on provider expiry.
An unconfirmed cleanup emits a sanitized warning without replacing the operation
result or UNKNOWN failure. Preserve that result and reconcile rather than replaying
the operation. Injected transports remain owned by their caller.
The authenticated human identity is read only (`GET /user`); ordinary bot grants
write the state branch and read source PRs, while a separate Actions grant reads CI
and dispatches this one workflow. No token enters arguments, state or the report.

```bash
native=(python3 /trusted/hypeproof-harness/scripts/hype-release/release.py \
  --candidate /tmp/native-candidate.json --policy /tmp/release-policy.json \
  --state-repo hypeproof/hypeproof-harness)
"${native[@]}" init
"${native[@]}" prepare --checkout /path/to/exact/studio/apps/studio-native
"${native[@]}" testflight --checkout /path/to/exact/studio \
  --operation ios-upload-1 --quote /tmp/native-quote.json --plan
# Confirm kind, candidateDigest, requestDigest, provider cost and expiry in the quote.
"${native[@]}" testflight --checkout /path/to/exact/studio \
  --operation ios-upload-1 --quote /tmp/native-quote.json
"${native[@]}" reconcile --operation ios-upload-1
"${native[@]}" status
```

The product Git root is normalized from `--checkout`, independently of the shell
cwd. `prepare` and first execution reuse that exact product revision's
`verify-native-candidate.py` gate with Actions reads and source-PR inclusion.
If native CI changes between preparation and execution, prepare and quote again.
No dispatch occurs before the shared CAS reservation. Even an accepted dispatch
returns BLOCKED/UNKNOWN until reconciliation can observe the upload; this is
intentional and is not an instruction to retry. A lost response stays UNKNOWN.
There is no native rerun/unlock command. A missing, failed, ambiguous or incomplete
run requires owner investigation through the existing policy, not a new operation.

Reconciliation scans only this workflow and exact source (at most 1,000 runs),
requires the exact `studio-testflight:<operation_id>:<request_digest>` run name,
and validates the current run attempt. It reads the matching gate artifact and
`upload-receipt.json`, checks their embedded request, source and run identities,
checks the native CI is still successful at its prepared attempt, and hashes the
IPA against the receipt. A run or CI rerun during collection prevents completion.
Only then does the operation become DONE with `state: uploaded`. Apple processing
and tester availability remain `NOT_OBSERVED`; signed-in device acceptance remains
`NOT_RUN`. A workflow's success or a dispatch response alone cannot establish them.

The same CAS write registers the verified IPA in `state.artifacts`, with its SHA-256,
size, version/build, source, operation/request digest, release run/attempt and
Actions artifact provenance. This enables package and installed-app observations
through `check`; registration itself creates no passing check. Later distinct
uploads append their own package identities and preserve earlier packages/checks.
Conflicting bytes or provenance for an existing run/attempt are refused rather
than replacing prior evidence. A failed CAS leaves both collection and completion
uncommitted; reread and reconcile the same operation instead of dispatching again.

The native operation uses the same owner, budget, attempt limit, cost observations,
UNKNOWN fence and CAS state store as desktop RCs. Existing desktop state branch
keys and commands retain their behavior. Desktop collect/report/promote commands
are intentionally unavailable for native candidates; `status` is the native
handoff record until separate Apple/device observations exist.

### Fixed app candidate with a separately pinned workflow (#609)

Use the same candidate file and state branch. Keep `sourceSha` at the exact tested,
merged app commit. Give `prepare` and `testflight` both `--checkout <app-candidate>`
and `--workflow-checkout <trusted-main-control>`. Each must be a clean checkout
from the configured Studio repository. The control checkout must be the observed
main tip and declare the fourth string input `expected_workflow_sha`.

Preparation loads the existing candidate verifier from that pinned control commit,
not from the older app candidate. It proves candidate-to-workflow-to-current-main
ancestry through the product's GET-only verifier and preserves the exact app CI
source/run/attempt/artifact/tree/workflow checks. The prepared request is
`hps-native-testflight/2` with `workflowSourceSha`; the original candidate SHA and
the five native CI identity fields remain unchanged. The cost quote binds this
whole request, including the control version.

Dispatch still targets `main`. It adds `expected_workflow_sha` to the existing
three inputs and refuses a changed main tip before the write. The Studio workflow
also checks its actual trigger/workflow identity before signing, checks ancestry
again, and uses separate control/app checkouts. Never spoof `GITHUB_SHA`, move a
legacy branch, accept an unmerged app or infer full-source CI from tree equality.
If main moves before dispatch, update only the clean control checkout, prepare
again and issue a new request-bound quote. This does not rerun the fixed app's CI.
If a dispatch was reserved or its response is uncertain, preserve that frozen
operation and reconcile/investigate it; this change adds no automatic retry or
UNKNOWN unlock. Later main advancement cannot mutate either running checkout.

V2 deployment requests use `hps-native-deployment-request/2` and `workflow_sha`.
Gate and upload receipts use their `/2` schemas with `workflow_source_sha`.
The Actions run and artifact origins must match the workflow SHA; the IPA,
`source_sha`, `source_head_sha`, `release_checkout_sha` and native CI still match
the app candidate. Upload artifact names still contain the app candidate SHA.
Reconciliation validates both identities and records `workflowSourceSha` in the
collected package provenance. Missing, mixed or changed identities cannot finish
the operation. V1 records keep their original equal-source rules and remain
reconcilable; no historical evidence is reinterpreted as v2.

```bash
"${native[@]}" prepare --checkout /exact/app-candidate --workflow-checkout /exact/trusted-main
"${native[@]}" testflight --checkout /exact/app-candidate --workflow-checkout /exact/trusted-main \
  --operation ios-upload-1 --quote /tmp/native-quote.json --plan
# Confirm this returned request and quote, then repeat without --plan.
```

Upload, simulator journey, signed-in journey and physical-device acceptance are
separate evidence boundaries. Native results explicitly retain `simulatorJourney`,
`signedInJourney` and `deviceAcceptance: NOT_RUN`, with `readiness: NOT_ESTABLISHED`;
a successful build is not a working conversation, login or voice journey. These
missing observations do not block test distribution, which is needed to obtain
physical evidence. Reusable product journey coverage is tracked in
[Studio #3771](https://github.com/hypeproof/hypeproof-studio/issues/3771). Record
observed checks through the existing `check` command with exact source/package and
host identity; do not relabel a receipt as user acceptance. Apple processing and
tester availability must be observed before describing the candidate as available.
