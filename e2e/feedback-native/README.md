# Feedback native candidate acceptance slice

This runner operates the prepared desktop shell on macOS or Windows. It reuses the
existing classroom harness's OOPIF/CDP discovery, but sends native CDP keyboard and
mouse input instead of DOM events, a host command bridge, injected messages or
seeded token/history files. Foreground input is disabled by default. `--allow-foreground` requires an explicit dedicated UI slot; prefer a hosted runner. It never activates another app or uses AppleScript/System Events. It can attach without process ownership, or launch
and stop only its generated isolated profile. It never submits a chat turn or
an image edit.

Use Node 24 (built-in WebSocket, TypeScript stripping, loader hooks and SQLite), a
prepared app from `scripts/studio-dev.py`, an explicit Service manifest and private
credential files. No full desktop shell build, installed-app modification, `HOME`
replacement, shell tool permission change or provider key is required.

## Existing candidate, actual local Service

The delivery owner prepares the app and starts the actual local Service. Create a
private Service manifest outside the checkout:

```json
{
  "schema": "hps-feedback-service/1",
  "origin": "http://127.0.0.1:8787",
  "source": {"repository": "hypeproof/hypeproof-service", "sha": "FULL_SHA"},
  "runtime": "actual wrangler; isolated D1",
  "evidence_level": "actual-local-wrangler-not-production",
  "provider": "configured by owner; runner sends no model requests",
  "token_a_file": "/absolute/private/token-file"
}
```

Credentials are read only from the explicit file, never printed or persisted in
results. Parent-provided provenance is labelled as such; preflight independently
checks the authenticated `/v1/profile` response. Do not claim that this metadata
request proves a provider dispatch or production deployment.

Set these two keys in the **isolated candidate** `User/settings.json`, then reload:

```json
{"window.dialogStyle":"custom", "files.simpleDialog.enable":true}
```

OS-native dialogs are outside CDP. Without these settings the folder/save slices
report `BLOCKED`; the runner does not replace them with direct file mutations.
The profile proxy must explicitly match the manifest's loopback origin plus `/v1`.
The workbench command language is English by default; set config `reloadTitle` if
the visible built-in Reload Window command uses another language.

```bash
export HPS_FEEDBACK_CDP=http://127.0.0.1:9777
node e2e/feedback-native/prepare-config.mjs /absolute/state/receipt.json /absolute/private/service.json /absolute/evidence --attach
node e2e/feedback-native/run.mjs /absolute/evidence/config.json --preflight
node e2e/feedback-native/run.mjs /absolute/evidence/config.json --allow-foreground
```

`prepare-config` creates a unique B work folder; attach uses the preparation
state's existing `workspace` and `user-data`. It never modifies attach settings,
starts, stops or kills the attached app. Use an isolated acceptance workspace,
not a learner's live work: the suite deliberately replaces an unsent draft with a
unique marker, creates one new text file and changes selected external skills.
It preserves originals and never sends the marker. Re-create config after each
source commit/reinjection; stale source SHAs, dirty extension source and bundle
mismatch fail before native interaction. The original preparation receipt lacks
a source SHA, so results state that limitation and record clean checkout HEAD,
matching preparation stage, injected bytes and receipt hash separately.

## Portable Windows or Mac prepared copy, deterministic metadata Service

This mode uses actual Service source/token/profile/activity/router code with its
existing SQLite/KV harness adapters. Cohort/session/roster/users are **synthetic**,
provider keys are removed and outbound provider network is rejected. It is not a
production profile, model or installed-app proof. Keep the Service directory
outside the evidence upload, because it contains private token files.

```bash
HPS_SERVICE_SOURCE=/absolute/hypeproof-service HPS_SERVICE_SHA=FULL_SHA node --experimental-strip-types --experimental-sqlite e2e/feedback-native/service.mjs /absolute/new-private-service-dir
```

On PowerShell set `$env:HPS_SERVICE_SOURCE` and `$env:HPS_SERVICE_SHA` first, then use the same Node command.
Read the returned loopback origin and use it when preparing the copied shell:

