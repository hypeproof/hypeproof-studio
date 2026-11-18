import Foundation

public struct TeamOutcomeBuild: Codable, Sendable, Equatable {
    public let deliveryID: String
    public let revision: Int
    public let version, build: String
    public func validate() throws {
        guard deliveryID.range(of: "^tdl_[a-f0-9]{32}$", options: .regularExpression) != nil, revision > 0, revision < 999_999_999,
              version.count <= 32, version.range(of: "^[0-9]+(?:\\.[0-9]+){0,2}$", options: .regularExpression) != nil,
              build.count <= 32, build.range(of: "^[0-9]+\\.[0-9]+$", options: .regularExpression) != nil else { throw SyncFailure.invalidResponse }
    }
}
public struct TeamOutcomeEvent: Codable, Sendable, Equatable, Identifiable {
    public let id, request_id, actor_account_id, client_mutation_id, delivery_id, version, build, action: String
    public let revision, delivery_revision: Int
    public let result: String?
    public let created_at: Double
    public let resolved_at, purge_eligible_at: Double?
    public let evidence_kind, device_installed, tester_eligibility: String
    public var target: TeamOutcomeBuild { TeamOutcomeBuild(deliveryID: delivery_id, revision: delivery_revision, version: version, build: build) }
    public func validate(request: String) throws {
        guard TeamRequestRecord.validID(request), request_id == request, id.range(of: "^tor_[a-f0-9]{32}$", options: .regularExpression) != nil,
              StoredAccount.validID(actor_account_id), client_mutation_id.range(of: "^[A-Za-z0-9_-]{8,64}$", options: .regularExpression) != nil,
              revision > 0, revision < 1_000_000_000, ["resolved","reopened"].contains(action), created_at.isFinite, created_at > 0,
              evidence_kind == "reporter_self_reported", device_installed == "not_observed", tester_eligibility == "not_observed" else { throw SyncFailure.invalidResponse }
        try target.validate()
        if let result { guard !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, result.utf16.count <= 2000, !result.contains("\0") else { throw SyncFailure.invalidResponse } }
        if action == "resolved" { guard resolved_at == created_at, purge_eligible_at == created_at + 90 * 86_400_000 else { throw SyncFailure.invalidResponse } }
        else { guard result != nil, resolved_at == nil, purge_eligible_at == nil else { throw SyncFailure.invalidResponse } }
    }
    public func matches(_ draft: TeamOutcomeDraft) -> Bool {
        request_id == draft.requestID && actor_account_id == draft.accountID && client_mutation_id == draft.key && revision == draft.expectedRevision + 1 && target == draft.target && action == draft.action && result == draft.resultValue
    }
}
public struct TeamOutcomePage: Decodable, Sendable {
    public struct Retention: Decodable, Sendable { public let policy: String; public let purge_eligible_at: Double?; public let purge_implemented: Bool }
    public let schema, request_id: String
    public let can_respond: Bool
    public let current: TeamOutcomeEvent?
    public let events: [TeamOutcomeEvent]
    public let next_cursor: String?
    public let retention: Retention
    public func validate(request: String) throws {
        guard schema == "hps-team-outcomes/1", request_id == request, TeamRequestRecord.validID(request), events.count <= 50,
              retention.policy == "90_days_after_reporter_confirmation",
              retention.purge_eligible_at == (current?.action == "resolved" ? current?.purge_eligible_at : nil) else { throw SyncFailure.invalidResponse }
        try current?.validate(request: request)
        var previous = 0; var ids = Set<String>()
        for event in events { try event.validate(request: request); guard event.revision > previous, event.revision <= (current?.revision ?? 0), ids.insert(event.id).inserted else { throw SyncFailure.invalidResponse }; if event.revision == current?.revision && event != current { throw SyncFailure.invalidResponse }; previous = event.revision }
        if let next_cursor { guard next_cursor == String(previous), previous > 0, previous < (current?.revision ?? 0) else { throw SyncFailure.invalidResponse } }
    }
}
public struct TeamOutcomeDraft: Codable, Sendable {
    public let accountID, requestID: String
    public var key = UUID().uuidString.lowercased()
    public var expectedRevision: Int
    public var target: TeamOutcomeBuild?
    public var action = "", result = ""
    public var phase: TeamWorkflowDraft.Phase = .draft
    public var receipt: TeamOutcomeEvent?
    public init(accountID: String, requestID: String, revision: Int) { self.accountID = accountID; self.requestID = requestID; expectedRevision = revision }
    public var resultValue: String? { result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : result }
    public func validate(account: String, request: String) throws {
        guard accountID == account, StoredAccount.validID(account), requestID == request, TeamRequestRecord.validID(request),
              UUID(uuidString: key)?.uuidString.lowercased() == key, expectedRevision >= 0, expectedRevision < 999_999_999,
              ["","resolved","reopened"].contains(action), result.utf16.count <= 2000, !result.contains("\0") else { throw SyncFailure.invalidResponse }
        try target?.validate()
        guard phase == .received || receipt == nil else { throw SyncFailure.invalidResponse }
        if phase == .received { guard let receipt else { throw SyncFailure.invalidResponse }; try receipt.validate(request: request); guard receipt.matches(self) else { throw SyncFailure.invalidResponse } }
        if phase == .uncertain || phase == .received { guard target != nil, !action.isEmpty, action != "reopened" || resultValue != nil else { throw SyncFailure.invalidResponse } }
    }
    public func payload() throws -> [String: Any] {
        try validate(account: accountID, request: requestID)
        guard let target, ["resolved","reopened"].contains(action), action != "reopened" || resultValue != nil else { throw SyncFailure.invalidResponse }
        return ["schema":"hps-team-outcome/1","client_mutation_id":key,"expected_revision":expectedRevision,"delivery_id":target.deliveryID,"delivery_revision":target.revision,"version":target.version,"build":target.build,"action":action,"result":resultValue as Any? ?? NSNull()]
    }
    public var exportText: String { "버전: \(target?.version ?? "미선택") · 빌드: \(target?.build ?? "미선택")\n\(action == "resolved" ? "해결됐어요" : action == "reopened" ? "아직 문제가 있어요" : "결과 미선택")\n\(result)" }
}
@MainActor public final class TeamOutcomeController {
    public struct View {
        public var page: TeamOutcomePage?, draft: TeamOutcomeDraft?
        public var events: [TeamOutcomeEvent] = []
        public var latestDelivery: TeamOutcomeBuild?
        public var busy = false, storageReady = true
        public var message = ""
        public init() {}
    }
    public private(set) var view = View()
    private let requestID: String
    private let identity: () async throws -> MemberApprovalIdentity?
    private let fetch: (MemberApprovalIdentity, String?) async throws -> TeamOutcomePage
    private let deliveries: (MemberApprovalIdentity) async throws -> TeamDeliveryPage
    private let send: (MemberApprovalIdentity, TeamOutcomeDraft) async throws -> TeamOutcomeEvent
    private let load: (String) throws -> TeamOutcomeDraft?
    private let save: (TeamOutcomeDraft) throws -> Void
    private let changed: (View) -> Void
    private var generation = UUID(), binding: MemberApprovalIdentity?
    public init(requestID: String, identity: @escaping () async throws -> MemberApprovalIdentity?, fetch: @escaping (MemberApprovalIdentity, String?) async throws -> TeamOutcomePage,
                deliveries: @escaping (MemberApprovalIdentity) async throws -> TeamDeliveryPage, send: @escaping (MemberApprovalIdentity, TeamOutcomeDraft) async throws -> TeamOutcomeEvent,
                load: @escaping (String) throws -> TeamOutcomeDraft?, save: @escaping (TeamOutcomeDraft) throws -> Void, changed: @escaping (View) -> Void) {
        self.requestID = requestID; self.identity = identity; self.fetch = fetch; self.deliveries = deliveries; self.send = send; self.load = load; self.save = save; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; view = View(); changed(view) }
    private func current(_ g: UUID, _ account: MemberApprovalIdentity) async throws -> Bool { guard g == generation else { return false }; let value = try await identity(); return g == generation && value == account }
    private func admitFailure(_ g: UUID) async -> Bool { guard g == generation else { return false }; let value = try? await identity(); guard g == generation else { return false }; guard value == binding, value != nil else { invalidate(); return false }; return true }
    private func persist(_ draft: TeamOutcomeDraft) throws { do { try save(draft) } catch { view.storageReady = false; throw error } }
    public func eligibleTargets(for action: String) -> [TeamOutcomeBuild] {
        var targets = view.latestDelivery.map { [$0] } ?? []
        if action == "reopened", let prior = view.page?.current?.target, !targets.contains(prior) { targets.append(prior) }
        return targets
    }
    private func target(for action: String) -> TeamOutcomeBuild? { eligibleTargets(for: action).first }
    public func chooseBuild(_ target: TeamOutcomeBuild) {
        guard !view.busy, view.storageReady, view.page?.can_respond == true, var draft = view.draft, draft.phase == .draft,
              eligibleTargets(for: draft.action).contains(target) else { return }
        draft.target = target; view.draft = draft
        do { try persist(draft); view.message = "" } catch { view.message = "기기에 저장하지 못했어요. 초안을 내보내 주세요." }; changed(view)
    }
    public func open() async {
        guard !view.busy, view.storageReady else { return }; generation = UUID(); let g = generation
        view.busy = true; view.page = nil; view.events = []; view.latestDelivery = nil; view.message = ""; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard let account = try await identity(), g == generation else { if g == generation { invalidate() }; return }
            if binding != account { view = View(); view.busy = true }; binding = account
            do { let draft = try load(account.accountID); try draft?.validate(account: account.accountID, request: requestID); view.draft = draft }
            catch { view.storageReady = false; view.message = "저장된 결과 초안을 읽지 못했어요. 원본을 유지했어요."; return }
            let page = try await fetch(account, nil); try page.validate(request: requestID)
            var latest: TeamOutcomeBuild?
            do { let delivery = try await deliveries(account); try delivery.validate(request: requestID); if let row = delivery.current, let proof = row.evidence { latest = TeamOutcomeBuild(deliveryID: row.id, revision: row.revision, version: proof.package.version, build: proof.package.build) } }
            catch { /* Existing reporter outcome still permits reopening its exact build. */ }
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            view.page = page; view.events = page.events; view.latestDelivery = latest
            if page.can_respond, view.draft == nil { let draft = TeamOutcomeDraft(accountID: account.accountID, requestID: requestID, revision: page.current?.revision ?? 0); try persist(draft); view.draft = draft }
            if var draft = view.draft, draft.phase == .draft, draft.expectedRevision != (page.current?.revision ?? 0) || (!draft.action.isEmpty && !eligibleTargets(for: draft.action).contains(where: { $0 == draft.target })) { draft.phase = .conflict; try persist(draft); view.draft = draft }
        } catch { if await admitFailure(g) { view.page = nil; view.events = []; view.latestDelivery = nil; view.message = view.storageReady ? "결과 확인 기능을 불러오지 못했어요. 로그인과 권한을 확인해 주세요." : "기기에 저장하지 못했어요. 초안을 내보내 주세요." } }
    }
    public func edit(action: String? = nil, result: String? = nil) {
        guard !view.busy, view.storageReady, view.page?.can_respond == true, var draft = view.draft, draft.phase == .draft else { return }
        if let action { draft.action = action; draft.target = target(for: action) }; if let result { draft.result = result }
        guard (try? draft.validate(account: draft.accountID, request: requestID)) != nil else { return }; view.draft = draft
        do { try persist(draft); view.message = "" } catch { view.message = "기기에 저장하지 못했어요. 초안을 내보내 주세요." }; changed(view)
    }
    public func rebase() {
        guard !view.busy, view.storageReady, let page = view.page, page.can_respond, var draft = view.draft, draft.phase == .conflict else { return }
        draft.expectedRevision = page.current?.revision ?? 0; if !eligibleTargets(for: draft.action).contains(where: { $0 == draft.target }) { draft.target = target(for: draft.action) }; draft.key = UUID().uuidString.lowercased(); draft.phase = .draft; draft.receipt = nil
        do { try persist(draft); view.draft = draft; view.message = "최신 버전과 결과를 다시 확인한 뒤 보내 주세요." } catch { view.message = "결과 초안을 저장하지 못했어요." }; changed(view)
    }
    public func newResponse() {
        guard !view.busy, view.storageReady, let page = view.page, page.can_respond, let binding, view.draft?.phase == .received else { return }
        guard (page.current?.revision ?? 0) >= (view.draft?.receipt?.revision ?? 0) else { view.message = "새로고침으로 최신 결과를 확인한 뒤 다시 작성해 주세요."; changed(view); return }
        let draft = TeamOutcomeDraft(accountID: binding.accountID, requestID: requestID, revision: page.current?.revision ?? 0)
        do { try persist(draft); view.draft = draft; view.message = "" } catch { view.message = "결과 초안을 저장하지 못했어요." }; changed(view)
    }
    public func submit() async {
        guard !view.busy, view.storageReady, view.page?.can_respond == true, let account = binding, var draft = view.draft, draft.phase == .draft || draft.phase == .uncertain else { return }
        let g = generation, first = draft.phase == .draft; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do {
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; _ = try draft.payload()
            draft.phase = .uncertain; try persist(draft); view.draft = draft; changed(view)
            let event = try await send(account, draft); try event.validate(request: requestID)
            guard try await current(g, account) else { if g == generation { invalidate() }; return }; guard event.matches(draft) else { throw SyncFailure.invalidResponse }
            draft.phase = .received; draft.receipt = event; view.draft = draft; try persist(draft)
            // A replay can return an older receipt. Never replace the current server history with it.
            view.message = "이 버전에 대한 확인 결과를 저장했어요. 새로고침하면 최신 이력을 볼 수 있어요."
        } catch SyncFailure.http(409, _) {
            guard await admitFailure(g) else { return }
            if first { draft.phase = .conflict; view.draft = draft; view.page = nil; do { try persist(draft) } catch {} }
            view.message = first ? "새 결과나 배포가 있어요. 새로고침한 뒤 버전을 다시 확인해 주세요." : "이전 전송 결과가 불명확해 같은 번호와 내용을 유지했어요."
        } catch { if await admitFailure(g) { view.message = view.storageReady ? "저장 여부를 확인하지 못했어요. 같은 내용으로 직접 다시 확인할 수 있어요. 자동으로 보내지 않아요." : "기기에 저장하지 못했어요. 초안을 내보내 주세요." } }
    }
    public func more() async {
        guard !view.busy, let account = binding, let after = view.page?.next_cursor else { return }; let g = generation; view.busy = true; changed(view)
        defer { if g == generation { view.busy = false; changed(view) } }
        do { let page = try await fetch(account, after); try page.validate(request: requestID); guard try await current(g, account) else { if g == generation { invalidate() }; return }
            guard page.events.allSatisfy({ $0.revision > (Int(after) ?? 0) }), (page.current?.revision ?? 0) >= (view.page?.current?.revision ?? 0) else { throw SyncFailure.invalidResponse }; view.events += page.events; view.page = page
        } catch { if await admitFailure(g) { view.page = nil; view.events = []; view.message = "결과 이력을 불러오지 못했어요." } }
    }
}
@MainActor public final class TeamOutcomeControllers {
    private final class Entry { weak var value: TeamOutcomeController?; init(_ value: TeamOutcomeController) { self.value = value } }
    private var entries: [Entry] = []
    public init() {}
    public func register(_ controller: TeamOutcomeController) { entries.removeAll { $0.value == nil }; if !entries.contains(where: { $0.value === controller }) { entries.append(Entry(controller)) } }
    public func invalidate() { entries.removeAll { $0.value == nil }; entries.forEach { $0.value?.invalidate() } }
}
