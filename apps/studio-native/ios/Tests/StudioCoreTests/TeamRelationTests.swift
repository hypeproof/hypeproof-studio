import Foundation
import XCTest
@testable import StudioCore
final class TeamRelationTests:XCTestCase{
    let source="trq_"+String(repeating:"a",count:32),target="trq_"+String(repeating:"b",count:32),account=MemberApprovalIdentity(accountID:"A",sessionID:"S1")
    func event(_ draft:TeamRelationDraft,_ revision:Int=1)throws->TeamRelationEvent{
        try JSONDecoder().decode(TeamRelationEvent.self,from:JSONSerialization.data(withJSONObject:["id":"trl_"+String(format:"%032x",revision),"pair_left":source,"pair_right":target,"client_mutation_id":draft.key,"action":draft.action,"actor_account_id":draft.accountID,"reason":draft.reason,"sequence":revision,"revision":revision,"created_at":1000,"redacted_at":NSNull(),"target_request_id":target]))
    }
    func page(_ event:TeamRelationEvent?=nil,history:Bool=false,manage:Bool=true)throws->TeamRelationPage{
        let e=try event.map{try JSONSerialization.jsonObject(with:JSONEncoder().encode($0))} ?? NSNull()
        return try JSONDecoder().decode(TeamRelationPage.self,from:JSONSerialization.data(withJSONObject:["schema":history ? "hps-team-relation-history/1":"hps-team-related-requests/1","request_id":source,"target_request_id":history ? target as Any:NSNull(),"can_manage":manage,"current":history ? e:NSNull(),"items":event != nil && (history || event?.action=="link") ? [e]:[],"next_cursor":NSNull()]))
    }
    func choices()throws->TeamRequestPage{try JSONDecoder().decode(TeamRequestPage.self,from:JSONSerialization.data(withJSONObject:["requests":[["id":target,"account_id":"B","client_request_id":"client1","product":"studio","category":"bug","body":"Related original","notice_version":"1","status":"submitted","revision":1,"created_at":1000,"updated_at":1000]],"next_cursor":NSNull()]))}
    @MainActor func testUnknownCommittedLinkRecoversSameKeyThenExplicitUnlink()async throws{
        var stored:TeamRelationDraft?,remote:TeamRelationEvent?,posts:[TeamRelationDraft]=[]
        let choices=try choices()
        let c=TeamRelationController(requestID:source,product:"studio",identity:{self.account},fetch:{_,target,_ in try self.page(remote,history:target != nil)},targets:{_,_ in choices},send:{_,draft in
            posts.append(draft);if remote?.client_mutation_id != draft.key{remote=try self.event(draft,draft.expectedRevision+1)}
            if posts.count==1{throw SyncFailure.http(503,"unknown")};return remote!
        },load:{_ in stored},save:{stored=$0},changed:{_ in})
        await c.open();await c.select(target);c.editReason("Same symptom, separate original");await c.submit()
        XCTAssertEqual(stored?.phase,.uncertain);let original=try XCTUnwrap(stored);XCTAssertEqual(remote?.revision,1)
        c.invalidate();await c.open();c.editReason("must not change");await c.submit();XCTAssertEqual(posts.count,2);XCTAssertEqual(posts[1].key,original.key);XCTAssertEqual(posts[1].reason,original.reason);XCTAssertEqual(stored?.phase,.received);XCTAssertEqual(c.view.items.count,1)
        c.newChoice();XCTAssertEqual(stored?.action,"unlink");XCTAssertNotEqual(stored?.key,original.key);c.editReason("No longer related");await c.submit();XCTAssertEqual(remote?.revision,2);XCTAssertEqual(remote?.action,"unlink");XCTAssertTrue(c.view.items.isEmpty)
    }
    @MainActor func testSpecificConflictRequiresAuthoritativeRefreshAndExplicitNewChoice()async throws{
        var stored:TeamRelationDraft?,remote:TeamRelationEvent?,posts=0;let choices=try choices()
        let c=TeamRelationController(requestID:source,product:"studio",identity:{self.account},fetch:{_,target,_ in try self.page(remote,history:target != nil)},targets:{_,_ in choices},send:{_,_ in posts+=1;throw SyncFailure.http(409,"team_relation_conflict")},load:{_ in stored},save:{stored=$0},changed:{_ in})
        await c.open();await c.select(target);c.editReason("Keep these words");let key=stored?.key
        await c.submit();XCTAssertEqual(stored?.phase,.conflict);c.newChoice();XCTAssertEqual(stored?.key,key)
        var other=TeamRelationDraft(accountID:"B",requestID:source,product:"studio");other.targetID=target;other.reason="Another operator linked";remote=try event(other)
        await c.open();XCTAssertEqual(posts,1);XCTAssertEqual(stored?.key,key);c.newChoice();XCTAssertNotEqual(stored?.key,key);XCTAssertEqual(stored?.expectedRevision,1);XCTAssertEqual(stored?.action,"unlink");XCTAssertEqual(stored?.reason,"Keep these words");XCTAssertEqual(posts,1)
    }
    @MainActor func testReadOnlyInspectionDoesNotMutateDraftAndAccountBoundaryClears()async throws{
        var d=TeamRelationDraft(accountID:"A",requestID:source,product:"studio");d.targetID=target;d.reason="Operator reason";let e=try event(d),choices=try choices();var identity=account,posts=0
        let c=TeamRelationController(requestID:source,product:"studio",identity:{identity},fetch:{_,target,_ in try self.page(e,history:target != nil,manage:false)},targets:{_,_ in XCTFail("readonly must not enumerate operator choices");return choices},send:{_,_ in posts+=1;return e},load:{_ in nil},save:{_ in},changed:{_ in})
        await c.open();await c.inspect(target);XCTAssertEqual(c.view.events.count,1);XCTAssertEqual(c.view.draft?.targetID,"");await c.submit();XCTAssertEqual(posts,0)
        let registry=TeamRelationControllers();registry.register(c);registry.invalidate();await c.open();registry.invalidate();XCTAssertNil(c.view.list)
        identity=MemberApprovalIdentity(accountID:"B",sessionID:"S2");await c.open();XCTAssertEqual(c.view.draft?.accountID,"B")
    }
    @MainActor func testLateAccountReplyAndFailedPersistenceCannotSendOrDiscardWords()async throws{
        let choices=try choices();var identity=account,changeDuringFetch=false,failSave=false,posts=0
        let c=TeamRelationController(requestID:source,product:"studio",identity:{identity},fetch:{_,target,_ in if changeDuringFetch{identity=MemberApprovalIdentity(accountID:"B",sessionID:"S2")};return try self.page(history:target != nil)},targets:{_,_ in choices},send:{_,draft in posts+=1;return try self.event(draft)},load:{_ in nil},save:{_ in if failSave{throw CocoaError(.fileWriteOutOfSpace)}},changed:{_ in})
        await c.open();changeDuringFetch=true;await c.select(target);XCTAssertNil(c.view.list);XCTAssertNil(c.view.draft)
        identity=account;changeDuringFetch=false;await c.open();await c.select(target);failSave=true;c.editReason("Words remain exportable");XCTAssertFalse(c.view.storageReady);XCTAssertEqual(c.view.draft?.reason,"Words remain exportable");await c.submit();XCTAssertEqual(posts,0);await c.open();XCTAssertEqual(c.view.draft?.reason,"Words remain exportable")
    }
    @MainActor func testReceivedReceiptRejectsOlderHistoryBeforeNewChoice()async throws{
        var stored:TeamRelationDraft?,remote:TeamRelationEvent?,stale=true;let choices=try choices()
        let c=TeamRelationController(requestID:source,product:"studio",identity:{self.account},fetch:{_,target,_ in try self.page(stale ? nil:remote,history:target != nil)},targets:{_,_ in choices},send:{_,draft in remote=try self.event(draft);return remote!},load:{_ in stored},save:{stored=$0},changed:{_ in})
        await c.open();await c.select(target);c.editReason("Keep receipt identity");await c.submit()
        let key=stored?.key;XCTAssertEqual(stored?.phase,.received);XCTAssertNil(c.view.history);c.newChoice();XCTAssertEqual(stored?.key,key)
        stale=false;await c.open();XCTAssertEqual(c.view.history?.current?.id,stored?.receiptID);c.newChoice();XCTAssertNotEqual(stored?.key,key);XCTAssertEqual(stored?.expectedRevision,1);XCTAssertEqual(stored?.action,"unlink")
    }
    func testForeignPairAndMalformedReceiptDoNotBecomeValidHistory()throws{
        var d=TeamRelationDraft(accountID:"A",requestID:source,product:"studio");d.targetID=target;d.reason="Related";let e=try event(d)
        try page(e,history:true).validate(source:source,target:target)
        XCTAssertThrowsError(try page(e,history:true).validate(source:target,target:source))
        XCTAssertThrowsError(try page(e,history:true).validate(source:source,target:target,after:"1"))
        var value=try JSONSerialization.jsonObject(with:JSONEncoder().encode(e)) as! [String:Any];value["pair_right"]=source
        let malformed=try JSONDecoder().decode(TeamRelationEvent.self,from:JSONSerialization.data(withJSONObject:value));XCTAssertThrowsError(try malformed.validate(source:source,target:target))
        var changed=d;changed.reason="Different";XCTAssertFalse(e.matches(changed))
    }
}
