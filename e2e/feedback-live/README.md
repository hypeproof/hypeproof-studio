# Background live runtime acceptance adapter

Default mode activates no app, browser, native window or CLI UI. The explicit
render-feedback opt-in below launches only owned headless Chromium.
`run.mjs` invokes the actual `runSdkCoach` or `proxyChat` entrypoint, the real
Agent SDK **0.3.299**, and the explicitly pinned seeded binary. The VS Code host import is stubbed and a restrictive profile intersection is recorded (file-only by default). There is no fake SDK/query/binary-resolution seam, no
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


## Explicit owned render-feedback opt-in (new budget required)

The exhausted prior visual activities cannot be reused. This prepares a future
run; construction, controls and config-only checks do not authorize paid calls.
A new user-approved independent activity needs a fresh DISARMED guard/ledger,
workspace and exact Service startup receipt under the existing contracts above.
Do not reset/restart a guard for the same activity or automatically advance to
another repetition. Each activity keeps12 total upstream dispatches, including
aux/count_tokens/retries, output4096/retry0 and at most3 explicit candidate query
claims. The model's tool loop can exhaust12 before all3 candidates exist.

Add to the runner config, and add the identical `renderRepetitionId` to the
existing guard config before its first startup:

```json
"renderFeedback": {
  "enabled": true,
  "mode": "owned-headless",
  "widths": [390, 1280],
  "maxScreenshots": 6,
  "repetitionId": "hps-render-20261016-r1-0123456789abcdef0123456789abcdef",
  "browserDependencyRoot": "/absolute/studio/e2e"
}
```

Config and `--allow-render-feedback` are both required. The served profile must
already grant browser; shell/web/agents/CR/publishing remain removed. Actual
`canUseTool` remains unchanged. Browser open is restricted by this owned host to
its own loopback origin; renderer requests to other origins are refused.

The host compiles actual BrowserControl/MCP/static-server helpers separately;
the existing six pinned App runtime bundles remain byte-identical. It serves
production `/__hp_viewport` with its actual390/1280 controls. The model receives
the exact owned wrapper URL in a marked user-context block, then uses existing
browser_open/read/click/screenshot/live_preview_start tools. It can inspect and
correct generated output within the same cap; after an edit, live_preview_start
reloads the owned wrapper. No screenshot tool_result is synthesized. No new MCP
tool or external browser dependency is introduced; existing Playwright supplies
owned Chromium's executable, while production raw CDP/AX/Input/capture executes.

The6 candidate screenshot attempts apply across the activity, including later
runner invocations. Before each host screenshot, an authenticated control request
to `/__feedback/render-screenshot` synchronously persists the attempt in the
guard-owned ledger, then acknowledges permission to capture. A failed capture,
runtime abort or absent next provider request never refunds it. Unknown reservation
outcome stops without capture or retry. The host resumes the actual guard counter;
model tool-ID/image hashes remain separate transport diagnostics, never budget
accounting. Missing counter/repetition mismatch refuses;
with fewer than2 captures left, preflight stops before dispatch. Reference image
and selected-instruction delivery are unchanged. Completed candidate validation
requires actual wrapper frame390/1280 captures and each capture hash in a guarded
upstream tool_result image block. This is delivery proof, never semantic PASS.
Freeze the candidate, judge actual same-state pixels independently and only then
prepare one targeted correction. Preserve previous inputs/results and stop on
permission failure, exhausted budget, repeated failure or a different root fault.

```bash
# Offline source/config review: no credentials read, Service/guard contact or browser.
node e2e/feedback-live/run.mjs /absolute/draft-run.json --allow-render-feedback --config-only
# After new user budget approval AND fresh bindings, ordinary nonbillable preflight:
node e2e/feedback-live/run.mjs /absolute/final-run.json --allow-render-feedback
# Sole delivery owner only, after successful reviewed preflight:
node e2e/feedback-live/run.mjs /absolute/final-run.json --allow-render-feedback --allow-live --arm-guard
```

The config-only status is `CONFIG_ONLY_NOT_RUNTIME_PREFLIGHT`; missing future
bindings are still BLOCKED. No paid execution occurred while preparing this
option. T11/T13 semantic judgments and T29 missing-original gate are unchanged.

Guard reservation controls require the existing private control key plus exact
guard/activity/repetition identities and a strict small JSON body. They do not
arm the provider path. Setup/capture failures close owned CDP, Chromium and HTTP
resources; cleanup receipts remain explicit, and failed cleanup fails the runner.

### Opt-in missing-width completion (candidate evidence only)

Completion is off by default. It additionally requires runner config
`"renderCompletion":{"enabled":true,"mode":"missing-width-only"}`,
`--allow-render-completion`, and a **new** render guard configured with
`"renderCompletion":true`. The runner refuses nonzero initial dispatch,
claim, or screenshot counters. This is not a way to reopen R1/R2 or reset a
budget. Existing explicit render config/flag, current Service/PID/source
binding, owner arm, and original activity authority still apply.

