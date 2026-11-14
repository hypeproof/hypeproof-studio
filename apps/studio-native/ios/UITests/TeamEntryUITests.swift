import XCTest

/// Existing synthetic member fixture; actual account adoption and sheet entry.
final class TeamEntryUITests: XCTestCase {
    @MainActor func testSignedInHomeOpensVerifiedInboxWithoutSettingsOrSendingDraft() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launch(); let login = app.buttons["linkDesktop"]; XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        XCTAssertTrue(app.staticTexts["accountGreeting"].waitForExistence(timeout: 10))
        let entry = app.buttons["accountApprovalsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 10)); XCTAssertTrue(entry.isHittable)
        XCTAssertFalse(app.buttons["closeConversationSettings"].exists)
        entry.tap(); XCTAssertTrue(app.staticTexts["approvalChangeSummary-member-card"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["approvalApprove-member-card"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-home-direct-approval"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["닫기"].tap(); XCTAssertTrue(app.buttons["accountQuestionsEntry"].waitForExistence(timeout: 5))
        // The existing fixture deliberately has no generic question provider.
        // Entering it must show a recoverable failure, never invented cards.
        app.buttons["accountQuestionsEntry"].tap()
        let status = app.staticTexts["accountQuestionStatus"]
        XCTAssertTrue(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND label == %@", "질문을 불러오지 못했어요. 작성한 답은 남겨 두었어요."), object: status)], timeout: 10) == .completed)
        XCTAssertFalse(app.staticTexts["accountQuestionPrompt"].exists)
    }
}
