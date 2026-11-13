import XCTest
final class StudioShellTests: XCTestCase {
    @MainActor func testFirstInstallExplainsAccountStorageWithoutASeparateForm() {
        let app = XCUIApplication(); app.launchArguments = ["--verify-account-storage"]; app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["accountStorageVerified"].exists, "The app must create, read, update and delete an isolated Keychain item before account readiness passes.")
        XCTAssertFalse(app.staticTexts["sharedError"].exists, "A storage failure must not pass as a ready sign-in screen.")
        XCTAssertTrue(app.buttons["linkDesktop"].isEnabled)
        XCTAssertTrue(app.staticTexts["요즘 어떤 일에\n시간을 많이 쓰세요?"].exists)
        XCTAssertFalse(app.textFields["나이"].exists)
        // Account/AI storage disclosure is inline. This storage probe must not
        // start real authentication; the journeys below exercise that boundary
        // through the same production login continuation with fixture transport.
        XCTAssertFalse(app.buttons["같은 계정으로 연결"].exists)
        XCTAssertEqual(app.webViews.count, 0)
    }
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
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10))
        app.tabBars.buttons["기기 기록"].tap()
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
        app.terminate(); app.launch(); app.tabBars.buttons["기기 기록"].tap()
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        openReflection(in: app)
        let restored = editable("reflection-observation", in: app)
        XCTAssertEqual(restored.value as? String, "Two customers waited outside")
        app.buttons["닫기"].tap()
        // This disconnected tab records locally; it must not imply an AI reply.
        XCTAssertEqual(app.buttons["sendThought"].label, "생각 기록하기")
        XCTAssertTrue(app.staticTexts["여기는 이 기기의 보관함이에요. 답변을 받으려면 질문 탭에서 계정으로 시작해 주세요."].exists)
        let draft = editable("thoughtInput", in: app)
        draft.tap(); draft.typeText("Keep this unfinished thought")
        app.buttons["voiceConversation"].tap()
        // The missing AI grant still requires its real disclosure. There is no
        // extra voice-consent screen, and declining the grant must not record,
        // transmit or replace the existing draft.
        XCTAssertTrue(app.navigationBars["무료 AI 연결"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["startVoiceConsent"].exists)
        XCTAssertFalse(app.buttons["cancelVoiceConsent"].exists)
        XCTAssertFalse(app.buttons["동의하고 연결"].isEnabled)
        XCTAssertFalse(app.buttons["stopVoice"].exists)
        app.buttons["닫기"].tap()
        XCTAssertEqual(editable("thoughtInput", in: app).value as? String, "Keep this unfinished thought")
        XCTAssertTrue(app.buttons["dictateVoice"].exists)
        XCTAssertFalse(app.buttons["stopVoice"].exists)
        app.terminate(); app.launch(); app.tabBars.buttons["기기 기록"].tap()
        XCTAssertEqual(editable("thoughtInput", in: app).value as? String, "Keep this unfinished thought")
        XCTAssertEqual(app.buttons["sendThought"].label, "생각 기록하기")
        XCTAssertFalse(app.buttons["stopVoice"].exists)
        XCTAssertEqual(app.webViews.count, 0)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "native-iphone-intent"; shot.lifetime = .keepAlways; add(shot)
    }
}

