# Background live runtime acceptance adapter

Nothing in this directory activates an app, browser, native window or CLI UI.
`run.mjs` invokes the actual `runSdkCoach` or `proxyChat` entrypoint, the real
Agent SDK **0.3.299**, and the explicitly pinned seeded binary. The VS Code host import is stubbed and an explicit restrictive file-only profile intersection is recorded. There is no fake SDK/query/binary-resolution seam, no
provider simulation in live mode and no production-source changes.

Default invocation is nonbillable dry preflight. Only the delivery owner may add
`--allow-live --arm-guard` after reviewing the frozen source/config, dedicated local Service
and guard. Harness construction executed **zero provider requests**. Local fake
upstream tests and real runtime bundle/import checks are separate evidence.

## One fixed guard and one explicit activity

The owner creates three distinct real activities for three independent repetitions
and runs them separately. Each activity gets a new DISARMED guard/ledger and disposable
workspace; do not restart a guard to reset a failed activity's budget.

Create an absolute private guard config (no API key):

```json
{
  "schema": "hps-feedback-live-guard-config/1",
  "activityId": "ACTUAL_V1_ACTIVITY_ID",
  "port": 8790,
  "ledgerFile": "/absolute/new-evidence/upstream-guard.json",
  "keyFile": "/absolute/private/provider.key",
  "serviceCredentialFile": "/absolute/private/service-guard.key",
  "controlKeyFile": "/absolute/private/control.key"
}
```

```bash
node e2e/feedback-live/guard.mjs /absolute/guard-config.json
# Owner-only explicit opt-in; starts a loopback listener but makes no call itself:
node e2e/feedback-live/guard.mjs /absolute/guard-config.json --allow-live
```

The owner configures/restarts only the isolated actual Service with:

```dotenv
ANTHROPIC_PROXY_URL=http://127.0.0.1:8790/v1/messages
```

The Service receives **only** an invalid-for-provider synthetic credential:
`ANTHROPIC_API_KEY=hps-guard-only-<64 random lowercase hex>`, matching the private
`serviceCredentialFile`. Remove Gemini/Google/OpenAI/ambient provider credentials
from that isolated Service and restart it under owner control. Only the guard
reads the real raw Anthropic key from `keyFile`. `controlKeyFile` contains
`hps-guard-control-<64 random lowercase hex>`. Secret files are absolute regular
files with mode 0600, outside the SDK workspace/evidence upload; no contents are
logged. The incoming synthetic key must match exactly. The real key is substituted
only in the guard's outbound `x-api-key` after explicit arming.

The guard starts **DISARMED**. Before any generation, the runner sends an actual
authenticated Service count_tokens request with the beta marker
`hps-feedback-route-proof-<guard route_nonce>`. The guard responds locally with
`input_tokens:0` and `hps_guard_route_proof:{guard_id,nonce}`. This makes no upstream
request and consumes no real-call slot. The runner checks the exact nonce and
observed local probe count. If Service routing is wrong, its synthetic key cannot
bill a real provider. Ordinary calls remain refused while disarmed. Only an
explicit owner control action can arm; `--allow-live --arm-guard` performs it after
the validated route proof. A nonbillable nonce probe is repeated before each
candidate even after arming. The guard never follows redirects, chooses another
upstream or retries; real dispatches target only `https://api.anthropic.com` on
the two approved Messages/count_tokens paths (optional `?beta=true`).

Every real HTTP dispatch consumes one of **12** synchronous, durably reserved
slots before network access, including title/auxiliary calls, SDK/Service retries
and count_tokens. Concurrent requests share the same counter. Generating calls
require a positive integer `max_tokens` and are forwarded with
`min(requested,4096)`; invalid thinking or an enabled thinking budget greater than
or equal to that cap is refused before dispatch. Failed/cancelled calls still
consume their reserved slot. Cancellation aborts the upstream stream; it does
**not** prove the provider stopped processing or that no cost occurred.

`GET /__feedback/guard` returns bounded metadata only. The owner copies its
`guard_id` into the runner config. `POST /__feedback/attempt` reserves one of
three candidate attempts in that same guard; changing evidence directories cannot
reset those claims. Existing ledger files cannot be reused. Unsupported paths
and invalid bodies never become uncounted upstream calls.

