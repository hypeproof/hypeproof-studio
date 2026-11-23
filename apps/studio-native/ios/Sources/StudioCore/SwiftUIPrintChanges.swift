import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// Bounded record of SwiftUI `_printChanges()` lines for the DEBUG stall watcher (#4432 F11).
///
/// Run 45132515641: on the iOS simulator every `_logChanges()` entry read back from the log store had an
/// empty format string and the shape "<w_w_[w_w]>", so no property name could be read. `_printChanges()`
/// writes the same report to standard output instead, which `FileDescriptorTee` copies here.
/// Only lines that `SwiftUIChangeSummary.properties` accepts (identifiers and " changed." or "unchanged.")
/// are kept, as their terms. Any other output line is counted, never stored.
/// Thread safety: `feed` runs on the tee's reader thread and `window` on the stall watcher's queue. Both take
/// only this object's own lock, which the main thread never takes.
public final class SwiftUIPrintChangeRing: @unchecked Sendable {
    public struct Entry: Sendable, Equatable {
        public var uptimeMs: Int
        public var terms: [String]
    }
    public let capacity: Int
    /// A partial line longer than this is dropped and counted as one other line.
    public static let maxLineBytes = 4096
    private let lock = NSLock()
    private var entries: [Entry] = []
    private var next = 0
    private var total = 0, other = 0
    // Touched only by the feeding thread.
    private var partial = Data()

    public init(capacity: Int = 8192) { self.capacity = max(1, capacity) }

    /// Splits `data` into lines (a trailing partial line waits for the next call) and records each one.
    public func feed(_ data: Data, uptimeMs: Int) {
        partial.append(data)
        var parsed: [Entry] = [], others = 0
        while let newline = partial.firstIndex(of: 0x0A) {
            let line = partial[partial.startIndex..<newline]
            partial.removeSubrange(partial.startIndex...newline)
            let terms = SwiftUIChangeSummary.properties(String(decoding: line, as: UTF8.self))
            if terms.isEmpty { others += 1 } else { parsed.append(Entry(uptimeMs: uptimeMs, terms: terms)) }
        }
        if partial.count > Self.maxLineBytes { partial.removeAll(); others += 1 }
        guard !parsed.isEmpty || others > 0 else { return }
        lock.lock(); defer { lock.unlock() }
        other += others
        for entry in parsed {
            total += 1
            if entries.count < capacity { entries.append(entry) } else { entries[next] = entry }
            next = (next + 1) % capacity
        }
    }

    /// The summary of the kept lines at or after `uptimeMs`, plus "(print window N of T lines, other K)".
    /// T counts every accepted line since start; only the newest `capacity` lines can be in the window.
    public func window(since uptimeMs: Int) -> String {
        lock.lock()
        let kept = entries.count < capacity ? entries : Array(entries[next...] + entries[..<next])
        let total = total, other = other
        lock.unlock()
        let window = kept.filter { $0.uptimeMs >= uptimeMs }
        var counts: [String: Int] = [:]
        for entry in window { for term in entry.terms { counts[term, default: 0] += 1 } }
        let terms = counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(SwiftUIChangeSummary.limit).map { "\($0.key)+\($0.value)" }.joined(separator: " ")
        return (terms.isEmpty ? "none" : terms) + " (print window \(window.count) of \(total) lines, other \(other))"
    }
}

/// The system calls `FileDescriptorTee` uses, replaceable so a test can make one of them fail.
public struct FileDescriptorCalls: Sendable {
    public var pipe: @Sendable (UnsafeMutablePointer<Int32>) -> Int32
    public var dup: @Sendable (Int32) -> Int32
    public var dup2: @Sendable (Int32, Int32) -> Int32
    public init(pipe: @escaping @Sendable (UnsafeMutablePointer<Int32>) -> Int32, dup: @escaping @Sendable (Int32) -> Int32,
                dup2: @escaping @Sendable (Int32, Int32) -> Int32) {
        self.pipe = pipe; self.dup = dup; self.dup2 = dup2
    }
    public static let posix = FileDescriptorCalls(pipe: { Darwin.pipe($0) }, dup: { Darwin.dup($0) }, dup2: { Darwin.dup2($0, $1) })
}

/// Copies everything written to a file descriptor to `sink`, and writes every byte on to where the
/// descriptor pointed before, unchanged (#4432 F11). A reader thread of its own does both; it touches no
/// main-actor state and takes no lock. Each chunk goes to the original destination before `sink` sees it.
/// If any step of the setup fails, the descriptor is left as it was and `start` returns nil, so the caller
/// keeps its other path. If the reader stops on a read error, it points the descriptor back at the original.
public final class FileDescriptorTee: @unchecked Sendable {
    public let fd: Int32
    private let original: Int32
    private let calls: FileDescriptorCalls

    private init(fd: Int32, original: Int32, calls: FileDescriptorCalls) { self.fd = fd; self.original = original; self.calls = calls }

    public static func start(fd: Int32, calls: FileDescriptorCalls = .posix, sink: @escaping @Sendable (Data) -> Void) -> FileDescriptorTee? {
        var ends: [Int32] = [-1, -1]
        guard calls.pipe(&ends) == 0 else { return nil }
        let original = calls.dup(fd)
        guard original >= 0 else { close(ends[0]); close(ends[1]); return nil }
        guard calls.dup2(ends[1], fd) >= 0 else { close(ends[0]); close(ends[1]); close(original); return nil }
        close(ends[1])
        let tee = FileDescriptorTee(fd: fd, original: original, calls: calls)
        let reader = ends[0]
        let thread = Thread { tee.pump(reader, sink) }
        thread.name = "ai.hypeproof.studio.print-changes-tee"
        thread.start()
        return tee
    }

    /// Points the descriptor back at its original destination. The reader ends when the pipe is drained.
    public func stop() { _ = calls.dup2(original, fd) }

    private func pump(_ reader: Int32, _ sink: @Sendable (Data) -> Void) {
        let size = 16 * 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate(); close(reader) }
        while true {
            let count = read(reader, buffer, size)
            if count == 0 { return }
            if count < 0 {
                if errno == EINTR { continue }
                stop(); return
            }
            var written = 0
            while written < count {
                let result = write(original, buffer + written, count - written)
                if result > 0 { written += result } else if result < 0 && errno == EINTR { continue } else { break }
            }
            sink(Data(bytes: buffer, count: count))
        }
    }
}
