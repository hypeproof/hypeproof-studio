# Retryable local checkpoint erase with successor protection

Date: 2026-10-28. Base: `762846b7d4f151837941f135ec72dd68f894ae46`.
Scope: checkpoint module, focused checkpoint regressions and this evidence only.
No UI, controller, adapter, protocol, crypto or storage-backend changes.

## Reproduction

Against unchanged base source, a transient `storage.remove()` rejection stayed
cached in `forgetPromise`. Another `forget()` returned that rejected promise
without invoking removal again. The same rejected promise was also the shared
queue, so a successor's `load()` failed before reading real storage.
Resource job `companion-checkpoint-retry-repro-20261028` reproduced both defects:
the original 8 checkpoint tests passed and the 2 new regression controls failed.

## Resulting behaviour

The shared queue is now a settled ordering barrier, distinct from each operation's
observable promise. Save/remove errors still reject their returned promises;
future owners wait for completion and then read actual storage. No error becomes
a fabricated empty record or successful erase.

Each instance receives an in-process identity. A newer instance takes ownership
when it loads, saves or starts erasure, rather than merely being constructed.
Older instances cannot reclaim a successor's active identity. Erasure closes
writes and records its generation; a rejected erase releases only its failed
promise cache. That SAME owner may explicitly retry removal while its identity
and erase generation remain current. Concurrent retry gestures share one pending
attempt; success stays cached and idempotent. The retry resolves only after the
actual storage removal promise resolves.

If a successor has claimed or erased the namespace, a previously failed eraser's
retry rejects `companion_checkpoint_superseded` without calling removal. The
existing successful-erase counterexample remains protected: old forget succeeds,
successor writes B, repeated old forget returns its original success and cannot
erase B. A never-owning/superseded first erase retains the prior terminal no-op
behaviour and cannot touch another lifecycle. Already queued writes remain ordered
before erase, and terminal owners cannot queue replacement writes afterward.

Coordination remains local to instances sharing the same storage adapter object
in one process. Identities/generations are not persisted, account authority,
keys or cross-process locks. The checkpoint JSON schema, TTL, size bounds and
same-live-transport reattachment requirements are unchanged.

## Executed checks

PASS 10 checkpoint tests (original 8 plus 2 regressions), PASS 7 unchanged
controller tests: 17/17 total. New controls verify deferred observable removal,
retry coalescing, retained bytes on failure, successor load after predecessor
failure and preservation of successor bytes when a stale failed owner retries.
The prior pending-write/erase and successful-old-owner/B counterexamples remain
unchanged and pass. PASS full webview TypeScript and `git diff --check`.

Node 22.22.1, shared resource owner
`codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version 1, stage work,
workload local_heavy, wait-timeout 1800, timeout 1800:

```bash
# job companion-checkpoint-retry-focused-20261028
node --experimental-strip-types --test \
  extensions/hypeproof-chat/test/companion-session-checkpoint.smoke.mjs \
  extensions/hypeproof-chat/test/companion-session-controller.smoke.mjs
# job companion-checkpoint-retry-webview-ts-20261028
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc --noEmit \
  -p extensions/hypeproof-chat/webview-ui/tsconfig.json
```

NOT RUN: actual persistent storage backend, Worker, browser/mobile or production
validation. This is a local lifecycle ordering/error fix; the existing actual
Worker evidence is separate. No fetch, push, GitHub or publishing operations.
