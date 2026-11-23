import XCTest
import Foundation
@testable import StudioCore

final class SwiftUIPrintChangesTests: XCTestCase {
    private func feed(_ ring: SwiftUIPrintChangeRing, _ text: String, at uptime: Int) { ring.feed(Data(text.utf8), uptimeMs: uptime) }

    func testRingKeepsOnlyChangeLinesAcrossChunks() {
        let ring = SwiftUIPrintChangeRing()
        feed(ring, "TeamRequestDetailView: @self, _dism", at: 100)
        feed(ring, "iss changed.\nuser text 제출한 초안 secret-42\nTeamWorkflowScreen: unchanged.\n", at: 200)
        let summary = ring.window(since: 0)
        XCTAssertEqual(summary, "TeamRequestDetailView.@self+1 TeamRequestDetailView._dismiss+1 TeamWorkflowScreen.(unchanged)+1 (print window 2 of 2 lines, other 1)")
        XCTAssertFalse(summary.contains("secret"))
        XCTAssertFalse(summary.contains("초안"))
    }

    func testWindowStartsAtTheGivenUptime() {
        let ring = SwiftUIPrintChangeRing()
        feed(ring, "A: _x changed.\n", at: 100)
        feed(ring, "B: _y changed.\n", at: 300)
        XCTAssertEqual(ring.window(since: 200), "B._y+1 (print window 1 of 2 lines, other 0)")
        XCTAssertEqual(ring.window(since: 400), "none (print window 0 of 2 lines, other 0)")
    }

    func testRingIsBounded() {
        let ring = SwiftUIPrintChangeRing(capacity: 3)
        for index in 0..<5 { feed(ring, "V: _p\(index) changed.\n", at: index) }
        XCTAssertEqual(ring.window(since: 0), "V._p2+1 V._p3+1 V._p4+1 (print window 3 of 5 lines, other 0)")
    }

    func testAnOverlongPartialLineIsDroppedAndCounted() {
        let ring = SwiftUIPrintChangeRing()
        feed(ring, String(repeating: "x", count: SwiftUIPrintChangeRing.maxLineBytes + 1), at: 1)
        feed(ring, " tail\nV: _p changed.\n", at: 2)
        XCTAssertEqual(ring.window(since: 0), "V._p+1 (print window 1 of 1 lines, other 2)")
    }

    func testPlaceholderSampleIsCopiedOnlyInTheApprovedShape() {
        let lines = ["<abc def [ghi jkl]>", "<abc def [ghi jkl]>", "<mno pqr [stu vwx]>"].map { SwiftUIChangeLine(text: $0) }
        XCTAssertEqual(SwiftUIChangeSummary.placeholderSample(lines), "sample \"<abc def [ghi jkl]>\"+2")
        XCTAssertNil(SwiftUIChangeSummary.placeholderSample([SwiftUIChangeLine(text: "<abc def [ghi jkl]>", format: "%{public}s")]), "A format string means logged arguments")
        for text in ["<abc def [ghi 42]>", "<abc def [ghi-jkl x]>", "<초안 def [ghi jkl]>", "<abc def [ghi jkl]>\n", "x<abc def [ghi jkl]>", "<abc def [ghi jkl mno]>", "<private>"] {
            XCTAssertNil(SwiftUIChangeSummary.placeholderSample([SwiftUIChangeLine(text: text)]), text)
        }
    }

    // MARK: FileDescriptorTee

    private final class Collected: @unchecked Sendable {
        private let lock = NSLock(); private var data = Data()
        func append(_ more: Data) { lock.lock(); data.append(more); lock.unlock() }
        var value: Data { lock.lock(); defer { lock.unlock() }; return data }
    }
    /// Reads `count` bytes, or what arrived within 5 s, so a missing pass-through fails instead of hanging.
    private func readExactly(_ fd: Int32, _ count: Int) -> Data {
        var out = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(5)
        while out.count < count && Date() < deadline {
            let n = read(fd, &buffer, min(buffer.count, count - out.count))
            if n > 0 { out.append(contentsOf: buffer[0..<n]) } else if n < 0 && errno == EAGAIN { usleep(10_000) } else { break }
        }
        return out
    }
    /// A pipe standing in for the original destination (its read end non-blocking), and a separate descriptor that points at it.
    private func destination() -> (read: Int32, target: Int32, write: Int32) {
        var ends: [Int32] = [-1, -1]
        XCTAssertEqual(pipe(&ends), 0)
        _ = fcntl(ends[0], F_SETFL, fcntl(ends[0], F_GETFL) | O_NONBLOCK)
        return (ends[0], dup(ends[1]), ends[1])
    }

    func testTeePassesEveryByteThroughAndCopiesItToTheSink() throws {
        let dest = destination()
        defer { close(dest.read); close(dest.write); close(dest.target) }
        let collected = Collected()
        let tee = try XCTUnwrap(FileDescriptorTee.start(fd: dest.target) { collected.append($0) })
        let bytes = Data("V: _p changed.\nnot a change line\n".utf8) + Data([0xFF, 0x00, 0xFE]) + Data("partial".utf8)
        bytes.withUnsafeBytes { _ = write(dest.target, $0.baseAddress, bytes.count) }
        XCTAssertEqual(readExactly(dest.read, bytes.count), bytes, "The original destination gets every byte, parsed or not")
        let deadline = Date().addingTimeInterval(5)
        while collected.value.count < bytes.count && Date() < deadline { usleep(10_000) }
        XCTAssertEqual(collected.value, bytes)
        tee.stop()
        let after = Data("after stop\n".utf8)
        after.withUnsafeBytes { _ = write(dest.target, $0.baseAddress, after.count) }
        XCTAssertEqual(readExactly(dest.read, after.count), after, "After stop the descriptor writes to the original again")
    }

    func testFailedSetupLeavesTheDescriptorAsItWas() {
        let failures: [(String, FileDescriptorCalls)] = [
            ("pipe", FileDescriptorCalls(pipe: { _ in -1 }, dup: { dup($0) }, dup2: { dup2($0, $1) })),
            ("dup", FileDescriptorCalls(pipe: { pipe($0) }, dup: { _ in -1 }, dup2: { dup2($0, $1) })),
            ("dup2", FileDescriptorCalls(pipe: { pipe($0) }, dup: { dup($0) }, dup2: { _, _ in -1 })),
        ]
        for (name, calls) in failures {
            let dest = destination()
            XCTAssertNil(FileDescriptorTee.start(fd: dest.target, calls: calls) { _ in XCTFail("no sink after a failed \(name)") }, name)
            let probe = Data("still direct\n".utf8)
            probe.withUnsafeBytes { _ = write(dest.target, $0.baseAddress, probe.count) }
            XCTAssertEqual(readExactly(dest.read, probe.count), probe, name)
            close(dest.read); close(dest.write); close(dest.target)
        }
    }
}
