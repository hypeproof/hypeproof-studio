# Managed workflow API allocations

These gates consume one finite `workflow-api-batch` allocation per source-reviewed envelope. They never claim exact GitHub request counts or that the Service WRITE token's rate limit applies to a workflow token or repair bot. Full batch units remain protected for UNKNOWN outcomes and are charged on the producer's independently verified exact terminal protected run/job/attempt; runner receipt counts do not settle capacity.

Configure a separate approved `github-workflow-api` resource for each credential/authority scope, signed workflowContracts with exact workflow SHA, all relevant sourceFiles SHA256, allowed paths/stages/jobs/events, maximumBatches, and the exact batchScope below. No configuration, entitlement, free tier, external cap, or live proof is created here. The full lifecycle must fit the approved contract period. Per-asset upload/storage and Service execution API permits remain mandatory separate controls.

| Role | Path | Max delegated commands/fetches | Minutes before new delegation stops | Exact batchScope |
|---|---|---:|---:|---|
| build-job | `build-managed:job-api-batch` | 1 | 240 | `protected-native-build-fixed-actions-cache-and-artifact-command-envelope` |
| candidate-job | `candidate:job-api-batch` | 1 | 180 | `protected-candidate-fixed-artifact-action-envelope` |
| mirror-job | `mirror:job-api-batch` | 1 | 180 | `protected-mirror-max151-release-view-commands-fixed-job-envelope` |
| repair-output | `repair-output:job-api-batch` | 1 | 20 | `protected-repair-single-fixed-output-upload-action-envelope` |
| observe-candidate | `observe-managed:api-batch` | 128 | 20 | `numeric-candidate-max128-http-delegations-no-retry` |
| assembly-admit | `assembly:api-batch` | 2 | 20 | `reviewed-compiled-artifact-two-metadata-reads-one-fixed-actions-download-envelope` |
| runner-upload | `runner-upload:api-batch` | 100 | 120 | `original-runner-max100-assets-no-retry-upload-envelope` |
| runner-mirror | `runner-mirror:api-batch` | 297 | 120 | `mirror-max99-source-download-redirect-and-upload-envelope` |
| collect-job | `collect-managed:job-api-batch` | 1 | 20 | `protected-collection-job-fixed-actions-and-artifact-command-envelope` |
| installed-job | `installed-managed:job-api-batch` | 1 | 90 | `protected-installed-job-fixed-actions-and-artifact-command-envelope` |
| candidate-wait | `candidate:api-batch` | 151 | 180 | `candidate-wait-max150-view-commands-one-optional-download` |
| collect-candidate | `collect-managed:api-batch` | 512 | 20 | `numeric-candidate-max512-http-delegations-no-retry` |
| previous-release | `previous-managed:api-batch` | 128 | 20 | `previous-release-max128-http-delegations-no-retry` |
| s5-ci | `smoke:S5:api-batch` | 2020 | 30 | `candidate-ci-max20-pages-2000-run-metadata-command-envelope` |
| repair-draft-pr | `repair-draft-pr:bot-api-batch` | 4 | 20 | `separate-bot-fixed-hype-pr-inspect-prepare-create-single-push-command-envelope` |

Each authorization uses current protected job OIDC. A private REQUESTED receipt is written before POST; interruption/unknown authorization and existing receipt block a new request. The first delegation must begin before the original authorization expires. The already reserved bounded command lifecycle does not renew consent or refresh authority. Redirect fetches count separately. No automatic command/request retry is added. Private receipts whitelist candidate identity and never contain tokens.

Native build and verification job envelopes cover their fixed artifact Actions commands. Internal Action/gh/hype-pr request counts and retries are NOT_OBSERVED; these are opaque finite command envelopes with source/job/run/time limits, not claimed exact requests. Candidate polling is max150 commands plus one optional download, S5 max20 pages/2000 checks, and managed mirror polling max151 view commands. Direct collector/previous/observer/assembly HTTP paths are independently gated and capped; mirror source bytes remain exact per-asset protected downloads. Optional PR bot allocation is separate from Service WRITE and workflow tokens and is required before inspect/prepare/push/create. Disabled optional PR performs none of these operations.

The executable gate necessarily runs after checkout/setup: OIDC bootstrap, Git clone/submodules, setup-node and external Action internals are not independently observed HTTP usage and cannot borrow the Service API request pool. These platform/bootstrap activities need their own approved included entitlement and bounded workflow/job envelope; this source does not fabricate provider remaining, a provider hard cap, or exact counts. Existing mutable external Action refs are not independently immutable source proof. Protected release-cut intentionally blocks managed mode; legacy installed/publish routes retain their existing managed-mode exclusions. No live workflow or provider operation was run.
