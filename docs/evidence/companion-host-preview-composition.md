# Development host preview composition

Parent: Studio #3072 (DMC-3), #3079 (device acceptance). These remain open.

The development-only factory composes the existing account session, account-bound
pass, live profile/activity, local preparation and current TaskWorkspaceStore.
A saved selected HTML file is published as opaque metadata; the original path
stays on the desktop. An explicit desktop modal names the file/device/request,
then the existing dispatcher journals the exact read and result. Pairing is a
transport condition, never file authority. The reply port receives the existing
encrypted relay client; no second auth/task store or production listener is added.

The mobile result consumer checks the requested artifact/version and text digest.
Rendering is a caller-owned sandboxed preview. The initial 1,400-byte source
probe has been extended to a selected HTML cap of 24 KiB, with a separate 32 KiB
serialized-envelope cap. Existing relay packets remain at most 2,032 bytes and
the eight-message pending window remains unchanged. The framed consumer emits
only a complete, request/version/digest-verified artifact. JSON expansion past
the envelope cap gives both sides `denied/result_too_large`; framing/runtime
failures return `preview_transfer_unavailable` rather than a false size diagnosis.
No truncation occurs. This is not a complete classroom-artifact capacity promise.
See [bounded transfer evidence](companion-artifact-transfer-20261028.md) for the
independent source, native-probe, browser and rate-limit boundaries.

## Reproduction and evidence boundaries

Use Node 22.22.1 and the shared resource wrapper for the focused source suite:

```sh
node --experimental-strip-types --test \
  extensions/hypeproof-chat/test/companion-host-bridge.smoke.mjs \
  extensions/hypeproof-chat/test/companion-host-bridge-native.smoke.mjs \
  extensions/hypeproof-chat/test/companion-preview-result.smoke.mjs
```

A private cross-checkout local acceptance artifact has observed the actual
Service Worker/D1, existing account/pass/profile implementation, real selected
file/journal, reviewed relay clients and a 390px headless Chrome result. It used
a synthetic adult account and fixture-owned VS Code APIs/credential handles.
The normal path showed the exact selected HTML and preserved its source.
The fixture's static quiz button demonstrates rendering, not quiz interaction
or learning. Its desktop confirmation is an automated fixture response, not
an observed installed native modal or human decision.

The earlier file-read observation counts filesystem content reads triggered by
the remote request. The desktop already has the selected editor buffer, which
is hashed locally before describing its saved version.

Installed Studio/physical mobile/Android/iOS, production activation, learner
isolation, real children, useful artifact revision and larger artifact transfer
are **NOT RUN / NOT COMPLETE** here. Existing DMC acceptance rows are unchanged.
