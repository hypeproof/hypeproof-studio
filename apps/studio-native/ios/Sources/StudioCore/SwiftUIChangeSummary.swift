import Foundation

/// Summarises SwiftUI `_logChanges()` lines ("Changed Body Properties" category) for the
/// DEBUG stall watcher (#4432 F11).
///
/// A line in the expected shape, "TeamIntakeScreen: _dismiss, _model changed.", is counted
/// as "<View>.<property>+N". Any other line is counted by its shape, never by its text, so the
/// summary is never blank and never copies a logged value. Run 45122302071 showed blank summaries
/// for windows that held lines: on the iOS simulator the composed text was in another shape.
public struct SwiftUIChangeLine: Sendable, Equatable {
    public var text: String
    /// The entry's format string. It is source code, not a logged value.
    public var format: String
    public init(text: String, format: String = "") { self.text = text; self.format = format }
}

public enum SwiftUIChangeSummary {
    public static let limit = 12

    /// "<View>.<property>+N" and "shape[...]+N" terms, most frequent first, at most `limit`.
    public static func summary(_ lines: [SwiftUIChangeLine]) -> String {
        var counts: [String: Int] = [:]
        for line in lines {
            let parts = properties(line.text)
            if parts.isEmpty { counts[shapeKey(line), default: 0] += 1; continue }
            for part in parts { counts[part, default: 0] += 1 }
        }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(limit).map { "\($0.key)+\($0.value)" }.joined(separator: " ")
    }

    /// The "<View>.<property>" terms of one line, or [] if the line is not in the expected shape.
    /// "View: unchanged." (a body pass with no recorded change, from `_printChanges()`) is "View.(unchanged)".
    static func properties(_ text: String) -> [String] {
        guard let colon = text.firstIndex(of: ":") else { return [] }
        let type = text[..<colon].trimmingCharacters(in: .whitespaces)
        guard !type.isEmpty, type.allSatisfy(isIdentifier) else { return [] }
        var rest = text[text.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        if rest == "unchanged." { return [type + ".(unchanged)"] }
        guard rest.hasSuffix(" changed.") else { return [] }
        rest.removeLast(" changed.".count)
        let names = rest.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard !names.isEmpty, names.allSatisfy({ !$0.isEmpty && $0.allSatisfy(isIdentifier) }) else { return [] }
        return names.map { type + "." + $0 }
    }

    /// A key that shows how an unparsed line looks without its content: "empty", "private"
    /// (a redacted argument), or the line with each run of letters and digits replaced by "w",
    /// plus the entry's format string (source code, so it is kept, at most 48 characters, spaces as "_").
    static func shapeKey(_ line: SwiftUIChangeLine) -> String {
        let text: String
        if line.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { text = "empty" }
        else if line.text.contains("<private>") { text = "private" }
        else { text = shape(line.text) }
        let format = line.format.isEmpty ? "" : ";fmt=" + String(line.format.prefix(48)).replacingOccurrences(of: " ", with: "_")
        return "shape[" + text + format + "]"
    }

    /// Replaces each run of letters and digits with "w", maps spaces to "_", and keeps at most 32 characters.
    static func shape(_ text: String) -> String {
        var out = "", inWord = false
        for ch in text {
            if ch.isLetter || ch.isNumber || ch == "_" {
                if !inWord { out.append("w"); inWord = true }
            } else {
                inWord = false
                out.append(ch.isWhitespace ? "_" : ch)
            }
            if out.count >= 32 { break }
        }
        return out
    }

    /// One verbatim sample of a system placeholder line, with its count in `lines`: `sample "<a b [c d]>"+N`.
    /// Run 45132515641: every iOS simulator line had the shape "<w_w_[w_w]>" and an empty format string.
    /// Only a line with an empty format string that is ASCII letters in exactly that shape is copied. With no
    /// format string there is no logged argument, and the shape leaves no room for digits or other text.
    /// The most frequent such text is used; nil if there is none.
    public static func placeholderSample(_ lines: [SwiftUIChangeLine]) -> String? {
        var counts: [String: Int] = [:]
        for line in lines where line.format.isEmpty && isPlaceholder(line.text) { counts[line.text, default: 0] += 1 }
        guard let best = counts.min(by: { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }) else { return nil }
        return "sample \"" + best.key + "\"+" + String(best.value)
    }

    private static let placeholder = try! NSRegularExpression(pattern: "^<[A-Za-z]+ [A-Za-z]+ \\[[A-Za-z]+ [A-Za-z]+\\]>\\z")
    static func isPlaceholder(_ text: String) -> Bool {
        placeholder.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private static func isIdentifier(_ ch: Character) -> Bool {
        ch.isLetter || ch.isNumber || ch == "_" || ch == "@" || ch == "." || ch == "<" || ch == ">"
    }
}
