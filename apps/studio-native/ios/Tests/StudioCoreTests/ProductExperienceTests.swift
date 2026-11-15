import XCTest
@testable import StudioCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class ExperienceProtocol: URLProtocol {
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
final class ProductExperienceTests: XCTestCase {
    @MainActor func testNumericConsentAndClosedWirePayloadUseExistingAuthenticatedTransport() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ExperienceProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); ExperienceProtocol.respond = nil }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        var granted = false, batches = 0
        ExperienceProtocol.respond = { request, body in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access"); XCTAssertNil(request.value(forHTTPHeaderField: "Origin")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            if request.url!.path.hasSuffix("/consent") {
                if request.httpMethod == "POST" { XCTAssertEqual(body["notice_version"] as? String, "team-ux/1"); granted = try XCTUnwrap(body["granted"] as? Bool); return (200, ["ok": true]) }
                return (200, ["schema": "hps-product-consent/1", "notice_version": "team-ux/1", "title": "사용 경험 공유", "notice": "원문 없이 사용 단계만 기록해요.", "preference": ["notice_version": "team-ux/1", "granted": granted ? 1 : 0]])
            }
            XCTAssertEqual(request.url!.path, "/v1/me/product-events"); XCTAssertEqual(body["schema"] as? String, "hps-product-events/1")
            let rows = try XCTUnwrap(body["events"] as? [[String: Any]]); XCTAssertEqual(rows.count, 1); XCTAssertEqual(Set(rows[0].keys), ["id", "journey_id", "journey", "type", "platform", "app_version"])
            XCTAssertEqual(rows[0]["type"] as? String, "question.presented"); batches += 1
            return (200, ["schema": "hps-product-events/1", "accepted": rows.map { $0["id"]! }, "deferred": [], "evidence_kind": "client_observed"])
        }
        let denied = try await service.productExperienceConsent(token: "synthetic-access"); XCTAssertFalse(denied.granted); XCTAssertEqual(batches, 0)
        let allowed = try await service.productExperienceConsent(true, token: "synthetic-access"); XCTAssertTrue(allowed.granted)
        let event = ProductExperienceEvent(.questionPresented, journeyID: UUID().uuidString.lowercased(), version: "0.2.0")
        let accepted = try await service.productExperienceEvents([event], token: "synthetic-access"); XCTAssertEqual(accepted, [event.id]); XCTAssertEqual(batches, 1)
    }
    @MainActor func testMalformedReceiptCannotAcknowledgeUnsentEvents() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ExperienceProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); ExperienceProtocol.respond = nil }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        ExperienceProtocol.respond = { _, _ in (200, ["schema": "hps-product-events/1", "accepted": [UUID().uuidString.lowercased()], "deferred": [], "evidence_kind": "client_observed"]) }
        do { _ = try await service.productExperienceEvents([.init(.voiceResumed, journeyID: UUID().uuidString.lowercased(), version: "0.2.0")], token: "synthetic-access"); XCTFail("Foreign acknowledgment must not clear persisted events") } catch {}
    }
    @MainActor func testLostReceiptSurvivesAtomicFileAndControllerReopenWithoutChangingID() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("queue.json"), identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        let save: (String, ProductExperienceQueue) throws -> Void = { _, value in try JSONEncoder().encode(value).write(to: file, options: .atomic) }
        let load: (String) throws -> ProductExperienceQueue = { _ in FileManager.default.fileExists(atPath: file.path) ? try JSONDecoder().decode(ProductExperienceQueue.self, from: Data(contentsOf: file)) : .init() }
        let first = expectation(description: "first persisted request reached transport")
        var sent: [[ProductExperienceEvent]] = []
        let controller = ProductExperienceController(identity: { identity }, version: "0.2.0", consent: { _, _ in .init(title: "공유", notice: "원문 제외", granted: true) }, send: { _, rows in sent.append(rows); first.fulfill(); throw URLError(.networkConnectionLost) }, load: load, save: save, changed: { _ in })
        await controller.refresh(); controller.record(.voiceFinished); await fulfillment(of: [first], timeout: 2)
        let stored = try load("A"); XCTAssertEqual(stored.events.count, 1); XCTAssertEqual(stored.events[0].id, sent[0][0].id); controller.invalidate()
        let reopened = ProductExperienceController(identity: { identity }, version: "0.2.0", consent: { _, _ in .init(title: "공유", notice: "원문 제외", granted: true) }, send: { _, rows in sent.append(rows); return Set(rows.map(\.id)) }, load: load, save: save, changed: { _ in })
        await reopened.refresh(); XCTAssertEqual(sent.count, 2)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; XCTAssertEqual(try encoder.encode(sent[0]), try encoder.encode(sent[1])); XCTAssertTrue(try load("A").events.isEmpty)
    }
    @MainActor func testNoConsentAndFailedPersistenceProduceNoEventsOrProductEffects() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A"); var allowed = false, posts = 0, failSave = false, stored = ProductExperienceQueue()
        let controller = ProductExperienceController(identity: { identity }, version: "0.2.0", consent: { _, choice in if let choice { allowed = choice }; return .init(title: "공유", notice: "원문 제외", granted: allowed) }, send: { _, rows in posts += 1; return Set(rows.map(\.id)) }, load: { _ in stored }, save: { _, value in if failSave { throw URLError(.cannotWriteToFile) }; stored = value }, changed: { _ in })
        await controller.refresh(); controller.record(.questionPresented); XCTAssertTrue(stored.events.isEmpty); XCTAssertEqual(posts, 0)
        await controller.choose(true); failSave = true; controller.record(.reflectionStarted); XCTAssertTrue(stored.events.isEmpty); XCTAssertEqual(posts, 0)
        failSave = false; await controller.choose(false); controller.record(.questionAnswered); XCTAssertTrue(stored.denied); XCTAssertTrue(stored.events.isEmpty); XCTAssertEqual(posts, 0)
    }
    @MainActor func testAccountInvalidationAndExpiredQueueDoNotReplayOldObservations() async throws {
        var account: MemberApprovalIdentity? = .init(accountID: "A", sessionID: "session-A"), posts = 0, stored = ProductExperienceQueue()
        stored.events = [.init(.voiceFinal, journeyID: UUID().uuidString.lowercased(), version: "0.2.0")]; stored.expiresAt = Date(timeIntervalSince1970: 1)
        let controller = ProductExperienceController(identity: { account }, version: "0.2.0", consent: { _, _ in .init(title: "공유", notice: "원문 제외", granted: true) }, send: { _, _ in posts += 1; return [] }, load: { _ in stored }, save: { _, value in stored = value }, changed: { _ in })
        await controller.refresh(); XCTAssertTrue(stored.events.isEmpty); XCTAssertEqual(posts, 0)
        controller.invalidate(); account = .init(accountID: "B", sessionID: "session-B"); controller.record(.voiceFinal); XCTAssertEqual(posts, 0); XCTAssertTrue(stored.events.isEmpty)
    }
}
