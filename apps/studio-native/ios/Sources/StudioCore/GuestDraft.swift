import Foundation

/// Device-local writing before an account is known. It is never an outbox.
public struct GuestDraft: Codable, Equatable {
    public var text: String
    private let version: Int
    public init(text: String = "") { self.text = text; version = 1 }

    public static func load(from url: URL) throws -> GuestDraft {
        guard FileManager.default.fileExists(atPath: url.path) else { return GuestDraft() }
        let draft = try JSONDecoder().decode(GuestDraft.self, from: Data(contentsOf: url))
        guard draft.version == 1 else { throw GuestDraftError.unreadable }
        return draft
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(self)
#if os(iOS) || os(macOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var protectedURL = url
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try protectedURL.setResourceValues(values)
#else
        try data.write(to: url, options: .atomic)
#endif
    }

    public func canRestore(into accountDraft: ConversationCache) -> Bool {
        !text.isEmpty && accountDraft.draft.isEmpty && accountDraft.request?.outstanding != true
    }

    /// Persist the account copy before removing the guest copy. Failure can leave
    /// two copies, but cannot lose the only copy or create a request. The caller
    /// supplies an already authenticated, explicitly chosen account destination.
    @discardableResult
    public mutating func handoff(into accountDraft: ConversationCache,
                                 saveAccount: (ConversationCache) throws -> Void,
                                 saveGuest: (GuestDraft) throws -> Void) throws -> Bool {
        guard canRestore(into: accountDraft) else { return false }
        var next = accountDraft; next.draft = text
        try saveAccount(next)
        let cleared = GuestDraft()
        try saveGuest(cleared)
        self = cleared
        return true
    }
}

public enum GuestDraftError: LocalizedError {
    case unreadable
    public var errorDescription: String? {
        "이 기기의 로그인 전 글을 읽지 못했어요. 원본을 보존하기 위해 덮어쓰지 않아요."
    }
}
