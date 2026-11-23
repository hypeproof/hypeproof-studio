/// Where the time goes between a sign-in tap and the signed-in screen (#4432 F23, diagnostics only).
///
/// Run 45225111226 signed in 6-8 s after the tap; the screen showed no login state for about 6 s.
/// The marks tell a slow `voice.stop()` (main actor busy), a late tap or render (stop fast, busy late)
/// and a slow sign-in exchange (busy fast, signed in late) apart. Times are uptime milliseconds,
/// the clock of the stall lines.
public struct SignInTiming: Sendable, Equatable {
    public struct Mark: Sendable, Equatable {
        public let name: String
        public let afterTapMs: Int
    }
    public private(set) var tapUptimeMs: Int?
    public private(set) var voiceStopMs: Int?
    /// "not called", "skipped", "<n> ms" or "failed <n> ms". Only the deactivation inside the tap's `voice.stop()`.
    public private(set) var audioDeactivation = "not called"
    public private(set) var marks: [Mark] = []
    private var voiceStopStart: Int?
    public static let maxMarks = 16
    public init() {}
    /// A new tap replaces the previous attempt's record.
    public mutating func tap(at uptimeMs: Int) {
        self = SignInTiming(); tapUptimeMs = uptimeMs; voiceStopStart = uptimeMs
    }
    /// Records the deactivation result while the tap's `voice.stop()` runs; later deactivations are ignored.
    public mutating func audio(_ result: String) {
        guard voiceStopStart != nil, voiceStopMs == nil, audioDeactivation == "not called" else { return }
        audioDeactivation = result
    }
    public mutating func voiceStopped(at uptimeMs: Int) {
        guard let start = voiceStopStart, voiceStopMs == nil else { return }
        voiceStopMs = uptimeMs - start
    }
    public mutating func mark(_ name: String, at uptimeMs: Int) {
        guard let tap = tapUptimeMs, marks.count < Self.maxMarks else { return }
        marks.append(Mark(name: name, afterTapMs: uptimeMs - tap))
    }
    public var isEmpty: Bool { tapUptimeMs == nil }
    /// Trace JSON value.
    public var fields: [String: String] {
        guard let tap = tapUptimeMs else { return [:] }
        var value = ["tap_uptime_ms": String(tap), "audio_deactivation": audioDeactivation,
                     "voice_stop_ms": voiceStopMs.map(String.init) ?? "running"]
        value["marks"] = marks.map { "\($0.name)+\($0.afterTapMs)" }.joined(separator: " ")
        return value
    }
    /// One log line, the same facts as `fields`.
    public var summary: String {
        guard let tap = tapUptimeMs else { return "HPStudio sign-in timing: no tap" }
        let stop = voiceStopMs.map { "\($0) ms" } ?? "running"
        let stages = marks.isEmpty ? "none" : marks.map { "\($0.name) +\($0.afterTapMs) ms" }.joined(separator: ", ")
        return "HPStudio sign-in timing: tap at uptime \(tap) ms; voice.stop \(stop); audio.deactivate \(audioDeactivation); \(stages)"
    }
}
