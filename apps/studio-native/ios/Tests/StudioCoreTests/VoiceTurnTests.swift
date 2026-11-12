import XCTest
@testable import StudioCore

final class VoiceTurnTests: XCTestCase {
    func testStoppedPermissionAndSpeechCallbacksCannotResumeOrSend() {
        var session = VoiceTurn()
        let old = session.start(projectID: "first", mode: .conversation)
        session.stop()
        XCTAssertFalse(session.advance(old, from: [.authorizing], to: .listening))
        let new = session.start(projectID: "second", mode: .dictation)
        XCTAssertFalse(session.advance(old, from: [.authorizing], to: .listening))
        XCTAssertTrue(session.advance(new, from: [.authorizing], to: .listening))
        XCTAssertEqual(session.projectID, "second")
    }
    func testARecognizedTurnCanOnlySendOnceAndPlaybackNeverStartsRecording() {
        var session = VoiceTurn()
        let token = session.start(projectID: "one", mode: .conversation)
        XCTAssertTrue(session.advance(token, from: [.authorizing], to: .listening))
        XCTAssertTrue(session.advance(token, from: [.listening], to: .finalizing))
        XCTAssertTrue(session.advance(token, from: [.listening, .finalizing], to: .waiting))
        XCTAssertFalse(session.advance(token, from: [.listening, .finalizing], to: .waiting))
        XCTAssertTrue(session.advance(token, from: [.waiting], to: .speaking))
        XCTAssertTrue(session.advance(token, from: [.speaking], to: .ready))
        XCTAssertFalse(session.advance(token, from: [.authorizing], to: .listening))
        XCTAssertEqual(session.phase, .ready)
    }
}
