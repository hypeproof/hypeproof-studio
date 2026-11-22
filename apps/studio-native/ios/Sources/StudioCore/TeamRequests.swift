import Foundation

public struct TeamRequestAccess: Codable, Sendable {
    public let schema, account_id, notice_version: String
    public let products: [String]
    public var supported_push_capabilities: [String]? = nil
    public var supported_comment_schemas: [String]? = nil
    public var supported_text_revision_schemas: [String]? = nil
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
    public mutating func observeHidden(_ row: TeamRequestRecord) -> Bool {
        guard phase == .received, row.retention?.hidden == true, row.id == receipt, row.account_id == accountID, row.client_request_id == key, row.product == product, row.category == category else { return false }
        body = ""; return true
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
    public var retention: TeamContentRetention? = nil
    public static func validID(_ value: String) -> Bool { value.range(of: "^trq_[a-f0-9]{32}$", options: .regularExpression) != nil && value.count == 36 }
    public func validate() throws {
        try retention?.validate()
        if let retention, retention.hidden { guard body == retention.marker else { throw SyncFailure.invalidResponse } }
        guard Self.validID(id), StoredAccount.validID(account_id), client_request_id.utf16.count <= 64,
              TeamRequestDraft.products.contains(product), ["bug", "improvement", "question"].contains(category),
              !body.isEmpty, body.utf16.count <= 5000, !body.contains("\0"), notice_version.utf16.count <= 128,
              status == "submitted", revision > 0, created_at.isFinite, updated_at.isFinite, created_at > 0, updated_at >= created_at else { throw SyncFailure.invalidResponse }
    }
    public func matches(_ draft: TeamRequestDraft) -> Bool {
        account_id == draft.accountID && client_request_id == draft.key && product == draft.product && category == draft.category && (body == draft.body || retention?.hidden == true) && notice_version == draft.noticeVersion
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
    public var retention: TeamContentRetention? = nil
    public var intent: String? = nil
    public var reply_to: String? = nil
    public var discussionIntent: String { intent ?? "discussion" }
    public func validate(request: String) throws {
        try retention?.validate()
        if let retention, retention.hidden { guard body == retention.marker else { throw SyncFailure.invalidResponse } }
        guard id.count == 36, id.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil,
              request_id == request, StoredAccount.validID(account_id), !body.isEmpty, body.utf16.count <= 5000,
              !body.contains("\0"), created_at.isFinite, created_at > 0,
              TeamCommentDraft.validIntent(discussionIntent, reply: reply_to, request: request) else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamCommentSupport {
    public static func schemas(_ values: [String]?) throws -> [String] {
        guard let values else { return ["hps-team-comment/1"] }
        guard values.count <= 16, Set(values).count == values.count,
              values.allSatisfy({ $0.range(of: "^hps-team-comment/[1-9][0-9]*$", options: .regularExpression) != nil && $0.count < 64 }) else { throw SyncFailure.invalidResponse }
        return values.filter { ["hps-team-comment/1", "hps-team-comment/2"].contains($0) }
    }
}
public struct TeamCommentRetention: Codable, Equatable, Sendable {
    public let policy: String
    public let purge_implemented: Bool
    public let content_purged_at: Double?
    public let purged_outcome_revision: Int?
    public var content_hidden: Bool? = nil
    public var hidden_outcome_revision: Int? = nil
    public var content_hidden_since: Double? = nil
    public var purge_eligible_at: Double? = nil
    public static let hiddenMarker = "보관 기한이 지나 내용을 숨겼어요."
    public static let purgedMarker = "보관 기간이 지나 내용이 삭제됐어요."
    public var hidden: Bool { content_hidden == true }
    public var currentCyclePurged: Bool { hidden && content_purged_at != nil && purged_outcome_revision == hidden_outcome_revision }
    public var marker: String { currentCyclePurged ? Self.purgedMarker : Self.hiddenMarker }
    // Historical rows retain their first redaction timestamp across later purge cycles.
    public func confirmsPurge(at date: Double?) -> Bool { date != nil && content_purged_at != nil && purged_outcome_revision != nil }
    public var generationKey: String { "\(purged_outcome_revision ?? 0):\(hidden_outcome_revision ?? 0):\(hidden)" }
    public func validate() throws {
        guard policy == "90_days_after_reporter_confirmation", (content_purged_at == nil) == (purged_outcome_revision == nil),
              [content_purged_at,content_hidden_since,purge_eligible_at].allSatisfy({ $0.map { $0.isFinite && $0 > 0 } ?? true }),
              [purged_outcome_revision,hidden_outcome_revision].allSatisfy({ $0.map { $0 > 0 && $0 <= 9_007_199_254_740_991 } ?? true }) else { throw SyncFailure.invalidResponse }
        if hidden {
            guard let hidden_outcome_revision, let content_hidden_since, hidden_outcome_revision >= (purged_outcome_revision ?? 0) else { throw SyncFailure.invalidResponse }
            if currentCyclePurged { guard content_purged_at! >= content_hidden_since else { throw SyncFailure.invalidResponse } }
        } else { guard hidden_outcome_revision == nil, content_hidden_since == nil else { throw SyncFailure.invalidResponse } }
    }
    public func validateScope(_ child: Self?) throws {
        try validate(); try child?.validate()
        if content_hidden != nil { guard child?.generationKey == generationKey, child?.content_hidden_since == content_hidden_since, child?.content_purged_at == content_purged_at else { throw SyncFailure.invalidResponse } }
    }
}
public typealias TeamContentRetention = TeamCommentRetention
public struct TeamRequestDetail: Decodable, Sendable {
    public let request: TeamRequestRecord
    public let comments: [TeamRequestComment]
    public let next_comments_cursor: String?
    public var retention: TeamCommentRetention? = nil
    public var latest_question: TeamLatestQuestion? = nil
    public func validate(id: String) throws {
        try request.validate(); try retention?.validate(); try latest_question?.validate(request: id)
        if let latest_question { try retention?.validateScope(latest_question.retention) }
        guard request.id == id, comments.count <= 100, Set(comments.map(\.id)).count == comments.count,
              next_comments_cursor.map({ TeamRequestPage.validCursor($0, prefix: "tcm_") }) ?? true else { throw SyncFailure.invalidResponse }
        try retention?.validateScope(request.retention)
        for comment in comments { try comment.validate(request: id); try retention?.validateScope(comment.retention) }
    }
}

/// Accumulated comment pages share one server retention generation.
public struct TeamCommentHistory: Sendable {
    public private(set) var detail: TeamRequestDetail?
    public private(set) var comments: [TeamRequestComment] = []
    private var minimumPurgedRevision = 0
    private var pendingGeneration: String?
    public mutating func beginRefresh() { pendingGeneration = nil }
    public init() {}
    public mutating func clear() { detail = nil; comments = [] }
    /// False requests a fresh first page after old content has already been hidden.
    public mutating func accept(_ page: TeamRequestDetail, more: Bool) throws -> Bool {
        try page.validate(id: page.request.id)
        let incoming = page.retention?.purged_outcome_revision ?? 0
        let previous = detail?.retention?.purged_outcome_revision ?? 0
        if more, previous != incoming || detail?.retention?.generationKey != page.retention?.generationKey {
            minimumPurgedRevision = max(minimumPurgedRevision, previous, incoming)
            pendingGeneration = page.retention?.generationKey ?? "legacy"
            clear(); return false
        }
        guard pendingGeneration == nil || pendingGeneration == (page.retention?.generationKey ?? "legacy") else { clear(); throw SyncFailure.invalidResponse }
        pendingGeneration = nil
        guard incoming >= minimumPurgedRevision, detail == nil || detail?.request.id == page.request.id else { clear(); throw SyncFailure.invalidResponse }
        minimumPurgedRevision = max(minimumPurgedRevision, incoming)
        if more { let known = Set(comments.map(\.id)); comments += page.comments.filter { !known.contains($0.id) } }
        else { comments = page.comments }
        detail = page; return true
    }
    public func canDisplay(_ draft: TeamCommentDraft) -> Bool {
        guard draft.phase == .received, !draft.body.isEmpty else { return true }
        if detail?.retention?.hidden == true { return false }
        return comments.contains { $0.id == draft.receipt && $0.account_id == draft.accountID && $0.client_comment_id == draft.key && $0.body == draft.body }
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
            if var draft = view.draft, page.requests.contains(where: { draft.observeHidden($0) }) {
                view.draft = draft
                do { try save(draft) } catch { view.storageReady = false; view.message = "숨겨진 내용의 기기 사본을 정리하지 못했어요. 내용은 표시하지 않아요." }
            }
        } catch { if g == generation { view.message = "팀 요청을 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    /// A validated, freshly authorized detail may reconcile an acknowledged receipt beyond the list's current page.
    public func observeHidden(_ row: TeamRequestRecord, account: MemberApprovalIdentity) {
        guard binding == account, (try? row.validate()) != nil else { return }
        if let index = view.requests.firstIndex(where: { $0.id == row.id }) { view.requests[index] = row }
        if var draft = view.draft, draft.observeHidden(row) {
            view.draft = draft
            do { try save(draft) } catch { view.storageReady = false; view.message = "숨겨진 내용의 기기 사본을 정리하지 못했어요. 내용은 표시하지 않아요." }
        }
        changed(view)
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
            draft.phase = .received; draft.receipt = result.id; _ = draft.observeHidden(result); view.draft = draft
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
            for row in page.requests {
                if let index = view.requests.firstIndex(where: { $0.id == row.id }) { view.requests[index] = row } else { view.requests.append(row) }
                observeHidden(row, account: account)
            }
            view.nextCursor = page.next_cursor
        } catch { if g == generation { view.message = "이전 요청을 불러오지 못했어요." } }
    }
}

public struct TeamCommentDraft: Codable, Sendable {
    public let accountID, requestID, key: String
    public var body = ""
    public var phase: TeamRequestDraft.Phase = .draft
    public var receipt: String?
    // Missing fields decode as v1, retaining the exact pre-upgrade digest and key.
    public var schema: String? = nil
    public var intent: String? = nil
    public var replyTo: String? = nil
    public var definitiveRejection: String? = nil
    public var needsReplyTarget: Bool? = nil
    public var wireSchema: String { schema ?? "hps-team-comment/1" }
    public var discussionIntent: String { intent ?? "discussion" }
    public init(accountID: String, requestID: String) { self.accountID = accountID; self.requestID = requestID; self.key = UUID().uuidString.lowercased() }
    public static func validIntent(_ intent: String, reply: String?, request: String) -> Bool {
        guard ["discussion", "question", "reply"].contains(intent), (intent == "reply") == (reply != nil) else { return false }
        guard let reply else { return true }
        return reply == request || (reply.count == 36 && reply.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil)
    }
    public func choosing(_ intent: String, reply: String?, loadedComments: [TeamRequestComment]) throws -> TeamCommentDraft {
        guard phase == .draft, Self.validIntent(intent, reply: reply, request: requestID),
              reply == nil || reply == requestID || loadedComments.contains(where: { $0.id == reply && $0.request_id == requestID }) else { throw SyncFailure.invalidResponse }
        var next = TeamCommentDraft(accountID: accountID, requestID: requestID)
        next.schema = "hps-team-comment/2"; next.intent = intent; next.replyTo = reply; next.body = body
        try next.validate(account: accountID, request: requestID); return next
    }
    public mutating func recordDefinitiveRejection(_ code: String) -> Bool {
        guard phase == .uncertain, code == "team_content_expired" || (code == "team_reply_target_unavailable" && wireSchema == "hps-team-comment/2" && discussionIntent == "reply") else { return false }
        definitiveRejection = code; return true
    }
    public func freshReplyChoice() throws -> TeamCommentDraft {
        guard phase == .uncertain, definitiveRejection == "team_reply_target_unavailable" else { throw SyncFailure.invalidResponse }
        var next = TeamCommentDraft(accountID:accountID, requestID:requestID)
        next.schema = "hps-team-comment/2"; next.intent = "discussion"; next.body = body; next.needsReplyTarget = true
        return next
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID, request: requestID)
        guard needsReplyTarget != true, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw SyncFailure.invalidResponse }
        var value: [String: Any] = ["schema":wireSchema, "client_comment_id":key, "body":body]
        if wireSchema == "hps-team-comment/2" { value["intent"] = discussionIntent; value["reply_to"] = replyTo as Any? ?? NSNull() }
        return value
    }
    public mutating func observeTombstone(_ detail: TeamRequestDetail) -> Bool {
        guard phase == .received, detail.request.id == requestID, (detail.retention?.content_purged_at != nil || detail.retention?.hidden == true),
              detail.comments.contains(where: { $0.id == receipt && $0.account_id == accountID && $0.client_comment_id == key && ($0.body == TeamContentRetention.purgedMarker || ($0.retention?.hidden == true && $0.body == $0.retention?.marker)) }) else { return false }
        body = ""; return true
    }
    public func validate(account: String, request: String) throws {
        guard accountID == account, requestID == request, StoredAccount.validID(account), TeamRequestRecord.validID(request),
              UUID(uuidString: key)?.uuidString.lowercased() == key, body.utf16.count <= 5000, !body.contains("\0"),
              ["hps-team-comment/1", "hps-team-comment/2"].contains(wireSchema),
              wireSchema != "hps-team-comment/1" || (intent == nil && replyTo == nil),
              wireSchema != "hps-team-comment/2" || (intent != nil && Self.validIntent(discussionIntent, reply: replyTo, request: request)),
              needsReplyTarget != true || (phase == .draft && wireSchema == "hps-team-comment/2" && definitiveRejection == nil),
              definitiveRejection == nil || (phase == .uncertain && (definitiveRejection == "team_content_expired" || (definitiveRejection == "team_reply_target_unavailable" && wireSchema == "hps-team-comment/2" && discussionIntent == "reply"))),
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
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        try retention?.validate()
        if retention?.hidden == true { guard reason == nil, next_action == nil else { throw SyncFailure.invalidResponse } }
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
        (retention?.hidden == true || retention?.confirmsPurge(at: redacted_at) == true || (next_action == (draft.nextAction.isEmpty ? nil : draft.nextAction) && reason == draft.reason)) && duplicate_request_id == draft.duplicateID && (redacted_at == nil || retention?.confirmsPurge(at: redacted_at) == true)
    }
}
public struct TeamWorkflowPage: Decodable, Sendable {
    public let schema, request_id: String
    public let can_manage: Bool
    public let current: TeamWorkflowSnapshot
    public let events: [TeamWorkflowSnapshot]
    public let next_cursor: String?
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        guard schema == "hps-team-workflow/1", request_id == request, events.count <= 50 else { throw SyncFailure.invalidResponse }
        try retention?.validate(); try retention?.validateScope(current.retention)
        try current.validate(request: request)
        var previous = 0
        for event in events { try event.validate(request: request); try retention?.validateScope(event.retention); guard event.revision > previous, event.revision <= current.revision else { throw SyncFailure.invalidResponse }; previous = event.revision }
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
    public mutating func observeHidden(_ event: TeamWorkflowSnapshot) -> Bool {
        guard phase == .received, (event.retention?.hidden == true || event.retention?.confirmsPurge(at: event.redacted_at) == true), event.id == receipt, event.matches(self) else { return false }
        reason = ""; nextAction = ""; return true
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
    private func reconcileHidden(_ page: TeamWorkflowPage) throws {
        guard var draft = view.draft, ([page.current] + page.events).contains(where: { draft.observeHidden($0) }) else { return }
        view.draft = draft; try persist(draft)
    }
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
            try reconcileHidden(page)
            if page.can_manage && page.retention?.hidden != true {
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
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, var draft = view.draft, draft.phase == .draft else { return }
        update(&draft)
        do { try draft.validate(account: draft.accountID, request: requestID) } catch { return }
        view.draft = draft
        do { try persist(draft); view.message = "" } catch { view.storageReady = false; view.message = "기기에 저장하지 못했어요. 변경 사유와 다음 행동을 내보내 주세요." }
        changed(view)
    }
    public func rebase() {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, let page = view.page, var draft = view.draft, draft.phase == .conflict else { return }
        draft.expectedRevision = page.current.revision; draft.key = UUID().uuidString.lowercased(); draft.phase = .draft
        do { try persist(draft); view.draft = draft; view.message = "제안한 내용은 유지했어요. 다시 확인한 뒤 저장해 주세요." } catch { view.storageReady = false; view.message = "초안을 저장하지 못했어요." }; changed(view)
    }
    public func newChange() {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, let account = binding, let page = view.page, view.draft?.phase == .received else { return }
        let draft = TeamWorkflowDraft(accountID: account.accountID, product: product, current: page.current)
        do { try persist(draft); view.draft = draft; view.message = "" } catch { view.storageReady = false; view.message = "새 변경 초안을 저장하지 못했어요." }; changed(view)
    }
    public func submit() async {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, let account = binding, var draft = view.draft, draft.phase == .draft || draft.phase == .uncertain else { return }
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
            draft.phase = .received; draft.receipt = event.id; _ = draft.observeHidden(event); view.draft = draft
            if let previous = view.page { view.page = TeamWorkflowPage(schema: previous.schema, request_id: requestID, can_manage: previous.can_manage, current: event, events: previous.events, next_cursor: previous.next_cursor, retention: event.retention ?? previous.retention) }
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
        do { var page = try await fetch(account, after); try page.validate(request: requestID); guard try await current(g, account) else { if g == generation { invalidate() }; return }
            try reconcileHidden(page)
            if view.page?.retention?.generationKey != page.retention?.generationKey {
                let observed = page.retention?.generationKey
                view.page = nil; view.events = []; changed(view)
                page = try await fetch(account, nil); try page.validate(request: requestID)
                guard page.retention?.generationKey == observed, try await current(g, account) else { throw SyncFailure.invalidResponse }
            }
            try reconcileHidden(page)
            let known = Set(view.events.map(\.revision)); view.events += page.events.filter { !known.contains($0.revision) }; view.events.sort { $0.revision < $1.revision }; view.page = page
        } catch { if g == generation { view.page = nil; view.events = []; view.message = "이력을 더 불러오지 못했어요." } }
    }
    public func moreTargets() async {
        guard !view.busy, view.page?.can_manage == true, view.page?.retention?.hidden != true, let account = binding, let after = view.targetCursor else { return }
        let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            let choices = try await targets(account, after); try choices.validate(product: product)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            let known = Set(view.targets.map(\.id)); view.targets += choices.requests.filter { $0.id != requestID && !known.contains($0.id) }; view.targetCursor = choices.next_cursor
        } catch { if g == generation { view.page = nil; view.targets = []; view.message = "연결할 요청을 불러오지 못했어요." } }
    }

}

// GitHub records are provider-verified; their relationship to this request is an operator assertion.
public struct TeamGitHubEvidence: Codable, Sendable {
    public struct Issue: Codable, Sendable { public let number: Int; public let node_id, url, state: String }
    public struct Pull: Codable, Sendable { public let number: Int; public let url: String; public let merged: Bool }
    public struct CI: Codable, Sendable { public let run_id, attempt: Int; public let url, conclusion: String }
    public let schema, repo, relationship: String
    public let issue: Issue
    public let pull: Pull?
    public let source_sha: String?
    public let ci: CI?
    public let testflight, reporter_confirmation: String?
    public func validate(repo expected: String, issue number: Int) throws {
        guard repo == expected, issue.number == number, !issue.node_id.isEmpty, issue.node_id.count <= 256,
              issue.url == "https://github.com/\(repo)/issues/\(number)", ["open", "closed"].contains(issue.state) else { throw SyncFailure.invalidResponse }
        if schema == "hps-team-issue-evidence/1" {
            guard relationship == "provider_record_verified", pull == nil, source_sha == nil, ci == nil else { throw SyncFailure.invalidResponse }
        } else {
            guard schema == "hps-team-request-lineage/1", relationship == "provider_records_verified", let pull, let source_sha, let ci,
                  TeamGitHubDraft.number(pull.number), TeamGitHubDraft.number(ci.run_id), TeamGitHubDraft.number(ci.attempt),
                  TeamGitHubDraft.sha(source_sha), pull.url == "https://github.com/\(repo)/pull/\(pull.number)",
                  ci.url == "https://github.com/\(repo)/actions/runs/\(ci.run_id)",
                  ["success","failure","cancelled","timed_out","action_required","neutral","skipped","stale","startup_failure"].contains(ci.conclusion),
                  testflight == "not_observed", reporter_confirmation == "not_observed" else { throw SyncFailure.invalidResponse }
        }
    }
}
public struct TeamGitHubEvent: Codable, Sendable, Identifiable {
    public let id, request_id, client_mutation_id, repo, association, testflight, reporter_confirmation: String
    public let actor_account_id, reason: String?
    public let revision, issue_number: Int
    public let verified_at: Double
    public let redacted_at: Double?
    public let evidence: TeamGitHubEvidence?
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        try retention?.validate()
        guard request_id == request, TeamRequestRecord.validID(request), id.count == 36, id.range(of: "^tgl_[a-f0-9]{32}$", options: .regularExpression) != nil,
              revision > 0, revision < 1_000_000_000, TeamGitHubDraft.number(issue_number),
              repo.range(of: "^hypeproof/[a-z0-9][a-z0-9-]*$", options: .regularExpression) != nil, !repo.contains("\n"),
              association == "operator_asserted", testflight == "not_observed", reporter_confirmation == "not_observed",
              verified_at.isFinite, verified_at > 0 else { throw SyncFailure.invalidResponse }
        if let redacted_at {
            guard redacted_at.isFinite, redacted_at >= verified_at, reason == nil, evidence == nil else { throw SyncFailure.invalidResponse }
            if retention?.confirmsPurge(at: redacted_at) == true, actor_account_id != nil {
                guard actor_account_id.map(StoredAccount.validID) == true, !client_mutation_id.isEmpty, client_mutation_id.count <= 64 else { throw SyncFailure.invalidResponse }
            } else { guard actor_account_id == nil, client_mutation_id.isEmpty else { throw SyncFailure.invalidResponse } }
        } else if retention?.hidden == true {
            guard let actor_account_id, StoredAccount.validID(actor_account_id), !client_mutation_id.isEmpty, client_mutation_id.count <= 64, reason == nil, evidence == nil else { throw SyncFailure.invalidResponse }
        } else {
            guard let actor_account_id, StoredAccount.validID(actor_account_id), let reason, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  reason.utf16.count <= 2000, !reason.contains("\0"), !client_mutation_id.isEmpty, client_mutation_id.count <= 64, let evidence else { throw SyncFailure.invalidResponse }
            try evidence.validate(repo: repo, issue: issue_number)
        }
    }
    public func matches(_ draft: TeamGitHubDraft) -> Bool {
        guard actor_account_id == draft.accountID, request_id == draft.requestID, client_mutation_id == draft.key, revision == draft.expectedRevision + 1, issue_number == Int(draft.issue), redacted_at == nil || retention?.confirmsPurge(at: redacted_at) == true else { return false }
        if retention?.hidden == true || retention?.confirmsPurge(at: redacted_at) == true { return true }
        return reason == draft.reason && evidence?.pull?.number == (draft.lineage ? Int(draft.pull) : nil) && evidence?.source_sha == (draft.lineage ? draft.sourceSHA : nil) && evidence?.ci?.run_id == (draft.lineage ? Int(draft.run) : nil) && evidence?.ci?.attempt == (draft.lineage ? Int(draft.attempt) : nil)
    }
}
public struct TeamGitHubPage: Decodable, Sendable {
    public var configured_repository: String? = nil
    public let schema, request_id: String
    public let can_manage: Bool
    public let current: TeamGitHubEvent?
    public let events: [TeamGitHubEvent]
    public let next_cursor: String?
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        guard schema == "hps-team-github-links/1", request_id == request, events.count <= 50, configured_repository.map(IntakeProposal.repository) ?? true else { throw SyncFailure.invalidResponse }
        try retention?.validate()
        if let current { try current.validate(request: request); try retention?.validateScope(current.retention) }
        var previous = 0
        for event in events { try event.validate(request: request); try retention?.validateScope(event.retention); guard event.revision > previous, event.revision <= (current?.revision ?? 0) else { throw SyncFailure.invalidResponse }; previous = event.revision }
        if let next_cursor { guard Int(next_cursor) == events.last?.revision, previous > 0, previous < (current?.revision ?? 0) else { throw SyncFailure.invalidResponse } }
    }
}
public struct TeamGitHubDraft: Codable, Sendable {
    public let accountID, requestID: String
    public var key = UUID().uuidString.lowercased(), expectedRevision: Int
    public var issue = "", pull = "", sourceSHA = "", run = "", attempt = "", reason = ""
    public var lineage = false
    public var phase: TeamWorkflowDraft.Phase = .draft
    public init(accountID: String, requestID: String, revision: Int) { self.accountID = accountID; self.requestID = requestID; expectedRevision = revision }
    public mutating func observeHidden(_ event: TeamGitHubEvent) -> Bool {
        guard phase == .received, (event.retention?.hidden == true || event.retention?.confirmsPurge(at: event.redacted_at) == true), event.matches(self) else { return false }
        reason = ""; pull = ""; sourceSHA = ""; run = ""; attempt = ""; lineage = false; return true
    }
    public static func number(_ n: Int) -> Bool { n > 0 && n <= 9_007_199_254_740_991 }
    public static func sha(_ s: String) -> Bool { s.count == 40 && s.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil }
    public func validate(account: String, request: String) throws {
        guard accountID == account, StoredAccount.validID(account), requestID == request, TeamRequestRecord.validID(request),
              UUID(uuidString: key)?.uuidString.lowercased() == key, expectedRevision >= 0, expectedRevision < 999_999_999,
              [issue, pull, run, attempt].allSatisfy({ $0.count <= 16 && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              sourceSHA.count <= 40, reason.utf16.count <= 2000, !reason.contains("\0") else { throw SyncFailure.invalidResponse }
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID, request: requestID)
        guard let issueNumber = Int(issue), Self.number(issueNumber), !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw SyncFailure.invalidResponse }
        var result: [String: Any] = ["schema":"hps-team-github-association/1", "client_mutation_id":key, "expected_revision":expectedRevision, "issue":issueNumber, "reason":reason,
                                     "pull":NSNull(), "source_sha":NSNull(), "run":NSNull(), "attempt":NSNull()]
        if lineage {
            guard let p = Int(pull), let r = Int(run), let a = Int(attempt), Self.number(p), Self.number(r), Self.number(a), Self.sha(sourceSHA) else { throw SyncFailure.invalidResponse }
            result["pull"] = p; result["source_sha"] = sourceSHA; result["run"] = r; result["attempt"] = a
        }
        return result
    }
}

@MainActor public final class TeamGitHubController {
    public struct View {
        public var page: TeamGitHubPage?, draft: TeamGitHubDraft?
        public var events: [TeamGitHubEvent] = []
        public var busy = false, storageReady = true
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private let requestID: String
    private var generation = UUID(), binding: MemberApprovalIdentity?
    private let identity: () async throws -> MemberApprovalIdentity?
    private let fetch: (MemberApprovalIdentity, String?) async throws -> TeamGitHubPage
    private let send: (MemberApprovalIdentity, TeamGitHubDraft) async throws -> TeamGitHubEvent
    private let load: (String) throws -> TeamGitHubDraft?
    private let save: (TeamGitHubDraft) throws -> Void
    private let changed: (View) -> Void
    public init(requestID: String, identity: @escaping () async throws -> MemberApprovalIdentity?, fetch: @escaping (MemberApprovalIdentity, String?) async throws -> TeamGitHubPage,
                send: @escaping (MemberApprovalIdentity, TeamGitHubDraft) async throws -> TeamGitHubEvent, load: @escaping (String) throws -> TeamGitHubDraft?,
                save: @escaping (TeamGitHubDraft) throws -> Void, changed: @escaping (View) -> Void) {
        self.requestID = requestID; self.identity = identity; self.fetch = fetch; self.send = send; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async throws -> Bool { guard g == generation else { return false }; let now = try await identity(); return g == generation && now == account }
    // Errors are also asynchronous responses: discard them after a known identity change.
    // If identity verification itself is unavailable, hide server data but retain local exportable words.
    private func admitFailure(_ g: UUID) async -> Bool {
        guard g == generation else { return false }
        guard let account = binding else { return true }
        do { guard try await current(g, account) else { if g == generation { invalidate() }; return false } }
        catch { guard g == generation else { return false }; view.page = nil; view.events = [] }
        return true
    }
    private func reconcileHidden(_ page: TeamGitHubPage) throws {
        guard var draft = view.draft, (page.events + (page.current.map { [$0] } ?? [])).contains(where: { draft.observeHidden($0) }) else { return }
        view.draft = draft; try persist(draft)
    }
    private func persist(_ draft: TeamGitHubDraft) throws { do { try save(draft) } catch { view.storageReady = false; throw error } }
    public func open() async {
        guard !view.busy, view.storageReady else { return }; generation = UUID(); let g = generation
        view.busy = true; view.page = nil; view.events = []; view.message = ""; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity() else { if g == generation { invalidate() }; return }
            guard g == generation else { return }; if binding != account { view = View(); view.busy = true }; binding = account
            do { let draft = try load(account.accountID); try draft?.validate(account: account.accountID, request: requestID); view.draft = draft }
            catch { view.storageReady = false; view.message = "저장된 연결 초안을 읽지 못했어요. 원본을 유지했어요."; return }
            let page = try await fetch(account, nil); try page.validate(request: requestID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            view.page = page; view.events = page.events; try reconcileHidden(page)
            if page.can_manage, view.draft == nil { let draft = TeamGitHubDraft(accountID: account.accountID, requestID: requestID, revision: page.current?.revision ?? 0); try persist(draft); view.draft = draft }
            if var draft = view.draft, draft.phase == .draft, draft.expectedRevision != (page.current?.revision ?? 0) { draft.phase = .conflict; try persist(draft); view.draft = draft }
        } catch { if await admitFailure(g) { view.page = nil; view.events = []; view.message = view.storageReady ? "연결 근거를 불러오지 못했어요. 로그인과 권한을 확인해 주세요." : "기기에 저장하지 못했어요. 초안을 내보내 주세요." } }
    }
    public func edit(_ update: (inout TeamGitHubDraft) -> Void) {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, var draft = view.draft, draft.phase == .draft else { return }
        update(&draft); guard (try? draft.validate(account: draft.accountID, request: requestID)) != nil else { return }; view.draft = draft
        do { try persist(draft); view.message = "" } catch { view.message = "기기에 저장하지 못했어요. 초안을 내보내 주세요." }; changed(view)
    }
    public func rebase() {
        guard !view.busy, view.storageReady, let page = view.page, page.can_manage, page.retention?.hidden != true, var draft = view.draft, draft.phase == .conflict else { return }
        draft.expectedRevision = page.current?.revision ?? 0; draft.key = UUID().uuidString.lowercased(); draft.phase = .draft
        do { try persist(draft); view.draft = draft; view.message = "제안을 유지했어요. 다시 확인한 뒤 저장해 주세요." } catch { view.message = "초안을 저장하지 못했어요." }; changed(view)
    }
    public func newChange() {
        guard !view.busy, view.storageReady, let page = view.page, page.can_manage, page.retention?.hidden != true, let account = binding, view.draft?.phase == .received else { return }
        let draft = TeamGitHubDraft(accountID: account.accountID, requestID: requestID, revision: page.current?.revision ?? 0)
        do { try persist(draft); view.draft = draft } catch { view.message = "초안을 저장하지 못했어요." }; changed(view)
    }
    public func submit() async {
        guard !view.busy, view.storageReady, view.page?.can_manage == true, view.page?.retention?.hidden != true, let account = binding, var draft = view.draft, draft.phase == .draft || draft.phase == .uncertain else { return }
        let g = generation, first = draft.phase == .draft; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; _ = try draft.payload()
            draft.phase = .uncertain; try persist(draft); view.draft = draft; changed(view)
            let event = try await send(account, draft); try event.validate(request: requestID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; guard event.matches(draft) else { throw SyncFailure.invalidResponse }
            draft.phase = .received; _ = draft.observeHidden(event); view.draft = draft
            if let previous = view.page { view.page = TeamGitHubPage(schema: previous.schema, request_id: requestID, can_manage: previous.can_manage, current: event, events: previous.events, next_cursor: previous.next_cursor) }
            try persist(draft); view.message = "연결이 저장됐어요. 배포·설치·사용자 확인을 뜻하지 않아요."
        } catch SyncFailure.http(503, "team_github_unverified") {
            guard (try? await current(g, account)) == true else { if g == generation { invalidate() }; return }
            // Service returns this only before insertion. Never unlock an earlier uncertain attempt.
            if first { draft.phase = .draft; view.draft = draft; do { try persist(draft) } catch {} }
            view.message = first ? "GitHub 기록을 확인하지 못해 저장하지 않았어요. 번호와 근거를 확인해 주세요." : "이전 저장 여부가 불명확해 전송 번호를 유지했어요."
        } catch SyncFailure.http(409, "team_github_conflict") {
            guard (try? await current(g, account)) == true else { if g == generation { invalidate() }; return }
            if first { draft.phase = .conflict; view.draft = draft; view.page = nil; do { try persist(draft) } catch {} }
            view.message = "연결 변경이 충돌했어요. 최신 상태를 확인해 주세요. 이전 결과가 불명확하면 같은 번호를 유지해요."
        } catch { if await admitFailure(g) { view.message = view.storageReady ? "저장 여부를 확인하지 못했어요. 초안과 전송 번호를 유지했어요. 자동으로 다시 보내지 않아요." : "기기에 저장하지 못했어요. 초안을 내보내 주세요." } }
    }
    public func more() async {
        guard !view.busy, let account = binding, let after = view.page?.next_cursor else { return }; let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do { var page = try await fetch(account, after); try page.validate(request: requestID); guard try await current(g, account) else { if g == generation { invalidate() }; return }
            try reconcileHidden(page)
            if view.page?.retention?.generationKey != page.retention?.generationKey {
                let observed = page.retention?.generationKey
                view.page = nil; view.events = []; changed(view)
                page = try await fetch(account, nil); try page.validate(request: requestID)
                guard page.retention?.generationKey == observed, try await current(g, account) else { throw SyncFailure.invalidResponse }
            }
            try reconcileHidden(page)
            let known = Set(view.events.map(\.revision)); view.events += page.events.filter { !known.contains($0.revision) }; view.events.sort { $0.revision < $1.revision }; view.page = page
        } catch { if await admitFailure(g) { view.page = nil; view.events = []; view.message = "연결 이력을 불러오지 못했어요." } }
    }
}

// Read-only delivery records: provider observation is never installation or resolution.
public struct TeamDeliveryEvidence: Codable, Sendable, Equatable {
    public struct Package: Codable, Sendable, Equatable { public let sha256, bundle_id, version, build: String; public let size: Int }
    public struct Observation: Codable, Sendable, Equatable { public let id, attempt: Int; public let workflow_source_sha: String }
    public struct Apple: Codable, Sendable, Equatable { public let app_id, build_id, group_id, processing, internal_state, expiration_date: String; public let expired, group_contains_build: Bool }
    public let schema, repository, source_sha: String
    public let package: Package
    public let observation_run: Observation
    public let apple: Apple
    public let observed_at, observation_started_at, valid_until: Double
    public let group_build_available: Bool
    public let target_tester_member, target_tester_invitation_accepted, device_installed, reporter_confirmation: String
    public func validate() throws {
        guard schema == "hps-team-delivery-evidence/1", repository == "hypeproof/hypeproof-studio", TeamGitHubDraft.sha(source_sha),
              package.bundle_id == "ai.hypeproof.studio.mobile", package.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              TeamGitHubDraft.number(package.size), package.version.range(of: "^[0-9]+(?:\\.[0-9]+){0,2}$", options: .regularExpression) != nil,
              package.build.range(of: "^[0-9]+\\.[0-9]+$", options: .regularExpression) != nil, package.version.count <= 32, package.build.count <= 32,
              TeamGitHubDraft.number(observation_run.id), TeamGitHubDraft.number(observation_run.attempt), TeamGitHubDraft.sha(observation_run.workflow_source_sha),
              [apple.app_id,apple.build_id,apple.group_id].allSatisfy({ $0.range(of: "^[A-Za-z0-9-]{1,100}$", options: .regularExpression) != nil }),
              ["PROCESSING","FAILED","INVALID","VALID"].contains(apple.processing),
              ["PROCESSING","PROCESSING_EXCEPTION","MISSING_EXPORT_COMPLIANCE","READY_FOR_BETA_TESTING","IN_BETA_TESTING","EXPIRED","IN_EXPORT_COMPLIANCE_REVIEW"].contains(apple.internal_state),
              [observed_at,observation_started_at,valid_until].allSatisfy({ $0.isFinite && $0 > 0 }),
              observation_started_at <= observed_at, observed_at - observation_started_at <= 600_000,
              valid_until <= observation_started_at + 900_000,
              [target_tester_member,target_tester_invitation_accepted,device_installed,reporter_confirmation].allSatisfy({ $0 == "not_observed" }) else { throw SyncFailure.invalidResponse }
        guard let expiration = expirationInstant, valid_until == min(observation_started_at + 900_000, expiration) else { throw SyncFailure.invalidResponse }
        if group_build_available { guard apple.processing == "VALID", apple.internal_state == "IN_BETA_TESTING", !apple.expired, apple.group_contains_build, expiration > observed_at else { throw SyncFailure.invalidResponse } }
    }
    private var expirationInstant: Double? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: apple.expiration_date) { return date.timeIntervalSince1970 * 1000 }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: apple.expiration_date).map { $0.timeIntervalSince1970 * 1000 }
    }
    public func isFresh(at now: Date) -> Bool {
        let time = now.timeIntervalSince1970 * 1000
        guard let expiration = expirationInstant else { return false }
        return observed_at <= time && time < valid_until && time < expiration
    }
    public func groupAvailable(at now: Date) -> Bool { group_build_available && isFresh(at: now) }
    public var observationURL: URL { URL(string: "https://github.com/hypeproof/hypeproof-studio/actions/runs/\(observation_run.id)/attempts/\(observation_run.attempt)")! }
}
public struct TeamDeliveryEvent: Codable, Sendable, Equatable, Identifiable {
    public let id, request_id, github_link_id, availability, reporter_confirmation: String
    public let revision: Int
    public let instructions: String?
    public let evidence: TeamDeliveryEvidence?
    public let created_at: Double
    public let redacted_at: Double?
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        try retention?.validate()
        guard TeamRequestRecord.validID(request), request_id == request,
              id.range(of: "^tdl_[a-f0-9]{32}$", options: .regularExpression) != nil,
              github_link_id.range(of: "^tgl_[a-f0-9]{32}$", options: .regularExpression) != nil,
              revision > 0, revision < 1_000_000_000, created_at.isFinite, created_at > 0,
              ["group_available","not_established"].contains(availability), reporter_confirmation == "not_observed" else { throw SyncFailure.invalidResponse }
        if let redacted_at { guard redacted_at.isFinite, redacted_at >= created_at, instructions == nil, evidence == nil, availability == "not_established" else { throw SyncFailure.invalidResponse } }
        else if retention?.hidden == true { guard instructions == nil, evidence == nil, availability == "not_established" else { throw SyncFailure.invalidResponse } }
        else { guard let instructions, !instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, instructions.utf16.count <= 2000, !instructions.contains("\0"), let evidence else { throw SyncFailure.invalidResponse }; try evidence.validate(); if availability == "group_available" && !evidence.group_build_available { throw SyncFailure.invalidResponse } }
    }
}
public struct TeamDeliveryPage: Codable, Sendable {
    public let schema, request_id: String
    public let can_manage: Bool
    public let current: TeamDeliveryEvent?
    public let events: [TeamDeliveryEvent]
    public let next_cursor: String?
    public var retention: TeamContentRetention? = nil
    public func validate(request: String) throws {
        guard schema == "hps-team-deliveries/1", request_id == request, TeamRequestRecord.validID(request), events.count <= 50 else { throw SyncFailure.invalidResponse }
        try retention?.validate()
        if let current { try current.validate(request: request); try retention?.validateScope(current.retention) }
        var previous = 0; var ids = Set<String>()
        for event in events { try event.validate(request: request); try retention?.validateScope(event.retention); guard event.revision > previous, event.revision <= (current?.revision ?? 0), ids.insert(event.id).inserted else { throw SyncFailure.invalidResponse }; if event.revision == current?.revision && event != current { throw SyncFailure.invalidResponse }; previous = event.revision }
        if let next_cursor { guard next_cursor == String(previous), previous > 0, previous < (current?.revision ?? 0) else { throw SyncFailure.invalidResponse } }
    }
}
@MainActor public final class TeamDeliveryController {
    public struct View { public var page: TeamDeliveryPage?; public var events: [TeamDeliveryEvent] = []; public var busy = false; public var message = ""; public init() {} }
    public private(set) var view = View()
    private let requestID: String
    private let identity: () async throws -> MemberApprovalIdentity?
    private let fetch: (MemberApprovalIdentity, String?) async throws -> TeamDeliveryPage
    private let changed: (View) -> Void
    private var generation = UUID(), binding: MemberApprovalIdentity?
    public init(requestID: String, identity: @escaping () async throws -> MemberApprovalIdentity?, fetch: @escaping (MemberApprovalIdentity, String?) async throws -> TeamDeliveryPage, changed: @escaping (View) -> Void) { self.requestID = requestID; self.identity = identity; self.fetch = fetch; self.changed = changed }
    public func invalidate() { generation = UUID(); binding = nil; view = View(); changed(view) }
    public func open() async { await read(more: false) }
    public func more() async { await read(more: true) }
    private func read(more: Bool) async {
        guard !view.busy else { return }; let after = more ? view.page?.next_cursor : nil
        guard !more || after != nil else { return }
        let g = generation; view.busy = true; view.message = ""
        if !more { view.page = nil; view.events = [] }; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity(), g == generation else { if g == generation { invalidate() }; return }
            if more && binding != account { invalidate(); return }; binding = account
            var page = try await fetch(account, after); try page.validate(request: requestID)
            guard g == generation else { return }
            guard try await identity() == account, g == generation else { if g == generation { invalidate() }; return }
            var reset = false
            if more, view.page?.retention?.generationKey != page.retention?.generationKey {
                let observed = page.retention?.generationKey
                view.page = nil; view.events = []; reset = true; changed(view)
                page = try await fetch(account, nil); try page.validate(request: requestID)
                guard page.retention?.generationKey == observed, g == generation, try await identity() == account, g == generation else { throw SyncFailure.invalidResponse }
            }
            if more && !reset { guard page.events.allSatisfy({ $0.revision > (Int(after ?? "") ?? 0) }), (page.current?.revision ?? 0) >= (view.page?.current?.revision ?? 0) else { throw SyncFailure.invalidResponse }; view.events += page.events }
            else { view.events = page.events }
            view.page = page
        } catch {
            guard g == generation else { return }
            let current = try? await identity(); guard g == generation else { return }
            if let current, current != binding { invalidate(); return }
            view.page = nil; view.events = []; view.message = "배포 근거를 확인하지 못했어요. 아직 제공되지 않거나 접근 권한이 없을 수 있어요. 다시 확인해 주세요."
        }
    }
}


/// Navigation destinations may be evaluated again while StateObject retains an
/// earlier presentation. Track every live controller without extending its life.
@MainActor public final class TeamDeliveryControllers {
    private final class Entry { weak var value: TeamDeliveryController?; init(_ value: TeamDeliveryController) { self.value = value } }
    private var entries: [Entry] = []
    public init() {}
    public func register(_ controller: TeamDeliveryController) {
        entries.removeAll { $0.value == nil }
        if !entries.contains(where: { $0.value === controller }) { entries.append(Entry(controller)) }
    }
    public func invalidate() {
        entries.removeAll { $0.value == nil }
        entries.forEach { $0.value?.invalidate() }
    }
}
