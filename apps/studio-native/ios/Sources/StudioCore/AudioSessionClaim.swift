/// Whether the app's voice code still holds the shared audio session active (#4432 F23).
///
/// `VoiceController.stop()` runs on every sign-in tap, navigation and scene change, also when no voice turn
/// ever started. It used to call `AVAudioSession.setActive(false)` on the main actor each time. That call
/// logged "can lead to UI unresponsiveness if called on the main thread" right after every sign-in tap in run
/// 45225111226. The claim keeps every deactivation that follows an activation and drops only the ones with
/// nothing to release.
public struct AudioSessionClaim: Sendable, Equatable {
    public private(set) var held = false
    public init() {}
    /// Call before each `setActive(true)`. A failed activation still gets one deactivation attempt.
    public mutating func activating() { held = true }
    /// True when `setActive(false)` should run. The claim is released.
    public mutating func release() -> Bool {
        defer { held = false }
        return held
    }
    /// The deactivation threw: keep the claim, so the next stop tries again as before.
    public mutating func deactivationFailed() { held = true }
}
