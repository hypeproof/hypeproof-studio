import XCTest
@testable import StudioCore

/// #4432 F23 diagnostics: marks relative to the sign-in tap, and the tap's own voice.stop and deactivation.
final class SignInTimingTests: XCTestCase {
    func testMarksAreRelativeToTheTap() {
        var timing = SignInTiming()
        XCTAssertTrue(timing.isEmpty)
        timing.mark("busy", at: 50)  // no tap yet: ignored
        XCTAssertEqual(timing.marks, [])
        timing.tap(at: 1_000)
        timing.audio("skipped")
        timing.voiceStopped(at: 1_004)
        timing.mark("busy", at: 1_005)
        timing.mark("started", at: 1_200)
        timing.mark("callback", at: 1_400)
        timing.mark("signedIn", at: 1_900)
        XCTAssertEqual(timing.voiceStopMs, 4)
        XCTAssertEqual(timing.audioDeactivation, "skipped")
        XCTAssertEqual(timing.fields, ["tap_uptime_ms": "1000", "audio_deactivation": "skipped", "voice_stop_ms": "4",
                                       "marks": "busy+5 started+200 callback+400 signedIn+900"])
        XCTAssertEqual(timing.summary, "HPStudio sign-in timing: tap at uptime 1000 ms; voice.stop 4 ms; audio.deactivate skipped; busy +5 ms, started +200 ms, callback +400 ms, signedIn +900 ms")
    }
    func testOnlyTheDeactivationInsideTheTapsVoiceStopCounts() {
        var timing = SignInTiming()
        timing.audio("12 ms")  // before any tap
        timing.tap(at: 0)
        timing.audio("3000 ms")
        timing.audio("skipped")  // a second stop inside the same call
        timing.voiceStopped(at: 3_001)
        timing.audio("7 ms")  // a later stop, e.g. navigation
        XCTAssertEqual(timing.audioDeactivation, "3000 ms")
        XCTAssertEqual(timing.voiceStopMs, 3_001)
        timing.voiceStopped(at: 9_000)
        XCTAssertEqual(timing.voiceStopMs, 3_001, "The first end of the tap's voice.stop is kept.")
    }
    func testANewTapStartsANewRecordAndAnUnfinishedStopIsShown() {
        var timing = SignInTiming()
        timing.tap(at: 10); timing.voiceStopped(at: 20); timing.mark("busy", at: 21)
        timing.tap(at: 100)
        XCTAssertEqual(timing.marks, [])
        XCTAssertEqual(timing.fields["voice_stop_ms"], "running")
        XCTAssertEqual(timing.fields["audio_deactivation"], "not called")
        XCTAssertEqual(timing.summary, "HPStudio sign-in timing: tap at uptime 100 ms; voice.stop running; audio.deactivate not called; none")
    }
    func testMarksAreBounded() {
        var timing = SignInTiming()
        timing.tap(at: 0)
        for index in 0..<(SignInTiming.maxMarks + 5) { timing.mark("m\(index)", at: index) }
        XCTAssertEqual(timing.marks.count, SignInTiming.maxMarks)
    }
}
