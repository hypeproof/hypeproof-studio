#if DEBUG
import Foundation
import CryptoKit

/// Simulator journeys replace external transports, never the app's account,
/// outbox, persistence or voice state machines. This file has no Release code.
@MainActor enum NativeJourneyFixture {
    nonisolated static var enabled: Bool { JourneyConfiguration.enabled }
    nonisolated static var namespace: String { JourneyConfiguration.namespace }
    static var trace: String {
        let value = JourneyTransport.store.trace()
        guard !emptyStopBoundary.isEmpty,
              var fields = (try? JSONSerialization.jsonObject(with: Data(value.utf8))) as? [String: Any] else { return value }
        fields["empty_stop_boundary"] = emptyStopBoundary
        return String(data: (try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? value
    }
    static var responseStop: Bool { enabled && JourneyConfiguration.scenario.hasPrefix("response-stop") }
    static var realPlayback: Bool { enabled && JourneyConfiguration.scenario == "voice-playback-real" }
    static var heldPlayback: Bool { enabled && JourneyConfiguration.scenario == "voice-playback-held" }
    static var longHistory: Bool { enabled && JourneyConfiguration.scenario == "long-history" }
    static var logoutSync: Bool { enabled && JourneyConfiguration.scenario == "logout-sync" }
    static var syncRecovery: Bool { enabled && ["desktop-list-held", "history-timeout", "history-cancelled"].contains(JourneyConfiguration.scenario) }
    private(set) static var emptyStopBoundary: [String: Any] = [:]
    static func recordEmptyStopBoundary(active: Bool, phase: String) {
        guard enabled, JourneyConfiguration.scenario == "voice-empty-results" else { return }
        emptyStopBoundary = ["active": active, "phase": phase]
    }
    static func advanceHistory() { if longHistory { JourneyTransport.store.advanceHistory() } }
    static func holdNextHistory() { if logoutSync { JourneyTransport.store.armHistory() } }
    static func releaseHistory() { if logoutSync { JourneyTransport.store.releaseHistory() } }
    static func voiceStartAttempt(mode: String, hasSelection: Bool, canSend: Bool, draftEmpty: Bool) {
        guard enabled else { return }
        JourneyTransport.store.voiceStartAttempt(mode: mode, hasSelection: hasSelection, canSend: canSend, draftEmpty: draftEmpty)
    }
    static var service: ConversationService? {
        guard enabled else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [JourneyTransport.self]
        return ConversationService(session: URLSession(configuration: configuration), base: URL(string: "https://native-journey.invalid")!)
    }
    static func authenticate(url: URL) async throws -> URL? {
        guard enabled else { return nil }
        if JourneyConfiguration.scenario == "sign-in-cancel" {
            // The UI cancels the real model operation while this owned transport
            // is suspended. Bound a missing Cancel action rather than hang CI.
            try await Task.sleep(nanoseconds: 15_000_000_000)
            throw CancellationError()
        }
        try await Task.sleep(nanoseconds: 150_000_000)
        try Task.checkCancellation()
        return try JourneyTransport.store.callback(url)
    }
    static func seedAccountDraftIfNeeded(at url: URL, accountID: String) throws {
        guard enabled, JourneyConfiguration.scenario == "draft-collision", accountID == "journey-account",
              !FileManager.default.fileExists(atPath: url.path) else { return }
        // Simulate an existing local account draft. Do not rewrite it on relaunch
        // or mint a credential; account lookup and file decoding remain real.
        var cache = ConversationCache(); cache.draft = "Existing account draft"
        let entry = try JSONSerialization.jsonObject(with: JSONEncoder().encode(cache))
        let snapshot: [String: Any] = ["accountID": accountID, "conversations": [],
                                       "entries": ["personal-reflection": entry]]
        try JSONSerialization.data(withJSONObject: snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func speech(deliver: @escaping @MainActor (String, Bool) -> Void,
                       stopAfterEmpty: @escaping @MainActor () -> Void = {}) -> Task<Void, Never>? {
        guard enabled else { return nil }
        let capture = JourneyTransport.store.nextSpeech()
        if JourneyConfiguration.scenario == "voice-empty-results" {
            return Task { @MainActor in
                do {
                    try await Task.sleep(nanoseconds: 200_000_000)
                    try Task.checkCancellation()
                    // Real controller sees partial -> empty final, an empty
                    // post-playback capture, then useful speech and exhaustion.
                    if capture == 1 || capture == 3 {
                        deliver(capture == 1 ? "들리니" : "다음 생각도 이어갈게요", false)
                        try await Task.sleep(nanoseconds: 300_000_000)
                        try Task.checkCancellation()
                    }
                    JourneyTransport.store.finishedSpeech(); deliver("", true)
                    JourneyTransport.store.deliveredSpeech()
                    if capture == 7 {
                        // After the real empty-result handler schedules its350ms
                        // retry, invoke the actual controller Stop synchronously.
                        // This is timer cancellation evidence, not a user tap.
                        stopAfterEmpty()
                    }
                } catch { /* Stop/background cancels the recognizer producer. */ }
            }
        }
        let hold = JourneyConfiguration.scenario == "voice-hold" || capture > 1
        let text = hold ? "Keep this spoken draft without sending" : "I want to understand my next step"
        return Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                try Task.checkCancellation(); deliver(text, false)
                if !hold {
                    try await Task.sleep(nanoseconds: 300_000_000)
                    try Task.checkCancellation(); JourneyTransport.store.finishedSpeech(); deliver(text, true)
                    JourneyTransport.store.deliveredSpeech()
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
        && ["first-answer", "retry-once", "pending-text-mismatch", "response-stop", "response-stop-denied", "voice-answer", "voice-hold", "voice-playback-real", "voice-playback-held", "voice-empty-results", "sign-in-expired", "sign-in-network-failure", "desktop-list-held", "history-timeout", "history-cancelled", "sign-in-cancel", "draft-collision", "access-denied", "queued-voice", "recorded-failure", "long-history", "logout-sync", "member-inbox"].contains(scenario)
        && !namespace.isEmpty && namespace.utf8.count <= 64
        && namespace.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 }
}

private final class JourneyTransport: URLProtocol, @unchecked Sendable {
    static let store = JourneyStore()
    private let stopLock = NSLock()
    private var stopped = false
    private var delayed: DispatchWorkItem?
    private let historyID = UUID()
    private var heldResponse = false
    private var delayedResponse: (Int, [String: Any])?
    // This protocol is installed only in the fixture's private session. Accept
    // every request so an unexpected URL fails locally instead of reaching DNS.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            // Hold only the desktop discovery response, after validating and
            // recording its actual authenticated request. The production HTTP
            // deadline or app teardown owns cancellation; no fixture retry.
            if try holdDesktopListIfNeeded() { return }
            if try Self.store.beginHeldResponse(request) {
                heldResponse = true
                waitForResponse(deadline: ProcessInfo.processInfo.systemUptime + 20)
                return
            }
            if JourneyConfiguration.scenario == "response-stop", request.url?.path.hasSuffix("/cancel") == true {
                // Commit cancel, then deliver the original POST's terminal error
                // before this acknowledgement. Exercise the real model race.
                delayedResponse = try Self.store.respond(request)
                waitForCancelAcknowledgement(deadline: ProcessInfo.processInfo.systemUptime + 5)
                return
            }
        } catch { client?.urlProtocol(self, didFailWithError: error); return }
        guard Self.store.holdHistory(request, id: historyID) else { complete(); return }
        // UI-driven logout has several real controls before explicit release.
        // Its DEBUG-only read budget is 90s; all other scenarios keep 20s/25s.
        waitForSpeech(deadline: ProcessInfo.processInfo.systemUptime + (JourneyConfiguration.scenario == "logout-sync" ? 60 : 20))
    }
    private func holdDesktopListIfNeeded() throws -> Bool {
        stopLock.lock(); defer { stopLock.unlock() }
        guard !stopped else { return true }
        return try Self.store.beginHeldDesktopList(request, id: historyID)
    }
    private func waitForCancelAcknowledgement(deadline: TimeInterval) {
        stopLock.lock(); let cancelled = stopped; stopLock.unlock()
        guard !cancelled else { return }
        if Self.store.originalResponseReturned() { complete(); return }
        if ProcessInfo.processInfo.systemUptime >= deadline {
            delayedResponse = (599, ["error": "fixture_response_barrier_timeout"]); complete(); return
        }
        let work = DispatchWorkItem { [weak self] in self?.waitForCancelAcknowledgement(deadline: deadline) }
        stopLock.lock(); delayed = work; let stoppedBeforeSchedule = stopped; stopLock.unlock()
        if stoppedBeforeSchedule { work.cancel(); return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05, execute: work)
    }
    private func waitForResponse(deadline: TimeInterval) {
        stopLock.lock(); let cancelled = stopped; stopLock.unlock()
        guard !cancelled else { return }
        if Self.store.responseMayFinish() || ProcessInfo.processInfo.systemUptime >= deadline { complete(); return }
        let work = DispatchWorkItem { [weak self] in self?.waitForResponse(deadline: deadline) }
        stopLock.lock(); delayed = work; let stoppedBeforeSchedule = stopped; stopLock.unlock()
        if stoppedBeforeSchedule { work.cancel(); return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.05, execute: work)
    }
    private func waitForSpeech(deadline: TimeInterval) {
        stopLock.lock(); let cancelled = stopped; stopLock.unlock()
        guard !cancelled else { Self.store.cancelHistory(historyID); return }
        if Self.store.historyMayFinish() { complete(historyOutcome: JourneyConfiguration.scenario == "logout-sync" ? .explicitRelease : .speech); return }
        if ProcessInfo.processInfo.systemUptime >= deadline {
            complete(historyOutcome: .timeout); return
        }
        let work = DispatchWorkItem { [weak self] in self?.waitForSpeech(deadline: deadline) }
        stopLock.lock(); delayed = work; let stoppedBeforeSchedule = stopped; stopLock.unlock()
        if stoppedBeforeSchedule { work.cancel(); Self.store.cancelHistory(historyID); return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.1, execute: work)
    }
    private func complete(historyOutcome: JourneyHistoryOutcome? = nil) {
        stopLock.lock()
        if stopped { stopLock.unlock(); Self.store.cancelHistory(historyID); return }
        // Resolve under the same lock as stopLoading, but never hold that lock
        // across client callbacks (URLSession may synchronously stop loading).
        if let historyOutcome { Self.store.finishHistory(historyID, outcome: historyOutcome) }
        stopLock.unlock()
        do {
            let result: (Int, [String: Any])
            if let delayedResponse { result = delayedResponse }
            else if heldResponse { result = Self.store.finishHeldResponse() }
            else { result = try Self.store.respond(request) }
            let (status, object) = result
            guard let url = request.url, let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]) else { throw URLError(.badServerResponse) }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: object))
            client?.urlProtocolDidFinishLoading(self)
            if heldResponse { Self.store.markOriginalResponseDelivered() }
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {
        stopLock.lock(); stopped = true; delayed?.cancel(); delayed = nil
        Self.store.cancelHistory(historyID)
        Self.store.cancelDesktopList(historyID)
        stopLock.unlock()
    }
}

private enum JourneyHistoryOutcome { case speech, explicitRelease, timeout }

private struct JourneyAcceptedTurn: Codable {
    let id: String
    let text: String
}
private struct JourneySnapshot: Codable {
    var paths: [String] = []
    var submittedIDs: [String] = []
    var submittedTexts: [String] = []
    var accepted: [JourneyAcceptedTurn] = []
    var failed: JourneyAcceptedTurn?
    var additionalFailures: [JourneyAcceptedTurn]?
    var historyAccount: Int?
    var historyAdvances: Int?
    var heldTurn: JourneyAcceptedTurn?
    var responseCancelled: Bool?
    var cancelledRequests: [String]?
    var heldResponseReturns: Int?
    var stopHistoryRead: Bool?
    var state = ""
    var challenge = ""
    var callbacks = 0
    var speechCaptures = 0
    var voiceStartAttempts: [String] = []
    var desktopRequests = 0
    var retryFailures = 0
    var historyReads = 0
    var historyTimeoutFailures: Int?
    var historyCancellationFailures: Int?
    var submittedWhileDesktopListHeld: Int?
    var delayedHistoryReads = 0
    var speechEndedDuringHistory = 0
    var approvalDecisionID: String?
    var approvalDecisionChoice: String?
}
private final class JourneyStore: @unchecked Sendable {
    private let lock = NSLock()
    private let defaults = UserDefaults.standard
    private let key = "native-journey-server-" + JourneyConfiguration.namespace
    private let code = String(repeating: "a", count: 64)
    private let requestID = String(repeating: "b", count: 64)
    private var value: JourneySnapshot
    private var activeHistoryReads: Set<UUID> = []
    private var activeDesktopLists: Set<UUID> = []
    private var desktopListStarts = 0
    private var desktopListCancellations = 0
    private var speechDelivered = false
    private var historyArmed = false
    private var historyReleased = false
    private var logoutDuringHistory = 0
    private var historyBarrierTimeouts = 0
    private var historyBarrierCompletions = 0
    private var historyBarrierCancellations = 0
    init() {
        let key = "native-journey-server-" + JourneyConfiguration.namespace
        value = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(JourneySnapshot.self, from: $0) } ?? JourneySnapshot()
        if JourneyConfiguration.scenario == "long-history", value.historyAccount == nil {
            value.historyAccount = 1; seedHistory(); save()
        }
    }
    private var failedTurns: [JourneyAcceptedTurn] { (value.failed.map { [$0] } ?? []) + (value.additionalFailures ?? []) }
    private var historyAccount: Int { value.historyAccount ?? 1 }
    private var switchesAccounts: Bool { ["long-history", "logout-sync"].contains(JourneyConfiguration.scenario) }
    private var sessionID: String { switchesAccounts ? "journey-session-\(historyAccount)" : "journey-session" }
    private var accessToken: String { switchesAccounts ? "journey-access-\(historyAccount)" : "journey-access" }
    private var accountID: String { switchesAccounts ? "journey-account-\(historyAccount)" : "journey-account" }
    private func seedHistory() {
        value.accepted = (1...40).map { number in
            JourneyAcceptedTurn(id: "history-\(historyAccount)-\(number)", text: "Account \(historyAccount) thought \(number). I am saving this question to continue later.")
        }
    }
    func advanceHistory() {
        lock.lock(); defer { save(); lock.unlock() }
        guard JourneyConfiguration.scenario == "long-history" else { return }
        let number = value.accepted.count + 1
        value.accepted.append(JourneyAcceptedTurn(id: "history-\(historyAccount)-\(number)", text: "Account \(historyAccount) thought \(number). A new question from another device."))
        value.historyAdvances = (value.historyAdvances ?? 0) + 1
    }
    private func save() { if let bytes = try? JSONEncoder().encode(value) { defaults.set(bytes, forKey: key) } }
    func trace() -> String {
        lock.lock(); defer { lock.unlock() }
        let trace: [String: Any] = ["schema": "hps-native-journey-trace/1", "scenario": JourneyConfiguration.scenario,
            "paths": value.paths, "submitted_ids": value.submittedIDs, "submitted_texts": value.submittedTexts,
            "cancelled_requests": value.cancelledRequests ?? [], "held_response_returns": value.heldResponseReturns ?? 0,
            "accepted_turns": value.accepted.count, "failed_turns": failedTurns.count, "browser_callbacks": value.callbacks,
            "speech_captures": value.speechCaptures, "desktop_requests": value.desktopRequests,
            "history_account": historyAccount, "history_advances": value.historyAdvances ?? 0,
            "history_window_messages": min(80, value.accepted.count * 2 + failedTurns.count), "history_revision": value.accepted.count * 2 + failedTurns.count,
            "voice_start_attempts": value.voiceStartAttempts,
            "history_reads": value.historyReads, "delayed_history_reads": value.delayedHistoryReads,
            "history_timeout_failures": value.historyTimeoutFailures ?? 0,
            "history_cancellation_failures": value.historyCancellationFailures ?? 0,
            "desktop_list_starts": desktopListStarts, "held_desktop_lists": activeDesktopLists.count,
            "desktop_list_cancellations": desktopListCancellations,
            "submitted_while_desktop_list_held": value.submittedWhileDesktopListHeld ?? 0,
            "speech_ended_during_history": value.speechEndedDuringHistory,
            "history_barrier_timeouts": historyBarrierTimeouts,
            "history_barrier_completions": historyBarrierCompletions,
            "history_barrier_cancellations": historyBarrierCancellations,
            "logout_requests": value.paths.filter { $0 == "POST /v1/auth/logout" }.count,
            "logout_during_history": logoutDuringHistory,
            "physical_device": "NOT_RUN", "live_authentication": "NOT_RUN", "live_asr": "NOT_RUN"]
        return String(data: (try? JSONSerialization.data(withJSONObject: trace, options: [.sortedKeys])) ?? Data(), encoding: .utf8) ?? "{}"
    }
    func beginHeldResponse(_ request: URLRequest) throws -> Bool {
        guard JourneyConfiguration.scenario.hasPrefix("response-stop"), request.httpMethod == "POST",
              request.url?.path == "/v1/me/reflection/turns" else { return false }
        let (status, _) = try respond(request)
        guard status == 202 else { throw URLError(.badServerResponse) }
        return true
    }
    func beginHeldDesktopList(_ request: URLRequest, id: UUID) throws -> Bool {
        guard JourneyConfiguration.scenario == "desktop-list-held", request.httpMethod == "GET",
              request.url?.path == "/v1/me/conversations" else { return false }
        let (status, _) = try respond(request)
        guard status == 200 else { throw URLError(.badServerResponse) }
        lock.lock(); defer { lock.unlock() }
        desktopListStarts += 1; activeDesktopLists.insert(id)
        return true
    }
    func cancelDesktopList(_ id: UUID) {
        lock.lock(); defer { lock.unlock() }
        if activeDesktopLists.remove(id) != nil { desktopListCancellations += 1 }
    }
    func responseMayFinish() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return value.responseCancelled == true || (JourneyConfiguration.scenario == "response-stop-denied" && value.stopHistoryRead == true)
    }
    func originalResponseReturned() -> Bool {
        lock.lock(); defer { lock.unlock() }; return (value.heldResponseReturns ?? 0) > 0
    }
    func markOriginalResponseDelivered() {
        lock.lock(); defer { save(); lock.unlock() }
        value.heldResponseReturns = (value.heldResponseReturns ?? 0) + 1
    }
    func finishHeldResponse() -> (Int, [String: Any]) {
        lock.lock(); defer { save(); lock.unlock() }
        if JourneyConfiguration.scenario == "response-stop-denied" { return (403, ["error": "reflection_access_required"]) }
        // Service refuses the late answer because the row is no longer running.
        return (404, ["error": "reflection_unavailable"])
    }
    func holdHistory(_ request: URLRequest, id: UUID) -> Bool {
        lock.lock(); defer { save(); lock.unlock() }
        guard request.httpMethod == "GET", request.url?.path == "/v1/me/reflection" else { return false }
        value.historyReads += 1
        let queuedVoice = JourneyConfiguration.scenario == "queued-voice" && value.historyReads == 2
        let logout = JourneyConfiguration.scenario == "logout-sync" && historyArmed
        guard queuedVoice || logout else { return false }
        if logout { historyArmed = false; historyReleased = false }
        activeHistoryReads.insert(id); value.delayedHistoryReads += 1
        return true
    }
    func historyMayFinish() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return JourneyConfiguration.scenario == "logout-sync" ? historyReleased : speechDelivered
    }
    func armHistory() {
        lock.lock(); defer { lock.unlock() }; historyArmed = true
    }
    func releaseHistory() {
        lock.lock(); defer { lock.unlock() }; historyReleased = true
    }
    func finishHistory(_ id: UUID, outcome: JourneyHistoryOutcome) {
        lock.lock(); defer { lock.unlock() }
        guard activeHistoryReads.remove(id) != nil else { return }
        switch outcome {
        case .speech, .explicitRelease: historyBarrierCompletions += 1
        case .timeout: historyBarrierTimeouts += 1
        }
    }
    func cancelHistory(_ id: UUID) {
        lock.lock(); defer { lock.unlock() }
        if activeHistoryReads.remove(id) != nil { historyBarrierCancellations += 1 }
    }
    func finishedSpeech() {
        lock.lock(); defer { save(); lock.unlock() }
        if !activeHistoryReads.isEmpty { value.speechEndedDuringHistory += 1 }
    }
    func deliveredSpeech() {
        // Release only after the real voice callback has synchronously queued
        // its durable send. UI automation latency cannot outrun a fixed delay.
        lock.lock(); defer { lock.unlock() }; speechDelivered = true
    }
    func callback(_ url: URL) throws -> URL {
        lock.lock(); defer { save(); lock.unlock() }
        guard JourneyConfiguration.enabled, !value.state.isEmpty,
              url.scheme == "https", url.host == "hypeproof-ai.xyz", url.path == "/api/studio-native",
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "request" })?.value == requestID else { throw URLError(.badServerResponse) }
        if JourneyConfiguration.scenario == "sign-in-network-failure" { throw URLError(.timedOut) }
        value.callbacks += 1
        if JourneyConfiguration.scenario == "sign-in-expired" {
            return URL(string: "hypeproof-studio-mobile://account-return?error=login_expired&state=" + value.state)!
        }
        return URL(string: "hypeproof-studio-mobile://account-return?code=" + code + "&state=" + value.state)!
    }
    func nextSpeech() -> Int {
        lock.lock(); defer { save(); lock.unlock() }
        value.speechCaptures += 1; return value.speechCaptures
    }
    func voiceStartAttempt(mode: String, hasSelection: Bool, canSend: Bool, draftEmpty: Bool) {
        lock.lock(); defer { save(); lock.unlock() }
        // Only synthetic journey state, never account IDs or dictated words.
        // Keep this bounded even when a future UI test repeatedly starts voice.
        if value.voiceStartAttempts.count < 12 {
            value.voiceStartAttempts.append("mode=\(mode);selected=\(hasSelection);can_send=\(canSend);draft_empty=\(draftEmpty)")
        }
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
        if JourneyConfiguration.scenario == "pending-text-mismatch", let id = value.submittedIDs.first {
            // An unacknowledged send followed by an inconsistent history read.
            // Keep the real decoder/outbox responsible for retaining local words.
            return ["state": ["id": "personal-reflection", "revision": 1,
                              "messages": [["id": id, "role": "user", "content": "Different words from history", "created_at": 1000]],
                              "has_earlier": false, "turn": NSNull()],
                    "opening": "What would you like to understand about yourself?", "hint": "One unfinished thought is enough.",
                    "acknowledged_id": NSNull()]
        }
        if let held = value.heldTurn {
            return ["state": ["id": "personal-reflection", "revision": 1,
                    "messages": [["id": held.id, "role": "user", "content": held.text, "created_at": 1000]],
                    "has_earlier": false, "turn": ["id": held.id, "text": held.text,
                        "status": JourneyConfiguration.scenario == "response-stop-denied" ? "failed" : (value.responseCancelled == true ? "cancelled" : "running"), "created_at": 1000, "updated_at": 1000]],
                    "opening": "What would you like to understand about yourself?", "hint": "One unfinished thought is enough."]
        }
        var messages: [[String: Any]] = []
        let failureOffset = failedTurns.count
        for (index, failed) in failedTurns.enumerated() {
            messages.append(["id": failed.id, "role": "user", "content": failed.text, "created_at": (index + 1) * 1000])
        }
        for (index, turn) in value.accepted.enumerated() {
            let userMessage: [String: Any] = [
                "id": turn.id, "role": "user", "content": turn.text,
                "created_at": (index * 2 + 1 + failureOffset) * 1000,
            ]
            let assistantMessage: [String: Any] = [
                "id": "answer-" + turn.id, "role": "assistant",
                "content": JourneyConfiguration.scenario == "long-history" ? "Account \(historyAccount) answer \(index + 1). What would you like to try next? This saved reply stays with its own conversation." : (JourneyConfiguration.scenario == "voice-playback-real" ? "내일은 어떤 작은 일을 해 보고 싶나요?" : "What small change would make tomorrow better?"),
                "created_at": (index * 2 + 2 + failureOffset) * 1000,
            ]
            messages.append(userMessage)
            messages.append(assistantMessage)
        }
        var state: [String: Any] = ["id": "personal-reflection", "revision": value.accepted.count * 2 + failureOffset,
                                   "messages": JourneyConfiguration.scenario == "long-history" ? Array(messages.suffix(80)) : messages,
                                   "has_earlier": JourneyConfiguration.scenario == "long-history" && messages.count > 80, "turn": NSNull()]
        if let failed = failedTurns.last {
            state["turn"] = ["id": failed.id, "text": failed.text, "status": "failed", "created_at": 1000, "updated_at": 1000]
        }
        if let last = value.accepted.last {
            state["turn"] = ["id": last.id, "text": last.text, "status": "completed", "created_at": 1000, "updated_at": 2000]
        }
        return ["state": state, "opening": "What would you like to understand about yourself?", "hint": "One unfinished thought is enough.",
                "acknowledged_id": acknowledged as Any? ?? NSNull()]
    }
    private func approvalCard() -> [String: Any] {
        let now = Date().timeIntervalSince1970
        var decision: Any = NSNull()
        if let id = value.approvalDecisionID, let choice = value.approvalDecisionChoice {
            decision = ["id": id, "choice": choice, "status": "awaiting_processing", "created_at": now]
        }
        return ["id": "member-card", "request_digest": String(repeating: "d", count: 64),
                "source": ["repo": "hypeproof/hypeproof-studio", "pr": 3788, "head": String(repeating: "a", count: 40), "base": String(repeating: "b", count: 40), "policy_digest": String(repeating: "b", count: 64), "evidence_digest": String(repeating: "c", count: 64), "context_digest": String(repeating: "e", count: 64)],
                "reviewer": "synthetic-reviewer", "brief": ["authored": ["Small synthetic change"], "verified": ["Fixture evidence only"]],
                "state": value.approvalDecisionID == nil ? "pending" : "submitting", "created_at": now - 60,
                "expires_at": now + 3600, "lease_expires_at": now + 50, "can_decide": value.approvalDecisionID == nil,
                "unavailable_reason": NSNull(), "decision": decision, "review": NSNull()]
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
            return (200, ["access_token": accessToken, "refresh_token": String(repeating: "c", count: 64), "expires_in": 3600, "session_id": sessionID])
        case ("POST", "/v1/auth/logout"):
            if JourneyConfiguration.scenario == "logout-sync" {
                guard request.value(forHTTPHeaderField: "Authorization") == "Bearer " + accessToken else { return (401, ["error": "account_required"]) }
                if !activeHistoryReads.isEmpty { logoutDuringHistory += 1 }
                value.historyAccount = historyAccount == 1 ? 2 : 1
            }
            if JourneyConfiguration.scenario == "long-history" {
                value.historyAccount = historyAccount + 1; seedHistory()
            }
            return (200, ["ok": true])
        default: break
        }
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer " + accessToken else { return (401, ["error": "account_required"]) }
        switch (method, path) {
        case ("GET", "/v1/me"):
            return (200, ["account": ["id": accountID, "status": "active"], "session_id": sessionID])
        case ("GET", "/v1/me/approval-inbox"):
            return (200, ["schema": "hps-member-approval-inbox/1", "availability": JourneyConfiguration.scenario == "member-inbox" ? "ready" : "not_enrolled", "cards": JourneyConfiguration.scenario == "member-inbox" ? [approvalCard()] : []])
        case ("GET", "/v1/me/approval-inbox/member-card"): return (200, approvalCard())
        case ("POST", "/v1/me/approval-inbox/member-card/decisions"):
            guard Set(body.keys) == Set(["id", "request_digest", "choice"]), let id = body["id"] as? String, UUID(uuidString: id) != nil,
                  body["request_digest"] as? String == String(repeating: "d", count: 64), let choice = body["choice"] as? String, ["approve", "reject", "question"].contains(choice), value.approvalDecisionID == nil else { return (409, ["error": "approval_conflict"]) }
            value.approvalDecisionID = id; value.approvalDecisionChoice = choice
            // The durable server decision exists, but the first response is uncertain.
            return (503, ["error": "synthetic_response_lost"])
        case ("GET", "/v1/me/conversations"):
            if JourneyConfiguration.scenario == "long-history" {
                return (200, ["conversations": [["id": "history-peer", "title": "Saved desktop conversation", "host_session_id": "synthetic-host", "revision": 80, "updated_at": 80000]]])
            }
            return (200, ["conversations": []])
        case ("GET", "/v1/me/conversations/history-peer/requests") where JourneyConfiguration.scenario == "long-history":
            return (200, ["requests": []])
        case ("GET", "/v1/me/conversations/history-peer/events") where JourneyConfiguration.scenario == "long-history":
            let after = Int(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "after" })?.value ?? "0") ?? 0
            var events: [[String: Any]] = []
            for number in 1...80 where number > after {
                let message: [String: Any] = ["id": "peer-\(number)", "role": number % 2 == 0 ? "assistant" : "user", "content": "Desktop message \(number). A saved conversation with the same number of messages, but its own reading position.", "created_at": number * 1000]
                events.append(["seq": number, "client_event_id": "peer-event-\(number)", "message": message])
            }
            return (200, ["events": events, "cursor": 80, "has_more": false])
        case ("GET", "/v1/me/reflection"):
            if JourneyConfiguration.scenario == "history-cancelled", (value.historyCancellationFailures ?? 0) == 0 {
                value.historyCancellationFailures = 1
                throw URLError(.cancelled)
            }
            if JourneyConfiguration.scenario == "history-timeout", (value.historyTimeoutFailures ?? 0) == 0 {
                value.historyTimeoutFailures = 1
                throw URLError(.timedOut)
            }
            if JourneyConfiguration.scenario == "response-stop-denied", value.heldTurn != nil { value.stopHistoryRead = true }
            return (200, reflection())
        case ("POST", "/v1/me/reflection/turns"):
            guard let id = body["id"] as? String, let text = body["text"] as? String,
                  let revision = body["revision"] as? Int else { return (400, ["error": "invalid_request"]) }
            value.submittedIDs.append(id); value.submittedTexts.append(text)
            if !activeDesktopLists.isEmpty { value.submittedWhileDesktopListHeld = (value.submittedWhileDesktopListHeld ?? 0) + 1 }
            if JourneyConfiguration.scenario.hasPrefix("response-stop") {
                guard revision == 0, value.heldTurn == nil else { return (409, ["error": "reflection_changed"]) }
                value.heldTurn = JourneyAcceptedTurn(id: id, text: text)
                return (202, reflection())
            }
            if JourneyConfiguration.scenario == "pending-text-mismatch" {
                return (503, ["error": "fixture_unavailable"])
            }
            if JourneyConfiguration.scenario == "retry-once", value.retryFailures == 0 {
                value.retryFailures += 1; return (503, ["error": "fixture_unavailable"])
            }
            if let old = value.accepted.first(where: { $0.id == id }) {
                return old.text == text ? (200, reflection(acknowledged: id)) : (409, ["error": "reflection_changed"])
            }
            // Match Service's persisted failure: the user event and terminal ID
            // survive a failed response. Replaying that ID cannot run a new turn.
            if let failed = failedTurns.first(where: { $0.id == id }) {
                return failed.text == text ? (200, reflection(acknowledged: id)) : (409, ["error": "reflection_changed"])
            }
            guard revision == value.accepted.count * 2 + failedTurns.count else { return (409, ["error": "reflection_changed"]) }
            if JourneyConfiguration.scenario == "access-denied" || (JourneyConfiguration.scenario == "recorded-failure" && failedTurns.isEmpty) {
                let failed = JourneyAcceptedTurn(id: id, text: text)
                if value.failed == nil { value.failed = failed }
                else { value.additionalFailures = (value.additionalFailures ?? []) + [failed] }
                return JourneyConfiguration.scenario == "access-denied"
                    ? (403, ["error": "reflection_access_required"])
                    : (503, ["error": "reflection_ai_unavailable"])
            }
            value.accepted.append(JourneyAcceptedTurn(id: id, text: text))
            return (200, reflection(acknowledged: id))
        default:
            if JourneyConfiguration.scenario == "response-stop", method == "POST", let held = value.heldTurn,
               path == "/v1/me/reflection/turns/" + held.id + "/cancel", body.isEmpty {
                value.responseCancelled = true
                value.cancelledRequests = (value.cancelledRequests ?? []) + [held.id]
                return (200, reflection())
            }
            if path.hasPrefix("/v1/me/conversations/") { value.desktopRequests += 1 }
            return (599, ["error": "unexpected_fixture_route"])
        }
    }
}
#endif
