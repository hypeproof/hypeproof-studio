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
    func testVoiceTimelineKeepsOnlyBoundedEnumEventsAndRelativeMonotonicTimes() {
        var timeline = VoiceTimeline()
        timeline.record(.playbackFinished, phase: .speaking, now: 10_000)
        timeline.record(.continuationRequested, phase: .ready, now: 10_000.25)
        timeline.record(.captureStarted, phase: .listening, now: 10_000.5)
        XCTAssertEqual(timeline.entries.map(\.milliseconds), [0, 250, 500])
        XCTAssertTrue(timeline.export.contains("250 continuationRequested ready"))
        timeline.record(.stopped, phase: .idle, now: .nan)
        XCTAssertEqual(timeline.entries.count, 3, "Invalid time cannot produce an unexportable record.")
        timeline.record(.stopped, phase: .idle, now: 9_999)
        XCTAssertEqual(timeline.entries.last?.milliseconds, 500, "A clock anomaly cannot reverse the exported order.")
        for step in 1...300 { timeline.record(.start, phase: .authorizing, now: 10_001 + Double(step)) }
        XCTAssertLessThanOrEqual(timeline.entries.count, 96)
        XCTAssertFalse(timeline.export.contains("playbackFinished"), "Old events are evicted, not persisted indefinitely.")
    }

}
