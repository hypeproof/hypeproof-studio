# Companion Android debug experiment

The native shell retains the initial #3100 fixture-only debug boundary. This
#3114 source cut adds reviewed authored-request receipts and explicit next-version
adoption. Native personal-account sign-in belongs to #3115; selected execution
belongs to #3097 and both remain absent here.
Historical APK observations below retain their original source/asset identities.
A new cut or generated web bundle is not an installed-APK acceptance result.

This is an API35-only installed-APK prototype, not the final mobile framework,
finished account product entry, release or cold-restart design. It reuses Studio's existing
React companion view/controller, authenticated result verifier, framing/adapter,
request scheduler and the explicitly injected private browser client package.
The native Java host contains no crypto implementation.

## Runtime boundary

Only the debug source set contains `FixtureActivity`. An explicit native intent
extra `fixtureUrl` points to `http://10.0.2.2:PORT/__android_fixture/session` or the
same literal127.0.0.1 host/path, with no query/userinfo/fragment. One off-main-thread
native request fetches at most4KiB JSON `{service,accountId,sessionId,bearer}` from
the test-owned fixture server. Returned service must be that exact origin plus
`/v1`. Redirects/content-type/UTF8/deadline/lifecycle are bounded; Activity
recreation drops the provisioning URL rather than restoring credentials or
fetching automatically. No token is placed in adb arguments, JS, URL query,
browser storage, logs or app files. This is synthetic fixture provisioning, not
real account login. The release source set has no such component or override;
MainActivity uses the personal-account entry below and keeps production workspace transport disabled.

Native bearer HTTP goes directly to the fixed loopback Service, without browser
Origin/cookies or a proxy that changes browser authority. Explicit `/me` binds
the supplied account/session; only its minimal IDs return to JS. Device-only
pairing and relay actions have fixed internally constructed paths,8KiB request,
64KiB response,32 pending operations,12s admitted native deadline and13s JS wait.
No retries occur here. Responses and errors are bounded/sanitized; close aborts
pending HTTP and suppresses late publication. The Service remains the authority
for the unchanged60 requests/session/min gate and all current endpoint auth.

Trusted bundled UI uses WebViewAssetLoader at
`https://appassets.androidplatform.net/assets/ui/index.html`. Native messaging
requires that exact origin and main frame, plus a live native session. There is
no addJavascriptInterface or token getter, arbitrary URL/path dispatch, account
login response forwarding, remote execution, file/content access, navigation,
camera/mic/storage/push permission or production/cloud fallback.

Artifact bytes only enter the existing opaque-origin sandboxed iframe with
restrictive artifact CSP, no network/forms/bridge/top navigation. Parent inline
scripts are allowed because srcdoc inherits parent CSP (the existing cspBuilder
documents this); no artifact HTML enters the trusted parent DOM. The native
isMainFrame check also rejects a child that navigates to a trusted asset URL.
The parent has no window-message-to-native forwarding listener.

Before adapter creation, the one session budget admits each actual protocol HTTP
through scheduled raw transports. After selection messages are fully validated
and ACKed, all pre-adapter work is settled, transports are reset to raw, and the
exclusive adapter admits actual HTTP with that SAME50/min rolling budget and
1200ms spacing. There is no second native rate scheduler. A bounded bootstrap
batch is retained across failed ACKs; malformed or unexpected nonselection
bootstrap data closes without ACK. The first authenticated host selection is a
declaration, never file authority. Real desktop approval still governs the read.

The connection label means last verified transport. The UI explicitly says the
computer's response is checked after the request; it is not a heartbeat. One
request belongs to one live adapter/cipher. For independent Cancel and fresh
Allow scenarios, explicitly restart the Activity and pair a fresh owner. Local
close can leave a clearly labelled cached result without connected/request
controls; explicit forget awaits controller cleanup and closes transport/keys,
then removes the preview. No durable store/checkpoint is enabled. Process death
does not restore keys, counters, request execution or a user login.

## Personal-account device sign-in preparation

The default launcher has an explicit personal-account login button. It uses only
`https://api.hypeproof-ai.xyz/v1` and `https://hypeproof-ai.xyz`, the existing
`/auth/device/start` and `/auth/device/poll` protocol, and an exact
`/studio/connect?code=PUBLIC-CODE` browser approval URL. There is no Android
callback or new account provider. Existing Lab/Service age, consent, membership
and entitlement decisions remain authoritative; this is not child/classroom
eligibility or onboarding. After approval, native `/me` must match the poll
account and session and report an active account before any WebView can open.
Production workspace transport remains hard-disabled: account confirmation says
that computer/workspace connection is unavailable, rather than claiming pairing.

Access tokens live only in native RAM. Refresh tokens and unrelated account
fields are discarded. No token is put in an Intent, browser URL, WebView,
preferences, logs or files. Activity/process recreation starts over. Cancel
interrupts local waiting/HTTP and suppresses stale completion. Polling waits at
least three seconds, honors slow-down, and stops at the earlier of the challenge
expiry (at most ten minutes) or 200 polls. Each HTTP operation has a monotonic 12-second whole-call deadline, a native
cancel/disconnect watchdog, remaining-time connect/read limits and response size; network failure returns to explicit retry.
Known tokens from cancelled, expired or mismatched completion use best-effort
existing logout. The Service has no pending-device cancellation endpoint: a
cancelled code can remain until expiry, and an unknown/lost network response
cannot guarantee remote session revocation. Local close never installs that
session. There is no durable recovery or refresh in this slice.

