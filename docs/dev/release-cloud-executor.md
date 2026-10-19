# Cloud executor boundary

This adapter reuses `build-contract.mjs` and the signed engine's canonical digest.
It does not create an approval engine, sign evidence, issue trial credentials,
publish a release or dispatch both tag and workflow builds. Its read-only GitHub
transport uses the current `GH_TOKEN` environment; errors and CLI output omit tokens.

## Read-only commands

Run `node scripts/release/cloud-executor/cli.mjs COMMAND INPUT.json`:

- `observe`: input is `{repository, repositoryId, sourceSha, tagObject, rcTag,
  version, releaseId?, runs?}`. Repository must be `hypeproof/hypeproof-studio`.
  `runs` maps `build-mac.yml` and `build-windows.yml` to `{id, attempt}`. Pin these
  after first observation. Observation verifies the annotated marker, source,
  numeric draft release, unique tag-push builds and all paginated provider assets.
  Duplicate same-tag drafts, even empty, stop collection. Pagination is bounded;
  reaching the bound blocks rather than silently omitting more rows.
- `collect`: input `{observation, receipts, downloaded}`; `downloaded` maps each
  `mac-zip`, `win-portable`, `win-user`, `win-system` to `{assetId,path}`.
  Requires successful exact runs, fresh observation, both platform inventories,
  SHA-256 and size of downloaded bytes, four distinct provider assets, and a
  unique digest/size match when GitHub normalized a filename. Does not assert
  that a successful build installed or passed GUI checks.
- `installed-plan`: input `{policy, collection, pins}`; `pins` includes exact
  `serviceSha`, `testRevision`, `rubricRevision`. Uses the existing eight required
  policy checks with Mac, Windows User and Windows System artifact identities.
  Six smoke checks and optional UX stay separate. Every unexecuted check is
  `NOT_RUN`; no missing record becomes PASS.
- `cache-identity`: input explicitly names source/Service SHAs, platform,
  architecture, Node/SDK versions, lockfile digest, seed-script digest and
  build-contract digest. Changing any field invalidates the key. This helper
  does not change cache/workflow behavior or claim measured speedups.

## Orchestrator integration

Import `CloudExecutor`, `GitHubTransport` from `provider.mjs` and the collector,
`installedPlan`, `runInstalledPlan`, `fileVerifier`, `cacheIdentity` from
`evidence.mjs`. Supply a transport with `request(method, endpoint)` for reads.
`GitHubTransport` provides this via bounded authenticated HTTP and disables redirects.

Mutation is available only with live trusted callbacks, never a caller JSON
`authorized:true` flag. Construct `CloudExecutor({transport, authorize, reserve,
journal, now})`. `authorize(request, requestDigest, nowMs)` must check the current
operation fence/lease and any applicable signed intent. `reserve(request,
requestDigest)` must atomically reserve the current exact operation. Both return
strict `true`. The persistent journal exposes async `get(repositoryId:operationId)` and
`put(repositoryId:operationId, record)` and must provide serialization across workers through the
coordinator's lease, not an in-memory map in production.

Call `mutate({operationId, kind, identity, ...})` for these bounded intents:

- `managed-tag`: include `tagMessage` returned by existing `buildTagMessage(plan,
  {managedDraft:true})`. The candidate must support the exact existing contract.
  The trusted `transport.execute(request)` creates/pushes the annotated tag once.
  It must never also dispatch the two build workflows.
- `retry-build`: include `runId` and `runAttempt` from `identity.runs`. The effect
  callback must reread the exact failed run before issuing its bounded retry.
- `upload-support`: include numeric `releaseId` and exclusive support
  `asset:{name,sha256,size}`. The effect callback must check the current numeric
  draft and local byte digest immediately before upload, never clobber packages.

Authorization is rechecked immediately before the effect callback. A durable
UNKNOWN marker is written first. Any lost response or completion persistence
failure returns UNKNOWN, hides provider error bodies, and prohibits replay.
A DONE identical operation is reusable. Reusing an operation ID with changed request bytes blocks. UNKNOWN has no generic force/reset:
read-only observation and the coordinator's explicitly reserved recovery decide
how to proceed; an absent asset alone does not authorize retry. The callback is
the root-owned effect boundary, not an additional production transport hidden
inside this library. Current CLI is intentionally read-only.

## Workflow wiring required

1. Build receipt creation already emits `hps-draft-build/1`; archive that inventory
   together with trusted `provider:{repository,repositoryId,runId,runAttempt}` from
   workflow context. Collect both platform receipts from the exact attempts.
