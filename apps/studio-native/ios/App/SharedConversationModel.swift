import SwiftUI
import Security
import AuthenticationServices

private enum AccountKeychain {
    static var query: [String: Any] {
        var value: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.hypeproof.studio.mobile.account", kSecAttrAccount as String: "device-session"]
#if DEBUG
        if NativeJourneyFixture.enabled { value[kSecAttrService as String] = "ai.hypeproof.studio.mobile.journey." + NativeJourneyFixture.namespace }
#endif
        return value
    }
    private static func failure(_ operation: String, _ status: OSStatus, _ message: String) -> StudioError {
        // Never log a query, account identifier, credential or stored bytes.
        NSLog("HP Studio account storage %@ failed (%d)", operation, status)
        return .message(message)
    }
    private static func readData(_ query: [String: Any]) throws -> Data? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data else { throw failure("read", status, "안전한 계정 저장소를 읽지 못했어요.") }
        return bytes
    }
    private static func saveData(_ data: Data, query: [String: Any]) throws {
        let update = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if result == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(q as CFDictionary, nil)
            guard added == errSecSuccess else { throw failure("add", added, "로그인을 안전하게 저장하지 못했어요.") }
        } else if result != errSecSuccess { throw failure("update", result, "로그인을 안전하게 저장하지 못했어요.") }
    }
    private static func removeData(_ query: [String: Any]) throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw failure("delete", result, "이 기기의 로그인을 지우지 못했어요.") }
    }
    static func read() throws -> StoredAccount? {
        guard let bytes = try readData(query) else { return nil }
        return try JSONDecoder().decode(StoredAccount.self, from: bytes)
    }
    static func save(_ value: StoredAccount) throws { try saveData(JSONEncoder().encode(value), query: query) }
    static func remove() throws { try removeData(query) }
#if DEBUG
    static func verifyNativeStorage() throws {
        // Exercise this app's actual Keychain entitlement with an isolated synthetic item.
        var probe = query; probe[kSecAttrService as String] = "ai.hypeproof.studio.mobile.verification." + UUID().uuidString
        defer { try? removeData(probe) }
        let first = Data(UUID().uuidString.utf8), second = Data(UUID().uuidString.utf8)
        try saveData(first, query: probe)
        guard try readData(probe) == first else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
        try saveData(second, query: probe)
        guard try readData(probe) == second else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
        let tokens = AccountTokens(access_token: "synthetic-access", refresh_token: String(repeating: "a", count: 64), expires_in: 3600, session_id: "synthetic-session")
        let pending = try StoredAccount(accountID: "synthetic-account", tokens: tokens, expiresAt: Date(), refreshPending: true)
        try saveData(JSONEncoder().encode(pending), query: probe)
        guard let stored = try readData(probe), try JSONDecoder().decode(StoredAccount.self, from: stored).refreshPending else {
            throw StudioError.message("로그인 갱신 상태를 안전하게 저장하지 못했어요.")
        }
        try removeData(probe)
        guard try readData(probe) == nil else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
    }
#endif
}
private struct SharedCacheFile: Codable {
    let accountID: String
    var conversations: [SharedConversation] = []
    var entries: [String: ConversationCache] = [:]
}

