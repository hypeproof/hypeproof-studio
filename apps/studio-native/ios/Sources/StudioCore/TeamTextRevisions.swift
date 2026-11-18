import Foundation

public struct TeamTextVersion: Codable, Equatable, Sendable, Identifiable {
    public let id: String?
    public let request_id, target_id: String
    public let account_id, actor_account_id, client_mutation_id: String?
    public let revision: Int
    public var body: String
    public let created_at: Double
    public let redacted_at: Double?
    public var retention: TeamContentRetention?
    public var physicallyPurged: Bool { retention?.confirmsPurge(at: redacted_at) == true && body == TeamContentRetention.purgedMarker }
    public var authorID: String { account_id ?? actor_account_id ?? "" }
    public static func validTarget(_ value: String, request: String) -> Bool {
        value == request || (value.count == 36 && value.range(of: "^tcm_[a-f0-9]{32}$", options: .regularExpression) != nil)
    }
    public static func validBody(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= 5000 && !value.contains("\0") }
    public func validate(request: String, target: String) throws {
        guard TeamRequestRecord.validID(request), request_id == request, target_id == target, Self.validTarget(target, request: request),
              revision >= 1, revision < 1_000_000_000, Self.validBody(body), created_at.isFinite, created_at > 0,
              redacted_at.map({ $0.isFinite && $0 > 0 }) ?? true, StoredAccount.validID(authorID) else { throw SyncFailure.invalidResponse }
        if revision == 1 { guard id == nil, actor_account_id == nil, client_mutation_id == nil, account_id != nil, redacted_at == nil else { throw SyncFailure.invalidResponse } }
        else { guard id?.range(of: "^ttv_[a-f0-9]{32}$", options: .regularExpression) != nil, id?.count == 36, account_id == nil, actor_account_id != nil,
                     client_mutation_id?.range(of: "^[A-Za-z0-9_-]{8,64}$", options: .regularExpression) != nil else { throw SyncFailure.invalidResponse } }
        try retention?.validate()
        if retention?.hidden == true { guard body == retention?.marker else { throw SyncFailure.invalidResponse } }
        else if retention?.confirmsPurge(at: redacted_at) == true { guard body == TeamContentRetention.purgedMarker else { throw SyncFailure.invalidResponse } }
    }
    public func matches(_ draft: TeamTextRevisionDraft) -> Bool {
        request_id == draft.requestID && target_id == draft.targetID && actor_account_id == draft.accountID && client_mutation_id == draft.key && revision == draft.expectedRevision + 1 && (body == draft.body || retention?.hidden == true || physicallyPurged)
    }
    func sameIdentity(as other: Self) -> Bool { id == other.id && request_id == other.request_id && target_id == other.target_id && account_id == other.account_id && actor_account_id == other.actor_account_id && client_mutation_id == other.client_mutation_id && revision == other.revision && created_at == other.created_at }
    public func hidden(using state: TeamContentRetention) -> Self { var copy = self; copy.body = state.marker; copy.retention = state; return copy }
}

