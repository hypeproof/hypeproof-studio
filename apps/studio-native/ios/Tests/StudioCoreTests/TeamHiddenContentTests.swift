import Foundation
import XCTest
@testable import StudioCore
final class TeamHiddenContentTests:XCTestCase{
    func fixture(_ name:String, resource:String = "service-retention-route-fixtures")throws->[String:Any]{
        let url=try XCTUnwrap(Bundle.module.url(forResource:resource,withExtension:"json",subdirectory:"Fixtures"))
        let root=try JSONSerialization.jsonObject(with:Data(contentsOf:url)) as! [String:Any]
        return ((root["fixtures"] as! [String:Any])[name] as! [String:Any])["json"] as! [String:Any]
    }
    func decode<T:Decodable>(_ type:T.Type,_ object:[String:Any])throws->T{try JSONDecoder().decode(type,from:JSONSerialization.data(withJSONObject:object))}
    func testActualAuthenticatedD1HiddenResponsesKeepNavigationAndExactBuild()throws{
        let raw=try fixture("detail"),request=(raw["request"] as! [String:Any])["id"] as! String
        let detail=try decode(TeamRequestDetail.self,raw);try detail.validate(id:request)
        XCTAssertTrue(detail.retention?.hidden==true);XCTAssertNil(detail.retention?.content_purged_at)
        XCTAssertEqual(detail.request.body,TeamContentRetention.hiddenMarker)
        let github=try decode(TeamGitHubPage.self,fixture("github_links"));try github.validate(request:request);XCTAssertNotNil(github.current);XCTAssertNil(github.current?.evidence);XCTAssertNil(github.current?.redacted_at)
        let delivery=try decode(TeamDeliveryPage.self,fixture("deliveries"));try delivery.validate(request:request);XCTAssertNotNil(delivery.current);XCTAssertEqual(delivery.current?.availability,"not_established")
        let outcome=try decode(TeamOutcomePage.self,fixture("outcomes"));try outcome.validate(request:request);XCTAssertEqual(outcome.current?.target.version,"0.2.0");XCTAssertEqual(outcome.current?.target.build,"18.1");XCTAssertTrue(outcome.can_respond)
        let workflow=try decode(TeamWorkflowPage.self,fixture("workflow"));try workflow.validate(request:request);XCTAssertNil(workflow.current.reason);XCTAssertNil(workflow.current.next_action);XCTAssertNil(workflow.current.redacted_at)
        let observations=try decode(TeamGitHubObservationPage.self,fixture("observations"));try observations.validate(request:request,after:nil);XCTAssertNil(observations.current);XCTAssertNotNil(observations.association_id);XCTAssertFalse(observations.isFresh(at:Date().timeIntervalSince1970*1000))
        XCTAssertEqual(try fixture("related")["error"] as? String,"team_content_expired")
    }
    func testNullPrivateFieldsNeedExplicitConsistentHiddenMetadata()throws{
        var raw=try fixture("github_links");let request=raw["request_id"] as! String
        var current=raw["current"] as! [String:Any];current.removeValue(forKey:"retention");raw["current"]=current
        XCTAssertThrowsError(try decode(TeamGitHubPage.self,raw).validate(request:request))
        var retention=(try fixture("detail"))["retention"] as! [String:Any]
        retention["hidden_outcome_revision"]=NSNull();XCTAssertThrowsError(try decode(TeamContentRetention.self,retention).validate())
        retention["hidden_outcome_revision"]=2;retention["purged_outcome_revision"]=1;retention["content_purged_at"]=1000
        let next=try decode(TeamContentRetention.self,retention);try next.validate();XCTAssertFalse(next.currentCyclePurged);XCTAssertEqual(next.marker,TeamContentRetention.hiddenMarker)
        retention["policy"]="different";XCTAssertThrowsError(try decode(TeamContentRetention.self,retention).validate())
    }

