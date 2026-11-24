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

/// When the shared composer's draft text was applied and when its Send action ran (#4432 F25, diagnostics only).
///
/// Run 45282026216: the test typed, then tapped Send at the button's centre, but the recording showed an
/// empty field and a disabled arrow until 1.7-3 s after the tap, and nothing was sent. A disabled SwiftUI
/// button runs no action, so a tap that finds Send disabled leaves no `send` entry here. Times are uptime ms,
/// the clock of the stall lines.
public struct DraftSendTiming: Sendable, Equatable {
    public struct Send: Sendable, Equatable {
        public let uptimeMs: Int
        public let draftLength: Int
        public let canSend: Bool
    }
    public private(set) var edits = 0
    public private(set) var firstTextUptimeMs: Int?
    public private(set) var lastEditUptimeMs: Int?
    public private(set) var lastLength = 0
    public private(set) var sends: [Send] = []
    public static let maxSends = 4
    public init() {}
    /// One applied draft edit; `length` is the draft's length after the edit.
    public mutating func edited(length: Int, at uptimeMs: Int) {
        edits += 1; lastEditUptimeMs = uptimeMs; lastLength = length
        if length > 0, firstTextUptimeMs == nil { firstTextUptimeMs = uptimeMs }
        if length == 0 { firstTextUptimeMs = nil }
    }
    /// The Send action ran (only an enabled button runs it). The oldest entry is dropped past `maxSends`.
    public mutating func sent(length: Int, canSend: Bool, at uptimeMs: Int) {
        sends.append(Send(uptimeMs: uptimeMs, draftLength: length, canSend: canSend))
        if sends.count > Self.maxSends { sends.removeFirst(sends.count - Self.maxSends) }
    }
    public var isEmpty: Bool { edits == 0 && sends.isEmpty }
    /// Trace JSON value: short strings only, so the trace stays short (#4457).
    public var fields: [String: String] {
        ["edits": String(edits), "first_text_ms": firstTextUptimeMs.map(String.init) ?? "-",
         "last_edit_ms": lastEditUptimeMs.map(String.init) ?? "-", "last_length": String(lastLength),
         "sends": sends.map { "\($0.uptimeMs):\($0.draftLength):\($0.canSend ? "y" : "n")" }.joined(separator: " ")]
    }
    /// One log line for a Send action, the same facts as `fields`.
    public var summary: String {
        let last = sends.last.map { "send at uptime \($0.uptimeMs) ms, draft \($0.draftLength) chars, canSend \($0.canSend)" } ?? "no send"
        return "HPStudio draft send: \(last); \(edits) draft edits, text since uptime \(firstTextUptimeMs.map(String.init) ?? "-") ms, last edit at \(lastEditUptimeMs.map(String.init) ?? "-") ms (\(lastLength) chars)"
    }
}

/// Composer focus and keyboard marks (#4432 F28). In run 45351306160 the first-use large-text composer gained
/// focus about 13 s after its tap, lost it about 4 s later, and no keyboard appeared; nothing recorded who changed
/// it. Only the last `capacity` marks are kept. Diagnostics only.
public struct FocusTiming: Sendable, Equatable {
    public struct Mark: Sendable, Equatable {
        public let kind: String
        public let uptimeMs: Int
    }
    public static let capacity = 8
    public private(set) var marks: [Mark] = []
    public init() {}
    public var isEmpty: Bool { marks.isEmpty }
    /// `kind` is a short word such as "focus", "blur", "kb.show" or "kb.hide".
    public mutating func record(_ kind: String, at uptimeMs: Int) {
        marks.append(Mark(kind: kind, uptimeMs: uptimeMs))
        if marks.count > Self.capacity { marks.removeFirst(marks.count - Self.capacity) }
    }
    /// Short strings for the native journey trace, oldest first.
    public var fields: [String] { marks.map { "\($0.kind)@\($0.uptimeMs)" } }
    /// One line naming every kept mark, oldest first.
    public var summary: String {
        "HPStudio focus: " + (marks.isEmpty ? "no marks" : fields.joined(separator: " "))
    }
}
