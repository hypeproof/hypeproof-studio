import XCTest
@testable import StudioCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class AccountProtocol: URLProtocol {
    static var response = Data()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.response)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class AccountCredentialTests: XCTestCase {
    private func tokens(_ character: Character = "a", session: String = "session-a") -> AccountTokens {
        AccountTokens(access_token: "fixture-access-\(character)", refresh_token: String(repeating: character, count: 64), expires_in: 3600, session_id: session)
    }
    private func stored() throws -> StoredAccount {
        try StoredAccount(accountID: "account-a", tokens: tokens(), expiresAt: Date(timeIntervalSince1970: 0))
    }
    func testLegacyRecordAndPendingIntentSurviveDecode() throws {
        let encoded = try JSONEncoder().encode(stored())
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        legacy.removeValue(forKey: "refreshPending")
        let restored = try JSONDecoder().decode(StoredAccount.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertFalse(restored.refreshPending)
        let pending = try StoredAccount(accountID: restored.accountID, tokens: restored.tokens, expiresAt: restored.expiresAt, refreshPending: true)
        XCTAssertTrue(try JSONDecoder().decode(StoredAccount.self, from: JSONEncoder().encode(pending)).refreshPending)
    }
    @MainActor func testValidRotationPersistsIntentBeforeDispatchAndVerifiesBeforeAdoption() async throws {
        var events: [String] = []; var persisted: StoredAccount?
        let old = try stored(), rotated = tokens("b")
        let next = try await AccountCredentialRefresh.renew(old, save: { value in
            events.append(value.refreshPending ? "intent" : "adopt"); persisted = value
        }, refresh: { token in
            XCTAssertTrue(persisted?.refreshPending == true)
            XCTAssertEqual(token, old.tokens.refresh_token); events.append("request"); return rotated
        }, accountID: { value in
            XCTAssertEqual(value.session_id, old.tokens.session_id); events.append("verify"); return old.accountID
        }, revoke: { _ in XCTFail("Valid credentials should not be revoked") }, now: { Date(timeIntervalSince1970: 100) })
        XCTAssertEqual(events, ["intent", "request", "verify", "adopt"])
        XCTAssertEqual(next.tokens.refresh_token, rotated.refresh_token)
        XCTAssertEqual(next.expiresAt.timeIntervalSince1970, 3700)
        XCTAssertFalse(next.refreshPending)
    }
    @MainActor func testFailedIntentWriteSendsNoRefresh() async throws {
        do {
            _ = try await AccountCredentialRefresh.renew(stored(), save: { _ in throw CocoaError(.fileWriteNoPermission) }, refresh: { _ in
                XCTFail("A failed write must not dispatch refresh"); return self.tokens("b")
            }, accountID: { _ in XCTFail(); return "account-a" }, revoke: { _ in XCTFail() })
            XCTFail()
        } catch is CocoaError { }
    }
    @MainActor func testUncertainRefreshCannotReplayAfterPersistenceRoundTrip() async throws {
        var persisted = Data(); var calls = 0
        do {
            _ = try await AccountCredentialRefresh.renew(stored(), save: { persisted = try JSONEncoder().encode($0) }, refresh: { _ in
                calls += 1; throw URLError(.networkConnectionLost)
            }, accountID: { _ in XCTFail(); return "account-a" }, revoke: { _ in XCTFail() })
            XCTFail()
        } catch is URLError { }
        let restarted = try JSONDecoder().decode(StoredAccount.self, from: persisted)
        do {
            _ = try await AccountCredentialRefresh.renew(restarted, save: { _ in XCTFail() }, refresh: { _ in
                calls += 1; return self.tokens("b")
            }, accountID: { _ in XCTFail(); return "account-a" }, revoke: { _ in XCTFail() })
            XCTFail()
        } catch SyncFailure.invalidResponse { }
        XCTAssertEqual(calls, 1)
    }
    @MainActor func testMismatchedAccountOrSessionCannotAdoptAndRevokesAcquiredToken() async throws {
        for differentSession in [false, true] {
            var writes = 0; var revoked: [String] = []
            let acquired = tokens("b", session: differentSession ? "session-b" : "session-a")
            do {
                _ = try await AccountCredentialRefresh.renew(stored(), save: { value in
                    writes += 1; XCTAssertTrue(value.refreshPending)
                }, refresh: { _ in acquired }, accountID: { _ in "account-b" }, revoke: { revoked.append($0) })
                XCTFail()
            } catch SyncFailure.invalidResponse { }
            XCTAssertEqual(writes, 1); XCTAssertEqual(revoked, [acquired.access_token])
        }
    }
    @MainActor func testFailedFinalWriteRetainsPendingAndRevokesAcquiredToken() async throws {
        var persisted: StoredAccount?; var revoked = false
        do {
            _ = try await AccountCredentialRefresh.renew(stored(), save: { value in
                if !value.refreshPending { throw CocoaError(.fileWriteNoPermission) }; persisted = value
            }, refresh: { _ in self.tokens("b") }, accountID: { _ in "account-a" }, revoke: { _ in revoked = true })
            XCTFail()
        } catch is CocoaError { }
        XCTAssertTrue(persisted?.refreshPending == true); XCTAssertTrue(revoked)
    }
    func testMalformedCredentialsAreRejectedBeforeStorage() throws {
        for value in [
            AccountTokens(access_token: "a\r\nb", refresh_token: String(repeating: "a", count: 64), expires_in: 3600, session_id: "session-a"),
            AccountTokens(access_token: "access", refresh_token: "bad", expires_in: 3600, session_id: "session-a"),
            AccountTokens(access_token: "access", refresh_token: String(repeating: "a", count: 64), expires_in: .infinity, session_id: "session-a")
        ] { XCTAssertThrowsError(try value.validate()) }
    }
    func testInactiveAccountCannotBeAdopted() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AccountProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        AccountProtocol.response = Data(#"{"account":{"id":"account-a","status":"suspended"},"session_id":"session-a"}"#.utf8)
        do {
            _ = try await service.accountID("fixture-access")
            XCTFail("An inactive account must not be installed")
        } catch SyncFailure.invalidResponse { }
    }
    func testAccountEndpointRequiresMatchingSessionAndActiveIdentity() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [AccountProtocol.self]
        let session = URLSession(configuration: configuration); defer { session.invalidateAndCancel() }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        AccountProtocol.response = Data(#"{"account":{"id":"account-a","status":"active"},"session_id":"session-b"}"#.utf8)
        do { _ = try await service.accountID("fixture-access", sessionID: "session-a"); XCTFail() }
        catch SyncFailure.invalidResponse { }
        let accepted = try await service.accountID("fixture-access", sessionID: "session-b")
        XCTAssertEqual(accepted, "account-a")
    }
}
