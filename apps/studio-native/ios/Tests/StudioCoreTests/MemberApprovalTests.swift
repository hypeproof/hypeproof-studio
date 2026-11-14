import XCTest
@testable import StudioCore

final class MemberApprovalTests: XCTestCase {
    static func value(_ edits: [String: Any] = [:]) throws -> MemberApprovalCard {
        var object: [String: Any] = ["id":"card-1", "request_digest":String(repeating:"d",count:64), "source":["repo":"hypeproof/hypeproof-studio","pr":3788,"head":String(repeating:"a",count:40),"base":String(repeating:"b",count:40),"policy_digest":String(repeating:"b",count:64),"evidence_digest":String(repeating:"c",count:64),"context_digest":String(repeating:"e",count:64)], "reviewer":"reviewer", "brief":["authored":["변경 설명"],"verified":["검증 근거"]], "state":"pending", "created_at":900, "expires_at":2000, "lease_expires_at":1050, "can_decide":true, "unavailable_reason":NSNull(), "decision":NSNull(), "review":NSNull()]
        for (key,value) in edits { object[key] = value }
        return try JSONDecoder().decode(MemberApprovalCard.self, from: JSONSerialization.data(withJSONObject: object))
    }
    func testRejectMalformedIdentityReviewAndLease() throws {
        let valid = try Self.value(); try valid.validate();
        for id in ["_card", ":card", ".card", "-card"] { try Self.value(["id":id]).validate() }
        XCTAssertThrowsError(try Self.value(["id":".."]).validate()); XCTAssertTrue(valid.canDecide(now:1000)); XCTAssertFalse(valid.canDecide(now:1050)); XCTAssertFalse(valid.canDecide(now:900))
        for field in ["id","request_digest"] { let malformed = try Self.value([field:(field == "id" ? "card-1" : String(repeating:"d",count:64))+"\n"]); XCTAssertThrowsError(try malformed.validate()) }
        let wrong = try Self.value(["review":["id":1,"state":"APPROVED","commit_id":String(repeating:"b",count:40),"html_url":"https://evil.test","user":["login":"reviewer"]]])
        XCTAssertThrowsError(try wrong.validate())
        XCTAssertNotEqual(try Self.value(["state":"submitted"]).statusLabel, "GitHub 승인 반영됨")
    }
    func testServiceUnicodeAndThirtyFactBoundary() throws {
        let emoji = String(repeating: "🧭", count: 1001)
        let facts = Array(repeating: "A fact", count: 29) + [emoji]
        try Self.value(["brief": ["authored": facts, "verified": ["Line one\r\nLine two"]]]).validate()
        XCTAssertThrowsError(try Self.value(["brief": ["authored": Array(repeating: "x", count: 31), "verified": ["Evidence"]]]).validate())
        XCTAssertThrowsError(try Self.value(["brief": ["authored": [String(repeating: "🧭", count: 2001)], "verified": ["Evidence"]]]).validate())
    }
    @MainActor final class Fixture {
        var identity: MemberApprovalIdentity? = .init(accountID:"a",sessionID:"s")
        var saved: [MemberApprovalPending] = [], posts: [MemberApprovalPending] = [], reads: [String] = []
        var diskFails = false, networkFails = false, switchOnSave = false, expireOnSave = false
        var clock: Double = 1000
        var availability = "ready", listReads = 0, journalReads = 0
        var listFailure: Error?
        lazy var controller = MemberApprovalController(identity:{ self.identity }, list:{ _ in
            self.listReads += 1
            if let error = self.listFailure { throw error }
            let value = try MemberApprovalTests.value()
            let card = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
            return try JSONDecoder().decode(MemberApprovalInbox.self, from: JSONSerialization.data(withJSONObject:["schema":"hps-member-approval-inbox/1","availability":self.availability,"cards":self.availability == "ready" ? [card] : []]))
        }, card:{ _, id, pending in
            self.reads.append(id)
            if let pending { XCTAssertTrue(self.saved.contains(where:{$0.id==pending.id})); self.posts.append(pending); if self.networkFails { throw URLError(.networkConnectionLost) }
                return try MemberApprovalTests.value(["state":"submitting","can_decide":false,"decision":["id":pending.id,"choice":pending.choice.rawValue,"status":"awaiting_processing","created_at":1000]]) }
            return try MemberApprovalTests.value()
        }, load:{ _ in self.journalReads += 1; return self.saved }, save:{ _, pending in
            if self.diskFails { throw URLError(.cannotWriteToFile) }; self.saved.append(pending)
            if self.switchOnSave { self.identity = .init(accountID:"b",sessionID:"other") }
            if self.expireOnSave { self.clock = 1051 }
        }, remove:{ _, id in self.saved.removeAll { $0.id == id } }, now:{self.clock}, changed:{ _ in })
        func choose() async { await controller.decide(id:"card-1",digest:String(repeating:"d",count:64),choice:.approve) }
    }
    @MainActor func testMemberEntryDiscoveryRequiresCurrentEnrollmentAndNeverReplays() async throws {
        let f = Fixture(); XCTAssertFalse(f.controller.view.entryVisible)
        await f.controller.discover()
        XCTAssertTrue(f.controller.view.entryVisible); XCTAssertTrue(f.controller.view.cards.isEmpty)
        XCTAssertEqual(f.listReads, 1); XCTAssertEqual(f.journalReads, 0); XCTAssertTrue(f.posts.isEmpty)
        f.controller.dismiss(); XCTAssertTrue(f.controller.view.entryVisible)
        f.listFailure = URLError(.notConnectedToInternet); await f.controller.discover()
        XCTAssertTrue(f.controller.view.entryVisible); XCTAssertTrue(f.controller.view.cards.isEmpty)
        f.listFailure = SyncFailure.http(503, "approval_inbox_unavailable"); await f.controller.discover()
        XCTAssertFalse(f.controller.view.entryVisible)
        f.listFailure = nil; f.availability = "not_enrolled"
        f.saved = [MemberApprovalPending(identity: f.identity!, card: try Self.value(), choice: .approve)]
        await f.controller.refresh()
        XCTAssertFalse(f.controller.view.entryVisible); XCTAssertEqual(f.controller.view.status, "not_enrolled")
        XCTAssertEqual(f.journalReads, 0); XCTAssertEqual(f.saved.count, 1); XCTAssertTrue(f.posts.isEmpty)
        f.controller.invalidate(); f.identity = .init(accountID:"ordinary",sessionID:"other")
        await f.controller.discover(); XCTAssertFalse(f.controller.view.entryVisible)
    }
    @MainActor func testPersistenceAndUncertainResultNeverAutomaticallyResends() async throws {
        let f = Fixture(); await f.controller.refresh(); XCTAssertEqual(f.controller.view.status,"ready")
        f.networkFails = true; await f.choose(); XCTAssertEqual(f.posts.count,1); XCTAssertEqual(f.saved.count,1)
        let original = f.saved[0].id; f.controller.invalidate(); await f.controller.refresh(); await f.choose()
        XCTAssertEqual(f.posts.count,1); XCTAssertEqual(f.saved[0].id,original); XCTAssertTrue(f.reads.contains("card-1"))
    }
    @MainActor func testDiskAccountChangeAndExpiryCannotDispatch() async throws {
        for mode in 0..<3 { let f = Fixture(); await f.controller.refresh(); f.diskFails = mode==0; f.switchOnSave = mode==1; f.expireOnSave = mode==2
            await f.choose(); XCTAssertEqual(f.posts.count,0)
            if mode==1 { XCTAssertEqual(f.controller.view.status,"signedOut"); XCTAssertTrue(f.controller.view.cards.isEmpty) }
        }
    }
    @MainActor func testDuplicateGestureAndFalseApproval() async throws {
        let f = Fixture(); await f.controller.refresh(); await f.choose(); await f.choose()
        XCTAssertEqual(f.posts.count,1); XCTAssertEqual(f.controller.view.cards.first?.statusLabel,"선택을 전달했어요 · 처리 대기")
    }
    @MainActor func testInboxAndConversationPollShareOneRefreshAndFenceAccountSwitch() async throws {
        let flight = AccountTokenRefreshFlight()
        let original = MemberApprovalIdentity(accountID: "a", sessionID: "session-a")
        var current: MemberApprovalIdentity? = original
        var rotations = 0
        var release: CheckedContinuation<String, Error>?
        let renew: () async throws -> String = {
            rotations += 1
            return try await withCheckedThrowingContinuation { release = $0 }
        }
        let poll = Task { try await flight.run(identity: original, current: { current }, renew: renew) }
        while release == nil { await Task.yield() }
        var joined = false
        let inbox = Task { joined = true; return try await flight.run(identity: original, current: { current }, renew: renew) }
        while !joined { await Task.yield() }
        XCTAssertEqual(rotations, 1)
        release?.resume(returning: "synthetic-token")
        let first = try await poll.value, second = try await inbox.value
        XCTAssertEqual(first, second)
        release = nil
        let stale = Task { try await flight.run(identity: original, current: { current }, renew: renew) }
        while release == nil { await Task.yield() }
        current = MemberApprovalIdentity(accountID: "b", sessionID: "session-b")
        flight.invalidate()
        let newAccount = try await flight.run(identity: current!, current: { current }, renew: { "new-account-token" })
        XCTAssertEqual(newAccount, "new-account-token")
        release?.resume(returning: "old-account-token")
        do { _ = try await stale.value; XCTFail("A stale rotation must never supply a token to a new account") }
        catch is CancellationError {} catch { XCTFail("Unexpected error: \(error)") }
    }

}
