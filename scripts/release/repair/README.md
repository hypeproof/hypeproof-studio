# Bounded repair runner

Local verification: `node --test scripts/release/test/repair-runner.test.mjs`.
The positive test executes a real red-to-green Node regression with a fixture model response; it does not call a model or prove Docker/hosted execution.

The workflow requires a pinned protected tag/environment, the Service-issued packet, and a provider-observed exact workflow run. The Service model endpoint rejects missing actual zero-cost model allowance. Existing GitHub job-millisecond allowance is insufficient. Missing credentials, model allowance, image/dependencies or bot authorization is BLOCKED.

Tests run in the configured digest-pinned Docker image with network disabled and a read-only product checkout, no host credentials or Docker socket. Image acquisition and required dependencies must be provided under the finite runner allowance; no install or paid fallback is attempted. This host has no running Docker daemon, so actual container execution is NOT_RUN.

Patch and receipt are emitted only under the runner output directory. Optional output.mjs uses the existing execution authorize/complete API with a fresh hypeproof-release-executor OIDC token. Upload runs only after a current storage permit, includes exactly repair.patch and receipt.json, has finite size/retention and no overwrite. It stays disabled without configured source contract, artifact-store role and actual byte-days allowance. Optional draft preparation/publication runs as a separate trusted step in the same job, with credentials only in that step. It invokes the pinned existing hype-pr criteria/assessment path, persists UNKNOWN before push/create, and never merges or publishes a release. No provider mutations were executed during implementation.
