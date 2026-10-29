# HypeProof iOS companion — native account foundation

This first iPhone/iPad SwiftUI shell signs in through the existing personal-account
Service device-code protocol. It does not pair a desktop, grant workspace access,
execute a request, or enable a production relay. Desktop files and execution remain
with their existing owner.

## Run and verify

Open `HypeProofCompanion.xcodeproj` with Xcode 16 or later, select an iPhone or iPad
simulator and run the `HypeProofCompanion` scheme. No signing team is required for
the simulator. Deployment target: iOS 16.0. There are no third-party dependencies.
The core is also a reusable Swift package.

From the repository root:

```sh
bash e2e/companion-ios/core-checks.sh
python3 e2e/companion-ios/test_simulator_checks.py
python3 e2e/companion-ios/simulator-checks.py
```

On Jay's shared computer, wrap each command with the repository's `hype-resource`
`local_heavy` client. The first command compiles the actual production core together
with six executable synthetic protocol controls. The ownership control command uses mocks only; the simulator command requires
full Xcode
and an available iOS runtime with iPhone/iPad device types. It creates fresh,
uniquely named simulators, bounds every command, and finally shuts down/deletes
only UUIDs returned by its own create calls, including on build failure. Existing
user/peer simulators are not selected. It produces owned device identities,
cleanup receipts and native `.xcresult` bundles. The output directory must be empty;
nonempty output is rejected before any external command, preserving earlier
receipts and result bundles. For another attempt, set `IOS_EVIDENCE_DIR` to a fresh
empty directory. An exclusive attempt receipt prevents concurrent reuse. The new `Companion iOS verification` GitHub Actions workflow
runs the checks on hosted macOS when manually dispatched or when a PR carries
the `companion-ios-verify` label. Checkout pins the event head SHA. The optional core-checks argument
`--vfs-overlay <file>` passes an explicit caller-owned compiler VFS overlay; it
changes no app source or global toolchain. Jay's current Command Line Tools have
a stale duplicate `SwiftBridging` module map, and the local run used such an
overlay to hide that duplicate file. Full Xcode/simulator verification remains
separate. This workflow does not sign, archive, upload to TestFlight,
purchase a developer membership, or publish an app.

Simulator UI checks deliberately stay on the first screen. They do not press the
production login button or supply an account/token. They check native launch,
portrait/landscape, login reachability at large text and capture screenshots.
They do not prove VoiceOver usability, split-view interaction, system permission
recovery, Universal Links, actual authentication or a physical-device result.

## Sign-in boundary

- Native fixed HTTPS API: `https://api.hypeproof-ai.xyz/v1`; fixed approval site:
  `https://hypeproof-ai.xyz/studio/connect`. No user-controlled endpoint.
- `POST /auth/device/start` sends only the iOS device label. Native code validates
  the code shape, expiry, interval and **exact** approval URL before showing Safari.
  The browser receives only the public user code, never a device/access token.
- `POST /auth/device/poll` preserves pending and slow-down responses. Polling uses
  ContinuousClock expiry that advances across system sleep, cancellable sleeps and a finite attempt cap. Resume after a
  long background interval cannot silently renew or accept an expired challenge.
- An approved access token is native RAM only, with no refresh token, app storage,
  bridge, URL callback or provider secret. `/me` must match account ID, session ID
  and active account status before the shell shows account verification.
- Cancellation, stale attempts, account mismatch and expired responses cannot
  install a session. Acquired but unusable tokens receive bounded best-effort
  `/auth/logout` cleanup. Local logout clears state immediately; it does not claim
  remote revocation succeeded. Access expiry clears the active shell session.
- Transport uses ephemeral URLSession without cookie/cache persistence, normal
  system TLS verification, redirect refusal, a 12-second resource timeout,
  streaming 64 KiB response cap and an allowlisted JSON projection.

In-app Safari permits browser approval without a private callback URL scheme. The
pending native task may be suspended by iOS; on resume its continuous-clock deadline still
applies. The shell's expiry timer and resume check query the same client clock;
they do not use system awake-time or introduce another elapsed-time origin.
Synthetic controls simulate a suspend jump; they do not claim a real device sleep
observation. There is no background execution entitlement or automatic retry after
process death. A new process starts signed out. Persistent protected credentials
(Keychain), invitation Universal Links/direct-code entry and draft recovery belong
to later scoped implementation, with no plaintext fallback.

## Traceability and acceptance

Scoped foundation issue: Studio #3263. This scope does not close its parent
delivery issues #2805/#3079.

Source scope: Studio #2805 (SMOB-I01–I04), desktop-first DMC-13/14 and partial DMC-02.
Existing registry parents: `ST-INT-COMPANION`, `ST-REQ-COMPANION`,
`ST-DES-COMPANION`; synthetic checks belong to `ST-TEST-COMPANION`.
The full DMC-T02/DMC-T13/DMC-T14 and SMOB physical/signed candidate acceptance stay
open. This foundation does not satisfy #2805 and must not close that issue.

Platform references:
[Apple ContinuousClock](https://developer.apple.com/documentation/swift/continuousclock),
[Apple URLSession streaming bytes](https://developer.apple.com/documentation/foundation/urlsession/bytes(for:delegate:))
and [SwiftUI scene phase](https://developer.apple.com/documentation/swiftui/scenephase).

Protocol compatibility was source-checked against the deployed Service pin in
`config/service-deployment.json`: `f452319597c96606c0127ce918abdddc18541208`.
Its personal-account routes issue a 600-second challenge at a 3-second polling
interval; `worker/src/lib/accounts.ts` caps issued access lifetime at 3,600 seconds.
This source inspection does not claim a live account sign-in was exercised.
