# Optional local viewing-record clear action

Date: 2026-10-28. Base: `f8ee7d7cf5e15932a34f703a4aa53644ddd719fa`.
Scope: presentation contract, view, existing CSS tokens and React interaction tests.
Adapter, controller and checkpoint implementations are unchanged.

The view displays `이 기기의 보기 기록 지우기` only when its caller explicitly
supplies `controller.forget(): Promise<void>`. This opt-in callback must resolve
only after local cache, receipt and transport-ledger clearing, and be safe to
retry after rejection. The view does not implement storage deletion, revoke
remote access, cancel computer work or delete originals.

The inline confirmation says computer originals remain and already approved
computer work is not undone. `계속 보기` dismisses only this local confirmation.
The existing in-flight guard now covers both view/status operations and clearing;
rapid confirmations start one callback and all controls remain disabled while it
is pending. No clear success is shown before the callback resolves. Successful
completion unmounts the preview, hides old actions/version details and presents a
separate `local_cleared` state. That terminal state persists for the same
controller owner despite late selection/receipt props; a fresh owner is required
to resume viewing. This also works when the cleanup owner clears its selection
before its final erase promise settles.

Rejection displays an honest confirmation-failed message and `다시 지우기`, with
no deletion claim or raw exception detail. The caller remains responsible for
safe, idempotent retry and composing the actual local erase/adapter disposal.
A raw controller method that does not clear all promised local state must not be
opted into this view action.

Native buttons reuse the existing 48px CTA token, focus ring and touch behaviour.
The inline group references its visible heading and description with ARIA. Focus
moves to `계속 보기` on confirmation, returns to the entry on dismissal, and moves
to the live status after successful clearing. Failures use an alert. No modal,
new icon system or automatic action on mount was introduced.

Validation: PASS 34 new React/ReactDOM interaction assertions and PASS 90 existing
session presentation/render assertions in the repository's mini DOM. These cover
opt-in absence, explicit confirmation, dismissal/focus, deferred success, rapid
repeat gestures, truthful failure/retry, cleared selection, stale props and
concurrent action guards. PASS full webview TypeScript (`tsc --noEmit`, exit 0)
and `git diff --check`.

Final job `companion-forget-view-final-20261028` used Node 22.22.1 through the
shared resource wrapper, owner `codex:01a12522-7c7d-70c2-b09a-353dad5e2280`,
version 1, stage work, workload local_heavy, wait-timeout 1800, timeout 1800:

```bash
node extensions/hypeproof-chat/scripts/run-tsx-tests.mjs companion-forget-view companion-session-view
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc --noEmit \
  -p extensions/hypeproof-chat/webview-ui/tsconfig.json
```

Initial validation used a stale ignored dependency symlink; only this isolated
worktree's link was corrected to an existing prepared webview dependency tree.
No dependency installation or shared dependency mutation was performed.
NOT RUN here: actual local-storage/transport-ledger deletion, browser layout,
screen-reader/device acceptance, remote cancellation/revocation, production or
release validation. Root composition supplies the real clearing callback.
