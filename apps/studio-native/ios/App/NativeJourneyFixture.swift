#if DEBUG
import Foundation
import CryptoKit

/// Simulator journeys replace external transports, never the app's account,
/// outbox, persistence or voice state machines. This file has no Release code.
@MainActor enum NativeJourneyFixture {
    nonisolated static var enabled: Bool { JourneyConfiguration.enabled }
    nonisolated static var namespace: String { JourneyConfiguration.namespace }
    static var trace: String { JourneyTransport.store.trace() }
    static var service: ConversationService? {
        guard enabled else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [JourneyTransport.self]
        return ConversationService(session: URLSession(configuration: configuration), base: URL(string: "https://native-journey.invalid")!)
    }
    static func authenticate(url: URL) async throws -> URL? {
        guard enabled else { return nil }
        try await Task.sleep(nanoseconds: 150_000_000)
        try Task.checkCancellation()
        return try JourneyTransport.store.callback(url)
    }
    static func speech(deliver: @escaping @MainActor (String, Bool) -> Void) -> Task<Void, Never>? {
        guard enabled else { return nil }
        let capture = JourneyTransport.store.nextSpeech()
        let hold = JourneyConfiguration.scenario == "voice-hold" || capture > 1
        let text = hold ? "Keep this spoken draft without sending" : "I want to understand my next step"
        return Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                try Task.checkCancellation(); deliver(text, false)
                if !hold {
                    try await Task.sleep(nanoseconds: 300_000_000)
                    try Task.checkCancellation(); JourneyTransport.store.finishedSpeech(); deliver(text, true)
                } else {
                    // Continue revising partial recognition like ongoing speech.
                    // Stop/background must cancel this producer; a delayed test
                    // must not accidentally let silence submit the held draft.
                    for revision in 1...50 {
                        try await Task.sleep(nanoseconds: 400_000_000)
                        try Task.checkCancellation(); deliver(text + String(repeating: ".", count: revision), false)
                    }
                }
            } catch { /* Stopping/backgrounding invalidates this capture. */ }
        }
    }
}

private enum JourneyConfiguration {
    static let scenario = ProcessInfo.processInfo.environment["HP_NATIVE_JOURNEY"] ?? ""
    static let namespace = ProcessInfo.processInfo.environment["HP_NATIVE_JOURNEY_ID"] ?? ""
    static let enabled = ProcessInfo.processInfo.arguments.contains("--native-journey")
        && ["first-answer", "retry-once", "voice-answer", "voice-hold", "sign-in-expired", "access-denied", "queued-voice"].contains(scenario)
        && !namespace.isEmpty && namespace.utf8.count <= 64
        && namespace.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 }
}

private final class JourneyTransport: URLProtocol, @unchecked Sendable {
    static let store = JourneyStore()
    private let stopLock = NSLock()
    private var stopped = false
    private var delayed: DispatchWorkItem?
    // This protocol is installed only in the fixture's private session. Accept
    // every request so an unexpected URL fails locally instead of reaching DNS.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let delay = Self.store.responseDelay(request)
        guard delay > 0 else { complete(); return }
        let work = DispatchWorkItem { [weak self] in self?.complete() }
        stopLock.lock(); delayed = work; let cancelled = stopped; stopLock.unlock()
        if cancelled { work.cancel(); return }
        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
    }
    private func complete() {
        stopLock.lock(); let cancelled = stopped; stopLock.unlock()
        guard !cancelled else { return }
        do {
            let (status, object) = try Self.store.respond(request)
            guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { throw URLError(.badServerResponse) }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: object))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {
        stopLock.lock(); stopped = true; delayed?.cancel(); delayed = nil; stopLock.unlock()
    }
}

