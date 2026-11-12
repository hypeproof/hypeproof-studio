import Foundation

/// One Keychain item contains both credentials and the durable refresh intent.
/// A pending item is never eligible for refresh after interruption or relaunch.
public struct StoredAccount: Codable, Sendable {
    public let accountID: String
    public let tokens: AccountTokens
    public let expiresAt: Date
    public let refreshPending: Bool

    public init(accountID: String, tokens: AccountTokens, expiresAt: Date, refreshPending: Bool = false) throws {
        try tokens.validate()
        guard Self.validID(accountID), expiresAt.timeIntervalSince1970.isFinite else { throw SyncFailure.invalidResponse }
        self.accountID = accountID; self.tokens = tokens; self.expiresAt = expiresAt; self.refreshPending = refreshPending
    }
    private enum CodingKeys: String, CodingKey { case accountID, tokens, expiresAt, refreshPending }
    public init(from decoder: Decoder) throws {
        let value = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(accountID: value.decode(String.self, forKey: .accountID),
                      tokens: value.decode(AccountTokens.self, forKey: .tokens),
                      expiresAt: value.decode(Date.self, forKey: .expiresAt),
                      refreshPending: value.decodeIfPresent(Bool.self, forKey: .refreshPending) ?? false)
    }
    static func validID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", options: .regularExpression) != nil
    }
}

extension AccountTokens {
    public func validate() throws {
        guard !access_token.isEmpty, access_token.utf8.count <= 16_384,
              access_token.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }),
              refresh_token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              StoredAccount.validID(session_id), expires_in.isFinite,
              expires_in > 0, expires_in <= 86_400 else { throw SyncFailure.invalidResponse }
    }
}

public enum AccountCredentialRefresh {
    /// Save-before-dispatch is shared by the app and tests. `save` must atomically
    /// replace the credential item; an ambiguous network result cannot erase it.
    @MainActor public static func renew(
        _ old: StoredAccount,
        save: (StoredAccount) throws -> Void,
        refresh: (String) async throws -> AccountTokens,
        accountID: (AccountTokens) async throws -> String,
        revoke: (String) async -> Void,
        now: () -> Date = Date.init
    ) async throws -> StoredAccount {
        guard !old.refreshPending else { throw SyncFailure.invalidResponse }
        let pending = try StoredAccount(accountID: old.accountID, tokens: old.tokens, expiresAt: old.expiresAt, refreshPending: true)
        try save(pending)
        var acquired: AccountTokens?
        do {
            let tokens = try await refresh(old.tokens.refresh_token)
            acquired = tokens
            try tokens.validate()
            guard tokens.session_id == old.tokens.session_id, tokens.refresh_token != old.tokens.refresh_token else { throw SyncFailure.invalidResponse }
            let id = try await accountID(tokens)
            guard id == old.accountID else { throw SyncFailure.invalidResponse }
            try Task.checkCancellation()
            let next = try StoredAccount(accountID: id, tokens: tokens, expiresAt: now().addingTimeInterval(tokens.expires_in))
            try save(next)
            return next
        } catch {
            if let acquired { await revoke(acquired.access_token) }
            throw error
        }
    }
}
