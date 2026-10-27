# Companion session/result presentation (DMC-4/5 partial)

A controlled React view in the existing Studio webview surface. No separate
mobile application was present in this source slice. Parent #3073 and #3074
remain open; this does not complete reconnect persistence or a child activity.

## Boundary and API

`CompanionSessionView` receives a controlled `CompanionSessionSnapshot`, typed
`CompanionSessionController` and the caller's existing `renderPreview` function.
The caller must first use the existing verified result consumer and bind its
outcome to the exact original `CompanionHostRequest`. This view does not parse,
verify, decrypt, authenticate, store or execute a remote message.

The presentation compares every request identity/scope/version/epoch/consent
field and the selected artifact ID/version. Only a connected, matching completed
`preview.read` outcome reaches the injected renderer, with its text unchanged.
Waiting/reconnecting, non-completed receipts, stale scope and oversized-result
denial never render a former preview. Non-preview requests cannot become a
mobile desktop workaround. The caller still owns sandboxed HTML rendering.

`reconnect` reconciles the same request without resubmission. `requestPreview`
uses the existing request/host-approval lifecycle after an explicit gesture.
Mounting starts neither. Rapid presses are suppressed while a callback is in
flight; resolved callbacks do not invent host availability or completion. This
component has only transient UI feedback, with no new persistent store, auth,
crypto, transport, server, executor or production wiring. Computer approval
remains on the computer.

## Presentation

The selected result leads, followed by measured computer/request state and one
clear action. Studio semantic colors, type and spacing/radius tokens are reused.
Korean copy distinguishes waiting, host receipt, running, unknown outcome,
denial and result arrival. The original-on-computer explanation stays visible.
The exact selected version aid is folded under a touch-sized disclosure.
Controls use the existing 44/48px ladder; focus remains visible, and there is no
automatic focus or non-user-triggered motion.

## Verification

Focused source render test: `test/companion-session-view.test.tsx`, discovered by
the existing TSX runner without package/runner changes.

```sh
node extensions/hypeproof-chat/scripts/run-tsx-tests.mjs companion-session-view
node extensions/hypeproof-chat/webview-ui/node_modules/typescript/bin/tsc --noEmit -p extensions/hypeproof-chat/webview-ui/tsconfig.json
```

Validation: PASS 82 focused presentation/render assertions and full webview
TypeScript check on Node 22.22.1; PASS 25 isolated Chrome presentation assertions
including 320/390px geometry, touch targets, visible focus and an injected quiz.
All heavy commands used the shared resource wrapper. Browser fixtures inject
synthetic verified receipts and controllers; they establish presentation and
touch layout only. Production wiring, authenticated host/relay integration,
installed Studio/phone, physical-device UX and child/human acceptance remain
NOT RUN for this slice and require separate evidence.
