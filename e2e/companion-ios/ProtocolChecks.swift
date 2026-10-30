import Foundation

private final class Fixture: DeviceTransport, SignInClock, @unchecked Sendable {
    var time: TimeInterval = 0
    var calls: [DeviceRoute] = []
    var polls: [TimeInterval] = []
    var pending = 0, slow = 0
    var expiry = 600
    var nextPauseElapsed: TimeInterval?
    var approval = "https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH"
    var meAccount = "acct_1", meSession = "ses_1", meStatus = "active"
    var afterPoll: (() async -> Void)?
    var afterMe: (() async -> Void)?
    var denied = false
    func now() -> TimeInterval { time }
    func pause(_ seconds: TimeInterval) async throws {
        try Task.checkCancellation()
        time += nextPauseElapsed ?? seconds
        nextPauseElapsed = nil
    }
    func call(_ route: DeviceRoute, body: [String: String]?, bearer: String?) async throws -> DeviceReply {
        calls.append(route)
        switch route {
        case .start:
            expectEqual(body, ["label": "HypeProof iOS"]); expectNil(bearer)
            return DeviceReply(status: 200, fields: ["device_code": String(repeating: "a", count: 64), "user_code": "ABCD-EFGH", "verification_uri": "https://hypeproof-ai.xyz/studio/connect", "verification_uri_complete": approval], numbers: ["expires_in": expiry, "interval": 3])
        case .poll:
            expectEqual(body, ["device_code": String(repeating: "a", count: 64)]); expectNil(bearer)
            polls.append(time)
            if slow > 0 { slow -= 1; return DeviceReply(status: 429, fields: ["error": "slow_down"]) }
            if pending > 0 { pending -= 1; return DeviceReply(status: 202, fields: ["status": "pending"]) }
            if denied { return DeviceReply(status: 403, fields: ["error": "access_denied"]) }
            await afterPoll?()
            return DeviceReply(status: 200, fields: ["access_token": "synthetic-memory-only", "account_id": "acct_1", "session_id": "ses_1"], numbers: ["expires_in": 3600])
        case .me:
            expectNil(body); expectEqual(bearer, "synthetic-memory-only")
            await afterMe?()
            return DeviceReply(status: 200, fields: ["account_id": meAccount, "session_id": meSession, "account_status": meStatus])
        case .logout:
            expectEqual(bearer, "synthetic-memory-only")
            return DeviceReply(status: 200, fields: [:])
        }
    }
    func run(_ challenge: @Sendable (ApprovalChallenge) async throws -> Void = { _ in }) async throws -> AccountSession {
        try await DeviceSignIn(transport: self, clock: self).run(challenge: challenge)
    }
}

