import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct SharedConversation: Codable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let host_session_id: String
    public let revision: Int
    public let updated_at: Double
}
public struct PersonalReflection: Decodable, Sendable {
    public struct State: Decodable, Sendable {
        public let id: String
        public let revision: Int
        public let messages: [SharedMessage]
        public let has_earlier: Bool
        public let turn: SharedRequest?
    }
    public let state: State
    public let opening: String
    public let hint: String
    public let acknowledged_id: String?
}
public struct SharedMessage: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let role: String
    public let content: String
    public let created_at: Double
}
public struct ConversationEvent: Codable, Sendable {
    public let seq: Int
    public let client_event_id: String
    public let message: SharedMessage
}
public struct ConversationPage: Decodable, Sendable {
    public let events: [ConversationEvent]
    public let cursor: Int
    public let has_more: Bool
}
public struct SharedRequest: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var text: String
    public var status: String
    public var created_at: Double
    public var updated_at: Double
    public var expectedRevision: Int?
    public static func pending(_ text: String) throws -> SharedRequest {
        let checked = try checkedText(text)
        let now = Date().timeIntervalSince1970 * 1000
        return SharedRequest(id: UUID().uuidString.lowercased(), text: checked, status: "local", created_at: now, updated_at: now)
    }
    public static func checkedText(_ text: String) throws -> String {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf16.count <= 4000, !value.contains("\0") else { throw StudioError.message("4,000자 이내로 적어 주세요. 이모지는 길이에 따라 여러 글자로 셀 수 있어요.") }
        return value
    }
    public var reflectionStatusLabel: String {
        switch status {
        case "local": return "이 기기에 저장됨 · 전송 대기"
        case "running", "pending": return "질문을 이어가고 있어요"
        case "completed": return "같은 계정의 대화에 저장됨"
        case "cancelled": return "답변 받기를 중지했어요. 보낸 이야기는 남아 있어요."
        case "unknown": return "완료 여부를 확인하지 못했어요. 자동으로 다시 실행하지 않아요."
        default: return "답변을 받지 못했어요. 보낸 이야기는 남아 있어요."
        }
    }
    public var outstanding: Bool { ["local", "pending", "running"].contains(status) }
    public var statusLabel: String {
        switch status {
        case "local": return "이 iPhone에 저장됨 · 전송 대기"
        case "pending": return "전송됨 · 데스크톱에서 이 대화를 열어 주세요"
        case "running": return "데스크톱에서 답변 중 · 필요한 승인은 컴퓨터에서 확인해 주세요"
        case "completed": return "양쪽 대화에 저장됨"
        case "cancelled": return "전송 취소됨"
        case "unknown": return "완료 여부를 확인하지 못했어요. 컴퓨터에서 확인해 주세요. 자동으로 다시 실행하지 않아요."
        default: return "실행하지 못했어요. 컴퓨터에서 상태를 확인해 주세요."
        }
    }
}
/// Account-scoped transcript cache and durable outbox; execution remains in Service or the desktop host.
public struct ConversationCache: Codable, Sendable {
    public var messages: [SharedMessage] = []
    public var cursor = 0
    public var draft = ""
    public var request: SharedRequest?
    public var requestFailure: String?
    public var context: [String: String]?
    public init() {}
    public func applyingEdits(_ edits: [String: String]) -> ConversationCache {
        var value = self
        if let draft = edits["draft"] { value.draft = draft }
        for key in ["goal", "audience", "experience", "style"] {
            if let text = edits[key] { if value.context == nil { value.context = [:] }; value.context?[key] = text }
        }
        return value
    }
    public static func exportSnapshot(entries: [String: ConversationCache], edits: [String: [String: String]]) -> [String: ConversationCache] {
        var snapshot = entries
        for id in Set(entries.keys).union(edits.keys) { snapshot[id] = (entries[id] ?? ConversationCache()).applyingEdits(edits[id] ?? [:]) }
        return snapshot
    }
    public mutating func apply(_ page: ConversationPage) throws {
        guard page.cursor >= cursor, page.events.count <= 100 else { throw SyncFailure.invalidResponse }
        var next = messages
        var last = cursor
        for event in page.events {
            guard event.seq > last, event.seq <= page.cursor,
                  ["user", "assistant"].contains(event.message.role),
                  !event.message.id.isEmpty, event.message.content.utf16.count <= 32000 else { throw SyncFailure.invalidResponse }
            if let index = next.firstIndex(where: { $0.id == event.message.id }) { next[index] = event.message }
            else { next.append(event.message) }
            last = event.seq
        }
        guard page.cursor == last else { throw SyncFailure.invalidResponse }
        messages = next; cursor = page.cursor
    }
    public mutating func applyReflection(_ value: PersonalReflection) throws {
        let state = value.state
        func validID(_ id: String) -> Bool { id.range(of: "^[A-Za-z0-9._:-]{1,128}$", options: .regularExpression) != nil }
        guard state.id == "personal-reflection", state.revision >= cursor, state.messages.count <= 80,
              value.opening.utf16.count <= 500, value.hint.utf16.count <= 1000,
              Set(state.messages.map(\.id)).count == state.messages.count,
              state.messages.allSatisfy({ validID($0.id) && ["user", "assistant"].contains($0.role) && $0.content.utf16.count <= 32000 && $0.created_at.isFinite })
        else { throw SyncFailure.invalidResponse }
        if let turn = state.turn {
            guard validID(turn.id), turn.text.utf16.count <= 4000,
                  ["running", "pending", "completed", "failed", "unknown", "cancelled"].contains(turn.status), turn.updated_at.isFinite
            else { throw SyncFailure.invalidResponse }
        }
        messages = state.messages; cursor = state.revision
        let acknowledged = request.map { pending in value.acknowledged_id == pending.id || state.messages.contains(where: { $0.id == pending.id && $0.role == "user" && $0.content == pending.text }) } ?? false
        if request?.status != "local" || request?.id == state.turn?.id || acknowledged { request = state.turn }
        if request?.status == "completed" { requestFailure = nil }
    }
    /// A cancel endpoint can return an older/unrelated snapshot when the POST
    /// has not registered yet. Only an exact terminal turn confirms this action.
    public mutating func applyReflectionStop(_ value: PersonalReflection, request original: SharedRequest) throws {
        guard let turn = value.state.turn, turn.id == original.id, turn.text == original.text,
              !turn.outstanding else { throw SyncFailure.invalidResponse }
        try applyReflection(value)
        if turn.status == "cancelled" || turn.status == "completed" { requestFailure = nil }
    }
    public mutating func enqueue(reflection: Bool = false) throws {
        guard request?.outstanding != true else { throw SyncFailure.http(409, "request_outstanding") }
        request = try .pending(draft)
        requestFailure = nil
        if reflection { request?.expectedRevision = cursor }
        draft = ""
    }
}
/// A voice turn follows its own request, never a newer turn from another device.
public enum ConversationVoiceReply: Equatable {
    case waiting, speak(String), finished, needsAttention
    public static func resolve(id: String, request: SharedRequest?, messages: [SharedMessage], sending: Bool, readAloud: Bool, completedWaitExpired: Bool = false) -> Self {
        guard let request, request.id == id else { return .needsAttention }
        if request.status == "completed" {
            if !readAloud { return .finished }
            guard let index = messages.firstIndex(where: { $0.id == id && $0.role == "user" }),
                  let answer = messages.dropFirst(index + 1).prefix(while: { $0.role != "user" }).last(where: { $0.role == "assistant" }) else { return completedWaitExpired ? .needsAttention : .waiting }
            return .speak(answer.content)
        }
        if ["pending", "running"].contains(request.status) || (request.status == "local" && sending) { return .waiting }
        return .needsAttention
    }
}
public struct DeviceSignIn: Decodable, Sendable {
    public let device_code: String
    public let user_code: String
    public let verification_uri_complete: URL
    public let expires_in: Double
    public let interval: Double
}
public struct AccountTokens: Codable, Sendable {
    public let access_token: String
    public let refresh_token: String
    public let expires_in: Double
    public let session_id: String
}
public enum SyncFailure: Error, LocalizedError {
    case http(Int, String), invalidResponse
    public var errorDescription: String? {
        switch self {
        case .invalidResponse: return "연동 응답을 확인하지 못했어요. 저장된 기록은 유지해요."
        case .http(let status, let code):
            if ["native_signin_expired", "native_signin_not_pending", "invalid_native_signin"].contains(code) { return "로그인 요청이 만료됐거나 이미 사용됐어요. 로그인을 다시 시작해 주세요." }
            if ["invalid_code_verifier", "invalid_code_challenge", "invalid_return_uri"].contains(code) { return "이 앱의 로그인 요청을 확인하지 못했어요. 로그인을 다시 시작해 주세요." }
            if code == "reflection_access_required" { return "이 계정의 AI 이용 권한을 확인해 주세요. 보낸 이야기와 기록은 남아 있어요." }
            if code == "reflection_monthly_limit" { return "이번 달 이용 한도에 닿았습니다. 다음 달에 다시 쓸 수 있습니다. 만든 파일과 대화는 그대로 남아 있습니다." }
            if code == "reflection_budget_limit" { return "AI 이용 한도에 도달했어요. 기록은 그대로 남아 있어요." }
            if code == "reflection_admission_unavailable" { return "AI 이용 상태를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요. 보낸 이야기와 기록은 남아 있어요." }
            if code == "reflection_busy" { return "다른 기기에서 답변을 받고 있어요. 잠시 뒤 같은 대화를 확인해 주세요." }
            if code == "reflection_changed" { return "다른 기기에서 대화가 바뀌었어요. 새 내용을 확인한 뒤 보내 주세요." }
            if code == "reflection_not_ready" { return "새 질문 대화를 준비하고 있어요. 기존 기록은 그대로 남아 있어요." }
            if status == 401 || status == 403 { return "이 기기의 연결 권한을 확인해 주세요. 다시 로그인하면 이어갈 수 있어요." }
            if status == 404 { return "이 대화의 연결이 해제됐거나 서버 연동이 아직 준비되지 않았어요." }
            if code == "slow_down" { return "연결 확인 중이에요. 잠시 기다려 주세요." }
            if status == 409 { return "앞선 요청이나 컴퓨터의 상태를 확인해 주세요. 작성한 글은 보존했어요." }
            if status == 429 { return "연동 요청이 많아요. 잠시 뒤 다시 확인해 주세요." }
            return "연결하지 못했어요. 인터넷 상태를 확인하고 다시 시도해 주세요. 작성한 글은 남아 있어요."
        }
    }
}
public final class ConversationService: @unchecked Sendable {
    private let session: URLSession
    private let base: URL
    public init(session: URLSession = .shared, base: URL = URL(string: "https://api.hypeproof-ai.xyz")!) { self.session = session; self.base = base }
    private func path(_ id: String) throws -> String {
        guard !id.isEmpty, id.count <= 128, id.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", options: .regularExpression) != nil else { throw SyncFailure.invalidResponse }
        return "/v1/me/conversations/" + id
    }
    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil, token: String? = nil, timeout: TimeInterval? = nil) async throws -> (Data, Int) {
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL, url.host == base.host else { throw SyncFailure.invalidResponse }
        var req = URLRequest(url: url, timeoutInterval: timeout ?? (path == "/v1/me/reflection/turns" ? 120 : 25))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, data.count <= 5_000_000 else { throw SyncFailure.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let code = object?["error"] as? String ?? (object?["error"] as? [String: Any])?["code"] as? String ?? "unknown"
            throw SyncFailure.http(http.statusCode, code)
        }
        return (data, http.statusCode)
    }
    public func startSignIn() async throws -> DeviceSignIn {
        let (data, _) = try await request("/v1/auth/device/start", method: "POST", body: ["label": "HP Studio iPhone"])
        let value = try JSONDecoder().decode(DeviceSignIn.self, from: data)
        guard value.verification_uri_complete.scheme == "https", value.verification_uri_complete.host == "hypeproof-ai.xyz" else { throw SyncFailure.invalidResponse }
        return value
    }
    public func startNativeSignIn(_ proof: NativeAccountProof) async throws -> NativeAccountStart {
        let (data, _) = try await request("/v1/auth/native/start", method: "POST", body: ["state": proof.state, "code_challenge": proof.challenge, "code_challenge_method": "S256", "redirect_uri": NativeAccountProof.redirectURI, "label": "HP Studio iPhone"])
        let value = try JSONDecoder().decode(NativeAccountStart.self, from: data)
        try value.validate(); return value
    }
    public func exchangeNativeSignIn(code: String, proof: NativeAccountProof) async throws -> AccountTokens {
        let (data, _) = try await request("/v1/auth/native/exchange", method: "POST", body: ["code": code, "code_verifier": proof.verifier, "redirect_uri": NativeAccountProof.redirectURI])
        let value = try JSONDecoder().decode(AccountTokens.self, from: data)
        try value.validate(); return value
    }
    public func pollSignIn(_ device: String) async throws -> AccountTokens? {
        let (data, status) = try await request("/v1/auth/device/poll", method: "POST", body: ["device_code": device])
        if status == 202 { return nil }
        let tokens = try JSONDecoder().decode(AccountTokens.self, from: data)
        try tokens.validate(); return tokens
    }
    public func accountID(_ token: String, sessionID: String? = nil) async throws -> String {
        let (data, _) = try await request("/v1/me", token: token)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let account = object["account"] as? [String: Any], let id = account["id"] as? String,
              StoredAccount.validID(id), account["status"] as? String == "active",
              let returnedSession = object["session_id"] as? String, StoredAccount.validID(returnedSession),
              sessionID == nil || sessionID == returnedSession else { throw SyncFailure.invalidResponse }
        return id
    }
    public func refresh(_ refreshToken: String) async throws -> AccountTokens {
        let (data, _) = try await request("/v1/auth/refresh", method: "POST", body: ["refresh_token": refreshToken])
        return try JSONDecoder().decode(AccountTokens.self, from: data)
    }
    public func logout(_ token: String) async throws { _ = try await request("/v1/auth/logout", method: "POST", body: [:], token: token) }
    public func list(_ token: String) async throws -> [SharedConversation] {
        struct List: Decodable { let conversations: [SharedConversation] }
        let (data, _) = try await request("/v1/me/conversations", token: token)
        return try JSONDecoder().decode(List.self, from: data).conversations
    }
    public func reflection(_ token: String, timeout: TimeInterval = 25) async throws -> PersonalReflection {
        let (data, _) = try await request("/v1/me/reflection", token: token, timeout: timeout)
        return try JSONDecoder().decode(PersonalReflection.self, from: data)
    }
    public func reflect(_ value: SharedRequest, token: String) async throws -> PersonalReflection {
        guard let revision = value.expectedRevision, revision >= 0 else { throw SyncFailure.http(409, "reflection_changed") }
        let (data, _) = try await request("/v1/me/reflection/turns", method: "POST", body: ["id": value.id, "text": value.text, "revision": revision], token: token)
        return try JSONDecoder().decode(PersonalReflection.self, from: data)
    }
    public func cancelReflection(_ id: String, token: String, timeout: TimeInterval = 25) async throws -> PersonalReflection {
        _ = try path(id)
        let (data, _) = try await request("/v1/me/reflection/turns/" + id + "/cancel", method: "POST", body: [:], token: token, timeout: timeout)
        return try JSONDecoder().decode(PersonalReflection.self, from: data)
    }
    public func abandonReflection(_ id: String, token: String) async throws -> PersonalReflection {
        _ = try path(id)
        let (data, _) = try await request("/v1/me/reflection/turns/" + id + "/abandon", method: "POST", body: [:], token: token)
        return try JSONDecoder().decode(PersonalReflection.self, from: data)
    }
    public func events(_ id: String, after: Int, token: String) async throws -> ConversationPage {
        let (data, _) = try await request(try path(id) + "/events?after=\(after)", token: token)
        return try JSONDecoder().decode(ConversationPage.self, from: data)
    }
    public func requests(_ id: String, token: String) async throws -> [SharedRequest] {
        struct List: Decodable { let requests: [SharedRequest] }
        let (data, _) = try await request(try path(id) + "/requests", token: token)
        return try JSONDecoder().decode(List.self, from: data).requests
    }
    public func submit(_ id: String, request value: SharedRequest, token: String) async throws -> SharedRequest {
        struct Result: Decodable { let request: SharedRequest }
        let (data, _) = try await request(try path(id) + "/requests", method: "POST", body: ["id": value.id, "text": value.text], token: token)
        return try JSONDecoder().decode(Result.self, from: data).request
    }
    public func cancel(_ id: String, requestID: String, token: String) async throws -> SharedRequest {
        _ = try path(requestID)
        struct Result: Decodable { let request: SharedRequest }
        let (data, _) = try await request(try path(id) + "/requests/" + requestID + "/cancel", method: "POST", body: [:], token: token)
        return try JSONDecoder().decode(Result.self, from: data).request
    }
}