2. Feed exact downloaded asset bytes and provider observations into `collectAssets`.
   Keep the numeric release ID; do not identify an ambiguous draft by tag alone.
3. Run the six existing smoke modules through their existing runner. Trial issuance,
   roster/session admission and cleanup remain existing Service authority work.
4. Provide actual installed runner callbacks for all eight required policy checks.
   `runInstalledPlan(plan, runner)` expects each report's test/requirement/expected,
   source/package/Service/test/rubric identity, installed target and runner ID,
   observed result, and hashed evidence file. Mac update and both Windows installer
   updates require real N−1→N application observations. A portable payload check
   does not prove these installed checks. No runner means NOT_RUN.
5. Construct `fileVerifier({root,files,source})` only in the trusted collector from
   hashed bounded source/run observations. Entries include relative `uri`, digest,
   size, observed time, repository ID, source SHA, annotated tag object, run ID and
   attempt, matching `source.runs`. The returned synchronous callback accepts
   engine `{path,sha256,size}` or `{uri,sha256,size}`, rereads bytes, and rejects stale
   or changed records. Never trust uploaded JSON alone to construct this closure.
6. Keep private signer material on the independent authorized signer. Feed verified
   records into existing signed evidence/approval/publisher interfaces. A collector
   or runner PASS is not a signed envelope or permission to publish. Root must
   revalidate intent/fence immediately at every publication/mirror write.

Local transport fixtures exercise real HTTP response parsing and identity guards.
They provide no provider execution, installed application, human acceptance or
cold/warm performance evidence.

## Concrete workflow wiring (follow-up)

`build-contract.mjs` now includes trusted Actions repository ID/name and run/attempt
in both record and check-upload inventory generation. The existing Mac/Windows
workflows use that same inventory and still upload original packages once.
`release-cut.yml` passes S6's existing scoped issuer secret and optional cohort/URL
repository variables. Missing values remain NOT_RUN; no new credentials are issued.

`verify-unified-release.yml` now splits managed candidates from its existing legacy
acceptance/publication path. Managed candidates produce a pinned identity artifact,
then `collect-candidate.mjs` downloads inventories and packages by numeric IDs and
rereads the source tag, numeric draft and exact run attempts after downloading.
A separate native matrix owns Mac, Windows User and Windows System installation.
`previous-release.mjs` chooses the highest lower published stable version, binds its
numeric release, resolves its source tag, and checks every downloaded digest.
An unavailable previous version cannot pass update acceptance.

`installed-runner.mjs` installs untouched candidate packages into disposable hosted
runner directories, verifies on-disk source/version and the actual launched
executable, and waits for the native workbench. It invokes existing product
`renderInstallerScript` / `renderWindowsUpdateWrapper` against a real N−1 install,
then checks candidate installation and restarts that installation using its retained
profile. It compares persisted project/settings and an OS-encrypted synthetic
account sentinel. The generated updater script and before/after proofs are retained.
This runner never patches or re-signs the app and removes provider credentials from
the Electron process environment.

The updater primitive and synthetic encrypted account are useful execution evidence,
but cannot establish actual Studio sign-in session continuity or an updater UI click.
Therefore UPDATE-* remains BLOCKED even if those primitive checks succeed. Actual
account/session continuity still needs its own native scenario. A missing native host
produces NOT_RUN for its required checks. Failures of product identity or retention
produce FAIL; missing host/access prerequisites produce BLOCKED. Existing native
trial/classroom and public-Service drivers run on the actual fresh installed package
for PUBLIC-FLOW-*; their successful process exit alone does not grant PASS because
the resulting source/tree/activity receipts are checked too. Windows compares every
portable reference payload byte with the installed directory while allowing actual
installer bookkeeping files; both installer payload proofs remain required.

The existing workflow's legacy acceptance/publication criteria remain intact.
Managed collection/native jobs never publish or sign. The coordinator must bind
any real dispatch/model stage to its current reservation, fencing and resource gate.
No cloud or native stage was run merely by adding this source wiring.

The two build workflows now cache only immutable public npm registry tarballs.
`build-cache.mjs` derives the key from source, locks, Node/ABI, architecture and seed
script digests. Import/export copies only exact public registry tarball keys present
in pinned locks, checks integrity, and strips request/auth metadata. Local `file:`
Service archives, credentials, logs, `node_modules` and private source never enter
the saved public-cache directory. No broad restore prefix is used. This enables
same-revision rerun reuse without claiming a measured cold/warm improvement.
The existing Mac prepare/reset pipeline and Rust cache remain unchanged because
this checkout lacks a runnable submodule and no native timing/ABI evidence was
available to safely remove preparation or cache compiled outputs.
