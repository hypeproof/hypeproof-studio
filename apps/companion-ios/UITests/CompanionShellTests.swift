import XCTest

final class CompanionShellTests: XCTestCase {
    func testInitialShellInPortraitAndLandscapeWithoutNetworkOrCredentials() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["signInButton"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["signInStatus"].exists)
        XCTAssertFalse(app.buttons["로그아웃"].exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["signInButton"].exists)
        XCUIDevice.shared.orientation = .portrait
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testLargeTextKeepsLoginReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let button = app.buttons["signInButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        for _ in 0..<5 { if button.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(button.isHittable)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.lifetime = .keepAlways; add(screenshot)
    }
}
