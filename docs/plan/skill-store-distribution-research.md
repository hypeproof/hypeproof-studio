# HypeProof Studio skill-store research

Date: 2026-10-15 (Asia/Seoul). Low-reasoning research subagent; parent source review.
Acceptance and decisions: [cross-platform store](skill-store-cross-platform.md). Read-only source review and official-document research. No deployment, account-plan inspection, private data access, or cross-account execution was performed. Prices below are public list prices checked today, not a statement of the user's subscription or remaining allowance.

## Recommendation

Keep Service as the store authority. Keep today's small inert recipes directly in existing D1. Add a private R2 bucket only when multi-file bundles, screenshots or larger assets justify it; D1 then holds searchable metadata, entitlements, versions, moderation and object digests. Use GitHub for reviewed public source and official release provenance. Keep Google Drive/GAS for each learner's documents and execution, not as the primary package registry. Do not migrate to Supabase merely because it is already paid for.

Supabase Postgres RLS + private Storage is a credible alternative if product identity/permissions are deliberately consolidated into Supabase later. Running two catalogs or independent entitlement systems now would create a consistency and authorization burden. These are design recommendations, not implemented or approved behavior.

Operational boundary: Studio's roughly319 MB private app/SDK installer is not a
learner skill package. A separate R2 streaming comparison for that installer is
being prepared after an incomplete download; it does not justify moving today's
32 KiB recipes or prove a storage provider caused the transfer problem. Keep
installer assets and future learner bundles in separate namespaces/access policies,
and prefer a dedicated private pilot bucket over reusing an unrelated bucket.
Any R2 deployment must check public access, expiry, complete byte verification and
existing account usage separately. Current local handler tests are preparation,
not a live R2 or cross-platform store result.

## Current local evidence and scope boundary

Inspected Studio AGENTS.md/CLAUDE.md and the Service integration checkout at `/tmp/hps-email-service-integration-20261015` after its AGENTS.md. Runtime references: Studio `0b57074d`, Service `abf79a8b`. Local source evidence:

- `worker/migrations/0045-automation-recipes.sql` stores template JSON, digest, cohort, owner and publication timestamps in D1 `automation_recipes`; its comment excludes Google credentials, spreadsheet data and recipient records.
- `worker/src/routes/automations.ts` authenticates Service tokens, checks token/grant revocation, allowed profile/cohort membership and session gates, lists only the current cohort, publishes with idempotency, fetches visible items and lets the owner unpublish. The source currently limits 50 publications per owner and 500 per cohort. This is source inspection, not a new runtime test.
- `worker/src/lib/automation-recipe.ts` accepts the exact `hps-email-automation/1` schema, 32 KiB maximum, restricted placeholders and columns; rejects extra fields, URLs, email addresses and several credential patterns, then invokes the shared publish scanner.
- The prompt in `worker/src/lib/automation-workflow-prompt.ts` explicitly distinguishes the shared deterministic runner from portable inert recipes and requires local account setup/preview. It does not establish a generic package execution framework.
- Studio DEC-024 describes the expanded destination: learner-owned Apps Script web apps/background work. It does not mark that runtime implemented. A JSON mail template is not equivalent to arbitrary JavaScript, a shell script, a VSIX, or an agent SKILL.md.

The existing D1 hash is useful for idempotency/content comparison. The inspected route does not constitute a signed client-verifiable distribution manifest or a general malware defense.

## Storage and distribution choices

| Option | Metadata / blobs | Authorization and fit | Main tradeoff |
|---|---|---|---|
| Existing Service + D1 | Both in D1 while recipes are tiny | Reuses real cohort and owner gates | Best immediate fit; no new blob protocol needed |
| Service + D1 + private R2 | D1 catalog; immutable digest-addressed blobs in R2 | Worker checks entitlement before streaming or issuing a short-lived URL | Best incremental bundle store; application must enforce all tenant access |
| Supabase | Postgres catalog with RLS; private Storage | RLS can join membership rules; JWT-authenticated downloads or signed URLs | Strong database policy model, but identity migration/duplication is material |
| GitHub Releases / GHCR OCI | Release/package metadata and artifacts | Public official packages are simple; private access follows GitHub permissions | Excellent public provenance; awkward classroom/cohort access and learner GitHub onboarding |
| Google Drive | File metadata and permissions; learner files | Google user/group/domain permissions | Good learner working data; package version/trust/revocation must still be built |