The upstream protocol carries no authenticated HypeProof activity identity.
The guard identity is fixed at startup and the runner authenticates `/v1/activity`
against it. Keep the Service dedicated to that activity. The runner requires the
owner's `hps-feedback-owned-service/1` controlled startup receipt with `pid`,
`source_directory`, `source_sha`, `env_file`, `env_sha256`, `guard_origin`,
`service_origin` and `actual_provider_keys_in_service:false`. Config pins both
its exact file hash and a live process fingerprint. Compute `processSha256` as
SHA-256 of the raw bytes returned by `ps -p PID -o lstart=,command=` with
`LC_ALL=C`. The fingerprint is checked before every candidate. No receipt is
modified by the runner. This controlled PID/config receipt, synthetic-only key
and live nonbillable nonce proof jointly gate arming/generation; an env-file
string alone is never treated as proof of the running route. This PID check
currently supports POSIX background hosts only.

## Explicit runner configuration

Prepare a new disposable workspace containing only public/synthetic references,
and this ownership marker (activity SHA-256, not the credential):

```json
{"schema":"hps-feedback-live-workspace/1","disposable":true,"activity_sha256":"SHA256_OF_ACTUAL_ACTIVITY_ID"}
```

Store it at `.feedback-live-owned.json`. Put images under `assets/` or `images/`
so the actual previous-reference selection helper can find their host-produced
notes. Pin prompt/image/binary bytes using SHA-256. Keep prompt files,
credentials, evidence and skill snapshots **outside** the SDK workspace.

Example config; replace every placeholder with an explicit reviewed value:

```json
{
  "schema": "hps-feedback-live/1",
  "sourceSha": "FULL_FROZEN_STUDIO_SHA",
  "activityId": "ACTUAL_V1_ACTIVITY_ID",
  "model": "ACTUAL_SERVED_MODEL_ALIAS_OR_ID",
  "workspace": "/absolute/new-disposable-workspace",
  "evidence": "/absolute/new-run-evidence",
  "dependencyRoot": "/absolute/studio/extensions/hypeproof-chat",
  "service": {
    "origin": "http://127.0.0.1:8788",
    "tokenFile": "/absolute/private/participant-token.txt",
    "envFile": "/absolute/private/service.dev.vars",
    "sourceDirectory": "/absolute/frozen/hypeproof-service",
    "sourceSha": "FULL_FROZEN_SERVICE_SHA",
    "bindingFile": "/absolute/private/service-launch.json",
    "bindingSha256": "STARTUP_RECEIPT_FILE_SHA256",
    "processSha256": "PID_START_AND_COMMAND_SHA256"
  },
  "guard": {
    "origin":"http://127.0.0.1:8790", "id":"GUARD_ID_FROM_METADATA",
    "serviceCredentialFile":"/absolute/private/service-guard.key",
    "controlKeyFile":"/absolute/private/control.key"
  },
  "syntheticInputs": true,
  "privateDiagnostics": true,
  "sdkBinary": {
    "version": "0.3.299",
    "path": "/Users/jaylee/Library/Application Support/HypeProof-Studio/sdk/0.3.299/claude",
    "sha256": "PINNED_BINARY_SHA256"
  },
  "skill": {
    "origin": "explicit-test-selection",
    "snapshotFile": "/absolute/pinned-public-frontend-design-snapshot.json",
    "storageRoot": "/absolute/new-host-managed-skill-copy",
    "expected": [{"revision":"FULL_PUBLIC_COMMIT_SHA", "digest":"MANIFEST_DIGEST"}]
  },
  "attempts": [
    {
      "runtime":"sdk", "scenario":"T07",
      "promptFile":"/absolute/public-frontend-task.txt", "promptSha256":"PROMPT_SHA256",
      "outputPaths":["index.html"], "expectedResponseContains":[]
    },
    {
      "runtime":"sdk", "scenario":"T10-T11",
      "promptFile":"/absolute/keyboard-image-task.txt", "promptSha256":"PROMPT_SHA256",
      "images":[{"path":"assets/keyboard.png", "sha256":"IMAGE_SHA256"}],
      "outputPaths":["design-brief.json","keyboard.html"], "briefPath":"design-brief.json"
    },
    {
      "runtime":"sdk", "scenario":"T10-T11", "previousReference":true,
      "promptFile":"/absolute/explicit-previous-image-revision.txt", "promptSha256":"PROMPT_SHA256",
      "outputPaths":["keyboard.html"]
    }
  ]
}
```

