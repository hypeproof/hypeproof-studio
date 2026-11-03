# Approved observation price publication through normal deployment

This is an opt-in operational path for the user-approved official public-price calculation. It neither enables paid admission nor establishes invoice cost. Service owns the canonical price registry, approval guard and immutable revision semantics (`ST-IMP-USAGE-COSTS`, `ST-TEST-USAGE-COSTS`); the Studio workflow remains the deployment entry point. No price is inserted by SQL.

## Exact approval and scope

The explicit conversation authorization recorded on 2026-10-16 has receipt SHA-256 `4e5f17efadc6c4ad4093801293acfd287cbd8b23f6ca0da65f81545e8bc71610`. The approved price digest is `c784f24ce54eb0534533f4292d526a6e981135c362cf1967797df25a9051aa8b`. `config/usage-prices/haiku55-20261016.json` is that exact public document, including its originally named `-draft` revision. Do not rename the revision or change the source timestamp: either changes the approved digest. The word in the immutable identifier does not supersede the later explicit approval.

The interval is UTC **2026-10-16 00:00 inclusive to 2026-10-17 00:00 exclusive** (KST 09:00 to 09:00). Dimensions must match Anthropic, `claude-haiku-5-5`, Anthropic Messages, `standard`, `global`, with input plus cache context at most 100,000 tokens. Source: [official Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). Micro-USD per token is input 1/10, output 1/2, cache read 1/100, five-minute cache write 1/8 and one-hour cache write 1/5, rounded up separately per meter. Missing response dimensions or cache TTL evidence must remain unknown. No account discount, invoice or payment authorization is inferred. The approved observation document also bounds output to 4,096 tokens and each other meter to 100,000; records outside those bounds remain unpriced. No new day, model, tier, region, price or expanded context is authorized by this option.

## Production identity and preservation precondition

Before dispatch, the operator must inspect the latest **deployment traffic percentages** and the explicit traffic-serving version bindings. The Worker settings/latest-upload endpoint can describe a 0%-traffic version and must not substitute for that check.

The read-only 2026-10-16 02:44 UTC audit observed:

- Account `f1da7073b98021b4117c82a4a219eef0`, Worker `hypeproof-studio-api`, domain `api.hypeproof-ai.xyz`.
- Deployment `b3adca92-6d1e-4d42-82c9-ef3fd391608f`: version `d34da3a5-32d6-4d54-ab20-a21569395820` at 100%; email-test version `a245457b-cf3e-4b56-bfb2-18068984f970` at 0%.
- Serving HPS_DB is `hypeproof-studio` / `2427207c-272e-4ecd-9d16-7a1dcc0fc741`. The repository config and schema checker correctly retain this identity. Database `76f4ba63-2550-4ccd-82f9-08fd0aa7a101` belongs to the isolated email test; do not copy it.
- Serving `HPS_ACCESS_CONTRACTS` and `HPS_USAGE_APPROVED_PRICE_DIGESTS` are absent. Enabled paid contracts and the earlier `1de3...` approval belong to the 0% email-test version and must not be imported.
- All five static plaintext vars in pinned Service `eee7cf0957ad02c7a3b7e18be61319ea26d20158` exactly match the serving version; HPS_WORKER_VERSION is the normal per-deploy addition. Normal canonical KV/R2/D1 bindings remain in place. The existing Owner SSO secrets-file behavior remains unchanged; no password rotation is added.

If the serving version, split, paid flag, approval list or canonical bindings have changed, stop and reconcile the new state before dispatch. This option is an exact approved operation against the observed production state, **not a generic allowlist merger**. Do not add `keep_vars` to import the latest isolated upload. Subsequent deployments without this option do not inject the dated approval; do not assume an expired approval remains an admission policy. Historical reconciliation retains its own canonical checks.

## Reviewable normal workflow inputs

Only the authorized deployment operator dispatches `deploy-worker` at the reviewed merged Studio ref. For this operation use `dry_run=false`, `verify_prod=true`, `publish_approved_usage_price=true`. Existing live-class freeze, compatibility checks, migration probes and other inputs retain their normal gates; this option grants no skip or override. The input defaults to false. `dry_run=true` runs local checks but neither deploys nor publishes.

Before deployment, the local document is checked against the exact approved digest, dimensions, UTC interval, rational rates and bounds. Tests also load the pinned canonical Service validator/digest and exercise the actual Hono route against in-memory SQLite. After normal deployment, the existing GitHub HPS_ADMIN_PASSWORD authenticates exactly one POST to `/admin/access/usage/prices`. The deploy adds only `--var HPS_USAGE_APPROVED_PRICE_DIGESTS:<exact-digest>` alongside the normal version var. It does not set HPS_ACCESS_CONTRACTS or any isolated-test binding.

The canonical handler writes the immutable revision, reads the stored digest and rejects a conflict before returning 201. The publisher requires the complete returned document to match the approved digest. Its receipt calls this `canonical-post-stored-digest-check`: it is **not an independent GET readback**. There is no canonical price GET endpoint. No credentials, response body, prompt or user usage record are written to the receipt. Production publication and its stored-digest confirmation remain NOT RUN until the actual dispatch succeeds.

A redirect, 401/403, conflict, non-201, malformed/mismatched response, timeout or transport error fails the step. There are no automatic retries. A timeout or incomplete response can follow a successful write, so its result is unknown; an operator may explicitly rerun the identical approved publication, whose canonical revision check is idempotent. Never change the password or broaden an approval to make a failed run pass. Local 21-request reconciliation is separate and must never be imported into production by this workflow.

## Focused checks

```bash
node --test scripts/test-publish-approved-usage-price.mjs
node scripts/publish-approved-usage-price.mjs --check
HPS_SERVICE_SOURCE=/path/to/exact/pinned/service node --experimental-strip-types scripts/test-approved-price-service.mjs
```

The first test covers exact rates/digest, unknown transport, no retries, secret redaction, response bounds, auth/approval/conflict failures and disabled/dry-run workflow controls. The last check uses only the pinned Service source and in-memory SQLite, including canonical publication, unauthorized and unapproved negatives, repeated publication, immutable conflict and paid-off preservation. These checks do not claim deployment, production publication or invoice reconciliation.
