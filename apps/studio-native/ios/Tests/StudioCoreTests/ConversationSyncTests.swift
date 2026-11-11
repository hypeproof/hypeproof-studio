import XCTest
@testable import StudioCore

final class ConversationSyncTests: XCTestCase {
    func testReflectionOutboxKeepsOriginalRevisionAcrossRestartAndOtherDeviceUpdates() throws {
        var cache = ConversationCache(); cache.cursor = 4; cache.draft = "내가 처음 보낸 생각"
        try cache.enqueue(reflection: true)
        let originalID = cache.request?.id
        cache = try JSONDecoder().decode(ConversationCache.self, from: JSONEncoder().encode(cache))
        let newer = try JSONDecoder().decode(PersonalReflection.self, from: Data(#"{"state":{"id":"personal-reflection","revision":8,"messages":[],"has_earlier":false,"turn":null},"opening":"Question?","hint":"Optional"}"#.utf8))
        try cache.applyReflection(newer)
        XCTAssertEqual(cache.cursor, 8)
        XCTAssertEqual(cache.request?.id, originalID)
        XCTAssertEqual(cache.request?.expectedRevision, 4)
        let legacy = try JSONDecoder().decode(SharedRequest.self, from: Data(#"{"id":"old","text":"Preserved","status":"local","created_at":1,"updated_at":1}"#.utf8))
        XCTAssertNil(legacy.expectedRevision)
    }
    func testVoiceWaitingEndsForRejectedReplacedAndSilentCompletedRequests() throws {
        var request = try SharedRequest.pending("내 이야기")
        let id = request.id
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: request, messages: [], sending: true, readAloud: true), .waiting)
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: request, messages: [], sending: false, readAloud: true), .needsAttention)
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: nil, messages: [], sending: false, readAloud: true), .needsAttention)
        request.id = "other-device"; request.status = "running"
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: request, messages: [], sending: false, readAloud: true), .needsAttention)
        request.id = id; request.status = "completed"
        let messages = [SharedMessage(id: id, role: "user", content: request.text, created_at: 1), SharedMessage(id: id + "-answer", role: "assistant", content: "어떤 순간이었나요?", created_at: 2), SharedMessage(id: "next", role: "user", content: "다른 이야기", created_at: 3), SharedMessage(id: "next-answer", role: "assistant", content: "다른 답변", created_at: 4)]
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: request, messages: messages, sending: false, readAloud: true), .speak("어떤 순간이었나요?"))
        XCTAssertEqual(ConversationVoiceReply.resolve(id: id, request: request, messages: messages, sending: false, readAloud: false), .finished)
    }
    func testReflectionReconcilesAcrossDevicesWithoutDiscardingDraftOrUnknownOutbox() throws {
        var cache = ConversationCache(); cache.draft = "다음 생각"; try cache.enqueue()
        let pendingID = cache.request?.id
        func snapshot(_ role: String = "assistant", revision: Int = 2) throws -> PersonalReflection {
            let json = "{\"state\":{\"id\":\"personal-reflection\",\"revision\":\(revision),\"messages\":[{\"id\":\"other-device\",\"role\":\"\(role)\",\"content\":\"최근 마음에 남은 순간은?\",\"created_at\":1}],\"has_earlier\":false,\"turn\":null},\"opening\":\"요즘 어떤 일에 시간을 많이 쓰세요?\",\"hint\":\"정리되지 않아도 괜찮아요.\"}"
            return try JSONDecoder().decode(PersonalReflection.self, from: Data(json.utf8))
        }
        try cache.applyReflection(snapshot())
        XCTAssertEqual(cache.request?.id, pendingID)
        cache.draft = "아직 보내지 않은 말"
        XCTAssertThrowsError(try cache.applyReflection(snapshot("tool", revision: 3)))
        XCTAssertThrowsError(try cache.applyReflection(snapshot(revision: 1)))
        XCTAssertEqual(cache.messages.count, 1); XCTAssertEqual(cache.cursor, 2)
        XCTAssertEqual(cache.draft, "아직 보내지 않은 말")
    }
    func testExportIncludesNeverSavedConversationAfterNavigation() throws {
        let saved = ConversationCache()
        let result = ConversationCache.exportSnapshot(entries: ["b": saved], edits: ["a": ["draft": "저장 실패한 말", "goal": "내가 바라는 변화"], "b": ["draft": "다른 대화"]])
        XCTAssertEqual(result["a"]?.draft, "저장 실패한 말")
        XCTAssertEqual(result["a"]?.context?["goal"], "내가 바라는 변화")
        XCTAssertEqual(result["b"]?.draft, "다른 대화")
        XCTAssertEqual(saved.draft, "")
    }
    func testServerLengthAndNulValidationPreservesDraft() throws {
        var cache = ConversationCache()
        for invalid in [String(repeating: "😀", count: 2001), "before\0after"] {
            cache.draft = invalid
            XCTAssertThrowsError(try cache.enqueue())
            XCTAssertEqual(cache.draft, invalid); XCTAssertNil(cache.request)
        }
        cache.draft = String(repeating: "😀", count: 2000)
        try cache.enqueue(); XCTAssertNotNil(cache.request)
    }
    private func page(_ text: String) throws -> ConversationPage { try JSONDecoder().decode(ConversationPage.self, from: Data(text.utf8)) }
    func testTwoDeviceHistoryUsesOriginalMessageIdentityAndPartialUpdate() throws {
        var cache = ConversationCache()
        try cache.apply(page(#"{"events":[{"seq":1,"client_event_id":"e1","message":{"id":"desktop-user","role":"user","content":"가게에서 기다렸어요","created_at":1}},{"seq":2,"client_event_id":"e2","message":{"id":"desktop-answer","role":"assistant","content":"누가","created_at":2}}],"cursor":2,"has_more":true}"#))
        cache.draft = "아직 보내지 않은 내 생각"
        try cache.apply(page(#"{"events":[{"seq":3,"client_event_id":"e3","message":{"id":"desktop-answer","role":"assistant","content":"누가 가장 오래 기다렸나요?","created_at":2}}],"cursor":3,"has_more":false}"#))
        XCTAssertEqual(cache.messages.count, 2)
        XCTAssertEqual(cache.messages.last?.id, "desktop-answer")
        XCTAssertEqual(cache.messages.last?.content, "누가 가장 오래 기다렸나요?")
        XCTAssertEqual(cache.draft, "아직 보내지 않은 내 생각")
        XCTAssertEqual(cache.cursor, 3)
    }
    func testMalformedOrUnreturnedCursorCannotDiscardHistory() throws {
        var cache = ConversationCache()
        let valid = try page(#"{"events":[{"seq":1,"client_event_id":"e1","message":{"id":"original","role":"user","content":"관찰","created_at":1}}],"cursor":1,"has_more":false}"#)
        try cache.apply(valid)
        let invalid = try page(#"{"events":[{"seq":2,"client_event_id":"e2","message":{"id":"other","role":"tool","content":"private tool data","created_at":2}}],"cursor":2,"has_more":false}"#)
        XCTAssertThrowsError(try cache.apply(invalid))
        XCTAssertEqual(cache.messages.count, 1); XCTAssertEqual(cache.cursor, 1)
        XCTAssertThrowsError(try cache.apply(page(#"{"events":[],"cursor":5,"has_more":false}"#)))
        XCTAssertEqual(cache.cursor, 1)
    }
    func testOfflineOutboxSurvivesRestartWithoutCreatingAnotherTurn() throws {
        var cache = ConversationCache(); cache.draft = "같은 대화를 이어갈래요"
        try cache.enqueue()
        let originalID = cache.request?.id
        cache = try JSONDecoder().decode(ConversationCache.self, from: JSONEncoder().encode(cache))
        XCTAssertEqual(cache.request?.id, originalID)
        XCTAssertEqual(cache.request?.text, "같은 대화를 이어갈래요")
        XCTAssertTrue(cache.draft.isEmpty)
        cache.draft = "다음 생각"
        XCTAssertThrowsError(try cache.enqueue())
        XCTAssertEqual(cache.request?.id, originalID)
        XCTAssertEqual(cache.draft, "다음 생각")
        cache.request?.status = "completed"
        try cache.enqueue()
        XCTAssertNotEqual(cache.request?.id, originalID)
    }
}
