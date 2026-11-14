import Foundation

/// Closed, content-free client observations. These never authorize a question or approval.
public struct ProductExperienceEvent: Codable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case questionPresented = "question.presented", questionAnswered = "question.answered", questionSkipped = "question.skipped"
        case voiceFinished = "voice.tts_finished", voiceResumed = "voice.listening_resumed", voiceFinal = "voice.final", voiceFailed = "journey.failed"
        case reflectionStarted = "reflection.send_started", reflectionAnswered = "reflection.answer_received"
        var journey: String { rawValue.hasPrefix("question.") ? "question" : rawValue.hasPrefix("reflection.") ? "reflection" : "voice" }
    }
    public let id, journey_id, journey, type, platform, app_version: String
    public let failure_class: String?
    public init(_ kind: Kind, journeyID: String, version: String) {
        id = UUID().uuidString.lowercased(); journey_id = journeyID; journey = kind.journey; type = kind.rawValue; platform = "ios"; app_version = version
        failure_class = kind == .voiceFailed ? "unexpected_state" : nil
    }
    public func validate() throws {
        guard UUID(uuidString: id)?.uuidString.lowercased() == id, UUID(uuidString: journey_id)?.uuidString.lowercased() == journey_id,
              let kind = Kind(rawValue: type), kind.journey == journey, platform == "ios",
              app_version.range(of: "^[0-9]{1,4}\\.[0-9]{1,6}\\.[0-9]{1,6}([-+][a-z0-9.]{1,32})?$", options: .regularExpression) != nil,
              failure_class == (kind == .voiceFailed ? "unexpected_state" : nil) else { throw SyncFailure.invalidResponse }
    }
}
public struct ProductExperienceConsent: Sendable { public let title, notice: String; public let granted: Bool }
public struct ProductExperienceQueue: Codable, Sendable {
    public var expiresAt: Date = .distantPast
    public var denied = false
    public var events: [ProductExperienceEvent] = []
    public init() {}
    public func validate() throws { guard expiresAt.timeIntervalSince1970.isFinite, events.count <= 40, Set(events.map(\.id)).count == events.count else { throw SyncFailure.invalidResponse }; try events.forEach { try $0.validate() } }
}

@MainActor public final class ProductExperienceController {
    public struct View { public var available = false, busy = false, granted = false; public var title = "사용 경험 공유", notice = "", status = ""; public init() {} }
    public private(set) var view = View()
    private let identity: () -> MemberApprovalIdentity?
    private let consent: (MemberApprovalIdentity, Bool?) async throws -> ProductExperienceConsent
    private let send: (MemberApprovalIdentity, [ProductExperienceEvent]) async throws -> Set<String>
    private let load: (String) throws -> ProductExperienceQueue
    private let save: (String, ProductExperienceQueue) throws -> Void
    private let changed: (View) -> Void
    private let version: String
    private var binding: MemberApprovalIdentity?, generation = UUID(), journeys: [String: String] = [:]
    private var queue = ProductExperienceQueue(), lastAttempt = Date.distantPast, sending = false
    private var flushTask: Task<Void, Never>?
    public init(identity: @escaping () -> MemberApprovalIdentity?, version: String,
                consent: @escaping (MemberApprovalIdentity, Bool?) async throws -> ProductExperienceConsent,
                send: @escaping (MemberApprovalIdentity, [ProductExperienceEvent]) async throws -> Set<String>,
                load: @escaping (String) throws -> ProductExperienceQueue, save: @escaping (String, ProductExperienceQueue) throws -> Void,
                changed: @escaping (View) -> Void) {
        self.identity = identity; self.version = version; self.consent = consent; self.send = send; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); flushTask?.cancel(); flushTask = nil; binding = nil; queue = .init(); view = .init(); sending = false; journeys = [:]; changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) -> Bool { generation == g && identity() == account && binding == account }
    public func refresh() async {
        guard !view.busy, !sending, let account = identity() else { return }
        if binding != account { invalidate(); binding = account }
        let g = generation; view.busy = true; view.granted = false; changed(view)
        do {
            var saved = try load(account.accountID); try saved.validate()
            if saved.expiresAt <= Date() { saved.events = []; try save(account.accountID, saved) }
            let result = try await consent(account, nil); guard current(g, account) else { return }
            queue = saved; view.available = true; view.title = result.title; view.notice = result.notice; view.granted = result.granted && !saved.denied; view.status = ""
        } catch { if current(g, account) { view.available = false; view.granted = false; view.status = "공유 설정을 확인하지 못했어요. 대화와 질문은 그대로 사용할 수 있어요." } }
        if current(g, account) { view.busy = false; changed(view); await flush() }
    }
    public func choose(_ granted: Bool) async {
        guard view.available, !view.busy, let account = binding, identity() == account else { return }
        generation = UUID(); flushTask?.cancel(); sending = false; let g = generation
        view.busy = true; view.granted = false; changed(view)
        do {
            // Declining stops new collection immediately and survives restart, even if the POST fails.
            if !granted { var next = queue; next.denied = true; next.events = []; try save(account.accountID, next); queue = next }
            let result = try await consent(account, granted); guard current(g, account) else { return }
            var next = queue; next.denied = !granted; if !granted { next.events = [] }; try save(account.accountID, next); queue = next
            view.granted = granted && result.granted; view.title = result.title; view.notice = result.notice
            view.status = view.granted ? "사용 경험 공유를 켰어요." : "사용 경험을 공유하지 않아요."
        } catch { if current(g, account) { view.status = "공유 설정을 저장하지 못했어요. 이 화면에서는 수집을 멈췄어요." } }
        if current(g, account) { view.busy = false; changed(view) }
    }
    public func record(_ kind: ProductExperienceEvent.Kind) {
        guard view.granted, !queue.denied, let account = binding, identity() == account else { return }
        do {
            if journeys[kind.journey] == nil || [.questionPresented, .reflectionStarted, .voiceFinal].contains(kind) { journeys[kind.journey] = UUID().uuidString.lowercased() }
            let event = ProductExperienceEvent(kind, journeyID: journeys[kind.journey]!, version: version); try event.validate()
            var next = queue; if next.expiresAt <= Date() { next.events = [] }; guard next.events.count < 40 else { return }; if next.events.isEmpty { next.expiresAt = Date().addingTimeInterval(30 * 86400) }; next.events.append(event); try save(account.accountID, next); queue = next
            if Date().timeIntervalSince(lastAttempt) >= 30 { flushTask = Task { await self.flush() } }
        } catch { /* Observability can never block conversation or manufacture durable success. */ }
    }
    public func flush() async {
        guard view.granted, !queue.denied, !sending, !queue.events.isEmpty, let account = binding, identity() == account else { return }
        let g = generation, batch = Array(queue.events.prefix(20)); sending = true; lastAttempt = Date()
        do {
            let accepted = try await send(account, batch); guard current(g, account) else { return }
            guard accepted.isSubset(of: Set(batch.map(\.id))) else { throw SyncFailure.invalidResponse }
            var next = queue; next.events.removeAll { accepted.contains($0.id) }; try save(account.accountID, next); queue = next
        } catch { /* Retry only these persisted immutable events on a later explicit refresh/new event. */ }
        if current(g, account) { sending = false }
    }
}
