import Foundation
import CoreFoundation

public struct AccountPushReference: Sendable, Equatable {
    public let deliveryID, kind, id: String
    public let revision: Int64
    /// A silent Service update (#522): the approval card is no longer waiting, so remove its delivered alert.
    public let withdraw: Bool
    public init(_ value: [String: Any]) throws {
        guard value["schema"] as? String == "hps-push/1", let delivery = value["delivery_id"] as? String,
              UUID(uuidString: delivery)?.uuidString.lowercased() == delivery,
              let kind = value["kind"] as? String, ["question", "approval", "team_request"].contains(kind),
              let id = value["id"] as? String, id.range(of: "^[A-Za-z0-9:._-]{1,128}$", options: .regularExpression) != nil,
              let number = value["revision"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue > 0, number.doubleValue <= 9_007_199_254_740_991 else { throw SyncFailure.invalidResponse }
        if kind == "team_request", !TeamRequestRecord.validID(id) { throw SyncFailure.invalidResponse }
        var withdraw = false
        if let flag = value["withdraw"] {
            guard let flag = flag as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(), flag.boolValue, kind == "approval" else { throw SyncFailure.invalidResponse }
            withdraw = true
        }
        deliveryID = delivery; self.kind = kind; self.id = id; revision = number.int64Value; self.withdraw = withdraw
    }
}
/// Which delivered alerts to take off the lock screen. Pure so the app delegate and tests share it.
public enum AccountPushAlerts {
    /// The approval card a delivered alert points to, or nil for questions, withdrawals and foreign payloads.
    public static func approvalCardID(_ userInfo: [AnyHashable: Any]) -> String? {
        guard let raw = userInfo["hps"] as? [String: Any], let reference = try? AccountPushReference(raw), reference.kind == "approval", !reference.withdraw else { return nil }
        return reference.id
    }
    /// Identifiers of delivered approval alerts whose card no longer waits for this person.
    public static func stale(_ delivered: [(identifier: String, userInfo: [AnyHashable: Any])], settled: Set<String>) -> [String] {
        delivered.compactMap { item in approvalCardID(item.userInfo).flatMap { settled.contains($0) ? item.identifier : nil } }
    }
}
public struct TeamPushDestination: Sendable, Equatable {
    public let requestID: String
    public let eventSequence: Int64
    public init(_ response: [String: Any], reference: AccountPushReference) throws {
        guard reference.kind == "team_request", let recorded = response["recorded"] as? NSNumber,
              CFGetTypeID(recorded) == CFBooleanGetTypeID(), recorded.boolValue,
              response["evidence_kind"] as? String == "client_observed",
              let destination = response["destination"] as? [String: Any], destination["kind"] as? String == "team_request",
              let request = destination["request_id"] as? String, TeamRequestRecord.validID(request), request == reference.id,
              let sequence = destination["event_sequence"] as? NSNumber, CFGetTypeID(sequence) != CFBooleanGetTypeID(),
              sequence.doubleValue.isFinite, sequence.doubleValue.rounded() == sequence.doubleValue,
              sequence.doubleValue > 0, sequence.doubleValue <= 9_007_199_254_740_991, sequence.int64Value == reference.revision else { throw SyncFailure.invalidResponse }
        requestID = request; eventSequence = sequence.int64Value
    }
}
public enum TeamPushCapabilities {
    public static func supported(_ discovered: [String]?) throws -> [String] {
        let implemented = ["team_request/1", "team_discussion/1"]
        guard let discovered else { return [] }
        guard discovered.count <= 32, Set(discovered).count == discovered.count,
              discovered.allSatisfy({ $0.count <= 64 && $0.range(of: "^[a-zA-Z0-9_-]+/[1-9][0-9]*$", options: .regularExpression) != nil }),
              !discovered.contains("team_discussion/1") || discovered.contains("team_request/1") else { throw SyncFailure.invalidResponse }
        return implemented.filter(discovered.contains)
    }
}
public struct AccountPushPreference: Codable, Sendable {
    public var installation = UUID().uuidString.lowercased()
    public var accountID = "", sessionID = "", enabled = false
    public init() {}
    public func validate() throws { guard UUID(uuidString: installation)?.uuidString.lowercased() == installation else { throw SyncFailure.invalidResponse } }
    public func matches(_ identity: MemberApprovalIdentity?) -> Bool { enabled && identity?.accountID == accountID && identity?.sessionID == sessionID }
}

@MainActor public final class AccountPushController {
    public struct View { public var busy = false; public var status = "알림을 켜면 새 질문과 확인 요청을 알려드려요."; public init() {} }
    public private(set) var view = View()
    private let identity: () -> MemberApprovalIdentity?
    private let load: () throws -> AccountPushPreference
    private let save: (AccountPushPreference) throws -> Void
    private let call: (MemberApprovalIdentity, String, String, [String: String]?) async throws -> Void
    private let changed: (View) -> Void
    private let teamCapabilities: ((MemberApprovalIdentity) async throws -> [String])?
    private let registerTeam: ((MemberApprovalIdentity, String, [String: String], [String]) async throws -> Void)?
    private let openTeam: ((MemberApprovalIdentity, String, AccountPushReference) async throws -> TeamPushDestination)?
    public struct Opened: Sendable { public let kind: String; public let team: TeamPushDestination? }
    private var generation = UUID(), registeredToken = ""
    private var queuedToken: String?
    private var transportTail: Task<Void, Never>?
    private var registration: (id: UUID, task: Task<Void, Error>)?
    private var registeredIdentity: MemberApprovalIdentity?
    public init(identity: @escaping () -> MemberApprovalIdentity?, load: @escaping () throws -> AccountPushPreference, save: @escaping (AccountPushPreference) throws -> Void,
                call: @escaping (MemberApprovalIdentity, String, String, [String: String]?) async throws -> Void, changed: @escaping (View) -> Void,
                teamCapabilities: ((MemberApprovalIdentity) async throws -> [String])? = nil,
                registerTeam: ((MemberApprovalIdentity, String, [String: String], [String]) async throws -> Void)? = nil,
                openTeam: ((MemberApprovalIdentity, String, AccountPushReference) async throws -> TeamPushDestination)? = nil) {
        self.identity = identity; self.load = load; self.save = save; self.call = call; self.changed = changed
        self.teamCapabilities = teamCapabilities; self.registerTeam = registerTeam; self.openTeam = openTeam
    }
    public var enabled: Bool { (try? load().matches(identity())) == true }
    public func invalidate() { generation = UUID(); queuedToken = nil; registeredToken = ""; registeredIdentity = nil; view = .init(); changed(view) }
    public func unavailable(_ message: String) { view.status = message; changed(view) }
    public var permissionTicket: UUID { generation }
    public func acceptsPermission(_ ticket: UUID) -> Bool { generation == ticket && enabled }
    public func enable() -> Bool {
        guard !view.busy, let account = identity() else { return false }
        generation = UUID()
        do { var pref = try load(); try pref.validate(); pref.accountID = account.accountID; pref.sessionID = account.sessionID; pref.enabled = true; try save(pref); return true }
        catch { unavailable("알림 설정을 저장하지 못했어요."); return false }
    }
    public func register(_ token: String) async {
        if view.busy { queuedToken = token; return }
        guard enabled, let account = identity(), token.range(of: "^[a-f0-9]{16,1024}$", options: .regularExpression) != nil, token.count % 2 == 0 else { return }
        guard registeredToken != token || registeredIdentity != account else { return }
        let g = generation; view.busy = true; changed(view)
        defer { if generation == g {
            view.busy = false; changed(view)
            let next = queuedToken; queuedToken = nil
            if let next, next != token { Task { await self.register(next) } }
        } }
        do {
            let pref = try load(); try pref.validate(); guard pref.matches(account) else { return }
            let id = UUID(), previous = transportTail
            let task = Task {
                await previous?.value
                guard self.generation == g, self.identity() == account, self.enabled else { throw CancellationError() }
                let capabilities = try TeamPushCapabilities.supported(await self.teamCapabilities?(account))
                guard self.generation == g, self.identity() == account, self.enabled else { throw CancellationError() }
                let body = ["schema": "hps-push-device/1", "platform": "ios", "token": token, "permission": "granted"]
                if !capabilities.isEmpty {
                    guard let registerTeam = self.registerTeam, self.openTeam != nil else { throw SyncFailure.invalidResponse }
                    try await registerTeam(account, pref.installation, body, capabilities)
                } else { try await self.call(account, "PUT", pref.installation, body) }
            }
            transportTail = Task { _ = await task.result }
            registration = (id, task)
            defer { if registration?.id == id { registration = nil } }
            try await task.value
            guard generation == g, identity() == account, enabled else { return }
            registeredToken = token; registeredIdentity = account; view.status = "이 계정의 알림을 켰어요."
        } catch { if generation == g && identity() == account { view.status = "알림을 등록하지 못했어요. 질문과 확인 요청에서 직접 확인할 수 있어요." } }
    }
    public func disable() async {
        let account = identity(); invalidate(); let g = generation
        do {
            var pref = try load(); try pref.validate(); let wasOwn = pref.matches(account); pref.enabled = false; try save(pref)
            unavailable("이 기기의 알림을 껐어요.")
            if wasOwn, let account {
                let previous = transportTail
                let task = Task {
                    await previous?.value
                    guard self.generation == g, self.identity() == account, !self.enabled else { return }
                    try? await self.call(account, "DELETE", pref.installation, nil)
                }
                transportTail = task; await task.value
            }
        } catch { unavailable("알림 설정을 저장하지 못했어요. 시스템 설정에서도 알림을 꺼 주세요.") }
    }
    public func open(_ reference: AccountPushReference) async -> String? { await openDestination(reference)?.kind }
    public func openDestination(_ reference: AccountPushReference) async -> Opened? {
        guard !view.busy, enabled, let account = identity() else { return nil }
        let g = generation; view.busy = true; changed(view)
        defer { if generation == g { view.busy = false; changed(view) } }
        do {
            let pref = try load(); try pref.validate(); guard pref.matches(account) else { return nil }
            var destination: TeamPushDestination?
            if reference.kind == "team_request" {
                guard let openTeam else { throw SyncFailure.invalidResponse }
                destination = try await openTeam(account, pref.installation, reference)
                guard destination?.requestID == reference.id, destination?.eventSequence == reference.revision else { throw SyncFailure.invalidResponse }
            } else { try await call(account, "POST", pref.installation + "/opened", ["schema": "hps-push-open/1", "delivery_id": reference.deliveryID]) }
            guard generation == g, identity() == account, enabled else { return nil }
            return Opened(kind: reference.kind, team: destination)
        } catch { if generation == g && identity() == account { unavailable("이 알림을 확인하지 못했어요. 현재 질문과 확인 요청에서 직접 확인해 주세요.") }; return nil }
    }
}
