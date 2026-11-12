import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct Grant: Decodable, Sendable {
    public let code: String
    public let expires_at: Double
    public var isValid: Bool { expires_at > Date().timeIntervalSince1970 * 1000 + 5000 }
}
public struct ServiceFailure: Error, LocalizedError {
    public let status: Int
    public let code: String
    public var errorDescription: String? { StudioService.friendly(status: status, code: code) }
}
public final class StudioService: @unchecked Sendable {
    private let session: URLSession
    private let base: URL
    public init(session: URLSession = .shared, base: URL = URL(string: "https://api.hypeproof-ai.xyz")!) { self.session = session; self.base = base }
    public func claim(installID: String) async throws -> Grant {
        let data = try await request(path: "/v1/free/claim", body: ["install_id": installID.lowercased(), "age_ok": true, "app_version": "2026.1110.0"])
        let grant = try JSONDecoder().decode(Grant.self, from: data)
        guard !grant.code.isEmpty, grant.isValid else { throw StudioError.message("무료 AI 연결을 확인하지 못했어요.") }
        return grant
    }
    public func reply(project: Project, grant: Grant) async throws -> String {
        guard let last = project.messages.last, last.role == "user" else { throw StudioError.message("먼저 생각을 적어 주세요.") }
        let data = try await request(path: "/v1/messages", body: ["model": "hypeproof-fast", "messages": project.conversation(), "max_tokens": 2048, "stream": false], headers: ["Authorization": "Bearer " + grant.code, "anthropic-version": "2023-06-01", "x-hps-effort": "low", "x-hps-turn-id": last.id, "x-hps-trial-request-id": UUID().uuidString])
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let parts = object["content"] as? [[String: Any]] else { throw StudioError.message("AI 응답 형식을 확인하지 못했어요.") }
        let text = parts.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw StudioError.message("AI의 답변이 비어 있어요. 잠시 뒤 다시 요청해 주세요.") }
        return text + (object["stop_reason"] as? String == "max_tokens" ? "\n\n응답 길이 제한으로 여기까지 받았어요." : "")
    }
    private func request(path: String, body: [String: Any], headers: [String: String] = [:]) async throws -> Data {
        var req = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: 90)
        req.httpMethod = "POST"; req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers { req.setValue(value, forHTTPHeaderField: name) }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw StudioError.message("인터넷 연결을 확인해 주세요.") }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let error = object?["error"] as? [String: Any]
            let code = error?["code"] as? String ?? error?["type"] as? String ?? ""
            throw ServiceFailure(status: http.statusCode, code: code)
        }
        return data
    }
    public static func friendly(status: Int, code: String) -> String {
        if code == "rate_limited" || code == "network_limit" { return "무료 연결 요청이 잠시 많아요. 새 계정을 만들지 말고 잠시 뒤 다시 시도해 주세요." }
        if code == "claim_busy" { return "무료 연결을 준비 중이에요. 잠시 뒤 다시 시도해 주세요." }
        if code == "under_14" { return "현재 무료 AI는 만 14세 이상에게 제공돼요." }
        if code == "app_too_old" { return "앱을 최신 버전으로 업데이트해 주세요." }
        if code == "allowance_revoked" { return "무료 AI 이용이 중지되어 있어요. HypeProof 지원팀에 문의해 주세요. 기록은 계속할 수 있어요." }
        if code == "trial_busy" { return "앞선 요청이 아직 진행 중이에요. 잠시 뒤 다시 시도해 주세요." }
        if code == "trial_input_limit" { return "대화가 길어졌어요. 의도를 기록하고 새 생각으로 이어가 주세요." }
        if status == 429 { return "무료 AI 사용 한도에 도달했어요. 기록은 그대로 남아 있어요. 나중에 다시 시도해 주세요." }
        if status == 401 || status == 403 { return "AI 연결 권한을 확인해야 해요. 연결을 해제한 뒤 다시 연결해 주세요." }
        return "AI 연결에 실패했어요. 작성한 내용은 유지돼요. 잠시 뒤 다시 시도해 주세요."
    }
}
