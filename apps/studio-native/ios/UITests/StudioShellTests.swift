import XCTest
final class StudioShellTests: XCTestCase {
    func testNativeCaptureConfirmAndRelaunch() {
        let app = XCUIApplication(); app.launch()
        let start = app.buttons["startProject"]
        XCTAssertTrue(start.waitForExistence(timeout: 10)); start.tap()
        let input = app.textFields["thoughtInput"]
        // Multiline SwiftUI fields are exposed as text views on some OS versions.
        let field = input.exists ? input : app.textViews["thoughtInput"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("A small change for local shops")
        app.buttons["sendThought"].tap()
        XCTAssertTrue(app.staticTexts["A small change for local shops"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["openIntent"].tap()
        let intent = app.textViews["intentInput"]; XCTAssertTrue(intent.waitForExistence(timeout: 5)); intent.tap(); intent.typeText("Observe one shop today")
        app.buttons["confirmIntent"].tap()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.count, 0)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-iphone-intent"; shot.lifetime = .keepAlways; add(shot)
    }
}
