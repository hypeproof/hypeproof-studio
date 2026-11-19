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
}
private final class TeamEntryState: @unchecked Sendable {
    private let lock = NSLock()
    private var started = false, granted = false, triggers = 0, reads = 0, shown = 0, answers = 0, events: [String] = []
    private var teamRequest: [String: Any]?
    private var teamComments: [[String: Any]] = []
    private var requestPosts = 0, commentPosts = 0
    private var githubEvents: [[String: Any]] = [], githubPosts = 0
    private var workflowEvents: [[String: Any]] = []
    func trace() -> String {
        lock.lock(); defer { lock.unlock() }
        return String(data: (try? JSONSerialization.data(withJSONObject: ["triggers": triggers, "reads": reads, "shown": shown, "answers": answers, "events": events, "granted": granted, "requestPosts": requestPosts, "commentPosts": commentPosts, "githubPosts": githubPosts, "githubEvents": githubEvents.count], options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
    }
    func response(_ request: URLRequest, _ body: [String: Any]) throws -> (Int, [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true, request.value(forHTTPHeaderField: "Origin") == nil else { return (401, ["error": "unauthorized"]) }
        if request.url?.path.hasPrefix("/v1/me/team-requests") == true {
            if ProcessInfo.processInfo.environment["HP_TEAM_REQUEST_DENIED"] == "1" { return (403, ["error": "team_product_denied"]) }
            let id = "trq_" + String(repeating: "a", count: 32)
            let path = request.url?.path ?? ""
            if path == "/v1/me/team-requests/members" {
                return (200, ["schema": "hps-team-assignment-members/1", "account_id": "journey-account", "product": "studio", "members": [["account_id": "journey-account", "display_name": "내부 테스트 멤버"]]])
            }
            if path == "/v1/me/team-requests/" + id + "/github" {
                let canManage = ProcessInfo.processInfo.environment["HP_TEAM_GITHUB_READONLY"] != "1"
                if request.httpMethod == "POST" {
                    githubPosts += 1
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
                return (200,["schema":"hps-team-github-links/1","request_id":id,"can_manage":canManage,"current":githubEvents.last ?? NSNull(),"events":githubEvents,"next_cursor":NSNull()])
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
                return (200, ["schema": "hps-team-request-access/1", "account_id": "journey-account", "notice_version": "synthetic/1", "products": ["studio", "lab"]])
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
                return (200, ["requests": teamRequest.map { [$0] } ?? [], "next_cursor": NSNull()])
            default:
                if path == "/v1/me/team-requests/" + id, request.httpMethod == "GET", ProcessInfo.processInfo.environment["HP_TEAM_DETAIL_FAILURE"] == "1" { return (503, ["error": "synthetic_detail_unavailable"]) }
                if path == "/v1/me/team-requests/" + id, request.httpMethod == "GET", let teamRequest { return (200, ["request": teamRequest, "comments": teamComments, "next_comments_cursor": NSNull()]) }
                if path == "/v1/me/team-requests/" + id + "/comments", request.httpMethod == "POST" {
                    commentPosts += 1
                    guard let key = body["client_comment_id"] as? String, let words = body["body"] as? String else { return (400, ["error": "invalid_team_comment"]) }
                    let commentID = "tcm_" + String(repeating: "b", count: 32)
                    if !teamComments.contains(where: { $0["client_comment_id"] as? String == key }) { teamComments.append(["id": commentID, "request_id": id, "account_id": "journey-account", "client_comment_id": key, "body": words, "created_at": 1001]) }
                    return (200, ["comment_id": commentID, "already": commentPosts > 1])
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
