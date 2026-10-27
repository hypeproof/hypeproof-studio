# Companion session request budget — local source evidence

Date: 2026-10-28. Scope: partial DMC-03/04 integration support.
Base: `94aa2490c327e44fcfe68071b9fc47474d51e7f4`.

`CompanionTransportBudget` is a browser-safe caller-owned scheduler for one
already authenticated session in one process. The caller must share the SAME
instance across pairing, status and relay adapters. Its local default is 50
admissions per rolling 60,000 ms; `maxRequests` may lower this to 1–50. The
integration task reports the existing Service companion account rate as 60
requests/session/minute. No server limit, validation or cryptography is changed.
The server remains authoritative; other processes, devices, preexisting traffic,
server clock differences and requests outside this scheduler are not coordinated.

`run<T>(operation, signal?)` reserves a slot before invoking the supplied operation.
FIFO admission does not wait for earlier network operations to complete. Failed
operations consume the reservation, and each admitted operation is invoked once.
No HTTP request is retried. At most 32 calls may wait for admission; overload
rejects immediately. A queued call expires at 65,000 ms according to the injected
monotonic clock, and cannot invoke its operation after that deadline. As with
browser timers generally, a suspended process may observe/reject expiry only
when execution resumes. `AbortSignal` and `dispose()` remove/reject queued work
and cancel an outstanding scheduling sleep. Admitted operations own cancellation
of their actual effects. Disposal rejects future submissions. No credentials,
URLs, transport, polling, recurring timer or durable store is included; timers
exist only while submitted work waits for capacity.

The constructor optionally accepts monotonic `now()` and abortable
`sleep(milliseconds, signal)` ports. A single pump owns mutable admission/queue
tracking. Its rejection handler settles held callers if an injected clock/sleep
fails, avoiding an unhandled internal pump rejection. Callers must still handle
their returned `run()` promises, including overload/cancellation rejections.

Validation: PASS 5/5 focused Node 22.22.1 tests using an entirely fake monotonic
clock and abortable sleep; no elapsed wall-clock assertions. Coverage includes
50 immediate admissions followed by rolling-window wait/resume, lower configured
budget, FIFO and overlapping network completion, cancellation with zero queued
operation invocation, queue overload, exact 65-second expiry, dispose, operation
failure without retry, and scheduling-sleep failure without an unhandled pump
rejection. The existing module-type warning is non-fatal.

Focused command (shared resource wrapper, job
`companion-transport-budget-focused-r2-20261028`):

```bash
/Users/jaylee/.nvm/versions/node/v22.22.1/bin/node --experimental-strip-types --test \
  extensions/hypeproof-chat/test/companion-transport-budget.smoke.mjs
```

PASS: full extension TypeScript (`tsc --noEmit`, exit 0).

Full extension TypeScript command (same wrapper, job
`companion-transport-budget-full-ts-20261028`):

```bash
/Users/jaylee/.nvm/versions/node/v22.22.1/bin/node \
  extensions/hypeproof-chat/node_modules/typescript/bin/tsc \
  --noEmit -p extensions/hypeproof-chat/tsconfig.json
```

All suites use owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version 1,
stage work, workload local_heavy, wait-timeout 1800 and timeout 1800.
NOT RUN: adapter integration, actual Service requests, browser UI, installed app,
mobile device or production validation. This helper does not establish full
DMC acceptance. No existing consumer, semantic receiver, server state, GitHub
record or production resource was changed.