```bash
python scripts/studio-dev.py prepare --base-app /absolute/released-app --state-dir /absolute/new-candidate-state --provider service --service local
node e2e/feedback-native/prepare-config.mjs /absolute/new-candidate-state/receipt.json /absolute/new-private-service-dir/service.json /absolute/new-evidence
node e2e/feedback-native/run.mjs /absolute/new-evidence/config.json --allow-foreground
```

On Windows `--base-app` points to the directory containing the extracted official
portable `HypeProof Studio.exe`; macOS uses the `.app`. Download/extract a chosen
release through the existing release process and retain its checksum evidence;
this runner does not fabricate release provenance from a prepared copy. The
preparation only builds/injects the extension and webview, using the released
shell. Generated profile settings point to the manifest's actual port.

An owned launch sets only `HPS_TEST_E2E=1` plus `HPS_TEST_REAL_WORKSPACE=1`. The
first suppresses analytics; the second explicitly uses the real production
`ensureWorkspace` route. Token/history/profile/coach backdoors are refused, and
real folder reload target changes are asserted. Results identify these flags;
do not combine this proof with a flag-absent actual-candidate observation. A
configured `inmemory` SecretStorage does not prove process-restart persistence.

## Covered and outstanding evidence

| Slice | Native check | Scope limit |
|---|---|---|
| T01/T02 | Files command, native Explorer, user's hidden sidebar across chat/reload, native new-file save and Explorer row | Initial first-launch default is an owner observation; no overwrites |
| T03/T04 | Native folder picker cancel, same activity B reload, no code reentry, draft carry, native File Open Folder back to A, A draft wins | No history is invented from an empty conversation |
| T03/T04/T05/T06 remainder | Explicit `NOT_RUN` | Independent-activity collision, persisted model history, multiwindow, process restart and streaming need additional real turns/credentials |
| T07 | Runtime skill command, public pinned import, visible revision/license/capability preview before explicit select, stored preview, disable | Import uses public GitHub; selected instructions reaching a provider and offline transport isolation remain `NOT_RUN` |
| T08/T09 | Source regressions elsewhere | Native update/revert/tamper tests not substituted by helper assertions |
| T16 capability subset | Actual native command registration and disabled-profile notification | No image is selected, uploaded or charged; enabled profile reports `BLOCKED` instead of attempting a paid request |

`result.json` distinguishes `PASS`, `FAIL`, `BLOCKED` and `NOT_RUN` per slice.
`PASS_SELECTED_SLICE` is execution success for the selected deterministic checks;
overall acceptance remains `PARTIAL`. Screenshots and hashes are supporting
candidate evidence, not release, production, human usability or quality acceptance.
A bounded local native attempt observed chat entry, then was interrupted at user
request because foreground changes were disruptive. No further local foreground
testing is authorized. Completed results are retained separately; remaining native
slices are pending a hosted/dedicated runner. Default invocation now performs only
read-only preflight, even when a config requests native scenarios.

```bash
node --test e2e/feedback-native/*.test.mjs
HPS_SERVICE_SOURCE=/absolute/hypeproof-service HPS_SERVICE_SHA=FULL_SHA node --experimental-strip-types --experimental-sqlite e2e/feedback-native/service.mjs /absolute/new-probe-dir --probe
```

The first command tests endpoint/path isolation, credential redaction, backdoor
refusal, receipt/build/hash/source guards. The second executes actual Service
source auth/profile/activity reads for two synthetic users without any desktop or
provider call. Neither is reported as a native UI pass.

The optional `feedback-candidate.yml` workflow is dispatch-only and has read-only GitHub permissions. It requires `HYPEPROOF_READ_TOKEN` for pinned private Service packages/source, the exact `config/service-deployment.json` Service SHA and published official shell assets. It confines explicit native foreground input to hosted Mac/Windows desktops. The workflow and hosted native slices are NOT_RUN until dispatched; missing credentials, download hashes or a usable desktop remain explicit blockers.

Service provenance is explicit: `service.mjs` refuses an unspecified or mismatched `HPS_SERVICE_SHA`. Hosted checkout derives that SHA from `config/service-deployment.json`; a dispatch assertion must match it. A probe of another explicitly named checkout is only that checkout's synthetic metadata result and cannot stand in for reviewed candidate or deployed Service evidence.
