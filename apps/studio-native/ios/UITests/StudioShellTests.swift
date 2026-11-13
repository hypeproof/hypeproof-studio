import XCTest
final class StudioShellTests: XCTestCase {
    @MainActor func testFirstInstallExplainsAccountStorageWithoutASeparateForm() {
        let app = XCUIApplication(); app.launchArguments = ["--verify-account-storage"]; app.launch()
        XCTAssertTrue(app.buttons["linkDesktop"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["accountStorageVerified"].exists, "The app must create, read, update and delete an isolated Keychain item before account readiness passes.")
        XCTAssertFalse(app.staticTexts["sharedError"].exists, "A storage failure must not pass as a ready sign-in screen.")
        XCTAssertTrue(app.buttons["linkDesktop"].isEnabled)
        XCTAssertTrue(app.staticTexts["firstQuestion"].exists)
        let input = editable("sharedInput", in: app)
        XCTAssertTrue(input.isEnabled && input.isHittable, "First use must allow a thought before account setup.")
        XCTAssertTrue(app.buttons["sharedDictate"].isEnabled)
        XCTAssertEqual(app.tabBars.count, 0, "Local storage must not compete with the conversation as a second product.")
        XCTAssertFalse(app.textFields["나이"].exists)
        // Account/AI storage disclosure is inline. This storage probe must not
        // start real authentication; the journeys below exercise that boundary
        // through the same production login continuation with fixture transport.
        XCTAssertFalse(app.buttons["같은 계정으로 연결"].exists)
        XCTAssertEqual(app.webViews.count, 0)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "first-use-question-and-composer"; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor private func openNotebook(_ app: XCUIApplication) {
        app.buttons["conversationSettings"].tap()
        app.buttons["localNotebook"].tap()
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
        openNotebook(app)
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
        app.terminate(); app.launch(); openNotebook(app)
        XCTAssertTrue(app.staticTexts["Observe one shop today"].waitForExistence(timeout: 5))
        openReflection(in: app)
        let restored = editable("reflection-observation", in: app)
        XCTAssertEqual(restored.value as? String, "Two customers waited outside")
        app.buttons["닫기"].tap()
        // This disconnected tab records locally; it must not imply an AI reply.
        XCTAssertEqual(app.buttons["sendThought"].label, "생각 기록하기")
        XCTAssertTrue(app.staticTexts["이 기록은 이 기기에 보관돼요. 계정 대화는 ‘대화로 돌아가기’에서 이어갈 수 있어요."].exists)
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
        app.terminate(); app.launch(); openNotebook(app)
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
    @MainActor private func launch(_ scenario: String, arguments: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--native-journey"] + arguments
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
    @MainActor private func diagnostic(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(element.frame.width, 2, "Diagnostics must not occupy transcript layout.")
        XCTAssertLessThanOrEqual(element.frame.height, 2)
        return element
    }
    @MainActor private func trace(_ app: XCUIApplication) throws -> [String: Any] {
        let element = diagnostic("nativeJourneyTrace", in: app)
        let value = try XCTUnwrap(element.value as? String)
        let data = try XCTUnwrap(value.data(using: .utf8))
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
            let traceElement = app.descendants(matching: .any).matching(identifier: "nativeJourneyTrace").firstMatch
            let observation = traceElement.exists ? (traceElement.value as? String ?? "native journey trace value absent") : "native journey trace absent"
            print("HP_NATIVE_JOURNEY_ANSWER_MISSING " + observation)
            let trace = XCTAttachment(string: observation); trace.name = "answer-missing-synthetic-trace"; trace.lifetime = .keepAlways; add(trace)
            let hierarchy = XCTAttachment(string: app.debugDescription); hierarchy.name = "answer-missing-hierarchy"; hierarchy.lifetime = .keepAlways; add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "answer-missing-screen"; screenshot.lifetime = .keepAlways; add(screenshot)
        }
        XCTAssertTrue(appeared, "A send action needs a visible answer or an actionable failure, not just a cleared composer.")
        XCTAssertEqual(app.staticTexts["sharedReply"].firstMatch.label, "HP Studio의 답변. What small change would make tomorrow better?")
    }
    @MainActor private func evidence(_ name: String, app: XCUIApplication) throws {
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let observation = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: trace(app), options: [.sortedKeys]), encoding: .utf8)!)
        observation.name = name + "-synthetic-trace"; observation.lifetime = .keepAlways; add(observation)
    }
    @MainActor func testFirstInstallSignInToFirstAnswerWithoutDesktop() throws {
        let app = launch("first-answer")
        let input = field(app); input.tap(); input.typeText("I want to make time for learning")
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        XCTAssertTrue((try trace(app)["paths"] as? [String] ?? []).isEmpty, "Writing before login must stay local.")
        try evidence("journey-first-thought-before-login", app: app)
        signIn(app)
        XCTAssertEqual(field(app).value as? String, "I want to make time for learning")
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0, "Account adoption must not send the preserved draft.")
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
        app.buttons["conversationSettings"].tap(); app.buttons["새로 고침"].tap()
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
        XCTAssertTrue(app.scrollViews["conversationTimeline"].staticTexts["Keep my unfinished question"].exists, "An unacknowledged local request must still show its words.")
        XCTAssertFalse(app.staticTexts["sharedReply"].exists)
        let before = try trace(app)
        let firstIDs = try XCTUnwrap(before["submitted_ids"] as? [String]); XCTAssertEqual(firstIDs.count, 1)
        XCTAssertEqual(before["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch(); _ = field(app)
        let retry = app.buttons["sharedRetry"]; enabled(retry)
        XCTAssertTrue(app.scrollViews["conversationTimeline"].staticTexts["Keep my unfinished question"].exists)
        retry.tap(); answer(app)
        let after = try trace(app)
        XCTAssertEqual(after["submitted_ids"] as? [String], [firstIDs[0], firstIDs[0]], "Retry must preserve the durable request ID.")
        XCTAssertEqual(after["submitted_texts"] as? [String], ["Keep my unfinished question", "Keep my unfinished question"])
        XCTAssertEqual(after["accepted_turns"] as? Int, 1)
        try evidence("journey-retry-outbox", app: app)
    }
    @MainActor func testUnacknowledgedWordsStayVisibleWhenHistoryReusesIDWithDifferentText() throws {
        let app = launch("pending-text-mismatch"); signIn(app)
        let words = "Keep my original pending words"
        field(app).tap(); field(app).typeText(words); app.buttons["sharedSend"].tap()
        enabled(app.buttons["sharedRetry"])
        let timeline = app.scrollViews["conversationTimeline"]
        let otherWords = timeline.staticTexts["내 메시지. Different words from history"]
        XCTAssertTrue(otherWords.waitForExistence(timeout: 5), "The mismatched snapshot must reach the real conversation view.")
        XCTAssertTrue(timeline.staticTexts[words].exists, "A matching ID alone must not hide the retained original words.")
        waitForTranscript(otherWords, in: app); waitForTranscript(timeline.staticTexts[words], in: app)
        let before = try trace(app), ids = try XCTUnwrap(before["submitted_ids"] as? [String])
        XCTAssertEqual(ids.count, 1); XCTAssertEqual(before["submitted_texts"] as? [String], [words])
        XCTAssertEqual(before["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch(); _ = field(app)
        enabled(app.buttons["sharedRetry"])
        XCTAssertTrue(otherWords.waitForExistence(timeout: 5))
        XCTAssertTrue(timeline.staticTexts[words].exists, "Relaunch must retain both the local request and its visible words.")
        waitForTranscript(otherWords, in: app); waitForTranscript(timeline.staticTexts[words], in: app)
        let after = try trace(app)
        XCTAssertEqual(after["submitted_ids"] as? [String], ids, "Refreshing or reopening must not send another request.")
        XCTAssertEqual(after["accepted_turns"] as? Int, 0); XCTAssertEqual(after["speech_captures"] as? Int, 0)
        XCTAssertFalse(app.buttons["restoreFailedReflectionDraft"].exists, "An uncertain local request must not become a terminal failed turn.")
        try evidence("journey-pending-text-mismatch", app: app)
    }
    @MainActor private func historyReply(_ number: Int, account: Int = 1, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "identifier == 'sharedReply' AND label BEGINSWITH %@", "HP Studio의 답변. Account \(account) answer \(number).")).firstMatch
    }
    @MainActor private func transcriptShows(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        guard element.exists else { return false }
        let frame = element.frame, viewport = app.scrollViews["conversationTimeline"].frame
        let intersection = frame.intersection(viewport)
        return frame.height > 0 && !intersection.isNull && intersection.height >= min(32, frame.height)
    }
    @MainActor private func waitForTranscript(_ element: XCUIElement, in app: XCUIApplication) {
        let visible = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in self.transcriptShows(element, in: app) }, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [visible], timeout: 10), .completed, "The saved/latest reply must be inside the real transcript viewport, not merely in the accessibility tree.")
    }
    @MainActor private func signInToHistory(_ app: XCUIApplication, account: Int = 1) {
        let login = app.buttons["linkDesktop"]; enabled(login); login.tap()
        waitForTranscript(historyReply(40, account: account, in: app), in: app)
        XCTAssertFalse(app.buttons["accountCancel"].exists)
    }
    @MainActor private func readOlderHistory(_ app: XCUIApplication) {
        let timeline = app.scrollViews["conversationTimeline"]
        timeline.swipeDown(); timeline.swipeDown()
        let latest = app.buttons["conversationLatest"]; enabled(latest)
        XCTAssertTrue(latest.isHittable)
        XCTAssertGreaterThanOrEqual(latest.frame.height, 44)
    }
    @MainActor private func advanceRemoteHistory(_ app: XCUIApplication, revision: Int) {
        // Advance only the isolated HTTP fixture; the real Refresh must apply it.
        app.buttons["conversationSettings"].tap(); app.buttons["nativeJourneyAdvanceHistory"].tap()
        app.buttons["conversationSettings"].tap(); app.buttons["새로 고침"].tap()
        let applied = diagnostic("nativeJourneyLoadedRevision", in: app)
        let updated = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", String(revision)), object: applied)
        XCTAssertEqual(XCTWaiter.wait(for: [updated], timeout: 10), .completed)
    }
    @MainActor func testLongHistoryRestoresLatestAcrossRelaunchConversationAndAccountSwitch() throws {
        let app = launch("long-history"); signInToHistory(app)
        XCTAssertEqual(try trace(app)["history_window_messages"] as? Int, 80)
        app.terminate(); app.launch()
        waitForTranscript(historyReply(40, in: app), in: app)
        XCTAssertFalse(app.buttons["conversationLatest"].exists)
        // Warm a second 80-message cache, then leave it while reading old text.
        app.buttons["conversationHistory"].tap(); app.buttons["Saved desktop conversation"].tap()
        let peer = app.staticTexts.matching(NSPredicate(format: "identifier == 'sharedReply' AND label BEGINSWITH 'HP Studio의 답변. Desktop message 80.'")).firstMatch
        waitForTranscript(peer, in: app)
        readOlderHistory(app)
        XCTAssertFalse(transcriptShows(peer, in: app))
        app.buttons["conversationHistory"].tap(); app.buttons["나를 알아가는 대화"].tap()
        waitForTranscript(historyReply(40, in: app), in: app)
        XCTAssertFalse(app.buttons["conversationLatest"].exists, "Equal message counts must not retain the other conversation's reading offset.")
        app.buttons["conversationSettings"].tap(); enabled(app.buttons["로그아웃"]); app.buttons["로그아웃"].tap()
        signInToHistory(app, account: 2)
        XCTAssertFalse(historyReply(40, account: 1, in: app).exists)
        let result = try trace(app)
        XCTAssertEqual(result["history_account"] as? Int, 2)
        XCTAssertTrue((result["submitted_ids"] as? [String] ?? []).isEmpty, "Opening, restoring and switching history must not send an AI request.")
        try evidence("journey-history-entry-and-switch", app: app)
    }
    @MainActor func testEightyMessageWindowFollowsNewTailWithoutInterruptingReading() throws {
        let app = launch("long-history", arguments: ["--journey-dark"]); signInToHistory(app)
        advanceRemoteHistory(app, revision: 82)
        waitForTranscript(historyReply(41, in: app), in: app)
        XCTAssertEqual(try trace(app)["history_window_messages"] as? Int, 80, "The rollover changes identities, not message count.")
        readOlderHistory(app)
        let previouslyVisible = app.staticTexts.matching(identifier: "sharedReply").allElementsBoundByIndex.filter { transcriptShows($0, in: app) }.map(\.label)
        XCTAssertFalse(previouslyVisible.isEmpty, "The person must actually be reading an older answer.")
        advanceRemoteHistory(app, revision: 84)
        XCTAssertFalse(transcriptShows(historyReply(42, in: app), in: app), "A background history update must not force a reader to the newest answer.")
        XCTAssertTrue(previouslyVisible.contains { label in
            transcriptShows(app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch, in: app)
        }, "An already-visible passage must remain in the reading viewport.")
        let latest = app.buttons["conversationLatest"]; enabled(latest); latest.tap()
        waitForTranscript(historyReply(42, in: app), in: app)
        XCTAssertFalse(latest.exists)
        // A deliberate new send, unlike a background refresh, follows its reply.
        readOlderHistory(app)
        let input = field(app); input.tap(); input.typeText("My next question from this saved history")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertEqual(input.value as? String, "My next question from this saved history")
        enabled(app.buttons["sharedSend"]); app.buttons["sharedSend"].tap()
        waitForTranscript(historyReply(43, in: app), in: app)
        let result = try trace(app)
        XCTAssertEqual(result["history_window_messages"] as? Int, 80)
        XCTAssertEqual(result["history_advances"] as? Int, 2)
        XCTAssertEqual((result["submitted_ids"] as? [String])?.count, 1)
        XCTAssertEqual(result["submitted_texts"] as? [String], ["My next question from this saved history"])
        try evidence("journey-history-rollover-and-reading", app: app)
    }
    @MainActor private func assertSingleRecordedQuestion(_ words: String, in app: XCUIApplication) {
        let question = app.scrollViews["conversationTimeline"].staticTexts.matching(NSPredicate(format: "label == %@ OR label == %@", words, "내 메시지. " + words))
        XCTAssertTrue(question.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(question.count, 1, "The recorded user bubble and request status must not repeat the question.")
    }
    @MainActor func testRecordedFailureRestoresDraftAcrossRelaunchAndExplicitlySendsNewID() throws {
        let app = launch("recorded-failure"); signIn(app)
        let words = "Keep this recorded failed question"
        field(app).tap(); field(app).typeText(words); app.buttons["sharedSend"].tap()
        enabled(app.buttons["restoreFailedReflectionDraft"])
        assertSingleRecordedQuestion(words, in: app)
        XCTAssertGreaterThanOrEqual(app.buttons["restoreFailedReflectionDraft"].frame.height, 44)
        XCTAssertTrue(app.buttons["restoreFailedReflectionDraft"].isHittable)
        XCTAssertFalse(app.buttons["sharedRetry"].exists, "A recorded terminal failure is not an uncertain transport retry.")
        let before = try trace(app), ids = try XCTUnwrap(before["submitted_ids"] as? [String])
        XCTAssertEqual(ids.count, 1); XCTAssertEqual(before["failed_turns"] as? Int, 1)
        XCTAssertEqual(before["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch(); _ = field(app)
        let restore = app.buttons["restoreFailedReflectionDraft"]; enabled(restore)
        assertSingleRecordedQuestion(words, in: app)
        restore.tap()
        XCTAssertEqual(field(app).value as? String, words)
        XCTAssertEqual(try trace(app)["submitted_ids"] as? [String], ids, "Restoring is local writing, not a new request.")
        XCTAssertFalse(app.buttons["sharedVoiceStop"].exists)
        app.terminate(); app.launch(); _ = field(app)
        XCTAssertEqual(field(app).value as? String, words)
        assertSingleRecordedQuestion(words, in: app)
        XCTAssertEqual(try trace(app)["submitted_ids"] as? [String], ids, "Restart must not dispatch the restored draft.")
        enabled(app.buttons["sharedSend"]); app.buttons["sharedSend"].tap(); answer(app)
        let after = try trace(app), newIDs = try XCTUnwrap(after["submitted_ids"] as? [String])
        XCTAssertEqual(newIDs.count, 2); XCTAssertEqual(newIDs.first, ids.first)
        XCTAssertNotEqual(newIDs[1], ids[0], "Only the explicit Send creates a fresh request at the reconciled revision.")
        XCTAssertEqual(after["submitted_texts"] as? [String], [words, words])
        XCTAssertEqual(after["failed_turns"] as? Int, 1); XCTAssertEqual(after["accepted_turns"] as? Int, 1)
        try evidence("journey-recorded-failure-recovery", app: app)
    }
    @MainActor func testRecordedFailureCannotReplaceExistingDraft() throws {
        let app = launch("recorded-failure"); signIn(app)
        field(app).tap(); field(app).typeText("The recorded failed question"); app.buttons["sharedSend"].tap()
        enabled(app.buttons["restoreFailedReflectionDraft"])
        field(app).tap(); field(app).typeText("My different unfinished thought")
        XCTAssertFalse(app.buttons["restoreFailedReflectionDraft"].isEnabled)
        app.terminate(); app.launch(); _ = field(app)
        XCTAssertEqual(field(app).value as? String, "My different unfinished thought")
        XCTAssertTrue(app.buttons["restoreFailedReflectionDraft"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["restoreFailedReflectionDraft"].isEnabled)
        let result = try trace(app)
        XCTAssertEqual((result["submitted_ids"] as? [String])?.count, 1)
        XCTAssertEqual(result["failed_turns"] as? Int, 1); XCTAssertEqual(result["accepted_turns"] as? Int, 0)
        try evidence("journey-recorded-failure-collision", app: app)
    }
    @MainActor func testAIAdmissionDenialRemainsVisibleAfterHistoryRefreshAndRelaunch() throws {
        let app = launch("access-denied"); signIn(app)
        let words = "Do not lose the reason this cannot send"
        let input = field(app); input.tap(); input.typeText(words)
        app.buttons["sharedSend"].tap()
        let error = app.staticTexts["sharedError"]
        XCTAssertTrue(error.waitForExistence(timeout: 10)); enabled(app.buttons["restoreFailedReflectionDraft"])
        XCTAssertTrue(error.label.contains("AI 이용 권한"))
        XCTAssertFalse(app.buttons["sharedRetry"].exists, "Service records admission denial as a failed turn, not an unacknowledged local send.")
        assertSingleRecordedQuestion(words, in: app)
        XCTAssertFalse(app.staticTexts["sharedReply"].exists)
        let before = try trace(app)
        let paths = try XCTUnwrap(before["paths"] as? [String]), ids = try XCTUnwrap(before["submitted_ids"] as? [String])
        let post = try XCTUnwrap(paths.lastIndex(of: "POST /v1/me/reflection/turns"))
        XCTAssertTrue(paths.dropFirst(post + 1).contains("GET /v1/me/reflection"), "A successful history refresh must not erase the failed turn's reason.")
        XCTAssertEqual(before["failed_turns"] as? Int, 1); XCTAssertEqual(ids.count, 1)
        app.terminate(); app.launch(); _ = field(app)
        enabled(app.buttons["restoreFailedReflectionDraft"])
        XCTAssertTrue(error.waitForExistence(timeout: 10)); XCTAssertTrue(error.label.contains("AI 이용 권한"))
        assertSingleRecordedQuestion(words, in: app)
        app.buttons["restoreFailedReflectionDraft"].tap()
        XCTAssertEqual(field(app).value as? String, words)
        app.terminate(); app.launch(); _ = field(app)
        XCTAssertEqual(field(app).value as? String, words)
        XCTAssertFalse(app.buttons["restoreFailedReflectionDraft"].isEnabled)
        let after = try trace(app)
        XCTAssertEqual(after["accepted_turns"] as? Int, 0); XCTAssertEqual(after["failed_turns"] as? Int, 1)
        XCTAssertEqual(after["submitted_ids"] as? [String], ids, "Restore/relaunch cannot resend, replay or invent free access.")
        XCTAssertEqual(after["browser_callbacks"] as? Int, before["browser_callbacks"] as? Int)
        XCTAssertEqual((after["paths"] as? [String] ?? []).filter { $0 == "POST /v1/auth/native/exchange" }.count, 1, "A recorded admission failure must not trigger browser login again.")
        try evidence("journey-admission-denied", app: app)
    }
    @MainActor func testExpiredSignInLeavesActionableFailureInsteadOfInfiniteChecking() throws {
        let app = launch("sign-in-expired")
        let input = field(app); input.tap(); input.typeText("Keep this thought even when login fails")
        let start = app.buttons["linkDesktop"]; enabled(start); start.tap()
        XCTAssertTrue(app.staticTexts["sharedError"].waitForExistence(timeout: 10))
        enabled(start); XCTAssertFalse(app.buttons["accountCancel"].exists)
        XCTAssertEqual(field(app).value as? String, "Keep this thought even when login fails")
        XCTAssertTrue(field(app).isEnabled)
        let result = try trace(app)
        XCTAssertEqual(result["accepted_turns"] as? Int, 0)
        XCTAssertFalse((result["paths"] as? [String] ?? []).contains("POST /v1/auth/native/exchange"))
        app.terminate(); app.launch()
        XCTAssertEqual(field(app).value as? String, "Keep this thought even when login fails")
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        try evidence("journey-login-failure", app: app)
    }
    @MainActor func testFirstUseLargeTextDarkAndKeyboardKeepComposerReachable() throws {
        let app = launch("first-answer", arguments: ["--journey-dark", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        XCTAssertTrue(app.staticTexts["firstQuestion"].waitForExistence(timeout: 5))
        let dark = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == 'dark'"), object: diagnostic("nativeJourneyAppearance", in: app))
        XCTAssertEqual(XCTWaiter.wait(for: [dark], timeout: 5), .completed, "Observe the actual view environment, not just a launch preference.")
        let input = field(app)
        XCTAssertTrue(input.isEnabled && input.isHittable)
        try evidence("journey-first-use-dark-large-text", app: app)
        let thought = "This is my first thought\nI have more to say\nI want to understand it\nAnd keep these words\nBefore I sign in"
        input.tap(); input.typeText(thought)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let login = app.buttons["linkDesktop"]
        XCTAssertTrue(input.isHittable && login.isHittable)
        XCTAssertLessThanOrEqual(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertGreaterThanOrEqual(input.frame.minY, app.navigationBars.firstMatch.frame.maxY)
        XCTAssertLessThanOrEqual(login.frame.maxY, app.keyboards.firstMatch.frame.minY)
        XCTAssertGreaterThanOrEqual(login.frame.height, 44)
        XCTAssertFalse(app.buttons["conversationPrivacy"].exists, "The expanded disclosure must not crowd the editor while the keyboard is up; it remains in Settings.")
        XCTAssertEqual(field(app).value as? String, thought)
        XCTAssertTrue((try trace(app)["paths"] as? [String] ?? []).isEmpty)
        try evidence("journey-first-use-dark-large-text-keyboard", app: app)
    }
    @MainActor func testCancelLoginKeepsFirstThoughtWithoutExchangeOrSend() throws {
        let app = launch("sign-in-cancel")
        let input = field(app); input.tap(); input.typeText("A thought I am not ready to share")
        app.buttons["linkDesktop"].tap()
        let cancel = app.buttons["accountCancel"]; enabled(cancel); cancel.tap()
        enabled(app.buttons["linkDesktop"])
        XCTAssertEqual(field(app).value as? String, "A thought I am not ready to share")
        app.terminate(); app.launch()
        XCTAssertEqual(field(app).value as? String, "A thought I am not ready to share")
        let result = try trace(app)
        XCTAssertEqual(result["accepted_turns"] as? Int, 0)
        XCTAssertEqual(result["browser_callbacks"] as? Int, 0)
        XCTAssertFalse((result["paths"] as? [String] ?? []).contains("POST /v1/auth/native/exchange"))
        try evidence("journey-cancel-first-thought", app: app)
    }
    @MainActor func testLoginPreservesBothDraftsAndRestoresOnlyOnExplicitChoice() throws {
        let app = launch("draft-collision")
        let input = field(app); input.tap(); input.typeText("My thought before login")
        signIn(app)
        XCTAssertEqual(field(app).value as? String, "Existing account draft")
        let restore = app.buttons["restoreGuestDraft"]
        XCTAssertTrue(restore.exists); XCTAssertFalse(restore.isEnabled)
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        app.terminate(); app.launch()
        XCTAssertEqual(field(app).value as? String, "Existing account draft")
        XCTAssertTrue(restore.exists); XCTAssertFalse(restore.isEnabled)
        let draft = field(app)
        // A center tap can put the caret at the beginning. Tap the trailing
        // edge of this single-line value before deleting, then verify the
        // prerequisite rather than treating a disabled restore as a timeout.
        draft.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        draft.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Existing account draft".count))
        let empty = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '' OR value == %@", draft.placeholderValue ?? ""), object: draft)
        XCTAssertEqual(XCTWaiter.wait(for: [empty], timeout: 5), .completed, "The account draft must actually be cleared before restoring the separate guest draft.")
        enabled(restore); restore.tap()
        XCTAssertEqual(field(app).value as? String, "My thought before login")
        XCTAssertFalse(restore.exists)
        XCTAssertEqual(try trace(app)["accepted_turns"] as? Int, 0)
        try evidence("journey-first-thought-collision", app: app)
    }
}
