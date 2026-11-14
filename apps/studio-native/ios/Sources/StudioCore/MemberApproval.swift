import Foundation

public enum MemberApprovalChoice: String, Codable, Sendable { case approve, reject, question }
public struct MemberApprovalIdentity: Equatable, Sendable {
    public let accountID: String, sessionID: String
    public init(accountID: String, sessionID: String) { self.accountID = accountID; self.sessionID = sessionID }
}
public struct MemberApprovalCard: Codable, Identifiable, Sendable {
    public struct Source: Codable, Sendable { public let repo: String; public let pr: Int; public let head, base, policy_digest, evidence_digest, context_digest: String }
    public struct Brief: Codable, Sendable { public let authored, verified: [String] }
    public struct Decision: Codable, Sendable { public let id: String; public let choice: MemberApprovalChoice; public let status: String; public let created_at: Double }
    public struct Review: Codable, Sendable {
        public struct User: Codable, Sendable { public let login: String }
        public let id: Int; public let state, commit_id, html_url: String; public let user: User
    }
    public let id, request_digest: String
    public let source: Source
    public let reviewer: String
    public let brief: Brief
    public let state: String
    public let created_at, expires_at, lease_expires_at: Double
    public let can_decide: Bool
    public let unavailable_reason: String?
    public let decision: Decision?
    public let review: Review?
    public static func validID(_ value: String) -> Bool {
        let bytes = value.utf8
        return (1...128).contains(bytes.count) && value != "." && value != ".." && bytes.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45, 46, 58, 95].contains($0) }
    }
    static func hex(_ value: String, count: Int = 64) -> Bool { value.utf8.count == count && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    static func safeText(_ value: String, max: Int) -> Bool { !value.isEmpty && value.unicodeScalars.count <= max && !value.contains("\0") }
    public func validate() throws {
        let repo = source.repo.split(separator: "/", omittingEmptySubsequences: false)
        guard Self.validID(id), Self.hex(request_digest), repo.count == 2, repo[0] == "hypeproof", String(repo[1]).utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,46,95].contains($0) }) && !repo[1].isEmpty,
              source.pr > 0, Self.hex(source.head, count: 40), Self.hex(source.base, count: 40),
              [source.policy_digest, source.evidence_digest, source.context_digest].allSatisfy({ Self.hex($0) }),
              Self.safeText(reviewer, max: 100), [brief.authored, brief.verified].allSatisfy({ !$0.isEmpty && $0.count <= 30 && $0.allSatisfy { Self.safeText($0, max: 2000) } }),
              ["pending", "delivered", "questioned", "declined", "superseded", "expired", "submitting", "submitted", "unknown"].contains(state),
              [created_at, expires_at, lease_expires_at].allSatisfy(\.isFinite), unavailable_reason == nil || Self.safeText(unavailable_reason!, max: 500) else { throw SyncFailure.invalidResponse }
        if let decision {
            guard Self.validID(decision.id), decision.created_at.isFinite,
                  ["awaiting_processing", "needs_fresh_confirmation", "submitted", "declined", "questioned", "superseded", "expired", "unknown"].contains(decision.status) else { throw SyncFailure.invalidResponse }
        }
        if let review {
            guard review.id > 0, review.state == "APPROVED", review.commit_id == source.head, review.user.login == reviewer,
                  review.html_url == "https://github.com/\(source.repo)/pull/\(source.pr)#pullrequestreview-\(review.id)" else { throw SyncFailure.invalidResponse }
        }
    }
    public func canDecide(now: Double) -> Bool {
        can_decide && ["pending", "delivered"].contains(state) && decision == nil && review == nil && expires_at > now && lease_expires_at > now && lease_expires_at <= now + 60
    }
    public var terminal: Bool {
        !can_decide && !["awaiting_processing", "unknown"].contains(decision?.status ?? "") && (["declined", "questioned", "superseded", "expired"].contains(state) || (state == "submitted" && review != nil))
    }
    public var statusLabel: String {
        if review != nil && state == "submitted" { return "GitHub 승인 반영됨" }
        if decision?.status == "needs_fresh_confirmation" { return "확인 시간이 지났어요. 새 요청이 있는지 확인해 주세요." }
        if decision?.status == "awaiting_processing" { return "선택을 전달했어요 · 처리 대기" }
        return ["pending": "확인을 기다려요", "delivered": "확인을 기다려요", "questioned": "설명을 요청했어요", "declined": "보류했어요", "superseded": "버전이 바뀌었어요", "expired": "확인 시간이 지났어요", "submitting": "승인 결과 확인 중", "submitted": "처리 결과 확인 중", "unknown": "처리 결과를 아직 확인하지 못했어요"][state] ?? "다시 확인해 주세요"
    }
}
public struct MemberApprovalInbox: Decodable, Sendable {
    public let schema, availability: String
    public let cards: [MemberApprovalCard]
    public func validate() throws {
        guard schema == "hps-member-approval-inbox/1", ["ready", "not_enrolled", "unavailable"].contains(availability), cards.count <= 50, Set(cards.map(\.id)).count == cards.count else { throw SyncFailure.invalidResponse }
        for card in cards { try card.validate() }
    }
}
public struct MemberApprovalPending: Codable, Sendable {
    public let accountID, sessionID, cardID, request_digest, id: String
    public let choice: MemberApprovalChoice
    public init(identity: MemberApprovalIdentity, card: MemberApprovalCard, choice: MemberApprovalChoice, id: String = UUID().uuidString.lowercased()) {
        accountID = identity.accountID; sessionID = identity.sessionID; cardID = card.id; request_digest = card.request_digest; self.id = id; self.choice = choice
    }
    public func validate(account: String) throws {
        guard accountID == account, StoredAccount.validID(accountID), StoredAccount.validID(sessionID), MemberApprovalCard.validID(cardID), MemberApprovalCard.hex(request_digest), UUID(uuidString: id)?.uuidString.lowercased() == id else { throw SyncFailure.invalidResponse }
    }
}
/// Core controller executes real account transport supplied by the host; refresh never posts a decision.
@MainActor public final class MemberApprovalController {
    public struct View {
        public var status = "signedOut", cards: [MemberApprovalCard] = [], pending: [MemberApprovalPending] = [], busy = false
        public var entryVisible = false
        public var message: String?
        public init() {}
    }
    public private(set) var view = View()
    private var epoch = UUID()
    private var binding: MemberApprovalIdentity?
    private var enrolled: MemberApprovalIdentity?
    private let identity: () async throws -> MemberApprovalIdentity?
    private let list: (MemberApprovalIdentity) async throws -> MemberApprovalInbox
    private let card: (MemberApprovalIdentity, String, MemberApprovalPending?) async throws -> MemberApprovalCard
    private let load: (String) throws -> [MemberApprovalPending]
    private let save: (String, MemberApprovalPending) throws -> Void
    private let remove: (String, String) throws -> Void
    private let changed: (View) -> Void
    private let now: () -> Double
    public init(identity: @escaping () async throws -> MemberApprovalIdentity?, list: @escaping (MemberApprovalIdentity) async throws -> MemberApprovalInbox,
                card: @escaping (MemberApprovalIdentity, String, MemberApprovalPending?) async throws -> MemberApprovalCard,
                load: @escaping (String) throws -> [MemberApprovalPending], save: @escaping (String, MemberApprovalPending) throws -> Void,
                remove: @escaping (String, String) throws -> Void, now: @escaping () -> Double = { Date().timeIntervalSince1970 }, changed: @escaping (View) -> Void) {
        self.identity = identity; self.list = list; self.card = card; self.load = load; self.save = save; self.remove = remove; self.now = now; self.changed = changed
    }
    private func publish() { view.entryVisible = enrolled != nil; changed(view) }
    public func invalidate() { enrolled = nil; dismiss() }
    public func dismiss() { epoch = UUID(); binding = nil; view = View(); publish() }
    public func discover() async { await refresh(quiet: true) }
    private func current(_ attempt: UUID, _ expected: MemberApprovalIdentity) async throws -> Bool {
        guard attempt == epoch else { return false }; let latest = try await identity(); return attempt == epoch && latest == expected
    }
    public func refresh(quiet: Bool = false) async {
        guard !view.busy else { return }
        epoch = UUID(); let attempt = epoch; var listRead = false
        view = View(); view.status = "loading"; view.busy = true; publish()
        do {
            guard let identity = try await identity() else { if attempt == epoch { invalidate() }; return }
            guard attempt == epoch else { return }; binding = identity
            if enrolled != identity { enrolled = nil }
            let response = try await list(identity); try response.validate(); listRead = true
            guard try await current(attempt, identity) else { if attempt == epoch { invalidate() }; return }
            enrolled = response.availability == "ready" ? identity : nil
            let pending: [MemberApprovalPending]
            if !quiet && enrolled != nil { pending = try load(identity.accountID) } else { pending = [] }
            guard pending.count <= 50 else { throw SyncFailure.invalidResponse }
            for item in pending { try item.validate(account: identity.accountID) }
            var cards = !quiet && enrolled != nil ? response.cards : []
            var retained: [MemberApprovalPending] = []
            for item in pending {
                let resolved = try await card(identity, item.cardID, nil); try resolved.validate()
                guard try await current(attempt, identity) else { if attempt == epoch { invalidate() }; return }
                guard resolved.id == item.cardID, resolved.request_digest == item.request_digest else { throw SyncFailure.invalidResponse }
                if let index = cards.firstIndex(where: { $0.id == resolved.id }) { cards[index] = resolved } else { cards.append(resolved) }
                if resolved.terminal { try remove(identity.accountID, item.id) } else { retained.append(item) }
            }
            view.status = response.availability; view.cards = cards; view.pending = retained; view.busy = false
        } catch {
            if attempt == epoch {
                var unavailable = false
                if case SyncFailure.http(let status, let code) = error {
                    unavailable = !listRead && (status == 404 || code == "approval_inbox_unavailable")
                    if unavailable || status == 401 || status == 403 { enrolled = nil }
                }
                view = View(); view.status = unavailable ? "unavailable" : "error"
                view.message = unavailable ? "지금은 확인 요청함을 이용할 수 없어요." : "요청함을 확인하지 못했어요. 다시 확인해 주세요."
            }
        }
        if attempt == epoch { publish() }
    }
    public func decide(id: String, digest: String, choice: MemberApprovalChoice) async {
        guard view.pending.count < 50, view.status == "ready", !view.busy, let binding, let candidate = view.cards.first(where: { $0.id == id }), candidate.request_digest == digest,
              candidate.canDecide(now: now()), !view.pending.contains(where: { $0.cardID == id }) else { return }
        let attempt = epoch; view.busy = true; view.message = nil; publish(); var stored = false
        do {
            guard try await current(attempt, binding) else { if attempt == epoch { invalidate() }; return }
            let pending = MemberApprovalPending(identity: binding, card: candidate, choice: choice)
            try save(binding.accountID, pending); stored = true
            view.pending.append(pending)
            guard try await current(attempt, binding) else { if attempt == epoch { invalidate() }; return }
            guard candidate.canDecide(now: now()) else { throw SyncFailure.invalidResponse }
            let resolved = try await card(binding, id, pending); try resolved.validate()
            guard try await current(attempt, binding) else { if attempt == epoch { invalidate() }; return }
            guard resolved.id == id, resolved.request_digest == digest else { throw SyncFailure.invalidResponse }
            view.cards = view.cards.map { $0.id == id ? resolved : $0 }; view.message = "선택을 전달했어요. 실제 처리 결과를 확인해 주세요."
        } catch {
            if attempt == epoch { view.cards = []; view.status = "error"; view.message = stored ? "처리 결과를 확인하지 못했어요. 같은 요청을 다시 조회해 주세요. 자동으로 다시 보내지 않아요." : "선택을 안전하게 저장하지 못했어요. 전송하지 않았어요." }
        }
        if attempt == epoch { view.busy = false; publish() }
    }
}

/// One credential rotation shared by foreground inbox and conversation polling.
/// An old flight may settle, but cannot return a token after identity invalidation.
@MainActor public final class AccountTokenRefreshFlight {
    private var flight: (id: UUID, identity: MemberApprovalIdentity, task: Task<String, Error>)?
    private var generation = UUID()
    public init() {}
    public func invalidate() { generation = UUID(); flight = nil }
    public func run(identity: MemberApprovalIdentity, current: @escaping () -> MemberApprovalIdentity?, renew: @escaping () async throws -> String) async throws -> String {
        let expected = generation
        let running: (id: UUID, identity: MemberApprovalIdentity, task: Task<String, Error>)
        if let existing = flight, existing.identity == identity { running = existing }
        else {
            running = (UUID(), identity, Task { try await renew() })
            flight = running
        }
        defer { if flight?.id == running.id { flight = nil } }
        let token = try await running.task.value
        guard generation == expected, current() == identity else { throw CancellationError() }
        return token
    }
}
