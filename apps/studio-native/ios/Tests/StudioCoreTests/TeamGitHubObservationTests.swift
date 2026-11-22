import Foundation
import XCTest
@testable import StudioCore
final class TeamGitHubObservationTests: XCTestCase {
    let request = "trq_" + String(repeating:"a",count:32), link = "tgl_" + String(repeating:"b",count:32)
    func object(_ revision: Int = 1) -> [String:Any] {
        let metadata: [String:Any] = ["schema":"hps-team-github-observation/1","repo":"hypeproof/hypeproof-studio","issue":["number":42,"state":"open"],"historical":NSNull(),"pull":NSNull(),"ci":NSNull(),"testflight":"not_observed","reporter_confirmation":"not_observed"]
        return ["schema":"hps-team-github-observations/1","request_id":request,"association_id":link,"association_revision":1,"current":metadata,"observed_at":1000,"valid_until":1801000,"fresh":true,"last_checked_at":1000,"last_error":NSNull(),"events":[["revision":revision,"observed_at":1000,"metadata":metadata]],"next_cursor":NSNull()]
    }
    func page(_ object: [String:Any]) throws -> TeamGitHubObservationPage { try JSONDecoder().decode(TeamGitHubObservationPage.self,from:JSONSerialization.data(withJSONObject:object)) }
    func testFreshnessAndProviderFailureRemainSeparateFromHistoricalEvidence() throws {
        let p=try page(object());try p.validate(request:request,after:nil)
        XCTAssertFalse(p.isFresh(at:999));XCTAssertTrue(p.isFresh(at:1000));XCTAssertFalse(p.isFresh(at:1801000))
        var old=object();old["fresh"]=false;old["valid_until"]=NSNull();old["last_error"]="provider_timeout"
        let failed=try page(old);try failed.validate(request:request,after:nil);XCTAssertFalse(failed.isFresh(at:1100));XCTAssertEqual(failed.current?.issue.number,42)
        for key in ["request_id","association_id","valid_until","last_error"] {
            var bad=object();bad[key] = key == "valid_until" ? 1801001 : "invalid"
            XCTAssertThrowsError(try page(bad).validate(request:request,after:nil))
        }
    }
    func testRecordedRunLineageRejectsClaimsForDifferentSource() throws {
        var o=object(),m=o["current"] as! [String:Any];let a=String(repeating:"a",count:40),b=String(repeating:"b",count:40)
        m["historical"]=["source_sha":a,"run_id":99,"attempt":1]
        m["pull"]=["number":43,"state":"open","merged":false,"head_sha":b,"merge_sha":NSNull(),"source_matches_historical":false]
        var ci:[String:Any] = ["run_id":99,"attempt":2,"source_sha":a,"status":"completed","conclusion":"success","source_matches_historical":true,"source_matches_current_pull":false]
        m["ci"]=ci;o["current"]=m;o["events"]=[];try page(o).validate(request:request,after:nil)
        ci["source_matches_current_pull"]=true;m["ci"]=ci;o["current"]=m;XCTAssertThrowsError(try page(o).validate(request:request,after:nil))
        ci["source_matches_current_pull"]=false;ci["run_id"]=100;m["ci"]=ci;o["current"]=m;XCTAssertThrowsError(try page(o).validate(request:request,after:nil))
    }
    @MainActor func testChangedAssociationDiscardsOldPagesBeforeReloadAndFailureClears() async throws {
        var first=object();first["next_cursor"]=link+":1";let p1=try page(first)
        var next=object();next["association_id"]="tgl_"+String(repeating:"c",count:32);next["association_revision"]=2;let p2=try page(next)
        let account=MemberApprovalIdentity(accountID:"a",sessionID:"s");var calls:[String?]=[],fail=false,cleared=false
        let c=TeamGitHubObservationController(requestID:request,identity:{account},fetch:{_,after in
            calls.append(after);if fail { throw SyncFailure.http(503,"unavailable") }
            if calls.count == 2 { throw SyncFailure.http(409,"team_github_observation_cursor_changed") }
            return calls.count == 1 ? p1:p2
        },changed:{ if calls.count == 2 && $0.events.isEmpty {cleared=true} })
        await c.open();await c.more();XCTAssertEqual(calls.count,3);XCTAssertNil(calls[2]);XCTAssertTrue(cleared);XCTAssertEqual(c.view.page?.association_revision,2);XCTAssertEqual(c.view.events.count,1)
        fail=true;await c.open();XCTAssertNil(c.view.page);XCTAssertTrue(c.view.events.isEmpty);XCTAssertFalse(c.view.message.isEmpty)
    }
    @MainActor func testAccountSwitchCannotMergeCursorOrLateResponseAndRegistrySurvivesReopen() async throws {
        var o=object();o["next_cursor"]=link+":1";let p=try page(o)
        let a=MemberApprovalIdentity(accountID:"a",sessionID:"s1"),b=MemberApprovalIdentity(accountID:"b",sessionID:"s2")
        var identity=a,afterValues:[String?]=[],switchDuringFetch=false
        let c=TeamGitHubObservationController(requestID:request,identity:{identity},fetch:{_,after in afterValues.append(after);if switchDuringFetch {identity=a};return p},changed:{_ in})
        let registry=TeamGitHubObservationControllers();registry.register(c)
        await c.open();identity=b;await c.more();XCTAssertNil(afterValues.last!);XCTAssertEqual(c.view.events.count,1)
        switchDuringFetch=true;await c.open();XCTAssertNil(c.view.page)
        switchDuringFetch=false;await c.open();registry.invalidate();XCTAssertNil(c.view.page)
        await c.open();XCTAssertNotNil(c.view.page);registry.invalidate();XCTAssertNil(c.view.page)
    }
}
