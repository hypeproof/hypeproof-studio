# Controlled release workflow wiring

The managed builder, verifier, release-cut and mirror workflows now call the
common workflow gate at their actual execution and mutation sites. This change
is source wiring, not deployment, a configured provider allowance, a successful
native run, approval, publication or customer update acceptance.

## Mode and identity

Protected repository variables `RELEASE_ENGINE_ENABLED=true` or a nonempty
`RELEASE_ENGINE_URL` select controlled mode. That mode requires a valid HTTPS
engine origin and GitHub OIDC. Missing endpoint, OIDC, reservation, matching
request digest, fence or fresh lease fails closed. An absent/false mode retains
legacy workflows and their existing PR/tag/hotfix/live-session guards, including
manual managed-draft cuts. Managed verification never substitutes example policy
for an unavailable engine context.

Caller metadata comes from GitHub runner context: canonical repository and
numeric ID, run ID/attempt, source SHA, workflow ref and exact workflow SHA.
Metadata is not authority: the Service must independently verify OIDC and resolve
the current persisted operation/claim/reservation. Workflow JSON cannot nominate
an actor or acquire a new budget. Execution audience is
`hypeproof-release-executor`; the isolated signer only accepts
`hypeproof-release-verifier` from its exact trusted protected verifier revision
and `release-verification` environment. Build workflows have execution OIDC
permissions, which never grant evidence signer authority.

## Actual write paths

| Path | Controlled behavior |
|---|---|
| Mac and Windows native jobs | Ubuntu tag preflight runs first. Exact final promotion markers skip the entire native job; unmanaged/manual/hotfix tags are refused when controlled mode is enabled. Current build reservation is required before dependency caches/build work. |
| Mac and Windows draft release create/upload | After exact build-contract and archive checks, Service creates/pins the numeric draft. Each original file then receives a durable UNKNOWN upload permit; the original runner streams it directly to the fixed numeric GitHub asset API. Service re-observes the uploaded asset digest before completion. Archives never pass through Worker RAM. |
| Builder automatic acceptance dispatch | A direct legacy-only guard immediately precedes dispatch; controlled mode cannot dispatch via this legacy path. |
| Unified legacy acceptance publication | Every acceptance upload, public release edit and mirror dispatch has a preceding legacy-only guard. Controlled mode cannot fall through. |
| Unified managed publication | The trusted server driver waits for terminal build/native metering, recorded evidence and fresh human manager approval, then calls SameBytePublisher. The verifier workflow ends with a read-only marker so its own run can become terminal; it cannot deadlock waiting for its own publication job. |
| Mirror manual/release triggers | Both triggers request a pinned mirror draft, stream only the approved original numeric source assets with separate upload permits, and request server publication after complete byte reconciliation. The live legacy target is private and the public-delivery compatibility handler blocks before any write. Every legacy target create/edit/upload and generated install-bundle upload also has its own preceding legacy-only guard. Unapproved generated support bytes are never smuggled through the controlled path. |
| Release-cut tag creation | Delegate the reserved `managed-tag` operation to Service, then omit builder workflow dispatch. The tag push is the sole build trigger. Legacy tag-plus-dispatch behavior is preserved only outside controlled mode. |
| Actions artifact storage | Each upload is preceded by a separately current `artifact-store` allowance check. An `always()` upload explicitly requires its storage guard to succeed. Missing proof blocks storage rather than assuming it is free. |
| External GitHub UI/API credentials | Source code cannot revoke external account permissions. Organization credential/rules configuration remains a separate operational boundary. Old tags containing old workflows also require provider trust/credential enforcement; current source alone cannot rewrite them. |

The final stable tag marker is `hps-same-byte-promotion/1` followed by JSON with
exact `candidate`, `intentDigest`, and numeric `releaseId`. The preflight requires
an annotated stable tag whose source equals the marker. Malformed markers fail.
It runs in an Ubuntu job before the Mac/Windows job is allocated, avoiding a
second build when the Service creates the final tag for the existing draft.

## Service execution contract

POST `/v1/execution/authorize` receives:

```js
{path, identity, caller, effect}
```

It returns `{status:'AUTHORIZED',requestDigest,fence,operationId,expiresAt}`.
The digest binds the exact request and the lease must be current and at most five
minutes in the future. Actual controlled mutations then POST
`/v1/execution/perform` with the same body plus
`authorizationRef:{operationId,fence,requestDigest}`. The Service resolves and
rechecks the current claim, journals every external subeffect, and returns
`{status:'SUCCEEDED',requestDigest}`. Missing/mismatched/lost results remain
blocked or UNKNOWN; the workflow never retries a write or rebuilds for a response.

Operation paths are `build-mac:build`, `build-win:build`, `installed:TARGET`,
`release-cut:tag-create`, `build-mac:draft-assets`, `build-win:draft-assets`,
`verify-unified:publish`, `mirror:release-create-edit-upload` and
`JOB:artifact-store`. Effects are `build-start`, `verify-start`, `managed-tag`,
`draft-release-create`, `draft-asset-upload`, `publish-existing-draft`, `mirror-release-create`, `mirror-asset-upload`, `mirror-publish`, and
`artifact-store`. Unknown/unconfigured adapters must remain BLOCKED.

## Independent observed evidence

The verifier checks out `github.workflow_sha`, while candidate bytes remain
separate immutable inputs. Before native tests, POST `/v1/evidence/context`
receives `{identity:{...collection.identity,target},caller}` using verifier OIDC.
The response must pin `{candidateId,manifestDigest,reporterId,serviceSha,
testRevision,rubricRevision,policy}`; `testRevision` must equal the exact trusted
workflow SHA. The pinned Service source is checked out from that context.

The runner records actual started/ended timestamps and preserves PASS, FAIL,
BLOCKED and NOT_RUN observations. Small top-level JSON proof files are uploaded
separately from screenshots/diagnostics. Each submitted report uses the immutable
artifact ID returned by `actions/upload-artifact`, never an artifact name alone:
`github-run:REPO_ID:RUN_ID:ATTEMPT/artifact-ARTIFACT_ID/TEST.json`.
`provider` duplicates exact repository/run/attempt/artifact ID metadata. The
Service re-downloads and hashes those bytes before signing and storing the
canonical report through `/v1/evidence`.

## Remaining operational gates

Provider allowance/storage/hard-cap proof, execution adapters, protected
workflow/environment trust, live credentials, manager approval, canary policy and
non-organization customer acceptance are not configured or proven by this
commit. No provider runs, remote mutations, deployment or publication were made.


## Streaming transfer and storage completion

`runner-upload.mjs` keeps archives on the original disposable runner. Each HTTP
upload is preceded by a fresh authorization and a Service-persisted UNKNOWN
permit. Its URL is built locally from the exact numeric release ID and a fixed
canonical repository; redirects are refused. The file is streamed and hashed
while sending. A lost response triggers only `/v1/execution/complete`, which
re-reads provider asset ID/name/size/SHA-256 with fresh same-run OIDC. It never
repeats a binary write to recover a response. Completion may occur after the
original short upload lease expired; it performs provider reads only.

Each Actions artifact store also posts its returned immutable artifact ID through
`workflow-gate.mjs complete`. The Service verifies run/attempt/name/timestamps and
records completion before capacity can be settled. Missing billing/usage proof
keeps the reservation held.

The collector runs in protected `release-collection`, posts the exact collection
to `/v1/evidence/collection` using verifier-audience OIDC, then native jobs obtain
canonical context. Signing remains confined to protected `release-verification`.
The mirror target is currently private ID1244454814; no visibility change or
anonymous-access success is implied by this compatibility implementation.
