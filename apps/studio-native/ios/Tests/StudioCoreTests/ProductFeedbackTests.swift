import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XCTest)
import XCTest
@testable import StudioCore
final class ProductFeedbackTests: XCTestCase {
    @MainActor func testDurableSubmissionBoundaries() async throws { try await verifyProductFeedback() }
}
#else
// Also executable with Command Line Tools when the XCTest SDK is unavailable.
@main struct ProductFeedbackSmoke {
    @MainActor static func main() async throws {
        try await verifyProductFeedback()
        print("PASS: feedback payload, persistence, failures, restart and concurrent submission")
    }
}
#endif

@MainActor private func verifyProductFeedback() async throws {
    func check(_ value: Bool, _ message: String) throws {
        if !value { throw StudioError.message(message) }
    }
    var disk = ProductFeedback(), calls = 0, failSave = false
    var status = 200, response = Data(#"{"report_id":"report-123"}"#.utf8)
    var release: CheckedContinuation<Void, Never>?
    var suspend = false
    func make() -> ProductFeedbackController {
        ProductFeedbackController(load: { disk }, save: {
            if failSave { throw CocoaError(.fileWriteOutOfSpace) }; disk = $0
        }, send: { request in
            calls += 1
            try check(disk.phase == .uncertain, "Persist before network")
            try check(request.url?.absoluteString == "https://api.hypeproof-ai.xyz/v1/report", "Endpoint")
            try check(request.httpMethod == "POST" && request.value(forHTTPHeaderField: "Authorization") == nil, "Anonymous POST")
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            try check(Set(body.keys) == Set(["description", "contact", "include_recent_turns", "attachments"]), "Payload allowlist")
            try check(body["include_recent_turns"] as? Bool == false, "No conversation history")
            if suspend { await withCheckedContinuation { release = $0 } }
            return (response, status)
        })
    }
    let first = make()
    first.edit(text: "아이폰에서 의견", contact: "")
    try check(make().value.text == first.value.text, "Draft survives reopen")
    failSave = true
    await first.submit(version: "test", os: "test")
    try check(calls == 0 && first.value.phase == .draft, "Failed persistence prevents dispatch")
    failSave = false
    suspend = true
    let task = Task { await first.submit(version: "test", os: "test") }
    while release == nil { await Task.yield() }
    await first.submit(version: "test", os: "test")
    try check(calls == 1, "Concurrent tap does not duplicate")
    release?.resume(); await task.value; suspend = false
    try check(disk.receipt == "report-123" && disk.phase == .received, "Receipt persists")
    await make().submit(version: "test", os: "test")
    try check(calls == 1, "Receipt does not replay after restart")

    for failure in [(200, Data("{}".utf8)), (500, response), (200, Data("invalid".utf8))] {
        first.clear(); first.edit(text: "실패 확인", contact: "")
        status = failure.0; response = failure.1
        await first.submit(version: "test", os: "test")
        let before = calls
        await make().submit(version: "test", os: "test")
        try check(disk.phase == .uncertain && calls == before, "Ambiguous response survives restart without replay")
    }
    let broken = ProductFeedbackController(load: { throw CocoaError(.fileReadCorruptFile) }, save: { _ in
        throw StudioError.message("Must not overwrite corrupt storage")
    }, send: { _ in throw StudioError.message("Must not send corrupt draft") })
    broken.edit(text: "replace", contact: ""); broken.clear()
    await broken.submit(version: "test", os: "test")
    try check(broken.readOnly && broken.value.text.isEmpty, "Corrupt storage remains read-only")

    first.clear(); first.edit(text: "保存", contact: "")
    let receiptSaveFailure = ProductFeedbackController(load: { disk }, save: { value in
        if value.phase == .received { throw CocoaError(.fileWriteOutOfSpace) }; disk = value
    }, send: { _ in (Data(#"{"report_id":"kept-123"}"#.utf8), 200) })
    await receiptSaveFailure.submit(version: "test", os: "test")
    try check(receiptSaveFailure.value.receipt == "kept-123" && disk.phase == .uncertain, "Retain receipt in memory when disk fails")
    let offline = ProductFeedbackController(load: { var v = ProductFeedback(); v.text = "offline"; return v }, save: { disk = $0 }, send: { _ in throw URLError(.timedOut) })
    await offline.submit(version: "test", os: "test")
    try check(disk.phase == .uncertain && offline.error != nil, "Timeout remains uncertain")
    var emoji = ProductFeedback(); emoji.text = String(repeating: "😀", count: 2500)
    _ = try emoji.request(version: "test", os: "test")
    emoji.text += "😀"
    var rejectedEmoji = false
    do { _ = try emoji.request(version: "test", os: "test") } catch { rejectedEmoji = true }
    try check(rejectedEmoji, "UTF-16 limit also applies to emoji")
    var oversized = ProductFeedback(); oversized.text = String(repeating: "a", count: 5001)
    do { _ = try oversized.request(version: "test", os: "test"); throw StudioError.message("Oversized payload accepted") }
    catch let error as StudioError { try check(error.localizedDescription != "Oversized payload accepted", "Input bound") }
}
