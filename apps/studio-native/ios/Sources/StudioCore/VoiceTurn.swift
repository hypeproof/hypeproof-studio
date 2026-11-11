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
