import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A single device-local draft. A server receipt is not a GitHub issue receipt.
public struct ProductFeedback: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case draft, uncertain, received }
    public var text = ""
    public var contact = ""
    public var phase: Phase = .draft
    public var receipt: String?
    public init() {}

    public func request(version: String, os: String) throws -> URLRequest {
        let description = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard phase == .draft, !description.isEmpty, text.utf16.count <= 5000,
              contact.utf16.count <= 200 else { throw StudioError.message("의견을 입력해 주세요. 의견은 5,000단위, 연락처는 200단위까지이며 이모지는 여러 단위로 계산돼요.") }
        var request = URLRequest(url: URL(string: "https://api.hypeproof-ai.xyz/v1/report")!, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "description": description, "contact": contact.trimmingCharacters(in: .whitespacesAndNewlines),
            "include_recent_turns": false,
            "attachments": ["studio_version": version, "os": os, "report_source": "ios_manual"]
        ])
        return request
    }
}

/// Persist before dispatch; never replay an ambiguous submission automatically.
@MainActor public final class ProductFeedbackController {
    public private(set) var value = ProductFeedback()
    public private(set) var busy = false
    public private(set) var readOnly = false
    public private(set) var error: String?
    private let save: (ProductFeedback) throws -> Void
    private let send: (URLRequest) async throws -> (Data, Int)
    public var changed: (() -> Void)?

    public init(load: () throws -> ProductFeedback, save: @escaping (ProductFeedback) throws -> Void,
                send: @escaping (URLRequest) async throws -> (Data, Int)) {
        self.save = save; self.send = send
        do { value = try load() }
        catch { readOnly = true; self.error = "저장된 의견을 읽지 못했어요. 원본을 덮어쓰지 않았어요." }
    }
    public func edit(text: String, contact: String) {
        guard !busy, !readOnly, value.phase == .draft else { return }
        value.text = text; value.contact = contact
        do { try save(value); error = nil }
        catch { self.error = "기기에 저장하지 못했어요. 닫기 전에 내용을 복사해 주세요." }
        changed?()
    }
    public func clear() {
        guard !busy, !readOnly else { return }
        do { let empty = ProductFeedback(); try save(empty); value = empty; error = nil }
        catch { self.error = "기록을 지우지 못했어요. 내용을 유지했어요." }
        changed?()
    }
    public func submit(version: String, os: String) async {
        guard !busy, !readOnly, value.phase == .draft else { return }
        let request: URLRequest
        do { request = try value.request(version: version, os: os) }
        catch { self.error = error.localizedDescription; changed?(); return }
        do {
            var pending = value; pending.phase = .uncertain
            try save(pending)
            value = pending
        } catch { self.error = "보내지 않았어요. 기기에 전송 상태를 저장하지 못했어요. 내용을 내보내고 저장 공간을 확인해 주세요."; changed?(); return }
        busy = true; error = nil; changed?()
        defer { busy = false; changed?() }
        do {
            let (data, status) = try await send(request)
            guard (200..<300).contains(status), data.count <= 65_536,
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let receipt = body["report_id"] as? String,
                  !receipt.isEmpty, receipt.count <= 128,
                  receipt.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else {
                error = "접수 여부를 확인하지 못했어요. 중복 접수를 막기 위해 자동으로 다시 보내지 않아요."
                return
            }
            value.phase = .received; value.receipt = receipt
            do { try save(value) }
            catch { self.error = "접수됐지만 기기에 접수 번호를 저장하지 못했어요. 번호를 복사해 주세요." }
        } catch {
            self.error = "연결이 끊겨 접수 여부를 확인하지 못했어요. 작성한 내용은 유지했어요."
        }
    }
}