A separate debug-only `ai.hypeproof.companion.DeviceSignInFixtureActivity`
accepts one noncredential `serviceUrl` Intent extra, consumed once and discarded
on recreation. It must be canonical `http://127.0.0.1:PORT/v1`, reached through a test-owned adb
reverse mapping. `10.0.2.2` is rejected by this login entry because Service does
not allow that HTTP Lab approval origin. Its test-owned approval site must be that exact origin,
with `/studio/connect?code=PUBLIC-CODE`; no alternate URL is accepted from the
server. This debug entry enables the existing WebView only after the real device
protocol and `/me` succeed. It never accepts a bootstrap token. The original
`FixtureActivity` and its synthetic bootstrap contract are unchanged. Both debug
components are absent from the release manifest. Do not use an unowned local
Service or claim that a local approval fixture proves Google login.

Run `bash test/device-sign-in.test.sh` with Java 17 under the resource wrapper.
Its protocol controls use an in-memory transport/clock; separate owned loopback
HTTP drip/cancel controls exercise the absolute deadline helper. Neither uses a
browser, account or Android runtime. Offline native Java compilation and release manifest processing
are separate from APK, installed sign-in and production acceptance.

## Build inputs and commands

Pinned native build: AGP8.7.3, Gradle8.9, Java17, compile/target/minSdk35,
Build Tools34.0.0 default, AndroidX WebKit1.12.1. No NDK/Kotlin compiler is needed.
Use task-local SDK/JDK/Gradle/cache; never global Gradle, brew, shared SDK mutation
or unreviewed package bootstrap. Tool archive vendor checksums and precise local
paths are recorded in `artifacts/companion-android-debug-20261028/tool-receipt.json`.
Verified archives/staging copies are deleted after extraction; installed reusable
tools and exact evidence/APK remain.

`build-web.mjs` requires explicit authorized `COMPANION_CLIENT_ENTRY` and
`COMPANION_SELECTION_ENTRY` inputs; no private sibling production import or
package publication/pin is introduced. Use `COMPANION_NODE_PATHS` for existing
non-React dependencies when the isolated worktree has no local install. Set
`COMPANION_REACT_DEPS` to one explicitly reviewed `node_modules` directory
containing matching `react` and `react-dom` versions; the default is this
checkout's `extensions/hypeproof-chat/webview-ui/node_modules`. Both package
roots and every subpath are aliased together, and the bundle graph rejects a
second React runtime. `COMPANION_NODE_PATHS` alone cannot select the React
runtime because an ancestor installation takes precedence. The exact generated
bundle must render its first screen before it is packaged. Runtime JS is bundled
into ignored `app/src/main/assets/ui/`, not vendored as source.

Run each build/test under the shared hype-resource wrapper with the assigned
owner, unique job, version1, work/local_heavy and1800s limits:

```sh
node build-web.mjs
node --experimental-strip-types --test test/native-port.test.mjs
gradle --no-daemon :app:assembleDebug :app:processReleaseMainManifest
```

Set task-local `JAVA_HOME`, `GRADLE_USER_HOME`, `ANDROID_USER_HOME` and
`local.properties` sdk.dir explicitly. Resource wrapper and exact executable/input
paths are in the external build logs. Gradle requires explicit user/cache homes,
and the debug signing store is pinned to that task-owned ANDROID_USER_HOME's
`debug.keystore`; the normal global debug keystore is neither reused nor changed.
`processReleaseMainManifest` verifies the
fixture component is absent from that variant's manifest; it does not assemble,
install, approve or publish a release APK.

## Driver contract

Debug application: `ai.hypeproof.companion.debug`; explicit Activity:
`ai.hypeproof.companion.FixtureActivity`. The fixtureUrl extra contains no
credential. Fixture server must return its own origin in service and must not
log its native-only credential response. The default launcher offers personal-account login; it never enables production companion HTTP.

WebView debugging is enabled only in debug. Owned test tooling can discover
`webview_devtools_remote_<pid>` and the trusted asset target. Drive visible UI:

1. `기기 연결 확인` (native `/me` only).
2. Paste explicit desktop challenge into `textarea#challenge`; select
   `초대 확인·참여 요청`.
3. Read `기기 비교 코드`; person compares/approves on desktop.
4. `컴퓨터 승인 확인·기기 키 준비` consumes and publishes the device offer.
5. Desktop prepares its cipher; `암호화 연결 확인` completes the device cipher.
6. Desktop explicitly publishes encrypted selection; `선택한 작업 받기` consumes
   real decrypted metadata through CompanionSelectionReceiver. No public-state
   fixture endpoint supplies a descriptor to JS.
7. Existing `선택한 결과 보기` sends the exact bound request. Desktop explicitly
   receives and Cancel/Allow remains its separate native file confirmation.
8. Use the quiz inside `선택한 HTML 미리보기`; close or explicitly forget locally.

Do not launch/install any emulator/device until the captain coordinates the
owned runtime. An installed emulator APK is not physical-device acceptance.
Genuine same-account browser device login, secure persistent credentials, final
device identity lifecycle, physical Android/iOS, classroom and production
acceptance remain outside this debug fixture proof. The package's existing DEV
placeholder device_id remains unchanged and cannot establish physical identity.
