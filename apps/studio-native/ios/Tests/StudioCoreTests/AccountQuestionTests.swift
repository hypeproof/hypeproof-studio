import XCTest
@testable import StudioCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

private final class QuestionProtocol: URLProtocol {
    static var respond: ((URLRequest) throws -> (Int, [String: Any]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (code, object) = try Self.respond!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: object)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
    static func object(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n < 0 { throw URLError(.cannotDecodeContentData) }; if n == 0 { break }; data.append(contentsOf: buffer.prefix(n)) }
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    static func body(_ request: URLRequest) throws -> [String: String] { try XCTUnwrap(object(request) as? [String: String]) }
}

final class AccountQuestionTests: XCTestCase {
    static var card: [String: Any] {
        ["schema": "hps-card/1", "key": "team:choice-a", "kind": "team:choice", "attempt": 1,
         "expires_at": Date().timeIntervalSince1970 * 1000 + 60000, "title": "오늘의 질문", "preface": NSNull(), "prompt": "어디에서 막혔나요?",
         "segments": [["kind": "own_words", "label": "내가 남긴 말", "text": "방법을 찾고 있어요"]],
         "choices": [["id": "method", "label": "방법이 막혔어요"]], "select": "pick",
         "text": ["label": "내 생각", "placeholder": "덧붙일 말", "max": 2000, "value": NSNull()],
         "actions": [["id": "continue", "label": "이 생각으로 이어가기", "primary": true, "needs_answer": true]], "skip": "나중에", "note": NSNull()]
    }
    @MainActor func testSessionBoundProfileAndRealCardTransportRequireExplicitAnswer() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [QuestionProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); QuestionProtocol.respond = nil }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        var posts: [(String, [String: String])] = []
        QuestionProtocol.respond = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access")
            XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
            let path = request.url!.path
            if path == "/v1/me" { return (200, ["account": ["id": "A", "status": "active", "display_name": "지윤"], "session_id": "session-A"]) }
            if path == "/v1/me/cards" { XCTAssertEqual(request.url!.query, "surface=mobile"); return (200, ["card": Self.card]) }
            posts.append((path, try QuestionProtocol.body(request)))
            return (200, ["ok": true, "thanks": "선택한 생각을 남겼어요"])
        }
        let profile = try await service.accountProfile("fixture-access", sessionID: "session-A")
        XCTAssertEqual(profile.id, "A"); XCTAssertEqual(profile.displayName, "지윤")
        do { _ = try await service.accountProfile("fixture-access", sessionID: "other"); XCTFail("Session mismatch must fail") } catch {}
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        let controller = AccountQuestionController(identity: {
            let me = try await service.accountProfile("fixture-access", sessionID: identity.sessionID)
            return me.id == identity.accountID ? identity : nil
        }, load: { _ in try await service.accountQuestion("fixture-access") }, act: { _, key, action, body in
            try await service.accountQuestionAction(key, action: action, body: body, token: "fixture-access")
        }, changed: { _ in })
        await controller.refresh(); XCTAssertEqual(controller.view.card?.prompt, "어디에서 막혔나요?"); XCTAssertTrue(posts.isEmpty())
        await controller.presented("team:choice-a"); await controller.presented("team:choice-a")
        XCTAssertEqual(posts.count, 1); XCTAssertTrue(posts[0].0.hasSuffix("/shown"))
        controller.pick("method"); controller.edit("직접 쓴 답"); XCTAssertEqual(posts.count, 1)
        await controller.submit(action: "continue")
        XCTAssertEqual(posts.count, 2); XCTAssertEqual(posts[1].1, ["surface": "mobile", "action": "continue", "choice": "method", "text": "직접 쓴 답"])
        XCTAssertNil(controller.view.card); XCTAssertEqual(controller.view.message, "선택한 생각을 남겼어요")
        XCTAssertFalse(posts.contains { $0.0.contains("reflection") || $0.0.contains("approval") })
    }
    @MainActor func testUncertainAnswerPreservesWordsAndNeverAutomaticallyReplays() async throws {
        let card = try JSONDecoder().decode(AccountQuestion.self, from: JSONSerialization.data(withJSONObject: Self.card))
        var identity: MemberApprovalIdentity? = .init(accountID: "A", sessionID: "session-A"), posts = 0
        let controller = AccountQuestionController(identity: { identity }, load: { _ in card }, act: { _, _, action, _ in if action == "answer" { posts += 1 }; throw URLError(.networkConnectionLost) }, changed: { _ in })
        await controller.refresh(); controller.edit("사라지면 안 되는 답"); controller.pick("method"); await controller.submit(action: "continue")
        XCTAssertEqual(posts, 1); XCTAssertEqual(controller.view.words, "사라지면 안 되는 답"); XCTAssertNil(controller.view.card)
        await controller.refresh(); XCTAssertEqual(posts, 1); XCTAssertEqual(controller.view.words, "사라지면 안 되는 답")
        identity = .init(accountID: "B", sessionID: "session-B"); await controller.refresh()
        XCTAssertEqual(controller.view.words, ""); XCTAssertNil(controller.view.choice); XCTAssertEqual(posts, 1)
    }
    @MainActor func testEmptyInboxStartingChoiceUsesRealTransportOnlyAfterExplicitAction() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [QuestionProtocol.self]
        let session = URLSession(configuration: config); defer { session.invalidateAndCancel(); QuestionProtocol.respond = nil }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        var started = false, posts = 0
        QuestionProtocol.respond = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access")
            if request.url!.path == "/v1/me/cards" { return (200, ["card": started ? Self.card as Any : NSNull()]) }
            XCTAssertEqual(request.url!.path, "/v1/me/question-triggers"); XCTAssertEqual(request.httpMethod, "POST")
            let body = try QuestionProtocol.object(request); let id = try XCTUnwrap(body["id"] as? String)
            XCTAssertEqual(body["source_id"] as? String, id); XCTAssertEqual(body["source_revision"] as? Int, 1)
            XCTAssertEqual(body["choice"] as? String, "method"); XCTAssertNotNil(UUID(uuidString: id)); posts += 1; started = true
            return (200, ["schema": "hps-question-trigger/1", "key": "team:choice-a", "source": ["kind": "choice", "id": id, "revision": 1], "reentry": ["method": "GET", "path": "/v1/me/cards"], "model_calls": 0])
        }
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        let controller = AccountQuestionController(identity: { identity }, load: { _ in try await service.accountQuestion("fixture-access") }, act: { _, _, _, _ in XCTFail("No answer or exposure from loading"); return "" }, start: { _, id, choice in try await service.startAccountQuestion(id: id, choice: choice, token: "fixture-access") }, changed: { _ in })
        await controller.refresh(); XCTAssertTrue(controller.view.canStart); XCTAssertEqual(posts, 0)
        await controller.begin("method"); XCTAssertEqual(posts, 1); XCTAssertNotNil(controller.view.card)
        await controller.refresh(); XCTAssertEqual(posts, 1); XCTAssertFalse(controller.view.canStart)
    }
    func testUnknownSchemaExpiredCardAndUnknownChoiceCannotAct() throws {
        var object = Self.card; object["expires_at"] = 1
        let expired = try JSONDecoder().decode(AccountQuestion.self, from: JSONSerialization.data(withJSONObject: object)); try expired.validate()
        XCTAssertFalse(expired.available()); XCTAssertThrowsError(try expired.answer(action: "continue", choice: "method", words: "draft"))
        object = Self.card; object["schema"] = "unknown"; let unknown = try JSONDecoder().decode(AccountQuestion.self, from: JSONSerialization.data(withJSONObject: object)); XCTAssertThrowsError(try unknown.validate())
        let valid = try JSONDecoder().decode(AccountQuestion.self, from: JSONSerialization.data(withJSONObject: Self.card)); XCTAssertThrowsError(try valid.answer(action: "continue", choice: "invented", words: "draft"))
    }
}
