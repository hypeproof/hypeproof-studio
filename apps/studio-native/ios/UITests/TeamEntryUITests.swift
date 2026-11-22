import XCTest

/// Existing synthetic member fixture; actual account adoption and sheet entry.
final class TeamEntryUITests: XCTestCase {
    @MainActor func testFeedbackDraftIsolationCancelAndReceiptSurviveReopen() throws {
        continueAfterFailure = false
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launch()
        func reveal(_ element: XCUIElement, line: UInt = #line) { listReveal(app, element, line: line) }
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
        let app = studioApp()
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
        listReveal(app, send); send.tap(); app.buttons["보내기"].tap()
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
        let app = studioApp()
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
        listReveal(app, logout); logout.tap()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(login.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "로그인하지 않음")
        XCTAssertFalse(account.exists)
    }

    @MainActor func testNotificationReceivedDuringRegistrationOpensOnceWhenRegistrationFinishes() throws {
        continueAfterFailure = false
        let app = studioApp(); app.launchArguments = ["--native-journey"]
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
        let app = studioApp(); app.launchArguments = ["--native-journey"]
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
        let app = studioApp(); app.launchArguments = ["--native-journey"]
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
        let app = studioApp(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString; app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch(); let login = app.buttons["linkDesktop"]; XCTAssertTrue(login.waitForExistence(timeout: 10)); login.tap()
        let settings = app.buttons["conversationSettings"]; XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
        let experience = app.buttons["productExperienceSettings"]
        // The settings list grows with account and feedback rows. Reveal the
        // real control before tapping; never substitute a direct action.
        listReveal(app, experience)
        XCTAssertEqual(experience.label, "사용 경험 공유 설정"); experience.tap()
        let allow = app.buttons["productExperienceAllow"]; XCTAssertTrue(allow.waitForExistence(timeout: 10)); allow.tap(); waitTeam(app) { ($0["granted"] as? Bool) == true }
        app.buttons["productExperienceDecline"].tap(); waitTeam(app) { ($0["granted"] as? Bool) == false }
        XCTAssertEqual(try teamTrace(app)["events"] as? [String], [])
        app.buttons["닫기"].tap(); let entry = app.buttons["accountQuestionsEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 5)); entry.tap()
        XCTAssertTrue(app.buttons["방법이 막혔어요"].waitForExistence(timeout: 10))
    }

    @MainActor func testInternalRequestCancelReceiptAndDiscussion() throws {
        continueAfterFailure = false
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        let entry = app.buttons["teamRequestHomeEntry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        func reveal(_ element: XCUIElement, line: UInt = #line) { listReveal(app, element, line: line) }
        let text = app.textViews["teamRequestBody"]
        XCTAssertTrue(text.waitForExistence(timeout: 10)); text.tap(); text.typeText("Internal request 4340")
        let send = app.buttons["teamRequestSend"]; reveal(send); send.tap()
        XCTAssertTrue(app.alerts.buttons["취소"].waitForExistence(timeout: 5)); app.alerts.buttons["취소"].tap()
        XCTAssertTrue(send.isEnabled); XCTAssertEqual(text.value as? String, "Internal request 4340")
        send.tap(); app.alerts.buttons["보내기"].tap()
        let receipt = app.staticTexts["teamRequestReceipt"]
        XCTAssertTrue(receipt.waitForExistence(timeout: 10)); XCTAssertTrue(receipt.label.contains("trq_"))
        app.buttons["teamRequestClose"].tap(); entry.tap()
        let trace = app.staticTexts["teamRequestTrace"]
        XCTAssertTrue(trace.waitForExistence(timeout: 10)); XCTAssertTrue((trace.value as? String ?? "").contains("\"requestPosts\":1"))
        let discussion = app.buttons["요청과 논의 보기"]; reveal(discussion); discussion.tap()
        XCTAssertTrue(app.staticTexts["Internal request 4340"].waitForExistence(timeout: 10))
        let comment = app.textViews["teamCommentBody"]; reveal(comment); comment.tap(); comment.typeText("Follow up question")
        let sendComment = app.buttons["teamCommentSend"]; reveal(sendComment); sendComment.tap()
        app.alerts.buttons["취소"].tap(); XCTAssertTrue(sendComment.isEnabled)
        sendComment.tap(); app.alerts.buttons["보내기"].tap()
        // A received local body stays withheld until fresh matching history. Assert the
        // actual receipt status, then retain the fresh-read/exact-comment check below.
        let commentReceipt = app.staticTexts["teamCommentStatus"]
        for _ in 0..<8 {
            if commentReceipt.exists {
                let frame = commentReceipt.frame
                if !frame.isEmpty && !frame.isInfinite && !frame.isNull && app.windows.firstMatch.frame.contains(frame) { break }
            }
            app.swipeDown()
        }
        XCTAssertTrue(commentReceipt.waitForExistence(timeout: 10))
        XCTAssertEqual(commentReceipt.label,"댓글이 접수됐어요. 새로고침하면 논의에서 확인할 수 있어요.")
        let receiptFrame = commentReceipt.frame
        XCTAssertFalse(receiptFrame.isEmpty || receiptFrame.isInfinite || receiptFrame.isNull)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(receiptFrame))
        app.buttons["새로고침"].tap()
        let receivedComment = app.staticTexts["Follow up question"]
        reveal(receivedComment)
        XCTAssertTrue(receivedComment.waitForExistence(timeout: 10))
        XCTAssertEqual(receivedComment.label, "Follow up question")
        let commentFrame = receivedComment.frame
        XCTAssertFalse(commentFrame.isEmpty || commentFrame.isInfinite || commentFrame.isNull)
        XCTAssertTrue(app.windows.firstMatch.frame.contains(commentFrame))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "internal-request-synthetic-discussion"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testInternalWorkflowCancelSaveAndHistory() throws {
        continueAfterFailure = false
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        let entry = app.buttons["teamRequestHomeEntry"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        func reveal(_ element: XCUIElement, line: UInt = #line) { listReveal(app, element, line: line) }
        let body = app.textViews["teamRequestBody"]
        XCTAssertTrue(body.waitForExistence(timeout: 10)); body.tap(); body.typeText("Workflow request 4342")
        let sendRequest = app.buttons["teamRequestSend"]; reveal(sendRequest); sendRequest.tap(); app.alerts.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["teamRequestReceipt"].waitForExistence(timeout: 10))
        app.buttons["teamRequestClose"].tap(); entry.tap()
        let discussion = app.buttons["요청과 논의 보기"]; reveal(discussion); discussion.tap()
        let workflow = app.buttons["teamWorkflowEntry"]; XCTAssertTrue(workflow.waitForExistence(timeout: 10)); reveal(workflow); workflow.tap()
        let reason = app.textViews["teamWorkflowReason"]
        XCTAssertTrue(reason.waitForExistence(timeout: 10)); reveal(reason); reason.tap(); reason.typeText("Needs device reproduction")
        let save = app.buttons["teamWorkflowSend"]; reveal(save); save.tap()
        XCTAssertTrue(app.alerts.buttons["취소"].waitForExistence(timeout: 5)); app.alerts.buttons["취소"].tap()
        XCTAssertEqual(reason.value as? String, "Needs device reproduction")
        save.tap(); app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamWorkflowReceipt"].waitForExistence(timeout: 10))
        app.buttons["새로고침"].tap()
        let history = app.staticTexts["Needs device reproduction"]; reveal(history)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "internal-workflow-synthetic-history"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testInternalRequestUnknownResultRecoversWithoutReplay() throws {
        continueAfterFailure = false
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launchEnvironment["HP_TEAM_REQUEST_RESULT"] = "uncertain"
        app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        let entry = app.buttons["teamRequestHomeEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        let text = app.textViews["teamRequestBody"]; XCTAssertTrue(text.waitForExistence(timeout: 10)); text.tap(); text.typeText("Response lost 4340")
        let send = app.buttons["teamRequestSend"]
        listReveal(app, send); send.tap(); app.alerts.buttons["보내기"].tap()
        let recover = app.buttons["teamRequestRecover"]
        XCTAssertTrue(recover.waitForExistence(timeout: 10)); XCTAssertFalse(app.staticTexts["teamRequestReceipt"].exists)
        recover.tap(); XCTAssertTrue(app.staticTexts["teamRequestReceipt"].waitForExistence(timeout: 10))
        app.buttons["teamRequestClose"].tap(); entry.tap()
        let trace = app.staticTexts["teamRequestTrace"]
        XCTAssertTrue(trace.waitForExistence(timeout: 10)); XCTAssertTrue((trace.value as? String ?? "").contains("\"requestPosts\":1"))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "internal-request-synthetic-recovery-no-post"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testInternalCommentSaveFailureKeepsExportAndGuardsLeaving() throws {
        continueAfterFailure = false
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        app.launchEnvironment["HP_TEAM_DRAFT_SAVE_FAILURE"] = "comment"
        app.launchEnvironment["HP_TEAM_DETAIL_FAILURE"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        let entry = app.buttons["teamRequestHomeEntry"]; XCTAssertTrue(entry.waitForExistence(timeout: 10)); entry.tap()
        func reveal(_ element: XCUIElement, line: UInt = #line) { listReveal(app, element, line: line) }
        let text = app.textViews["teamRequestBody"]; XCTAssertTrue(text.waitForExistence(timeout: 10)); text.tap(); text.typeText("Storage request")
        let send = app.buttons["teamRequestSend"]; reveal(send); send.tap(); app.alerts.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["teamRequestReceipt"].waitForExistence(timeout: 10))
        let discussion = app.buttons["요청과 논의 보기"]; reveal(discussion); discussion.tap()
        let comment = app.textViews["teamCommentBody"]; XCTAssertTrue(comment.waitForExistence(timeout: 10)); comment.tap(); comment.typeText("X")
        XCTAssertEqual(comment.value as? String, "X")
        let export = app.buttons["댓글 내용 내보내기"]; reveal(export); XCTAssertTrue(export.isEnabled)
        XCTAssertFalse(app.buttons["teamCommentSend"].isEnabled)
        app.buttons["teamCommentBack"].tap()
        XCTAssertTrue(app.alerts["저장되지 않은 댓글이 있어요"].waitForExistence(timeout: 5)); app.alerts.buttons["계속 작성"].tap()
        XCTAssertEqual(comment.value as? String, "X"); XCTAssertTrue(export.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "internal-comment-unsaved-export-and-exit-guard"; shot.lifetime = .keepAlways; add(shot)
    }

    enum RevealDirection { case towardEnd, towardStart }
    private func usableFrame(_ frame: CGRect) -> Bool { !frame.isNull && !frame.isEmpty && !frame.isInfinite }
    /// The visible scrolling area: the owning List when known, clipped by the
    /// window, the navigation bar, and the keyboard or the home indicator.
    @MainActor private func revealViewport(_ app: XCUIApplication, _ container: XCUIElement?) -> CGRect {
        let window = app.windows.firstMatch.frame
        var area = window
        if let container, container.exists, usableFrame(container.frame) { area = area.intersection(container.frame) }
        // A row scrolled under the navigation bar is not tappable: the tap at
        // (53, 76.5) landed on the bar and "원문에 답글" stayed unselected
        // (run 44879419945 shard 4). Such a row is now outside the viewport,
        // so listReveal drags once more. With a sheet open, firstMatch was the
        // background "나의 질문" bar (maxY 116), not the sheet's "요청과 논의"
        // bar (maxY 132) (run 44907883087 shard 4). Take the lowest on-screen bar.
        let bars = app.navigationBars.allElementsBoundByIndex.compactMap { presentFrame($0) }
            .filter { $0.minX >= window.minX - 1 && $0.maxX <= window.maxX + 1 }
        if let barBottom = bars.map(\.maxY).max(), barBottom > area.minY, barBottom < area.maxY {
            area.size.height = area.maxY - barBottom
            area.origin.y = barBottom
        }
        if let keyboard = presentFrame(app.keyboards.firstMatch) {
            if keyboard.minY < area.maxY { area.size.height = max(0, keyboard.minY - area.minY) }
        } else if area.maxY > window.maxY - homeIndicatorInset {
            // Candidate, from one sample: teamCommentSend {16,791.3,370x74}
            // ended at 865.3, inside the bottom 34 pt of the 874 pt window, and
            // isHittable failed with "Activation point invalid" (run
            // 44907883087 shard 4). Such a row now gets one more drag.
            area.size.height = max(0, window.maxY - homeIndicatorInset - area.minY)
        }
        return area
    }
    private let homeIndicatorInset: CGFloat = 34
    /// The frame of an element that is on screen now, read from one snapshot.
    /// `exists` comes first: a snapshot of an absent element retries twice,
    /// about 2.8 s per call (47.7 s in one test, run 44879419945 shard 3).
    /// The snapshot is kept because a live exists + frame pair raced the
    /// keyboard closing after "저장" and threw "No matches found" (run
    /// 44874729460). A snapshot that fails in that race means absent.
    @MainActor private func presentFrame(_ element: XCUIElement) -> CGRect? {
        guard element.exists, let frame = try? element.snapshot().frame, usableFrame(frame) else { return nil }
        return frame
    }
    /// One short drag inside the viewport. A drag has no fling, so it cannot
    /// carry a lazily loaded row past the viewport the way a swipe can.
    /// The drag runs in the List's left margin (8 pt in), outside the inset
    /// cells. At the centre it started inside the focused teamRequestBody
    /// TextView {36,396,330x130}, which took the drag, so the List never
    /// scrolled in run 44857710643 (#4432).
    @MainActor private func revealDrag(_ app: XCUIApplication, _ area: CGRect, _ direction: RevealDirection) {
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let (from, to): (CGFloat, CGFloat) = direction == .towardEnd ? (0.7, 0.3) : (0.3, 0.7)
        let lane = area.minX + 8
        origin.withOffset(CGVector(dx: lane, dy: area.minY + area.height * from))
            .press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: lane, dy: area.minY + area.height * to)))
    }
    @MainActor private func revealFailure(_ app: XCUIApplication, _ item: XCUIElement, _ steps: [String], file: StaticString, line: UInt) {
        let name = "reveal-failure-" + String(item.description.prefix(60))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name + "-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = name + "-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        XCTFail("\(item) was not revealed as a hittable control inside its List viewport.\n" + steps.joined(separator: "\n"), file: file, line: line)
    }
    /// Scrolls the owning List until `item` is inside the viewport, then proves
    /// real hittability. XCTest fails a case outright when asked whether an
    /// offscreen element is hittable ("Activation point invalid"), so
    /// isHittable is read only once the frame is inside the viewport (#4432).
    @MainActor private func listReveal(_ app: XCUIApplication, _ item: XCUIElement, in container: XCUIElement? = nil,
                                       toward preferred: RevealDirection = .towardEnd, file: StaticString = #filePath, line: UInt = #line) {
        var steps: [String] = []
        for attempt in 0..<10 {
            let area = revealViewport(app, container)
            let frame: CGRect? = item.exists ? item.frame : nil
            var direction = preferred
            if let frame, usableFrame(frame) {
                if area.contains(frame) {
                    if item.isHittable { return }
                    steps.append("\(attempt): inside viewport \(area) but not hittable; frame=\(frame)")
                } else {
                    steps.append("\(attempt): outside viewport \(area); frame=\(frame)")
                }
                if frame.minY < area.minY { direction = .towardStart } else if frame.maxY > area.maxY { direction = .towardEnd }
            } else {
                // A lazily loaded List row may be on either side. Search the
                // preferred side first, then the other one.
                if attempt >= 5 { direction = preferred == .towardEnd ? .towardStart : .towardEnd }
                steps.append("\(attempt): \(frame == nil ? "not loaded" : "no usable frame") in viewport \(area); dragging \(direction)")
            }
            revealDrag(app, area, direction)
        }
        revealFailure(app, item, steps, file: file, line: line)
    }
    /// Brings a diagnostic row into the accessibility tree to read its value.
    /// It is never tapped, so hittability is not requested.
    @MainActor private func readReveal(_ app: XCUIApplication, _ item: XCUIElement, in container: XCUIElement? = nil,
                                       toward direction: RevealDirection = .towardStart, file: StaticString = #filePath, line: UInt = #line) {
        var steps: [String] = []
        for attempt in 0..<8 {
            if item.exists { return }
            let area = revealViewport(app, container)
            steps.append("\(attempt): not loaded in viewport \(area)")
            revealDrag(app, area, direction)
        }
        if item.exists { return }
        revealFailure(app, item, steps, file: file, line: line)
    }

    /// `composeEntry: false` (the default) starts from one request the synthetic
    /// Service already acknowledged (`HP_TEAM_SEED_SENT`, DEBUG fixture only).
    /// Every case below is about a later step and repeated compose → send →
    /// receipt → close → reopen, about 30 s each on hosted runners (#4432).
    /// The real entry stays proven: testInternalGitHubCancelSaveAndHistory passes
    /// `composeEntry: true`, and the request cases above never seed.
    @MainActor private func githubApp(_ flags: [String:String] = [:], delivery: Bool = false, outcome: Bool = false, composeEntry: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = studioApp(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString; app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        if !composeEntry { app.launchEnvironment["HP_TEAM_SEED_SENT"] = "GitHub fixture request" }
        for (key,value) in flags { app.launchEnvironment[key] = value }; app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        XCTAssertTrue(app.buttons["teamRequestHomeEntry"].waitForExistence(timeout: 10))
        if flags["HP_TEAM_DISCUSSION"] == "1" {
            XCTAssertTrue(app.buttons["teamInboxHomeEntry"].isHittable); app.buttons["teamInboxHomeEntry"].tap()
            XCTAssertTrue(app.navigationBars["팀 알림함"].waitForExistence(timeout:10)); app.navigationBars["팀 알림함"].buttons["닫기"].tap()
        }
        XCTAssertTrue(app.buttons["teamRequestHomeEntry"].isHittable); app.buttons["teamRequestHomeEntry"].tap()
        if composeEntry {
            let body = app.textViews["teamRequestBody"]; XCTAssertTrue(body.waitForExistence(timeout: 10)); body.tap(); body.typeText("GitHub fixture request")
            githubReveal(app, app.buttons["teamRequestSend"]); app.buttons["teamRequestSend"].tap(); app.alerts.buttons["보내기"].tap()
            XCTAssertTrue(app.staticTexts["teamRequestReceipt"].waitForExistence(timeout: 10))
            app.buttons["teamRequestClose"].tap(); app.buttons["teamRequestHomeEntry"].tap()
        }
        // Seeded or composed, the reopened screen must show the acknowledged receipt.
        let receipt = app.staticTexts["teamRequestReceipt"]; XCTAssertTrue(receipt.waitForExistence(timeout: 10))
        XCTAssertEqual(receipt.label, "접수 번호: trq_" + String(repeating: "a", count: 32))
        githubReveal(app,app.buttons["요청과 논의 보기"]); app.buttons["요청과 논의 보기"].tap()
        if flags["HP_TEAM_DISCUSSION"] == "1" || flags["HP_TEAM_RELATED"] == "1" { return app }
        let entry = app.buttons[outcome ? "teamOutcomeEntry" : delivery ? "teamDeliveryEntry" : "teamGitHubEntry"]
        XCTAssertTrue(app.buttons["teamRequestTextHistory"].waitForExistence(timeout: 10))
        detailReveal(app, entry); entry.tap()
        return app
    }
    @MainActor private func detailReveal(_ app: XCUIApplication, _ item: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let list = app.collectionViews["teamRequestDetailList"]
        XCTAssertTrue(list.waitForExistence(timeout: 10), file: file, line: line)
        listReveal(app, item, in: list, file: file, line: line)
    }
    @MainActor private func githubReveal(_ app: XCUIApplication, _ item: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        listReveal(app, item, file: file, line: line)
    }
    @MainActor private func githubTrace(_ app: XCUIApplication) -> String {
        let trace = app.staticTexts["teamGitHubTrace"]
        // This diagnostic value is read, never tapped. Asking for an activation
        // point can fail even when its accessibility value is available.
        // readReveal stops at the first row; dragging further dismisses the sheet.
        readReveal(app, trace)
        return trace.value as? String ?? ""
    }
    @MainActor private func relatedTrace(_ app:XCUIApplication)->String{
        let trace=app.staticTexts["teamRelatedTrace"]
        readReveal(app, trace); return trace.value as? String ?? ""
    }
    @MainActor private func textTrace(_ app: XCUIApplication) -> [String:Any] {
        let trace=app.staticTexts["teamTextTrace"]
        readReveal(app, trace)
        let value=trace.value as? String ?? "{}"
        return (try? JSONSerialization.jsonObject(with:Data(value.utf8))) as? [String:Any] ?? [:]
    }
    @MainActor private func intakeReveal(_ app:XCUIApplication,_ item:XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        if app.keyboards.firstMatch.exists {
            let done = app.buttons["teamIntakeKeyboardDone"]
            XCTAssertTrue(done.waitForExistence(timeout: 5), file: file, line: line)
            XCTAssertTrue(done.isHittable, file: file, line: line); done.tap()
            let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
            XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 5), .completed, file: file, line: line)
        }
        let form = app.collectionViews["teamIntakeForm"]
        XCTAssertTrue(form.waitForExistence(timeout: 5), file: file, line: line)
        listReveal(app, item, in: form, file: file, line: line)
    }
    @MainActor private func intakeTrace(_ app: XCUIApplication) throws -> [String:Any] {
        let item = app.staticTexts["teamIntakeTrace"]
        readReveal(app, item, in: app.collectionViews["teamIntakeForm"])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data((item.value as? String ?? "{}").utf8)) as? [String:Any])
    }
    @MainActor func testIntakeExplicitPreviewUnknownRecoveryPreservesPublishedIssue() throws {
        let app = githubApp(["HP_TEAM_INTAKE":"unknown","HP_TEAM_TEXT":"1","HP_TEAM_RELATED":"1","HP_TEAM_INTAKE_ASSOCIATION_FAIL":"1"])
        githubReveal(app, app.buttons["teamIntakeEntry"]); app.buttons["teamIntakeEntry"].tap()
        XCTAssertTrue(app.buttons["teamIntakeLogin"].waitForExistence(timeout:10)); app.buttons["teamIntakeLogin"].tap()
        XCTAssertTrue(app.staticTexts["teamIntakeCode"].waitForExistence(timeout:10)); XCTAssertEqual(app.staticTexts["teamIntakeCode"].label,"ABCD-1234")
        XCTAssertTrue(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:app.buttons["teamIntakePoll"])],timeout:5) == .completed); app.buttons["teamIntakePoll"].tap()
        XCTAssertTrue(app.buttons["teamIntakeDisconnect"].waitForExistence(timeout:10))
        for (id,words) in [("teamIntakeTitle","Public test summary"),("teamIntakeIntent","Help the team"),("teamIntakeChange","Improve the request screen"),("teamIntakeAcceptance","The visible result is usable")] {
            let field = app.descendants(matching:.any).matching(identifier:id).firstMatch
            intakeReveal(app,field); field.tap(); field.typeText(words); XCTAssertEqual(field.value as? String,words)
        }
        intakeReveal(app,app.buttons["teamIntakePreview"]); app.buttons["teamIntakePreview"].tap()
        intakeReveal(app,app.buttons["teamIntakeSend"]); app.buttons["teamIntakeSend"].tap(); app.alerts.buttons["취소"].tap()
        XCTAssertEqual(try intakeTrace(app)["posts"] as? Int,0)
        intakeReveal(app,app.buttons["teamIntakeSend"]); app.buttons["teamIntakeSend"].tap(); app.alerts.buttons["확인하고 전송"].tap()
        XCTAssertTrue(app.staticTexts["teamIntakeFailure"].waitForExistence(timeout:10))
        intakeReveal(app,app.buttons["teamIntakeSend"]); app.buttons["teamIntakeSend"].tap(); app.alerts.buttons["확인하고 전송"].tap()
        intakeReveal(app, app.descendants(matching:.any).matching(identifier:"teamIntakeIssue").firstMatch); XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"teamIntakeIssue").firstMatch.isHittable)
        let keys = try XCTUnwrap(intakeTrace(app)["keys"] as? [String]); XCTAssertEqual(keys.count,2); XCTAssertEqual(keys[0],keys[1])
        intakeReveal(app,app.buttons["teamIntakeAssociate"]); app.buttons["teamIntakeAssociate"].tap()
        XCTAssertTrue(app.navigationBars["GitHub 연결 근거"].waitForExistence(timeout:10))
        githubReveal(app,app.buttons["teamGitHubSend"]); app.buttons["teamGitHubSend"].tap(); app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamGitHubMessage"].waitForExistence(timeout:10))
        let associationTrace = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(githubTrace(app).utf8)) as? [String:Any]); XCTAssertEqual(associationTrace["githubPosts"] as? Int,1); XCTAssertEqual(associationTrace["githubEvents"] as? Int,0)
        app.navigationBars.buttons.element(boundBy:0).tap()
        intakeReveal(app, app.descendants(matching:.any).matching(identifier:"teamIntakeIssue").firstMatch); XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"teamIntakeIssue").firstMatch.isHittable); XCTAssertEqual(try intakeTrace(app)["posts"] as? Int,2)
    }

    @MainActor func testIntakeFailedSummarySaveKeepsExportAndBlocksPublication() throws {
        let app = githubApp(["HP_TEAM_INTAKE":"normal","HP_TEAM_TEXT":"1","HP_TEAM_RELATED":"1","HP_TEAM_DRAFT_SAVE_FAILURE":"intake","HP_TEAM_INTAKE_DISCONNECT_FAIL":"1"])
        githubReveal(app,app.buttons["teamIntakeEntry"]); app.buttons["teamIntakeEntry"].tap()
        XCTAssertTrue(app.buttons["teamIntakeLogin"].waitForExistence(timeout:10));app.buttons["teamIntakeLogin"].tap()
        XCTAssertTrue(app.buttons["teamIntakePoll"].waitForExistence(timeout:10))
        XCTAssertTrue(XCTWaiter.wait(for:[XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:app.buttons["teamIntakePoll"])],timeout:5) == .completed);app.buttons["teamIntakePoll"].tap()
        XCTAssertTrue(app.buttons["teamIntakeDisconnect"].waitForExistence(timeout:10))
        app.buttons["teamIntakeDisconnect"].tap()
        XCTAssertTrue(app.staticTexts["teamIntakeMessage"].waitForExistence(timeout:5));XCTAssertTrue(app.staticTexts["teamIntakeMessage"].label.contains("지우지 못했어요"))
        XCTAssertTrue(app.buttons["teamIntakeDisconnect"].exists);XCTAssertFalse(app.buttons["teamIntakeLogin"].exists)
        let authTrace=try intakeTrace(app);XCTAssertEqual(authTrace["starts"] as? Int,1);XCTAssertEqual(authTrace["polls"] as? Int,1)
        let title=app.descendants(matching:.any).matching(identifier:"teamIntakeTitle").firstMatch
        intakeReveal(app,title);title.tap();title.typeText("Unstored public summary");XCTAssertEqual(title.value as? String,"Unstored public summary")
        intakeReveal(app,app.buttons["teamIntakeSummaryExport"]);XCTAssertTrue(app.buttons["teamIntakeSummaryExport"].isHittable);XCTAssertFalse(app.buttons["teamIntakePreview"].isEnabled)
        XCTAssertEqual(try intakeTrace(app)["posts"] as? Int,0)
        intakeReveal(app,app.buttons["teamIntakeRefresh"]);app.buttons["teamIntakeRefresh"].tap()
        intakeReveal(app,title);XCTAssertEqual(title.value as? String,"Unstored public summary")
        app.navigationBars["공개 요청 제안"].buttons["닫기"].tap();app.alerts.buttons["계속 작성"].tap()
        intakeReveal(app,title);XCTAssertEqual(title.value as? String,"Unstored public summary")
    }

    @MainActor func testTextHistoryLatestQuestionUnknownRecoveryAndConflictChoice() throws {
        let app=githubApp(["HP_TEAM_TEXT":"1","HP_TEAM_TEXT_RECOVERY":"1","HP_TEAM_RELATED":"1"])
        let latest=app.buttons["teamLatestQuestion"];githubReveal(app,latest);latest.tap()
        XCTAssertTrue(app.staticTexts["teamTextCurrent"].waitForExistence(timeout:10));XCTAssertEqual(app.staticTexts["teamTextCurrent"].label,"Latest explicit question beyond first page")
        app.navigationBars["내용과 수정 이력"].buttons.element(boundBy:0).tap()
        let entry=app.buttons["teamRequestTextHistory"];XCTAssertTrue(entry.waitForExistence(timeout:10));githubReveal(app,entry);entry.tap()
        XCTAssertTrue(app.staticTexts["teamTextOriginal"].waitForExistence(timeout:10));XCTAssertEqual(app.staticTexts["teamTextOriginal"].label,"GitHub fixture request")
        githubReveal(app,app.buttons["teamTextBeginEdit"]);app.buttons["teamTextBeginEdit"].tap()
        let editor=app.textViews["teamTextBody"];githubReveal(app,editor);XCTAssertEqual(editor.value as? String,"GitHub fixture request");editor.tap();editor.typeText(" corrected")
        let firstWords=try XCTUnwrap(editor.value as? String);XCTAssertEqual(firstWords.components(separatedBy:" corrected").count,2);XCTAssertEqual(firstWords.replacingOccurrences(of:" corrected",with:""),"GitHub fixture request")
        githubReveal(app,app.buttons["teamTextSend"]);app.buttons["teamTextSend"].tap();app.alerts.buttons["취소"].tap()
        XCTAssertEqual(textTrace(app)["textPosts"] as? Int,0)
        githubReveal(app,app.buttons["teamTextSend"]);app.buttons["teamTextSend"].tap();app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamTextPreservedBody"].waitForExistence(timeout:10));XCTAssertEqual(app.staticTexts["teamTextPreservedBody"].label,firstWords)
        app.buttons["teamTextRefresh"].tap();githubReveal(app,app.buttons["teamTextSend"]);app.buttons["teamTextSend"].tap();app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamTextReceipt"].waitForExistence(timeout:10));var keys=textTrace(app)["textKeys"] as? [String] ?? [];XCTAssertEqual(keys.count,2);XCTAssertEqual(keys.first,keys.last)
        app.buttons["teamTextRefresh"].tap();githubReveal(app,app.buttons["teamTextBeginEdit"]);app.buttons["teamTextBeginEdit"].tap()
        githubReveal(app,editor);XCTAssertEqual(editor.value as? String,firstWords);editor.tap();editor.typeText(" again")
        let secondWords=try XCTUnwrap(editor.value as? String);XCTAssertEqual(secondWords.components(separatedBy:" again").count,2);XCTAssertEqual(secondWords.replacingOccurrences(of:" again",with:""),firstWords)
        githubReveal(app,app.buttons["teamTextSend"]);app.buttons["teamTextSend"].tap();app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamTextConflict"].waitForExistence(timeout:10))
        app.buttons["teamTextRefresh"].tap();githubReveal(app,app.buttons["teamTextBeginEdit"]);app.buttons["teamTextBeginEdit"].tap()
        githubReveal(app,app.buttons["teamTextSend"]);app.buttons["teamTextSend"].tap();app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamTextReceipt"].waitForExistence(timeout:10));keys=textTrace(app)["textKeys"] as? [String] ?? [];XCTAssertEqual(keys.count,4);XCTAssertNotEqual(keys[2],keys[3])
        app.buttons["teamTextRefresh"].tap();XCTAssertTrue(app.staticTexts["teamTextCurrent"].waitForExistence(timeout:10));XCTAssertEqual(app.staticTexts["teamTextCurrent"].label,secondWords);XCTAssertEqual(app.staticTexts["teamTextOriginal"].label,"GitHub fixture request")
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="text-revision-original-current-confirmed-history";shot.lifetime = .keepAlways;add(shot)
    }
    @MainActor private func openRequestTextHistory(_ app: XCUIApplication) {
        let entry = app.buttons["teamRequestTextHistory"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10), "Request details must load before revealing text history.")
        detailReveal(app, entry)
        entry.tap()
    }

    @MainActor func testTextHistoryReadonlyAndFailedSavePreservesExport() throws {
        let readonly=githubApp(["HP_TEAM_TEXT":"1","HP_TEAM_TEXT_READONLY":"1","HP_TEAM_RELATED":"1"])
        openRequestTextHistory(readonly)
        XCTAssertTrue(readonly.staticTexts["teamTextReadOnly"].waitForExistence(timeout:10));XCTAssertFalse(readonly.buttons["teamTextBeginEdit"].exists);XCTAssertEqual(textTrace(readonly)["textPosts"] as? Int,0);readonly.terminate()
        let app=githubApp(["HP_TEAM_TEXT":"1","HP_TEAM_DRAFT_SAVE_FAILURE":"text","HP_TEAM_RELATED":"1"])
        openRequestTextHistory(app)
        githubReveal(app,app.buttons["teamTextBeginEdit"]);app.buttons["teamTextBeginEdit"].tap()
        let editor=app.textViews["teamTextBody"];githubReveal(app,editor);XCTAssertEqual(editor.value as? String,"GitHub fixture request");editor.tap();editor.typeText(" Unstored")
        let unsaved=try XCTUnwrap(editor.value as? String);XCTAssertEqual(unsaved.components(separatedBy:" Unstored").count,2);XCTAssertEqual(unsaved.replacingOccurrences(of:" Unstored",with:""),"GitHub fixture request");githubReveal(app,app.buttons["teamTextExport"]);XCTAssertTrue(app.buttons["teamTextExport"].isHittable);XCTAssertFalse(app.buttons["teamTextSend"].isEnabled);XCTAssertEqual(textTrace(app)["textPosts"] as? Int,0)
        app.buttons["뒤로"].tap();XCTAssertTrue(app.alerts.buttons["계속 작성"].waitForExistence(timeout:5));app.alerts.buttons["계속 작성"].tap();githubReveal(app,editor);XCTAssertEqual(editor.value as? String,unsaved)
    }

    @MainActor func testHiddenRequestEvidenceAndExplicitReporterReopen() throws {
        let app = githubApp(["HP_TEAM_HIDDEN":"1","HP_TEAM_RELATED":"1"])
        XCTAssertTrue(app.staticTexts["teamHiddenContentNotice"].waitForExistence(timeout:10))
        XCTAssertFalse(app.staticTexts["GitHub fixture request"].exists)
        for (entry,title) in [("teamGitHubEntry","GitHub 연결 근거"),("teamDeliveryEntry","배포 버전과 안내")] {
            githubReveal(app,app.buttons[entry]);app.buttons[entry].tap()
            XCTAssertTrue(app.staticTexts["보관 기한이 지나 내용을 숨겼어요."].firstMatch.waitForExistence(timeout:10))
            XCTAssertFalse(app.staticTexts["작성자 삭제로 배포 근거가 제거됐어요."].exists)
            app.navigationBars.buttons.element(boundBy:0).tap()
            XCTAssertTrue(app.buttons["teamOutcomeEntry"].waitForExistence(timeout:10),title)
        }
        githubReveal(app,app.buttons["teamOutcomeEntry"]);app.buttons["teamOutcomeEntry"].tap()
        XCTAssertTrue(app.buttons["teamOutcomeReopened"].waitForExistence(timeout:10));app.buttons["teamOutcomeReopened"].tap()
        githubReveal(app,app.staticTexts["teamOutcomeBuild"]);XCTAssertTrue(app.staticTexts["teamOutcomeBuild"].label.contains("18.1"))
        let words=app.textViews["teamOutcomeResult"];githubReveal(app,words);words.tap();words.typeText("Still reproducible in this build")
        githubReveal(app,app.buttons["teamOutcomeSend"]);app.buttons["teamOutcomeSend"].tap()
        app.alerts.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["teamOutcomeReceipt"].waitForExistence(timeout:10))
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="hidden-request-explicit-reopen";shot.lifetime = .keepAlways;add(shot)
    }

    @MainActor func testRelatedCancelUnknownRecoveryOriginalAndUnlink() throws{
        let app=githubApp(["HP_TEAM_RELATED":"1","HP_TEAM_RELATED_UNKNOWN":"1"]),target="trq_"+String(repeating:"b",count:32)
        let entry=app.buttons["teamRelationsEntry"];githubReveal(app,entry);entry.tap()
        let choose=app.buttons["teamRelatedSelect-"+target];XCTAssertTrue(choose.waitForExistence(timeout:10));githubReveal(app,choose);choose.tap()
        let reason=app.textViews["teamRelatedReason"];githubReveal(app,reason);reason.tap();reason.typeText("Same symptom, separate original")
        let send=app.buttons["teamRelatedSend"];githubReveal(app,send);send.tap();app.alerts.buttons["취소"].tap()
        XCTAssertTrue(relatedTrace(app).contains("\"relationPosts\":0"))
        githubReveal(app,send);send.tap();app.alerts.buttons["저장"].tap()
        XCTAssertTrue(app.staticTexts["teamRelatedMessage"].waitForExistence(timeout:10));app.buttons["teamRelatedRefresh"].tap()
        githubReveal(app,send);XCTAssertEqual(send.label,"같은 내용으로 결과 다시 확인");XCTAssertEqual(reason.value as? String,"Same symptom, separate original")
        send.tap();app.alerts.buttons["저장"].tap();githubReveal(app,app.staticTexts["teamRelatedReceipt"])
        XCTAssertTrue(relatedTrace(app).contains("\"relationEvents\":1"))
        let original=app.buttons["teamRelatedOriginal-"+target];githubReveal(app,original);original.tap()
        XCTAssertTrue(app.staticTexts["Related original request"].waitForExistence(timeout:10));app.navigationBars["요청과 논의"].buttons.element(boundBy:0).tap()
        XCTAssertTrue(app.navigationBars["관련 요청"].waitForExistence(timeout:10))
        let next=app.buttons["teamRelatedNewChoice"];githubReveal(app,next);next.tap()
        _ = relatedTrace(app);let action=app.staticTexts["teamRelatedAction"];githubReveal(app,action);XCTAssertEqual(action.label,"관련 요청 연결 해제")
        githubReveal(app,reason);reason.tap();reason.typeText("No longer related")
        githubReveal(app,send);send.tap();app.alerts.buttons["저장"].tap()
        githubReveal(app,app.staticTexts["teamRelatedReceipt"]);let trace=relatedTrace(app);XCTAssertTrue(trace.contains("\"relationEvents\":2"));XCTAssertTrue(trace.contains("\"relationPosts\":3"));XCTAssertTrue(app.staticTexts["teamRelatedEmpty"].exists)
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="Related withdrawal retains history";shot.lifetime = .keepAlways;add(shot)
    }
    @MainActor func testRelatedStorageFailureBlocksOriginalNavigationAndPreservesExport() throws{
        let app=githubApp(["HP_TEAM_RELATED":"1","HP_TEAM_RELATED_SEEDED":"1","HP_TEAM_DRAFT_SAVE_FAILURE":"related"]),target="trq_"+String(repeating:"b",count:32)
        let entry=app.buttons["teamRelationsEntry"];githubReveal(app,entry);entry.tap()
        let choose=app.buttons["teamRelatedSelect-"+target];XCTAssertTrue(choose.waitForExistence(timeout:10));githubReveal(app,choose);choose.tap()
        let reason=app.textViews["teamRelatedReason"];githubReveal(app,reason);reason.tap();reason.typeText("X")
        XCTAssertEqual(reason.value as? String,"X");XCTAssertFalse(app.buttons["teamRelatedSend"].isEnabled)
        let selected=app.buttons["teamRelatedSelectedOriginal"];githubReveal(app,selected);XCTAssertFalse(selected.isEnabled)
        githubReveal(app,app.buttons["연결 초안 내보내기"]);XCTAssertTrue(app.buttons["연결 초안 내보내기"].isEnabled)
        XCTAssertTrue(relatedTrace(app).contains("\"relationPosts\":0"));XCTAssertFalse(app.buttons["teamRelatedOriginal-"+target].isEnabled)
    }
    @MainActor func testRelatedReadOnlyHistoryPreservesCommentDraft() throws{
        let app=githubApp(["HP_TEAM_RELATED":"1","HP_TEAM_RELATED_READONLY":"1"])
        let comment=app.textViews["teamCommentBody"];githubReveal(app,comment);comment.tap();comment.typeText("Keep my comment draft")
        let entry=app.buttons["teamRelationsEntry"]
        listReveal(app, entry, toward: .towardStart);entry.tap()
        XCTAssertTrue(app.staticTexts["teamRelatedReadOnly"].waitForExistence(timeout:10));XCTAssertFalse(app.buttons["teamRelatedSend"].exists)
        let inspect=app.buttons["연결 이력 보기"];githubReveal(app,inspect);inspect.tap();githubReveal(app,app.staticTexts["Existing related reason"])
        XCTAssertTrue(relatedTrace(app).contains("\"relationPosts\":0"))
        app.navigationBars["관련 요청"].buttons.element(boundBy:0).tap();XCTAssertTrue(app.navigationBars["요청과 논의"].waitForExistence(timeout:10))
        let keyboardTip=app.staticTexts.matching(NSPredicate(format:"label BEGINSWITH %@","Speed up your typing")).firstMatch
        if keyboardTip.exists {let proceed=app.buttons["Continue"];XCTAssertTrue(proceed.isHittable);proceed.tap()}
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout:5),"Returning from related history must not restore an offscreen keyboard.")
        githubReveal(app,comment);XCTAssertEqual(comment.value as? String,"Keep my comment draft")
        let restored=XCTAttachment(screenshot:app.screenshot());restored.name="Readonly history preserves comment draft";restored.lifetime = .keepAlways;add(restored)
    }
    @MainActor func testGitHubObservationsPreserveDraftAndSeparateStaleFailure() throws {
        let app = githubApp(["HP_TEAM_GITHUB_OBSERVATIONS":"1"])
        let issue = app.textFields["teamGitHubIssue"]
        XCTAssertTrue(issue.waitForExistence(timeout:10)); githubReveal(app,issue); issue.tap(); issue.typeText("77")
        XCTAssertEqual(issue.value as? String,"77")
        _ = githubTrace(app)
        let open = app.buttons["teamGitHubObservationsOpen"]
        listReveal(app, open, toward: .towardStart); open.tap()
        let freshness = app.staticTexts["teamObservationFreshness"]
        XCTAssertTrue(freshness.waitForExistence(timeout:10)); XCTAssertEqual(freshness.label,"확인한 시점에는 아래 상태였어요.")
        let hierarchy = XCTAttachment(string:app.debugDescription); hierarchy.name="GitHub current observation hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        XCTAssertTrue(app.staticTexts["teamObservationSourceMismatch"].exists)
        app.buttons["teamObservationRefresh"].tap()
        XCTAssertTrue(app.staticTexts["teamObservationProviderError"].waitForExistence(timeout:10))
        XCTAssertEqual(freshness.label,"현재 상태는 다시 확인이 필요해요.")
        let stale = XCTAttachment(screenshot:app.screenshot()); stale.name="GitHub old record and failed provider check"; stale.lifetime = .keepAlways; add(stale)
        app.buttons["teamObservationRefresh"].tap()
        XCTAssertTrue(app.staticTexts["teamObservationUnavailable"].waitForExistence(timeout:10))
        XCTAssertFalse(app.staticTexts["teamObservationFreshness"].exists); XCTAssertFalse(app.staticTexts["teamObservationEmpty"].exists)
        app.navigationBars["GitHub 상태 기록"].buttons.element(boundBy:0).tap()
        XCTAssertTrue(app.navigationBars["GitHub 연결 근거"].waitForExistence(timeout:10))
        githubReveal(app,issue); XCTAssertEqual(issue.value as? String,"77")
        XCTAssertTrue(githubTrace(app).contains("\"githubPosts\":0"))
    }
    @MainActor func testInternalGitHubCancelSaveAndHistory() throws {
        let app = githubApp(composeEntry: true), issue = app.textFields["teamGitHubIssue"], reason = app.textViews["teamGitHubReason"]
        XCTAssertTrue(issue.waitForExistence(timeout: 10)); issue.tap(); issue.typeText("123")
        githubReveal(app,reason); reason.tap(); reason.typeText("Verified issue rationale")
        let send = app.buttons["teamGitHubSend"]; githubReveal(app,send); send.tap(); app.alerts.buttons["취소"].tap()
        XCTAssertEqual(reason.value as? String,"Verified issue rationale")
        XCTAssertTrue(githubTrace(app).contains("\"githubPosts\":0"))
        githubReveal(app,send); send.tap(); app.alerts.buttons["저장"].tap()
        githubReveal(app, app.staticTexts["teamGitHubReceipt"]); app.buttons["새로고침"].tap()
        let savedTrace = githubTrace(app)
        XCTAssertTrue(savedTrace.contains("\"githubEvents\":1"))
        XCTAssertTrue(savedTrace.contains("\"githubPosts\":1"))
        let history = app.staticTexts["teamGitHubHistoryEntry1"]
        githubReveal(app,history)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "github-association-verified-metadata-not-delivery"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testInternalGitHubReadOnlyAndUnsavedExitGuard() throws {
        let readOnly = githubApp(["HP_TEAM_GITHUB_READONLY":"1"])
        XCTAssertTrue(readOnly.staticTexts["teamGitHubReadOnly"].waitForExistence(timeout: 10)); XCTAssertFalse(readOnly.buttons["teamGitHubSend"].exists); readOnly.terminate()
        let app = githubApp(["HP_TEAM_DRAFT_SAVE_FAILURE":"github"]), reason = app.textViews["teamGitHubReason"]
        XCTAssertTrue(reason.waitForExistence(timeout: 10)); githubReveal(app,reason); reason.tap(); reason.typeText("X")
        XCTAssertEqual(reason.value as? String,"X"); githubReveal(app,app.buttons["연결 초안 내보내기"])
        XCTAssertTrue(app.buttons["연결 초안 내보내기"].isEnabled); XCTAssertFalse(app.buttons["teamGitHubSend"].isEnabled)
        app.buttons["teamGitHubBack"].tap(); XCTAssertTrue(app.alerts["저장되지 않은 연결 초안이 있어요"].waitForExistence(timeout: 5)); app.alerts.buttons["계속 작성"].tap()
        XCTAssertEqual(reason.value as? String,"X")
    }

    @MainActor func testInternalGitHubUnknownReopenKeepsOneAssociation() throws {
        let app = githubApp(["HP_TEAM_GITHUB_UNKNOWN":"1"])
        let issue = app.textFields["teamGitHubIssue"], reason = app.textViews["teamGitHubReason"]
        XCTAssertTrue(issue.waitForExistence(timeout: 10)); issue.tap(); issue.typeText("123")
        githubReveal(app,reason); reason.tap(); reason.typeText("Unknown association")
        let send = app.buttons["teamGitHubSend"]; githubReveal(app,send); send.tap(); app.alerts.buttons["저장"].tap()
        let retry = app.buttons["같은 번호로 다시 확인·저장"]; githubReveal(app,retry)
        XCTAssertFalse(app.staticTexts["teamGitHubReceipt"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        githubReveal(app,app.buttons["teamGitHubEntry"]); app.buttons["teamGitHubEntry"].tap()
        XCTAssertTrue(app.staticTexts["teamGitHubTrace"].waitForExistence(timeout: 10))
        XCTAssertTrue((app.staticTexts["teamGitHubTrace"].value as? String ?? "").contains("\"githubPosts\":1"))
        githubReveal(app,retry); retry.tap(); app.alerts.buttons["저장"].tap()
        githubReveal(app,app.staticTexts["teamGitHubReceipt"])
        let trace = githubTrace(app)
        XCTAssertTrue(trace.contains("\"githubPosts\":2")); XCTAssertTrue(trace.contains("\"githubEvents\":1"))
    }

    @MainActor func testInternalDeliveryShowsExactBuildAndUnobservedPersonalStatus() throws {
        let app = githubApp(delivery: true)
        let build = app.staticTexts["teamDeliveryBuild1"]
        XCTAssertTrue(build.waitForExistence(timeout: 10)); XCTAssertEqual(build.label, "버전 0.2.0 · 빌드 18.1")
        XCTAssertEqual(app.staticTexts["teamDeliveryAvailability1"].label, "내부 테스트 그룹에 빌드가 제공된 것을 확인했어요.")
        let personal = app.staticTexts["teamDeliveryUnobserved1"]; githubReveal(app,personal)
        XCTAssertTrue(personal.label.contains("아직 확인되지 않았어요"))
        let instructions = app.staticTexts["teamDeliveryInstructions1"]; githubReveal(app,instructions)
        XCTAssertTrue(instructions.label.contains("TestFlight"))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "delivery-group-evidence-not-installation"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testInternalDeliveryStaleAndUnavailableNeverClaimCurrentAvailability() throws {
        let stale = githubApp(["HP_TEAM_DELIVERY_STALE":"1"], delivery: true)
        XCTAssertTrue(stale.staticTexts["teamDeliveryBuild1"].waitForExistence(timeout: 10))
        XCTAssertEqual(stale.staticTexts["teamDeliveryAvailability1"].label, "현재 그룹의 설치 가능 여부는 확인되지 않았어요.")
        XCTAssertTrue(stale.staticTexts["teamDeliveryFreshness1"].label.contains("다시 확인이 필요해요")); stale.terminate()
        let unavailable = githubApp(["HP_TEAM_DELIVERY_UNAVAILABLE":"1"], delivery: true)
        XCTAssertTrue(unavailable.staticTexts["teamDeliveryUnavailable"].waitForExistence(timeout: 10))
        XCTAssertFalse(unavailable.staticTexts["teamDeliveryBuild1"].exists)
        XCTAssertFalse(unavailable.staticTexts["teamDeliveryEmpty"].exists)
    }

    @MainActor private func outcomeTrace(_ app: XCUIApplication) -> String {
        let trace = app.staticTexts["teamOutcomeTrace"]
        // Diagnostic counters are read, not touch targets.
        readReveal(app, trace); return trace.value as? String ?? ""
    }
    @MainActor func testInternalOutcomeCancelResolveRefreshAndReopen() throws {
        let app = githubApp(outcome: true), resolve = app.buttons["teamOutcomeResolved"]
        XCTAssertTrue(resolve.waitForExistence(timeout: 10)); githubReveal(app,resolve); resolve.tap()
        XCTAssertTrue(app.staticTexts["teamOutcomeBuild"].label.contains("18.1"))
        let send = app.buttons["teamOutcomeSend"]; githubReveal(app,send); send.tap(); app.alerts.buttons["취소"].tap()
        XCTAssertTrue(outcomeTrace(app).contains("\"outcomePosts\":0"))
        githubReveal(app,send); send.tap(); app.alerts.buttons["보내기"].tap()
        let receipt = app.staticTexts["teamOutcomeReceipt"]; githubReveal(app,receipt); XCTAssertTrue(receipt.label.contains("18.1"))
        githubReveal(app, app.buttons["다른 결과 작성"]); XCTAssertTrue(app.buttons["다른 결과 작성"].isEnabled)
        app.buttons["다른 결과 작성"].tap()
        _ = outcomeTrace(app)
        let reopened = app.buttons["teamOutcomeReopened"]
        listReveal(app, reopened, toward: .towardStart); reopened.tap()
        githubReveal(app,send); XCTAssertFalse(send.isEnabled)
        let reason = app.textViews["teamOutcomeResult"]; githubReveal(app,reason); reason.tap(); reason.typeText("Still happens after updating")
        githubReveal(app,send); send.tap(); app.alerts.buttons["보내기"].tap()
        githubReveal(app,receipt); XCTAssertTrue(outcomeTrace(app).contains("\"outcomeEvents\":2"))
        XCTAssertTrue(app.staticTexts["teamOutcomeHistory2"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "reporter-outcome-exact-build-not-installed-proof"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testInternalOutcomeUnknownReopenDoesNotResendAndExplicitRecoveryDeduplicates() throws {
        let app = githubApp(["HP_TEAM_OUTCOME_UNKNOWN":"1"], outcome: true)
        let resolve = app.buttons["teamOutcomeResolved"]; XCTAssertTrue(resolve.waitForExistence(timeout: 10)); githubReveal(app,resolve); resolve.tap()
        let send = app.buttons["teamOutcomeSend"]; githubReveal(app,send); send.tap(); app.alerts.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["teamOutcomeMessage"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        githubReveal(app,app.buttons["teamOutcomeEntry"]); app.buttons["teamOutcomeEntry"].tap()
        githubReveal(app, app.buttons["teamOutcomeSend"])
        XCTAssertTrue(outcomeTrace(app).contains("\"outcomePosts\":1"))
        githubReveal(app,send); XCTAssertEqual(send.label,"같은 내용으로 결과 다시 확인"); send.tap(); app.alerts.buttons["보내기"].tap()
        githubReveal(app,app.staticTexts["teamOutcomeReceipt"])
        let trace = outcomeTrace(app); XCTAssertTrue(trace.contains("\"outcomePosts\":2")); XCTAssertTrue(trace.contains("\"outcomeEvents\":1"))
    }
    @MainActor func testInternalOutcomeReadOnlyAndStorageFailurePreserveExport() throws {
        let readOnly = githubApp(["HP_TEAM_OUTCOME_READONLY":"1"], outcome: true)
        XCTAssertTrue(readOnly.staticTexts["teamOutcomeReadOnly"].waitForExistence(timeout: 10)); XCTAssertFalse(readOnly.buttons["teamOutcomeSend"].exists); readOnly.terminate()
        let app = githubApp(["HP_TEAM_DRAFT_SAVE_FAILURE":"outcome"], outcome: true)
        let reopened = app.buttons["teamOutcomeReopened"]; XCTAssertTrue(reopened.waitForExistence(timeout: 10)); githubReveal(app,reopened); reopened.tap()
        let reason = app.textViews["teamOutcomeResult"]; githubReveal(app,reason); reason.tap(); reason.typeText("X")
        XCTAssertEqual(reason.value as? String,"X"); githubReveal(app,app.buttons["결과 초안 내보내기"])
        XCTAssertTrue(app.buttons["결과 초안 내보내기"].isEnabled); XCTAssertFalse(app.buttons["teamOutcomeSend"].isEnabled)
    }

    @MainActor func testExplicitQuestionRecoveryAndSelectedCommentReply() throws {
        let app = githubApp(["HP_TEAM_DISCUSSION":"1"])
        let question = app.buttons["teamCommentChooseQuestion"]; githubReveal(app, question); question.tap()
        let body = app.textViews["teamCommentBody"]; githubReveal(app, body); body.tap(); body.typeText("Can you confirm this build?")
        let send = app.buttons["teamCommentSend"]; githubReveal(app, send); send.tap(); app.alerts.buttons["보내기"].tap()
        let status = app.staticTexts["teamCommentStatus"]
        readReveal(app, status)
        let uncertain = XCTNSPredicateExpectation(predicate: NSPredicate(format:"label CONTAINS %@", "접수 여부"), object:status)
        XCTAssertEqual(XCTWaiter.wait(for:[uncertain],timeout:10),.completed)
        XCTAssertFalse(question.exists); githubReveal(app,send); XCTAssertEqual(send.label,"같은 번호로 다시 보내기")
        send.tap(); app.alerts.buttons["보내기"].tap()
        let next = app.buttons["새 댓글"]; githubReveal(app,next); next.tap()
        app.navigationBars["요청과 논의"].buttons["새로고침"].tap()
        let target = app.buttons["teamReplyTo-tcm_" + String(repeating:"b",count:32)]
        listReveal(app, target, toward: .towardStart); target.tap()
        githubReveal(app,app.staticTexts["teamCommentReplyTarget"])
        XCTAssertTrue(app.staticTexts["teamCommentReplyTarget"].label.contains("Can you confirm this build?"))
        githubReveal(app,body); body.tap(); body.typeText("I checked build 18.1.")
        githubReveal(app,send); send.tap(); app.alerts.buttons["보내기"].tap()
        let chooseAgain = app.buttons["teamCommentNewTarget"]; githubReveal(app,chooseAgain); chooseAgain.tap()
        githubReveal(app,send); XCTAssertFalse(send.isEnabled)
        XCTAssertEqual(body.value as? String,"I checked build 18.1.")
        let rootReply = app.buttons["teamReplyToRequest"]
        // listReveal attaches the screen and hierarchy if the root reply stays hidden.
        listReveal(app, rootReply, toward: .towardStart); rootReply.tap()
        detailReveal(app,send); XCTAssertTrue(send.isEnabled); send.tap(); app.alerts.buttons["보내기"].tap(); githubReveal(app,next)
        app.navigationBars["요청과 논의"].buttons["새로고침"].tap()
        let reply = app.staticTexts["teamCommentIntent-tcm_" + String(repeating:"c",count:32)]
        readReveal(app, reply)
        XCTAssertEqual(reply.label,"답글")
        let shot = XCTAttachment(screenshot:app.screenshot()); shot.name="explicit-question-and-selected-reply"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor private func closeInboxDetail(_ app: XCUIApplication) {
        let detailBar = app.navigationBars["요청과 논의"]
        XCTAssertTrue(detailBar.waitForExistence(timeout: 10))
        detailBar.buttons.element(boundBy: 0).tap()
        let inboxBar = app.navigationBars["팀 알림함"]
        XCTAssertTrue(inboxBar.waitForExistence(timeout: 10)); inboxBar.buttons["닫기"].tap()
    }
    @MainActor private func inboxApp(_ permission: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = studioApp(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launchEnvironment["HP_TEAM_ENTRY"] = "1"; app.launchEnvironment["HP_TEAM_INBOX"] = "1"; app.launchEnvironment["HP_TEAM_PUSH"] = permission
        if permission == "warm" { app.launchEnvironment["HP_TEAM_PUSH_CONTEXT"] = "1" }
        app.launch(); XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        XCTAssertTrue(app.buttons["teamInboxHomeEntry"].waitForExistence(timeout: 10)); return app
    }
    @MainActor private func enableInboxPush(_ app: XCUIApplication) {
        app.buttons["conversationSettings"].tap(); let entry = app.buttons["openAccountPush"]
        XCTAssertTrue(app.navigationBars["대화 설정"].waitForExistence(timeout: 10)); githubReveal(app, entry); entry.tap()
        let enable = app.buttons["enableAccountPush"]; XCTAssertTrue(enable.waitForExistence(timeout: 10)); enable.tap()
    }
    @MainActor func testTeamInboxExplicitOptInWorksWithDeniedSystemPermissionAndPreservesDraft() throws {
        let app = inboxApp("denied")
        let draft = app.textFields["sharedInput"]; draft.tap(); draft.typeText("Keep my inbox draft")
        enableInboxPush(app)
        let denied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", "허용하지"), object: app.staticTexts["pushStatus"])
        XCTAssertEqual(XCTWaiter.wait(for: [denied], timeout: 10), .completed)
        app.buttons["닫기"].tap(); app.buttons["teamInboxHomeEntry"].tap()
        let subscribe = app.buttons["teamSubscribe"]; XCTAssertTrue(subscribe.waitForExistence(timeout: 10)); githubReveal(app, subscribe); subscribe.tap(); app.alerts.buttons["저장"].tap()
        let state = app.staticTexts["teamSubscriptionState"]
        let optedIn = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "알림 받는 중"), object: state)
        XCTAssertEqual(XCTWaiter.wait(for: [optedIn], timeout: 10), .completed)
        app.buttons["새로고침"].tap(); let item = app.buttons["teamInboxItem12"]; githubReveal(app, item); item.tap()
        XCTAssertTrue(app.staticTexts["알림에서 확인한 요청이에요."].waitForExistence(timeout: 10))
        githubReveal(app, app.buttons["teamRequestSubscription"]); XCTAssertTrue(app.buttons["teamRequestSubscription"].isHittable)
        closeInboxDetail(app)
        XCTAssertEqual(draft.value as? String, "Keep my inbox draft")
    }
    @MainActor func testTeamPushWarmAndColdOpenUseAuthorizedRequestAndPreserveDraft() throws {
        let app = inboxApp("warm"); enableInboxPush(app)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", "이 계정의 알림을 켰어요."), object: app.staticTexts["pushStatus"])
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed); app.buttons["닫기"].tap()
        let draft = app.textFields["sharedInput"]; draft.tap(); draft.typeText("Keep my push draft")
        app.buttons["teamPushFixtureOpen"].tap()
        XCTAssertTrue(app.staticTexts["알림에서 확인한 요청이에요."].waitForExistence(timeout: 10))
        closeInboxDetail(app); XCTAssertEqual(draft.value as? String, "Keep my push draft")
        app.buttons["conversationSettings"].tap(); app.buttons["내 상황과 의도"].tap()
        let context = app.textFields["context-goal"]
        XCTAssertTrue(context.waitForExistence(timeout: 10)); context.tap(); context.typeText("Keep my context")
        XCTAssertFalse(app.staticTexts["알림에서 확인한 요청이에요."].exists, "Notification must wait for the occupied context sheet.")
        app.buttons["닫기"].tap()
        XCTAssertTrue(app.staticTexts["알림에서 확인한 요청이에요."].waitForExistence(timeout: 10))
        closeInboxDetail(app)
        app.buttons["conversationSettings"].tap(); app.buttons["내 상황과 의도"].tap()
        XCTAssertTrue(context.waitForExistence(timeout: 10)); XCTAssertEqual(context.value as? String, "Keep my context")
        app.buttons["닫기"].tap()
        app.terminate(); app.launchEnvironment["HP_TEAM_PUSH"] = "cold"; app.launch()
        XCTAssertTrue(app.staticTexts["알림에서 확인한 요청이에요."].waitForExistence(timeout: 15))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "team-push-authorized-detail-synthetic"; shot.lifetime = .keepAlways; add(shot)
        closeInboxDetail(app); XCTAssertEqual(draft.value as? String, "Keep my push draft")
    }

    // #4432: destination models are built lazily, so their arguments must be the values the detail
    // screen set before navigating, not the @State defaults ("studio"). A Lab request makes a stale read visible.
    @MainActor private func labRequestDetail(_ flags: [String:String]) -> XCUIApplication {
        continueAfterFailure = false
        let app = studioApp(); app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = "member-inbox"; app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString; app.launchEnvironment["HP_TEAM_ENTRY"] = "1"
        for (key,value) in flags { app.launchEnvironment[key] = value }; app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10)); app.buttons["linkDesktop"].tap()
        XCTAssertTrue(app.buttons["teamRequestHomeEntry"].waitForExistence(timeout: 10)); app.buttons["teamRequestHomeEntry"].tap()
        let body = app.textViews["teamRequestBody"]; XCTAssertTrue(body.waitForExistence(timeout: 10)); body.tap(); body.typeText("Lab fixture request")
        // The menu Picker is exposed as one Button labelled "<title>, <selection>" (run 44922434581 hierarchy).
        let product = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "제품, ")).firstMatch
        XCTAssertTrue(product.waitForExistence(timeout: 10)); githubReveal(app, product); product.tap()
        XCTAssertTrue(app.buttons["Lab"].waitForExistence(timeout: 5)); app.buttons["Lab"].tap()
        XCTAssertEqual(product.label, "제품, Lab", "The request must be created for Lab, not the Studio default.")
        githubReveal(app, app.buttons["teamRequestSend"]); app.buttons["teamRequestSend"].tap(); app.alerts.buttons["보내기"].tap()
        XCTAssertTrue(app.staticTexts["teamRequestReceipt"].waitForExistence(timeout: 10))
        app.buttons["teamRequestClose"].tap(); app.buttons["teamRequestHomeEntry"].tap()
        githubReveal(app, app.buttons["요청과 논의 보기"]); app.buttons["요청과 논의 보기"].tap()
        return app
    }
    private func renderKeys(_ trace: String) throws -> [String:Any] {
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(trace.utf8)) as? [String:Any])
        return try XCTUnwrap(object["render"] as? [String:Any], "The DEBUG trace must carry render counters.")
    }

    @MainActor func testNonStudioRequestPassesItsProductToIntakeAndRelatedScreens() throws {
        let intake = labRequestDetail(["HP_TEAM_INTAKE":"normal","HP_TEAM_TEXT":"1","HP_TEAM_RELATED":"1"])
        let intakeEntry = intake.buttons["teamIntakeEntry"]; XCTAssertTrue(intakeEntry.waitForExistence(timeout: 10)); detailReveal(intake, intakeEntry); intakeEntry.tap()
        XCTAssertTrue(intake.buttons["teamIntakeLogin"].waitForExistence(timeout: 10))
        let intakeRender = try XCTUnwrap(intakeTrace(intake)["render"] as? [String:Any])
        XCTAssertNotNil(intakeRender["arg.intake.lab"], "Intake must be built for the request's product.")
        XCTAssertNil(intakeRender["arg.intake.studio"], "Intake must not be built with the Studio default.")
        intake.terminate()
        let related = labRequestDetail(["HP_TEAM_RELATED":"1"])
        let relatedEntry = related.buttons["teamRelationsEntry"]; XCTAssertTrue(relatedEntry.waitForExistence(timeout: 10)); detailReveal(related, relatedEntry); relatedEntry.tap()
        XCTAssertTrue(related.staticTexts["teamRelatedTrace"].waitForExistence(timeout: 10))
        let relatedRender = try renderKeys(relatedTrace(related))
        XCTAssertNotNil(relatedRender["arg.relations.lab"], "Related requests must be built for the request's product.")
        XCTAssertNil(relatedRender["arg.relations.studio"], "Related requests must not be built with the Studio default.")
    }

}
