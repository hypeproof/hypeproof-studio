import XCTest
@testable import StudioCore

final class VoiceTurnTests: XCTestCase {
    func testInstalledKoreanVoiceQualityBeatsCatalogOrderWithoutUsingAnotherLanguage() {
        typealias Voice = KoreanVoiceSelection.Candidate
        let installed = [Voice(language: "ko-KR", quality: .standard),
                         Voice(language: "en-US", quality: .premium),
                         Voice(language: "ko-KR", quality: .enhanced),
                         Voice(language: "ko-KR", quality: .enhanced)]
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: installed), 2,
                       "The first basic Korean voice cannot hide an installed enhanced Korean voice.")
        let premium = installed + [Voice(language: "ko-KR", quality: .premium), Voice(language: "ko-KR", quality: .premium)]
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: premium), 4,
                       "Installed premium wins; equal-quality candidates keep their order.")
    }
    func testKoreanVoiceKeepsDefaultAndUnknownFallbacksAndRefusesMissingLanguage() {
        typealias Voice = KoreanVoiceSelection.Candidate
        XCTAssertNil(KoreanVoiceSelection.preferredIndex(in: []))
        XCTAssertNil(KoreanVoiceSelection.preferredIndex(in: [Voice(language: "en-US", quality: .premium)]))
        XCTAssertNil(KoreanVoiceSelection.preferredIndex(in: [Voice(language: "ko", quality: .enhanced)]))
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: [Voice(language: "ko-KR", quality: .standard)]), 0)
        let unknown = Voice(language: "ko-KR", quality: .unknown)
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: [unknown, Voice(language: "ko-KR", quality: .standard)]), 1,
                       "An unrecognized quality must not outrank a known usable quality.")
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: [unknown, unknown]), 0,
                       "An installed Korean voice remains the local fallback when no known tier exists.")
    }
    func testNoveltyAndPersonalVoicesCannotBecomeTheAssistantDefault() {
        typealias Voice = KoreanVoiceSelection.Candidate
        let excluded = [Voice(language: "ko-KR", quality: .premium, isNovelty: true),
                        Voice(language: "ko-KR", quality: .premium, isPersonal: true),
                        Voice(language: "ko-KR", quality: .unknown, isNovelty: true, isPersonal: true)]
        XCTAssertNil(KoreanVoiceSelection.preferredIndex(in: excluded),
                     "An excluded voice cannot become the fallback when it is the only installed kind.")
        XCTAssertEqual(KoreanVoiceSelection.preferredIndex(in: excluded + [Voice(language: "ko-KR", quality: .standard)]), 3,
                       "An ordinary default voice beats premium novelty and personal voices.")
    }
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