@MainActor final class SharedConversationModel: ObservableObject {
    static let personalID = "personal-reflection"
    @Published private(set) var opening = "요즘 어떤 일에 시간을 많이 쓰세요?"
    @Published private(set) var openingHint = "일, 공부, 돌봄, 쉬는 시간까지 어떤 이야기든 좋아요."
    @Published private(set) var hasEarlierReflection = false
    var isReflection: Bool { selected == Self.personalID }
    @Published private var guestDraft = GuestDraft()
    private var guestDraftReadable = true
    private var guestDraftFailure: String?
    @Published private(set) var signedIn = false
    @Published private(set) var approvalEntryVisible = false
    @Published private(set) var conversations: [SharedConversation] = []
    @Published private(set) var entries: [String: ConversationCache] = [:]
    @Published private(set) var signIn: DeviceSignIn?
    @Published private(set) var busy = false
    @Published private(set) var syncing = false
    @Published private(set) var stoppingReflection = false
    private var reflectionCredential: Task<String, Error>?
    private var responseGeneration = UUID()
    private var stoppedResponse: (generation: UUID, requestID: String, accountID: String, sessionID: String, failure: String?)?
    private var stopOperation: Task<Void, Never>?
    @Published private(set) var accountStorageReady = false
#if DEBUG
    @Published private(set) var accountStorageVerified = false
#endif
    @Published var selected: String?
    @Published var error: String?
    @Published var notice = ""
    @Published private var editing: [String: [String: [String: String]]] = [:]
    private var account: StoredAccount?
    private let tokenFlight = AccountTokenRefreshFlight()
    lazy var approvals: MemberApprovalPresentation = {
        let presentation = MemberApprovalPresentation()
        presentation.controller = MemberApprovalController(identity: { [weak self] in try await self?.approvalIdentity() }, list: { [weak self] binding in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.service.approvalInbox(token)
        }, card: { [weak self] binding, id, decision in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.service.approvalCard(id, decision: decision, token: token)
        }, load: { [weak self] account in
            guard let self else { throw CancellationError() }
            let folder = try self.approvalDirectory(account)
            guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            guard files.count <= 50 else { throw SyncFailure.invalidResponse }
            return try files.map { file in
                let data = try Data(contentsOf: file)
                guard data.count < 4096 else { throw SyncFailure.invalidResponse }
                let value = try JSONDecoder().decode(MemberApprovalPending.self, from: data)
                try value.validate(account: account); return value
            }
        }, save: { [weak self] account, pending in
            guard let self else { throw CancellationError() }
            try pending.validate(account: account)
            let folder = try self.approvalDirectory(account)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var excluded = folder; var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try excluded.setResourceValues(flags)
            try JSONEncoder().encode(pending).write(to: folder.appendingPathComponent(pending.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }, remove: { [weak self] account, id in
            guard let self, UUID(uuidString: id)?.uuidString.lowercased() == id else { throw SyncFailure.invalidResponse }
            let file = try self.approvalDirectory(account).appendingPathComponent(id + ".json")
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }, changed: { [weak presentation, weak self] state in presentation?.state = state; self?.approvalEntryVisible = state.entryVisible })
        return presentation
    }()
    private func discoverApprovals() {
        let attempt = epoch
        Task { [weak self] in
            guard let self, self.epoch == attempt, self.signedIn else { return }
            await self.approvals.controller?.discover()
        }
    }
    private func approvalDirectory(_ account: String) throws -> URL {
        guard StoredAccount.validID(account) else { throw SyncFailure.invalidResponse }
        let key = Data(account.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "")
        return directory.appendingPathComponent("approval-decisions", isDirectory: true).appendingPathComponent(key, isDirectory: true)
    }
    private func approvalIdentity() async throws -> MemberApprovalIdentity? {
        guard signedIn, let before = account else { return nil }
        let attempt = epoch, credential = try await token()
        let returned = try await service.accountID(credential, sessionID: before.tokens.session_id)
        guard epoch == attempt, signedIn, let current = account, current.accountID == returned, current.accountID == before.accountID, current.tokens.session_id == before.tokens.session_id else { throw CancellationError() }
        return MemberApprovalIdentity(accountID: returned, sessionID: current.tokens.session_id)
    }
    private func approvalToken(_ binding: MemberApprovalIdentity) async throws -> String {
        let attempt = epoch, credential = try await token()
        guard epoch == attempt, signedIn, account?.accountID == binding.accountID, account?.tokens.session_id == binding.sessionID else { throw CancellationError() }
        return credential
    }
    private var operation: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private var epoch = UUID()
    private var visible = true
    private var cacheReadable = true
    private let service: ConversationService
    private let browser = NativeBrowserSignIn()
    @Published private(set) var loginStatus = ""
    private var queuedSend: (id: String, requestID: String)?
    private let directory: URL
    var cache: ConversationCache { overlay(entries[selected ?? ""] ?? ConversationCache(), id: selected ?? "") }
    var draftText: String { signedIn ? cache.draft : guestDraft.text }
    var canEditDraft: Bool { signedIn ? selected != nil && cacheReadable : guestDraftReadable }
    var pendingGuestDraft: String? { signedIn && !guestDraft.text.isEmpty ? guestDraft.text : nil }
    var canRestoreGuestDraft: Bool {
        signedIn && accountStorageReady && cacheReadable && guestDraftReadable && isReflection
            && !busy && !syncing && guestDraft.canRestore(into: cache)
    }
    var canRestoreFailedReflectionDraft: Bool {
        signedIn && accountStorageReady && cacheReadable && isReflection && !busy && !syncing
            && cache.canRestoreFailedReflectionDraft
    }
    @discardableResult func restoreFailedReflectionDraft() -> Bool {
        guard canRestoreFailedReflectionDraft else { return false }
        do {
            try edit(Self.personalID) { _ = $0.restoreFailedReflectionDraft() }
            notice = "입력란에 가져왔어요. 내용을 확인한 뒤 보내 주세요."
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    var title: String { conversations.first { $0.id == selected }?.title ?? "대화 이어가기" }
    var canStopReflection: Bool {
        signedIn && accountStorageReady && cacheReadable && isReflection && !stoppingReflection
            && !syncing && (reflectionCredential != nil || !busy) && cache.request?.outstanding == true
    }
    var canSend: Bool { !stoppingReflection && signedIn && cacheReadable && conversations.contains(where: { $0.id == selected }) && cache.request?.outstanding != true && !busy }
    var sendingCurrentRequest: Bool {
        busy || (queuedSend != nil && queuedSend?.id == selected && queuedSend?.requestID == cache.request?.id)
    }
    init() {
#if DEBUG
        service = NativeJourneyFixture.service ?? ConversationService()
        let cacheName = NativeJourneyFixture.enabled ? "native-journey-" + NativeJourneyFixture.namespace : "shared-conversations"
#else
        service = ConversationService()
        let cacheName = "shared-conversations"
#endif
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(cacheName, isDirectory: true)
        restoreAccount()
        do { guestDraft = try GuestDraft.load(from: guestFile) }
        catch {
            guestDraftReadable = false; guestDraftFailure = GuestDraftError.unreadable.localizedDescription
            self.error = guestDraftFailure
        }
    }
    func restoreAccount() {
        guard !busy, !syncing, !stoppingReflection, !signedIn else { return }
        error = nil; accountStorageReady = false
#if DEBUG
        accountStorageVerified = false
#endif
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            account = try AccountKeychain.read()
            if account?.refreshPending == true {
                // The previous process may have consumed the one-use token.
                // Never retry it. Conversation files remain untouched.
                account = nil
                try AccountKeychain.remove()
                error = "로그인 갱신이 중단됐어요. 다시 로그인하면 저장된 대화를 이어갈 수 있어요."
            }
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--verify-account-storage") {
                try AccountKeychain.verifyNativeStorage(); accountStorageVerified = true
            }
#endif
            accountStorageReady = true; signedIn = account != nil
            if let account { try load(account.accountID); discoverApprovals() }
        } catch { self.error = error.localizedDescription }
    }
    private func file(_ accountID: String) -> URL {
        // Identity-derived filename never accepts path components from the server.
        directory.appendingPathComponent(Data(accountID.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_") + ".json")
    }
    private var guestFile: URL { directory.appendingPathComponent("guest-draft-v1.json") }
    private func load(_ id: String) throws {
        // The local personal draft is editable immediately, even offline. Send
        // still requires the authenticated server conversation in canSend.
        entries = [:]; conversations = []; selected = Self.personalID; cacheReadable = true
#if DEBUG
        try NativeJourneyFixture.seedAccountDraftIfNeeded(at: file(id), accountID: id)
#endif
        guard FileManager.default.fileExists(atPath: file(id).path) else { return }
        do {
            let value = try JSONDecoder().decode(SharedCacheFile.self, from: Data(contentsOf: file(id)))
            guard value.accountID == id else { throw SyncFailure.invalidResponse }
            entries = value.entries; conversations = value.conversations
        } catch { cacheReadable = false; throw StudioError.message("이 기기의 연동 기록을 읽지 못했어요. 원본을 보존하기 위해 덮어쓰지 않아요.") }
    }
    private func persist(entries: [String: ConversationCache], conversations: [SharedConversation]? = nil) throws {
        guard cacheReadable, let account else { throw StudioError.message("연동 기록을 안전하게 저장할 수 없어요.") }
        let list = conversations ?? self.conversations
        let bytes = try JSONEncoder().encode(SharedCacheFile(accountID: account.accountID, conversations: list, entries: entries))
        var url = file(account.accountID)
        try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        self.entries = entries; self.conversations = list
    }
    private func edit(_ id: String, _ change: (inout ConversationCache) throws -> Void) throws {
        var next = entries; var value = overlay(next[id] ?? ConversationCache(), id: id); try change(&value); next[id] = value
        try persist(entries: next)
        if let account { editing[account.accountID]?[id] = nil }
    }
    private func overlay(_ original: ConversationCache, id: String) -> ConversationCache {
        original.applyingEdits(editing[account?.accountID ?? ""]?[id] ?? [:])
    }
    func editDraft(_ value: String) {
        guard canEditDraft else { return }
        if !signedIn {
            guestDraft.text = value
            do {
                guard guestDraftReadable else { throw GuestDraftError.unreadable }
                try guestDraft.save(to: guestFile)
                if error == guestDraftFailure { error = nil }
                guestDraftFailure = nil
            } catch { guestDraftFailure = error.localizedDescription; self.error = guestDraftFailure }
            return
        }
        guard let selected, let account else { return }
        editing[account.accountID, default: [:]][selected, default: [:]]["draft"] = value
        do { try edit(selected) { $0.draft = value } } catch { self.error = error.localizedDescription }
    }
    @discardableResult func restoreGuestDraft() -> Bool {
        guard canRestoreGuestDraft else { return false }
        return adoptGuestDraft()
    }
    private func adoptGuestDraft() -> Bool {
        guard signedIn, accountStorageReady, cacheReadable, guestDraftReadable, isReflection,
              account != nil, guestDraft.canRestore(into: cache) else { return false }
        var next = guestDraft
        do {
            let restored = try next.handoff(into: cache, saveAccount: { value in
                try self.edit(Self.personalID) { $0 = value }
            }, saveGuest: { try $0.save(to: self.guestFile) })
            guestDraft = next
            if error == guestDraftFailure { error = nil }
            guestDraftFailure = nil
            return restored
        } catch { guestDraftFailure = error.localizedDescription; self.error = guestDraftFailure; return false }
    }
    func editContext(_ key: String, value: String) {
        guard let selected, let account else { return }
        editing[account.accountID, default: [:]][selected, default: [:]][key] = value
        do { try edit(selected) { if $0.context == nil { $0.context = [:] }; $0.context?[key] = value } }
        catch { self.error = error.localizedDescription }
    }
    func shareContextDraft() -> Bool {
        guard let selected, cache.draft.isEmpty else { error = "작성 중인 글을 먼저 확인해 주세요. 덮어쓰지 않았어요."; return false }
        let fields = [("goal", "바라는 변화"), ("audience", "도움을 주고 싶은 사람"), ("experience", "지금 알고 있는 것과 어려운 것"), ("style", "편한 질문 방식")]
        let lines = fields.compactMap { key, title -> String? in
            guard let value = cache.context?[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
            return title + ": " + value
        }
        guard !lines.isEmpty else { error = "공유하고 싶은 내용 한 가지만 적어도 괜찮아요."; return false }
        do { try edit(selected) { $0.draft = "내가 직접 정리한 현재 맥락이에요. 바뀌면 다시 알려드릴게요.\n" + lines.joined(separator: "\n") }; return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func choose(_ id: String?) { selected = id; error = nil; refresh() }
    func setVisible(_ value: Bool) {
        visible = value; polling?.cancel(); polling = nil
        if value {
            refresh()
            polling = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 4_000_000_000)
                    guard !Task.isCancelled, let self, self.visible else { return }
                    await self.synchronize()
                }
            }
        }
        // Keep an in-flight refresh alive to store rotated credentials. No new reads are scheduled in background.
    }
    func login() {
        guard !busy, !syncing, !stoppingReflection else { return }
        guard accountStorageReady else { error = "계정 저장소를 먼저 다시 확인해 주세요."; return }
        busy = true; error = nil; loginStatus = "계정 로그인 화면을 열고 있어요."; let attempt = epoch
        operation = Task {
            var acquired: AccountTokens?
            do {
                let proof = NativeAccountProof()
                let start = try await service.startNativeSignIn(proof)
                guard epoch == attempt else { return }
                loginStatus = "계정 로그인을 마치면 자동으로 돌아와요."
                let callback = try await browser.authenticate(start.authorization_uri, expiresIn: start.expires_in)
                try Task.checkCancellation()
                guard epoch == attempt else { return }
                let code = try proof.authorizationCode(from: callback)
                loginStatus = "로그인을 마무리하고 있어요."
                // The code is single-use. Never retry an ambiguous exchange.
                let tokens = try await service.exchangeNativeSignIn(code: code, proof: proof)
                acquired = tokens
                let id = try await service.accountID(tokens.access_token, sessionID: tokens.session_id)
                try Task.checkCancellation()
                guard epoch == attempt else { try? await service.logout(tokens.access_token); return }
                let value = try StoredAccount(accountID: id, tokens: tokens, expiresAt: Date().addingTimeInterval(tokens.expires_in))
                do { try AccountKeychain.save(value) }
                catch { accountStorageReady = false; throw error }
                tokenFlight.invalidate(); approvals.invalidate(); account = value; signedIn = true; acquired = nil
                try load(id)
                // Only this successful, epoch-fenced explicit login may adopt
                // guest writing. This changes a local draft, never the outbox.
                _ = adoptGuestDraft()
                discoverApprovals()
            } catch {
                if let acquired { try? await service.logout(acquired.access_token) }
                if epoch == attempt {
                    if error is CancellationError || (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        notice = "로그인을 취소했어요. 준비되면 다시 시작해 주세요."
                    } else { self.error = error.localizedDescription }
                }
            }
            if epoch == attempt { busy = false; loginStatus = ""; await synchronize() }
        }
    }
    func cancelLogin() {
        epoch = UUID(); browser.cancel(); operation?.cancel(); operation = nil
        signIn = nil; busy = false; loginStatus = ""; notice = "로그인을 취소했어요."
    }
    private func token() async throws -> String {
        guard accountStorageReady, let current = account else { throw SyncFailure.http(401, "account_required") }
        if current.expiresAt > Date().addingTimeInterval(90) { return current.tokens.access_token }
        return try await tokenFlight.run(identity: MemberApprovalIdentity(accountID: current.accountID, sessionID: current.tokens.session_id), current: { [weak self] in
            guard let account = self?.account else { return nil }
            return MemberApprovalIdentity(accountID: account.accountID, sessionID: account.tokens.session_id)
        }, renew: { try await self.renewToken() })
    }
    private func renewToken() async throws -> String {
        guard accountStorageReady, let old = account else { throw SyncFailure.http(401, "account_required") }
        if old.expiresAt > Date().addingTimeInterval(90) { return old.tokens.access_token }
        do {
            let next = try await AccountCredentialRefresh.renew(old, save: { value in
                guard self.account?.tokens.session_id == old.tokens.session_id else { throw CancellationError() }
                do { try AccountKeychain.save(value) }
                catch { self.accountStorageReady = false; throw error }
            }, refresh: { try await self.service.refresh($0) }, accountID: { tokens in
                try await self.service.accountID(tokens.access_token, sessionID: tokens.session_id)
            }, revoke: { try? await self.service.logout($0) })
            guard account?.accountID == old.accountID, account?.tokens.session_id == old.tokens.session_id else { throw CancellationError() }
            account = next; return next.tokens.access_token
        } catch {
            // Refresh tokens rotate once. An uncertain response requires fresh login, never reuse.
            if account?.tokens.session_id == old.tokens.session_id { clearAccount() }
            throw error
        }
    }
    private func clearAccount() {
        tokenFlight.invalidate(); approvals.invalidate()
        do { try AccountKeychain.remove() } catch { accountStorageReady = false }
        account = nil; signedIn = false; entries = [:]; conversations = []; selected = nil
    }
    func refresh() { Task { await synchronize() } }
    private func synchronize() async {
        guard signedIn, cacheReadable, visible, !busy, !syncing, !stoppingReflection else { return }
        syncing = true; let attempt = epoch; let current = selected
        defer {
            syncing = false
            // Only this session's explicit Send can start a queued request. Reads,
            // restart and ambiguous network failures never schedule a replay.
            if let queued = queuedSend {
                queuedSend = nil
                if epoch == attempt, visible, selected == queued.id,
                   entries[queued.id]?.request?.id == queued.requestID { retry() }
            }
        }
        do {
            let credential = try await token()
            let personal = try await service.reflection(credential)
            guard epoch == attempt else { return }
            try applyReflection(personal)
            let personalItem = SharedConversation(id: Self.personalID, title: "나를 알아가는 대화", host_session_id: "", revision: personal.state.revision, updated_at: personal.state.messages.last?.created_at ?? 0)
            // A desktop-list outage must not hide an already available personal conversation.
            try persist(entries: entries, conversations: [personalItem] + conversations.filter { $0.id != Self.personalID })
            var list = try await service.list(credential)
            list.insert(personalItem, at: 0)
            guard epoch == attempt else { return }
            try persist(entries: entries, conversations: list)
            if let id = current, id != Self.personalID, list.contains(where: { $0.id == id }) {
                // Read completion before events: an observed completion must include its final answer.
                let requests = try await service.requests(id, token: credential)
                guard epoch == attempt else { return }
                var caughtUp = false
                // Page repeatedly with a bound; the next polling cycle continues if more remain.
                for _ in 0..<10 {
                    let page = try await service.events(id, after: entries[id]?.cursor ?? 0, token: credential)
                    guard epoch == attempt else { return }
                    try edit(id) { try $0.apply(page) }
                    if !page.has_more { caughtUp = true; break }
                }
                if let own = entries[id]?.request, let found = requests.first(where: { $0.id == own.id }) {
                    if found.status != "completed" || caughtUp { try edit(id) { $0.request = found } }
                } else if entries[id]?.request?.outstanding != true, let active = requests.first(where: { $0.outstanding }) {
                    try edit(id) { $0.request = active }
                }
            }
            error = guestDraftFailure ?? cache.requestFailure
            notice = isReflection ? "같은 계정의 대화예요. 컴퓨터가 꺼져 있어도 질문을 받을 수 있어요." : "동기화됨 · 이 작업의 실행은 데스크톱에 있어요"
        } catch { if epoch == attempt { failure(error) } }
    }
    private func applyReflection(_ value: PersonalReflection) throws {
        try edit(Self.personalID) { try $0.applyReflection(value) }
        opening = value.opening; openingHint = value.hint; hasEarlierReflection = value.state.has_earlier
    }
    private func failure(_ error: Error) {
        self.error = error.localizedDescription
        if case SyncFailure.http(let status, let code) = error, status == 401 || ["session_revoked", "account_inactive", "refresh_reuse"].contains(code) {
            clearAccount()
        }
    }
    func send() {
        guard canSend, let id = selected else { return }
        do { try edit(id) { try $0.enqueue(reflection: id == Self.personalID) } } catch { self.error = error.localizedDescription; return }
        if syncing, let request = entries[id]?.request {
            queuedSend = (id, request.id); notice = "보낸 말을 저장했어요. 대화 확인이 끝나면 전송해요."
        } else { retry() }
    }
    func retry() {
        guard !busy, !syncing, !stoppingReflection, let id = selected, let request = entries[id]?.request, request.status == "local" else { return }
        busy = true; let attempt = epoch; error = nil
        let generation = UUID(); responseGeneration = generation; stoppedResponse = nil
        let credentialTask = Task { try await self.token() }
        reflectionCredential = id == Self.personalID ? credentialTask : nil
        operation = Task {
            do {
                let credential = try await credentialTask.value
                guard epoch == attempt, responseGeneration == generation else { return }
                if id == Self.personalID {
                    let result = try await service.reflect(request, token: credential)
                    guard epoch == attempt, responseGeneration == generation else { return }
                    try applyReflection(result)
                } else {
                let result = try await service.submit(id, request: request, token: credential)
                guard epoch == attempt, responseGeneration == generation else { return }
                guard result.id == request.id, result.text == request.text else { throw SyncFailure.invalidResponse }
                try edit(id) { $0.request = result }
                }
            } catch {
                if epoch == attempt, responseGeneration == generation {
                    // Successful history reads cannot erase a failed send (for
                    // example missing AI access, a budget limit or network loss).
                    try? edit(id) { $0.requestFailure = error.localizedDescription }
                    if case SyncFailure.http(let status, _) = error, status == 400 || (id == Self.personalID && status == 409) {
                        try? edit(id) { value in
                            value.draft = value.draft.isEmpty ? request.text : value.draft + "\n" + request.text
                            value.request = nil
                        }
                    }
                    failure(error)
                } else if epoch == attempt, id == Self.personalID,
                          stoppedResponse?.generation == generation,
                          stoppedResponse?.requestID == request.id,
                          stoppedResponse?.accountID == account?.accountID,
                          stoppedResponse?.sessionID == account?.tokens.session_id,
                          !(error is CancellationError), (error as? URLError)?.code != .cancelled {
                    // Stop can race a typed admission failure. Preserve its
                    // reason only for this failed row, never a cancelled or
                    // completed turn, newer send, account or voice continuation.
                    stoppedResponse?.failure = error.localizedDescription
                    if entries[id]?.request?.id == request.id, entries[id]?.request?.status == "failed" {
                        try? edit(id) { $0.requestFailure = error.localizedDescription }
                        if selected == id { self.error = error.localizedDescription }
                    }
                }
            }
            if epoch == attempt, responseGeneration == generation { reflectionCredential = nil; busy = false; await synchronize() }
        }
    }
    func stopReflection() {
        guard canStopReflection, let request = cache.request, let accountID = account?.accountID, let sessionID = account?.tokens.session_id else { return }
        let attempt = epoch, credentialTask = reflectionCredential
        let originalOperation = operation
        // A late POST result must not overwrite the independently acknowledged
        // cancel snapshot or restart read-aloud. Keep its durable outbox identity.
        stoppedResponse = (responseGeneration, request.id, accountID, sessionID, nil)
        responseGeneration = UUID(); stoppingReflection = true; error = nil
        notice = "답변 중지를 확인하고 있어요. 이미 실행된 AI 비용은 발생할 수 있어요."
        stopOperation = Task {
            var awaitFailedResponse = false
            defer {
                if !awaitFailedResponse { originalOperation?.cancel() }
                if epoch == attempt {
                    reflectionCredential = nil; busy = false; stoppingReflection = false
                    stopOperation = nil
                }
            }
            do {
                let credential: String
                if let credentialTask { credential = try await credentialTask.value }
                else { credential = try await token() }
                // /cancel is a no-op before Service inserts the running row.
                // Wait briefly for that exact human turn, never infer success
                // from an unrelated/empty snapshot and never replay the POST.
                let deadline = ProcessInfo.processInfo.systemUptime + 8
                for check in 0..<10 {
                    guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                    let remaining = deadline - ProcessInfo.processInfo.systemUptime
                    guard remaining > 0 else { break }
                    let current = try await service.reflection(credential, timeout: remaining)
                    guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                    if let turn = current.state.turn, turn.id == request.id, turn.text == request.text {
                        let remaining = deadline - ProcessInfo.processInfo.systemUptime
                        guard remaining > 0 else { break }
                        let result = turn.outstanding ? try await service.cancelReflection(request.id, token: credential, timeout: remaining) : current
                        guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                        guard let confirmed = result.state.turn, confirmed.id == request.id,
                              confirmed.text == request.text, !confirmed.outstanding else {
                            throw StudioError.message("아직 중지를 확인하지 못했어요. 보낸 글은 남아 있어요. 다시 확인해 주세요.")
                        }
                        try edit(Self.personalID) {
                            try $0.applyReflectionStop(result, request: request)
                            if confirmed.status == "failed", let reason = stoppedResponse?.failure { $0.requestFailure = reason }
                        }
                        awaitFailedResponse = confirmed.status == "failed"
                        if confirmed.status == "failed" { error = entries[Self.personalID]?.requestFailure }
                        opening = result.opening; openingHint = result.hint; hasEarlierReflection = result.state.has_earlier
                        switch confirmed.status {
                        case "cancelled": notice = "답변 받기를 중지했어요. 이미 실행된 AI 비용은 발생할 수 있어요."
                        case "completed": notice = "답변이 이미 도착했어요. 대화에서 확인해 주세요."
                        case "failed": notice = "답변을 받지 못했어요. 보낸 이야기는 남아 있어요."
                        default: notice = "완료 여부를 확인하지 못했어요. 보낸 이야기는 남아 있으며 자동으로 다시 보내지 않아요."
                        }
                        return
                    }
                    if check < 9 { try await Task.sleep(nanoseconds: 200_000_000) }
                }
                throw StudioError.message("아직 중지를 확인하지 못했어요. 보낸 글은 남아 있어요. 다시 확인해 주세요.")
            } catch { if epoch == attempt { failure(error) } }
        }
    }
    func recoverReflection() {
        guard isReflection, !busy, !syncing, !stoppingReflection, let request = cache.request, request.status == "running" else { return }
        busy = true; let attempt = epoch
        operation = Task {
            do {
                let credential = try await token()
                let result = try await service.abandonReflection(request.id, token: credential)
                guard epoch == attempt else { return }; try applyReflection(result)
            } catch { if epoch == attempt { failure(error) } }
            if epoch == attempt { busy = false }
        }
    }
    func cancelPending() {
        guard !busy, !syncing, !stoppingReflection, let id = selected, let request = cache.request else { return }
        guard request.status == "pending" else { return }
        busy = true; let attempt = epoch
        operation = Task {
            do {
                let credential = try await token()
                let result = try await service.cancel(id, requestID: request.id, token: credential)
                guard epoch == attempt else { return }; try edit(id) { $0.request = result }
            } catch { if epoch == attempt { failure(error) } }
            if epoch == attempt { busy = false }
        }
    }
    func logout() {
        approvals.invalidate()
        guard !busy, !syncing, !stoppingReflection else { return }
        if let account, !(editing[account.accountID] ?? [:]).isEmpty { error = "저장하지 못한 수정이 있어요. 기록을 내보내고 저장 오류를 확인해 주세요."; return }
        tokenFlight.invalidate()
        let old = account; epoch = UUID(); let attempt = epoch; busy = true
        operation = Task {
            do {
                if let old { try await service.logout(old.tokens.access_token) }
                try AccountKeychain.remove()
                guard epoch == attempt else { return }
                account = nil; signedIn = false; entries = [:]; conversations = []; selected = nil; notice = "로그아웃했어요. 이 기기의 기록 사본은 보존했어요."
            } catch { self.error = "서버의 기기 연결을 해제하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요." }
            busy = false
        }
    }
    func exportCache() -> URL? {
        guard let account else { return nil }
        do {
            let output = FileManager.default.temporaryDirectory.appendingPathComponent(cacheReadable ? "HP-Studio-shared-records.json" : "HP-Studio-shared-recovery-original.json")
            let snapshot = ConversationCache.exportSnapshot(entries: entries, edits: editing[account.accountID] ?? [:])
            let bytes = try cacheReadable ? JSONEncoder().encode(SharedCacheFile(accountID: account.accountID, conversations: conversations, entries: snapshot)) : Data(contentsOf: file(account.accountID))
            try bytes.write(to: output, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); return output
        } catch { self.error = error.localizedDescription; return nil }
    }
    func clearCache() {
        guard !busy, !syncing, !stoppingReflection, let account, (editing[account.accountID] ?? [:]).isEmpty, !entries.values.contains(where: { $0.request?.outstanding == true || !$0.draft.isEmpty }) else {
            error = "작성 중인 글이나 처리 중인 요청이 있어요. 먼저 내보내고 요청 상태를 확인해 주세요."; return
        }
        do {
            if FileManager.default.fileExists(atPath: file(account.accountID).path) { try FileManager.default.removeItem(at: file(account.accountID)) }
            entries = [:]; selected = Self.personalID; cacheReadable = true
            notice = "이 기기의 사본을 삭제했어요. 서버의 대화와 데스크톱 원본은 남아 있어요."
        } catch { self.error = error.localizedDescription }
    }
}
