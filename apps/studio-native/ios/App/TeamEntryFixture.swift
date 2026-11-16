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
    func trace() -> String {
        lock.lock(); defer { lock.unlock() }
        return String(data: (try? JSONSerialization.data(withJSONObject: ["triggers": triggers, "reads": reads, "shown": shown, "answers": answers, "events": events, "granted": granted], options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
    }
    func response(_ request: URLRequest, _ body: [String: Any]) throws -> (Int, [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        guard request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true, request.value(forHTTPHeaderField: "Origin") == nil else { return (401, ["error": "unauthorized"]) }
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
