# Activated DEV host request pacing

Base: `bcdbfaea589255a4059482ab4eb54b6774208eab`. This source fix changes only
the actual native entry's shared session budget construction to
`new CompanionTransportBudget({ minSpacingMs: 1200 })`. The default50/min rolling
limit,65s queue wait,32 queued bound, Service60/session/min authority,59s immutable
ciphertext expiry, crypto and HTTP validation remain unchanged. Closing an owner
continues to retain its session budget; a different session replaces it.

The read-only author review found the activated entry still used zero-spacing
burst admission, while prior integration adapters and the APK explicitly used
1200ms. A host part is prepared before fresh authority/status and scheduled send.
Reaching the rolling request ceiling can otherwise delay an already prepared
part close to a minute and let its fixed expiry elapse. This is a source-derived
functional hazard, not a reproduced17KiB runtime failure. Root's frozen run1
stopped at a harness routing boundary before pairing; this fix does not relabel
that historical result or alter its inputs.

## Retained regression and focused verification

The new focused test executes the registered native command into the real DEV
entry, owner, preparation, journal lease and authenticated transport. It uses
fixture-owned native UI/account/client/HTTP ports. The unchanged actual scheduler
class is injected with fake monotonic now/sleep and disposal observation; it does
not replace its admission algorithm or sleep for60 wall-clock seconds.

- RED on the unmodified bcdb entry: first explicit invitation's actual HTTP
  admission times were `[0,0,0]`, expected `[0,1200,2400]`; process exit1.
- GREEN after the single constructor option: first invitation admitted at
  `[0,1200,2400]`; after owner invalidation/recreation, the SAME session budget
  admitted at `[3600,4800,6000]`, with exactly one budget instance and no disposal
  of that session budget. It retained both its identity and last admission.
- A distinct authenticated session disposed the previous session budget and
  admitted its own sequence `[6000,7200,8400]`. Total9 HTTP requests, including
  exactly one initial identity HTTP for each explicit owner; no retry, implicit
  cipher or profile operation was invoked.

Node v22.22.1, shared resource owner
`codex:01a12522-7c7d-70c2-b09a-353dad5e2280`. Commands used unique jobs
`companion-dev-entry-pacing-red-receipt-20261028` and
`companion-dev-entry-pacing-green-20261028`, version1, work/local_heavy,
1800-second wait/timeout:

```sh
~/.local/bin/hype-resource run --owner codex:01a12522-7c7d-70c2-b09a-353dad5e2280 --job companion-dev-entry-pacing-green-20261028 --version 1 --stage work --workload local_heavy --wait-timeout 1800 --timeout 1800 -- /Users/jaylee/.nvm/versions/node/v22.22.1/bin/node --experimental-strip-types --test extensions/hypeproof-chat/test/companion-dev-host-pacing.smoke.mjs
```

Retained private evidence:
`/Users/jaylee/CodeWorkspace/artifacts/companion-dev-host-pacing-20261028/`
contains `red.log`, `green.log`, and `results.json`.

## Budget and acceptance boundaries

CompanionDevHostCommands constructs no budget and delegates to this same owner.
CompanionDevHostOwner admits each protocol HTTP using the supplied entry budget.
The APK has a distinct device session budget already configured at1200ms and its
documented pre/post-adapter admission handoff. No second native rate admission or
HTTP retry is added. Existing account/profile authority HTTP retains its separate
owner; this does not claim every account request is companion-budgeted.

No aggregate/current-run source, APK bytes, server policy or canonical mapping was
edited. The earlier scheduler/entry/full TypeScript evidence is reused; no
unchanged full suite was repeated for this one typed option. Actual product
activation + Android APK17KiB transfer, native lifecycle/isolation and physical
device acceptance require the captain's separate revision-bound run. Pacing is
not a promise that every network/approval delay fits a ciphertext TTL.
