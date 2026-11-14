# Member inbox verification — Studio #3788

Evidence must identify source tree/commit, OS, command and exit code. Synthetic transports never
count as production membership or GitHub acceptance. Member-specific native Core/App/simulator results must name the integrated source;
unrelated successful native CI does not validate these added member paths. Test definitions
do not authorize signing, upload, enrollment or a live approval.

| Requirement | Executable control | Expected failure boundary |
|---|---|---|
| MAI-01, MAI-04, MAI-05 | `extensions/hypeproof-chat/test/member-approval-host.smoke.mjs` | Real StartPage→AccountSession route, existing SecretStorage, durable write before POST; old session cannot dispatch; UI projection contains no credentials/session/account ID |
| MAI-02–MAI-05 | `extensions/hypeproof-chat/test/member-approval.smoke.mjs` | Malformed ID/review, late response, disk failure, account switch, duplicate gesture, lease expiry and restart never grant/replay approval |
| MAI-02, MAI-03 | `extensions/hypeproof-chat/test/member-approval.test.tsx` | Existing React component: collapsed evidence as text, full SHA, explicit choice, all choices disabled for stale/unknown/not-enrolled, processing is not approval |
| MAI-02–MAI-05 | `apps/studio-native/ios/Tests/StudioCoreTests/MemberApprovalTests.swift` | Production Core validation/controller: strict identity, original UUID, saved-before-send, unknown GET-only reconciliation and account/disk/expiry refusal; overlapping conversation/inbox refresh shares one rotation, stale account cannot receive its result |

Focused commands from extension: `node --test test/member-approval.smoke.mjs`,
`node test/member-approval-host.smoke.mjs`, `node scripts/run-tsx-tests.mjs member-approval`,
`npx tsc --noEmit`. New smoke and TSX files are discovered by the existing test chain.
Native Core: `swift test --package-path apps/studio-native/ios --filter MemberApprovalTests`.
The additive native UI case `testMemberInboxKeepsDraftAndReconcilesUncertainChoiceWithoutResend` uses the existing DEBUG HTTP fixture: actual sign-in, preserve question draft, choose approval, receive a lost-response error, relaunch and reconcile by GET with exactly one POST. It does not inject signed-in UI state or simulate GitHub success. This added case requires actual Apple simulator evidence for the integrated candidate.

Build the existing extension bundle and webview. Native Xcode/simulator must additionally validate
sheet integration, accessibility identifiers, Keychain/session rotation, UI dismissal/background
and preserved question draft. No new release route or physical gate is added to TestFlight.

Installed/live acceptance remains **NOT_RUN** until separately collected: existing desktop and
signed iPhone log into the same enrolled member; open same card on both; approve on one and
observe one exact-head GitHub review on both. Hold/explanation emit no GitHub approval. Revoke
membership, change head/base/evidence, disconnect after POST, and expire lease: all must remain
safe. Collect card/result identifiers, source/package version and safe evidence, never bearer or
HMAC material. This member workflow does not establish consumer activation or PMF.

Enrollment visibility delta: controller controls require one quiet list GET, no journal reads or
POST, stale response fencing, default-off/not-enrolled hiding and same-session transient recovery.
The actual StartPage render asserts no entry for ordinary signed-in customers; host tests verify
adoption/session-change discovery and repeated account-watch deduplication. Native Core includes
`testMemberEntryDiscoveryRequiresCurrentEnrollmentAndNeverReplays`; the additive simulator case
`testOrdinaryAccountDoesNotShowMemberApprovalEntry` covers actual login and hidden menu entry.
The member journey uses a separate `member-inbox` fixture scenario. These added native cases remain NOT_RUN until executed for the integrated candidate;
ordinary existing first-answer fixtures explicitly return not-enrolled.
