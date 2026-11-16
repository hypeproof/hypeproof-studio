import Foundation

/// Development transport control only. It does not authenticate an account or persist a conversation.
public struct VoiceEvaluationEnvelope: Codable, Equatable, Sendable {
    public enum Event: String, Codable, Sendable {
        case start, started, interrupt, interrupted, stop, stopped
    }
    public let version: Int
    public let sessionID: UUID
    public let turnID: UUID
    public let generation: UInt32
    public let event: Event
    public let audioTrack: String?
    public let reason: String?

    public init(version: Int = 1, sessionID: UUID, turnID: UUID, generation: UInt32,
                event: Event, audioTrack: String? = nil, reason: String? = nil) {
        self.version = version; self.sessionID = sessionID; self.turnID = turnID
        self.generation = generation; self.event = event; self.audioTrack = audioTrack; self.reason = reason
    }
    enum CodingKeys: String, CodingKey {
        case version, generation, event, reason
        case sessionID = "session_id", turnID = "turn_id", audioTrack = "audio_track"
    }
}

/// Rejects playback authority after interruption, session closure, or out-of-order data.
/// The adapter must separately disable/unsubscribe tracks and release its microphone.
public struct VoiceEvaluationSession: Sendable {
    public static let topic = "hps.voice.eval.v1"
    public static let evaluatorIdentity = "hps-voice-evaluator"
    public static let admissionAttribute = "hps.voice.eval.admitted_sid"

    /// Connect is not proof that the remote SDK has admitted this participant.
    public static func isAdmitted(participantIdentity: String, admittedSID: String?, localSID: String?) -> Bool {
        guard participantIdentity == evaluatorIdentity, let localSID, !localSID.isEmpty else { return false }
        return admittedSID == localSID
    }
    public enum Phase: String, Sendable { case ready, starting, playing, interrupted, stopped }
    public let sessionID: UUID
    public private(set) var turnID: UUID?
    public private(set) var generation: UInt32 = 0
    public private(set) var phase: Phase = .ready
    public private(set) var authorizedTrack: String?

    public init(sessionID: UUID = UUID()) { self.sessionID = sessionID }

    public static func trackName(sessionID: UUID, generation: UInt32) -> String {
        "hps-eval.\(sessionID.uuidString.lowercased()).\(generation)"
    }

    /// A new turn is explicit; neither a server acknowledgement nor reconnect can start one.
    public mutating func beginTurn() -> VoiceEvaluationEnvelope? {
        guard phase == .ready || phase == .interrupted, generation < UInt32.max else { return nil }
        generation += 1; self.turnID = UUID(); authorizedTrack = nil; phase = .starting
        return envelope(.start)
    }

    /// Fence locally before awaiting any transport operation or remote acknowledgement.
    public mutating func interrupt(reason: String = "user_speech") -> VoiceEvaluationEnvelope? {
        guard phase == .starting || phase == .playing else { return nil }
        authorizedTrack = nil; phase = .interrupted
        return envelope(.interrupt, reason: reason)
    }

    /// Stop also closes a session which has not started its first turn.
    public mutating func stop(reason: String = "user_stop") -> VoiceEvaluationEnvelope? {
        guard phase != .stopped else { return nil }
        authorizedTrack = nil; phase = .stopped
        return envelope(.stop, reason: reason)
    }

    @discardableResult
    public mutating func receive(_ message: VoiceEvaluationEnvelope, participantIdentity: String) -> Bool {
        guard participantIdentity == Self.evaluatorIdentity,
              message.version == 1, message.sessionID == sessionID,
              message.generation > 0, message.generation == generation,
              message.turnID == turnID, phase != .stopped else { return false }
        switch message.event {
        case .started:
            guard phase == .starting,
                  message.audioTrack == Self.trackName(sessionID: sessionID, generation: generation) else { return false }
            authorizedTrack = message.audioTrack; phase = .playing
        case .interrupted:
            guard phase == .starting || phase == .playing else { return false }
            authorizedTrack = nil; phase = .interrupted
        case .stopped:
            authorizedTrack = nil; phase = .stopped
        default:
            return false
        }
        return true
    }

    public func shouldSubscribe(trackName: String, participantIdentity: String) -> Bool {
        phase == .playing && participantIdentity == Self.evaluatorIdentity && trackName == authorizedTrack
    }

    private func envelope(_ event: VoiceEvaluationEnvelope.Event, reason: String? = nil) -> VoiceEvaluationEnvelope? {
        guard let turnID else { return nil }
        return VoiceEvaluationEnvelope(sessionID: sessionID, turnID: turnID, generation: generation,
                                       event: event, reason: reason)
    }
}
