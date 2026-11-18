import XCTest
@testable import StudioCore

final class TeamTextRevisionTests: XCTestCase {
    let request = "trq_" + String(repeating: "a", count: 32)
    let identityA = MemberApprovalIdentity(accountID: "A", sessionID: "sessionA")
    func retention(_ hidden: Bool = false) -> [String: Any] { ["policy":"90_days_after_reporter_confirmation", "purge_implemented":true, "content_purged_at":NSNull(), "purged_outcome_revision":NSNull(), "content_hidden":hidden, "hidden_outcome_revision":hidden ? 1 : NSNull(), "content_hidden_since":hidden ? 2000 : NSNull()] }
    func version(_ revision: Int, key: String = "fixture-key", body: String = "Private edit", hidden: Bool = false, author: String = "A") throws -> TeamTextVersion {
        var value: [String: Any] = ["request_id":request, "target_id":request, "revision":revision, "body":hidden ? "보관 기한이 지나 내용을 숨겼어요." : body, "created_at":1000, "retention":retention(hidden)]
        if revision == 1 { value["account_id"] = author }
        else { value["id"] = "ttv_" + String(format: "%032x", revision); value["actor_account_id"] = author; value["client_mutation_id"] = key; value["redacted_at"] = NSNull() }
        return try JSONDecoder().decode(TeamTextVersion.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func page(current: TeamTextVersion? = nil, events: [TeamTextVersion] = [], next: String? = nil, hidden: Bool = false, author: String = "A", canEdit: Bool = true) throws -> TeamTextRevisionPage {
        let original = try version(1, body: "Immutable original", hidden: hidden, author: author)
        func json(_ v: TeamTextVersion) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(v)) }
        return try JSONDecoder().decode(TeamTextRevisionPage.self, from: JSONSerialization.data(withJSONObject: ["schema":"hps-team-text-history/1", "request_id":request, "target_id":request, "can_edit":canEdit && !hidden, "original":try json(original), "current":try json(current ?? original), "events":try events.map(json), "next_cursor":next as Any? ?? NSNull(), "retention":retention(hidden)]))
    }
    func testParserRejectsWrongIdentityOrderBoundsAndLatestQuestionConfusion() throws {
        let current = try version(3), event = try version(2)
        let good = try page(current: current, events: [event,current]); try good.validate(request: request, target: request)
        XCTAssertThrowsError(try good.validate(request: request, target: "tcm_" + String(repeating: "b", count: 32)))
        XCTAssertThrowsError(try page(current: current, events: [current,event]).validate(request: request, target: request))
        XCTAssertThrowsError(try page(current: current, events: [event], next: "2").validate(request: request, target: request))
        XCTAssertThrowsError(try page(current: current, events: [try version(2, author: "B")]).validate(request: request, target: request))
        let hiddenPage = try page(hidden:true)
        var malformed = try XCTUnwrap(JSONSerialization.jsonObject(with:JSONEncoder().encode(hiddenPage)) as? [String:Any]);malformed.removeValue(forKey:"retention");malformed["can_edit"]=true
        let missingRoot = try JSONDecoder().decode(TeamTextRevisionPage.self,from:JSONSerialization.data(withJSONObject:malformed))
        XCTAssertThrowsError(try missingRoot.validate(request:request,target:request))
        let latest = try JSONDecoder().decode(TeamLatestQuestion.self, from: JSONSerialization.data(withJSONObject: ["request_id":request,"target_id":request,"account_id":"A","created_at":1000,"text_revision":3,"edited_at":NSNull()]))
        XCTAssertThrowsError(try latest.validate(request: request))
    }
    @MainActor func testUnknownCommitRecoversImmutableKeyAndBodyAcrossRestart() async throws {
        var stored: TeamTextRevisionDraft?, remote: TeamTextVersion?, posts: [TeamTextRevisionDraft] = []
        let controller = TeamTextRevisionController(requestID: request, targetID: request, identity: { self.identityA }, discover: { _ in ["hps-team-text-change/1"] }, fetch: { _,_ in try self.page(current: remote, events: remote.map { [$0] } ?? []) }, send: { _,draft in
            posts.append(draft); remote = try self.version(2, key: draft.key, body: draft.body)
            if posts.count == 1 { throw SyncFailure.http(503, "lost_response") }; return remote!
        }, load: { _ in stored }, save: { stored = $0 }, changed: { _ in })
        await controller.open(); controller.beginEdit(); controller.editBody("Exact user correction"); await controller.submit()
        XCTAssertEqual(stored?.phase, .uncertain); let initial = try XCTUnwrap(stored)
        controller.invalidate(); await controller.open(); controller.beginEdit(); controller.editBody("must not overwrite uncertain text"); await controller.submit()
        XCTAssertEqual(posts.count,2); XCTAssertEqual(posts[1].key,initial.key); XCTAssertEqual(posts[1].body,initial.body); XCTAssertEqual(stored?.phase,.received)
        XCTAssertEqual(stored?.receipt?.id,remote?.id)
    }
    @MainActor func testConflictNeedsFreshReadAndExplicitChoiceAndForeignAuthorCannotSend() async throws {
        var stored: TeamTextRevisionDraft?, remote: TeamTextVersion?, posts = 0
        let controller = TeamTextRevisionController(requestID: request, targetID: request, identity: { self.identityA }, discover: { _ in ["hps-team-text-change/1"] }, fetch: { _,_ in try self.page(current: remote, events: remote.map { [$0] } ?? []) }, send: { _,_ in posts += 1; throw SyncFailure.http(409,"team_text_revision_conflict") }, load: { _ in stored }, save: { stored = $0 }, changed: { _ in })
        await controller.open(); controller.beginEdit(); controller.editBody("Keep my correction"); let key = stored?.key; await controller.submit()
        XCTAssertEqual(stored?.phase,.conflict); controller.beginEdit(); XCTAssertEqual(stored?.key,key)
        remote = try version(2); await controller.open(); XCTAssertEqual(posts,1); controller.beginEdit(); XCTAssertNotEqual(stored?.key,key); XCTAssertEqual(stored?.expectedRevision,2); XCTAssertEqual(stored?.body,"Keep my correction")
        let foreign = TeamTextRevisionController(requestID: request,targetID: request,identity:{self.identityA},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in try self.page(author:"B",canEdit:true)},send:{_,_ in posts += 1;throw SyncFailure.invalidResponse},load:{_ in nil},save:{_ in},changed:{_ in})
        await foreign.open(); foreign.beginEdit(); foreign.editBody("unauthorized"); await foreign.submit(); XCTAssertEqual(posts,1); XCTAssertEqual(foreign.view.draft?.body,"")
    }
    @MainActor func testPersistenceFailureKeepsExportableWordsAndBlocksTransport() async throws {
        var rejectSave = false, posts = 0
        let controller = TeamTextRevisionController(requestID: request,targetID: request,identity:{self.identityA},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in try self.page()},send:{_,draft in posts += 1;return try self.version(2,key:draft.key,body:draft.body)},load:{_ in nil},save:{_ in if rejectSave {throw SyncFailure.invalidResponse}},changed:{_ in})
        await controller.open(); controller.beginEdit(); rejectSave = true; controller.editBody("Words that must remain exportable"); await controller.submit()
        XCTAssertFalse(controller.view.storageReady); XCTAssertEqual(posts,0); XCTAssertTrue(controller.view.draft?.exportText.contains("Words that must remain exportable") == true)
    }
    @MainActor func testLateAccountSwitchRejectsSuccessAndThrowingSend() async throws {
        for throwing in [false,true] {
            var identity = identityA
            let controller = TeamTextRevisionController(requestID: request,targetID: request,identity:{identity},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in try self.page()},send:{_,draft in identity = MemberApprovalIdentity(accountID:"B",sessionID:"sessionB");if throwing {throw SyncFailure.http(503,"unknown")};return try self.version(2,key:draft.key,body:draft.body)},load:{_ in nil},save:{_ in},changed:{_ in})
            await controller.open(); controller.beginEdit(); controller.editBody("A private correction"); await controller.submit()
            XCTAssertNil(controller.view.draft); XCTAssertNil(controller.view.page); XCTAssertTrue(controller.view.events.isEmpty)
        }
        var identity = identityA
        let lateFetch = TeamTextRevisionController(requestID:request,targetID:request,identity:{identity},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in identity=MemberApprovalIdentity(accountID:"B",sessionID:"newSession");throw SyncFailure.http(503,"late_fetch")},send:{_,_ in throw SyncFailure.invalidResponse},load:{_ in nil},save:{_ in},changed:{_ in})
        await lateFetch.open();XCTAssertNil(lateFetch.view.draft);XCTAssertNil(lateFetch.view.page)
    }
    @MainActor func testLaterPageHiddenTransitionClearsAllCachedHistoryAndOnlyScrubsAcknowledgedDraft() async throws {
        for received in [true,false] {
            var draft = TeamTextRevisionDraft(accountID:"A",requestID:request,targetID:request); draft.body = "Private received words"; draft.phase = received ? .received : .uncertain
            if received { draft.receipt = try version(2,key:draft.key,body:draft.body) }
            var stored = draft
            var published: [TeamTextRevisionController.View] = []
            let firstEvents = try (2...51).map { try version($0,key:$0 == 2 ? draft.key:"history-key",body:$0 == 2 ? draft.body:"Private history") }
            let first = try page(current:version(52),events:firstEvents,next:"51"), hiddenCurrent = try version(52,hidden:true), second = try page(current:hiddenCurrent,events:[hiddenCurrent],hidden:true)
            let controller = TeamTextRevisionController(requestID: request,targetID: request,identity:{self.identityA},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,cursor in cursor == nil ? first:second},send:{_,_ in throw SyncFailure.invalidResponse},load:{_ in stored},save:{stored=$0},changed:{published.append($0)})
            await controller.open(); XCTAssertEqual(controller.view.events.count,50); await controller.more()
            XCTAssertTrue(controller.view.events.isEmpty); XCTAssertTrue(controller.view.historyNeedsRefresh)
            if received { for state in published where state.draft?.body == "보관 기한이 지나 내용을 숨겼어요." { XCTAssertEqual(state.page?.current.body,"보관 기한이 지나 내용을 숨겼어요.");XCTAssertTrue(state.events.allSatisfy { $0.body == "보관 기한이 지나 내용을 숨겼어요." }) } }
            XCTAssertEqual(stored.key,draft.key); XCTAssertEqual(stored.phase,draft.phase)
            XCTAssertEqual(stored.body,received ? "보관 기한이 지나 내용을 숨겼어요.":draft.body)
        }
    }
    @MainActor func testReceiptRevisionFloorRejectsStaleCurrentAndFailedReadDoesNotUseOriginalAsCurrent() async throws {
        var draft = TeamTextRevisionDraft(accountID:"A",requestID:request,targetID:request);draft.body="Recorded correction";draft.phase = .received;draft.receipt = try version(2,key:draft.key,body:draft.body)
        let controller = TeamTextRevisionController(requestID:request,targetID:request,identity:{self.identityA},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in try self.page()},send:{_,_ in throw SyncFailure.invalidResponse},load:{_ in draft},save:{_ in},changed:{_ in})
        await controller.open(); XCTAssertNil(controller.view.page); XCTAssertNil(controller.view.draft); XCTAssertTrue(controller.view.acknowledgedPending)
    }
    @MainActor func testRestartAfterFailedAcknowledgedScrubWithholdsOldCopyButKeepsUncertainWords() async throws {
        var stored = TeamTextRevisionDraft(accountID:"A",requestID:request,targetID:request)
        stored.body="Previously acknowledged private words";stored.phase = .received;stored.receipt=try version(2,key:stored.key,body:stored.body)
        var hidden=false,offline=false,failSave=false
        let controller=TeamTextRevisionController(requestID:request,targetID:request,identity:{self.identityA},discover:{_ in ["hps-team-text-change/1"]},fetch:{_,_ in if offline{throw SyncFailure.http(503,"offline")};let event=try self.version(2,key:stored.key,body:stored.body,hidden:hidden);return try self.page(current:event,events:[event],hidden:hidden)},send:{_,_ in throw SyncFailure.invalidResponse},load:{_ in stored},save:{value in if failSave{throw SyncFailure.invalidResponse};stored=value},changed:{_ in})
        await controller.open();XCTAssertEqual(controller.view.draft?.body,stored.body)
        hidden=true;failSave=true;await controller.open();XCTAssertFalse(controller.view.storageReady);XCTAssertEqual(controller.view.draft?.body,"보관 기한이 지나 내용을 숨겼어요.")
        XCTAssertEqual(stored.body,"Previously acknowledged private words")
        controller.invalidate();offline=true;await controller.open();XCTAssertNil(controller.view.draft);XCTAssertTrue(controller.view.acknowledgedPending)
        stored.phase = .uncertain;stored.receipt=nil;controller.invalidate();await controller.open();XCTAssertEqual(controller.view.draft?.body,stored.body);XCTAssertTrue(controller.view.draft?.exportText.contains(stored.body)==true)
    }

}
