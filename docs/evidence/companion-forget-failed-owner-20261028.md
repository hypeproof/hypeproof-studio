# Truthful local erase failure after owner disposal

Date: 2026-10-28. Base: `1e6077db72c0913e239cd64c0434f65d88a46d37`.
Scope: CompanionSessionView, its focused forget render test and this evidence.
No controller, adapter, checkpoint, cryptography or storage implementation changed.

The actual clearing owner can dispose its controller/relay before the local
storage removal promise settles. The previous view still showed `연결됨` when
that promise rejected; `계속 보기` could return its presentation to idle even
though the request/cipher owner was already terminal.

The view now enters a distinct local pending/failure state after the first erase
attempt. It stops showing a connected/plug state and removes request/reconnect
and confirmation-dismissal actions. A failed erase offers only explicit
`다시 지우기`, preserving the shared concurrent-action guard. A synchronous ref
also prevents stale event callbacks from reopening that owner. Confirmation can
still be dismissed before any erase attempt, without invoking the callback.

At the first attempt, the view retains one owner-bound snapshot of the existing
verified preview/selection. It keeps showing that exact result as
`이 기기에 남은 결과`, even if disposal clears subsequent selection/receipt
props. This is explicitly cached local content, not a live connection claim.
Retries preserve that snapshot; no new request is sent. Only confirmed callback
success clears it and shows the existing cleared state. A different controller
owner cannot inherit the retained content. No backend deletion, close operation,
remote cancel/revoke or additional timer is introduced by the view.

Failure still makes no deletion claim or raw-error disclosure. Retry receives
focus; existing native buttons, touch sizing and confirmation/status ARIA remain.
The callback remains responsible for actual safe erase retry and final success.

Validation: PASS 44 focused local-forget React/ReactDOM assertions and PASS 94
existing companion presentation/render assertions using the repository mini DOM.
Controls cover pre-attempt dismissal, pending/failed absence of connected claims,
no post-attempt Continue/request/reconnect path, exact cached result retention
through cleared parent props, explicit retry and successful final disappearance.
PASS full webview TypeScript (`tsc --noEmit`, exit 0) and `git diff --check`.

Final resource job `companion-forget-failed-owner-final-r2-20261028`, Node
22.22.1, owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version 1,
stage work, workload local_heavy, wait-timeout 1800, timeout 1800:

```bash
node extensions/hypeproof-chat/scripts/run-tsx-tests.mjs companion-forget-view companion-session-view
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc --noEmit \
  -p extensions/hypeproof-chat/webview-ui/tsconfig.json
```

NOT RUN by this UI slice: actual storage/transport cleanup, browser layout,
installed app, physical device, production or release acceptance. Root's frozen
actual runtime-core evidence remains separate. No GitHub/pin/publication changes.

The prior read-only registration plan is preserved outside repository source at
`/Users/jaylee/CodeWorkspace/artifacts/claude-mobile-bridge-rea-20261027/desktop-first-plan/dev-entry-registration-plan.md`.
