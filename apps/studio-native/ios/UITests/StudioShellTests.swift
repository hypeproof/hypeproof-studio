import XCTest
final class StudioShellTests: XCTestCase {
    private func editable(_ id: String, in app: XCUIApplication) -> XCUIElement {
        // Resolve after the screen transition. An immediate `.exists` check can
        // choose the wrong SwiftUI accessibility type before either one appears.
        let field = app.textFields[id]
        if field.waitForExistence(timeout: 5) { return field }
        let view = app.textViews[id]
        XCTAssertTrue(view.waitForExistence(timeout: 5))
        return view
    }
    func testNativeCaptureConfirmAndRelaunch() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        let start = app.buttons["startProject"]
        XCTAssertTrue(start.waitForExistence(timeout: 10)); start.tap()
        let field = editable("thoughtInput", in: app)
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("A small change for local shops")
        app.buttons["sendThought"].tap()
        XCTAssertTrue(app.staticTexts["A small change for local shops"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["openIntent"].tap()
        let intent = app.textViews["intentInput"]; XCTAssertTrue(intent.waitForExistence(timeout: 5)); intent.tap(); intent.typeText("Observe one shop today")
        app.buttons["confirmIntent"].tap()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        app.swipeDown()
        let reflection = app.buttons["openReflection"]
        XCTAssertTrue(reflection.waitForExistence(timeout: 5)); reflection.tap()
        let observation = editable("reflection-observation", in: app)
        XCTAssertTrue(observation.waitForExistence(timeout: 5)); observation.tap(); observation.typeText("Two customers waited outside")
        app.buttons["닫기"].tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        app.buttons["openReflection"].tap()
        let restored = editable("reflection-observation", in: app)
        XCTAssertEqual(restored.value as? String, "Two customers waited outside")
        app.buttons["닫기"].tap()
        XCTAssertEqual(app.webViews.count, 0)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-iphone-intent"; shot.lifetime = .keepAlways; add(shot)
    }
}