After a successful SDK `end_turn`, the runner checks original inputs, declared
outputs/brief, source-bound captures and actual upstream image delivery. Only
missing 390/1280 evidence permits a factual continuation. It uses the UUID
observed from the real SDK init event via `options.resume`, in the same isolated
SDK directory, activity, browser host and original deadline. Candidate outputs
are copied once to evidence and must remain byte-identical. Continuations
remove write tools and do not resend an invented text history. At most two
additional existing candidate claims are permitted; total limits stay 12
upstream requests, 3 claims, 6 screenshot reservations and 4096 output tokens.
Only current refs bound to the two actual outer wrapper width buttons receive
click approval. Other click/type actions retain the normal denial boundary.

Captures retain their own source revision. The owned host records exact candidate
HTML bytes and the exact HTTP response after production live-reload injection as
separate hashes and immutable files under `private/render-revisions/`. It checks
the production injection mapping and binds the response's load ID and hashes to
the current direct iframe's observed CDP frame/loader identity. Unknown, cached,
changed or mismatched response provenance stops the run. A navigation alone never
writes a snapshot: at most six charged captures retain at most twelve snapshot
files. The owner evidence directory and private subdirectories must be regular
and private; snapshots are created exclusively, never overwritten, and all image
and snapshot bytes are reverified with link/tamper rejection before completion.

Every historical capture remains recorded, delivered and charged. Only captures
whose verified candidate-source hash equals the frozen final HTML hash satisfy
390/1280 completeness. A valid historical revision is neither discarded nor
counted as final evidence; unknown/missing/tampered historical snapshots still
stop the run. The frozen output check also remains enforced on every same-session
evidence-only continuation. Exclude the entire `private/` subtree from sanitized
artifact/GitHub exports; hash metadata is not permission to publish HTML contents.


Tool errors, policy denial, runtime/validation failure and cancellation stop
completion. The SDK hook/abort/close alone is **not** an admission guarantee:
our preserved provider-free Read-error control reached 12 requests despite a
failure hook. The completion guard therefore inspects the full actual request
history before reservation, latches on tool-result errors or malformed/unknown
history, and accepts an authenticated exact-activity one-way hold from the
host. HTTP/transport failures and cancellation also hold admission. Held guards
cannot rearm, reserve, refund or resume; their local 423 rejections are counted
separately from actual upstream forwards. Already admitted concurrent work is
not retroactively described as undispatched. The guard does not interpret
error text as an exemption or grant.

Provider-free controls (no native UI or external provider):

```sh
node --test e2e/feedback-live/{guard,render-host,render-completion}.test.mjs
HPS_SERVICE_SOURCE=/absolute/clean/service HPS_SERVICE_SHA=EXACT_SERVICE_SHA \
  node e2e/feedback-native/render-completion-probe.mjs /new/evidence/directory /absolute/installed/claude
```

The probe uses the real installed SDK, actual Hono/SQLite Service, durable guard
and actual BrowserControl/CDP against scripted loopback SSE. Its positive case
forwards seven synthetic upstream requests over two SDK calls sharing one
session, with actual prior image history and both widths. Error controls check
that denied/error results produce no additional upstream forward; any local
held-request attempts remain separately visible. This proves transport and
bounded continuation behavior, not generated visual quality, native UI,
production billing or permission to start another live activity. Real execution
requires independent review of the exact new source/config binding first.

The full CLI control additionally requires a clean committed Studio revision.
It obtains a real synthetic activity, consumes the synthetic route env before
Service startup, and passes the observed PID/env receipt to the unchanged CLI.
The SDK writes both candidate files, then completes both viewport captures in
the same session. It expects nine scripted forwards, two claims and two captures;
no candidate output is preseeded. All existing admission and source checks apply.

```sh
node e2e/feedback-native/render-completion-cli-probe.mjs \
  /new/cli-proof/evidence /absolute/installed/claude EXACT_STUDIO_SHA \
  /absolute/clean/service EXACT_SERVICE_SHA --execute
```

Without `--execute` it writes preparation metadata only. This control uses fresh
isolated processes and headless browsers; it does not use an existing live
activity or prove generated visual quality.


The same full CLI fixture has two explicit revision controls (prepare by default;
execute only after exact-source review/commit): append
`--revision-case=edit-complete` or `--revision-case=edit-missing` to the invocation
above. Both require actual SDK Write of a first candidate, a historical390 capture,
an SDK edit, reload and final390/1280 captures. The complete case expects11 scripted
forwards, one claim and three captures. The missing-final1280 case expects12
forwards, two claims and three captures; its continuation observes the same SDK
UUID and has no Write tool. No historical capture is refunded. These fixtures do
not authorize any live provider run or resume a historical failed activity.

Captured source version counts and SHA IDs are reported separately from SDK candidate claims. Claims count SDK queries/continuations, not individual Write/Edit calls. The host flags more than three distinct captured versions for approval review without changing guard admission; uncaptured versions remain `UNKNOWN`. This report grants no paid budget or approval. A candidate response binding mismatch immediately invokes the fatal abort/hold callback, rejects further owned host operations, and remains a cleanup failure if that callback fails.