public struct TeamTextRevisionPage: Codable, Sendable {
    public let schema, request_id, target_id: String
    public let can_edit: Bool
    public let original, current: TeamTextVersion
    public let events: [TeamTextVersion]
    public let next_cursor: String?
    public let retention: TeamContentRetention?
    public static func cursor(_ value: String) -> Int? { guard let n = Int(value), n >= 1, n < 1_000_000_000, String(n) == value else { return nil }; return n }
    public func validate(request: String, target: String, after: String? = nil) throws {
        guard schema == "hps-team-text-history/1", request_id == request, target_id == target, events.count <= 50,
              after.map({ Self.cursor($0) != nil }) ?? true else { throw SyncFailure.invalidResponse }
        let children = [original,current] + events
        if retention == nil { guard children.allSatisfy({ $0.retention == nil }) else { throw SyncFailure.invalidResponse } }
        if children.contains(where: { $0.retention?.content_hidden != nil }) { guard retention?.content_hidden != nil else { throw SyncFailure.invalidResponse } }
        try original.validate(request: request, target: target); try current.validate(request: request, target: target); try retention?.validate()
        guard original.revision == 1, current.authorID == original.authorID, (retention?.hidden != true && current.redacted_at == nil) || !can_edit else { throw SyncFailure.invalidResponse }
        try retention?.validateScope(original.retention); try retention?.validateScope(current.retention)
        if current.revision == 1 { guard current == original else { throw SyncFailure.invalidResponse } }
        var previous = after.flatMap(Self.cursor) ?? 1; var ids = Set<String>()
        for event in events {
            try event.validate(request: request, target: target); try retention?.validateScope(event.retention)
            guard event.authorID == original.authorID, event.revision > previous, event.revision <= current.revision, let id = event.id, ids.insert(id).inserted else { throw SyncFailure.invalidResponse }
            if event.revision == current.revision { guard event == current else { throw SyncFailure.invalidResponse } }
            previous = event.revision
        }
        if let next_cursor { guard events.count == 50, Self.cursor(next_cursor) == events.last?.revision, previous < current.revision else { throw SyncFailure.invalidResponse } }
    }
}

public struct TeamLatestQuestion: Codable, Equatable, Sendable {
    public let request_id, target_id, account_id: String
    public let created_at: Double
    public let text_revision: Int
    public let edited_at: Double?
    public let retention: TeamContentRetention?
    public func validate(request: String) throws {
        guard request_id == request, TeamRequestRecord.validID(request), TeamTextVersion.validTarget(target_id, request: request), StoredAccount.validID(account_id),
              created_at.isFinite, created_at > 0, text_revision >= 1, text_revision < 1_000_000_000,
              edited_at.map({ $0.isFinite && $0 > 0 }) ?? (text_revision == 1), (text_revision == 1) == (edited_at == nil) else { throw SyncFailure.invalidResponse }
        try retention?.validate()
    }
}

public struct TeamTextRevisionDraft: Codable, Sendable {
    public enum Phase: String, Codable, Sendable { case draft, uncertain, received, conflict }
    public let accountID, requestID, targetID, key: String
    public var expectedRevision: Int
    public var body = ""
    public var phase: Phase = .draft
    public var receipt: TeamTextVersion?
    public init(accountID: String, requestID: String, targetID: String, expectedRevision: Int = 1, key: String = UUID().uuidString.lowercased()) {
        self.accountID = accountID; self.requestID = requestID; self.targetID = targetID; self.expectedRevision = expectedRevision; self.key = key
    }
    public var exportText: String { "요청: \(requestID)\n대상: \(targetID)\n전송 번호: \(key)\n기준 수정본: \(expectedRevision)\n\(body)" }
    public func validate(account: String, request: String, target: String) throws {
        guard accountID == account, StoredAccount.validID(account), requestID == request, TeamRequestRecord.validID(request), targetID == target, TeamTextVersion.validTarget(target, request: request),
              UUID(uuidString: key)?.uuidString.lowercased() == key, expectedRevision >= 1, expectedRevision < 999_999_999, body.utf16.count <= 5000, !body.contains("\0"),
              phase == .received || receipt == nil else { throw SyncFailure.invalidResponse }
        if phase != .draft { guard TeamTextVersion.validBody(body) else { throw SyncFailure.invalidResponse } }
        if phase == .received { guard let receipt else { throw SyncFailure.invalidResponse }; try receipt.validate(request: request, target: target); guard receipt.matches(self) else { throw SyncFailure.invalidResponse } }
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID, request: requestID, target: targetID)
        guard TeamTextVersion.validBody(body), phase != .received else { throw SyncFailure.invalidResponse }
        return ["schema":"hps-team-text-change/1", "client_mutation_id":key, "expected_revision":expectedRevision, "body":body]
    }
}

