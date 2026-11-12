import Foundation

/// Client interaction state only. Question selection remains Service-owned.
public struct VoiceTurn: Equatable, Sendable {
    public enum Mode: Equatable, Sendable { case dictation, conversation }
    public enum Phase: Equatable, Sendable { case idle, authorizing, listening, finalizing, waiting, speaking, ready }
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
    private var text = ""
    public init(now: Double) { startedAt = now }
    public mutating func audio(rms: Double, now: Double) {
        if rms.isFinite && rms >= 0.012 { lastSpeech = now }
    }
    public mutating func recognized(_ value: String, now: Double) {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if value != text { text = value; lastRevision = now }
    }
    public func decision(now: Double) -> Decision {
        if now - startedAt >= 30 { return text.isEmpty ? .noSpeech : .finish }
        guard !text.isEmpty, let revision = lastRevision else { return .listen }
        return now - max(revision, lastSpeech ?? revision) >= 1.6 ? .finish : .listen
    }
}