The selected skill snapshot must come from the existing public instruction import
path, not an invented manifest. In `explicit-test-selection` mode the actual
`ExternalInstructionSkillStore.save(snapshot,true)` stores a verified copy in a
new host directory, then `selected()` verifies it on every user turn. This is
explicit background test selection, **not** native QuickPick evidence. Alternatively
use `origin:"exported-workspace-state"`, `stateFile` containing the exact
workspaceState keys and `storageRoot` for its immutable copies. The exported
registry must bind to this exact disposable workspace; another workspace's state
is rejected. This mode is read-only and does not change Studio state.

Both runtime paths append the actual verified `selected().text` to the **current
user turn**, since the Service replaces client system prompts. The guard records
only hashes of those user-turn instruction blocks. T07 requires that the actual
selected block hash appears in a real guarded upstream call.

Initial image turns use the actual `readWorkspaceReferenceImages` capability
check (`profile.input.image_paste`) and current bytes. An explicit follow-up uses
`selectReferencedImagePaths(prompt, this activity's history)` and re-reads the
chosen file as fresh current-turn pixels. History contains text/host notes, not
replayed thumbnails. Image and selected-instruction hashes must match completed successful `/v1/messages` generation rows. A count_tokens-only row, failed request or cancelled stream cannot satisfy this check.
Proxy mode can request a text brief; it has no file tools and cannot claim that
an HTML file was created. Set `runtime:"proxy"`, `outputPaths:[]` and explicit
response checks for that slice.

SDK mode requires the actual served `coach_runtime:"agent-sdk"`; it does not
force that route for a proxy-only activity. The served profile is retained as a digest, then the adapter explicitly intersects it with a file-only host restriction: original read/write grants are preserved, shell/browser/subagents/web search/CR/publishing/orchestrator grants are removed. The actual source policy is resolved and asserted to contain only file tools before query. The restricted profile digest/tool list is recorded as a host seam, not claimed to be the unchanged production profile. The host approval callback can approve only Write/Edit/MultiEdit targeting
explicit allowlisted new output paths. It denies shell, browser, web research,
delegation and destructive actions; no browser/MCP/native host is supplied.
It never sets `bypassPermissions`, adds grants or changes `strictMcpConfig` or
`settingSources`. SDK config goes into temporary `APPDATA` for isolation; `HOME`
and user login files are untouched. Original input hashes are checked before and
after each attempt and are never approved for overwrite.

```bash
node e2e/feedback-live/run.mjs /absolute/run-config.json
# Delivery owner only, after the guard + actual Service route is reviewed:
node e2e/feedback-live/run.mjs /absolute/run-config.json --allow-live --arm-guard
```

At most three explicit candidate attempts run; the first failure stops the
sequence with no automatic retry. SDK/Service internal retries remain counted by
the same guard. Use SIGINT/SIGTERM for cancellation; the current SDK signal is
aborted and failure evidence is retained. A cancelled late completion is not a
success. New evidence never overwrites the previous `result.json` without keeping
a dated copy.

Results retain bounded hashes/counts/model/status/output paths, not credentials,
prompts, response prose or image bytes. Runtime console/stderr is hashed during
the call. Generated files remain in the disposable workspace for owner review.
The design brief can be checked against the actual source validator and current
capture hashes; declared text checks and transport success do not establish
keyboard identity/layout/motion, rendered 390/1280px quality, accessibility,
reduced motion or human acceptance. Those stay pending. The runner does not turn
text descriptions into fake completed files.

## Background-only verification

```bash
node --test e2e/feedback-live/guard.test.mjs
node --check e2e/feedback-live/guard.mjs
node --check e2e/feedback-live/run.mjs
```

Guard tests use an injected local fake upstream only, never a real provider.
Real runtime module bundle/import verification was also performed without
`query()`, binary launch, Service dispatch or native UI. Live SDK/proxy/provider
and scenario outcomes remain **NOT_RUN** until the delivery owner explicitly
invokes them.

For the owner-prepared setup, use the existing `service-launch.json` unchanged as `bindingFile`, pin its SHA-256 in `bindingSha256`, and compute `processSha256` from the controlled PID. The prepared setup currently uses dedicated local Service port 8788; 8787 is not the live test target. No production/native state is changed by this adapter.
