import XCTest

/// Existing synthetic member fixture; actual account adoption and sheet entry.
final class TeamEntryUITests: XCTestCase {
    @MainActor func testFeedbackDraftIsolationCancelAndReceiptSurviveReopen() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launch()
        func reveal(_ element: XCUIElement) {
            for _ in 0..<4 {
                if element.exists && element.isHittable { return }
                app.swipeUp()
            }
            XCTAssertTrue(element.exists); XCTAssertTrue(element.isHittable)
        }
        func openFeedback() {
            let settings = app.buttons["conversationSettings"]
            XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
            let entry = app.buttons["productFeedbackEntry"]
            reveal(entry); entry.tap()
            XCTAssertTrue(app.textViews["feedbackText"].waitForExistence(timeout: 5))
        }
        openFeedback()
        let text = app.textViews["feedbackText"]
        text.tap(); text.typeText("Guest draft 4337")
        app.buttons["feedbackClose"].tap()
        app.terminate(); app.launch(); openFeedback()
        XCTAssertEqual(text.value as? String, "Guest draft 4337")
        let send = app.buttons["feedbackSend"]
        reveal(send); send.tap()
        XCTAssertTrue(app.buttons["취소"].waitForExistence(timeout: 5)); app.buttons["취소"].tap()
        XCTAssertTrue(send.isEnabled)
        app.swipeDown()
        XCTAssertEqual(app.staticTexts["feedbackRequestCount"].label, "Synthetic requests: 0")
        app.buttons["feedbackClose"].tap()
        let login = app.buttons["linkDesktop"]
        XCTAssertTrue(login.waitForExistence(timeout: 5)); login.tap()
        XCTAssertTrue(app.staticTexts["accountGreeting"].waitForExistence(timeout: 10))
        openFeedback()
        XCTAssertEqual(text.value as? String, "")
        text.tap(); text.typeText("Account draft 4337")
        app.buttons["feedbackClose"].tap()
        app.buttons["conversationSettings"].tap()
        let logout = app.buttons["로그아웃"]; reveal(logout); logout.tap()
        XCTAssertTrue(login.waitForExistence(timeout: 10)); openFeedback()
        XCTAssertEqual(text.value as? String, "Guest draft 4337")
        reveal(send); send.tap(); app.buttons["보내기"].tap()
        let receipt = app.staticTexts["feedbackReceipt"]
        XCTAssertTrue(receipt.waitForExistence(timeout: 5))
        XCTAssertEqual(receipt.label, "접수 번호: synthetic-feedback-4337")
        XCTAssertFalse(send.exists)
        app.swipeDown()
        XCTAssertEqual(app.staticTexts["feedbackRequestCount"].label, "Synthetic requests: 1")
        app.buttons["feedbackClose"].tap()
        app.terminate(); app.launch(); openFeedback()
        reveal(receipt)
        XCTAssertEqual(receipt.label, "접수 번호: synthetic-feedback-4337")
        XCTAssertFalse(send.exists)
        app.swipeDown()
        XCTAssertEqual(app.staticTexts["feedbackRequestCount"].label, "Synthetic requests: 0")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "native-feedback-synthetic-receipt-no-replay"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["feedbackClose"].tap()
        login.tap()
        XCTAssertTrue(app.staticTexts["accountGreeting"].waitForExistence(timeout: 10)); openFeedback()
        XCTAssertEqual(text.value as? String, "Account draft 4337")
    }

    @MainActor func testUncertainFeedbackRestartsWithoutResending() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_FEEDBACK_RESULT"] = "uncertain"
        func openFeedback() {
            app.buttons["conversationSettings"].tap()
            let entry = app.buttons["productFeedbackEntry"]
            XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
            XCTAssertTrue(app.textViews["feedbackText"].waitForExistence(timeout: 5))
        }
        app.launch(); openFeedback()
        app.textViews["feedbackText"].tap(); app.textViews["feedbackText"].typeText("Uncertain draft")
        let send = app.buttons["feedbackSend"]
        for _ in 0..<4 { if send.exists && send.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(send.isHittable); send.tap(); app.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["접수 여부 확인 필요"].waitForExistence(timeout: 5))
        XCTAssertFalse(send.exists)
        app.swipeDown()
        XCTAssertEqual(app.staticTexts["feedbackRequestCount"].label, "Synthetic requests: 1")
        app.terminate(); app.launch(); openFeedback()
        XCTAssertEqual(app.textViews["feedbackText"].value as? String, "Uncertain draft")
        XCTAssertEqual(app.staticTexts["feedbackRequestCount"].label, "Synthetic requests: 0")
        XCTAssertFalse(send.exists)
        XCTAssertFalse(app.staticTexts["feedbackReceipt"].exists)
    }

    @MainActor func testSettingsLoginShowsActualAccountAndLogoutClearsIdentity() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launch()
        let settings = app.buttons["conversationSettings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
        let status = app.staticTexts["accountSignInStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "로그인하지 않음")
        XCTAssertFalse(app.staticTexts["currentAccountID"].exists)
        let login = app.buttons["settingsLogin"]
        XCTAssertTrue(login.waitForExistence(timeout: 5)); XCTAssertTrue(login.isEnabled)
        login.tap()
        XCTAssertTrue(app.staticTexts["accountGreeting"].waitForExistence(timeout: 10))
        settings.tap()
        let account = app.staticTexts["currentAccountID"]
        XCTAssertTrue(account.waitForExistence(timeout: 5))
        XCTAssertEqual(account.label, "계정 ID: journey-account")
        XCTAssertEqual(status.label, "로그인됨")
        XCTAssertFalse(login.exists)
        let logout = app.buttons["로그아웃"]
        if !logout.isHittable { app.swipeUp() }
        XCTAssertTrue(logout.isHittable); logout.tap()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(login.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "로그인하지 않음")
        XCTAssertFalse(account.exists)
    }

    @MainActor func testNotificationReceivedDuringRegistrationOpensOnceWhenRegistrationFinishes() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "push-registration-held"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch(); let login = app.buttons["linkDesktop"]
        XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        // No second tap/refresh opens this sheet. The actual reference observer
        // must see busy=true before the fixture releases the registration PUT.
        let choice = app.buttons["방법이 막혔어요"]
        let opened = choice.waitForExistence(timeout: 10)
        if !opened {
            let node = app.descendants(matching: .any).matching(identifier: "nativeJourneyTrace").firstMatch
            let evidence = XCTAttachment(string: "\(node.value as? String ?? "missing trace")\n\(app.debugDescription)")
            evidence.name = "pending-push-failure"; evidence.lifetime = .keepAlways; add(evidence)
            let screen = XCTAttachment(screenshot: app.screenshot()); screen.lifetime = .keepAlways; add(screen)
        }
        XCTAssertTrue(opened); XCTAssertTrue(choice.isHittable)
        let team = try teamTrace(app)
        XCTAssertEqual(team["triggers"] as? Int, 0)
        XCTAssertEqual(team["answers"] as? Int, 0)
        XCTAssertEqual(team["events"] as? [String], [])
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "native-pending-push-opened-after-registration"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["닫기"].tap()
        XCTAssertTrue(app.navigationBars["도착한 질문"].waitForNonExistence(timeout: 5))
        let node = app.descendants(matching: .any).matching(identifier: "nativeJourneyTrace").firstMatch
        XCTAssertTrue(node.waitForExistence(timeout: 5))
        let raw = try XCTUnwrap(node.value as? String)
        let trace = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        XCTAssertEqual(trace["push_events"] as? [String], ["registration-held", "notification-observed-busy", "registration-released", "opened"])
        let paths = try XCTUnwrap(trace["paths"] as? [String])
        XCTAssertEqual(paths.filter { $0.hasPrefix("PUT /v1/me/push-devices/") }.count, 1)
        XCTAssertEqual(paths.filter { $0.hasPrefix("POST /v1/me/push-devices/") && $0.hasSuffix("/opened") }.count, 1)
        XCTAssertEqual(trace["accepted_turns"] as? Int, 0)
        XCTAssertEqual(trace["desktop_requests"] as? Int, 0)
        let evidence = XCTAttachment(string: raw)
        evidence.name = "native-pending-push-order"; evidence.lifetime = .keepAlways; add(evidence)
    }
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
        let entry = app.buttons["accountQuestionsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 10)); XCTAssertTrue(entry.isHittable)
        let input = app.textFields["sharedInput"].waitForExistence(timeout: 2) ? app.textFields["sharedInput"] : app.textViews["sharedInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap(); input.typeText("Keep my next thought")
        XCTAssertEqual(input.value as? String, "Keep my next thought")
        let keyboard = app.keyboards.firstMatch; XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        XCTAssertFalse(entry.exists, "The home entry is intentionally hidden while editing.")
        // The timeline's AX frame includes the composer. Start one real dismissal
        // drag on visible reflection content, not at the scroll view's frame center.
        let opening = app.staticTexts["reflectionOpening"]
        XCTAssertTrue(opening.isHittable)
        let window = app.windows.firstMatch, windowFrame = window.frame
        let start = opening.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // Interactive dismissal follows the drag. Ending at 90% left the
        // prediction bar and keys onscreen in the recorded failed journey.
        // Complete the same single drag at the last in-window point.
        let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1))
            .withOffset(CGVector(dx: 0, dy: -1))
        let startPoint = start.screenPoint, endPoint = end.screenPoint
        guard windowFrame.contains(startPoint), windowFrame.contains(endPoint),
              startPoint.y >= app.navigationBars.firstMatch.frame.maxY,
              startPoint.y < input.frame.minY, endPoint.y > keyboard.frame.maxY,
              endPoint.y >= windowFrame.maxY - 2,
              endPoint.y - startPoint.y > keyboard.frame.height else {
            XCTFail("The single keyboard dismissal drag must start in visible conversation content and travel down through the keyboard."); return
        }
        let geometry = XCTAttachment(string: "window=\(windowFrame); opening=\(opening.frame); input=\(input.frame); keyboard=\(keyboard.frame); start=\(startPoint); end=\(endPoint)")
        geometry.name = "native-team-keyboard-dismiss-geometry"; geometry.lifetime = .keepAlways; add(geometry)
        let editing = XCTAttachment(screenshot: app.screenshot()); editing.name = "native-team-draft-keyboard"; editing.lifetime = .keepAlways; add(editing)
        start.press(forDuration: 0.1, thenDragTo: end)
        XCTAssertTrue(keyboard.waitForNonExistence(timeout: 5))
        XCTAssertEqual(input.value as? String, "Keep my next thought")
        XCTAssertTrue(entry.exists); XCTAssertTrue(entry.isHittable)
        let restored = XCTAttachment(screenshot: app.screenshot()); restored.name = "native-team-draft-entry-restored"; restored.lifetime = .keepAlways; add(restored)
        entry.tap()
        let choice = app.buttons["방법이 막혔어요"]; XCTAssertTrue(choice.waitForExistence(timeout: 10)); XCTAssertEqual(try teamTrace(app)["triggers"] as? Int, 0); choice.tap()
        let prompt = app.staticTexts["accountQuestionPrompt"]; XCTAssertTrue(prompt.waitForExistence(timeout: 10)); XCTAssertEqual(prompt.label, "지금 바꿔 볼 작은 방법은 무엇인가요?")
        waitTeam(app) { ($0["shown"] as? Int) == 1 }; XCTAssertEqual(try teamTrace(app)["answers"] as? Int, 0)
        app.buttons["한 가지 바꿔 볼게요"].tap(); waitTeam(app) { ($0["answers"] as? Int) == 1 }
        XCTAssertEqual(try teamTrace(app)["events"] as? [String], []); XCTAssertEqual(try teamTrace(app)["triggers"] as? Int, 1)
        let next = app.buttons["accountQuestionNext"]
        XCTAssertTrue(next.waitForExistence(timeout: 5)); XCTAssertTrue(next.isHittable)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-team-question-answer-consent-off"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertEqual(try teamTrace(app)["reads"] as? Int, 2, "Answer receipt must not fetch the next question")
        next.tap(); XCTAssertTrue(choice.waitForExistence(timeout: 10)); XCTAssertTrue(choice.isHittable)
        let after = try teamTrace(app)
        XCTAssertEqual(after["reads"] as? Int, 3); XCTAssertEqual(after["answers"] as? Int, 1)
        XCTAssertEqual(after["triggers"] as? Int, 1); XCTAssertEqual(after["shown"] as? Int, 1)
        XCTAssertFalse(next.exists)
        let empty = XCTAttachment(screenshot: app.screenshot()); empty.name = "native-team-next-question-empty-choices"; empty.lifetime = .keepAlways; add(empty)
        let counts = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: after, options: [.sortedKeys]), encoding: .utf8)!)
        counts.name = "native-team-explicit-next-read"; counts.lifetime = .keepAlways; add(counts)
        app.buttons["닫기"].tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5)); XCTAssertEqual(input.value as? String, "Keep my next thought")
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
        let experience = app.buttons["productExperienceSettings"]
        // The settings list grows with account and feedback rows. Reveal the
        // real control before tapping; never substitute a direct action.
        for _ in 0..<3 {
            if experience.exists && experience.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(experience.exists); XCTAssertTrue(experience.isHittable)
        XCTAssertEqual(experience.label, "사용 경험 공유 설정"); experience.tap()
        let allow = app.buttons["productExperienceAllow"]; XCTAssertTrue(allow.waitForExistence(timeout: 10)); allow.tap(); waitTeam(app) { ($0["granted"] as? Bool) == true }
        app.buttons["productExperienceDecline"].tap(); waitTeam(app) { ($0["granted"] as? Bool) == false }
        XCTAssertEqual(try teamTrace(app)["events"] as? [String], [])
        app.buttons["닫기"].tap(); let entry = app.buttons["accountQuestionsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(app.buttons["방법이 막혔어요"].waitForExistence(timeout: 10))
    }

}
