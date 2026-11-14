import XCTest
@testable import StudioCore

final class GuestDraftTests: XCTestCase {
    private func temporaryFile() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent("guest.json")
    }

    func testWritingSurvivesRelaunchWithoutAnAccountOrRequest() throws {
        let file = try temporaryFile()
        XCTAssertEqual(try GuestDraft.load(from: file).text, "")
        let words = "아직 정리하지 못한 생각\n  다음 줄도 그대로 🙂"
        try GuestDraft(text: words).save(to: file)
        let restored = try GuestDraft.load(from: file)
        XCTAssertEqual(restored.text, words)
        // Cancelled/failed authentication has no handoff, and cannot consume it.
        XCTAssertEqual(try GuestDraft.load(from: file), restored)
        try GuestDraft(text: "").save(to: file)
        XCTAssertEqual(try GuestDraft.load(from: file).text, "")
    }

    func testHandoffKeepsExistingDraftAndOutstandingTurnUntilExplicitSafeRestore() throws {
        let guestFile = try temporaryFile(), accountFile = try temporaryFile()
        var guest = GuestDraft(text: "로그인 전에 쓴 글")
        try guest.save(to: guestFile)
        var account = ConversationCache(); account.draft = "이미 계정에 있는 글"
        var writes = 0
        XCTAssertFalse(try guest.handoff(into: account, saveAccount: { _ in writes += 1 }, saveGuest: { _ in writes += 1 }))
        XCTAssertEqual(account.draft, "이미 계정에 있는 글"); XCTAssertEqual(guest.text, "로그인 전에 쓴 글")
        try account.enqueue()
        let request = account.request
        XCTAssertFalse(try guest.handoff(into: account, saveAccount: { _ in writes += 1 }, saveGuest: { _ in writes += 1 }))
        XCTAssertEqual(writes, 0); XCTAssertEqual(account.request?.id, request?.id)
        account.request?.status = "completed"
        XCTAssertTrue(try guest.handoff(into: account, saveAccount: {
            try JSONEncoder().encode($0).write(to: accountFile, options: .atomic); account = $0
        }, saveGuest: { try $0.save(to: guestFile) }))
        XCTAssertEqual(account.draft, "로그인 전에 쓴 글"); XCTAssertEqual(guest.text, "")
        XCTAssertEqual(account.request?.id, request?.id)
        XCTAssertEqual(account.request?.status, "completed") // no new enqueue/send
        let restored = try JSONDecoder().decode(ConversationCache.self, from: Data(contentsOf: accountFile))
        XCTAssertEqual(restored.draft, "로그인 전에 쓴 글")
        XCTAssertEqual(restored.request?.id, request?.id)
        XCTAssertEqual(try GuestDraft.load(from: guestFile).text, "")
    }

    func testFailedAccountWriteRetainsGuestAndNeverClearsItsFile() throws {
        enum DiskFailure: Error { case full }
        let file = try temporaryFile()
        var guest = GuestDraft(text: "저장 실패해도 남아야 하는 글"); try guest.save(to: file)
        var cleared = false
        XCTAssertThrowsError(try guest.handoff(into: ConversationCache(), saveAccount: { _ in throw DiskFailure.full }, saveGuest: { _ in cleared = true }))
        XCTAssertFalse(cleared)
        XCTAssertEqual(try GuestDraft.load(from: file), guest)
    }

    func testFailedGuestCleanupKeepsBothCopiesAndSuccessfulRetryDoesNotSend() throws {
        enum DiskFailure: Error { case locked }
        let file = try temporaryFile()
        var guest = GuestDraft(text: "두 사본 중 하나도 잃지 않기"); try guest.save(to: file)
        var account = ConversationCache()
        XCTAssertThrowsError(try guest.handoff(into: account, saveAccount: { account = $0 }, saveGuest: { _ in throw DiskFailure.locked }))
        XCTAssertEqual(account.draft, guest.text); XCTAssertNil(account.request)
        XCTAssertEqual(try GuestDraft.load(from: file), guest)
        // A repeated attempt cannot replace the now nonempty account draft.
        XCTAssertFalse(try guest.handoff(into: account, saveAccount: { _ in XCTFail("must preserve the account copy") }, saveGuest: { _ in XCTFail("must preserve the guest copy") }))
        account.draft = "" // only an explicit account edit makes restore possible
        XCTAssertTrue(try guest.handoff(into: account, saveAccount: { account = $0 }, saveGuest: { try $0.save(to: file) }))
        XCTAssertEqual(try GuestDraft.load(from: file).text, ""); XCTAssertNil(account.request)
    }

    func testUnreadableOrFutureFileIsNotTreatedAsAnEmptyDraft() throws {
        let file = try temporaryFile()
        for bytes in [Data("broken".utf8), Data(#"{"version":9,"text":"keep this original"}"#.utf8)] {
            try bytes.write(to: file)
            XCTAssertThrowsError(try GuestDraft.load(from: file))
            XCTAssertEqual(try Data(contentsOf: file), bytes)
        }
    }
}
