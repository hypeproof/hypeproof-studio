import XCTest
@testable import StudioCore

/// #4432 F11-D: one value-based team stack. Steps are unique, pops and the stack's own back are prefixes,
/// and a presentation lives exactly while its step is in the path.
final class TeamRouteTests: XCTestCase {
    func testSameRoutePushedTwiceGetsTwoSteps() {
        var path = TeamPath()
        let first = path.push(.detail(request: "trq_1"))
        path.push(.relations(request: "trq_1", product: "studio"))
        let again = path.push(.detail(request: "trq_1"))
        XCTAssertEqual(first.route, again.route)
        XCTAssertNotEqual(first, again, "detail → related → the same detail must be two screens.")
        XCTAssertEqual(path.steps.count, 3)
        XCTAssertEqual(Set(path.steps.map(\.id)).count, 3)
    }
    func testPushAboveOnlyFromTheTopScreen() {
        var path = TeamPath()
        let detail = path.push(.detail(request: "trq_1"))
        let text = path.push(.text(request: "trq_1", target: "trq_1", product: "studio"), above: detail)
        XCTAssertNotNil(text)
        XCTAssertNil(path.push(.relations(request: "trq_1", product: "studio"), above: detail), "A covered detail's late async result must push nothing.")
        XCTAssertEqual(path.steps.map(\.route.kind), ["detail", "text"])
        XCTAssertNotNil(path.push(.detail(request: "trq_2"), above: nil), "The root list always pushes.")
        XCTAssertEqual(path.steps.count, 3)
    }
    func testPopRemovesTheStepAndEverythingAbove() {
        var path = TeamPath()
        let detail = path.push(.detail(request: "trq_1"))
        let github = path.push(.github(request: "trq_1"))
        path.push(.observations)
        path.pop(github)
        XCTAssertEqual(path.steps, [detail])
        path.pop(github)  // no longer in the path: nothing changes
        XCTAssertEqual(path.steps, [detail])
        path.pop(detail)
        XCTAssertEqual(path.steps, [])
    }
    func testStackBackAcceptsOnlyAPrefix() {
        var path = TeamPath()
        let detail = path.push(.detail(request: "trq_1"))
        let outcome = path.push(.outcome(request: "trq_1"))
        path.accept([detail, outcome, TeamStep(id: 99, route: .delivery(request: "trq_1"))])
        XCTAssertEqual(path.steps, [detail, outcome], "A step must not be created outside push.")
        path.accept([TeamStep(id: 99, route: .detail(request: "trq_1"))])
        XCTAssertEqual(path.steps, [detail, outcome], "A non-prefix must be ignored.")
        path.accept([detail])
        XCTAssertEqual(path.steps, [detail])
        path.accept([])
        XCTAssertEqual(path.steps, [])
    }
    func testResetAndParent() {
        var path = TeamPath()
        let old = path.push(.detail(request: "trq_1"))
        path.reset([.detail(request: "trq_9")])
        XCTAssertEqual(path.steps.map(\.route), [.detail(request: "trq_9")])
        XCTAssertNotEqual(path.steps.first?.id, old.id, "Ids are not reused after a reset.")
        let intake = path.push(.intake(request: "trq_9", product: "lab"))
        let github = path.push(.intakeGitHub)
        XCTAssertEqual(path.parent(of: github), intake)
        XCTAssertEqual(path.parent(of: path.steps[0]), nil)
        XCTAssertEqual(path.parent(of: old), nil)
    }
    func testStoreKeepsOneValuePerLiveStep() {
        final class Box { let n: Int; init(_ n: Int) { self.n = n } }
        var path = TeamPath(), store = TeamStepStore<Box>(), made = 0
        let detail = path.push(.detail(request: "trq_1"))
        let text = path.push(.text(request: "trq_1", target: "trq_1", product: "studio"))
        let first = store.value(for: text) { made += 1; return Box(made) }
        let second = store.value(for: text) { made += 1; return Box(made) }
        XCTAssertTrue(first.created); XCTAssertFalse(second.created)
        XCTAssertTrue(first.value === second.value, "Every body pass of one step must get the same presentation.")
        path.pop(text); store.retain(path.steps)
        XCTAssertNil(store.existing(text), "A popped step's presentation is released.")
        let again = path.push(.text(request: "trq_1", target: "trq_1", product: "studio"))
        let fresh = store.value(for: again) { made += 1; return Box(made) }
        XCTAssertTrue(fresh.created)
        XCTAssertEqual(fresh.value.n, 2, "A re-pushed screen gets a new presentation, as a new StateObject did.")
        XCTAssertNil(store.existing(detail))
        _ = store.value(for: detail) { Box(0) }
        store.retain(path.steps)
        XCTAssertNotNil(store.existing(detail)); XCTAssertNotNil(store.existing(again))
    }
    func testKindsAreDistinct() {
        let all: [TeamRoute] = [.detail(request: "r"), .workflow(request: "r", product: "p"), .outcome(request: "r"), .delivery(request: "r"),
                                .github(request: "r"), .subscription(request: "r", product: "p"), .intake(request: "r", product: "p"),
                                .text(request: "r", target: "t", product: "p"), .relations(request: "r", product: "p"), .observations, .intakeGitHub]
        XCTAssertEqual(Set(all.map(\.kind)).count, all.count)
    }
}
