import XCTest
@testable import StudioCore

final class VoiceReviewPCMTests: XCTestCase {
    func testInMemoryClipIsPlayablePCMContainerWithSignedSamples() throws {
        var clip = try XCTUnwrap(VoiceReviewPCM(sampleRate: 48000, channels: 1))
        XCTAssertNil(clip.wav)
        clip.append([0, 32767, -32768])
        let wav = try XCTUnwrap(clip.wav)
        XCTAssertEqual(String(decoding: wav.prefix(4), as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: wav[8..<16], as: UTF8.self), "WAVEfmt ")
        XCTAssertEqual(Array(wav.suffix(6)), [0, 0, 255, 127, 0, 128])
        XCTAssertEqual(wav.count, 50)
    }
    func testThirtySecondCapAndFrameAlignmentCannotGrowWithoutBound() throws {
        var clip = try XCTUnwrap(VoiceReviewPCM(sampleRate: 8000, channels: 2))
        clip.append([1]) // Half a stereo frame is not retained.
        XCTAssertNil(clip.wav)
        clip.append(Array(repeating: 1, count: 8000 * 2 * 31))
        let before = clip.wav
        clip.append([2, 2])
        XCTAssertEqual(clip.wav, before)
        XCTAssertEqual(before?.count, 44 + 8000 * 2 * 30 * 2)
        XCTAssertNil(VoiceReviewPCM(sampleRate: 48000, channels: 100))
    }
}
