import XCTest
@testable import StudioCore

final class TeamScreenKeyTests: XCTestCase {
    private final class Object {}

    func testSameInputsGiveEqualKeys() {
        let requests = Object(), source = Object()
        XCTAssertEqual(TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_1", source: source),
                       TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_1", source: source))
        XCTAssertEqual(TeamScreenKey(), TeamScreenKey())
    }

    func testEachInputTakesPartInEquality() {
        let requests = Object(), other = Object()
        let base = TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_1", source: requests)
        let changed: [(String, TeamScreenKey)] = [
            ("requests", TeamScreenKey(requests: other, requestID: "trq_1", product: "studio", target: "tcm_1", source: requests)),
            ("requests nil", TeamScreenKey(requests: nil, requestID: "trq_1", product: "studio", target: "tcm_1", source: requests)),
            ("requestID", TeamScreenKey(requests: requests, requestID: "trq_2", product: "studio", target: "tcm_1", source: requests)),
            ("product", TeamScreenKey(requests: requests, requestID: "trq_1", product: "lab", target: "tcm_1", source: requests)),
            ("target", TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_2", source: requests)),
            ("source", TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_1", source: other)),
            ("source nil", TeamScreenKey(requests: requests, requestID: "trq_1", product: "studio", target: "tcm_1", source: nil)),
        ]
        for (field, key) in changed {
            XCTAssertFalse(base == key, field)
            XCTAssertFalse(key == base, field)
        }
    }

    func testObjectsAreComparedByIdentityNotByRole() {
        let object = Object()
        XCTAssertFalse(TeamScreenKey(requests: object) == TeamScreenKey(source: object))
    }
}
