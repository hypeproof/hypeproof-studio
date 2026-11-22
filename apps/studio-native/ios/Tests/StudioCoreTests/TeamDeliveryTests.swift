import Foundation
import XCTest
@testable import StudioCore

final class TeamDeliveryTests: XCTestCase {
    let request = "trq_" + String(repeating: "a", count: 32)
    func object() -> [String: Any] {
        let evidence: [String: Any] = ["schema":"hps-team-delivery-evidence/1","repository":"hypeproof/hypeproof-studio","source_sha":String(repeating:"a",count:40),
            "package":["sha256":String(repeating:"b",count:64),"bundle_id":"ai.hypeproof.studio.mobile","version":"0.2.0","build":"18.1","size":1000],
            "observation_run":["id":123,"attempt":1,"workflow_source_sha":String(repeating:"c",count:40)],
            "apple":["app_id":"6832914754","build_id":"build-1","group_id":"group-1","processing":"VALID","internal_state":"IN_BETA_TESTING","expiration_date":"2026-12-01T00:00:00Z","expired":false,"group_contains_build":true],
            "observed_at":1_000_100.0,"observation_started_at":1_000_000.0,"valid_until":1_900_000.0,"group_build_available":true,
            "target_tester_member":"not_observed","target_tester_invitation_accepted":"not_observed","device_installed":"not_observed","reporter_confirmation":"not_observed"]
        let event: [String: Any] = ["id":"tdl_"+String(repeating:"a",count:32),"request_id":request,"github_link_id":"tgl_"+String(repeating:"b",count:32),"revision":1,"instructions":"TestFlight에서 이 버전을 설치한 뒤 요청했던 흐름을 확인해 주세요.","evidence":evidence,"availability":"group_available","reporter_confirmation":"not_observed","created_at":1_000_200.0,"redacted_at":NSNull()]
        return ["schema":"hps-team-deliveries/1","request_id":request,"can_manage":false,"current":event,"events":[event],"next_cursor":NSNull()]
    }
    func decode(_ value: [String: Any]) throws -> TeamDeliveryPage { try JSONDecoder().decode(TeamDeliveryPage.self,from:JSONSerialization.data(withJSONObject:value)) }
    func testFreshGroupObservationExpiresWithoutChangingInstallationOrConfirmation() throws {
        let page = try decode(object()); try page.validate(request:request); let proof = try XCTUnwrap(page.current?.evidence)
        XCTAssertFalse(proof.groupAvailable(at:Date(timeIntervalSince1970:999)))
        XCTAssertTrue(proof.groupAvailable(at:Date(timeIntervalSince1970:1001)))
        XCTAssertFalse(proof.groupAvailable(at:Date(timeIntervalSince1970:1900)))
        XCTAssertEqual(proof.device_installed,"not_observed"); XCTAssertEqual(proof.reporter_confirmation,"not_observed")
        XCTAssertEqual(proof.observationURL.absoluteString,"https://github.com/hypeproof/hypeproof-studio/actions/runs/123/attempts/1")
    }
    func testRejectsForeignRequestRepositoryMalformedExpiryAndInflatedClaims() throws {
        var foreign = object(); foreign["request_id"] = "trq_"+String(repeating:"b",count:32)
        XCTAssertThrowsError(try decode(foreign).validate(request:request))
        for mutation in ["repository","valid_until","device_installed","bundle_id","group_state","expired_date","malformed_date"] {
            var root=object(),event=root["current"] as! [String:Any],evidence=event["evidence"] as! [String:Any]
            switch mutation {
            case "repository": evidence["repository"]="attacker/repo"
            case "valid_until": evidence["valid_until"]=2_000_000.0
            case "device_installed": evidence["device_installed"]="installed"
            case "bundle_id": var package=evidence["package"] as! [String:Any];package["bundle_id"]="other.app";evidence["package"]=package
            case "expired_date", "malformed_date": var apple=evidence["apple"] as! [String:Any];apple["expiration_date"]=mutation == "expired_date" ? "1970-01-01T00:00:01Z":"not-a-date";evidence["apple"]=apple
            default: var apple=evidence["apple"] as! [String:Any];apple["expired"]=true;evidence["apple"]=apple
            }
            event["evidence"]=evidence;root["current"]=event;root["events"]=[event]
            XCTAssertThrowsError(try decode(root).validate(request:request),mutation)
        }
    }
    @MainActor func testLateSuccessAndFailureCannotExposePreviousAccount() async throws {
        let page=try decode(object()), a=MemberApprovalIdentity(accountID:"A",sessionID:"S1"), b=MemberApprovalIdentity(accountID:"B",sessionID:"S2")
        for fails in [false,true] {
            var identity=a
            let controller=TeamDeliveryController(requestID:request,identity:{identity},fetch:{_,_ in identity=b;if fails {throw URLError(.timedOut)};return page},changed:{_ in})
            await controller.open();XCTAssertNil(controller.view.page);XCTAssertTrue(controller.view.events.isEmpty);XCTAssertTrue(controller.view.message.isEmpty)
        }
    }
    @MainActor func testUnavailableEndpointClearsEarlierEvidenceAndAllowsExplicitRetry() async throws {
        let page=try decode(object()),identity=MemberApprovalIdentity(accountID:"A",sessionID:"S1");var fail=false,calls=0
        let controller=TeamDeliveryController(requestID:request,identity:{identity},fetch:{_,_ in calls+=1;if fail {throw SyncFailure.http(503,"team_deliveries_unavailable")};return page},changed:{_ in})
        await controller.open();XCTAssertNotNil(controller.view.page)
        fail=true;await controller.open();XCTAssertNil(controller.view.page);XCTAssertTrue(controller.view.events.isEmpty);XCTAssertFalse(controller.view.message.isEmpty);XCTAssertEqual(calls,2)
        fail=false;await controller.open();XCTAssertNotNil(controller.view.page);XCTAssertEqual(calls,3)
        controller.invalidate();XCTAssertNil(controller.view.page)
    }
    @MainActor func testHistoryRejectsRepeatedCursorPageWithoutRetainingUnverifiedRecords() async throws {
        var first=object(), second=first["current"] as! [String:Any]
        second["id"]="tdl_"+String(repeating:"c",count:32);second["revision"]=2
        first["current"]=second;first["next_cursor"]="1"
        let firstPage=try decode(first),identity=MemberApprovalIdentity(accountID:"A",sessionID:"S1")
        try firstPage.validate(request:request)
        let controller=TeamDeliveryController(requestID:request,identity:{identity},fetch:{_,_ in firstPage},changed:{_ in})
        await controller.open();XCTAssertEqual(controller.view.events.count,1)
        await controller.more();XCTAssertNil(controller.view.page);XCTAssertTrue(controller.view.events.isEmpty)
        var duplicate=object();duplicate["events"]=[duplicate["current"]!,duplicate["current"]!]
        XCTAssertThrowsError(try decode(duplicate).validate(request:request))
    }

    @MainActor func testDestinationReevaluationKeepsVisibleControllerUntilAccountBoundary() async throws {
        let page=try decode(object()),identity=MemberApprovalIdentity(accountID:"A",sessionID:"S1"),controllers=TeamDeliveryControllers()
        func destination() -> TeamDeliveryController {
            let value=TeamDeliveryController(requestID:request,identity:{identity},fetch:{_,_ in page},changed:{_ in})
            controllers.register(value);return value
        }
        let visible=destination();await visible.open()
        let reconstructed=destination();await reconstructed.open()
        XCTAssertNotNil(visible.view.page);XCTAssertNotNil(reconstructed.view.page)
        controllers.invalidate()
        XCTAssertNil(visible.view.page);XCTAssertNil(reconstructed.view.page)
        XCTAssertTrue(visible.view.events.isEmpty);XCTAssertTrue(reconstructed.view.events.isEmpty)
        // A failed logout may retain and reopen this same destination.
        await visible.open();XCTAssertNotNil(visible.view.page)
        controllers.invalidate();XCTAssertNil(visible.view.page);XCTAssertTrue(visible.view.events.isEmpty)
    }

}
