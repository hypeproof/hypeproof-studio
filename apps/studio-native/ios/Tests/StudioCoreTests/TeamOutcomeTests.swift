import Foundation
import XCTest
@testable import StudioCore

final class TeamOutcomeTests: XCTestCase {
    let request = "trq_" + String(repeating: "a", count: 32)
    let account = MemberApprovalIdentity(accountID: "A", sessionID: "S1")
    func delivery() throws -> TeamDeliveryPage {
        let value = TeamDeliveryTests().object()
        return try JSONDecoder().decode(TeamDeliveryPage.self, from: JSONSerialization.data(withJSONObject: value))
    }
    func page(_ events: [TeamOutcomeEvent] = [], allowed: Bool = true, purgeImplemented: Bool = false) throws -> TeamOutcomePage {
        let rows = try JSONSerialization.jsonObject(with: JSONEncoder().encode(events))
        let current = try events.last.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) }
        return try JSONDecoder().decode(TeamOutcomePage.self, from: JSONSerialization.data(withJSONObject: ["schema":"hps-team-outcomes/1","request_id":request,"can_respond":allowed,"current":current ?? NSNull(),"events":rows,"next_cursor":NSNull(),"retention":["policy":"90_days_after_reporter_confirmation","purge_eligible_at":events.last?.purge_eligible_at as Any? ?? NSNull(),"purge_implemented":purgeImplemented]]))
    }
    func receipt(_ draft: TeamOutcomeDraft) throws -> TeamOutcomeEvent {
        let target = try XCTUnwrap(draft.target), now = 2_000_000.0
        return TeamOutcomeEvent(id: "tor_" + String(repeating: "a", count: 32), request_id: request, actor_account_id: draft.accountID, client_mutation_id: draft.key, delivery_id: target.deliveryID, version: target.version, build: target.build, action: draft.action, revision: draft.expectedRevision + 1, delivery_revision: target.revision, result: draft.resultValue, created_at: now, resolved_at: draft.action == "resolved" ? now : nil, purge_eligible_at: draft.action == "resolved" ? now + 90 * 86_400_000 : nil, evidence_kind: "reporter_self_reported", device_installed: "not_observed", tester_eligibility: "not_observed")
    }
    @MainActor func testExplicitResolutionPersistsUncertainBeforeSendAndBindsExactBuild() async throws {
        let page = try page(), delivery = try delivery(); var disk: TeamOutcomeDraft?, sends = 0
        let controller = TeamOutcomeController(requestID: request, identity: { self.account }, fetch: { _,_ in page }, deliveries: { _ in delivery }, send: { _,draft in
            sends += 1; XCTAssertEqual(disk?.phase, .uncertain); XCTAssertEqual(disk?.key, draft.key); XCTAssertEqual(draft.target?.build,"18.1")
            return try self.receipt(draft)
        }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await controller.open(); controller.edit(action:"resolved"); XCTAssertEqual(sends,0)
        XCTAssertNil(controller.view.draft?.resultValue)
        await controller.submit(); XCTAssertEqual(sends,1); XCTAssertEqual(disk?.phase,.received)
        XCTAssertEqual(disk?.receipt?.device_installed,"not_observed"); XCTAssertEqual(disk?.receipt?.resolved_at,2_000_000)
        await controller.submit(); XCTAssertEqual(sends,1)
        XCTAssertNil(controller.view.page?.current,"A receipt is not a refreshed current-history snapshot.")
    }
    @MainActor func testExpiredDeliveryStillPermitsReporterResponseAndReopenRequiresWords() async throws {
        let delivery = try delivery(), page = try page(); var disk: TeamOutcomeDraft?, sends = 0
        XCTAssertFalse(try XCTUnwrap(delivery.current?.evidence).groupAvailable(at: Date()))
        let c=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in sends+=1;return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
        await c.open();c.edit(action:"reopened");XCTAssertThrowsError(try XCTUnwrap(c.view.draft).payload());XCTAssertEqual(sends,0)
        c.edit(result:"아직 같은 오류가 보여요");await c.submit();XCTAssertEqual(sends,1);XCTAssertNil(disk?.receipt?.resolved_at);XCTAssertNil(disk?.receipt?.purge_eligible_at)
        let prior=try XCTUnwrap(disk?.receipt), priorPage=try self.page([prior]);disk=nil
        let old=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in priorPage},deliveries:{_ in throw SyncFailure.http(503,"team_deliveries_unavailable")},send:{_,d in sends+=1;return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
        await old.open();old.edit(action:"reopened",result:"이 버전의 문제가 여전히 남았어요");XCTAssertEqual(old.view.draft?.target,prior.target);await old.submit();XCTAssertEqual(sends,2)
    }
    @MainActor func testUnknownRestartDoesNotSendOrRebaseAndExplicitRecoveryKeepsPayload() async throws {
        let delivery=try delivery(); var page=try page(),disk:TeamOutcomeDraft?,sends=0;var sent:TeamOutcomeDraft?
        func make() -> TeamOutcomeController {
            TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in sends+=1;if sent == nil {sent=d;throw URLError(.timedOut)};XCTAssertEqual(d.key,sent?.key);XCTAssertEqual(d.expectedRevision,sent?.expectedRevision);XCTAssertEqual(d.target,sent?.target);return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
        }
        let first=make();await first.open();first.edit(action:"resolved",result:"직접 확인했어요");await first.submit();XCTAssertEqual(disk?.phase,.uncertain)
        let original=try receipt(XCTUnwrap(sent));var newer=try XCTUnwrap(sent);newer.key=UUID().uuidString.lowercased();newer.expectedRevision=1;newer.action="reopened";newer.result="다시 발생했어요"
        let newerReceipt=try receipt(newer)
        page=try self.page([newerReceipt]);let second=make();await second.open();XCTAssertEqual(sends,1);XCTAssertEqual(disk?.phase,.uncertain)
        second.edit(action:"reopened",result:"변경 금지");XCTAssertEqual(second.view.draft?.result,"직접 확인했어요")
        await second.submit();XCTAssertEqual(sends,2);XCTAssertEqual(disk?.phase,.received)
        XCTAssertEqual(disk?.receipt,original);XCTAssertEqual(second.view.page?.current?.revision,2)
    }
    @MainActor func testLateAccountRepliesCannotPersistReceiptOrExposeOldResult() async throws {
        let delivery=try delivery(),page=try page()
        for fails in [false,true] {
            var identity=account,disk:TeamOutcomeDraft?
            let c=TeamOutcomeController(requestID:request,identity:{identity},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in identity=MemberApprovalIdentity(accountID:"B",sessionID:"S2");if fails {throw URLError(.timedOut)};return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
            await c.open();c.edit(action:"resolved");await c.submit()
            XCTAssertNil(c.view.page);XCTAssertNil(c.view.draft);XCTAssertTrue(c.view.message.isEmpty);XCTAssertEqual(disk?.phase,.uncertain)
        }
    }
    @MainActor func testStorageFailurePreservesExportAndPreventsPost() async throws {
        let delivery=try delivery(),page=try page();var disk:TeamOutcomeDraft?,fail=false,sends=0
        let c=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in sends+=1;return try self.receipt(d)},load:{_ in disk},save:{if fail {throw CocoaError(.fileWriteOutOfSpace)};disk=$0},changed:{_ in})
        await c.open();c.edit(action:"reopened");fail=true;c.edit(result:"보존할 문제 설명")
        XCTAssertFalse(c.view.storageReady);XCTAssertTrue(try XCTUnwrap(c.view.draft).exportText.contains("보존할 문제 설명"));await c.submit();XCTAssertEqual(sends,0)
    }
    @MainActor func testReadonlyAndConflictDoNotCreateUnauthorizedOrAutomaticWrites() async throws {
        let delivery=try delivery(),readonly=try page(allowed:false),allowed=try page();var disk:TeamOutcomeDraft?,sends=0
        let r=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in readonly},deliveries:{_ in delivery},send:{_,d in sends+=1;return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
        await r.open();r.edit(action:"resolved");await r.submit();XCTAssertNil(r.view.draft);XCTAssertEqual(sends,0)
        let c=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in allowed},deliveries:{_ in delivery},send:{_,_ in sends+=1;throw SyncFailure.http(409,"team_outcome_conflict")},load:{_ in disk},save:{disk=$0},changed:{_ in})
        await c.open();c.edit(action:"resolved");let key=try XCTUnwrap(disk?.key);await c.submit();XCTAssertEqual(disk?.phase,.conflict);XCTAssertNil(c.view.page)
        c.rebase();XCTAssertEqual(disk?.key,key);await c.open();c.rebase();XCTAssertNotEqual(disk?.key,key);XCTAssertEqual(sends,1)
    }
    @MainActor func testNextResponseRequiresFreshHistoryAndRetentionActivationDoesNotBreakRead() async throws {
        let delivery=try delivery();var page=try page(purgeImplemented:true),disk:TeamOutcomeDraft?,sends=0
        try page.validate(request:request)
        let c=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in sends+=1;return try self.receipt(d)},load:{_ in disk},save:{disk=$0},changed:{_ in})
        await c.open();c.edit(action:"resolved");await c.submit();let key=try XCTUnwrap(disk?.key)
        c.newResponse();XCTAssertEqual(disk?.key,key);XCTAssertEqual(disk?.phase,.received);XCTAssertEqual(sends,1)
        page=try self.page([XCTUnwrap(disk?.receipt)],purgeImplemented:true);await c.open();c.newResponse()
        XCTAssertEqual(disk?.expectedRevision,1);c.edit(action:"reopened",result:"새로 확인한 문제예요");await c.submit()
        XCTAssertEqual(sends,2);XCTAssertEqual(disk?.receipt?.revision,2);XCTAssertNil(disk?.receipt?.purge_eligible_at)
    }

    @MainActor func testForeignReceiptOrInflatedInstallClaimNeverMarksOutcomeReceived() async throws {
        let delivery=try delivery(),page=try page()
        for field in ["build","request_id","device_installed","purge_eligible_at"] {
            var disk:TeamOutcomeDraft?
            let c=TeamOutcomeController(requestID:request,identity:{self.account},fetch:{_,_ in page},deliveries:{_ in delivery},send:{_,d in
                var value=try JSONSerialization.jsonObject(with:JSONEncoder().encode(self.receipt(d))) as! [String:Any]
                switch field { case "build":value[field]="99.1";case "request_id":value[field]="trq_"+String(repeating:"b",count:32);case "device_installed":value[field]="verified";default:value[field]=1 }
                return try JSONDecoder().decode(TeamOutcomeEvent.self,from:JSONSerialization.data(withJSONObject:value))
            },load:{_ in disk},save:{disk=$0},changed:{_ in})
            await c.open();c.edit(action:"resolved");await c.submit();XCTAssertEqual(disk?.phase,.uncertain,field);XCTAssertNil(disk?.receipt,field)
        }
    }

    @MainActor func testReopenDefaultsToLatestAndExplicitPriorChoiceSurvivesRefreshButNotUncertainEdit() async throws {
        let delivery = try delivery()
        var priorDraft = TeamOutcomeDraft(accountID: account.accountID, requestID: request, revision: 0)
        priorDraft.target = TeamOutcomeBuild(deliveryID: "tdl_" + String(repeating: "b", count: 32), revision: 1, version: "0.1.0", build: "17.1")
        priorDraft.action = "resolved"
        let prior = try receipt(priorDraft), page = try page([prior])
        var disk: TeamOutcomeDraft?, sent: TeamOutcomeDraft?
        let c = TeamOutcomeController(requestID: request, identity: { self.account }, fetch: { _,_ in page }, deliveries: { _ in delivery }, send: { _,draft in sent = draft; throw URLError(.timedOut) }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await c.open(); c.edit(action: "reopened", result: "이 버전에 문제가 남았어요")
        XCTAssertEqual(c.view.draft?.target?.build, "18.1")
        XCTAssertEqual(c.eligibleTargets(for: "reopened").count, 2)
        c.chooseBuild(prior.target); await c.open()
        XCTAssertEqual(c.view.draft?.phase, .draft); XCTAssertEqual(c.view.draft?.target, prior.target)
        c.edit(action: "resolved"); XCTAssertEqual(c.view.draft?.target?.build, "18.1")
        c.chooseBuild(prior.target); XCTAssertEqual(c.view.draft?.target?.build, "18.1")
        c.edit(action: "reopened"); await c.submit()
        XCTAssertEqual(sent?.target?.build, "18.1"); XCTAssertEqual(disk?.phase, .uncertain)
        c.chooseBuild(prior.target); await c.open()
        XCTAssertEqual(disk?.key, sent?.key); XCTAssertEqual(disk?.target, sent?.target)
    }

    @MainActor func testReceiptRefreshUpdatesCurrentAndAllowsImmediateNextResponse() async throws {
        let delivery = try delivery(); var page = try page(), disk: TeamOutcomeDraft?, sends = 0
        let c = TeamOutcomeController(requestID: request, identity: { self.account }, fetch: { _,_ in page }, deliveries: { _ in delivery }, send: { _,d in sends += 1; let event = try self.receipt(d); page = try self.page([event]); return event }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await c.open(); c.edit(action: "resolved"); await c.submit()
        XCTAssertFalse(c.view.historyNeedsRefresh); XCTAssertEqual(c.view.page?.current?.action, "resolved")
        c.newResponse(); c.edit(action: "reopened", result: "Problem returned"); await c.submit()
        XCTAssertEqual(sends, 2); XCTAssertEqual(c.view.page?.current?.action, "reopened"); XCTAssertEqual(c.view.page?.current?.revision, 2)
    }
    @MainActor func testReceiptRefreshFailureLagAndAccountSwitchPreserveAcknowledgementWithoutClaimingFreshness() async throws {
        let delivery = try delivery(), empty = try page()
        for mode in ["failure", "lag", "account"] {
            var identity = account, disk: TeamOutcomeDraft?, sends = 0
            let c = TeamOutcomeController(requestID: request, identity: { identity }, fetch: { _,_ in
                if sends > 0 {
                    if mode == "failure" { throw URLError(.timedOut) }
                    if mode == "account" { identity = MemberApprovalIdentity(accountID: "B", sessionID: "S2") }
                }
                return empty
            }, deliveries: { _ in delivery }, send: { _,d in sends += 1; return try self.receipt(d) }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
            await c.open(); c.edit(action: "resolved"); await c.submit()
            XCTAssertEqual(sends, 1); XCTAssertEqual(disk?.phase, .received); XCTAssertNotNil(disk?.receipt)
            if mode == "account" { XCTAssertNil(c.view.page); XCTAssertNil(c.view.draft) }
            else { XCTAssertTrue(c.view.historyNeedsRefresh); c.newResponse(); XCTAssertEqual(c.view.draft?.phase, .received) }
        }
    }

}
