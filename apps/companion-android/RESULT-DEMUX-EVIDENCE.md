# Android result demux and browser boot repair — source evidence

Base: `8f498b21c8bbe269e9300c36611de2463f02b202`. This is a debug prototype repair, not installed-device acceptance.

The result-phase transport now routes authenticated selection metadata through the same selection receiver used at bootstrap. Valid duplicate/stale metadata is ACKed through the existing adapter/budget; a newer selection is bounded to one held declaration with a truthful notice. It never replaces the original request or starts another request. Invalid metadata or an expired metadata ACK terminates the local owner truthfully. Transient ACK errors remain explicit retries. The extra provenance map contains metadata only (at most64 packets,2032 UTF-8 bytes each), clears on owner close, and never duplicates result bytes. Close/caller-abort checks suppress late selection notices and ACKs.

The browser builder now aliases React and ReactDOM including subpaths to an explicit single canonical dependency root (`COMPANION_REACT_DEPS`, default existing webview dependencies), requires matching versions, and rejects a second React graph root. Existing native bridge, Java, CSP, relay crypto, server caps and sandbox are unchanged.

## Retained controls

Artifacts: `/Users/jaylee/CodeWorkspace/artifacts/companion-android-result-demux-20261028/`.

- `retained-red.log`: exact base main entry; uninterrupted large Korean HTML succeeds while later authenticated selection metadata prevents result completion (one PASS, one FAIL).
- `frozen-tests.log`: repaired actual React entry2 and focused transport5 PASS. Exact original HTML is exposed only after complete verification; tests cover metadata ACK failure/retry, stale/duplicate, foreign metadata, expired ACK, owner-close and caller-abort interleavings, and same-budget admission.
- `types.log`: strict Android web/main.tsx dependency graph TypeScript PASS, using `web-tsconfig.json` in that artifact directory.
- `boot-red.log`: exact main.js extracted from frozen APK SHA256 `c93838c8aaf511f3899f8fdade56b63be0515834d40d74f19c4bf551897fdcba` fails with React error31. The packed graph mixed React19.1.0 with ReactDOM18.3.1.
- `boot-green.log`: repaired actual production browser bundle renders the initial button and posts no native message before a gesture, with React/ReactDOM18.3.1. This test uses vm + mini-DOM, not Chrome/WebView; CSP/origin/platform acceptance is not established by this test. Root owns the independent real Chromium and installed APK observations.
- `generated-assets-report.json`: canonical dependency paths, each React input hash, explicit private client/selection inputs and generated JS/HTML hashes. Generated assets remain ignored build output, not vendored runtime source.

Focused commands, each under the shared resource wrapper and Node22.22.1:

```sh
node --experimental-strip-types --test apps/companion-android/test/result-entry.test.mjs apps/companion-android/test/result-transport.test.mjs
node extensions/hypeproof-chat/node_modules/typescript/bin/tsc -p /Users/jaylee/CodeWorkspace/artifacts/companion-android-result-demux-20261028/web-tsconfig.json
COMPANION_CLIENT_ENTRY=<authorized-private-package-index.mjs> COMPANION_SELECTION_ENTRY=<frozen-companionSelection.ts> node --experimental-strip-types --test apps/companion-android/test/browser-boot.test.mjs
COMPANION_CLIENT_ENTRY=<same> COMPANION_SELECTION_ENTRY=<same> node apps/companion-android/build-web.mjs
```

The historical c938 APK is unchanged. No APK rebuild, emulator/app launch, production login, publication or physical-device claim belongs to this source slice.
