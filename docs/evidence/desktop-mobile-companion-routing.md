# Desktop-first companion routing evidence

Date: 2026-10-27. Scope: Studio #3069 (DMC-0), not the parent #2803 outcome.
Base: `4ff05dba5c202621b64ba95c4f69743e36069a93`.
Environment: macOS arm64, Node 22.22.1. Inputs are synthetic and contain no customer data.

## Observed

- Four focused Node test groups passed with no skips: three route classes,
  offline/unknown host and expired-network-auth behavior, scope/revocation/version
  rejection, and malformed/unknown input rejection.
- Strict standalone TypeScript check passed.
- Six scenarios ran through the actual helper; no network, filesystem mutation,
  model call, build or tool execution was invoked by the scenario driver.
- Documentation contract scored 100/100. Scoped requirement-link and work-selection
  checks passed with no ledger gaps/broken links/warnings. This is an offline
  integrity verdict, not availability or product acceptance.
- Independent read-only verifier found no must-fix defect and repeated the four
  tests through the shared resource queue. Ten changed-source hashes were unchanged
  before/after that verification.

The helper always returns `executionAuthorized: false`. It advises navigation and
status; future real adapters must enforce actor/device/scope/grants and versioned
approval themselves. Cached local interaction under expired network authentication
still depends on the adapter's existing local-access policy.

## Reproduction

Use the shared resource wrapper around each test/typecheck when running locally.

```sh
node --experimental-strip-types --test extensions/hypeproof-chat/test/companion-routing.smoke.mjs
node --experimental-strip-types scripts/companion-routing-demo.mjs
tsc --strict --noEmit --target ES2022 --module nodenext --moduleResolution nodenext extensions/hypeproof-chat/src/companionRouting.ts
python3 scripts/docs-harness/check.py --min-score 95
```

The author's private validation manifest records commands, logs and per-file
SHA256 bindings. The independent report records its own hashes and controls.

## Not run / not implemented by this slice

Real device pairing, Service relay, encrypted transport/key lifecycle, durable host
execution/outbox integration, native Android/iOS UI, classroom capacity/pilot,
adult external-effect automation and production activation. No complete DMC
requirement or parent Epic is accepted from these checks. No framework, production
retention policy, new spending or live permission change is approved here.

## Local dispatcher seam (DMC-3 partial, 2026-10-27)

`companionHostDispatch.ts` implements a host adapter over the existing
`CommandRunner`/`JournalStore` receipt journal and `fileAttachment` read gates.
It accepts only exact bounded request bytes identifying an already selected
artifact; a request cannot supply a file path, URL, tool or command. Before
acceptance, the real selected-file adapter checks metadata/readability and rejects
path/symlink escape without reading content bytes. Byte/version verification occurs
only after durable acceptance and running receipts. Current actor/device/host/workspace/project/task, epoch, source and artifact
versions, consent and resolved profile must match. Runtime execution authority is
an independent current adapter input. Pairing preview `/2` always supplies false
and can never authorize this dispatcher. A permitted `sdk_tools.read` profile
alone also does not authorize a remote caller.

Only `preview.read` reads the selected text artifact through existing profile,
folder and canonical file boundaries. `desktop.continue` returns a continuation
instruction without opening a desktop surface or executing work. Write, model,
shell, external delivery and unrecognized operations are refused. Host-offline
requests wait without being accepted; no cloud path exists.

The existing journal persists exact request bytes before accepting/running and
persists the exact bounded read result with the terminal receipt. Identical
retries reuse that result only after current authority checks; a request ID with
different bytes is refused. Recovered `running` work becomes outcome-unknown,
never automatically re-executed. A failed durable write blocks that dispatcher
instance until a fresh instance inspects the journal. Capacity is bounded at 200
entries without automatically deleting prior receipts. The composition must own
one runner per account/activity journal, keep it outside the shared workspace,
return null only for an absent journal and throw on unreadable/corrupt data. This
slice does not introduce a second auth or activity store.

Focused source validation: `extensions/hypeproof-chat/test/companion-host-dispatch.smoke.mjs`.
Real temporary files and a disk-backed injected existing journal exercise reads,
denials, result recovery and fault boundaries. This is source-level synthetic
adapter evidence. Service transport, resolved production session integration,
mobile client, installed host/mobile, actual quiz revision and the complete
DMC-3 acceptance remain NOT RUN. No relay or preview pairing grants execution.

The normalized runtime authority must name the exact requested capability as
well as supply current execution authorization. A preview-read authority does
not permit desktop continuation. This is an adapter view of existing policy,
not a new grant mechanism; no caller-supplied pairing capability is accepted.

Validation on 2026-10-27, Darwin arm64 / Node 22.22.1:

- PASS: new dispatcher scenarios plus existing classroom command runner,
  file-attachment and companion-routing source checks (`node --experimental-strip-types
  --test --test-concurrency=1 ...`): 13 test results, zero failures.
- PASS: full extension TypeScript `tsc --noEmit -p
  extensions/hypeproof-chat/tsconfig.json`, using the existing prepared DMC-1
  worktree's dependency installation through a read-only local symlink.
- Both commands ran through `hype-resource`, final job
  `dmc3-capability-final-check`; no dependency download or hosted AI was used.
- NOT RUN: Service relay integration, installed host/mobile, runtime auth
  integration and quiz modification. No production activation occurred.

Independent review repairs (2026-10-27): metadata/readability preflight now shares
`fileAttachment`'s canonical selected-file gates without reading content. The
executor performs exactly one content read after durable accepted/running state;
a failed initial acceptance save performs zero reads. A changed content digest
is detected by that journaled read and returns a failed version-check receipt.
Retries continue to reuse the exact persisted result without rereading content.
Recovery and response release reject all output on continuation/non-success
entries. Successful preview results require the exact bounded id/version/text
shape and matching text digest; continuation success requires its own result code
and never includes an artifact. These correct independent findings DMC3-R1/R2;
they do not add runtime transport or device acceptance.

Repair validation PASS: the focused dispatcher/privacy, command-runner,
file-attachment and routing checks report 15 results and zero failures, followed
by full extension `tsc --noEmit`. Both ran with Node 22.22.1 through
`hype-resource` job `dmc3-dispatch-review-repair-final` (ticket
`565d0fbc30ab447aa5287bcf9d286935`). No host/Service/mobile acceptance was added.
