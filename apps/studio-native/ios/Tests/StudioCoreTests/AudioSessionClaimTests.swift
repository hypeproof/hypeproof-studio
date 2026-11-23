import XCTest
@testable import StudioCore

/// #4432 F23: stop() deactivates the audio session only after an activation; an active turn still deactivates.
final class AudioSessionClaimTests: XCTestCase {
    func testStopWithoutActivationDoesNotDeactivate() {
        var claim = AudioSessionClaim()
        XCTAssertFalse(claim.release(), "A sign-in tap with no voice turn must not call setActive(false).")
        XCTAssertFalse(claim.release())
    }
    func testActiveTurnStillDeactivatesOnceOnStop() {
        var claim = AudioSessionClaim()
        claim.activating()  // capture, playback or own-voice replay
        XCTAssertTrue(claim.held)
        XCTAssertTrue(claim.release(), "Stopping an active turn must still call setActive(false).")
        XCTAssertFalse(claim.held)
        XCTAssertFalse(claim.release(), "A second stop has nothing left to release.")
    }
    func testEveryActivationIsFollowedByADeactivation() {
        var claim = AudioSessionClaim()
        for _ in 0..<3 {
            claim.activating(); claim.activating()  // capture, then playback in the same turn
            XCTAssertTrue(claim.release())
            XCTAssertFalse(claim.release())
        }
    }
    func testFailedDeactivationIsTriedAgainOnTheNextStop() {
        var claim = AudioSessionClaim()
        claim.activating()
        XCTAssertTrue(claim.release())
        claim.deactivationFailed()
        XCTAssertTrue(claim.release(), "A failed setActive(false) must be retried by the next stop, as before.")
        XCTAssertFalse(claim.release())
    }
}
