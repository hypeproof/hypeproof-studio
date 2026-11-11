import SwiftUI
import Security

private struct StoredAccount: Codable {
    let accountID: String
    let tokens: AccountTokens
    let expiresAt: Date
}
private enum AccountKeychain {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.hypeproof.studio.mobile.account", kSecAttrAccount as String: "device-session"]
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
    private var selectPersonalOnLoad = true
    @Published private(set) var signedIn = false
    @Published private(set) var conversations: [SharedConversation] = []
    @Published private(set) var entries: [String: ConversationCache] = [:]
    @Published private(set) var signIn: DeviceSignIn?
    @Published private(set) var busy = false
    @Published private(set) var syncing = false
    @Published private(set) var accountStorageReady = false
#if DEBUG
    @Published private(set) var accountStorageVerified = false
#endif
    @Published var selected: String?
    @Published var error: String?
    @Published var notice = ""
    @Published private var editing: [String: [String: [String: String]]] = [:]
    private var account: StoredAccount?
    private var operation: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private var epoch = UUID()
    private var visible = true
    private var cacheReadable = true
    private let service = ConversationService()
    private let directory: URL
    var cache: ConversationCache { overlay(entries[selected ?? ""] ?? ConversationCache(), id: selected ?? "") }
    var title: String { conversations.first { $0.id == selected }?.title ?? "대화 이어가기" }
    var canSend: Bool { signedIn && cacheReadable && conversations.contains(where: { $0.id == selected }) && cache.request?.outstanding != true && !busy }
    init() {
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("shared-conversations", isDirectory: true)
        restoreAccount()
    }
    func restoreAccount() {
        guard !busy, !syncing, !signedIn else { return }
        error = nil; accountStorageReady = false
#if DEBUG
        accountStorageVerified = false
#endif
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            account = try AccountKeychain.read()
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--verify-account-storage") {
                try AccountKeychain.verifyNativeStorage(); accountStorageVerified = true
            }
#endif
            accountStorageReady = true; signedIn = account != nil
            if let account { try load(account.accountID) }
        } catch { self.error = error.localizedDescription }
    }
    private func file(_ accountID: String) -> URL {
        // Identity-derived filename never accepts path components from the server.
        directory.appendingPathComponent(Data(accountID.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_") + ".json")
    }
    private func load(_ id: String) throws {
        entries = [:]; conversations = []; selected = nil; cacheReadable = true; selectPersonalOnLoad = true
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
        guard let selected, let account else { return }
        editing[account.accountID, default: [:]][selected, default: [:]]["draft"] = value
        do { try edit(selected) { $0.draft = value } } catch { self.error = error.localizedDescription }
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
        guard !busy, !syncing else { return }
        guard accountStorageReady else { error = "계정 저장소를 먼저 다시 확인해 주세요. 로그인 요청은 보내지 않았어요."; return }
        busy = true; error = nil; let attempt = epoch
        operation = Task {
            do {
                let device = try await service.startSignIn()
                guard epoch == attempt else { return }; signIn = device
                let end = Date().addingTimeInterval(device.expires_in)
                while Date() < end {
                    try await Task.sleep(nanoseconds: UInt64(max(3, device.interval)) * 1_000_000_000)
                    guard epoch == attempt else { return }
                    if let tokens = try await service.pollSignIn(device.device_code) {
                        let id = try await service.accountID(tokens.access_token)
                        guard epoch == attempt else { try? await service.logout(tokens.access_token); return }
                        let value = StoredAccount(accountID: id, tokens: tokens, expiresAt: Date().addingTimeInterval(tokens.expires_in))
                        do { try AccountKeychain.save(value) }
                        catch { accountStorageReady = false; try? await service.logout(tokens.access_token); throw error }
                        account = value; signedIn = true; signIn = nil
                        try load(id); break
                    }
                }
                if !signedIn { signIn = nil; error = "로그인 시간이 지났어요. 다시 시작해 주세요." }
            } catch { if epoch == attempt { self.error = error.localizedDescription; signIn = nil } }
            if epoch == attempt { busy = false; await synchronize() }
        }
    }
    func cancelLogin() { epoch = UUID(); operation?.cancel(); operation = nil; signIn = nil; busy = false }
    private func token() async throws -> String {
        guard let old = account else { throw SyncFailure.http(401, "account_required") }
        if old.expiresAt > Date().addingTimeInterval(90) { return old.tokens.access_token }
        do {
            let tokens = try await service.refresh(old.tokens.refresh_token)
            guard account?.tokens.session_id == old.tokens.session_id else { try? await service.logout(tokens.access_token); throw CancellationError() }
            let next = StoredAccount(accountID: old.accountID, tokens: tokens, expiresAt: Date().addingTimeInterval(tokens.expires_in))
            do { try AccountKeychain.save(next) }
            catch { accountStorageReady = false; try? await service.logout(tokens.access_token); throw error }
            account = next; return tokens.access_token
        } catch {
            // Refresh tokens rotate once. An uncertain response requires fresh login, never reuse.
            if account?.tokens.session_id == old.tokens.session_id { clearAccount() }
            throw error
        }
    }
    private func clearAccount() {
        do { try AccountKeychain.remove() } catch { accountStorageReady = false }
        account = nil; signedIn = false; entries = [:]; conversations = []; selected = nil
    }
    func refresh() { Task { await synchronize() } }
    private func synchronize() async {
        guard signedIn, cacheReadable, visible, !busy, !syncing else { return }
        syncing = true; let attempt = epoch; let current = selected
        defer { syncing = false }
        do {
            let credential = try await token()
            let personal = try await service.reflection(credential)
            guard epoch == attempt else { return }
            try applyReflection(personal)
            var list = try await service.list(credential)
            list.insert(SharedConversation(id: Self.personalID, title: "나를 알아가는 대화", host_session_id: "", revision: personal.state.revision, updated_at: personal.state.messages.last?.created_at ?? 0), at: 0)
            guard epoch == attempt else { return }
            try persist(entries: entries, conversations: list)
            if selectPersonalOnLoad { selected = Self.personalID; selectPersonalOnLoad = false }
            if let id = current, id != Self.personalID, list.contains(where: { $0.id == id }) {
                // Page repeatedly with a bound; the next polling cycle continues if more remain.
                for _ in 0..<10 {
                    let page = try await service.events(id, after: entries[id]?.cursor ?? 0, token: credential)
                    guard epoch == attempt else { return }
                    try edit(id) { try $0.apply(page) }
                    if !page.has_more { break }
                }
                let requests = try await service.requests(id, token: credential)
                guard epoch == attempt else { return }
                if let own = entries[id]?.request, let found = requests.first(where: { $0.id == own.id }) {
                    try edit(id) { $0.request = found }
                } else if entries[id]?.request?.outstanding != true, let active = requests.first(where: { $0.outstanding }) {
                    try edit(id) { $0.request = active }
                }
            }
            error = nil; notice = isReflection ? "같은 계정의 대화예요. 컴퓨터가 꺼져 있어도 질문을 받을 수 있어요." : "동기화됨 · 이 작업의 실행은 데스크톱에 있어요"
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
        guard canSend, !syncing, let id = selected else { return }
        do { try edit(id) { try $0.enqueue(reflection: id == Self.personalID) } } catch { self.error = error.localizedDescription; return }
        retry()
    }
    func retry() {
        guard !busy, !syncing, let id = selected, let request = entries[id]?.request, request.status == "local" else { return }
        busy = true; let attempt = epoch; error = nil
        operation = Task {
            do {
                let credential = try await token()
                if id == Self.personalID {
                    let result = try await service.reflect(request, token: credential)
                    guard epoch == attempt else { return }
                    try applyReflection(result)
                } else {
                let result = try await service.submit(id, request: request, token: credential)
                guard epoch == attempt else { return }
                guard result.id == request.id, result.text == request.text else { throw SyncFailure.invalidResponse }
                try edit(id) { $0.request = result }
                }
            } catch {
                if epoch == attempt {
                    if case SyncFailure.http(let status, _) = error, status == 400 || (id == Self.personalID && status == 409) {
                        try? edit(id) { value in
                            value.draft = value.draft.isEmpty ? request.text : value.draft + "\n" + request.text
                            value.request = nil
                        }
                    }
                    failure(error)
                }
            }
            if epoch == attempt { busy = false; await synchronize() }
        }
    }
    func recoverReflection() {
        guard isReflection, !busy, !syncing, let request = cache.request, request.status == "running" else { return }
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
        guard !busy, !syncing, let id = selected, let request = cache.request else { return }
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
        guard !busy, !syncing else { return }
        if let account, !(editing[account.accountID] ?? [:]).isEmpty { error = "저장하지 못한 수정이 있어요. 기록을 내보내고 저장 오류를 확인해 주세요."; return }
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
        guard !busy, !syncing, let account, (editing[account.accountID] ?? [:]).isEmpty, !entries.values.contains(where: { $0.request?.outstanding == true || !$0.draft.isEmpty }) else {
            error = "작성 중인 글이나 처리 중인 요청이 있어요. 먼저 내보내고 요청 상태를 확인해 주세요."; return
        }
        do {
            if FileManager.default.fileExists(atPath: file(account.accountID).path) { try FileManager.default.removeItem(at: file(account.accountID)) }
            entries = [:]; selected = nil; cacheReadable = true
            notice = "이 기기의 사본을 삭제했어요. 서버의 대화와 데스크톱 원본은 남아 있어요."
        } catch { self.error = error.localizedDescription }
    }
}
