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

/// #4432 F25 diagnostics: when the composer's draft was applied, and whether the Send action ran at all.
final class DraftSendTimingTests: XCTestCase {
    func testEditsRecordWhenTextFirstAppearedAndTheLastEdit() {
        var timing = DraftSendTiming()
        XCTAssertTrue(timing.isEmpty)
        timing.edited(length: 1, at: 1_000)
        timing.edited(length: 2, at: 1_010)
        timing.edited(length: 39, at: 1_200)
        XCTAssertEqual(timing.edits, 3); XCTAssertEqual(timing.firstTextUptimeMs, 1_000)
        XCTAssertEqual(timing.lastEditUptimeMs, 1_200); XCTAssertEqual(timing.lastLength, 39)
        timing.edited(length: 0, at: 1_300)  // cleared: text starts again at the next non-empty edit
        XCTAssertNil(timing.firstTextUptimeMs)
        timing.edited(length: 5, at: 1_400)
        XCTAssertEqual(timing.firstTextUptimeMs, 1_400)
        XCTAssertFalse(timing.isEmpty)
    }
    func testSendsKeepTheirDraftLengthAndOnlyTheLastFour() {
        var timing = DraftSendTiming()
        timing.sent(length: 0, canSend: true, at: 500)
        XCTAssertFalse(timing.isEmpty, "A send with no edit is still recorded.")
        for index in 1...5 { timing.sent(length: index, canSend: index != 3, at: 1_000 + index) }
        XCTAssertEqual(timing.sends.map(\.uptimeMs), [1_002, 1_003, 1_004, 1_005])
        XCTAssertEqual(timing.sends.count, DraftSendTiming.maxSends)
        XCTAssertEqual(timing.fields["sends"], "1002:2:y 1003:3:n 1004:4:y 1005:5:y")
    }
    func testFieldsAndSummaryCarryTheSameFacts() {
        var timing = DraftSendTiming()
        XCTAssertEqual(timing.fields, ["edits": "0", "first_text_ms": "-", "last_edit_ms": "-", "last_length": "0", "sends": ""])
        XCTAssertEqual(timing.summary, "HPStudio draft send: no send; 0 draft edits, text since uptime - ms, last edit at - ms (0 chars)")
        timing.edited(length: 39, at: 2_000)
        timing.sent(length: 39, canSend: true, at: 2_500)
        XCTAssertEqual(timing.fields, ["edits": "1", "first_text_ms": "2000", "last_edit_ms": "2000", "last_length": "39", "sends": "2500:39:y"])
        XCTAssertEqual(timing.summary, "HPStudio draft send: send at uptime 2500 ms, draft 39 chars, canSend true; 1 draft edits, text since uptime 2000 ms, last edit at 2000 ms (39 chars)")
        timing.sent(length: 40, canSend: false, at: 2_600)
        XCTAssertTrue(timing.summary.hasPrefix("HPStudio draft send: send at uptime 2600 ms, draft 40 chars, canSend false;"), "The line names the latest send.")
    }
}

final class FocusTimingTests: XCTestCase {
    func testMarksAreKeptInOrderWithTheirUptime() {
        var timing = FocusTiming()
        XCTAssertTrue(timing.isEmpty)
        XCTAssertEqual(timing.summary, "HPStudio focus: no marks")
        timing.record("focus", at: 1_000); timing.record("kb.show", at: 1_120); timing.record("blur", at: 5_000)
        XCTAssertFalse(timing.isEmpty)
        XCTAssertEqual(timing.fields, ["focus@1000", "kb.show@1120", "blur@5000"])
        XCTAssertEqual(timing.summary, "HPStudio focus: focus@1000 kb.show@1120 blur@5000")
    }

    func testOnlyTheLastMarksAreKept() {
        var timing = FocusTiming()
        for index in 0..<(FocusTiming.capacity + 3) { timing.record("m\(index)", at: index) }
        XCTAssertEqual(timing.marks.count, FocusTiming.capacity)
        XCTAssertEqual(timing.marks.first, FocusTiming.Mark(kind: "m3", uptimeMs: 3))
        XCTAssertEqual(timing.marks.last, FocusTiming.Mark(kind: "m\(FocusTiming.capacity + 2)", uptimeMs: FocusTiming.capacity + 2))
    }
}
