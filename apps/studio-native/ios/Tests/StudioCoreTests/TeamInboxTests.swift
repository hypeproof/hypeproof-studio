import Foundation
import XCTest
@testable import StudioCore

final class TeamInboxTests: XCTestCase {
    let account = MemberApprovalIdentity(accountID: "A", sessionID: "S1")
    let request = "trq_" + String(repeating: "a", count: 32)
    func access() -> TeamRequestAccess { .init(schema: "hps-team-request-access/1", account_id: "A", notice_version: "test", products: ["studio"]) }
    func preferences(_ rows: [TeamSubscription] = []) -> TeamSubscriptionPage { .init(schema: "hps-team-subscriptions/1", default_enabled: false, subscriptions: rows) }
    func receipt(_ value: TeamSubscriptionMutation) -> TeamSubscription { .init(scope_key: value.scope, product: value.product, request_id: value.requestID, revision: value.expectedRevision + 1, start_after_sequence: 12, enabled: value.enabled, created_at: 1000) }
    func item(_ sequence: Int = 1) -> TeamInboxItem { .init(sequence: sequence, source_revision: 1, product: "studio", request_id: request, kind: "delivery", source_id: "tdl_" + String(repeating: "a", count: 32), label: "build_linked", created_at: 1000, read_at: nil, version: "0.2.0", build: "18.1", availability: "group_available", action: nil, evidence_kind: nil, device_installed: "not_observed", valid_until: 2000) }
    func page(_ rows: [TeamInboxItem] = [], cursor: String? = nil, catchup: Bool = false) -> TeamInboxPage { .init(schema: "hps-team-inbox/1", items: rows, next_cursor: cursor, catchup_pending: catchup, scan_limit: 100) }
    func detail() -> TeamRequestDetail {
        .init(request: .init(id: request, account_id: "A", client_request_id: UUID().uuidString.lowercased(), product: "studio", category: "bug", body: "Test", notice_version: "test", status: "submitted", revision: 1, created_at: 1000, updated_at: 1000), comments: [], next_comments_cursor: nil)
    }
    @MainActor func testExplicitSubscriptionUnknownRecoveryPreservesKeyAndRequestMuteOverridesProduct() async throws {
        var disk: TeamSubscriptionMutation?, rows: [TeamSubscription] = [], sends = 0, sent: TeamSubscriptionMutation?
        func make() -> TeamInboxController {
            TeamInboxController(identity: { self.account }, access: { _ in self.access() }, subscriptions: { _ in self.preferences(rows) }, inbox: { _,_ in self.page() }, mutate: { _,d in
                sends += 1
                XCTAssertEqual(disk?.key, d.key); XCTAssertEqual(disk?.phase, .uncertain)
                if sent == nil { sent = d; throw URLError(.timedOut) }
                if sends == 2 { XCTAssertEqual(d.key, sent?.key) }
                let row = self.receipt(d); rows.removeAll { $0.scope_key == row.scope_key }; rows.append(row); return row
            }, detail: { _,_ in self.detail() }, read: { _,_ in 2000 }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        }
        let c = make(); await c.open(); XCTAssertEqual(sends, 0)
        await c.change(product: "studio", request: nil, enabled: true); XCTAssertEqual(disk?.phase, .uncertain)
        let reopened = make(); await reopened.open(); XCTAssertEqual(sends, 1)
        await reopened.change(product: "studio", request: request, enabled: false); XCTAssertEqual(sends, 1)
        await reopened.recover(); XCTAssertEqual(sends, 2); XCTAssertTrue(reopened.effectiveEnabled(product: "studio", request: request))
        await reopened.change(product: "studio", request: request, enabled: false)
        XCTAssertFalse(reopened.effectiveEnabled(product: "studio", request: request)); XCTAssertTrue(reopened.effectiveEnabled(product: "studio", request: nil))
    }
    @MainActor func testUncommittedRecoveryConflictRequiresFreshExplicitChoiceAndUnknownConflictStaysUncertain() async throws {
        var disk: TeamSubscriptionMutation?, rows: [TeamSubscription] = [], sends: [TeamSubscriptionMutation] = []
        let c = TeamInboxController(identity: { self.account }, access: { _ in self.access() }, subscriptions: { _ in self.preferences(rows) }, inbox: { _,_ in self.page() }, mutate: { _,d in
            sends.append(d)
            switch sends.count {
            case 1: throw URLError(.timedOut) // Transport failed before server commit.
            case 2: throw SyncFailure.http(409, "unknown_conflict")
            case 3: throw SyncFailure.http(409, "team_subscription_conflict")
            default: let row = self.receipt(d); rows = [row]; return row
            }
        }, detail: { _,_ in self.detail() }, read: { _,_ in 2000 }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
        await c.open(); await c.change(product: "studio", request: nil, enabled: true)
        let original = try XCTUnwrap(disk)
        rows = [receipt(.init(accountID: "A", product: "studio", requestID: nil, expectedRevision: 0, enabled: false))]
        await c.recover(); XCTAssertEqual(disk?.phase, .uncertain)
        await c.recover(); XCTAssertEqual(disk?.phase, .conflict); XCTAssertFalse(c.view.subscriptionsCurrent)
        XCTAssertTrue(sends.allSatisfy { $0.key == original.key && $0.expectedRevision == 0 && $0.enabled })
        await c.change(product: "studio", request: nil, enabled: true); XCTAssertEqual(sends.count, 3)
        await c.open(); XCTAssertEqual(sends.count, 3); XCTAssertTrue(c.view.subscriptionsCurrent)
        await c.change(product: "studio", request: nil, enabled: true)
        XCTAssertEqual(sends.count, 4); XCTAssertNotEqual(sends.last?.key, original.key)
        XCTAssertEqual(sends.last?.expectedRevision, 1); XCTAssertEqual(disk?.phase, .received)
    }
    @MainActor func testValidFilteredPagesReachDisplayCapWithoutDiscardingReadItems() async throws {
        var reads = 0
        let c = TeamInboxController(identity: { self.account }, access: { _ in self.access() }, subscriptions: { _ in self.preferences() }, inbox: { _,after in
            reads += 1; let start = Int(after ?? "0")! + 1, count = start <= 480 ? 40 : 50
            return self.page((start..<(start + count)).map { self.item($0) }, cursor: String(start + count - 1))
        }, mutate: { _,d in self.receipt(d) }, detail: { _,_ in self.detail() }, read: { _,_ in 2000 }, load: { _ in nil }, save: { _ in }, changed: { _ in })
        await c.open(); _ = await c.openItem(item())
        for _ in 0..<11 { await c.more() }
        XCTAssertEqual(c.view.items.count, 480)
        await c.more(); XCTAssertEqual(c.view.items.map(\.sequence), Array(1...500))
        XCTAssertEqual(c.view.items.first?.read_at, 2000); XCTAssertTrue(c.view.message.contains("500"))
        let cappedReads = reads; await c.more(); XCTAssertEqual(reads, cappedReads)
    }
    @MainActor func testAccountSwitchWhileMutationReturnsClearsVisibleStateWithoutStaleReceipt() async throws {
        for fail in [false, true] {
            var identity = account, disk: TeamSubscriptionMutation?
            let c = TeamInboxController(identity: { identity }, access: { _ in self.access() }, subscriptions: { _ in self.preferences() }, inbox: { _,_ in self.page() }, mutate: { _,d in
                identity = .init(accountID: "B", sessionID: "S2"); if fail { throw URLError(.timedOut) }; return self.receipt(d)
            }, detail: { _,_ in self.detail() }, read: { _,_ in 2000 }, load: { _ in disk }, save: { disk = $0 }, changed: { _ in })
            await c.open(); await c.change(product: "studio", request: nil, enabled: true)
            XCTAssertTrue(c.view.products.isEmpty); XCTAssertNil(c.view.pending); XCTAssertEqual(disk?.phase, .uncertain)
        }
    }
    @MainActor func testReadRequiresCurrentDetailAndAcknowledgementBeforeNavigation() async throws {
        var deny = true, acknowledgements = 0
        let c = TeamInboxController(identity: { self.account }, access: { _ in self.access() }, subscriptions: { _ in self.preferences() }, inbox: { _,_ in self.page([self.item()]) }, mutate: { _,d in self.receipt(d) }, detail: { _,_ in if deny { throw SyncFailure.http(403, "denied") }; return self.detail() }, read: { _,_ in acknowledgements += 1; return 2000 }, load: { _ in nil }, save: { _ in }, changed: { _ in })
        await c.open(); let denied = await c.openItem(item()); XCTAssertNil(denied); XCTAssertEqual(acknowledgements, 0); XCTAssertNil(c.view.items.first?.read_at)
        deny = false; let destination = await c.openItem(item()); XCTAssertEqual(destination, request); XCTAssertEqual(acknowledgements, 1); XCTAssertEqual(c.view.items.first?.read_at, 2000)
    }
    func testInboxRejectsDuplicateOrBackwardPagesAndExpiresAvailabilityWithoutReload() throws {
        XCTAssertThrowsError(try page([item(), item()]).validate(after: nil))
        XCTAssertThrowsError(try page([item()]).validate(after: "2"))
        XCTAssertThrowsError(try page([item(3)], cursor: "2").validate(after: nil))
        XCTAssertTrue(item().groupAvailable(at: Date(timeIntervalSince1970: 1)))
        XCTAssertFalse(item().groupAvailable(at: Date(timeIntervalSince1970: 2)))
        var invalid = try JSONSerialization.jsonObject(with: JSONEncoder().encode(item())) as! [String: Any]
        invalid["source_revision"] = 9_007_199_254_740_992 as Int
        let malformed = try JSONDecoder().decode(TeamInboxItem.self, from: JSONSerialization.data(withJSONObject: invalid))
        XCTAssertThrowsError(try malformed.validate())
        invalid = ["sequence":1, "source_revision":2, "product":"studio", "request_id":request, "source_id":request,
                   "kind":"request_question", "label":"question_posted", "intent":"question", "created_at":1000]
        let question = try JSONDecoder().decode(TeamInboxItem.self, from: JSONSerialization.data(withJSONObject: invalid))
        XCTAssertThrowsError(try question.validate())
    }
    @MainActor func testLegacyRegistrationSurvivesMissingCapabilityButTransientDiscoveryNeverFallsThrough() async throws {
        for transient in [false, true] {
            var calls = 0, teamCalls = 0
            var preference = AccountPushPreference(); preference.accountID = "A"; preference.sessionID = "S1"; preference.enabled = true
            let controller = AccountPushController(identity: { self.account }, load: { preference }, save: { preference = $0 }, call: { _,_,_,_ in calls += 1 }, changed: { _ in }, teamCapabilities: { _ in if transient { throw URLError(.timedOut) }; return try TeamPushCapabilities.supported(nil) }, registerTeam: { _,_,_,_ in teamCalls += 1 })
            await controller.register(String(repeating: "a", count: 64))
            XCTAssertEqual(calls, transient ? 0 : 1); XCTAssertEqual(teamCalls, 0); XCTAssertTrue(controller.enabled)
        }
    }
    func testTeamPushDestinationMustMatchAuthenticatedEnvelopeAndDiscoveryIsConservative() throws {
        let envelope: [String:Any] = ["schema":"hps-push/1", "delivery_id":UUID().uuidString.lowercased(), "kind":"team_request", "id":request, "revision":12]
        let reference = try AccountPushReference(envelope)
        let response: [String:Any] = ["recorded":true, "evidence_kind":"client_observed", "destination":["kind":"team_request", "request_id":request, "event_sequence":12]]
        XCTAssertEqual(try TeamPushDestination(response, reference: reference).requestID, request)
        for change in ["request_id", "event_sequence"] {
            var altered = response, destination = response["destination"] as! [String:Any]
            destination[change] = change == "request_id" ? "trq_" + String(repeating: "b", count: 32) : 13
            altered["destination"] = destination
            XCTAssertThrowsError(try TeamPushDestination(altered, reference: reference))
        }
        XCTAssertEqual(try TeamPushCapabilities.supported(["team_request/1", "team_discussion/1"]), ["team_request/1", "team_discussion/1"])
        XCTAssertThrowsError(try TeamPushCapabilities.supported(["team_discussion/1"]))
        XCTAssertEqual(try TeamPushCapabilities.supported(["future/1"]), [])
        XCTAssertEqual(try TeamPushCapabilities.supported(["team_request/1", "team_discussion/1", "future/1"]), ["team_request/1", "team_discussion/1"])
        XCTAssertThrowsError(try TeamPushCapabilities.supported(["team_request/1", "team_request/1"]))
    }

    @MainActor func testTypedPushResultsStayAtomicAndLateAccountCallbacksAreDiscarded() async throws {
        func reference(_ id: String, _ sequence: Int) throws -> AccountPushReference {
            try AccountPushReference(["schema":"hps-push/1", "delivery_id":UUID().uuidString.lowercased(), "kind":"team_request", "id":id, "revision":sequence])
        }
        func destination(_ reference: AccountPushReference) throws -> TeamPushDestination {
            try TeamPushDestination(["recorded":true, "evidence_kind":"client_observed", "destination":["kind":"team_request", "request_id":reference.id, "event_sequence":reference.revision]], reference: reference)
        }
        var identity = account, preference = AccountPushPreference(), switchAccount = false, fail = false
        preference.enabled = true; preference.accountID = "A"; preference.sessionID = "S1"
        let c = AccountPushController(identity: { identity }, load: { preference }, save: { preference = $0 }, call: { _,_,_,_ in XCTFail("Team open must use authenticated typed destination") }, changed: { _ in }, openTeam: { _,_,reference in
            if switchAccount { identity = .init(accountID: "B", sessionID: "S2") }
            if fail { throw URLError(.timedOut) }; return try destination(reference)
        })
        let firstRef = try reference(request, 12), secondRef = try reference("trq_" + String(repeating:"b",count:32), 13)
        let first = await c.openDestination(firstRef), second = await c.openDestination(secondRef)
        XCTAssertEqual(first?.team?.requestID, request); XCTAssertEqual(second?.team?.requestID, secondRef.id)
        for fails in [false, true] {
            identity = account; switchAccount = true; fail = fails; c.invalidate()
            let oldStatus = c.view.status, result = await c.openDestination(firstRef)
            XCTAssertNil(result); XCTAssertEqual(c.view.status, oldStatus)
        }
    }

}