private struct JourneyAcceptedTurn: Codable {
    let id: String
    let text: String
}
private struct JourneySnapshot: Codable {
    var paths: [String] = []
    var submittedIDs: [String] = []
    var submittedTexts: [String] = []
    var accepted: [JourneyAcceptedTurn] = []
    var state = ""
    var challenge = ""
    var callbacks = 0
    var speechCaptures = 0
    var desktopRequests = 0
    var retryFailures = 0
    var historyReads = 0
    var delayedHistoryReads = 0
    var speechEndedDuringHistory = 0
}
private final class JourneyStore: @unchecked Sendable {
    private let lock = NSLock()
    private let defaults = UserDefaults.standard
    private let key = "native-journey-server-" + JourneyConfiguration.namespace
    private let code = String(repeating: "a", count: 64)
    private let requestID = String(repeating: "b", count: 64)
    private var value: JourneySnapshot
    private var activeHistoryReads = 0
    init() {
        let key = "native-journey-server-" + JourneyConfiguration.namespace
        value = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(JourneySnapshot.self, from: $0) } ?? JourneySnapshot()
    }
    private func save() { if let bytes = try? JSONEncoder().encode(value) { defaults.set(bytes, forKey: key) } }
    func trace() -> String {
        lock.lock(); defer { lock.unlock() }
        let trace: [String: Any] = ["schema": "hps-native-journey-trace/1", "scenario": JourneyConfiguration.scenario,
            "paths": value.paths, "submitted_ids": value.submittedIDs, "submitted_texts": value.submittedTexts,
            "accepted_turns": value.accepted.count, "browser_callbacks": value.callbacks,
            "speech_captures": value.speechCaptures, "desktop_requests": value.desktopRequests,
            "history_reads": value.historyReads, "delayed_history_reads": value.delayedHistoryReads,
            "speech_ended_during_history": value.speechEndedDuringHistory,
            "physical_device": "NOT_RUN", "live_authentication": "NOT_RUN", "live_asr": "NOT_RUN"]
        return String(data: (try? JSONSerialization.data(withJSONObject: trace, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
    }
    func responseDelay(_ request: URLRequest) -> TimeInterval {
        lock.lock(); defer { save(); lock.unlock() }
        guard request.httpMethod == "GET", request.url?.path == "/v1/me/reflection" else { return 0 }
        value.historyReads += 1
        guard JourneyConfiguration.scenario == "queued-voice", value.historyReads >= 2 else { return 0 }
        activeHistoryReads += 1; value.delayedHistoryReads += 1
        return 2
    }
    func finishedSpeech() {
        lock.lock(); defer { save(); lock.unlock() }
        if activeHistoryReads > 0 { value.speechEndedDuringHistory += 1 }
    }
    func callback(_ url: URL) throws -> URL {
        lock.lock(); defer { save(); lock.unlock() }
        guard JourneyConfiguration.enabled, !value.state.isEmpty,
              url.scheme == "https", url.host == "hypeproof-ai.xyz", url.path == "/api/studio-native",
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "request" })?.value == requestID else { throw URLError(.badServerResponse) }
        if JourneyConfiguration.scenario == "sign-in-expired" { throw URLError(.timedOut) }
        value.callbacks += 1
        return URL(string: "hypeproof-studio-mobile://account-return?code=" + code + "&state=" + value.state)!
    }
    func nextSpeech() -> Int {
        lock.lock(); defer { save(); lock.unlock() }
        value.speechCaptures += 1; return value.speechCaptures
    }
    private func requestBody(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if data.isEmpty, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 2048)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count >= 0, data.count + count <= 16384 else { throw URLError(.dataLengthExceedsMaximum) }
                if count == 0 { break }; data.append(contentsOf: buffer.prefix(count))
            }
        }
        guard !data.isEmpty else { return [:] }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.cannotParseResponse) }
        return result
    }
    private func reflection(acknowledged: String? = nil) -> [String: Any] {
        var messages: [[String: Any]] = []
        for (index, turn) in value.accepted.enumerated() {
            let userMessage: [String: Any] = [
                "id": turn.id, "role": "user", "content": turn.text,
                "created_at": (index * 2 + 1) * 1000,
            ]
            let assistantMessage: [String: Any] = [
                "id": "answer-" + turn.id, "role": "assistant",
                "content": "What small change would make tomorrow better?",
                "created_at": (index * 2 + 2) * 1000,
            ]
            messages.append(userMessage)
            messages.append(assistantMessage)
        }
        var state: [String: Any] = ["id": "personal-reflection", "revision": value.accepted.count * 2,
                                   "messages": messages, "has_earlier": false, "turn": NSNull()]
        if let last = value.accepted.last {
            state["turn"] = ["id": last.id, "text": last.text, "status": "completed", "created_at": 1000, "updated_at": 2000]
        }
        return ["state": state, "opening": "What would you like to understand about yourself?", "hint": "One unfinished thought is enough.",
                "acknowledged_id": acknowledged as Any? ?? NSNull()]
    }
    func respond(_ request: URLRequest) throws -> (Int, [String: Any]) {
        lock.lock(); defer { save(); lock.unlock() }
        guard JourneyConfiguration.enabled, request.url?.host == "native-journey.invalid", request.url?.scheme == "https" else { throw URLError(.unsupportedURL) }
        let path = request.url!.path, method = request.httpMethod ?? "GET"
        value.paths.append(method + " " + path)
        let body = try requestBody(request)
        switch (method, path) {
        case ("POST", "/v1/auth/native/start"):
            guard let state = body["state"] as? String, state.utf8.count == 64,
                  let challenge = body["code_challenge"] as? String, challenge.utf8.count == 43,
                  body["code_challenge_method"] as? String == "S256",
                  body["redirect_uri"] as? String == "hypeproof-studio-mobile://account-return" else { return (400, ["error": "invalid_request"]) }
            value.state = state; value.challenge = challenge
            return (200, ["authorization_uri": "https://hypeproof-ai.xyz/api/studio-native?request=" + requestID, "expires_in": 600])
        case ("POST", "/v1/auth/native/exchange"):
            guard body["code"] as? String == code, let verifier = body["code_verifier"] as? String,
                  body["redirect_uri"] as? String == "hypeproof-studio-mobile://account-return", value.callbacks > 0 else { return (400, ["error": "invalid_request"]) }
            let actual = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
            guard actual == value.challenge else { return (400, ["error": "invalid_grant"]) }
            return (200, ["access_token": "journey-access", "refresh_token": String(repeating: "c", count: 64), "expires_in": 3600, "session_id": "journey-session"])
        case ("POST", "/v1/auth/logout"): return (200, ["ok": true])
        default: break
        }
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer journey-access" else { return (401, ["error": "account_required"]) }
        switch (method, path) {
        case ("GET", "/v1/me"):
            return (200, ["account": ["id": "journey-account", "status": "active"], "session_id": "journey-session"])
        case ("GET", "/v1/me/conversations"): return (200, ["conversations": []])
        case ("GET", "/v1/me/reflection"):
            activeHistoryReads = max(0, activeHistoryReads - 1)
            return (200, reflection())
        case ("POST", "/v1/me/reflection/turns"):
            guard let id = body["id"] as? String, let text = body["text"] as? String,
                  let revision = body["revision"] as? Int else { return (400, ["error": "invalid_request"]) }
            value.submittedIDs.append(id); value.submittedTexts.append(text)
            if JourneyConfiguration.scenario == "access-denied" { return (403, ["error": "reflection_access_required"]) }
            if JourneyConfiguration.scenario == "retry-once", value.retryFailures == 0 {
                value.retryFailures += 1; return (503, ["error": "fixture_unavailable"])
            }
            if let old = value.accepted.first(where: { $0.id == id }) {
                return old.text == text ? (200, reflection(acknowledged: id)) : (409, ["error": "reflection_changed"])
            }
            guard revision == value.accepted.count * 2 else { return (409, ["error": "reflection_changed"]) }
            value.accepted.append(JourneyAcceptedTurn(id: id, text: text))
            return (200, reflection(acknowledged: id))
        default:
            if path.hasPrefix("/v1/me/conversations/") { value.desktopRequests += 1 }
            return (599, ["error": "unexpected_fixture_route"])
        }
    }
}
#endif
