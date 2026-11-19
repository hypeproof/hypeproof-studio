# Release completion recovery

Owner: Jay. Authorized incident recovery: 2026-11-19, Studio #3459.

`release-promote.yml` may re-evaluate an open release PR after successful
`studio-pr-ci` or `Verify and publish Unified Studio` completion in this repository.
It runs trusted default-branch code, never code or artifacts downloaded from the
triggering PR. A CI event must match the current release PR head and branch;
an acceptance event must match its candidate parent. Ambiguous candidates stop.

Completion supplies no approval. The existing current-head publication gate,
release blockers, immutable package checks and final publication gates remain
mandatory. Manual, completion-driven and release-auto promotions share one concurrency group.
This does not authorize a new build, change access or weaken merge policy.