private final class ProtocolChecks {
    func testExistingProtocolPendingSlowdownAndIdentity() async throws {
        let f = Fixture(); f.slow = 1; f.pending = 1
        let session = try await f.run { approval in expectEqual(approval.code, "ABCD-EFGH"); expectEqual(approval.url.absoluteString, f.approval) }
        expectEqual(session.accountID, "acct_1"); expectEqual(session.sessionID, "ses_1")
        expectEqual(f.polls, [3, 7, 11]); expectEqual(f.calls, [.start, .poll, .poll, .poll, .me])
        expectFalse(String(reflecting: session).contains("synthetic-memory-only"))
    }
    func testUntrustedOrMixedApprovalNeverOpensOrPolls() async {
        for url in ["https://evil.example/studio/connect?code=ABCD-EFGH", "https://hypeproof-ai.xyz/studio/connect?code=JKLM-NPQR", "https://hypeproof-ai.xyz/studio/connect?code=ABCD-EFGH&extra=x"] {
            let f = Fixture(); f.approval = url
            do { _ = try await f.run { _ in fail("Untrusted URL opened") }; fail("Accepted") } catch { expectEqual(error as? SignInFailure, .invalidApprovalURL) }
            expectEqual(f.calls, [.start])
        }
    }
    func testPendingExpiryAndBackgroundElapsedTimeBoundPolling() async {
        let f = Fixture(); f.expiry = 10; f.pending = 999
        do { _ = try await f.run(); fail("Expired challenge accepted") } catch { expectEqual(error as? SignInFailure, .expired) }
        expectEqual(f.time, 10); expectEqual(f.polls, [3, 6, 9]); expectFalse(f.calls.contains(.me))
        let background = Fixture()
        do { _ = try await background.run { _ in background.time = 601 }; fail("Expired background challenge accepted") } catch { expectEqual(error as? SignInFailure, .expired) }
        expectEqual(background.calls, [.start])
        // Simulate a long suspension while the first poll wait is in progress.
        let suspended = Fixture(); suspended.expiry = 10; suspended.nextPauseElapsed = 601
        do { _ = try await suspended.run(); fail("Expired suspended challenge accepted") } catch { expectEqual(error as? SignInFailure, .expired) }
        expectEqual(suspended.time, 601); expectEqual(suspended.calls, [.start])
        // Session expiry and UI-facing queries use the same injected clock origin.
        let fSession = Fixture()
        let client = DeviceSignIn(transport: fSession, clock: fSession)
        do {
            let session = try await client.run { _ in }
            expectEqual(client.remaining(session), 3600)
            expectFalse(client.isExpired(session))
            fSession.time += 3601
            expectTrue(client.isExpired(session)); expectEqual(client.remaining(session), 0)
            try await client.waitUntilExpiry(session)
        } catch { fail("Session clock consistency check failed") }
    }
    func testCancellationCannotInstallLateApprovedCredentials() async {
        let f = Fixture()
        f.afterPoll = { withUnsafeCurrentTask { $0?.cancel() } }
        let attempt = Task { try await f.run() }
        do { _ = try await attempt.value; fail("Cancelled credentials installed") } catch { expectTrue(error is CancellationError) }
        expectEqual(f.calls, [.start, .poll, .logout])
        let before = Fixture()
        let cancelled = Task { withUnsafeCurrentTask { $0?.cancel() }; return try await before.run() }
        _ = try? await cancelled.value
        expectTrue(before.calls.isEmpty)
    }
    func testMismatchedInactiveOrCancelledMeRevokesWithoutHandoff() async {
        for field in 0..<4 {
            let f = Fixture()
            if field == 0 { f.meAccount = "another" }
            if field == 1 { f.meSession = "another" }
            if field == 2 { f.meStatus = "disabled" }
            if field == 3 { f.afterMe = { withUnsafeCurrentTask { $0?.cancel() } } }
            let attempt = Task { try await f.run() }
            do { _ = try await attempt.value; fail("Unverified session installed") } catch {}
            expectEqual(f.calls.last, .logout)
        }
        let denied = Fixture(); denied.denied = true
        do { _ = try await denied.run(); fail("Denied account accepted") } catch { expectEqual(error as? SignInFailure, .denied) }
        expectFalse(denied.calls.contains(.me))
    }
    func testJSONRejectsBooleanFractionalExpiryAndDropsRefreshSecrets() throws {
        let valid = Data(#"{"expires_in":3600,"interval":3,"access_token":"synthetic","refresh_token":"must-discard","account":{"id":"acct_1","status":"active"},"session_id":"ses_1"}"#.utf8)
        let parsed = try DeviceHTTP.decode(valid, status: 200)
        expectEqual(parsed.fields["account_id"], "acct_1"); expectNil(parsed.fields["refresh_token"])
        for value in ["true", "3.5", "3601", "-1"] {
            let parsed = try DeviceHTTP.decode(Data(("{\"expires_in\":" + value + "}").utf8), status: 200)
            expectNil(parsed.numbers["expires_in"])
        }
        expectThrows(try DeviceHTTP.decode(Data(repeating: 32, count: 65_537), status: 200))
        expectThrows(try DeviceHTTP.decode(Data([0xff]), status: 200))
        expectThrows(try DeviceHTTP.decode(Data(#"{"error":true}"#.utf8), status: 200))
    }
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T, file: StaticString = #file, line: UInt = #line) { precondition(actual == expected, "Unexpected result", file: file, line: line) }
private func expectTrue(_ value: Bool, file: StaticString = #file, line: UInt = #line) { precondition(value, "Expected true", file: file, line: line) }
private func expectFalse(_ value: Bool, file: StaticString = #file, line: UInt = #line) { precondition(!value, "Expected false", file: file, line: line) }
private func expectNil<T>(_ value: T?, file: StaticString = #file, line: UInt = #line) { precondition(value == nil, "Expected nil", file: file, line: line) }
private func fail(_ reason: String, file: StaticString = #file, line: UInt = #line) { preconditionFailure(reason, file: file, line: line) }
private func expectThrows<T>(_ action: @autoclosure () throws -> T) { do { _ = try action(); fail("Expected rejection") } catch {} }

@main
struct RunProtocolChecks {
    static func main() async throws {
        let checks = ProtocolChecks()
        try await checks.testExistingProtocolPendingSlowdownAndIdentity()
        print("PASS pending/slowdown and exact account/session verification")
        await checks.testUntrustedOrMixedApprovalNeverOpensOrPolls()
        print("PASS untrusted/mixed approval URL rejection")
        await checks.testPendingExpiryAndBackgroundElapsedTimeBoundPolling()
        print("PASS expiry, simulated suspend jump and shared session/UI clock bounds")
        await checks.testCancellationCannotInstallLateApprovedCredentials()
        print("PASS cancellation and late-token revocation")
        await checks.testMismatchedInactiveOrCancelledMeRevokesWithoutHandoff()
        print("PASS identity mismatch, inactive account, denial and cancelled-me cleanup")
        try checks.testJSONRejectsBooleanFractionalExpiryAndDropsRefreshSecrets()
        print("PASS bounded JSON, strict numeric fields and refresh-secret omission")
        print("Core controls only. iOS UI, simulator, physical device and live auth: NOT RUN.")
    }
}
