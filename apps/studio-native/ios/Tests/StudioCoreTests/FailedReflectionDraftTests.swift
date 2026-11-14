import XCTest
@testable import StudioCore

final class FailedReflectionDraftTests: XCTestCase {
    private func failed() throws -> ConversationCache {
        var cache = ConversationCache(); cache.draft = "정리하지 못한 생각 🙂"; cache.cursor = 3
        try cache.enqueue(reflection: true)
        cache.request?.status = "failed"
        let request = try XCTUnwrap(cache.request)
        cache.messages = [SharedMessage(id: request.id, role: "user", content: request.text, created_at: 1)]
        cache.cursor = 4; cache.requestFailure = "답변을 받지 못했어요."
        return cache
    }
    private func reopen(_ cache: ConversationCache) throws -> ConversationCache {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        try JSONEncoder().encode(cache).write(to: file, options: .atomic)
        return try JSONDecoder().decode(ConversationCache.self, from: Data(contentsOf: file))
    }
    func testRecordedFailureRestoresOnlyDraftAndExplicitSendCreatesFreshIdentity() throws {
        var cache = try reopen(failed())
        let original = try XCTUnwrap(cache.request), messages = cache.messages
        XCTAssertTrue(cache.restoreFailedReflectionDraft())
        XCTAssertEqual(cache.draft, original.text)
        XCTAssertEqual(cache.request, original)
        XCTAssertEqual(cache.messages, messages)
        XCTAssertEqual(cache.requestFailure, "답변을 받지 못했어요.")
        cache = try reopen(cache)
        XCTAssertEqual(cache.request?.status, "failed") // restore/restart cannot enqueue
        XCTAssertEqual(cache.draft, original.text)
        let snapshot = PersonalReflection(state: .init(id: "personal-reflection", revision: 4, messages: messages, has_earlier: false, turn: original), opening: "질문", hint: "", acknowledged_id: nil)
        try cache.applyReflection(snapshot)
        XCTAssertEqual(cache.draft, original.text)
        cache.draft += " — 이제 다시 생각해 보기" // explicit local edit
        try cache.enqueue(reflection: true)
        let next = try XCTUnwrap(cache.request)
        XCTAssertNotEqual(next.id, original.id)
        XCTAssertEqual(next.status, "local")
        XCTAssertEqual(next.expectedRevision, 4)
        XCTAssertEqual(cache.messages, messages)
        XCTAssertTrue(cache.draft.isEmpty)
        cache = try reopen(cache)
        try cache.applyReflection(snapshot) // stale failed ID cannot replace this new outbox
        XCTAssertEqual(cache.request, next)
        XCTAssertFalse(cache.restoreFailedReflectionDraft())
    }
    func testExistingDraftIncludingUnsavedOverlayIsNeverReplaced() throws {
        let original = try failed()
        for words in ["別の下書き", " ", "\n"] {
            var cache = original.applyingEdits(["draft": words])
            XCTAssertFalse(cache.canRestoreFailedReflectionDraft)
            XCTAssertFalse(cache.restoreFailedReflectionDraft())
            cache = try reopen(cache)
            XCTAssertEqual(cache.draft, words)
            XCTAssertEqual(cache.request, original.request)
        }
    }
    func testOtherTerminalAndUncertainStatesDoNotCreateFreshSend() throws {
        for status in ["local", "pending", "running", "unknown", "completed", "cancelled"] {
            var cache = try failed(); cache.request?.status = status
            let request = cache.request
            XCTAssertFalse(cache.restoreFailedReflectionDraft(), status)
            XCTAssertEqual(cache.request, request)
            XCTAssertTrue(cache.draft.isEmpty)
        }
        var empty = ConversationCache()
        XCTAssertFalse(empty.restoreFailedReflectionDraft())
        for text in ["", "   ", String(repeating: "a", count: 4001), "bad\0text"] {
            var cache = try failed(); cache.request?.text = text
            XCTAssertFalse(cache.restoreFailedReflectionDraft())
            XCTAssertTrue(cache.draft.isEmpty)
        }
    }
    func testRepeatedRestoreCannotOverwriteAnEditOrDuplicateText() throws {
        var cache = try failed()
        XCTAssertTrue(cache.restoreFailedReflectionDraft())
        cache.draft = "수정한 글"
        XCTAssertFalse(cache.restoreFailedReflectionDraft())
        XCTAssertEqual(cache.draft, "수정한 글")
    }
}
