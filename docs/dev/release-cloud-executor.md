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
