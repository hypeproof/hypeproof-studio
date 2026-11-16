import Foundation

/// Select from the device's installed catalog; never infer quality from its order.
public enum KoreanVoiceSelection {
    public enum Quality: String, Sendable {
        case unknown, standard, enhanced, premium
        fileprivate var rank: Int {
            switch self {
            case .unknown: return 0
            case .standard: return 1
            case .enhanced: return 2
            case .premium: return 3
            }
        }
    }
    public struct Candidate: Sendable {
        public let language: String
        public let quality: Quality
        public let isNovelty: Bool
        public let isPersonal: Bool
        public init(language: String, quality: Quality, isNovelty: Bool = false, isPersonal: Bool = false) {
            self.language = language; self.quality = quality
            self.isNovelty = isNovelty; self.isPersonal = isPersonal
        }
    }
    public static func preferredIndex(in installed: [Candidate]) -> Int? {
        var best: Int?
        for index in installed.indices where installed[index].language == "ko-KR"
            && !installed[index].isNovelty && !installed[index].isPersonal {
            // Unknown future qualities remain a last local fallback. Equal
            // qualities keep their original order rather than changing voices.
            if let current = best, installed[current].quality.rank >= installed[index].quality.rank { continue }
            best = index
        }
        return best
    }
}

/// Client interaction state only. Question selection remains Service-owned.
public struct VoiceTurn: Equatable, Sendable {
    public enum Mode: Equatable, Sendable { case dictation, conversation }
    public enum Phase: String, Equatable, Sendable { case idle, authorizing, listening, finalizing, waiting, speaking, ready }
    public private(set) var token = UUID()
    public private(set) var projectID: String?
    public private(set) var mode: Mode = .dictation
    public private(set) var phase: Phase = .idle
    public init() {}
    @discardableResult public mutating func start(projectID: String, mode: Mode) -> UUID {
        token = UUID(); self.projectID = projectID; self.mode = mode; phase = .authorizing
        return token
    }
    public mutating func advance(_ token: UUID, from: [Phase], to next: Phase) -> Bool {
        guard self.token == token, projectID != nil, from.contains(phase) else { return false }
        phase = next; return true
    }
    public mutating func stop() { token = UUID(); projectID = nil; phase = .idle }
}

/// Endpoint detection uses both voice activity and stable recognition. A pause
/// before the first word cannot send an empty turn; a recognition stall cannot
/// cut off speech that is still audible. Times are monotonic seconds.
public struct VoiceEndpoint: Sendable {
    public enum Decision: Equatable { case listen, finish, noSpeech }
    private let startedAt: Double
    private var lastSpeech: Double?
    private var lastRevision: Double?
    public private(set) var transcript = ""
    public init(now: Double) { startedAt = now }
    public mutating func audio(rms: Double, now: Double) {
        if rms.isFinite && rms >= 0.012 { lastSpeech = now }
    }
    public mutating func recognized(_ value: String, now: Double) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // Empty recognizer updates are not a retraction of words already heard.
        // In particular, an empty final callback must not erase a useful partial.
        guard !value.isEmpty else { return }
        if value != transcript { transcript = value; lastRevision = now }
    }
    public func decision(now: Double) -> Decision {
        if now - startedAt >= 30 { return transcript.isEmpty ? .noSpeech : .finish }
        guard !transcript.isEmpty, let revision = lastRevision else { return .listen }
        return now - max(revision, lastSpeech ?? revision) >= 1.6 ? .finish : .listen
    }
}

/// A bounded, memory-only troubleshooting record. This API accepts no user text,
/// account identifiers, credentials, audio, URLs or free-form error messages.
public struct VoiceTimeline: Sendable {
    public enum Event: String, Sendable {
        case start, restart, speechPermissionGranted, microphonePermissionGranted
        case speechPermissionRequested, microphonePermissionRequested
        case captureStarting, captureStarted, captureAudioObserved, captureFailed, audioDeactivationFailed
        case inputBuiltIn, inputWired, inputBluetoothHFP, inputOther, inputUnavailable
        case syntheticCaptureStarted, syntheticPlaybackQueued, syntheticPlaybackFinished
        case playbackQueued, playbackStarted, playbackFinished, playbackCancelled
        case ready, continuationRequested, stalePlaybackCallback
        case stopped, background, interrupted, routeChanged, scopeChanged
        case draftPresent, requestOutstanding, notReady, failed
        case emptyRecognition, noSpeechRetryScheduled, noSpeechRetry, noSpeechPaused, partialRetained
    }
    public struct Entry: Sendable {
        public let milliseconds: Int
        public let event: Event
        public let phase: VoiceTurn.Phase
    }
    public private(set) var entries: [Entry] = []
    private var origin: Double?
    public init() {}
    public mutating func record(_ event: Event, phase: VoiceTurn.Phase, now: Double) {
        guard now.isFinite else { return }
        if origin == nil { origin = now }
        let elapsed = min(86_400_000, max(0, (now - (origin ?? now)) * 1_000))
        entries.append(Entry(milliseconds: max(entries.last?.milliseconds ?? 0, Int(elapsed)), event: event, phase: phase))
        if entries.count > 96 { entries.removeFirst(entries.count - 96) }
    }
    public var export: String {
        (["hps-voice-timeline/1; relative milliseconds; no audio or conversation content"]
         + entries.map { "\($0.milliseconds) \($0.event.rawValue) \($0.phase.rawValue)" }).joined(separator: "\n")
    }
}
