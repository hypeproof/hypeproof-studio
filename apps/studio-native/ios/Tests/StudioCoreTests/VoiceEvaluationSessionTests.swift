import XCTest
@testable import StudioCore

final class VoiceEvaluationSessionTests: XCTestCase {
    func testSameWireFixtureUsedByTheActualTransportLab() throws {
        struct Fixture: Decodable {
            let topic: String
            let evaluator_identity: String
            let admission_attribute: String
            let events: [VoiceEvaluationEnvelope]
        }
        let nativeRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: nativeRoot.appendingPathComponent("voice-evaluation/wire-fixture.json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: data)
        XCTAssertEqual(fixture.topic, VoiceEvaluationSession.topic)
        XCTAssertEqual(fixture.evaluator_identity, VoiceEvaluationSession.evaluatorIdentity)
        XCTAssertEqual(fixture.admission_attribute, VoiceEvaluationSession.admissionAttribute)
        XCTAssertEqual(Set(fixture.events.map(\.event.rawValue)),
                       Set(["start", "started", "interrupt", "interrupted", "stop", "stopped"]))
        for message in fixture.events {
            XCTAssertEqual(try JSONDecoder().decode(VoiceEvaluationEnvelope.self,
                from: JSONEncoder().encode(message)), message)
            if message.event == .started {
                XCTAssertEqual(message.audioTrack, VoiceEvaluationSession.trackName(
                    sessionID: message.sessionID, generation: message.generation))
            }
        }
    }

    func testAdmissionMustNameThisConnectionFromTheEvaluator() {
        let evaluator = VoiceEvaluationSession.evaluatorIdentity
        XCTAssertFalse(VoiceEvaluationSession.isAdmitted(participantIdentity: evaluator, admittedSID: nil, localSID: "current"))
        XCTAssertFalse(VoiceEvaluationSession.isAdmitted(participantIdentity: evaluator, admittedSID: "old", localSID: "current"))
        XCTAssertFalse(VoiceEvaluationSession.isAdmitted(participantIdentity: "other", admittedSID: "current", localSID: "current"))
        XCTAssertFalse(VoiceEvaluationSession.isAdmitted(participantIdentity: evaluator, admittedSID: "", localSID: ""))
        XCTAssertTrue(VoiceEvaluationSession.isAdmitted(participantIdentity: evaluator, admittedSID: "current", localSID: "current"))
    }

    private func reply(to request: VoiceEvaluationEnvelope, event: VoiceEvaluationEnvelope.Event = .started,
                       version: Int = 1, track: String? = nil) -> VoiceEvaluationEnvelope {
        VoiceEvaluationEnvelope(version: version, sessionID: request.sessionID, turnID: request.turnID,
            generation: request.generation, event: event,
            audioTrack: track ?? VoiceEvaluationSession.trackName(sessionID: request.sessionID, generation: request.generation))
    }

    func testInterruptBeforeAcknowledgementCannotBeReversedByLateAudioOrReplay() throws {
        var session = VoiceEvaluationSession()
        let first = try XCTUnwrap(session.beginTurn())
        let track = VoiceEvaluationSession.trackName(sessionID: first.sessionID, generation: first.generation)
        XCTAssertFalse(session.shouldSubscribe(trackName: track, participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertNil(session.beginTurn(), "Double Start must not allocate another active turn")
        XCTAssertNotNil(session.interrupt())
        XCTAssertFalse(session.receive(reply(to: first), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.shouldSubscribe(trackName: track, participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        let second = try XCTUnwrap(session.beginTurn())
        XCTAssertNotEqual(second.turnID, first.turnID)
        XCTAssertGreaterThan(second.generation, first.generation)
        XCTAssertFalse(session.receive(reply(to: first, event: .interrupted), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertTrue(session.receive(reply(to: second), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.shouldSubscribe(trackName: track, participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.receive(reply(to: second), participantIdentity: VoiceEvaluationSession.evaluatorIdentity), "A duplicate started is not new authority")
    }

    func testForeignParticipantSessionVersionAndTrackCannotAuthorizePlayback() throws {
        var session = VoiceEvaluationSession()
        let start = try XCTUnwrap(session.beginTurn())
        XCTAssertFalse(session.receive(reply(to: start), participantIdentity: "other-member"))
        XCTAssertFalse(session.receive(reply(to: start, version: 2), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.receive(reply(to: start, track: "another-turn"), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        var other = VoiceEvaluationSession()
        XCTAssertFalse(session.receive(reply(to: try XCTUnwrap(other.beginTurn())), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertEqual(session.phase, .starting)
        XCTAssertTrue(session.receive(reply(to: start), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        let track = try XCTUnwrap(session.authorizedTrack)
        XCTAssertTrue(session.shouldSubscribe(trackName: track, participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.shouldSubscribe(trackName: track, participantIdentity: "other-member"))
    }

    func testStopClosesPlayingAndNeverStartedSessionsWithoutRemoteAcknowledgement() throws {
        var session = VoiceEvaluationSession()
        let start = try XCTUnwrap(session.beginTurn())
        XCTAssertTrue(session.receive(reply(to: start), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        let track = try XCTUnwrap(session.authorizedTrack)
        XCTAssertNotNil(session.stop(reason: "background"))
        XCTAssertFalse(session.shouldSubscribe(trackName: track, participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertFalse(session.receive(reply(to: start), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertNil(session.beginTurn()); XCTAssertNil(session.interrupt()); XCTAssertNil(session.stop())
        var neverStarted = VoiceEvaluationSession()
        XCTAssertNil(neverStarted.stop())
        XCTAssertEqual(neverStarted.phase, .stopped)
        XCTAssertNil(neverStarted.beginTurn())
    }

    func testWireRoundTripAndServerInterruptionLeaveNoPlaybackAuthority() throws {
        var session = VoiceEvaluationSession()
        let start = try XCTUnwrap(session.beginTurn())
        let wire = try JSONEncoder().encode(start)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: wire) as? [String: Any])
        XCTAssertNotNil(object["session_id"]); XCTAssertNil(object["sessionID"])
        XCTAssertEqual(try JSONDecoder().decode(VoiceEvaluationEnvelope.self, from: wire), start)
        XCTAssertTrue(session.receive(reply(to: start), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertTrue(session.receive(reply(to: start, event: .interrupted), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertNil(session.authorizedTrack)
        XCTAssertFalse(session.receive(reply(to: start), participantIdentity: VoiceEvaluationSession.evaluatorIdentity))
        XCTAssertNotNil(session.stop(), "Stopping after an interruption still closes the session")
    }
}
