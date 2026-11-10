import XCTest
final class StudioShellTests: XCTestCase {
    @MainActor private func editable(_ id: String, in app: XCUIApplication) -> XCUIElement {
        // Resolve after the screen transition. An immediate `.exists` check can
        // choose the wrong SwiftUI accessibility type before either one appears.
        let field = app.textFields[id]
        if field.waitForExistence(timeout: 5) { return field }
        let view = app.textViews[id]
        XCTAssertTrue(view.waitForExistence(timeout: 5))
        return view
    }
    @MainActor private func openReflection(in app: XCUIApplication) {
        let timeline = app.scrollViews["thoughtTimeline"]
        let reflection = app.buttons["openReflection"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        XCTAssertTrue(reflection.waitForExistence(timeout: 5))
        // XCTest can call clipped content behind a safe-area composer hittable.
        // Bound the target to the visible timeline instead of tapping its hidden AX frame.
        for _ in 0..<4 {
            let top = app.navigationBars.firstMatch.frame.maxY
            let bottom = app.buttons["dictateVoice"].frame.minY
            if reflection.frame.minY >= top && reflection.frame.maxY < bottom { break }
            if reflection.frame.minY < top { timeline.swipeDown() }
            else { timeline.swipeUp() }
        }
        XCTAssertLessThan(reflection.frame.maxY, app.buttons["dictateVoice"].frame.minY)
        XCTAssertGreaterThanOrEqual(reflection.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        reflection.tap()
        XCTAssertTrue(app.navigationBars["생각 정리"].waitForExistence(timeout: 5))
    }
    @MainActor func testNativeCaptureConfirmAndRelaunch() {
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
        openReflection(in: app)
        let observation = editable("reflection-observation", in: app)
        XCTAssertTrue(observation.waitForExistence(timeout: 5)); observation.tap(); observation.typeText("Two customers waited outside")
        app.buttons["닫기"].tap()
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        openReflection(in: app)
        let restored = editable("reflection-observation", in: app)
        XCTAssertEqual(restored.value as? String, "Two customers waited outside")
        app.buttons["닫기"].tap()
        // Voice auto-send consent is explicit. Cancelling it cannot capture,
        // send or replace an existing keyboard draft.
        let draft = editable("thoughtInput", in: app)
        draft.tap(); draft.typeText("Keep this unfinished thought")
        app.buttons["voiceConversation"].tap()
        XCTAssertTrue(app.buttons["startVoiceConsent"].waitForExistence(timeout: 5))
        let cancelVoice = app.buttons["cancelVoiceConsent"]
        XCTAssertTrue(cancelVoice.waitForExistence(timeout: 5))
        cancelVoice.tap()
        XCTAssertTrue(app.textFields["thoughtInput"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["startVoiceConsent"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(editable("thoughtInput", in: app).value as? String, "Keep this unfinished thought")
        XCTAssertTrue(app.buttons["dictateVoice"].exists)
        XCTAssertFalse(app.buttons["stopVoice"].exists)
        // On an unconnected client, accepting voice must transition to AI
        // consent after dismissal, without losing the draft or recording.
        app.buttons["voiceConversation"].tap()
        XCTAssertTrue(app.buttons["startVoiceConsent"].waitForExistence(timeout: 5))
        app.buttons["startVoiceConsent"].tap()
        XCTAssertTrue(app.navigationBars["무료 AI 연결"].waitForExistence(timeout: 5))
        app.buttons["닫기"].tap()
        XCTAssertEqual(editable("thoughtInput", in: app).value as? String, "Keep this unfinished thought")
        XCTAssertFalse(app.buttons["stopVoice"].exists)
        XCTAssertEqual(app.webViews.count, 0)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-iphone-intent"; shot.lifetime = .keepAlways; add(shot)
    }
}
