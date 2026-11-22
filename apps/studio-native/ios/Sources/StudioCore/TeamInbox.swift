import Foundation

public struct TeamSubscription: Codable, Equatable, Sendable {
    public let scope_key, product: String
    public let request_id: String?
    public let revision, start_after_sequence: Int
    public let enabled: Bool
    public let created_at: Double
    public func validate() throws {
        guard TeamRequestDraft.products.contains(product), request_id == nil || TeamRequestRecord.validID(request_id!),
              scope_key == (request_id.map({ "r:" + $0 }) ?? "p:" + product),
              revision > 0, revision <= 1_000_000_001, start_after_sequence >= 0, start_after_sequence <= 9_007_199_254_740_991,
              created_at.isFinite, created_at > 0 else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamSubscriptionPage: Codable, Sendable {
    public let schema: String
    public let default_enabled: Bool
    public let subscriptions: [TeamSubscription]
    public func validate() throws {
        guard schema == "hps-team-subscriptions/1", !default_enabled, subscriptions.count <= 100,
              Set(subscriptions.map(\.scope_key)).count == subscriptions.count else { throw SyncFailure.invalidResponse }
        try subscriptions.forEach { try $0.validate() }
    }
}
public struct TeamSubscriptionMutation: Codable, Sendable {
    public enum Phase: String, Codable, Sendable { case uncertain, conflict, received }
    public let accountID, key, product: String
    public let requestID: String?
    public let expectedRevision: Int
    public let enabled: Bool
    public var phase: Phase = .uncertain
    public var receipt: TeamSubscription?
    public var scope: String { requestID.map { "r:" + $0 } ?? "p:" + product }
    public init(accountID: String, product: String, requestID: String?, expectedRevision: Int, enabled: Bool) {
        self.accountID = accountID; self.key = UUID().uuidString.lowercased(); self.product = product
        self.requestID = requestID; self.expectedRevision = expectedRevision; self.enabled = enabled
    }
    public func validate(account: String) throws {
        guard accountID == account, StoredAccount.validID(accountID), UUID(uuidString: key)?.uuidString.lowercased() == key,
              TeamRequestDraft.products.contains(product), requestID == nil || TeamRequestRecord.validID(requestID!),
              expectedRevision >= 0, expectedRevision <= 1_000_000_000,
              (phase == .received) == (receipt != nil) else { throw SyncFailure.invalidResponse }
        if let receipt { try receipt.validate(); guard matches(receipt) else { throw SyncFailure.invalidResponse } }
    }
    public func matches(_ receipt: TeamSubscription) -> Bool {
        receipt.scope_key == scope && receipt.product == product && receipt.request_id == requestID
            && receipt.revision == expectedRevision + 1 && receipt.enabled == enabled
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID)
        return ["schema":"hps-team-subscription/1", "client_mutation_id":key, "expected_revision":expectedRevision,
                "product":product, "request_id":requestID as Any? ?? NSNull(), "enabled":enabled]
    }
}
public struct TeamInboxItem: Codable, Sendable, Identifiable, Equatable {
    public let sequence, source_revision: Int
    public let product, request_id, kind, source_id, label: String
    public let created_at: Double
    public var read_at: Double?
    public let version, build, availability, action, evidence_kind, device_installed: String?
    public let valid_until: Double?
    public var intent: String? = nil
    public var reply_to: String? = nil
    public var id: Int { sequence }
    public func validate() throws {
        guard sequence > 0, sequence <= 9_007_199_254_740_991, source_revision > 0, source_revision <= 9_007_199_254_740_991,
              TeamRequestDraft.products.contains(product), TeamRequestRecord.validID(request_id),
              created_at.isFinite, created_at > 0, read_at == nil || (read_at!.isFinite && read_at! > 0) else { throw SyncFailure.invalidResponse }
        if kind == "request_question" || kind == "comment" {
            guard source_revision == 1, version == nil, build == nil, action == nil, evidence_kind == nil, device_installed == nil,
                  availability == nil, valid_until == nil else { throw SyncFailure.invalidResponse }
            if kind == "request_question" {
                guard source_id == request_id, label == "question_posted", intent == "question", reply_to == nil else { throw SyncFailure.invalidResponse }
            } else {
                guard source_id.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil,
                      ["discussion":"discussion_added", "question":"question_posted", "reply":"reply_posted"][intent ?? ""] == label else { throw SyncFailure.invalidResponse }
                if intent == "reply" {
                    guard let reply_to, reply_to == request_id || reply_to.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil else { throw SyncFailure.invalidResponse }
                } else if reply_to != nil { throw SyncFailure.invalidResponse }
            }
            return
        }
        guard let version, let build, version.count <= 32, build.count <= 32,
              version.range(of: "^[0-9]+(?:\\.[0-9]+){0,2}$", options: .regularExpression) != nil,
              build.range(of: "^[0-9]+\\.[0-9]+$", options: .regularExpression) != nil,
              device_installed == "not_observed", intent == nil, reply_to == nil else { throw SyncFailure.invalidResponse }
        if kind == "delivery" {
            guard label == "build_linked", source_id.range(of: "^tdl_[a-f0-9]{32}$", options: .regularExpression) != nil,
                  ["group_available", "not_established"].contains(availability ?? ""), let valid_until,
                  valid_until.isFinite, valid_until > 0, action == nil, evidence_kind == nil else { throw SyncFailure.invalidResponse }
        } else if kind == "outcome" {
            guard label == "reporter_response", source_id.range(of: "^tor_[a-f0-9]{32}$", options: .regularExpression) != nil,
                  ["resolved", "reopened"].contains(action ?? ""), evidence_kind == "reporter_self_reported",
                  availability == nil, valid_until == nil else { throw SyncFailure.invalidResponse }
        } else { throw SyncFailure.invalidResponse }
    }
    public func groupAvailable(at date: Date) -> Bool { kind == "delivery" && availability == "group_available" && (valid_until ?? 0) > date.timeIntervalSince1970 * 1000 }
}
public struct TeamInboxPage: Codable, Sendable {
    public let schema: String
    public let items: [TeamInboxItem]
    public let next_cursor: String?
    public let catchup_pending: Bool
    public let scan_limit: Int
    public func validate(after: String?) throws {
        guard schema == "hps-team-inbox/1", scan_limit == 100, items.count <= 50 else { throw SyncFailure.invalidResponse }
        var previous = Int(after ?? "0") ?? -1
        guard previous >= 0 else { throw SyncFailure.invalidResponse }
        for item in items { try item.validate(); guard item.sequence > previous else { throw SyncFailure.invalidResponse }; previous = item.sequence }
        if let next_cursor {
            guard let value = Int(next_cursor), String(value) == next_cursor, value > (Int(after ?? "0") ?? 0), value <= 9_007_199_254_740_991,
                  value >= (items.last?.sequence ?? 0) else { throw SyncFailure.invalidResponse }
        }
    }
}

@MainActor public final class TeamInboxController {
    public struct View {
        public var items: [TeamInboxItem] = [], subscriptions: [TeamSubscription] = []
        public var products: [String] = []
        public var pending: TeamSubscriptionMutation?
        public var page: TeamInboxPage?
        public var busy = false, storageReady = true, subscriptionsCurrent = false
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private let identity: () async throws -> MemberApprovalIdentity?
    private let access: (MemberApprovalIdentity) async throws -> TeamRequestAccess
    private let subscriptions: (MemberApprovalIdentity) async throws -> TeamSubscriptionPage
    private let inbox: (MemberApprovalIdentity, String?) async throws -> TeamInboxPage
    private let mutate: (MemberApprovalIdentity, TeamSubscriptionMutation) async throws -> TeamSubscription
    private let detail: (MemberApprovalIdentity, String) async throws -> TeamRequestDetail
    private let read: (MemberApprovalIdentity, Int) async throws -> Double
    private let load: (String) throws -> TeamSubscriptionMutation?
    private let save: (TeamSubscriptionMutation) throws -> Void
    private let changed: (View) -> Void
    private var binding: MemberApprovalIdentity?, generation = UUID(), cursor: String?
    public init(identity: @escaping () async throws -> MemberApprovalIdentity?, access: @escaping (MemberApprovalIdentity) async throws -> TeamRequestAccess,
                subscriptions: @escaping (MemberApprovalIdentity) async throws -> TeamSubscriptionPage, inbox: @escaping (MemberApprovalIdentity, String?) async throws -> TeamInboxPage,
                mutate: @escaping (MemberApprovalIdentity, TeamSubscriptionMutation) async throws -> TeamSubscription,
                detail: @escaping (MemberApprovalIdentity, String) async throws -> TeamRequestDetail, read: @escaping (MemberApprovalIdentity, Int) async throws -> Double,
                load: @escaping (String) throws -> TeamSubscriptionMutation?, save: @escaping (TeamSubscriptionMutation) throws -> Void, changed: @escaping (View) -> Void) {
        self.identity = identity; self.access = access; self.subscriptions = subscriptions; self.inbox = inbox; self.mutate = mutate
        self.detail = detail; self.read = read; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; cursor = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async -> Bool {
        guard generation == g else { return false }; let now = try? await identity()
        guard generation == g else { return false }; guard now == account else { invalidate(); return false }; return true
    }
    private func persist(_ mutation: TeamSubscriptionMutation) throws { do { try save(mutation) } catch { view.storageReady = false; throw error } }
    public func preference(product: String, request: String?) -> TeamSubscription? {
        let scope = request.map { "r:" + $0 } ?? "p:" + product
        return view.subscriptions.first { $0.scope_key == scope && $0.product == product }
    }
    public func effectiveEnabled(product: String, request: String?) -> Bool {
        preference(product: product, request: request)?.enabled ?? preference(product: product, request: nil)?.enabled ?? false
    }
    public func open() async {
        guard !view.busy, view.storageReady else { return }
        generation = UUID(); let g = generation; view.busy = true; view.items = []; view.page = nil; view.subscriptions = []; view.products = []; view.subscriptionsCurrent = false; view.message = ""; changed(view)
        defer { if generation == g { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity(), generation == g else { if generation == g { invalidate() }; return }
            if binding != account { view = View(); view.busy = true }; binding = account
            do { let pending = try load(account.accountID); try pending?.validate(account: account.accountID); view.pending = pending }
            catch { view.storageReady = false; view.message = "저장된 설정을 읽지 못했어요. 원본을 보존했어요."; return }
            let admitted = try await access(account); try admitted.validate(account: account.accountID)
            let preferences = try await subscriptions(account); try preferences.validate()
            let page = try await inbox(account, nil); try page.validate(after: nil)
            guard await current(g, account) else { return }
            guard preferences.subscriptions.allSatisfy({ admitted.products.contains($0.product) }), page.items.allSatisfy({ admitted.products.contains($0.product) }) else { throw SyncFailure.invalidResponse }
            view.products = admitted.products; view.subscriptions = preferences.subscriptions; view.subscriptionsCurrent = true
            if let receipt = view.pending?.receipt, (preference(product: receipt.product, request: receipt.request_id)?.revision ?? 0) < receipt.revision { view.subscriptionsCurrent = false }
            view.items = page.items; view.page = page; cursor = nil
        } catch { if let account = binding, await current(g, account) { view.message = "팀 알림을 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    public func more() async {
        guard !view.busy, let account = binding, let previous = view.page, view.items.count < 500,
              previous.next_cursor != nil || previous.catchup_pending else { return }
        let after = previous.next_cursor ?? cursor, g = generation; view.busy = true; changed(view)
        defer { if generation == g { view.busy = false; changed(view) } }
        do {
            let page = try await inbox(account, after); try page.validate(after: after)
            guard await current(g, account) else { return }
            guard page.items.allSatisfy({ view.products.contains($0.product) }) else { throw SyncFailure.invalidResponse }
            var rows = Dictionary(uniqueKeysWithValues: view.items.map { ($0.sequence, $0) })
            for item in page.items { rows[item.sequence] = item }
            view.items = Array(rows.values.sorted { $0.sequence < $1.sequence }.prefix(500)); view.page = page; cursor = after
            view.message = view.items.count == 500 ? "한 번에 500개까지 표시해요. 새로고침해 최신 상태를 확인해 주세요." : ""
        } catch { if await current(g, account) { view.items = []; view.page = nil; view.message = "알림을 더 불러오지 못했어요. 새로고침해 주세요." } }
    }
    public func change(product: String, request: String?, enabled: Bool) async {
        guard !view.busy, view.storageReady, view.subscriptionsCurrent, let account = binding,
              view.products.contains(product), request == nil || TeamRequestRecord.validID(request!), view.pending?.phase != .uncertain else { return }
        let mutation = TeamSubscriptionMutation(accountID: account.accountID, product: product, requestID: request,
            expectedRevision: preference(product: product, request: request)?.revision ?? 0, enabled: enabled)
        await submit(mutation, account: account)
    }
    public func recover() async {
        guard !view.busy, view.storageReady, let account = binding, let pending = view.pending, pending.phase == .uncertain else { return }
        await submit(pending, account: account)
    }
    private func submit(_ original: TeamSubscriptionMutation, account: MemberApprovalIdentity) async {
        let g = generation; view.busy = true; changed(view); var pending = original
        defer { if generation == g { view.busy = false; changed(view) } }
        do {
            guard await current(g, account) else { return }; try pending.validate(account: account.accountID)
            try persist(pending); view.pending = pending
            let receipt = try await mutate(account, pending); try receipt.validate()
            guard await current(g, account) else { return }; guard pending.matches(receipt) else { throw SyncFailure.invalidResponse }
            pending.phase = .received; pending.receipt = receipt; view.pending = pending; try persist(pending)
            view.subscriptionsCurrent = false
            do {
                let page = try await subscriptions(account); try page.validate()
                guard await current(g, account) else { return }
                guard page.subscriptions.allSatisfy({ view.products.contains($0.product) }),
                      let current = page.subscriptions.first(where: { $0.scope_key == receipt.scope_key }), current.revision >= receipt.revision,
                      current.revision != receipt.revision || current == receipt else { throw SyncFailure.invalidResponse }
                view.subscriptions = page.subscriptions; view.subscriptionsCurrent = true; view.message = "알림 설정을 저장했어요."
                // A mute must not leave previously visible entries presented as currently admitted.
                view.items = []; view.page = nil
            } catch { if await current(g, account) { view.items = []; view.page = nil; view.message = "설정은 저장했지만 최신 상태를 읽지 못했어요. 새로고침해 주세요." } }
        } catch SyncFailure.http(409, let code) {
            if await current(g, account) {
                if code == "team_subscription_conflict" {
                    pending.phase = .conflict; view.pending = pending; try? persist(pending); view.subscriptionsCurrent = false
                    view.message = "설정이 바뀌어 이 선택은 저장되지 않았어요. 새로고침 후 다시 선택해 주세요."
                } else { view.message = "설정 저장 여부를 확인하지 못했어요. 같은 내용으로 직접 다시 확인해 주세요." }
            }
        } catch { if await current(g, account) { view.message = view.storageReady ? "설정 저장 여부를 확인하지 못했어요. 같은 내용으로 직접 다시 확인할 수 있어요." : "설정을 기기에 저장하지 못했어요. 추가 전송을 멈췄어요." } }
    }
    public func openItem(_ item: TeamInboxItem) async -> String? {
        guard !view.busy, let account = binding, view.items.contains(where: { $0.sequence == item.sequence && $0.request_id == item.request_id }) else { return nil }
        let g = generation; view.busy = true; changed(view)
        defer { if generation == g { view.busy = false; changed(view) } }
        do {
            let record = try await detail(account, item.request_id); try record.validate(id: item.request_id)
            guard record.request.product == item.product, await current(g, account) else { return nil }
            let readAt = try await read(account, item.sequence)
            guard readAt.isFinite, readAt > 0 else { throw SyncFailure.invalidResponse }
            guard await current(g, account) else { return nil }
            if let index = view.items.firstIndex(where: { $0.sequence == item.sequence }) { view.items[index].read_at = readAt }
            return item.request_id
        } catch { if await current(g, account) { view.message = "이 알림의 요청을 열 수 없어요. 권한과 최신 상태를 다시 확인해 주세요." }; return nil }
    }
}
