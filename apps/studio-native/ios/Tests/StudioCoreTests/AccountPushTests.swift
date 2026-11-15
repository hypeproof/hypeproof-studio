import XCTest
@testable import StudioCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class PushProtocol: URLProtocol {
    static var respond: ((URLRequest, [String: Any]) throws -> (Int, [String: Any]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream { stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n < 0 { throw URLError(.cannotDecodeContentData) }; if n == 0 { break }; data.append(contentsOf: buffer.prefix(n)) }
            }
            let body = data.isEmpty ? [:] : try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            let (code, result) = try Self.respond!(request, body)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
final class AccountPushTests: XCTestCase {
    @MainActor func testRealTransportUsesNativeHeadersMethodsAndStrictReceipts() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PushProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); PushProtocol.respond = nil }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!), id = UUID().uuidString.lowercased()
        let opened = ["schema": "hps-push-open/1", "delivery_id": UUID().uuidString.lowercased()]
        var methods: [String] = [], malformed = false
        PushProtocol.respond = { request, body in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access"); XCTAssertNil(request.value(forHTTPHeaderField: "Origin")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie")); methods.append(request.httpMethod!)
            if request.httpMethod == "POST" {
                XCTAssertEqual(Set(body.keys), Set(opened.keys))
                XCTAssertEqual(body["schema"] as? String, opened["schema"])
                XCTAssertEqual(body["delivery_id"] as? String, opened["delivery_id"])
                return (200, ["recorded": malformed ? NSNumber(value: 1) : NSNumber(value: true), "evidence_kind": "client_observed"])
            }
            if request.httpMethod == "PUT" { XCTAssertEqual(Set(body.keys), ["schema", "platform", "token", "permission"]); XCTAssertEqual(body["permission"] as? String, "granted") }
            return (200, ["schema": "hps-push-device/1", "id": id, "active": request.httpMethod == "PUT", "generation": 1])
        }
        try await service.accountPush(id, method: "PUT", body: ["schema": "hps-push-device/1", "platform": "ios", "token": String(repeating: "ab", count: 32), "permission": "granted"], token: "synthetic-access")
        try await service.accountPush(id + "/opened", method: "POST", body: opened, token: "synthetic-access")
        try await service.accountPush(id, method: "DELETE", body: nil, token: "synthetic-access")
        malformed = true
        // Keep the request valid: only the server's success type is malformed.
        do { try await service.accountPush(id + "/opened", method: "POST", body: opened, token: "synthetic-access"); XCTFail("Numeric success cannot acknowledge an open") } catch SyncFailure.invalidResponse {}
        XCTAssertEqual(methods, ["PUT", "POST", "DELETE", "POST"])
    }
    @MainActor func testPreferenceSurvivesRestartAndLostReceiptWithoutCachingTokenOrOptingAnotherAccountIn() async throws {
        var account: MemberApprovalIdentity? = .init(accountID: "A", sessionID: "session-A"), bytes: Data?, fail = false, calls: [String] = []
        let load: () throws -> AccountPushPreference = { if let bytes { return try JSONDecoder().decode(AccountPushPreference.self, from: bytes) }; return .init() }
        let make: () -> AccountPushController = { AccountPushController(identity: { account }, load: load, save: { if fail { throw CocoaError(.fileWriteOutOfSpace) }; bytes = try JSONEncoder().encode($0) }, call: { _, method, id, _ in calls.append(method + " " + id); throw URLError(.networkConnectionLost) }, changed: { _ in }) }
        var controller = make(); await controller.register(String(repeating: "ab", count: 32)); XCTAssertTrue(calls.isEmpty)
        fail = true; XCTAssertFalse(controller.enable()); fail = false; XCTAssertTrue(controller.enable()); let id = try load().installation
        await controller.register(String(repeating: "ab", count: 32)); XCTAssertFalse(controller.view.status.contains("켰어요"))
        controller = make(); await controller.register(String(repeating: "cd", count: 32)); XCTAssertEqual(calls, ["PUT " + id, "PUT " + id]); XCTAssertFalse(String(data: bytes!, encoding: .utf8)!.contains("token"))
        account = .init(accountID: "B", sessionID: "session-B"); XCTAssertFalse(controller.enabled); await controller.register(String(repeating: "ef", count: 32)); XCTAssertEqual(calls.count, 2)
    }
    @MainActor func testLateOpenCannotRouteAfterAccountSwitchAndDeclinePersistsBeforeRevoke() async throws {
        var account: MemberApprovalIdentity? = .init(accountID: "A", sessionID: "session-A"), preference = AccountPushPreference()
        var held: CheckedContinuation<Void, Error>?, entered = false, deleted = false
        let controller = AccountPushController(identity: { account }, load: { preference }, save: { preference = $0 }, call: { _, method, _, _ in
            if method == "POST" { entered = true; try await withCheckedThrowingContinuation { held = $0 } }
            if method == "DELETE" { XCTAssertFalse(preference.enabled); deleted = true }
        }, changed: { _ in })
        XCTAssertTrue(controller.enable())
        let ref = try AccountPushReference(["schema": "hps-push/1", "delivery_id": UUID().uuidString.lowercased(), "kind": "approval", "id": "review-1", "revision": 12])
        let pending = Task { await controller.open(ref) }; while !entered { await Task.yield() }
        account = .init(accountID: "B", sessionID: "session-B"); controller.invalidate(); held?.resume(); let result = await pending.value; XCTAssertNil(result)
        XCTAssertTrue(controller.enable()); await controller.disable(); XCTAssertFalse(preference.enabled); XCTAssertTrue(deleted)
    }
    @MainActor func testHeldRegistrationThenOffAndReenableCannotRevokeNewIntent() async throws {
        let account = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var preference = AccountPushPreference(), held: CheckedContinuation<Void, Error>?, calls: [String] = []
        let entered = expectation(description: "first PUT reached transport"), denied = expectation(description: "off persisted")
        let old = String(repeating: "ab", count: 32), new = String(repeating: "cd", count: 32)
        let controller = AccountPushController(identity: { account }, load: { preference }, save: { preference = $0; if !$0.enabled { denied.fulfill() } }, call: { _, method, _, body in
            calls.append(method + (body?["token"] == new ? " new" : " old"))
            if method == "PUT" && body?["token"] == old { try await withCheckedThrowingContinuation { held = $0; entered.fulfill() } }
        }, changed: { _ in })
        XCTAssertTrue(controller.enable()); let firstPermission = controller.permissionTicket
        let first = Task { await controller.register(old) }; await fulfillment(of: [entered], timeout: 1)
        let off = Task { await controller.disable() }; await fulfillment(of: [denied], timeout: 1)
        XCTAssertFalse(controller.acceptsPermission(firstPermission)); XCTAssertTrue(controller.enable())
        let second = Task { await controller.register(new) }; held?.resume()
        await first.value; await off.value; await second.value
        XCTAssertEqual(calls, ["PUT old", "PUT new"]); XCTAssertTrue(preference.enabled); XCTAssertTrue(controller.view.status.contains("켰어요"))
    }
    func testMalformedReferencesCannotBecomeActionAuthority() throws {
        for revision in [true, 0, -1, 1.5, "12"] as [Any] {
            XCTAssertThrowsError(try AccountPushReference(["schema": "hps-push/1", "delivery_id": UUID().uuidString.lowercased(), "kind": "approval", "id": "review-1", "revision": revision]))
        }
        XCTAssertThrowsError(try AccountPushReference(["schema": "hps-push/1", "delivery_id": UUID().uuidString.lowercased(), "kind": "approve", "id": "review-1", "revision": 1]))
    }
}
