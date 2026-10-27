# Debug APK build evidence — 2026-10-28

Status: **PASS_BUILD_AND_METADATA_ONLY**. Installed Android/emulator/physical
device behavior is NOT RUN by this author. Root owns the coordinated native
desktop + Worker + APK observation and registry mapping. This is a debug fixture
experiment, not a final framework decision, genuine account/membership flow,
release, production mobile application, cold restart or full DMC completion.

Owned source is only `apps/companion-android/`. Base is root
`d8365c048`; approved dependencies were cherry-picked unchanged: framing v2
`275643b6b` (local dependency `e34848fce`) and truthful connection header
`ae8d4409fdc40285d8c8d0e2efe876b4d3a7d600` (local dependency `b3e90cc83`).
The bundle explicitly injects private Service package source at
`baff3e9b823f43263035865759d70f057cffc100` and frozen selection receiver source
`a96918f92085a50797001cbe88e22d0f4c30dfcd`. Git-object byte comparisons of index,
pairing, relay and selection source passed. No private package publication,
repository pin/bootstrap, core protocol/crypto/server change or shared UI edit
was authored in this slice.

Exact APK:
`/Users/jaylee/CodeWorkspace/artifacts/companion-android-debug-20261028/companion-debug.apk`

- SHA256: `c93838c8aaf511f3899f8fdade56b63be0515834d40d74f19c4bf551897fdcba`
- Bytes: `3262494`
- Application: `ai.hypeproof.companion.debug`
- Minimum/target SDK:35 (Android15); no older Android compatibility claim
- Only manifest permission: `android.permission.INTERNET`
- Signature verification passed with the task-owned standard debug key, explicitly
  pinned to the task's ANDROID_USER_HOME/debug.keystore. The global debug key
  does not exist and was never overwritten. This is not a release signing key.
- Packaged JS, CSS and HTML exactly match the frozen generated assets.
- Release **merged manifest**, processed without building/installing a release
  APK, contains only MainActivity and no FixtureActivity. Default MainActivity
  provisioning returns null and loads no bridge/HTTP UI. This is a scoped
  fixture-absence/source check, not release readiness.

PASS: four focused native-port controls under Node22.22.1: exact correlation and
sanitized native failures, cancellation plus ignored late response,32-entry
overload/dispose settlement without retry, UTF8 request bound and pre-aborted
no-dispatch. These use a native message endpoint stub; they do not prove Android
origin/frame enforcement.

PASS: strict TypeScript for the actual web composition against the private
package declarations and frozen selection API. PASS: actual browser asset build
with the existing React view/controller/result receiver/adapter/scheduler and
real client JS. PASS: Android Java/resources/Dex/debug APK build, signature and
manifest inspection. No broad Studio suite was repeated for this isolated tree.

All test/build/tool provisioning work used the shared hype-resource owner
`codex:01a12522-7c7d-70c2-b09a-353dad5e2280`, version1, work/local_heavy,
1800-second wait/timeout. Native build used task-local JDK17.0.21/Gradle8.9,
SDK platform35/Build Tools34.0.0, AndroidX WebKit1.12.1 and task-local caches.
The four tool archives were verified against vendor checksums before extraction;
recorded archives and redundant staging were then removed, preserving installed
tools, cache, exact APK and evidence. AGP additionally installed platform-tools
into the same isolated SDK using its normal SDK manager, never the peer SDK.

Private artifact directory:
`/Users/jaylee/CodeWorkspace/artifacts/companion-android-debug-20261028/`

| Evidence | Scope |
| --- | --- |
| `tool-receipt.json`, `tool-provision.log` | Vendor URLs/checksums/actual downloaded sizes and successful isolated provisioning |
| `port-tests.log` | Focused4 tests |
| `web-tsconfig.json`, `web-ts-v2.log` | Strict web composition/package type check |
| `web-frozen.log` | Frozen browser bundle inputs and output digests |
| `apk-frozen.log` | Final debug assemble and release-main-manifest processing |
| `apk-receipt.json`, `apk-verify.log` | Exact APK/source/assets/signing-store/manifest receipts |
| `signature.txt`, `apk-badging.txt` | Signature and installed-package metadata only |
| `reused-source-bytes.json` | Exact actual package and selection Git-object equality |

Earlier failed web-loader syntax and declaration/incomplete DOM-lib checks are
retained in earlier logs. They were fixed before the frozen bundle; the initial
native build alone was never accepted as a complete APK. Final receipt verifies
all packaged assets rather than assuming a prior successful compile included
the finished UI.

Next runtime gates: coordinate an owned emulator only after this source/APK
freeze; use the non-secret fixtureUrl contract in README and force-stop the old
test app between fresh request/pair generations. Observe successful and failed
native provisioning, same-account separate-session signed pairing, encrypted
selected metadata, independent native file Cancel/Allow, exact small/large
interactive result, truthful pending/reconnect/close/forget, and attempted
artifact access to native bridge/navigation/network. Do not replace this with a
Chrome page or a synthetic public-state descriptor. Genuine browser account
login, persistent credentials, physical device identity (the package retains its
DEV placeholder), Android/iOS hardware, classroom and production remain open.
