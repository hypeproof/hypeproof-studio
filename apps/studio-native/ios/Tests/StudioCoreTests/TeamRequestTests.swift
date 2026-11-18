import XCTest
@testable import StudioCore

final class TeamRequestTests: XCTestCase {
    private func rights(_ account: String = "A") -> TeamRequestAccess {
        TeamRequestAccess(schema: "hps-team-request-access/1", account_id: account, notice_version: "synthetic/1", products: ["studio", "lab"])
    }
    private func receipt(_ draft: TeamRequestDraft, body: String? = nil) -> TeamRequestRecord {
        TeamRequestRecord(id: "trq_" + String(repeating: "a", count: 32), account_id: draft.accountID, client_request_id: draft.key,
                          product: draft.product, category: draft.category, body: body ?? draft.body, notice_version: draft.noticeVersion,
                          status: "submitted", revision: 1, created_at: 1000, updated_at: 1000)
    }
    @MainActor func testExplicitSendPersistsUncertainBeforeTransportAndAcceptsBoundReceipt() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: TeamRequestDraft?, sends = 0
        let controller = TeamRequestController(identity: { identity }, access: { _ in self.rights() },
            list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) }, send: { _, draft in
                sends += 1; XCTAssertEqual(disk?.phase, .uncertain); XCTAssertEqual(disk?.key, draft.key)
                return self.receipt(draft)
            }, recover: { _, _ in nil }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await controller.open(); XCTAssertEqual(sends, 0)
        controller.edit(body: "그대로 보존할 의견", product: "studio", category: "improvement"); XCTAssertEqual(sends, 0)
        let key = try XCTUnwrap(disk?.key)
        await controller.submit(); XCTAssertEqual(sends, 1); XCTAssertEqual(controller.view.draft?.phase, .received)
        XCTAssertEqual(disk?.key, key); XCTAssertEqual(disk?.receipt, "trq_" + String(repeating: "a", count: 32))
        await controller.submit(); XCTAssertEqual(sends, 1)
        controller.newDraft(); XCTAssertNotEqual(controller.view.draft?.key, key)
    }
    @MainActor func testUnknownSendRestartsAndRecoversWithoutAnotherPost() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: TeamRequestDraft?, sends = 0, recovered = 0
        func make() -> TeamRequestController {
            TeamRequestController(identity: { identity }, access: { _ in self.rights() }, list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) },
                send: { _, _ in sends += 1; throw URLError(.timedOut) }, recover: { _, draft in recovered += 1; return self.receipt(draft) },
                load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        }
        let first = make(); await first.open(); first.edit(body: "접수 결과 유실", product: "studio", category: "bug"); await first.submit()
        XCTAssertEqual(disk?.phase, .uncertain); XCTAssertEqual(sends, 1)
        let second = make(); await second.open(); XCTAssertEqual(sends, 1); XCTAssertEqual(second.view.draft?.phase, .uncertain)
        second.edit(body: "바꾸면 안 됨", product: "lab", category: "question"); XCTAssertEqual(second.view.draft?.body, "접수 결과 유실")
        await second.submit(recoveryOnly: true); XCTAssertEqual(sends, 1); XCTAssertEqual(recovered, 1); XCTAssertEqual(second.view.draft?.phase, .received)
    }
    @MainActor func testPreDispatchStorageFailureSendsNothingAndPreservesWords() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: TeamRequestDraft?, failing = false, sends = 0
        let controller = TeamRequestController(identity: { identity }, access: { _ in self.rights() }, list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) },
            send: { _, draft in sends += 1; return self.receipt(draft) }, recover: { _, _ in nil }, load: { _ in disk },
            save: { if failing { throw CocoaError(.fileWriteOutOfSpace) }; disk = $0 }, changed: { _ in })
        await controller.open(); controller.edit(body: "보존할 내용", product: "studio", category: "bug"); failing = true
        await controller.submit(); XCTAssertEqual(sends, 0); XCTAssertEqual(controller.view.draft?.body, "보존할 내용"); XCTAssertFalse(controller.view.storageReady)
        XCTAssertEqual(disk?.phase, .draft)
    }
    @MainActor func testAccountSwitchDiscardsLateReceiptAndRestoresOnlyOwnDraft() async throws {
        var identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: [String: TeamRequestDraft] = [:], held: CheckedContinuation<TeamRequestRecord, Error>?, sent: TeamRequestDraft?
        let started = expectation(description: "request dispatched")
        let controller = TeamRequestController(identity: { identity }, access: { self.rights($0.accountID) }, list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) },
            send: { _, draft in sent = draft; return try await withCheckedThrowingContinuation { held = $0; started.fulfill() } }, recover: { _, _ in nil },
            load: { disk[$0] }, save: { disk[$0.accountID] = $0 }, changed: { _ in })
        await controller.open(); controller.edit(body: "A의 비공개 초안", product: "studio", category: "bug")
        let task = Task { await controller.submit() }
        await fulfillment(of: [started], timeout: 2)
        identity = MemberApprovalIdentity(accountID: "B", sessionID: "session-B"); controller.invalidate(); await controller.open()
        XCTAssertEqual(controller.view.draft?.accountID, "B"); XCTAssertEqual(controller.view.draft?.body, "")
        held?.resume(returning: receipt(try XCTUnwrap(sent))); await task.value
        XCTAssertEqual(controller.view.draft?.accountID, "B"); XCTAssertNil(controller.view.draft?.receipt); XCTAssertEqual(disk["A"]?.phase, .uncertain)
        identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A2"); controller.invalidate(); await controller.open()
        XCTAssertEqual(controller.view.draft?.body, "A의 비공개 초안"); XCTAssertEqual(controller.view.draft?.phase, .uncertain)
    }
    @MainActor func testMismatchedReceiptNeverMarksReceived() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: TeamRequestDraft?
        let controller = TeamRequestController(identity: { identity }, access: { _ in self.rights() }, list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) },
            send: { _, draft in self.receipt(draft, body: "다른 요청") }, recover: { _, _ in nil }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await controller.open(); controller.edit(body: "내 요청", product: "studio", category: "bug"); await controller.submit()
        XCTAssertEqual(controller.view.draft?.phase, .uncertain); XCTAssertNil(controller.view.draft?.receipt)
    }
    func testValidationRejectsWrongAccountAndUnicodeOverflow() throws {
        var draft = TeamRequestDraft(accountID: "A", product: "studio"); draft.noticeVersion = "synthetic/1"; draft.body = String(repeating: "👋", count: 2500)
        XCTAssertNoThrow(try draft.payload()); draft.body += "👋"; XCTAssertThrowsError(try draft.payload())
        XCTAssertThrowsError(try rights("B").validate(account: "A"))
        XCTAssertFalse(TeamRequestPage.validCursor("1:trq_" + String(repeating: "a", count: 32) + "\n", prefix: "trq_"))
    }
    @MainActor func testNoticeRolloverRejectionUnlocksOnlyTheFirstKnownUnsentDraft() async throws {
        let identity = MemberApprovalIdentity(accountID: "A", sessionID: "session-A")
        var disk: TeamRequestDraft?, notice = "synthetic/1", sends = 0, accept = false
        let controller = TeamRequestController(identity: { identity }, access: { _ in TeamRequestAccess(schema: "hps-team-request-access/1", account_id: "A", notice_version: notice, products: ["studio"]) },
            list: { _, _, _ in TeamRequestPage(requests: [], next_cursor: nil) }, send: { _, draft in sends += 1; if !accept { throw SyncFailure.http(400, "team_notice_required") }; return self.receipt(draft) },
            recover: { _, _ in nil }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await controller.open(); controller.edit(body: "보존할 의견", product: "studio", category: "bug"); await controller.submit()
        XCTAssertEqual(disk?.phase, .draft); XCTAssertEqual(disk?.body, "보존할 의견"); XCTAssertNil(controller.view.access)
        notice = "synthetic/2"; accept = true; await controller.open(); await controller.submit()
        XCTAssertEqual(disk?.phase, .received); XCTAssertEqual(disk?.noticeVersion, "synthetic/2"); XCTAssertEqual(sends, 2)
        var unknown = TeamRequestDraft(accountID: "A", product: "studio"); unknown.body = "이미 접수됐을 수 있는 요청"; unknown.noticeVersion = "synthetic/1"; unknown.phase = .uncertain
        disk = unknown; accept = false; controller.invalidate(); await controller.open(); await controller.submit()
        XCTAssertEqual(disk?.phase, .uncertain); XCTAssertEqual(disk?.key, unknown.key)
    }

}