/// Required user journeys. The external Service/browser/speech transports are
/// synthetic; account adoption, persistence, view actions and VoiceTurn are real.
/// These cases are never physical authentication or microphone evidence.
final class StudioJourneyTests: XCTestCase {
    @MainActor private func launch(_ scenario: String) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = scenario
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = UUID().uuidString
        app.launch()
        return app
    }
    @MainActor private func field(_ app: XCUIApplication) -> XCUIElement {
        let field = app.textFields["sharedInput"]
        if field.waitForExistence(timeout: 2) { return field }
        let text = app.textViews["sharedInput"]
        XCTAssertTrue(text.waitForExistence(timeout: 5), "The personal conversation must be usable without a desktop.")
        return text
    }
    @MainActor private func enabled(_ element: XCUIElement, timeout: TimeInterval = 10) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout))
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed)
    }
    @MainActor private func valueContains(_ element: XCUIElement, _ text: String) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value CONTAINS %@", text), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
    }
    @MainActor private func signIn(_ app: XCUIApplication) {
        let start = app.buttons["linkDesktop"]; enabled(start); start.tap()
        _ = field(app)
        XCTAssertTrue(app.staticTexts["reflectionOpening"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["accountCancel"].exists, "Successful account adoption must finish the login state.")
    }
    @MainActor private func trace(_ app: XCUIApplication) throws -> [String: Any] {
        let element = app.staticTexts["nativeJourneyTrace"]
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        let data = try XCTUnwrap(element.label.data(using: .utf8))
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(result["physical_device"] as? String, "NOT_RUN")
        XCTAssertEqual(result["live_asr"] as? String, "NOT_RUN")
        XCTAssertEqual(result["desktop_requests"] as? Int, 0, "Personal questions must not dispatch desktop work.")
        return result
    }
    @MainActor private func answer(_ app: XCUIApplication) {
        let appeared = app.staticTexts["sharedReply"].firstMatch.waitForExistence(timeout: 10)
        if !appeared {
            // Preserve the first failed observation before XCTest stops the case.
            // No second tap, longer answer timeout or alternate success oracle.
            let traceElement = app.staticTexts["nativeJourneyTrace"]
            let observation = traceElement.exists ? traceElement.label : "native journey trace absent"
            print("HP_NATIVE_JOURNEY_ANSWER_MISSING " + observation)
            let trace = XCTAttachment(string: observation); trace.name = "answer-missing-synthetic-trace"; trace.lifetime = .keepAlways; add(trace)
            let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = "answer-missing-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "answer-missing-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
        }
        XCTAssertTrue(appeared, "A send action needs a visible answer or an actionable failure, not just a cleared composer.")
        XCTAssertEqual(app.staticTexts["sharedReply"].firstMatch.label, "What small change would make tomorrow better?")
    }
    @MainActor private func evidence(_ name: String, app: XCUIApplication) throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let observation = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: trace(app), options: [.sortedKeys]), encoding: .utf8)!)
        observation.name = name + "-synthetic-trace"; observation.lifetime = .keepAlways; add(observation)
    }
    @MainActor func testFirstInstallSignInToFirstAnswerWithoutDesktop() throws {
        let app = launch("first-answer"); signIn(app)
        let input = field(app); input.tap(); input.typeText("I want to make time for learning")
        let send = app.buttons["sharedSend"]; enabled(send); send.tap(); answer(app)
        let result = try trace(app)
        let paths = try XCTUnwrap(result["paths"] as? [String])
        for route in ["POST /v1/auth/native/start", "POST /v1/auth/native/exchange", "GET /v1/me", "POST /v1/me/reflection/turns"] { XCTAssertTrue(paths.contains(route), route) }
        XCTAssertFalse(paths.contains(where: { $0.contains("/auth/device/") }), "The same phone must not poll a pairing-code flow.")
        XCTAssertEqual(result["browser_callbacks"] as? Int, 1)
        XCTAssertEqual(result["accepted_turns"] as? Int, 1)
        XCTAssertEqual(result["submitted_texts"] as? [String], ["I want to make time for learning"])
        try evidence("journey-first-answer", app: app)
    }
    @MainActor func testDictationEditsDraftThenSendGetsReplyWithoutDesktop() throws {
        let app = launch("first-answer"); signIn(app)
        let input = field(app); input.tap(); input.typeText("My existing thought")
        app.buttons["sharedDictate"].tap()
        valueContains(field(app), "I want to understand my next step")
        enabled(app.buttons["sharedSend"])
        XCTAssertTrue((field(app).value as? String)?.contains("My existing thought") == true)
        XCTAssertFalse(app.staticTexts["sharedReply"].exists, "Dictation may edit a draft, never silently send it.")
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        app.buttons["sharedSend"].tap(); answer(app)
        XCTAssertEqual(try trace(app)["submitted_texts"] as? [String], ["My existing thought\nI want to understand my next step"])
        try evidence("journey-dictation-send", app: app)
    }
    @MainActor func testHandsFreeReplyStartsNextTurnAndStopPreventsSecondSend() throws {
        let app = launch("voice-answer"); signIn(app)
        enabled(app.buttons["sharedVoice"]); app.buttons["sharedVoice"].tap()
        // No recurring consent sheet or manual end-of-speech button is pressed.
        XCTAssertFalse(app.buttons["linkedVoiceStart"].exists)
        answer(app)
        valueContains(field(app), "Keep this spoken draft without sending")
        let stop = app.buttons["sharedVoiceStop"]; enabled(stop); stop.tap()
        XCTAssertTrue(stop.waitForNonExistence(timeout: 5))
        let result = try trace(app)
        XCTAssertGreaterThanOrEqual(result["speech_captures"] as? Int ?? 0, 2)
        XCTAssertEqual(result["accepted_turns"] as? Int, 1)
        XCTAssertEqual((result["submitted_ids"] as? [String])?.count, 1)
        XCTAssertTrue((field(app).value as? String)?.contains("Keep this spoken draft without sending") == true)
        try evidence("journey-voice-stop", app: app)
    }
    @MainActor func testVoiceFinishingDuringHistorySyncSendsOnceAndResumesListening() throws {
        let app = launch("queued-voice"); signIn(app)
        app.buttons["연동 설정"].tap(); app.buttons["새로 고침"].tap()
        let syncing = app.descendants(matching: .any).matching(identifier: "sharedSyncing").firstMatch
        XCTAssertTrue(syncing.waitForExistence(timeout: 5))
        let voice = app.buttons["sharedVoice"]; enabled(voice); voice.tap()
        answer(app)
        valueContains(field(app), "Keep this spoken draft without sending")
        let stop = app.buttons["sharedVoiceStop"]; enabled(stop); stop.tap()
        let result = try trace(app)
        XCTAssertGreaterThanOrEqual(result["delayed_history_reads"] as? Int ?? 0, 1)
        XCTAssertGreaterThanOrEqual(result["speech_ended_during_history"] as? Int ?? 0, 1, "The fixture must actually overlap speech completion and history sync; merely delaying a request is insufficient evidence.")
        XCTAssertEqual(result["history_barrier_timeouts"] as? Int, 0, "The history response must be released by actual speech delivery, not a fixture timeout.")
        XCTAssertEqual(result["history_barrier_completions"] as? Int, 1, "The held history request must complete after actual speech delivery.")
        XCTAssertEqual(result["history_barrier_cancellations"] as? Int, 0, "A cancelled history request cannot prove speech and sync overlapped.")
        XCTAssertEqual(result["accepted_turns"] as? Int, 1)
        XCTAssertEqual((result["submitted_ids"] as? [String])?.count, 1)
        XCTAssertEqual(result["submitted_texts"] as? [String], ["I want to understand my next step"])
        XCTAssertGreaterThanOrEqual(result["speech_captures"] as? Int ?? 0, 2, "The queued request must retain its voice-reply continuation.")
        XCTAssertFalse(app.staticTexts["sharedError"].exists)
        try evidence("journey-queued-voice", app: app)
    }
    @MainActor func testBackgroundStopsCaptureAndPreservesUnsentDraftAcrossRelaunch() throws {
        let app = launch("voice-hold"); signIn(app)
        app.buttons["sharedDictate"].tap(); valueContains(field(app), "Keep this spoken draft without sending")
        XCUIDevice.shared.press(.home); app.activate()
        XCTAssertTrue(app.buttons["sharedVoiceStop"].waitForNonExistence(timeout: 5))
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch()
        valueContains(field(app), "Keep this spoken draft without sending")
        XCTAssertFalse(app.buttons["sharedVoiceStop"].exists, "A relaunch must not restart the microphone.")
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        app.buttons["sharedSend"].tap(); answer(app)
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 1)
        try evidence("journey-background-draft", app: app)
    }
    @MainActor func testFailedSendRetainsOutboxAndRetriesSameRequestAfterRelaunch() throws {
        let app = launch("retry-once"); signIn(app)
        let input = field(app); input.tap(); input.typeText("Keep my unfinished question")
        app.buttons["sharedSend"].tap()
        enabled(app.buttons["sharedRetry"])
        XCTAssertFalse(app.staticTexts["sharedReply"].exists)
        let before = try trace(app)
        let firstIDs = try XCTUnwrap(before["submitted_ids"] as? [String]); XCTAssertEqual(firstIDs.count, 1)
        XCTAssertEqual(before["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch(); _ = field(app)
        let retry = app.buttons["sharedRetry"]; enabled(retry); retry.tap(); answer(app)
        let after = try trace(app)
        XCTAssertEqual(after["submitted_ids"] as? [String], [firstIDs[0], firstIDs[0]], "Retry must preserve the durable request ID.")
        XCTAssertEqual(after["submitted_texts"] as? [String], ["Keep my unfinished question", "Keep my unfinished question"])
        XCTAssertEqual(after["accepted_turns"] as? Int, 1)
        try evidence("journey-retry-outbox", app: app)
    }
    @MainActor func testAIAdmissionDenialRemainsVisibleAfterHistoryRefreshAndRelaunch() throws {
        let app = launch("access-denied"); signIn(app)
        let input = field(app); input.tap(); input.typeText("Do not lose the reason this cannot send")
        app.buttons["sharedSend"].tap()
        let error = app.staticTexts["sharedError"]
        XCTAssertTrue(error.waitForExistence(timeout: 10)); enabled(app.buttons["sharedRetry"])
        XCTAssertTrue(error.label.contains("AI 이용 권한"))
        XCTAssertFalse(app.staticTexts["sharedReply"].exists)
        let before = try trace(app)
        let paths = try XCTUnwrap(before["paths"] as? [String])
        let post = try XCTUnwrap(paths.lastIndex(of: "POST /v1/me/reflection/turns"))
        XCTAssertTrue(paths.dropFirst(post + 1).contains("GET /v1/me/reflection"), "A successful history refresh must not erase the failed turn's reason.")
        app.terminate(); app.launch(); _ = field(app)
        XCTAssertTrue(error.waitForExistence(timeout: 10)); XCTAssertTrue(error.label.contains("AI 이용 권한"))
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        XCTAssertEqual((try trace(app)["submitted_ids"] as? [String])?.count, 1, "Relaunch must not auto-retry or invent free access.")
        try evidence("journey-admission-denied", app: app)
    }
    @MainActor func testExpiredSignInLeavesActionableFailureInsteadOfInfiniteChecking() throws {
        let app = launch("sign-in-expired")
        let start = app.buttons["linkDesktop"]; enabled(start); start.tap()
        XCTAssertTrue(app.staticTexts["sharedError"].waitForExistence(timeout: 10))
        enabled(start); XCTAssertFalse(app.buttons["accountCancel"].exists)
        XCTAssertFalse(app.textFields["sharedInput"].exists)
        let result = try trace(app)
        XCTAssertEqual(result["accepted_turns"] as? Int, 0)
        XCTAssertFalse((result["paths"] as? [String] ?? []).contains("POST /v1/auth/native/exchange"))
        try evidence("journey-login-failure", app: app)
    }
}
