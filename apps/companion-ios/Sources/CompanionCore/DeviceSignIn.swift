import Foundation

public enum SignInFailure: Error, Equatable {
    case invalidResponse, invalidApprovalURL, denied, expired, identityChanged
}

public struct DeviceReply: Sendable {
    public let status: Int
    public let fields: [String: String]
    public let numbers: [String: Int]
    public init(status: Int, fields: [String: String], numbers: [String: Int] = [:]) {
        self.status = status; self.fields = fields; self.numbers = numbers
    }
}

public protocol DeviceTransport: Sendable {
    func call(_ route: DeviceRoute, body: [String: String]?, bearer: String?) async throws -> DeviceReply
}
public enum DeviceRoute: String, Sendable { case start = "/auth/device/start", poll = "/auth/device/poll", me = "/me", logout = "/auth/logout" }
public protocol SignInClock: Sendable {
    func now() -> TimeInterval
    func pause(_ seconds: TimeInterval) async throws
}
// ContinuousClock advances across system sleep; origin is shared by every copy of this client clock.
public struct ContinuousSignInClock: SignInClock {
    private let source = ContinuousClock()
    private let origin: ContinuousClock.Instant
    public init() { origin = source.now }
    public func now() -> TimeInterval {
        let elapsed = origin.duration(to: source.now).components
        return Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1_000_000_000_000_000_000
    }
    public func pause(_ seconds: TimeInterval) async throws { try await source.sleep(for: .seconds(max(0, seconds))) }
}
public struct ApprovalChallenge: Sendable {
    public let code: String
    public let url: URL
}

// Access credentials are native RAM only. No refresh token, Codable conformance, or persistent store.
public final class AccountSession: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accountID: String
    public let sessionID: String
    public let expiresAt: TimeInterval
    fileprivate let bearer: String
    fileprivate init(account: String, session: String, bearer: String, expiresAt: TimeInterval) {
        self.accountID = account; self.sessionID = session; self.bearer = bearer; self.expiresAt = expiresAt
    }
    public var description: String { "AccountSession(<redacted>)" }
    public var debugDescription: String { description }
}

public struct DeviceSignIn: Sendable {
    public static let serviceOrigin = "https://api.hypeproof-ai.xyz/v1"
    public static let approvalOrigin = "https://hypeproof-ai.xyz"
    private let transport: any DeviceTransport
    private let clock: any SignInClock
    public init(transport: any DeviceTransport, clock: any SignInClock = ContinuousSignInClock()) {
        self.transport = transport; self.clock = clock
    }
    private func live(until deadline: TimeInterval) throws {
        try Task.checkCancellation()
        guard clock.now() < deadline else { throw SignInFailure.expired }
    }
    private func ok(_ reply: DeviceReply) throws {
        guard (200..<300).contains(reply.status), reply.fields["error"] == nil else { throw SignInFailure.denied }
    }
    private func value(_ reply: DeviceReply, _ name: String, pattern: String) throws -> String {
        guard let value = reply.fields[name], value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex else { throw SignInFailure.invalidResponse }
        return value
    }
    public func remaining(_ session: AccountSession) -> TimeInterval { max(0, session.expiresAt - clock.now()) }
    public func isExpired(_ session: AccountSession) -> Bool { remaining(session) <= 0 }
    public func waitUntilExpiry(_ session: AccountSession) async throws {
        while !isExpired(session) { try await clock.pause(remaining(session)) }
        try Task.checkCancellation()
    }
    public func logout(_ session: AccountSession) async { await revoke(session.bearer) }
    private func revoke(_ bearer: String) async {
        // Cleanup is independent of the cancelled sign-in task, and remains transport-deadline bounded.
        let transport = self.transport
        await Task.detached { _ = try? await transport.call(.logout, body: [:], bearer: bearer) }.value
    }
    public func run(challenge: @Sendable (ApprovalChallenge) async throws -> Void) async throws -> AccountSession {
        var acquired: String?
        do {
            try Task.checkCancellation()
            let start = try await transport.call(.start, body: ["label": "HypeProof iOS"], bearer: nil)
            try ok(start)
            let device = try value(start, "device_code", pattern: "^[a-f0-9]{64}$")
            let code = try value(start, "user_code", pattern: "^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$")
            guard let expiry = start.numbers["expires_in"], (1...600).contains(expiry),
                  var interval = start.numbers["interval"], (3...15).contains(interval) else { throw SignInFailure.invalidResponse }
            let expected = Self.approvalOrigin + "/studio/connect?code=" + code
            guard start.fields["verification_uri"] == Self.approvalOrigin + "/studio/connect",
                  start.fields["verification_uri_complete"] == expected, let url = URL(string: expected) else { throw SignInFailure.invalidApprovalURL }
            let deadline = clock.now() + Double(expiry)
            try live(until: deadline)
            try await challenge(ApprovalChallenge(code: code, url: url))
            for _ in 0..<200 {
                try live(until: deadline)
                let next = min(clock.now() + Double(interval), deadline)
                while clock.now() < next { try await clock.pause(next - clock.now()); try live(until: deadline) }
                try live(until: deadline)
                let reply = try await transport.call(.poll, body: ["device_code": device], bearer: nil)
                if reply.status == 429 && reply.fields["error"] == "slow_down" { interval = min(15, interval + 1); continue }
                if reply.status == 202 && reply.fields["status"] == "pending" { continue }
                try ok(reply)
                let bearer = try value(reply, "access_token", pattern: "^[!-~]{1,8192}$")
                acquired = bearer
                guard let lifetime = reply.numbers["expires_in"], (1...3600).contains(lifetime) else { throw SignInFailure.invalidResponse }
                let account = try value(reply, "account_id", pattern: "^[A-Za-z0-9_-]{1,128}$")
                let session = try value(reply, "session_id", pattern: "^[A-Za-z0-9_-]{1,128}$")
                let tokenDeadline = clock.now() + Double(lifetime)
                try live(until: min(deadline, tokenDeadline))
                let me = try await transport.call(.me, body: nil, bearer: bearer)
                try ok(me); try live(until: min(deadline, tokenDeadline))
                guard me.fields["account_id"] == account, me.fields["session_id"] == session,
                      me.fields["account_status"] == "active" else { throw SignInFailure.identityChanged }
                return AccountSession(account: account, session: session, bearer: bearer, expiresAt: tokenDeadline)
            }
            throw SignInFailure.expired
        } catch {
            if let bearer = acquired { await revoke(bearer) }
            throw error
        }
    }
}
