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
    @MainActor private func teamTrace(_ app: XCUIApplication) throws -> [String: Any] {
        let node = app.staticTexts["teamEntryTrace"]; XCTAssertTrue(node.waitForExistence(timeout: 5))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(node.value as? String).utf8)) as? [String: Any])
    }
    @MainActor private func waitTeam(_ app: XCUIApplication, _ predicate: @escaping ([String: Any]) -> Bool) {
        let node = app.staticTexts["teamEntryTrace"]; XCTAssertTrue(node.waitForExistence(timeout: 5))
        let condition = NSPredicate { _, _ in guard let raw = node.value as? String, let value = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return false }; return predicate(value) }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: condition, object: nil)], timeout: 10), .completed)
    }
    @MainActor func testExplicitStartingChoiceRendersRealCardAndAnswerWithoutSharingConsent() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString; app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch(); let login = app.buttons["linkDesktop"]; XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        let entry = app.buttons["accountQuestionsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        let choice = app.buttons["방법이 막혔어요"]; XCTAssertTrue(choice.waitForExistence(timeout: 10)); XCTAssertEqual(try teamTrace(app)["triggers"] as? Int, 0); choice.tap()
        let prompt = app.staticTexts["accountQuestionPrompt"]; XCTAssertTrue(prompt.waitForExistence(timeout: 10)); XCTAssertEqual(prompt.label, "지금 바꿔 볼 작은 방법은 무엇인가요?")
        waitTeam(app) { ($0["shown"] as? Int) == 1 }; XCTAssertEqual(try teamTrace(app)["answers"] as? Int, 0)
        app.buttons["한 가지 바꿔 볼게요"].tap(); waitTeam(app) { ($0["answers"] as? Int) == 1 }
        XCTAssertEqual(try teamTrace(app)["events"] as? [String], []); XCTAssertEqual(try teamTrace(app)["triggers"] as? Int, 1)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-team-question-answer-consent-off"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["닫기"].tap()
        let traceNode = app.descendants(matching: .any).matching(identifier: "nativeJourneyTrace").firstMatch; XCTAssertTrue(traceNode.waitForExistence(timeout: 5))
        let trace = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(traceNode.value as? String).utf8)) as? [String: Any])
        XCTAssertEqual(trace["accepted_turns"] as? Int, 0); XCTAssertEqual(trace["desktop_requests"] as? Int, 0)
    }
    @MainActor func testExperienceConsentUsesExplicitSettingsAndDecliningKeepsQuestionEntry() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString; app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch(); let login = app.buttons["linkDesktop"]; XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        let settings = app.buttons["conversationSettings"]; XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
        let experience = app.buttons["사용 경험 공유 설정"]; XCTAssertTrue(experience.waitForExistence(timeout: 5)); experience.tap()
        let allow = app.buttons["productExperienceAllow"]; XCTAssertTrue(allow.waitForExistence(timeout: 10)); allow.tap(); waitTeam(app) { ($0["granted"] as? Bool) == true }
        app.buttons["productExperienceDecline"].tap(); waitTeam(app) { ($0["granted"] as? Bool) == false }
        XCTAssertEqual(try teamTrace(app)["events"] as? [String], [])
        app.buttons["닫기"].tap(); let entry = app.buttons["accountQuestionsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(app.buttons["방법이 막혔어요"].waitForExistence(timeout: 10))
    }

}
