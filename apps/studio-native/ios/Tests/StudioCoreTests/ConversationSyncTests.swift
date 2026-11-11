import XCTest
@testable import StudioCore

final class ConversationSyncTests: XCTestCase {
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
