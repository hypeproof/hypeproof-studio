import Foundation

public struct TeamRequestAccess: Codable, Sendable {
    public let schema, account_id, notice_version: String
    public let products: [String]
    public func validate(account: String) throws {
        guard schema == "hps-team-request-access/1", account_id == account,
              !notice_version.isEmpty, notice_version.utf16.count <= 128,
              Set(products).count == products.count, products.allSatisfy(TeamRequestDraft.products.contains) else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamRequestDraft: Codable, Equatable, Sendable {
    public static let products = ["studio", "lab", "foundry"]
    public enum Phase: String, Codable, Sendable { case draft, uncertain, received }
    public let accountID, key: String
    public var product: String, category = "bug", body = "", noticeVersion = ""
    public var phase: Phase = .draft
    public var receipt: String?
    public init(accountID: String, product: String, key: String = UUID().uuidString.lowercased()) { self.accountID = accountID; self.product = product; self.key = key }
    public func validate(account: String) throws {
        guard accountID == account, StoredAccount.validID(accountID), UUID(uuidString: key)?.uuidString.lowercased() == key,
              Self.products.contains(product), ["bug", "improvement", "question"].contains(category), body.utf16.count <= 5000,
              !body.contains("\0"), noticeVersion.utf16.count <= 128,
              phase == .draft || !noticeVersion.isEmpty,
              phase != .received || receipt.map(TeamRequestRecord.validID) == true else { throw SyncFailure.invalidResponse }
    }
    public func payload() throws -> [String: String] {
        try validate(account: accountID)
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !noticeVersion.isEmpty else { throw SyncFailure.invalidResponse }
        return ["schema": "hps-team-request/1", "client_request_id": key, "product": product, "category": category, "body": body, "notice_version": noticeVersion]
    }
}
public struct TeamRequestRecord: Codable, Identifiable, Sendable {
    public let id, account_id, client_request_id, product, category, body, notice_version, status: String
    public let revision: Int
    public let created_at, updated_at: Double
    public static func validID(_ value: String) -> Bool { value.range(of: "^trq_[a-f0-9]{32}$", options: .regularExpression) != nil && value.count == 36 }
    public func validate() throws {
        guard Self.validID(id), StoredAccount.validID(account_id), client_request_id.utf16.count <= 64,
              TeamRequestDraft.products.contains(product), ["bug", "improvement", "question"].contains(category),
              !body.isEmpty, body.utf16.count <= 5000, !body.contains("\0"), notice_version.utf16.count <= 128,
              status == "submitted", revision > 0, created_at.isFinite, updated_at.isFinite, created_at > 0, updated_at >= created_at else { throw SyncFailure.invalidResponse }
    }
    public func matches(_ draft: TeamRequestDraft) -> Bool {
        account_id == draft.accountID && client_request_id == draft.key && product == draft.product && category == draft.category && body == draft.body && notice_version == draft.noticeVersion
    }
}
public struct TeamRequestPage: Decodable, Sendable {
    public let requests: [TeamRequestRecord]
    public let next_cursor: String?
    public func validate(product: String) throws {
        guard requests.count <= 50, Set(requests.map(\.id)).count == requests.count,
              next_cursor.map({ Self.validCursor($0, prefix: "trq_") }) ?? true else { throw SyncFailure.invalidResponse }
        for row in requests { try row.validate(); guard row.product == product else { throw SyncFailure.invalidResponse } }
    }
    public static func validCursor(_ value: String, prefix: String) -> Bool {
        value.count <= 60 && value.range(of: "^[0-9]{1,16}:" + prefix + "[a-f0-9]{32}$", options: .regularExpression) != nil && !value.contains("\n")
    }
}
public struct TeamRequestComment: Decodable, Identifiable, Sendable {
    public let id, request_id, account_id, client_comment_id, body: String
    public let created_at: Double
    public func validate(request: String) throws {
        guard id.count == 36, id.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil,
              request_id == request, StoredAccount.validID(account_id), !body.isEmpty, body.utf16.count <= 5000,
              !body.contains("\0"), created_at.isFinite, created_at > 0 else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamRequestDetail: Decodable, Sendable {
    public let request: TeamRequestRecord
    public let comments: [TeamRequestComment]
    public let next_comments_cursor: String?
    public func validate(id: String) throws {
        try request.validate()
        guard request.id == id, comments.count <= 100, Set(comments.map(\.id)).count == comments.count,
              next_comments_cursor.map({ TeamRequestPage.validCursor($0, prefix: "tcm_") }) ?? true else { throw SyncFailure.invalidResponse }
        for comment in comments { try comment.validate(request: id) }
    }
}

/// Account/session-bound intake. No automatic POST replay; an uncertain send keeps its stable key.
@MainActor public final class TeamRequestController {
    public struct View {
        public var access: TeamRequestAccess?, draft: TeamRequestDraft?
        public var requests: [TeamRequestRecord] = []
        public var nextCursor: String?
        public var busy = false, storageReady = true
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private var generation = UUID(), binding: MemberApprovalIdentity?
    private let identity: () async throws -> MemberApprovalIdentity?
    private let access: (MemberApprovalIdentity) async throws -> TeamRequestAccess
    private let list: (MemberApprovalIdentity, String, String?) async throws -> TeamRequestPage
    private let send: (MemberApprovalIdentity, TeamRequestDraft) async throws -> TeamRequestRecord
    private let recover: (MemberApprovalIdentity, TeamRequestDraft) async throws -> TeamRequestRecord?
    private let load: (String) throws -> TeamRequestDraft?
    private let save: (TeamRequestDraft) throws -> Void
    private let changed: (View) -> Void
    public init(identity: @escaping () async throws -> MemberApprovalIdentity?, access: @escaping (MemberApprovalIdentity) async throws -> TeamRequestAccess,
                list: @escaping (MemberApprovalIdentity, String, String?) async throws -> TeamRequestPage,
                send: @escaping (MemberApprovalIdentity, TeamRequestDraft) async throws -> TeamRequestRecord,
                recover: @escaping (MemberApprovalIdentity, TeamRequestDraft) async throws -> TeamRequestRecord?,
                load: @escaping (String) throws -> TeamRequestDraft?, save: @escaping (TeamRequestDraft) throws -> Void, changed: @escaping (View) -> Void) {
        self.identity = identity; self.access = access; self.list = list; self.send = send; self.recover = recover; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async throws -> Bool { guard g == generation else { return false }; let now = try await identity(); return g == generation && now == account }
    public func open() async {
        guard !view.busy else { return }
        generation = UUID(); let g = generation
        view.busy = true; view.requests = []; view.access = nil; view.message = "팀 권한을 확인하고 있어요."; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity() else { if g == generation { invalidate() }; return }
            guard g == generation else { return }
            if binding != account { view = View(); view.busy = true }
            binding = account
            do {
                let draft = try load(account.accountID); try draft?.validate(account: account.accountID)
                view.draft = draft; view.storageReady = true
            } catch { view.storageReady = false; view.message = "저장된 초안을 읽지 못했어요. 원본을 덮어쓰지 않았어요."; changed(view); return }
            let rights = try await access(account); try rights.validate(account: account.accountID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            view.access = rights
            if view.draft == nil, let first = rights.products.first { let draft = TeamRequestDraft(accountID: account.accountID, product: first); try save(draft); view.draft = draft }
            guard let product = view.draft?.product, rights.products.contains(product) else { view.message = "이 제품의 접근 권한이 없어요. 저장된 초안은 유지돼요."; return }
            let page = try await list(account, product, nil); try page.validate(product: product)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            view.requests = page.requests; view.nextCursor = page.next_cursor; view.message = ""
        } catch { if g == generation { view.message = "팀 요청을 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    public func edit(body: String, product: String, category: String) {
        guard !view.busy, view.storageReady, var draft = view.draft, draft.phase == .draft,
              view.access?.products.contains(product) == true, body.utf16.count <= 5000 else { return }
        if draft.product != product { view.requests = []; view.nextCursor = nil }
        draft.body = body; draft.product = product; draft.category = category; view.draft = draft
        do { try draft.validate(account: draft.accountID); try save(draft); view.message = "" }
        catch { view.storageReady = false; view.message = "기기에 저장하지 못했어요. 닫기 전에 내용을 복사해 주세요." }
        changed(view)
    }
    public func submit(recoveryOnly: Bool = false) async {
        guard !view.busy, view.storageReady, var draft = view.draft, let account = binding,
              let rights = view.access, rights.products.contains(draft.product), draft.phase != .received else { return }
        let g = generation, firstSubmission = draft.phase == .draft && !recoveryOnly
        view.busy = true; view.message = ""; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            if draft.phase == .draft { draft.noticeVersion = rights.notice_version }
            _ = try draft.payload()
            if !recoveryOnly {
                draft.phase = .uncertain
                do { try save(draft) } catch { view.storageReady = false; view.message = "보내지 않았어요. 전송 상태를 기기에 저장하지 못했어요."; return }
                view.draft = draft; changed(view)
            }
            let result: TeamRequestRecord?
            if recoveryOnly { result = try await recover(account, draft) } else { result = try await send(account, draft) }
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            guard let result else { view.message = "아직 접수 내역을 찾지 못했어요. 잠시 후 다시 확인해 주세요."; return }
            try result.validate(); guard result.matches(draft) else { throw SyncFailure.invalidResponse }
            draft.phase = .received; draft.receipt = result.id; view.draft = draft
            do { try save(draft); view.message = "접수됐어요. 같은 제품의 내부 멤버가 내용을 볼 수 있어요." }
            catch { view.storageReady = false; view.message = "접수됐지만 기기에 저장하지 못했어요. 접수 번호를 복사해 주세요." }
        } catch {
            guard g == generation else { return }
            if firstSubmission, case SyncFailure.http(400, let code) = error,
               ["team_notice_required", "invalid_team_request", "invalid_product", "invalid_request_id"].contains(code) {
                // These contract errors occur before insertion. Never unlock an earlier ambiguous send.
                draft.phase = .draft; draft.noticeVersion = ""; view.draft = draft; view.access = nil
                do { try save(draft); view.message = "접수되지 않았어요. 내용을 유지했어요. 새로고침해 안내와 제품 권한을 다시 확인해 주세요." }
                catch { view.storageReady = false; view.message = "접수되지 않았고 초안 저장에도 실패했어요. 내용을 내보내 주세요." }
            } else { view.message = "접수 여부를 확인하지 못했어요. 내용과 전송 번호를 유지했어요. 자동으로 다시 보내지 않아요." }
        }
    }
    public func newDraft() {
        guard !view.busy, view.storageReady, let old = view.draft, old.phase == .received else { return }
        let draft = TeamRequestDraft(accountID: old.accountID, product: old.product)
        do { try save(draft); view.draft = draft; view.message = "" } catch { view.storageReady = false; view.message = "새 초안을 저장하지 못했어요." }
        changed(view)
    }
    public func more() async {
        guard !view.busy, let cursor = view.nextCursor, let account = binding, let product = view.draft?.product else { return }
        let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            let page = try await list(account, product, cursor); try page.validate(product: product)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            let known = Set(view.requests.map(\.id)); view.requests += page.requests.filter { !known.contains($0.id) }; view.nextCursor = page.next_cursor
        } catch { if g == generation { view.message = "이전 요청을 불러오지 못했어요." } }
    }
}

public struct TeamCommentDraft: Codable, Sendable {
    public let accountID, requestID, key: String
    public var body = ""
    public var phase: TeamRequestDraft.Phase = .draft
    public var receipt: String?
    public init(accountID: String, requestID: String) { self.accountID = accountID; self.requestID = requestID; self.key = UUID().uuidString.lowercased() }
    public func validate(account: String, request: String) throws {
        guard accountID == account, requestID == request, StoredAccount.validID(account), TeamRequestRecord.validID(request),
              UUID(uuidString: key)?.uuidString.lowercased() == key, body.utf16.count <= 5000, !body.contains("\0"),
              phase != .received || receipt.map({ $0.count == 36 && $0.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil }) == true else { throw SyncFailure.invalidResponse }
    }
}

public struct TeamWorkflowSnapshot: Codable, Sendable {
    public static let statuses = ["submitted", "discussing", "on_hold", "duplicate", "rejected"]
    public static let priorities = ["unclassified", "low", "normal", "high"]
    public let request_id, status, priority: String
    public let revision: Int
    public let id, actor_account_id, client_mutation_id, assignee_account_id, next_action, reason, duplicate_request_id: String?
    public let created_at, redacted_at: Double?
    public func validate(request: String) throws {
        guard request_id == request, TeamRequestRecord.validID(request), revision >= 0, revision < 1_000_000_000,
              Self.statuses.contains(status), Self.priorities.contains(priority),
              assignee_account_id.map(StoredAccount.validID) ?? true,
              duplicate_request_id.map(TeamRequestRecord.validID) ?? true,
              (reason?.utf16.count ?? 0) <= 2000, (next_action?.utf16.count ?? 0) <= 2000,
              reason?.contains("\0") != true, next_action?.contains("\0") != true else { throw SyncFailure.invalidResponse }
        if revision == 0 {
            guard status == "submitted", priority == "unclassified", id == nil, actor_account_id == nil, created_at == nil,
                  assignee_account_id == nil, duplicate_request_id == nil, reason == nil, next_action == nil, client_mutation_id == nil, redacted_at == nil else { throw SyncFailure.invalidResponse }
        } else {
            guard let id, id.count == 36, id.range(of: "^twe_[a-f0-9]{32}$", options: .regularExpression) != nil,
                  let created_at, created_at.isFinite, created_at > 0,
                  actor_account_id.map(StoredAccount.validID) ?? (redacted_at != nil),
                  redacted_at.map({ $0.isFinite && $0 >= created_at }) ?? true else { throw SyncFailure.invalidResponse }
        }
    }
    public func matches(_ draft: TeamWorkflowDraft) -> Bool {
        request_id == draft.requestID && actor_account_id == draft.accountID && client_mutation_id == draft.key && revision == draft.expectedRevision + 1 &&
        status == draft.status && priority == draft.priority && assignee_account_id == draft.assignee &&
        next_action == (draft.nextAction.isEmpty ? nil : draft.nextAction) && reason == draft.reason && duplicate_request_id == draft.duplicateID && redacted_at == nil
    }
}
public struct TeamWorkflowPage: Decodable, Sendable {
    public let schema, request_id: String
    public let can_manage: Bool
    public let current: TeamWorkflowSnapshot
    public let events: [TeamWorkflowSnapshot]
    public let next_cursor: String?
    public func validate(request: String) throws {
        guard schema == "hps-team-workflow/1", request_id == request, events.count <= 50 else { throw SyncFailure.invalidResponse }
        try current.validate(request: request)
        var previous = 0
        for event in events { try event.validate(request: request); guard event.revision > previous, event.revision <= current.revision else { throw SyncFailure.invalidResponse }; previous = event.revision }
        if let next_cursor { guard Int(next_cursor) == events.last?.revision, !events.isEmpty, previous < current.revision else { throw SyncFailure.invalidResponse } }
    }
}
public struct TeamAssignmentMembers: Decodable, Sendable {
    public struct Member: Decodable, Sendable, Identifiable {
        public let account_id: String
        public let display_name: String?
        public var id: String { account_id }
    }
    public let schema, account_id, product: String
    public let members: [Member]
    public func validate(account: String, product: String) throws {
        guard schema == "hps-team-assignment-members/1", account_id == account, self.product == product, members.count <= 100,
              Set(members.map(\.account_id)).count == members.count,
              members.allSatisfy({ StoredAccount.validID($0.account_id) && ($0.display_name?.utf16.count ?? 0) <= 500 }) else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamWorkflowDraft: Codable, Sendable {
    public enum Phase: String, Codable, Sendable { case draft, uncertain, conflict, received }
    public let accountID, requestID, product: String
    public var key: String, expectedRevision: Int, status: String, priority: String
    public var assignee: String?, duplicateID: String?
    public var nextAction = "", reason = ""
    public var phase: Phase = .draft
    public var receipt: String?
    public init(accountID: String, product: String, current: TeamWorkflowSnapshot) {
        self.accountID = accountID; self.product = product; requestID = current.request_id
        key = UUID().uuidString.lowercased(); expectedRevision = current.revision; status = current.status; priority = current.priority
        assignee = current.assignee_account_id; duplicateID = current.duplicate_request_id; nextAction = current.next_action ?? ""
    }
    public func validate(account: String, request: String) throws {
        guard accountID == account, StoredAccount.validID(account), requestID == request, TeamRequestRecord.validID(request),
              TeamRequestDraft.products.contains(product), UUID(uuidString: key)?.uuidString.lowercased() == key,
              expectedRevision >= 0, expectedRevision < 999_999_999, TeamWorkflowSnapshot.statuses.contains(status), TeamWorkflowSnapshot.priorities.contains(priority),
              assignee.map(StoredAccount.validID) ?? true, duplicateID.map(TeamRequestRecord.validID) ?? true,
              nextAction.utf16.count <= 2000, reason.utf16.count <= 2000, !nextAction.contains("\0"), !reason.contains("\0") else { throw SyncFailure.invalidResponse }
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID, request: requestID)
        guard !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              nextAction.isEmpty || !nextAction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              (status == "duplicate") == (duplicateID != nil), duplicateID != requestID else { throw SyncFailure.invalidResponse }
        return ["schema": "hps-team-workflow-change/1", "client_mutation_id": key, "expected_revision": expectedRevision,
                "status": status, "priority": priority, "assignee_account_id": assignee.map { $0 as Any } ?? NSNull(),
                "next_action": nextAction.isEmpty ? NSNull() : nextAction as Any, "reason": reason, "duplicate_request_id": duplicateID.map { $0 as Any } ?? NSNull()]
    }
}

@MainActor public final class TeamWorkflowController {
    public struct View {
        public var page: TeamWorkflowPage?, draft: TeamWorkflowDraft?
        public var events: [TeamWorkflowSnapshot] = [], members: [TeamAssignmentMembers.Member] = [], targets: [TeamRequestRecord] = []
        public var targetCursor: String?
        public var busy = false, storageReady = true
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private let requestID, product: String
    private var generation = UUID(), binding: MemberApprovalIdentity?
    private let identity: () async throws -> MemberApprovalIdentity?
    private let fetch: (MemberApprovalIdentity, String?) async throws -> TeamWorkflowPage
    private let members: (MemberApprovalIdentity) async throws -> TeamAssignmentMembers
    private let targets: (MemberApprovalIdentity, String?) async throws -> TeamRequestPage
    private let send: (MemberApprovalIdentity, TeamWorkflowDraft) async throws -> TeamWorkflowSnapshot
    private let load: (String) throws -> TeamWorkflowDraft?
    private let save: (TeamWorkflowDraft) throws -> Void
    private let changed: (View) -> Void
    public init(requestID: String, product: String, identity: @escaping () async throws -> MemberApprovalIdentity?,
                fetch: @escaping (MemberApprovalIdentity, String?) async throws -> TeamWorkflowPage,
                members: @escaping (MemberApprovalIdentity) async throws -> TeamAssignmentMembers, targets: @escaping (MemberApprovalIdentity, String?) async throws -> TeamRequestPage,
                send: @escaping (MemberApprovalIdentity, TeamWorkflowDraft) async throws -> TeamWorkflowSnapshot,
                load: @escaping (String) throws -> TeamWorkflowDraft?, save: @escaping (TeamWorkflowDraft) throws -> Void, changed: @escaping (View) -> Void) {
        self.requestID = requestID; self.product = product; self.identity = identity; self.fetch = fetch; self.members = members; self.targets = targets
        self.send = send; self.load = load; self.save = save; self.changed = changed
    }
    private func persist(_ draft: TeamWorkflowDraft) throws { do { try save(draft) } catch { view.storageReady = false; throw error } }
    public func invalidate() { generation = UUID(); binding = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async throws -> Bool { guard g == generation else { return false }; let now = try await identity(); return g == generation && now == account }
    public func open() async {
        guard !view.busy, view.storageReady else { return }; generation = UUID(); let g = generation
        view.busy = true; view.page = nil; view.events = []; view.members = []; view.targets = []; view.message = ""; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity() else { invalidate(); return }
            guard g == generation else { return }; if binding != account { view = View(); view.busy = true }; binding = account
            do { let draft = try load(account.accountID); try draft?.validate(account: account.accountID, request: requestID); guard draft?.product == nil || draft?.product == product else { throw SyncFailure.invalidResponse }; view.draft = draft }
            catch { view.storageReady = false; view.message = "저장된 변경 초안을 읽지 못했어요. 원본을 덮어쓰지 않았어요."; return }
            let page = try await fetch(account, nil); try page.validate(request: requestID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; view.page = page; view.events = page.events
            if page.can_manage {
                let people = try await members(account); try people.validate(account: account.accountID, product: product)
                guard try await current(g, account) else { if g == generation { invalidate() }; return }; view.members = people.members
                let choices = try await targets(account, nil); try choices.validate(product: product)
                guard try await current(g, account) else { if g == generation { invalidate() }; return }; view.targets = choices.requests.filter { $0.id != requestID }; view.targetCursor = choices.next_cursor
                if view.draft == nil { let draft = TeamWorkflowDraft(accountID: account.accountID, product: product, current: page.current); try persist(draft); view.draft = draft }
                if var draft = view.draft, draft.phase == .draft, draft.expectedRevision != page.current.revision { draft.phase = .conflict; try persist(draft); view.draft = draft; view.message = "다른 변경이 먼저 저장됐어요. 최신 내용을 확인한 뒤 다시 적용해 주세요." }
            }
        } catch { if g == generation { view.page = nil; view.events = []; view.members = []; view.targets = []; view.message = view.storageReady ? "상태를 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." : "초안을 기기에 저장하지 못했어요. 내용을 내보내 주세요." } }
    }
    public func edit(_ update: (inout TeamWorkflowDraft) -> Void) {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, var draft = view.draft, draft.phase == .draft else { return }
        update(&draft)
        do { try draft.validate(account: draft.accountID, request: requestID) } catch { return }
        view.draft = draft
        do { try persist(draft); view.message = "" } catch { view.storageReady = false; view.message = "기기에 저장하지 못했어요. 변경 사유와 다음 행동을 내보내 주세요." }
        changed(view)
    }
    public func rebase() {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, let page = view.page, var draft = view.draft, draft.phase == .conflict else { return }
        draft.expectedRevision = page.current.revision; draft.key = UUID().uuidString.lowercased(); draft.phase = .draft
        do { try persist(draft); view.draft = draft; view.message = "제안한 내용은 유지했어요. 다시 확인한 뒤 저장해 주세요." } catch { view.storageReady = false; view.message = "초안을 저장하지 못했어요." }; changed(view)
    }
    public func newChange() {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, let account = binding, let page = view.page, view.draft?.phase == .received else { return }
        let draft = TeamWorkflowDraft(accountID: account.accountID, product: product, current: page.current)
        do { try persist(draft); view.draft = draft; view.message = "" } catch { view.storageReady = false; view.message = "새 변경 초안을 저장하지 못했어요." }; changed(view)
    }
    public func submit() async {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, let account = binding, var draft = view.draft, draft.phase == .draft || draft.phase == .uncertain else { return }
        let g = generation, first = draft.phase == .draft; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; _ = try draft.payload()
            draft.phase = .uncertain
            do { try persist(draft) } catch { view.storageReady = false; view.message = "보내지 않았어요. 전송 상태를 저장하지 못했어요."; return }
            view.draft = draft; changed(view)
            let event = try await send(account, draft); try event.validate(request: requestID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            guard event.matches(draft) else { throw SyncFailure.invalidResponse }
            draft.phase = .received; draft.receipt = event.id; view.draft = draft
            if let previous = view.page { view.page = TeamWorkflowPage(schema: previous.schema, request_id: requestID, can_manage: previous.can_manage, current: event, events: previous.events, next_cursor: previous.next_cursor) }
            do { try persist(draft); view.message = "변경이 저장됐어요. 새로고침하면 최신 상태를 확인할 수 있어요." }
            catch { view.storageReady = false; view.message = "서버에 저장됐지만 기기 저장은 실패했어요. 내용을 내보내 주세요." }
        } catch SyncFailure.http(409, "team_workflow_conflict") {
            guard (try? await current(g, account)) == true else { if g == generation { invalidate() }; return }
            if first { draft.phase = .conflict; view.draft = draft; view.page = nil; do { try persist(draft) } catch { view.storageReady = false } }
            view.message = "다른 변경과 충돌했어요. 제안한 내용은 유지돼요. 최신 상태를 확인해 주세요."
        } catch SyncFailure.http(403, "team_assignee_denied") {
            guard (try? await current(g, account)) == true else { if g == generation { invalidate() }; return }
            // Only a first, definitively rejected attempt can be edited. A retry
            // may refer to an earlier committed write whose receipt was lost.
            if first { draft.phase = .draft; view.draft = draft; do { try persist(draft) } catch { view.storageReady = false } }
            view.message = first ? "담당자의 제품 권한을 확인할 수 없어요. 담당자를 바꾸거나 해제한 뒤 저장해 주세요." : "이전 저장 여부를 확인하지 못했어요. 내용과 전송 번호는 유지돼요."
        } catch { if g == generation { view.message = "저장 여부를 확인하지 못했어요. 변경 내용과 전송 번호는 유지돼요." } }
    }
    public func moreHistory() async {
        guard !view.busy, let account = binding, let after = view.page?.next_cursor else { return }; let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do { let page = try await fetch(account, after); try page.validate(request: requestID); guard try await current(g, account) else { if g == generation { invalidate() }; return }
            let known = Set(view.events.map(\.revision)); view.events += page.events.filter { !known.contains($0.revision) }; view.events.sort { $0.revision < $1.revision }; view.page = page
        } catch { if g == generation { view.page = nil; view.events = []; view.message = "이력을 더 불러오지 못했어요." } }
    }
    public func moreTargets() async {
        guard !view.busy, view.page?.can_manage == true, let account = binding, let after = view.targetCursor else { return }
        let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            let choices = try await targets(account, after); try choices.validate(product: product)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            let known = Set(view.targets.map(\.id)); view.targets += choices.requests.filter { $0.id != requestID && !known.contains($0.id) }; view.targetCursor = choices.next_cursor
        } catch { if g == generation { view.page = nil; view.targets = []; view.message = "연결할 요청을 불러오지 못했어요." } }
    }

}
