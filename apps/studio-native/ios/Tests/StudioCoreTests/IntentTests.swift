import XCTest
@testable import StudioCore

final class IntentTests: XCTestCase {
    func testNextSuccessfulSaveIncludesEarlierFailedReflectionEdits() throws {
        var disk = Notebook(); var project = Project()
        project.reflection = ["observation": "old observation"]
        disk.projects = [project]
        let visible = [project.id + ":reflection:observation": "unsaved observation"]
        // The first save failed: disk is still old, but visible edits survive.
        let next = try disk.updating(project.id, visibleEdits: visible) { $0.reflection?["learning"] = "later successful edit" }
        let restarted = try Notebook.decode(next.encode())
        XCTAssertEqual(restarted.projects[0].reflection?["observation"], "unsaved observation")
        XCTAssertEqual(restarted.projects[0].reflection?["learning"], "later successful edit")
        XCTAssertEqual(restarted.projects[0].displayTitle, "unsaved observation")
        XCTAssertTrue(restarted.projects[0].matches("observation"))
        XCTAssertTrue(restarted.projects[0].revisions.isEmpty)
        XCTAssertFalse(restarted.projects[0].conversation().description.contains("unsaved observation"))
    }
    func testReflectionSurvivesRestartWithoutBecomingAIContextOrConfirmedIntent() throws {
        var notebook = Notebook(); var first = Project()
        first.reflection = ["observation": "동네 가게의 실제 관찰", "learning": "내 추측과 달랐다"]
        notebook.projects = [first, Project(title: "다른 생각")]
        let restored = try Notebook.decode(notebook.encode())
        XCTAssertEqual(restored.projects[0].reflection?["learning"], "내 추측과 달랐다")
        XCTAssertNil(restored.projects[1].reflection)
        XCTAssertTrue(restored.projects[0].revisions.isEmpty)
        XCTAssertFalse(restored.projects[0].conversation().description.contains("동네 가게의 실제 관찰"))
        let exported = try Notebook.decode(restored.includingEdits([first.id + ":reflection:learning": "저장 실패 후 보이는 수정"]).encode())
        XCTAssertEqual(exported.projects[0].reflection?["learning"], "저장 실패 후 보이는 수정")
        XCTAssertEqual(restored.projects[0].reflection?["learning"], "내 추측과 달랐다")
    }
    func testOriginalV1RecordsRemainReadableWithoutReflection() throws {
        var notebook = Notebook(); notebook.projects = [Project()]
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: notebook.encode()) as? [String: Any])
        var projects = try XCTUnwrap(json["projects"] as? [[String: Any]])
        projects[0].removeValue(forKey: "reflection"); json["projects"] = projects
        let restored = try Notebook.decode(JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(restored.version, 1)
        XCTAssertNil(restored.projects[0].reflection)
    }
    func testExportRetainsVisibleEditsWhenPersistedDraftIsOlder() throws {
        var saved = Notebook(); var project = Project(); project.draft = "old draft A"; saved.projects = [project]
        let edits = [project.id + ":draft": "visible draft B", project.id + ":intent": "unconfirmed intention B"]
        let export = try Notebook.decode(saved.includingEdits(edits).encode())
        XCTAssertEqual(export.projects[0].draft, "visible draft B")
        XCTAssertEqual(export.projects[0].intentDraft, "unconfirmed intention B")
        XCTAssertTrue(export.projects[0].revisions.isEmpty)
        XCTAssertEqual(saved.projects[0].draft, "old draft A")
    }
    func testHumanRevisionAndContextIsolation() throws {
        var first = Project(); try first.append("동네 가게의 빈 시간을 줄이고 싶다")
        first.messages.append(Message(role: "assistant", content: "누가 가장 불편할까요?"))
        XCTAssertTrue(first.revisions.isEmpty)
        try first.confirm("사장님의 예약 공백을 먼저 관찰한다")
        try first.confirm("고객의 예약 취소 이유부터 확인한다")
        XCTAssertEqual(first.revisions.map(\.revision), [1,2])
        XCTAssertTrue(first.conversation()[0]["content"]!.contains("고객의 예약 취소"))
        XCTAssertFalse(first.conversation()[0]["content"]!.contains("사장님의 예약 공백"))
        let second = Project(title: "다른 생각")
        XCTAssertFalse(second.conversation().description.contains("예약"))
    }
    func testDraftAndRevisionsSurviveRestart() throws {
        var value = Notebook(); var project = Project(); project.draft = "내일 물어볼 질문"; project.intentDraft = "아직 확정하지 않았다"
        try project.confirm("오늘 세 사람을 관찰한다"); value.projects = [project]
        let decoded = try Notebook.decode(value.encode())
        XCTAssertEqual(decoded.projects[0].id, value.projects[0].id)
        XCTAssertEqual(decoded.projects[0].draft, value.projects[0].draft)
        XCTAssertEqual(decoded.projects[0].intentDraft, value.projects[0].intentDraft)
        XCTAssertEqual(decoded.projects[0].revisions[0].text, value.projects[0].revisions[0].text)
        XCTAssertEqual(decoded.projects[0].revisions[0].confirmedAt.timeIntervalSince1970, value.projects[0].revisions[0].confirmedAt.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertThrowsError(try Project.checked("  "))
        XCTAssertThrowsError(try Project.checked(String(repeating: "가", count: 4001)))
    }
    func testUnknownSchemaAndForgedAuthorDoNotOverwrite() throws {
        var value = Notebook(); value.version = 9
        XCTAssertThrowsError(try Notebook.decode(value.encode()))
        value = Notebook(); var project = Project(); try project.confirm("사용자가 확인한 문장")
        project.revisions[0].author = "assistant"; value.projects = [project]
        XCTAssertThrowsError(try Notebook.decode(value.encode()))
    }
    func testContextIsBoundedAndErrorCausesDistinct() throws {
        var project = Project()
        for index in 0..<30 { try project.append("관찰 \(index)") }
        XCTAssertEqual(project.conversation().count, 21)
        XCTAssertFalse(project.conversation().description.contains("관찰 0\""))
        XCTAssertNotEqual(StudioService.friendly(status: 429, code: "network_limit"), StudioService.friendly(status: 429, code: "trial_allowance_exhausted"))
    }
}
