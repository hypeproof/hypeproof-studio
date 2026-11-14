import Foundation

public struct AccountQuestionIntent: Codable, Sendable {
    public let accountID, id, choice: String
    public init(accountID: String, id: String = UUID().uuidString.lowercased(), choice: String) { self.accountID = accountID; self.id = id; self.choice = choice }
    public func validate(account: String) throws {
        guard accountID == account, UUID(uuidString: id)?.uuidString.lowercased() == id, ["goal", "method", "decision"].contains(choice) else { throw SyncFailure.invalidResponse }
    }
}

/// Existing Service hps-card/1 data. Card actions never imply approval authority.
public struct AccountQuestion: Decodable, Sendable {
    public struct Choice: Decodable, Identifiable, Sendable { public let id, label: String }
    public struct Segment: Decodable, Sendable { public let kind, text: String; public let label: String? }
    public struct Action: Decodable, Identifiable, Sendable { public let id, label: String; public let primary, needs_answer: Bool }
    public struct Input: Decodable, Sendable { public let label, placeholder: String; public let max: Int; public let value: String? }
    public let schema, key, kind, prompt, select: String
    public let attempt: Int
    public let title, preface, skip, note: String?
    public let expires_at: Double?
    public let choices: [Choice], segments: [Segment], actions: [Action]
    public let text: Input?
    public static func validKey(_ key: String) -> Bool {
        key.range(of: "^[a-z][a-z0-9:.-]{1,63}$", options: .regularExpression) != nil && !key.contains("..") && !key.contains("\n")
    }
    public func validate() throws {
        func safe(_ value: String, _ max: Int = 4000) -> Bool { value.count <= max && !value.contains("\0") }
        guard schema == "hps-card/1", Self.validKey(key), safe(kind, 128), !kind.isEmpty,
              attempt > 0, attempt <= 100, !prompt.isEmpty, safe(prompt), ["tap", "pick"].contains(select),
              choices.count <= 20, actions.count <= 10, segments.count <= 30,
              Set(choices.map(\.id)).count == choices.count, Set(actions.map(\.id)).count == actions.count,
              choices.allSatisfy({ !$0.id.isEmpty && safe($0.id, 128) && !$0.label.isEmpty && safe($0.label) }),
              actions.allSatisfy({ !$0.id.isEmpty && safe($0.id, 128) && !$0.label.isEmpty && safe($0.label) }),
              segments.allSatisfy({ ["own_words", "ai_summary", "text"].contains($0.kind) && safe($0.text) && ($0.label.map { safe($0) } ?? true) }),
              [title, preface, skip, note].allSatisfy({ $0.map { safe($0) } ?? true }),
              expires_at == nil || expires_at!.isFinite,
              select != "tap" || actions.isEmpty else { throw SyncFailure.invalidResponse }
        if let text { guard (1...2000).contains(text.max), safe(text.label), safe(text.placeholder), text.value.map({ safe($0, text.max) }) ?? true else { throw SyncFailure.invalidResponse } }
    }
    public func available(now: Double = Date().timeIntervalSince1970) -> Bool { expires_at.map { $0 > now * 1000 } ?? true }
    public func answer(action: String?, choice: String?, words: String) throws -> [String: String] {
        guard available(), choice == nil || choices.contains(where: { $0.id == choice }),
              words.isEmpty || (text != nil && words.count <= text!.max), !words.contains("\0") else { throw SyncFailure.invalidResponse }
        if let action {
            guard let option = actions.first(where: { $0.id == action }), !option.needs_answer || choice != nil || !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw SyncFailure.invalidResponse }
        } else { guard actions.isEmpty, select == "tap", choice != nil else { throw SyncFailure.invalidResponse } }
        var body = ["surface": "mobile"]
        if let action { body["action"] = action }; if let choice { body["choice"] = choice }
        if text != nil { body["text"] = words }
        return body
    }
}