Supabase Storage uses Postgres RLS; service keys bypass RLS and must never be embedded in Studio. Private downloads can be made with a JWT or a time-limited signed URL. [Access control](https://supabase.com/docs/guides/storage/security/access-control), [private downloads](https://supabase.com/docs/guides/storage/serving/downloads).

R2 presigned URLs are bearer capabilities: anyone holding one can reuse the authorized operation until expiry. Official expiration range is 1 second–7 days; they use the S3 API domain, not a custom domain. A proposed 1–5 minute download TTL reduces exposure but does not make links single-use or user-bound. Prefer authenticated Worker streaming when immediate entitlement revocation matters. URL queries must not enter analytics, chat or referrers. Signed-URL issuance is not execution approval. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Portable package contract: proposal

Use one versioned manifest and distinguish runtime kinds, rather than permitting arbitrary files through the email schema:

- `recipe`: bounded JSON interpreted by a shipped, pinned runner.
- `gas-project`: reviewed Apps Script source plus explicit OAuth scopes, setup schema and deployment mode.
- `agent-skill`: instructional Markdown/reference assets, classified as untrusted model input; executable attachments separately declared and restricted.

A future `.hpsskill` ZIP can contain `manifest.json`, schema-valid recipe or reviewed source, documentation, preview assets and LICENSE/NOTICE. Manifest fields should include package ID, version, schema version, runtime kind, minimum Studio/runner version, supported OS/runtime, capabilities/scopes, required input fields, dependency digests, per-file hashes, total size, license and publisher identifier. Publication identity/review status should come from the authenticated Service record, not an author-writable manifest field.

Export configuration requirements, never account bindings: no OAuth tokens, service keys, live spreadsheet IDs, deployment IDs, recipient data, logs, absolute Mac paths or secrets. Use input placeholders and a local install record for account/resource bindings. Treat filenames as portable relative paths, reject traversal/absolute paths/symlinks, cap unpacked bytes/file count, and check Windows reserved names and case-collisions. Download to quarantine, verify before extraction/use, then install atomically. These are proposed safeguards, not existing implementation claims.

## Mac → store → other accounts → Windows

1. Creator exports only portable content. Studio renders a publication preview and shows which configuration/data are excluded. Service validates the same schema and authenticated publication rights.
2. Catalog stores a version and immutable digest. A reviewer/official build can add a separate verified provenance record.
3. Another Studio installation authenticates to Service and obtains authorized metadata/artifact. Local verification checks digest, manifest, compatible runtime and current blocked/revoked state.
4. The recipient separately connects the intended Google identity (locolor/locolorbot/TJ are test identities, never inherited from the creator), chooses or creates its own Sheet, and supplies local configuration. The UI distinguishes Service membership from Google execution account.
5. Run preview with synthetic data first. Effects and scopes are approved in the recipient context; installation does not silently send mail, add triggers or deploy a web app.
6. For the future GAS path, create/copy a learner-owned project and deploy in that learner's chosen identity. Store its script/deployment/trigger references locally or in that learner's own protected account space. Windows must need no Mac path or shell assumption.

A GAS web app can execute as its deploying owner or as its accessing user; this choice determines privileges. An installable trigger always executes as its creator, even when someone else causes the event. Therefore copying a package or switching the active browser account alone does not prove isolation. [Web apps](https://developers.google.com/apps-script/guides/web), [installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).

Background GAS runs after Studio closes, but still has quotas and trigger timing variation. Current official tables list a 6-minute script execution limit and consumer/Workspace trigger runtime budgets of 90 minutes/6 hours per day; connected API/model quotas remain separate. Recheck limits before a course commitment. Drive permissions control file sharing, not the safety of code within a file. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [Drive permissions](https://developers.google.com/workspace/drive/api/guides/manage-sharing).

## Trust, threats and lifecycle

A hash proves downloaded bytes match an expected digest only if that digest came through a trusted channel. An attacker able to replace artifact and catalog can replace both. A signature binds bytes to a key/identity; verification must restrict the expected publisher/key or OIDC issuer and workflow identity. A valid signature does not mean the code is harmless or its claims are true. GitHub attestations need verification to provide a benefit; public provenance is written to a publicly readable transparency log, so do not put private learner identifiers into it. [GitHub attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations), [Sigstore verification](https://docs.sigstore.dev/cosign/verifying/verify/).

For official packages, use reviewed GitHub source, pinned build dependencies, immutable digest-addressed output and an attestation or signature checked by Studio against allowed release workflow identity. Learner publication should initially show authenticated community provenance and remain bounded JSON. Do not label unreviewed learner code “safe” because it has a signature.

Defenses must cover both execution and model interpretation: catalog descriptions/README/SKILL.md can contain prompt injection. Render text safely, keep it separate from privileged instructions, prohibit it from granting tools, and validate tool requests through the host's capability policy. A scanner is supplementary; it cannot reliably detect all hidden secrets, exfiltration code or persuasive instructions. Keep deterministic runners, explicit scopes and resource binding as the primary boundary. Arbitrary code needs a separately designed constrained runtime and review path; VS Code's extension host itself is not such a sandbox.

Use immutable versions; installation pins a digest. Updates show changed permissions/runtime and require renewed approval when authority expands. Keep a last-known-good version and local data migration plan. Distinguish unpublish (hide from discovery) from revoke (block future install/run). Revoke by digest, publish an authenticated revocation feed, and check it before online execution. Already downloaded bytes cannot be recalled, and a learner-owned GAS deployment will continue independently unless its runtime checks policy or its owner disables it. Never promise a central kill switch for arbitrary copied source. A signed monotonic policy/catalog version and expiry help resist stale metadata; intentional rollback selects an allowed older artifact under a fresh policy version.

## Established ecosystems and reusable lessons

**n8n workflow sharing** is the closest user journey: export/import JSON and rebind credentials. Its official guidance warns that exported credential names and HTTP authentication headers can leak. Its community nodes have machine and workflow-data access, demonstrating why workflow templates and executable plugins need separate trust classes. Reuse the import/configure/preview pattern, not the assumption that all JSON is inert. n8n is source-available under its Sustainable Use License, not a blanket OSI-open-source commercial embedding license; check terms before embedding/hosting its software. [Export/import](https://docs.n8n.io/build/manage-workflows/export-and-import.md), [community node risks](https://docs.n8n.io/integrations/community-nodes/risks), [license](https://docs.n8n.io/sustainable-use-license).

**VS Code/Open VSX** supplies a mature registry model: publisher namespace, package/version metadata and downloadable artifacts. Open VSX is an open-source registry implementation under EPL-2.0. Borrow concepts rather than deploy a full extension registry for tiny recipes. VS Code documents that extensions have the application's permissions; its marketplace defenses include publisher checks, scans, package signing and a malicious-extension blocklist. These are layered operations, not benefits automatically inherited by Studio's custom skill store or by Open VSX. [Open VSX source](https://github.com/eclipse-openvsx/openvsx), [VS Code runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security).

**OCI/ORAS and TUF** are genuine open-source building blocks. ORAS distributes non-container artifacts through OCI registries with custom media types and digest addressing; an eventual `application/vnd.hypeproof.skill.v1+json` format can remain registry-portable. OCI storage does not execute or sandbox artifacts. TUF's role-separated signed metadata, expiry and version checks address update/repository compromise threats. Its Python reference implementation is a useful design reference; adopting its protocol is worthwhile when offline distribution, delegated publishers or repository-compromise resistance justify key/metadata operations. Do not claim a homegrown signed JSON file is full TUF. [ORAS docs](https://oras.land/docs/), [ORAS implementation](https://github.com/oras-project/oras), [TUF specification](https://theupdateframework.github.io/specification/latest/), [python-tuf](https://github.com/theupdateframework/python-tuf).

Package licenses are separate from registry software licenses. Require an explicit redistribution license for public/community packages and preserve dependency notices. A publicly accessible GitHub file is not automatically licensed for repackaging. Free download permission and commercial reuse permission are different questions.

## Current public cost/limit check

| Service | Official public list terms checked today | Consequence |
|---|---|---|
| R2 Standard | 10 GB-month storage, 1M Class A and 10M Class B operations/month free; then $0.015/GB-month, $4.50/M writes-class and $0.36/M reads-class; direct egress free | Good blob distribution economics; operations and attached services still cost |
| D1 | Paid allowance: 25B rows read/month, 50M rows written/month, 5 GB; overages $0.001/M read rows, $1/M written rows, $0.75/GB-month | Tiny recipes unlikely to justify migration on storage cost alone; index catalog queries |
| Workers Standard | $5/month base; includes 10M requests and 30M CPU-ms; excess $0.30/M requests and $0.02/M CPU-ms | Auth/download gateway isn't intrinsically free; existing plan/usage must be checked separately |
| Supabase Pro | From $25/month; 100 GB file storage then $0.0213/GB; 250 GB egress then $0.09/GB; separate cached egress 250 GB then $0.03/GB | Existing spare allowance may be sufficient, but download traffic can become a cost driver |
| GitHub Releases | Up to 1,000 assets/release; each under 2 GiB; documentation states no total release-size or bandwidth limit | Good official public releases; respect platform terms and use actual release assets |
| GitHub Packages/GHCR | Public packages free; private Packages normally have plan allowances. Container-registry image storage/bandwidth currently free with advance change notice | Do not extrapolate “currently free container images” into a permanent universal OCI storage guarantee |

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Supabase pricing](https://supabase.com/pricing), [Releases limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages).

Illustrative sizing, not a bill: 20 recipes at the current32 KiB ceiling occupy at most640 KiB of recipe bytes per version, excluding indexes/metadata/backups. At20 installs each that is400 detail downloads, about12.5 MiB of recipe bytes. For expanded assets, 1,000 bundles averaging 1 MB are about 1 GB; 10,000 full downloads are about 10 GB transfer. This fits R2's cited storage/read allowances if those allowances are otherwise unused; Worker/D1, scans, retained versions, abuse and AI execution remain separate. For today's ≤32 KiB recipes the operational complexity of another store is likely more significant than byte cost.

## Incremental plan and acceptance evidence

1. Preserve email schema, Service gates and D1. Document publisher/license/version, clarify community versus official status, and confirm no secrets are exported.
2. Add a new versioned package contract only for a concrete next runtime. Add private R2 blobs and immutable manifests when files require them; keep one catalog and entitlement authority.
3. Add official provenance verification and revocation before broad executable distribution. Introduce broader community code only with its distinct runtime/review policy.
4. Verify Mac creation → Service publication → Windows download using separate recipient identities; test unauthorized cohort denial, wrong digest, bad archive paths, secret rejection, revoked version and stale metadata. For Google, prove distinct file ownership, OAuth identity and trigger creator; for background execution prove Studio-closed completion without crossing account resources. Do not use real customer mail as the initial isolation test.

Open questions requiring product decisions: private cohort versus public discovery, permitted runtime kinds, official/community review ownership, update automation policy, and whether copied learner-owned GAS code is expected to obey central revocation. Current source and this research do not answer these as agreed policy.

### Additional verified caveat and pilot sizing

Supabase explicitly documents that Storage signed URLs use an internal signing key separate from Auth JWT keys. Rotating/revoking Auth keys does not revoke these URLs: they remain valid until expiry, and the documentation directs revocation requests to support. Therefore removing a user's membership or rotating Auth secrets must not be advertised as invalidating an already issued Storage link. Use short TTLs or authenticated downloads checked on each request when immediate denial matters. [Official Storage serving documentation](https://supabase.com/docs/guides/storage/serving/downloads).

Proposed additions, not current implemented defenses: for a 20-person pilot, use the existing Service API, strict JSON schema, HTTPS, current cohort gates, pinned versions, digest checks, a small blocked-version table and manual review of any new runtime. Do not deploy OCI registry infrastructure or a full TUF authority just for this pilot. Borrow TUF's explicit separation of trusted publisher keys, artifact hashes, freshness and version state; a real TUF deployment can wait until multiple independent publishers/offline mirrors create that need. ORAS is Apache-2.0; python-tuf is dual MIT/Apache-2.0. [ORAS license](https://github.com/oras-project/oras), [python-tuf license](https://github.com/theupdateframework/python-tuf).

For implementation research, Open VSX's full registry is an EPL-2.0 reference, not a required dependency; n8n's credential rebinding/export filters and VS Code's blocklist/update-permission patterns can be implemented in the existing product without copying restricted code. Source availability alone does not license a hosted competing product. No numeric self-hosting capacity was claimed: that depends on deployment resources and operational work, not repository license.
