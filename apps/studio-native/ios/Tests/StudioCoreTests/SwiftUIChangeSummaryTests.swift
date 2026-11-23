import XCTest
@testable import StudioCore

final class SwiftUIChangeSummaryTests: XCTestCase {
    private func lines(_ texts: [String], format: String = "") -> [SwiftUIChangeLine] {
        texts.map { SwiftUIChangeLine(text: $0, format: format) }
    }

    func testExpectedShapeCountsViewProperties() {
        let summary = SwiftUIChangeSummary.summary(lines([
            "TeamRequestDetailView: @self, @identity, _model changed.",
            "TeamRequestDetailView: _model changed.",
            "TeamIntakeScreen: _dismiss changed.",
        ]))
        XCTAssertEqual(summary, "TeamRequestDetailView._model+2 TeamIntakeScreen._dismiss+1 TeamRequestDetailView.@identity+1 TeamRequestDetailView.@self+1")
    }

    /// Run 45122302071: windows with lines rendered "why:  (window 5 of 5 lines; ...)".
    /// Unparsed lines must still appear, by shape only.
    func testUnparsedLinesAreCountedByShapeAndNeverBlank() {
        let redacted = SwiftUIChangeSummary.summary(lines(["<private>", "<private>"], format: "%{public}s: %s changed."))
        XCTAssertEqual(redacted, "shape[private;fmt=%{public}s:_%s_changed.]+2")
        XCTAssertEqual(SwiftUIChangeSummary.summary(lines([""])), "shape[empty]+1")
        XCTAssertEqual(SwiftUIChangeSummary.summary(lines(["TeamRequestDetailView:"])), "shape[w:]+1")
        XCTAssertEqual(SwiftUIChangeSummary.summary(lines(["TeamRequestDetailView @self changed"])), "shape[w_@w_w]+1")
    }

    func testShapeNeverCopiesLoggedText() {
        let summary = SwiftUIChangeSummary.summary(lines(["제출한 초안 secret-42 내용"]))
        XCTAssertEqual(summary, "shape[w_w_w-w_w]+1")
        XCTAssertFalse(summary.contains("secret"))
        XCTAssertFalse(summary.contains("초안"))
    }

    func testMixedLinesKeepBothKinds() {
        let summary = SwiftUIChangeSummary.summary(lines(["TeamRelationScreen: _model changed.", "<private>"]))
        XCTAssertEqual(summary, "TeamRelationScreen._model+1 shape[private]+1")
        XCTAssertFalse(summary.isEmpty)
        XCTAssertEqual(summary.split(separator: " ").count, 2, "Each term is one space-free token")
    }

    func testAtMostTwelveTerms() {
        let many = (0..<20).map { "View\($0): _p changed." }
        XCTAssertEqual(SwiftUIChangeSummary.summary(lines(many)).split(separator: " ").count, SwiftUIChangeSummary.limit)
    }
}
