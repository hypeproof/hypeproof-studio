# Companion view owner/operation generation fencing

Date: 2026-10-28. Base: `85aba23912d0a2703417d7d90d91eca94ecdaef5`.
Scope: CompanionSessionView, focused render controls and this evidence only.
No controller, adapter, storage, cryptography, timer or authentication changes.

The red control reproduced an ordinary replacement race on the unchanged base:
an old owner's pending erase survived a controller replacement in the same mounted
view. Its pending/in-flight state still disabled the new owner's primary action,
whose label remained the old pending label. Resetting those flags alone would
allow the old promise's unguarded finally to unlock a new in-flight operation.
The primary action catch also checked only selection identity, allowing a late
old-owner error to annotate a replacement with the same selection.

The exported surface now assigns each controller object a private view-owner key
and renders its hook/ref state in that keyed owner scope. A replacement receives
fresh pending, in-flight, note, erase and retained-preview state immediately.
Previous cached content is unmounted and cannot transfer to that replacement.
The weak owner map holds only UI key numbers; it contains no data copies and is
not persisted or a host/session/crypto counter.

Within each owner, both primary and erase actions capture an operation token.
Catch/finally state changes require that token still be current and the owner
remain mounted. Unmount invalidates the operation generation. A late old resolve
or rejection therefore cannot set notes, paint erase state, clear busy state,
release another owner's concurrent-action guard or move its focus. The caller's
already-started operation remains caller-owned; the view does not cancel, delete,
close or undo it as a side effect of replacement.

Validation: PASS 116 focused local-forget React/ReactDOM assertions (44 existing
plus the replacement matrix), PASS 94 unchanged session presentation/render
assertions, PASS full webview TypeScript (`tsc --noEmit`, exit 0), and PASS
`git diff --check`. Matrix cases cover old erase and primary reconnect operations,
same/different selections, late resolution/rejection, new request/reconnect,
old-error suppression, retained-preview absence and new-operation guard release.
The red resource job `companion-view-owner-generation-red-20261028` failed before
the source repair; it was not relabelled as a passing check.

Final job `companion-view-owner-generation-final-20261028`, Node 22.22.1,
owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version 1, stage work,
workload local_heavy, wait-timeout 1800, timeout 1800:

```bash
node extensions/hypeproof-chat/scripts/run-tsx-tests.mjs companion-forget-view companion-session-view
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc --noEmit \
  -p extensions/hypeproof-chat/webview-ui/tsconfig.json
```

NOT RUN: actual storage/transport effects, browser layout, installed App/mobile,
physical device or production validation. Tests exercise real React/ReactDOM with
the repository's mini DOM and injected deferred callbacks. No GitHub or package
pin/publication operations were performed.
