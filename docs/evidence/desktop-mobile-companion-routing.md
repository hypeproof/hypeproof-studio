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