    @MainActor func testAcknowledgedOutcomeScrubsBeforeFailedSaveButUncertainWordsAndKeySurvive() async throws {
        // Synthetic client receipt keys layered on the actual route shape, separate from the unchanged decoder fixture test.
        var raw = try fixture("outcomes"), event = raw["current"] as! [String:Any]
        let key = UUID().uuidString.lowercased(); event["client_mutation_id"] = key; raw["current"] = event; raw["events"] = [event]
        let hidden = try decode(TeamOutcomePage.self,raw), receipt = try XCTUnwrap(hidden.current)
        var visibleEvent = event; visibleEvent.removeValue(forKey:"retention"); visibleEvent["result"] = "acknowledged private explanation"
        let original = try decode(TeamOutcomeEvent.self,visibleEvent)
        let identity = MemberApprovalIdentity(accountID:receipt.actor_account_id,sessionID:"hidden-test")
        for uncertain in [false,true] {
            var disk = TeamOutcomeDraft(accountID:identity.accountID,requestID:receipt.request_id,revision:receipt.revision-1)
            disk.key=key;disk.target=receipt.target;disk.action=receipt.action;disk.result="acknowledged private explanation";disk.phase=uncertain ? .uncertain:.received;disk.receipt=uncertain ? nil:original
            var sends=0
            let c=TeamOutcomeController(requestID:receipt.request_id,identity:{identity},fetch:{_,_ in hidden},deliveries:{_ in throw URLError(.notConnectedToInternet)},send:{_,_ in sends+=1;throw URLError(.timedOut)},load:{_ in disk},save:{_ in throw CocoaError(.fileWriteOutOfSpace)},changed:{_ in})
            await c.open()
            XCTAssertEqual(c.view.draft?.key,key);XCTAssertEqual(sends,0)
            if uncertain { XCTAssertEqual(c.view.draft?.result,disk.result);XCTAssertEqual(c.view.draft?.phase,.uncertain);XCTAssertTrue(c.view.storageReady) }
            else { XCTAssertEqual(c.view.draft?.result,"");XCTAssertFalse(c.view.storageReady);XCTAssertEqual(c.view.draft?.receipt?.id,receipt.id);XCTAssertEqual(disk.result,"acknowledged private explanation") }
        }
    }
    func testHiddenSecondPageDiscardsPriorTextAndPreservesUnsentComment() throws {
        var raw=try fixture("detail"), visible=raw
        let hidden=try decode(TeamRequestDetail.self,raw), row=try XCTUnwrap(hidden.comments.first)
        var request=visible["request"] as! [String:Any];request.removeValue(forKey:"retention");request["body"]="old request"
        var comment=(visible["comments"] as! [[String:Any]])[0];comment.removeValue(forKey:"retention");comment["body"]="old acknowledged comment"
        visible.removeValue(forKey:"retention");visible["request"]=request;visible["comments"]=[comment]
        var history=TeamCommentHistory();XCTAssertTrue(try history.accept(decode(TeamRequestDetail.self,visible),more:false))
        var draft=try decode(TeamCommentDraft.self,["accountID":row.account_id,"requestID":row.request_id,"key":row.client_comment_id,"body":"","phase":"draft"]);draft.body="old acknowledged comment";draft.phase = .received;draft.receipt=row.id
        raw["comments"]=[]
        XCTAssertFalse(try history.accept(decode(TeamRequestDetail.self,raw),more:true));XCTAssertTrue(history.comments.isEmpty);XCTAssertFalse(history.canDisplay(draft))
        XCTAssertThrowsError(try history.accept(decode(TeamRequestDetail.self,visible),more:false));XCTAssertTrue(history.comments.isEmpty);XCTAssertFalse(history.canDisplay(draft))
        XCTAssertTrue(try history.accept(hidden,more:false));XCTAssertTrue(draft.observeTombstone(hidden));XCTAssertEqual(draft.body,"");XCTAssertEqual(draft.receipt,row.id)
        // Simulate failed disk scrub and an offline restart: a new history has no authority to show the old acknowledged words.
        var oldDisk=draft;oldDisk.body="old acknowledged comment";var restarted=TeamCommentHistory()
        XCTAssertFalse(restarted.canDisplay(oldDisk));restarted.clear();XCTAssertFalse(restarted.canDisplay(oldDisk))
        XCTAssertTrue(try restarted.accept(decode(TeamRequestDetail.self,visible),more:false));XCTAssertTrue(restarted.canDisplay(oldDisk))
        draft.phase = .uncertain;draft.body="unknown send must survive";XCTAssertFalse(draft.observeTombstone(hidden));XCTAssertTrue(history.canDisplay(draft));XCTAssertEqual(draft.body,"unknown send must survive")
        history.beginRefresh();XCTAssertTrue(try history.accept(decode(TeamRequestDetail.self,visible),more:false));XCTAssertEqual(history.detail?.request.body,"old request")
    }