@MainActor public final class TeamTextRevisionController {
    public struct View {
        public var page: TeamTextRevisionPage?, draft: TeamTextRevisionDraft?
        public var events: [TeamTextVersion] = []
        public var busy = false, storageReady = true, supported = false, historyNeedsRefresh = false, acknowledgedPending = false
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private let requestID, targetID: String
    private let identity: () async throws -> MemberApprovalIdentity?
    private let discover: (MemberApprovalIdentity) async throws -> [String]
    private let fetch: (MemberApprovalIdentity, String?) async throws -> TeamTextRevisionPage
    private let send: (MemberApprovalIdentity, TeamTextRevisionDraft) async throws -> TeamTextVersion
    private let load: (String) throws -> TeamTextRevisionDraft?
    private let save: (TeamTextRevisionDraft) throws -> Void
    private let changed: (View) -> Void
    private var binding: MemberApprovalIdentity?, generation = UUID()
    private var revisionFloor = 1, purgeFloor = 0, observedHidden = false
    private var withheldAcknowledged: TeamTextRevisionDraft?
    private var knownOriginal: TeamTextVersion?, knownCurrent: TeamTextVersion?
    public init(requestID: String, targetID: String, identity: @escaping () async throws -> MemberApprovalIdentity?, discover: @escaping (MemberApprovalIdentity) async throws -> [String],
                fetch: @escaping (MemberApprovalIdentity, String?) async throws -> TeamTextRevisionPage, send: @escaping (MemberApprovalIdentity, TeamTextRevisionDraft) async throws -> TeamTextVersion,
                load: @escaping (String) throws -> TeamTextRevisionDraft?, save: @escaping (TeamTextRevisionDraft) throws -> Void, changed: @escaping (View) -> Void) {
        self.requestID = requestID; self.targetID = targetID; self.identity = identity; self.discover = discover; self.fetch = fetch; self.send = send; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; revisionFloor = 1; purgeFloor = 0; observedHidden = false; knownOriginal = nil; knownCurrent = nil; withheldAcknowledged = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async -> Bool {
        guard g == generation else { return false }
        guard (try? await identity()) == account, g == generation else { if g == generation { invalidate() }; return false }; return true
    }
    private func persist(_ draft: TeamTextRevisionDraft) {
        view.draft = draft
        do { try save(draft) } catch { view.storageReady = false; view.message = "수정 내용을 기기에 저장하지 못했어요. 글과 전송 번호를 내보내 주세요." }
        changed(view)
    }
    private func clearRemote() { view.page = nil; view.events = []; view.supported = false; view.historyNeedsRefresh = false }
    private func accept(_ page: TeamTextRevisionPage, after: String? = nil) throws {
        try page.validate(request: requestID, target: targetID, after: after)
        guard page.current.revision >= revisionFloor, (page.retention?.purged_outcome_revision ?? 0) >= purgeFloor,
              !observedHidden || page.retention?.content_hidden != nil else { throw SyncFailure.invalidResponse }
        if let original = knownOriginal {
            guard original.sameIdentity(as: page.original) else { throw SyncFailure.invalidResponse }
            if original.body != page.original.body { guard original.retention?.hidden == true || page.retention?.hidden == true || (page.retention?.purged_outcome_revision ?? 0) > purgeFloor else { throw SyncFailure.invalidResponse } }
        }
        if let previous = knownCurrent, previous.revision == page.current.revision {
            guard previous.sameIdentity(as: page.current) else { throw SyncFailure.invalidResponse }
            if previous.body != page.current.body { guard previous.retention?.hidden == true || page.retention?.hidden == true || (page.retention?.purged_outcome_revision ?? 0) > purgeFloor else { throw SyncFailure.invalidResponse } }
        }
        if let receipt = (view.draft ?? withheldAcknowledged)?.receipt, receipt.revision == page.current.revision { guard receipt.sameIdentity(as: page.current) else { throw SyncFailure.invalidResponse } }
        if let old = view.page {
            if after != nil, old.retention?.generationKey != page.retention?.generationKey {
                view.events = []; view.historyNeedsRefresh = true
            }
        }
        knownOriginal = page.original; knownCurrent = page.current
        revisionFloor = max(revisionFloor, page.current.revision); purgeFloor = max(purgeFloor, page.retention?.purged_outcome_revision ?? 0)
        observedHidden = observedHidden || page.retention?.hidden == true
        // A received local copy is not display/export authority after restart.
        // Restore it only from matching fresh history, or its validated target-wide cutoff.
        if var pending = withheldAcknowledged, let receipt = pending.receipt {
            let matching = ([page.current] + page.events).first { $0.id == receipt.id }
            if let matching { guard matching.sameIdentity(as: receipt), matching.matches(pending) || receipt.retention?.hidden == true else { throw SyncFailure.invalidResponse } }
            if matching != nil || page.retention?.hidden == true {
                if let state = page.retention, state.hidden { pending.receipt = receipt.hidden(using: state); pending.body = state.marker }
                if let matching, matching.physicallyPurged { pending.receipt = matching; pending.body = matching.body }
                view.draft = pending; withheldAcknowledged = nil; view.acknowledgedPending = false
                if matching?.physicallyPurged == true, page.retention?.hidden != true { view.page = page; persist(pending) }
            }
        }
        if page.retention?.hidden != true, var draft = view.draft, draft.phase == .received, let receipt = draft.receipt,
           let matching = ([page.current] + page.events).first(where: { $0.id == receipt.id && $0.physicallyPurged }) {
            guard matching.sameIdentity(as: receipt), matching.matches(draft) else { throw SyncFailure.invalidResponse }
            if draft.body != matching.body || draft.receipt != matching {
                draft.body = matching.body; draft.receipt = matching; view.page = page
                view.events = view.events.map { $0.id == matching.id ? matching : $0 }; persist(draft)
            }
        }
        if let state = page.retention, state.hidden { view.page = page; view.events = view.events.map { $0.hidden(using: state) } }
        if let state = page.retention, state.hidden, var draft = view.draft, draft.phase == .received, let receipt = draft.receipt, receipt.matches(draft) {
            draft.receipt = receipt.hidden(using: state); draft.body = state.marker; persist(draft)
        }
        if after == nil { view.events = page.events; view.historyNeedsRefresh = false }
        else if !view.historyNeedsRefresh {
            let existing = Set(view.events.compactMap(\.id)); view.events = Array((view.events + page.events.filter { $0.id.map { !existing.contains($0) } ?? false }).prefix(500))
        }
        view.page = page
    }
    private var editable: Bool { view.supported && view.page?.can_edit == true && view.page?.original.authorID == binding?.accountID && view.page?.retention?.hidden != true && !view.historyNeedsRefresh }
    public var editingAllowed: Bool { editable }
    public func open() async {
        guard !view.busy, view.storageReady else { return }; let g = UUID(); generation = g; view.busy = true; view.message = ""; clearRemote()
        if let draft = view.draft, draft.phase == .received { withheldAcknowledged = draft; view.draft = nil; view.acknowledgedPending = true }; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity(), g == generation else { if g == generation { invalidate() }; return }
            if binding != account { view.draft = nil; revisionFloor = 1; purgeFloor = 0; observedHidden = false; knownOriginal = nil; knownCurrent = nil; withheldAcknowledged = nil; view.acknowledgedPending = false }; binding = account
            if view.draft == nil && withheldAcknowledged == nil {
                do { let local = try load(account.accountID) ?? TeamTextRevisionDraft(accountID: account.accountID, requestID: requestID, targetID: targetID); try local.validate(account: account.accountID, request: requestID, target: targetID); if local.phase == .received { withheldAcknowledged = local; view.acknowledgedPending = true } else { view.draft = local }; revisionFloor = max(revisionFloor, local.receipt?.revision ?? 1) }
                catch { view.storageReady = false; view.message = "저장된 수정본을 읽지 못했어요. 원본을 유지했어요."; return }
            }
            let schemas = try await discover(account)
            guard schemas.count <= 16, Set(schemas).count == schemas.count, schemas.allSatisfy({ $0.count < 64 && $0.range(of: "^hps-team-text-change/[1-9][0-9]*$", options: .regularExpression) != nil }) else { throw SyncFailure.invalidResponse }
            let page = try await fetch(account, nil); guard await current(g, account) else { return }; try accept(page); view.supported = schemas.contains("hps-team-text-change/1")
        } catch { guard g == generation else { return }; if let binding, !(await current(g, binding)) { return }; clearRemote(); view.message = "현재 수정본을 확인하지 못했어요. 원문을 최신 내용으로 표시하지 않아요. 초안은 유지돼요." }
    }
    /// Explicit action after a fresh authoritative read; never called automatically on conflict.
    public func beginEdit() {
        guard !view.busy, view.storageReady, editable, let page = view.page, let old = view.draft ?? withheldAcknowledged, old.phase != .uncertain else { return }
        var next = TeamTextRevisionDraft(accountID: old.accountID, requestID: requestID, targetID: targetID, expectedRevision: page.current.revision)
        next.body = old.phase == .conflict || (old.phase == .draft && !old.body.isEmpty) ? old.body : page.current.body
        withheldAcknowledged = nil; view.acknowledgedPending = false; persist(next)
    }
    public func editBody(_ value: String) { guard !view.busy, view.storageReady, editable, var draft = view.draft, draft.phase == .draft, value.utf16.count <= 5000, !value.contains("\0") else { return }; draft.body = value; persist(draft) }
    public func submit() async {
        guard !view.busy, view.storageReady, editable, var draft = view.draft, draft.phase == .draft || draft.phase == .uncertain, let account = binding,
              draft.phase == .uncertain || draft.expectedRevision == view.page?.current.revision, (try? draft.payload()) != nil else { return }
        let g = generation; view.busy = true; view.message = ""; changed(view); defer { if g == generation { view.busy = false; changed(view) } }
        guard await current(g, account) else { return }; draft.phase = .uncertain; persist(draft); guard view.storageReady, await current(g, account) else { return }
        do {
            let event = try await send(account, draft); try event.validate(request: requestID, target: targetID); guard event.matches(draft), await current(g, account) else { if g == generation { throw SyncFailure.invalidResponse }; return }
            draft.phase = .received; draft.receipt = event; if event.retention?.hidden == true { draft.body = event.retention!.marker }; revisionFloor = max(revisionFloor, event.revision); persist(draft); clearRemote()
            if view.storageReady { view.message = "수정본이 저장됐어요. 새로고침해서 현재 기록을 확인해 주세요." }
        } catch SyncFailure.http(409, "team_text_revision_conflict") {
            guard await current(g, account) else { return }; draft.phase = .conflict; persist(draft); clearRemote(); view.message = "다른 수정본이 먼저 저장됐어요. 새로고침 후 새 수정으로 이어갈지 직접 선택해 주세요."
        } catch {
            guard await current(g, account) else { return }; clearRemote(); view.message = "저장 여부를 확인하지 못했어요. 같은 전송 번호와 내용을 유지했어요."
        }
    }
    public func more() async {
        guard !view.busy, view.storageReady, !view.historyNeedsRefresh, view.events.count < 500, let cursor = view.page?.next_cursor, let account = binding else { return }
        let g = generation; view.busy = true; changed(view); defer { if g == generation { view.busy = false; changed(view) } }
        do { let page = try await fetch(account, cursor); guard await current(g, account) else { return }; try accept(page, after: cursor) }
        catch { guard await current(g, account) else { return }; clearRemote(); view.message = "수정 이력을 더 읽지 못했어요. 새로고침해 주세요." }
    }
}


@MainActor public final class TeamTextRevisionControllers {
    private final class Entry { weak var value: TeamTextRevisionController?; init(_ value: TeamTextRevisionController) { self.value = value } }
    private var entries: [Entry] = []
    public init() {}
    public func register(_ controller: TeamTextRevisionController) {
        entries.removeAll { $0.value == nil }
        if !entries.contains(where: { $0.value === controller }) { entries.append(Entry(controller)) }
    }
    public func invalidate() { entries.removeAll { $0.value == nil }; entries.forEach { $0.value?.invalidate() } }
}
