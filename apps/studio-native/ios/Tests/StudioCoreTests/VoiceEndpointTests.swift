import XCTest
@testable import StudioCore

final class VoiceEndpointTests: XCTestCase {
    func testPauseRequiresWordsAndBothAcousticAndRecognitionSilence() {
        var endpoint = VoiceEndpoint(now: 0)
        XCTAssertEqual(endpoint.decision(now: 5), .listen)
        endpoint.recognized("오늘은", now: 5)
        endpoint.audio(rms: 0.08, now: 6.5)
        XCTAssertEqual(endpoint.decision(now: 7), .listen, "A delayed recognizer must not cut off audible speech")
        endpoint.recognized("오늘은 새로운 일을 해봤어요", now: 7.5)
        XCTAssertEqual(endpoint.decision(now: 9), .listen)
        XCTAssertEqual(endpoint.decision(now: 9.2), .finish)
    }
    func testRepeatedPartialResultsAndBackgroundNoiseDoNotHoldMicForever() {
        var endpoint = VoiceEndpoint(now: 0)
        endpoint.recognized("생각이 있어요", now: 1)
        endpoint.recognized("생각이 있어요", now: 2)
        endpoint.audio(rms: 0.003, now: 2.5)
        XCTAssertEqual(endpoint.decision(now: 2.7), .finish)
        endpoint.audio(rms: 0.5, now: 29.9)
        XCTAssertEqual(endpoint.decision(now: 30), .finish)
        XCTAssertEqual(VoiceEndpoint(now: 0).decision(now: 30), .noSpeech)
    }
}