@MainActor public final class AccountQuestionController {
    public struct View {
        public var card: AccountQuestion?
        public var busy = false, message = ""
        public var words = "", choice: String?
        public var canStart = false
        public var pendingChoice: String?
        public init() {}
    }
    public private(set) var view = View()
    private var generation = UUID(), binding: MemberApprovalIdentity?
    private var emptyLoaded = false
    private let startingAvailable: (MemberApprovalIdentity) -> Bool
    private var draftKey: String?, shownKey: String?
    private let identity: () async throws -> MemberApprovalIdentity?
    private let load: (MemberApprovalIdentity) async throws -> AccountQuestion?
    private let act: (MemberApprovalIdentity, String, String, [String: String]) async throws -> String
    private let start: (MemberApprovalIdentity, String, String) async throws -> Void
    private let loadIntent: (String) throws -> AccountQuestionIntent?
    private let saveIntent: (String, AccountQuestionIntent?) throws -> Void
    private let changed: (View) -> Void
    private let observed: (ProductExperienceEvent.Kind) -> Void
    public init(identity: @escaping () async throws -> MemberApprovalIdentity?, load: @escaping (MemberApprovalIdentity) async throws -> AccountQuestion?, act: @escaping (MemberApprovalIdentity, String, String, [String: String]) async throws -> String, start: @escaping (MemberApprovalIdentity, String, String) async throws -> Void = { _, _, _ in throw SyncFailure.invalidResponse }, loadIntent: @escaping (String) throws -> AccountQuestionIntent? = { _ in nil }, saveIntent: @escaping (String, AccountQuestionIntent?) throws -> Void = { _, _ in }, observed: @escaping (ProductExperienceEvent.Kind) -> Void = { _ in }, startingAvailable: @escaping (MemberApprovalIdentity) -> Bool = { _ in false }, changed: @escaping (View) -> Void) {
        self.startingAvailable = startingAvailable; self.identity = identity; self.load = load; self.act = act; self.start = start; self.loadIntent = loadIntent; self.saveIntent = saveIntent; self.observed = observed; self.changed = changed
    }
    public func invalidate() { generation = UUID(); binding = nil; emptyLoaded = false; draftKey = nil; shownKey = nil; view = View(); changed(view) }
    public func dismiss() { generation = UUID(); view.card = nil; view.busy = false; emptyLoaded = false; view.canStart = false; changed(view) }
    public func edit(_ words: String) { guard !view.busy, let card = view.card, let input = card.text, words.count <= input.max else { return }; view.words = words; changed(view) }
    public func pick(_ id: String) { guard !view.busy, view.card?.choices.contains(where: { $0.id == id }) == true else { return }; view.choice = id; changed(view) }
    private func current(_ g: UUID, _ expected: MemberApprovalIdentity) async throws -> Bool { guard g == generation else { return false }; let now = try await identity(); return g == generation && now == expected }
    public func refresh() async {
        guard !view.busy else { return }; generation = UUID(); let g = generation
        view.busy = true; view.card = nil; view.canStart = false; emptyLoaded = false; view.message = "질문을 불러오고 있어요."; changed(view)
        do {
            guard let account = try await identity() else { invalidate(); return }
            guard g == generation else { return }
            if binding != account { view.words = ""; view.choice = nil; draftKey = nil; shownKey = nil }
            binding = account
            let pending = try loadIntent(account.accountID); try pending?.validate(account: account.accountID)
            view.pendingChoice = pending?.choice
            let card = try await load(account); try card?.validate()
            guard try await current(g, account) else { if g == generation { invalidate() }; return }
            if let card, card.available() {
                if draftKey != card.key { view.words = card.text?.value ?? ""; view.choice = nil; draftKey = card.key }
                view.card = card; view.message = ""
            } else { emptyLoaded = true; startAvailability() }
        } catch { if g == generation { view.message = "질문을 불러오지 못했어요. 작성한 답은 남겨 두었어요." } }
        if g == generation { view.busy = false; changed(view) }
    }
    private func startAvailability() {
        view.canStart = emptyLoaded && view.words.isEmpty && binding.map(startingAvailable) == true
        if emptyLoaded {
            view.message = view.pendingChoice != nil ? (view.canStart ? "아직 결과를 확인하지 못한 선택이 있어요. 같은 선택을 누르면 같은 요청으로 확인해요." : "아직 결과를 확인하지 못한 선택이 남아 있어요. 이용할 수 있을 때 다시 확인해 주세요.") : (view.canStart ? "지금 도착한 질문이 없어요. 어떤 생각부터 정리할까요?" : "지금 도착한 질문이 없어요.")
        }
    }
    public func startAvailabilityChanged() { guard !view.busy, emptyLoaded else { return }; startAvailability(); changed(view) }
    public func begin(_ choice: String) async {
        guard !view.busy, view.canStart, view.words.isEmpty, ["goal", "method", "decision"].contains(choice), view.pendingChoice == nil || view.pendingChoice == choice, let binding, startingAvailable(binding) else { return }
        let g = generation; view.busy = true; view.canStart = false; changed(view)
        do {
            guard try await current(g, binding) else { if g == generation { invalidate() }; return }
            guard startingAvailable(binding) else { view.busy = false; startAvailabilityChanged(); return }
            let intent = try loadIntent(binding.accountID) ?? AccountQuestionIntent(accountID: binding.accountID, choice: choice)
            try intent.validate(account: binding.accountID)
            guard intent.choice == choice else { throw SyncFailure.invalidResponse }
            try saveIntent(binding.accountID, intent) // Never dispatch an unrecorded intent.
            view.pendingChoice = choice
            try await start(binding, intent.id, choice)
            guard try await current(g, binding) else { if g == generation { invalidate() }; return }
            try saveIntent(binding.accountID, nil); view.pendingChoice = nil
            view.busy = false
            await refresh() // Read the existing card; never answer or send a conversation automatically.
        } catch {
            if g == generation { view.busy = false; view.message = "질문을 준비한 결과를 확인하지 못했어요. 새로고침으로 확인해 주세요. 자동으로 다시 요청하지 않아요."; changed(view) }
        }
    }
    public func presented(_ key: String) async {
        guard !view.busy, let card = view.card, card.key == key, let binding else { return }
        let marker = key + ":" + String(card.attempt)
        guard shownKey != marker else { return }
        shownKey = marker; let g = generation
        do { guard try await current(g, binding) else { return }; observed(.questionPresented); _ = try await act(binding, key, "shown", ["surface": "mobile"]) }
        catch { /* A failed exposure receipt is not a successful answer; never retry automatically. */ }
    }
    public func submit(action: String? = nil, choice: String? = nil, skip: Bool = false) async {
        guard !view.busy, let card = view.card, let binding, card.available(), !skip || card.skip != nil else { return }
        let body: [String: String]
        do { body = skip ? ["surface": "mobile"] : try card.answer(action: action, choice: choice ?? view.choice, words: view.words) }
        catch { view.message = "답이나 선택을 먼저 확인해 주세요."; changed(view); return }
        let g = generation; view.busy = true; changed(view)
        do {
            guard try await current(g, binding), card.available() else { if g == generation { invalidate() }; return }
            let message = try await act(binding, card.key, skip ? "skip" : "answer", body)
            guard try await current(g, binding) else { if g == generation { invalidate() }; return }
            observed(skip ? .questionSkipped : .questionAnswered)
            view.card = nil; view.message = message; view.words = ""; view.choice = nil; draftKey = nil
        } catch {
            if g == generation { view.card = nil; view.message = "처리 결과를 확인하지 못했어요. 작성한 답은 남겨 두었어요. 자동으로 다시 보내지 않아요." }
        }
        if g == generation { view.busy = false; changed(view) }
    }
}
