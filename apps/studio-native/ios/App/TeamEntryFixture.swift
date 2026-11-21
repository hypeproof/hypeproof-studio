#if DEBUG
import Foundation

/// Additive team-card transport only; the existing journey retains real app auth/cache/model paths.
@MainActor enum TeamEntryFixture {
    static var enabled: Bool { NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_ENTRY"] == "1" }
    static var service: ConversationService? {
        guard enabled else { return nil }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [TeamEntryTransport.self]
        return ConversationService(session: URLSession(configuration: config), base: URL(string: "https://team-entry.invalid")!)
    }
    static var trace: String { TeamEntryTransport.state.trace() }
    static var inboxEnabled: Bool { enabled && ProcessInfo.processInfo.environment["HP_TEAM_INBOX"] == "1" }
    static var pushEnabled: Bool { inboxEnabled && ProcessInfo.processInfo.environment["HP_TEAM_PUSH"] != nil }
    static var permissionGranted: Bool { ProcessInfo.processInfo.environment["HP_TEAM_PUSH"] != "denied" }
    private static var coldDelivered = false
    private static var contextDelivered = false
    static func deliverContextPush() {
        guard pushEnabled, ProcessInfo.processInfo.environment["HP_TEAM_PUSH_CONTEXT"] == "1", !contextDelivered else { return }
        contextDelivered = true; deliverPush()
    }
    static func deliverColdPush() {
        guard pushEnabled, ProcessInfo.processInfo.environment["HP_TEAM_PUSH"] == "cold", !coldDelivered else { return }
        coldDelivered = true; deliverPush()
    }
    static func deliverPush() {
        guard pushEnabled else { return }
        NativePushCenter.shared.received(["hps":["schema":"hps-push/1", "delivery_id":"11111111-1111-4111-8111-111111111111", "kind":"team_request", "id":"trq_" + String(repeating:"a",count:32), "revision":12]])
    }
    /// `HP_TEAM_SEED_SENT=<body>` starts with one request the synthetic Service
    /// already acknowledged (#4432). UI cases about later steps (discussion,
    /// GitHub, outcome, intake) otherwise all repeat compose → send → receipt.
    /// The seed is only returned when no real draft file exists, so the app's
    /// own load, reconcile and save paths still run. `requestPosts` stays 0.
    nonisolated static let seededRequestKey = "00000000-0000-4000-8000-000000004432"
    nonisolated static var seededBody: String? {
        guard let body = ProcessInfo.processInfo.environment["HP_TEAM_SEED_SENT"], !body.isEmpty else { return nil }
        return body
    }
    static func seededRequest(account: String) -> TeamRequestDraft? {
        guard enabled, let body = seededBody else { return nil }
        var draft = TeamRequestDraft(accountID: account, product: "studio", key: seededRequestKey)
        draft.body = body; draft.noticeVersion = "synthetic/1"; draft.phase = .received
        draft.receipt = "trq_" + String(repeating: "a", count: 32)
        return draft
    }
}
private final class TeamEntryState: @unchecked Sendable {
    private let lock = NSLock()
    private var started = false, granted = false, triggers = 0, reads = 0, shown = 0, answers = 0, events: [String] = []
    // Synthetic native journey adapter. Payload shapes come from the authenticated D1 fixture;
    // only the journey account/request identity is rebound. Core tests retain the byte-exact fixture.
    private static let hiddenRouteJSON = #"""
{"detail":{"request":{"id":"trq_00000000000000000000000000000000","account_id":"acc_00000000000000000000000000000029","client_request_id":"cutoff-request-0","product":"studio","category":"bug","body":"보관 기한이 지나 내용을 숨겼어요.","notice_version":"synthetic/1","status":"submitted","revision":1,"created_at":1795021539015,"updated_at":1795021539015,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_purged_at":null,"purged_outcome_revision":null,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015},"latest_question":null,"comments":[{"id":"tcm_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","account_id":"acc_00000000000000000000000000000029","client_comment_id":"cutoff-comment-0","body":"보관 기한이 지나 내용을 숨겼어요.","created_at":1795021539015,"intent":"discussion","reply_to":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}],"next_comments_cursor":null},"workflow":{"schema":"hps-team-workflow/1","request_id":"trq_00000000000000000000000000000000","can_manage":true,"current":{"id":"twe_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-workflow","revision":1,"status":"discussing","assignee_account_id":null,"priority":"normal","next_action":null,"reason":null,"duplicate_request_id":null,"created_at":1795021539015,"redacted_at":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"events":[{"id":"twe_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-workflow","revision":1,"status":"discussing","assignee_account_id":null,"priority":"normal","next_action":null,"reason":null,"duplicate_request_id":null,"created_at":1795021539015,"redacted_at":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}],"next_cursor":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"github_links":{"schema":"hps-team-github-links/1","request_id":"trq_00000000000000000000000000000000","can_manage":true,"current":{"id":"tgl_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-link-0","revision":1,"repo":"hypeproof/hypeproof-studio","issue_number":1,"reason":null,"verified_at":1795021539015,"redacted_at":null,"evidence":null,"association":"operator_asserted","testflight":"not_observed","reporter_confirmation":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"events":[{"id":"tgl_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-link-0","revision":1,"repo":"hypeproof/hypeproof-studio","issue_number":1,"reason":null,"verified_at":1795021539015,"redacted_at":null,"evidence":null,"association":"operator_asserted","testflight":"not_observed","reporter_confirmation":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}],"next_cursor":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"deliveries":{"schema":"hps-team-deliveries/1","request_id":"trq_00000000000000000000000000000000","can_manage":true,"current":{"id":"tdl_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-delivery-0","revision":1,"github_link_id":"tgl_00000000000000000000000000000000","instructions":null,"created_at":1795021539015,"redacted_at":null,"evidence":null,"availability":"not_established","reporter_confirmation":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"events":[{"id":"tdl_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-delivery-0","revision":1,"github_link_id":"tgl_00000000000000000000000000000000","instructions":null,"created_at":1795021539015,"redacted_at":null,"evidence":null,"availability":"not_established","reporter_confirmation":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}],"next_cursor":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"outcomes":{"schema":"hps-team-outcomes/1","request_id":"trq_00000000000000000000000000000000","can_respond":true,"current":{"id":"tor_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-outcome-0","revision":1,"delivery_id":"tdl_00000000000000000000000000000000","delivery_revision":1,"version":"0.2.0","build":"18.1","action":"resolved","result":"보관 기한이 지나 내용을 숨겼어요.","created_at":1787159139015,"resolved_at":1787159139015,"purge_eligible_at":1794935139015,"evidence_kind":"reporter_self_reported","device_installed":"not_observed","tester_eligibility":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}},"events":[{"id":"tor_00000000000000000000000000000000","request_id":"trq_00000000000000000000000000000000","actor_account_id":"acc_00000000000000000000000000000029","client_mutation_id":"cutoff-outcome-0","revision":1,"delivery_id":"tdl_00000000000000000000000000000000","delivery_revision":1,"version":"0.2.0","build":"18.1","action":"resolved","result":"보관 기한이 지나 내용을 숨겼어요.","created_at":1787159139015,"resolved_at":1787159139015,"purge_eligible_at":1794935139015,"evidence_kind":"reporter_self_reported","device_installed":"not_observed","tester_eligibility":"not_observed","retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}],"next_cursor":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_purged_at":null,"purged_outcome_revision":null,"purge_eligible_at":1794935139015,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015}},"observations":{"schema":"hps-team-github-observations/1","request_id":"trq_00000000000000000000000000000000","association_id":"tgl_00000000000000000000000000000000","association_revision":1,"current":null,"observed_at":null,"valid_until":null,"fresh":false,"last_checked_at":null,"last_error":null,"events":[],"next_cursor":null,"retention":{"policy":"90_days_after_reporter_confirmation","purge_implemented":true,"content_hidden":true,"hidden_outcome_revision":1,"content_hidden_since":1794935139015,"content_purged_at":null,"purged_outcome_revision":null}}}
"""#
    private func hiddenRoute(_ name: String, requestID: String) throws -> [String:Any] {
        let routes = try JSONSerialization.jsonObject(with: Data(Self.hiddenRouteJSON.utf8)) as! [String:Any]
        func bind(_ value: Any) -> Any {
            if let text = value as? String {
                if text == "trq_00000000000000000000000000000000" { return requestID }
                if text.hasPrefix("acc_") { return "journey-account" }
                return text
            }
            if let object = value as? [String:Any] { return object.mapValues(bind) }
            if let array = value as? [Any] { return array.map(bind) }
            return value
        }
        var result = bind(routes[name]!) as! [String:Any]
        if name == "detail", var row = result["request"] as? [String:Any], let key = teamRequest?["client_request_id"] { row["client_request_id"] = key; result["request"] = row }
        return result
    }
    private var teamRequest: [String: Any]? = TeamEntryFixture.seededBody.map { body in
        ["id": "trq_" + String(repeating: "a", count: 32), "account_id": "journey-account", "client_request_id": TeamEntryFixture.seededRequestKey,
         "product": "studio", "category": "bug", "body": body, "notice_version": "synthetic/1", "status": "submitted",
         "revision": 1, "created_at": 1000, "updated_at": 1000]
    }
    private var teamComments: [[String: Any]] = []
    private var requestPosts = 0, commentPosts = 0
    private var relationEvents:[[String:Any]] = [], relationPosts = 0
    private var textEvents: [String:[[String:Any]]] = [:], textPosts = 0
    private var textKeys: [String] = []
    private var githubObservationReads = 0
    private var githubEvents: [[String: Any]] = [], githubPosts = 0
    private var outcomeEvents: [[String: Any]] = [], outcomePosts = 0
    private var workflowEvents: [[String: Any]] = []
    private var subscriptionRows: [[String:Any]] = [], subscriptionReceipts: [String:[String:Any]] = [:]
    private var subscriptionPosts = 0, inboxReads = 0, readAcks = 0, pushOpens = 0
    private var notificationReadAt: Double?
    private var acceptedCapabilities: [String] = []
    func trace() -> String {
        lock.lock(); defer { lock.unlock() }
        return String(data: (try? JSONSerialization.data(withJSONObject: ["triggers": triggers, "reads": reads, "shown": shown, "answers": answers, "events": events, "granted": granted, "textPosts":textPosts,"textKeys":textKeys,"requestPosts": requestPosts, "commentPosts": commentPosts, "relationPosts":relationPosts,"relationEvents":relationEvents.count,"githubPosts": githubPosts, "githubEvents": githubEvents.count, "outcomePosts": outcomePosts, "outcomeEvents": outcomeEvents.count, "subscriptionPosts":subscriptionPosts, "inboxReads":inboxReads, "readAcks":readAcks, "pushOpens":pushOpens, "capabilities":acceptedCapabilities], options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
    }
    func response(_ request: URLRequest, _ body: [String: Any]) throws -> (Int, [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true, request.value(forHTTPHeaderField: "Origin") == nil else { return (401, ["error": "unauthorized"]) }
        if ProcessInfo.processInfo.environment["HP_TEAM_INBOX"] == "1" {
            let id = "trq_" + String(repeating:"a",count:32), path = request.url?.path ?? ""
            if teamRequest == nil { teamRequest = ["id":id,"account_id":"journey-account","client_request_id":UUID().uuidString.lowercased(),"product":"studio","category":"bug","body":"알림에서 확인한 요청이에요.","notice_version":"synthetic/1","status":"submitted","revision":1,"created_at":1000,"updated_at":1000] }
            if path.hasPrefix("/v1/me/push-devices/") {
                let installation = String(path.split(separator:"/")[3])
                if request.httpMethod == "PUT" { acceptedCapabilities = body["capabilities"] as? [String] ?? []; return (200,["schema":"hps-push-device/1","id":installation,"active":true,"generation":1,"capabilities":acceptedCapabilities]) }
                if request.httpMethod == "POST" {
                    pushOpens += 1
                    let destination = ProcessInfo.processInfo.environment["HP_TEAM_PUSH_FOREIGN"] == "1" ? "trq_" + String(repeating:"b",count:32) : id
                    return (200,["recorded":true,"evidence_kind":"client_observed","destination":["kind":"team_request","request_id":destination,"event_sequence":12]])
                }
            }
            if path == "/v1/me/team-requests/subscriptions" {
                if request.httpMethod == "POST" {
                    subscriptionPosts += 1
                    guard let key = body["client_mutation_id"] as? String, let product = body["product"] as? String, let revision = body["expected_revision"] as? Int, let enabled = body["enabled"] as? Bool else { return (400,["error":"invalid_team_subscription"]) }
                    if let old = subscriptionReceipts[key] { return (200,["subscription":old,"already":true]) }
                    let requestID = body["request_id"] as? String, scope = requestID.map { "r:" + $0 } ?? "p:" + product
                    guard revision == (subscriptionRows.first { $0["scope_key"] as? String == scope }?["revision"] as? Int ?? 0) else { return (409,["error":"team_subscription_conflict"]) }
                    let row: [String:Any] = ["scope_key":scope,"product":product,"request_id":requestID as Any? ?? NSNull(),"revision":revision+1,"enabled":enabled,"start_after_sequence":10,"created_at":1000]
                    subscriptionRows.removeAll { $0["scope_key"] as? String == scope }; subscriptionRows.append(row); subscriptionReceipts[key] = row
                    if ProcessInfo.processInfo.environment["HP_TEAM_SUBSCRIPTION_UNKNOWN"] == "1", subscriptionPosts == 1 { return (503,["error":"synthetic_unknown"]) }
                    return (200,["subscription":row,"already":false])
                }
                return (200,["schema":"hps-team-subscriptions/1","default_enabled":false,"subscriptions":subscriptionRows])
            }
            if path == "/v1/me/team-requests/notifications" {
                inboxReads += 1
                let enabled = subscriptionRows.first { $0["scope_key"] as? String == "r:" + id }?["enabled"] as? Bool ?? subscriptionRows.first { $0["scope_key"] as? String == "p:studio" }?["enabled"] as? Bool ?? false
                let item: [String:Any] = ["sequence":12,"product":"studio","request_id":id,"kind":"delivery","source_id":"tdl_" + String(repeating:"c",count:32),"source_revision":1,"created_at":1001,"read_at":notificationReadAt as Any? ?? NSNull(),"label":"build_linked","version":"0.2.0","build":"18.1","valid_until":Date().timeIntervalSince1970*1000+900000,"availability":"group_available","device_installed":"not_observed"]
                return (200,["schema":"hps-team-inbox/1","items":enabled ? [item] : [],"next_cursor":NSNull(),"catchup_pending":false,"scan_limit":100])
            }
            if path == "/v1/me/team-requests/notifications/read" {
                guard body["event_sequence"] as? Int == 12 else { return (404,["error":"team_notification_not_found"]) }
                readAcks += 1; notificationReadAt = 2000
                return (200,["schema":"hps-team-notification-read/1","event_sequence":12,"read_at":2000])
            }
        }
        if request.url?.path.hasPrefix("/v1/me/team-requests") == true {
            if ProcessInfo.processInfo.environment["HP_TEAM_REQUEST_DENIED"] == "1" { return (403, ["error": "team_product_denied"]) }
            let id = "trq_" + String(repeating: "a", count: 32)
            let path = request.url?.path ?? ""
            if ProcessInfo.processInfo.environment["HP_TEAM_HIDDEN"] == "1", outcomePosts == 0, request.httpMethod == "GET" {
                let route = path == "/v1/me/team-requests/"+id ? "detail" : ["workflow":"workflow","github":"github_links","deliveries":"deliveries","outcomes":"outcomes","github-observations":"observations"][String(path.split(separator:"/").last ?? "")]
                if let route {
                    let result = try hiddenRoute(route, requestID:id)
                    if route == "outcomes", outcomeEvents.isEmpty { outcomeEvents = result["events"] as? [[String:Any]] ?? [] }
                    return (200,result)
                }
            }
            if ProcessInfo.processInfo.environment["HP_TEAM_TEXT"] == "1", path.contains("/text/"), let target=path.split(separator:"/").last.map(String.init) {
                let latest="tcm_"+String(repeating:"e",count:32)
                guard target==id || target==latest else { return (404,["error":"team_text_target_not_found"]) }
                let readonly=ProcessInfo.processInfo.environment["HP_TEAM_TEXT_READONLY"] == "1"
                let author=readonly ? "other-member":"journey-account"
                let original:[String:Any] = ["request_id":id,"target_id":target,"account_id":author,"revision":1,"body":target==id ? teamRequest?["body"] ?? "Original request":"Latest explicit question beyond first page","created_at":target==id ? 1000:2001]
                if request.httpMethod=="POST" {
                    textPosts+=1;let key=body["client_mutation_id"] as? String ?? "";textKeys.append(key)
                    guard !readonly else { return (403,["error":"team_text_author_required"]) }
                    if let existing=textEvents[target]?.first(where:{$0["client_mutation_id"] as? String==key}) { return (200,["event":existing,"already":true]) }
                    let revision=(textEvents[target]?.last?["revision"] as? Int ?? 1)+1
                    if ProcessInfo.processInfo.environment["HP_TEAM_TEXT_RECOVERY"] == "1",textPosts==3 {
                        let remote:[String:Any] = ["id":"ttv_"+String(format:"%032x",revision),"request_id":id,"target_id":target,"actor_account_id":author,"client_mutation_id":"other-device-key","revision":revision,"body":"Another device correction","created_at":3000+revision,"redacted_at":NSNull()]
                        textEvents[target,default:[]].append(remote);return (409,["error":"team_text_revision_conflict"])
                    }
                    guard body["expected_revision"] as? Int==revision-1 else {return (409,["error":"team_text_revision_conflict"])}
                    let event:[String:Any] = ["id":"ttv_"+String(format:"%032x",revision),"request_id":id,"target_id":target,"actor_account_id":author,"client_mutation_id":key,"revision":revision,"body":body["body"] ?? "","created_at":3000+revision,"redacted_at":NSNull()]
                    textEvents[target,default:[]].append(event)
                    if ProcessInfo.processInfo.environment["HP_TEAM_TEXT_RECOVERY"] == "1",textPosts==1 {return (503,["error":"synthetic_unknown"])}
                    return (200,["event":event,"already":false])
                }
                return (200,["schema":"hps-team-text-history/1","request_id":id,"target_id":target,"can_edit":!readonly,"original":original,"current":textEvents[target]?.last ?? original,"events":textEvents[target] ?? [],"next_cursor":NSNull()])
            }
            let relatedID="trq_"+String(repeating:"b",count:32)
            let relatedRow:[String:Any] = ["id":relatedID,"account_id":"journey-account","client_request_id":"related-fixture","product":"studio","category":"bug","body":"Related original request","notice_version":"synthetic/1","status":"submitted","revision":1,"created_at":1001,"updated_at":1001]
            if ProcessInfo.processInfo.environment["HP_TEAM_RELATED"] == "1",path.hasPrefix("/v1/me/team-requests/"+id+"/related") {
                let manage=ProcessInfo.processInfo.environment["HP_TEAM_RELATED_READONLY"] != "1"
                if (!manage || ProcessInfo.processInfo.environment["HP_TEAM_RELATED_SEEDED"] == "1") && relationEvents.isEmpty {relationEvents=[["id":"trl_"+String(repeating:"c",count:32),"sequence":1,"pair_left":id,"pair_right":relatedID,"actor_account_id":"journey-account","client_mutation_id":"fixture-related","revision":1,"action":"link","reason":"Existing related reason","created_at":1001,"redacted_at":NSNull(),"target_request_id":relatedID]]}
                if request.httpMethod == "POST" {
                    relationPosts += 1
                    guard manage else{return(403,["error":"team_operator_required"])}
                    if let old=relationEvents.first(where:{$0["client_mutation_id"] as? String==body["client_mutation_id"] as? String}){return(200,["event":old,"already":true])}
                    guard body["target_request_id"] as? String==relatedID,body["expected_revision"] as? Int==relationEvents.count else{return(409,["error":"team_relation_conflict"])}
                    let event:[String:Any] = ["id":"trl_"+String(format:"%032x",relationEvents.count+1),"sequence":relationEvents.count+1,"pair_left":id,"pair_right":relatedID,"actor_account_id":"journey-account","client_mutation_id":body["client_mutation_id"] ?? "","revision":relationEvents.count+1,"action":body["action"] ?? "","reason":body["reason"] ?? "","created_at":1001,"redacted_at":NSNull(),"target_request_id":relatedID]
                    relationEvents.append(event)
                    if relationPosts==1 && ProcessInfo.processInfo.environment["HP_TEAM_RELATED_UNKNOWN"] == "1" {return(503,["error":"synthetic_unknown"])}
                    return(200,["event":event,"already":false])
                }
                let history=path.hasSuffix("/"+relatedID)
                return(200,["schema":history ? "hps-team-relation-history/1":"hps-team-related-requests/1","request_id":id,"target_request_id":history ? relatedID as Any:NSNull(),"current":history ? relationEvents.last ?? NSNull():NSNull(),"can_manage":manage,"items":history ? relationEvents:(relationEvents.last?["action"] as? String=="link" ? [relationEvents.last!]:[]),"next_cursor":NSNull()])
            }
            if ProcessInfo.processInfo.environment["HP_TEAM_RELATED"] == "1",path=="/v1/me/team-requests/"+relatedID,request.httpMethod=="GET"{return(200,["request":relatedRow,"comments":[],"next_comments_cursor":NSNull()])}
            if path == "/v1/me/team-requests/" + id + "/outcomes" {
                let allowed = ProcessInfo.processInfo.environment["HP_TEAM_OUTCOME_READONLY"] != "1"
                if request.httpMethod == "POST" {
                    outcomePosts += 1
                    guard allowed else { return (403,["error":"team_outcome_reporter_required"]) }
                    if let old = outcomeEvents.first(where: { $0["client_mutation_id"] as? String == body["client_mutation_id"] as? String }) { return (200,["event":old,"already":true]) }
                    guard body["expected_revision"] as? Int == outcomeEvents.count, body["version"] as? String == "0.2.0", body["build"] as? String == "18.1" else { return (409,["error":"team_outcome_conflict"]) }
                    let action = body["action"] as? String ?? "", now = Date().timeIntervalSince1970 * 1000
                    guard ["resolved","reopened"].contains(action), action != "reopened" || !(body["result"] as? String ?? "").isEmpty else { return (400,["error":"invalid_team_outcome"]) }
                    let event: [String:Any] = ["id":"tor_"+String(format:"%032x",outcomeEvents.count+1),"request_id":id,"actor_account_id":"journey-account","client_mutation_id":body["client_mutation_id"] ?? "","revision":outcomeEvents.count+1,"delivery_id":body["delivery_id"] ?? "","delivery_revision":body["delivery_revision"] ?? 0,"version":"0.2.0","build":"18.1","action":action,"result":body["result"] ?? NSNull(),"created_at":now,"resolved_at":action == "resolved" ? now : NSNull(),"purge_eligible_at":action == "resolved" ? now+90*86400000 : NSNull(),"evidence_kind":"reporter_self_reported","device_installed":"not_observed","tester_eligibility":"not_observed"]
                    outcomeEvents.append(event)
                    if ProcessInfo.processInfo.environment["HP_TEAM_OUTCOME_UNKNOWN"] == "1", outcomePosts == 1 { return (503,["error":"synthetic_unknown"]) }
                    return (200,["event":event,"already":false])
                }
                return (200,["schema":"hps-team-outcomes/1","request_id":id,"can_respond":allowed,"current":outcomeEvents.last ?? NSNull(),"events":outcomeEvents,"next_cursor":NSNull(),"retention":["policy":"90_days_after_reporter_confirmation","purge_eligible_at":outcomeEvents.last?["purge_eligible_at"] ?? NSNull(),"purge_implemented":false]])
            }
            if path == "/v1/me/team-requests/" + id + "/deliveries" {
                guard request.httpMethod == "GET" else { return (405, ["error":"read_only_fixture"]) }
                if ProcessInfo.processInfo.environment["HP_TEAM_DELIVERY_UNAVAILABLE"] == "1" { return (503, ["error":"team_deliveries_unavailable"]) }
                let stale = ProcessInfo.processInfo.environment["HP_TEAM_DELIVERY_STALE"] == "1"
                let now = Date().timeIntervalSince1970 * 1000, start = now - (stale ? 1_000_000 : 1000)
                let proof: [String: Any] = ["schema":"hps-team-delivery-evidence/1","repository":"hypeproof/hypeproof-studio","source_sha":String(repeating:"a",count:40),
                    "package":["sha256":String(repeating:"b",count:64),"size":1000,"bundle_id":"ai.hypeproof.studio.mobile","version":"0.2.0","build":"18.1"],
                    "observation_run":["id":123,"attempt":1,"workflow_source_sha":String(repeating:"c",count:40)],
                    "apple":["app_id":"6832914754","build_id":"fixture-build","group_id":"fixture-group","processing":"VALID","internal_state":"IN_BETA_TESTING","expiration_date":"2027-01-01T00:00:00Z","expired":false,"group_contains_build":true],
                    "observation_started_at":start,"observed_at":start+100,"valid_until":start+900000,"group_build_available":true,
                    "target_tester_member":"not_observed","target_tester_invitation_accepted":"not_observed","device_installed":"not_observed","reporter_confirmation":"not_observed"]
                let event: [String:Any] = ["id":"tdl_"+String(repeating:"a",count:32),"request_id":id,"github_link_id":"tgl_"+String(repeating:"b",count:32),"revision":1,
                    "instructions":"TestFlight에서 이 버전을 설치한 뒤 요청했던 흐름을 확인해 주세요.", "evidence":proof,"availability":stale ? "not_established":"group_available","reporter_confirmation":"not_observed","created_at":start+200,"redacted_at":NSNull()]
                return (200,["schema":"hps-team-deliveries/1","request_id":id,"can_manage":false,"current":event,"events":[event],"next_cursor":NSNull()])
            }
            if path == "/v1/me/team-requests/members" {
                return (200, ["schema": "hps-team-assignment-members/1", "account_id": "journey-account", "product": "studio", "members": [["account_id": "journey-account", "display_name": "내부 테스트 멤버"]]])
            }
            if path == "/v1/me/team-requests/" + id + "/github-observations" {
                guard request.httpMethod == "GET", ProcessInfo.processInfo.environment["HP_TEAM_GITHUB_OBSERVATIONS"] == "1" else { return (503,["error":"team_github_observations_not_ready"]) }
                githubObservationReads += 1
                if githubObservationReads >= 3 { return (503,["error":"synthetic_observation_unavailable"]) }
                let now = Date().timeIntervalSince1970 * 1000, stale = githubObservationReads == 2
                let observed = now - (stale ? 2_000_000 : 1000), a=String(repeating:"a",count:40), b=String(repeating:"b",count:40)
                let metadata:[String:Any] = ["schema":"hps-team-github-observation/1","repo":"hypeproof/hypeproof-studio","issue":["number":42,"state":"open"],
                    "historical":["source_sha":a,"run_id":99,"attempt":1],"pull":["number":43,"state":"open","merged":false,"head_sha":b,"merge_sha":NSNull(),"source_matches_historical":false],
                    "ci":["run_id":99,"attempt":2,"source_sha":a,"status":"completed","conclusion":"success","source_matches_historical":true,"source_matches_current_pull":false],"testflight":"not_observed","reporter_confirmation":"not_observed"]
                return (200,["schema":"hps-team-github-observations/1","request_id":id,"association_id":"tgl_"+String(repeating:"b",count:32),"association_revision":1,
                    "current":metadata,"observed_at":observed,"valid_until":observed+1_800_000,"fresh":!stale,"last_checked_at":now,"last_error":stale ? "provider_timeout":NSNull(),"events":[],"next_cursor":NSNull()])
            }
            if path == "/v1/me/team-requests/" + id + "/github" {
                let canManage = ProcessInfo.processInfo.environment["HP_TEAM_GITHUB_READONLY"] != "1"
                if request.httpMethod == "POST" {
                    githubPosts += 1
                    if ProcessInfo.processInfo.environment["HP_TEAM_INTAKE_ASSOCIATION_FAIL"] == "1" { return (503,["error":"provider_unavailable"]) }
                    guard canManage else { return (403, ["error": "team_workflow_denied"]) }
                    if let old = githubEvents.first(where: { $0["client_mutation_id"] as? String == body["client_mutation_id"] as? String }) { return (200, ["event": old, "already": true]) }
                    guard body["expected_revision"] as? Int == githubEvents.count else { return (409, ["error": "team_github_conflict"]) }
                    let repo = "hypeproof/hypeproof-studio", number = body["issue"] as? Int ?? 123
                    var proof: [String: Any] = ["schema":"hps-team-issue-evidence/1", "repo":repo, "issue":["number":number,"node_id":"I_synthetic","url":"https://github.com/\(repo)/issues/\(number)","state":"open"], "relationship":"provider_record_verified"]
                    if let pull = body["pull"] as? Int, let run = body["run"] as? Int, let attempt = body["attempt"] as? Int, let sha = body["source_sha"] as? String {
                        proof["schema"] = "hps-team-request-lineage/1"; proof["relationship"] = "provider_records_verified"
                        proof["pull"] = ["number":pull,"url":"https://github.com/\(repo)/pull/\(pull)","merged":true]
                        proof["source_sha"] = sha; proof["ci"] = ["run_id":run,"attempt":attempt,"url":"https://github.com/\(repo)/actions/runs/\(run)","conclusion":"success"]
                        proof["testflight"] = "not_observed"; proof["reporter_confirmation"] = "not_observed"
                    }
                    let event: [String: Any] = ["id":"tgl_" + String(repeating:"d",count:32),"request_id":id,"actor_account_id":"journey-account","client_mutation_id":body["client_mutation_id"] ?? "", "revision":githubEvents.count+1,"repo":repo,"issue_number":number,"reason":body["reason"] ?? "", "verified_at":3000,"redacted_at":NSNull(),"evidence":proof,"association":"operator_asserted","testflight":"not_observed","reporter_confirmation":"not_observed"]
                    githubEvents.append(event)
                    if ProcessInfo.processInfo.environment["HP_TEAM_GITHUB_UNKNOWN"] == "1" { throw URLError(.timedOut) }
                    return (200,["event":event,"already":false])
                }
                return (200,["schema":"hps-team-github-links/1","configured_repository":"hypeproof/hypeproof-studio","request_id":id,"can_manage":canManage,"current":githubEvents.last ?? NSNull(),"events":githubEvents,"next_cursor":NSNull()])
            }
            if path == "/v1/me/team-requests/" + id + "/workflow" {
                if request.httpMethod == "POST" {
                    if let old = workflowEvents.first(where: { $0["client_mutation_id"] as? String == body["client_mutation_id"] as? String }) { return (200, ["event": old, "already": true]) }
                    guard body["expected_revision"] as? Int == workflowEvents.count else { return (409, ["error": "team_workflow_conflict"]) }
                    var event = body
                    event["id"] = "twe_" + String(repeating: "c", count: 32)
                    event["request_id"] = id; event["actor_account_id"] = "journey-account"
                    event["revision"] = workflowEvents.count + 1; event["created_at"] = 2000
                    workflowEvents.append(event)
                    return (200, ["event": event, "already": false])
                }
                let initial: [String: Any] = ["request_id": id, "status": "submitted", "priority": "unclassified", "revision": 0]
                return (200, ["schema": "hps-team-workflow/1", "request_id": id, "can_manage": true, "current": workflowEvents.last ?? initial, "events": workflowEvents, "next_cursor": NSNull()])
            }
            switch (request.httpMethod ?? "GET", path) {
            case ("GET", "/v1/me/team-requests/access"):
                return (200, ["schema": "hps-team-request-access/1", "account_id": "journey-account", "notice_version": "synthetic/1", "products": ["studio", "lab"], "supported_text_revision_schemas":ProcessInfo.processInfo.environment["HP_TEAM_TEXT"] == "1" ? ["hps-team-text-change/1"] : [], "supported_comment_schemas":ProcessInfo.processInfo.environment["HP_TEAM_DISCUSSION"] == "1" ? ["hps-team-comment/1","hps-team-comment/2"] : ["hps-team-comment/1"], "supported_push_capabilities":ProcessInfo.processInfo.environment["HP_TEAM_INBOX"] == "1" ? ["team_request/1","team_discussion/1"] : []])
            case ("POST", "/v1/me/team-requests"):
                requestPosts += 1
                guard body["schema"] as? String == "hps-team-request/1", body["notice_version"] as? String == "synthetic/1", let key = body["client_request_id"] as? String, let words = body["body"] as? String else { return (400, ["error": "invalid_team_request"]) }
                if let old = teamRequest {
                    guard old["client_request_id"] as? String == key, old["body"] as? String == words else { return (409, ["error": "team_request_conflict"]) }
                    return (200, ["request": old, "already": true])
                }
                let row: [String: Any] = ["id": id, "account_id": "journey-account", "client_request_id": key, "product": body["product"] ?? "studio", "category": body["category"] ?? "bug", "body": words, "notice_version": "synthetic/1", "status": "submitted", "revision": 1, "created_at": 1000, "updated_at": 1000]
                teamRequest = row
                if ProcessInfo.processInfo.environment["HP_TEAM_REQUEST_RESULT"] == "uncertain" { throw URLError(.timedOut) }
                return (200, ["request": row, "already": false])
            case ("GET", "/v1/me/team-requests"):
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                if let key = query.first(where: { $0.name == "client_request_id" })?.value, teamRequest?["client_request_id"] as? String != key { return (404, ["error": "team_request_not_found"]) }
                return (200, ["requests": (teamRequest.map { [$0] } ?? []) + (ProcessInfo.processInfo.environment["HP_TEAM_RELATED"] == "1" ? [relatedRow]:[]), "next_cursor": NSNull()])
            default:
                if path == "/v1/me/team-requests/" + id, request.httpMethod == "GET", ProcessInfo.processInfo.environment["HP_TEAM_DETAIL_FAILURE"] == "1" { return (503, ["error": "synthetic_detail_unavailable"]) }
                if path == "/v1/me/team-requests/" + id, request.httpMethod == "GET", let teamRequest {
                    var result:[String:Any] = ["request":teamRequest,"comments":teamComments,"next_comments_cursor":NSNull()]
                    if ProcessInfo.processInfo.environment["HP_TEAM_TEXT"] == "1" {
                        let latest="tcm_"+String(repeating:"e",count:32)
                        result["latest_question"]=["request_id":id,"target_id":latest,"account_id":ProcessInfo.processInfo.environment["HP_TEAM_TEXT_READONLY"] == "1" ? "other-member":"journey-account","created_at":2001,"text_revision":textEvents[latest]?.last?["revision"] ?? 1,"edited_at":textEvents[latest]?.last?["created_at"] ?? NSNull()]
                        // The latest question is deliberately outside this first comment page.
                        result["next_comments_cursor"]="1001:tcm_"+String(repeating:"b",count:32)
                    }
                    return (200,result)
                }
                if path == "/v1/me/team-requests/" + id + "/comments", request.httpMethod == "POST" {
                    commentPosts += 1
                    guard let key = body["client_comment_id"] as? String, let words = body["body"] as? String else { return (400, ["error": "invalid_team_comment"]) }
                    let existing = teamComments.first { $0["client_comment_id"] as? String == key }
                    let commentID = existing?["id"] as? String ?? "tcm_" + String(repeating:teamComments.isEmpty ? "b" : "c",count:32)
                    if body["schema"] as? String == "hps-team-comment/2" {
                        guard let intent = body["intent"] as? String, ["discussion","question","reply"].contains(intent), body.keys.count == 5 else { return (400,["error":"invalid_team_comment"]) }
                        if intent == "reply", let target = body["reply_to"] as? String, target != id && !teamComments.contains(where: { $0["id"] as? String == target }) { return (409,["error":"team_reply_target_unavailable"]) }
                    }
                    if ProcessInfo.processInfo.environment["HP_TEAM_DISCUSSION"] == "1", commentPosts == 3, body["intent"] as? String == "reply" { return (409,["error":"team_reply_target_unavailable"]) }
                    if existing == nil { teamComments.append(["id": commentID, "request_id": id, "account_id": "journey-account", "client_comment_id": key, "body": words, "created_at": 1001 + teamComments.count, "intent":body["intent"] ?? "discussion", "reply_to":body["reply_to"] ?? NSNull()]) }
                    if ProcessInfo.processInfo.environment["HP_TEAM_DISCUSSION"] == "1", commentPosts == 1 { return (503,["error":"synthetic_unknown_comment"]) }
                    return (200, ["comment_id": commentID, "already": existing != nil])
                }
                return (404, ["error": "synthetic_team_request_route"])
            }
        }
        switch (request.httpMethod ?? "GET", request.url?.path ?? "") {
        case ("GET", "/v1/me/cards"):
            guard request.url?.query == "surface=mobile" else { return (400, ["error": "invalid_surface"]) }
            reads += 1
            let card: [String: Any] = ["schema": "hps-card/1", "key": "growth:fixture", "kind": "team:choice", "attempt": 1, "expires_at": Date().timeIntervalSince1970 * 1000 + 60000,
                "prompt": "지금 바꿔 볼 작은 방법은 무엇인가요?", "segments": [], "choices": [["id": "next", "label": "한 가지 바꿔 볼게요"]], "select": "tap", "actions": [], "skip": "나중에"]
            return (200, ["card": started ? card as Any : NSNull()])
        case ("POST", "/v1/me/question-triggers"):
            guard body["schema"] as? String == "hps-question-trigger/1", let id = body["id"] as? String, UUID(uuidString: id) != nil,
                  body["source_id"] as? String == id, body["source_revision"] as? Int == 1, body["choice"] as? String == "method" else { return (400, ["error": "invalid_trigger"]) }
            started = true; triggers += 1
            return (200, ["schema": "hps-question-trigger/1", "key": "growth:fixture", "source": ["kind": "choice", "id": id, "revision": 1], "reentry": ["method": "GET", "path": "/v1/me/cards"], "model_calls": 0, "policy": "team-question/1", "created": true])
        case ("POST", "/v1/me/cards/growth:fixture/shown"):
            guard body["surface"] as? String == "mobile" else { return (400, ["error": "invalid_surface"]) }; shown += 1; return (200, ["ok": true])
        case ("POST", "/v1/me/cards/growth:fixture/answer"):
            guard started, body["surface"] as? String == "mobile", body["choice"] as? String == "next" else { return (400, ["error": "invalid_answer"]) }; answers += 1; started = false
            return (200, ["ok": true, "thanks": "다음 생각을 남겼어요", "source_revision": answers])
        case ("GET", "/v1/me/product-events/consent"):
            return (200, ["schema": "hps-product-consent/1", "notice_version": "team-ux/1", "title": "사용 경험 공유", "notice": "대화 원문 없이 사용 단계만 기록해요. 거절해도 질문과 승인은 그대로 사용할 수 있어요.", "preference": ["notice_version": "team-ux/1", "granted": granted ? 1 : 0]])
        case ("POST", "/v1/me/product-events/consent"):
            guard body["notice_version"] as? String == "team-ux/1", let value = body["granted"] as? Bool else { return (400, ["error": "invalid_consent"]) }; granted = value; return (200, ["ok": true])
        case ("POST", "/v1/me/product-events"):
            guard granted, body["schema"] as? String == "hps-product-events/1", let rows = body["events"] as? [[String: Any]], !rows.isEmpty, rows.count <= 20 else { return (403, ["error": "consent_required"]) }
            let data = try JSONSerialization.data(withJSONObject: rows); let checked = try JSONDecoder().decode([ProductExperienceEvent].self, from: data); try checked.forEach { try $0.validate() }
            for row in rows { guard Set(row.keys).isSubset(of: ["id", "journey_id", "journey", "type", "platform", "app_version", "failure_class"]) else { return (400, ["error": "invalid_event"]) } }
            events.append(contentsOf: checked.map(\.type)); return (200, ["schema": "hps-product-events/1", "accepted": checked.map(\.id), "deferred": [], "evidence_kind": "client_observed"])
        default: return (404, ["error": "unexpected_team_route"])
        }
    }
}
private final class TeamEntryTransport: URLProtocol, @unchecked Sendable {
    static let state = TeamEntryState()
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "team-entry.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }; var bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&bytes, maxLength: bytes.count); if n < 0 { throw URLError(.cannotDecodeContentData) }; if n == 0 { break }; data.append(contentsOf: bytes.prefix(n)); guard data.count <= 32768 else { throw URLError(.dataLengthExceedsMaximum) } }
            }
            let body = data.isEmpty ? [:] : (try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:])
            let (status, result) = try Self.state.response(request, body)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: result)); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
#endif