    @MainActor func testObservationPaginationRejectsStaleUnhiddenRetryButExplicitRefreshCanReopen() async throws {
        let helper=TeamGitHubObservationTests();var initial=helper.object();initial["next_cursor"]=helper.link+":1"
        let first=try helper.page(initial);var hidden=initial
        hidden["current"]=NSNull();hidden["observed_at"]=NSNull();hidden["valid_until"]=NSNull();hidden["fresh"]=false;hidden["events"]=[];hidden["next_cursor"]=NSNull();hidden["retention"]=(try fixture("detail"))["retention"]
        let masked=try helper.page(hidden),account=MemberApprovalIdentity(accountID:"A",sessionID:"S")
        var reads=0
        let c=TeamGitHubObservationController(requestID:helper.request,identity:{account},fetch:{_,_ in reads+=1;return reads==2 ? masked:first},changed:{_ in})
        await c.open();await c.more();XCTAssertEqual(reads,3);XCTAssertNil(c.view.page);XCTAssertTrue(c.view.events.isEmpty)
        await c.open();XCTAssertNotNil(c.view.page?.current,"An explicit fresh read may observe genuine reopening; the automatic retry cannot silently roll back a hidden generation.")
    }

    func testActualPostSweepReceiptsRetainIdentityAndOldPurgeCyclesRemainReadable() throws {
        let resource="service-retention-postsweep-fixtures"
        let raw=try fixture("github_links",resource:resource),request=raw["request_id"] as! String
        let page=try decode(TeamGitHubPage.self,raw);try page.validate(request:request)
        let current=try XCTUnwrap(page.current);XCTAssertNotNil(current.redacted_at);XCTAssertNotNil(current.actor_account_id);XCTAssertTrue(current.retention?.currentCyclePurged==true)
        let workflow=try decode(TeamWorkflowPage.self,fixture("workflow",resource:resource));try workflow.validate(request:request)
        let delivery=try decode(TeamDeliveryPage.self,fixture("deliveries",resource:resource));try delivery.validate(request:request)
        // A historical row keeps its first redaction time when a later cycle advances scope metadata.
        var event=raw["current"] as! [String:Any],retention=event["retention"] as! [String:Any]
        retention["purged_outcome_revision"]=2;retention["hidden_outcome_revision"]=2;retention["content_purged_at"]=(retention["content_purged_at"] as! Double)+1000
        event["retention"]=retention;let key=UUID().uuidString.lowercased();event["client_mutation_id"]=key
        let historical=try decode(TeamGitHubEvent.self,event);try historical.validate(request:request)
        var draft=TeamGitHubDraft(accountID:try XCTUnwrap(historical.actor_account_id),requestID:request,revision:historical.revision-1)
        draft.key=key;draft.issue=String(historical.issue_number);draft.reason="private acknowledged reason";draft.phase = .received
        XCTAssertTrue(draft.observeHidden(historical));XCTAssertEqual(draft.reason,"");XCTAssertEqual(draft.key,key)
        event.removeValue(forKey:"retention");XCTAssertThrowsError(try decode(TeamGitHubEvent.self,event).validate(request:request))
        var mutation=TeamWorkflowDraft(accountID:try XCTUnwrap(workflow.current.actor_account_id),product:"studio",current:workflow.current)
        mutation.expectedRevision=workflow.current.revision-1;mutation.key=try XCTUnwrap(workflow.current.client_mutation_id);mutation.reason="saved reason";mutation.nextAction="saved next";mutation.phase = .received;mutation.receipt=workflow.current.id
        XCTAssertTrue(mutation.observeHidden(workflow.current));XCTAssertEqual(mutation.reason,"");XCTAssertEqual(mutation.nextAction,"")
    }
}
