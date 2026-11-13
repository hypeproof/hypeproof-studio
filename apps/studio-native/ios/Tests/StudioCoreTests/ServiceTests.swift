import XCTest
@testable import StudioCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
private final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do { let (status,data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
    static func body(_ request: URLRequest) throws -> Data {
        if let data = request.httpBody { return data }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open(); defer { stream.close() }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? StudioError.message("Fixture stream failed") }
            if count == 0 { break }; data.append(contentsOf: buffer.prefix(count))
        }
        return data
    }
}
final class ServiceTests: XCTestCase {
    func testReflectionTransportKeepsMonthlyAndUnknownBudgetRefusalsDistinct() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let session = URLSession(configuration: config)
        defer { StubProtocol.handler = nil; session.invalidateAndCancel() }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        var pending = try SharedRequest.pending("보낸 생각"); pending.expectedRevision = 2
        var calls = 0
        for (status, code) in [(429, "reflection_monthly_limit"), (429, "reflection_budget_limit"), (503, "reflection_admission_unavailable"), (403, "reflection_access_required")] {
            StubProtocol.handler = { request in
                calls += 1
                XCTAssertEqual(request.url?.path, "/v1/me/reflection/turns")
                XCTAssertEqual(request.httpMethod, "POST")
                let body = try JSONSerialization.jsonObject(with: StubProtocol.body(request)) as! [String: Any]
                XCTAssertEqual(body["text"] as? String, "보낸 생각")
                return (status, try JSONSerialization.data(withJSONObject: ["error": code]))
            }
            let before = calls
            do {
                _ = try await service.reflect(pending, token: "synthetic")
                XCTFail("Admission refusal must not become a successful answer")
            } catch SyncFailure.http(let actualStatus, let actualCode) {
                XCTAssertEqual(actualStatus, status); XCTAssertEqual(actualCode, code)
                let message = SyncFailure.http(actualStatus, actualCode).localizedDescription
                XCTAssertFalse(message.contains("오늘") || message.contains("내일") || message.contains("다시 로그인"))
                XCTAssertEqual(message.contains("이번 달"), code == "reflection_monthly_limit")
                XCTAssertEqual(message.contains("다음 달"), code == "reflection_monthly_limit")
                if status == 503 { XCTAssertTrue(message.contains("이용 상태를 확인하지 못")) }
                if status == 403 { XCTAssertTrue(message.contains("이용 권한")) }
            }
            XCTAssertEqual(calls, before + 1, "Refusal must not silently resend the turn")
        }
    }
    func testNativeServiceBoundary() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let service = StudioService(session: URLSession(configuration: config), base: URL(string:"https://fixture.invalid")!)
        var requests: [URLRequest] = []
        var bodies: [Data] = []
        StubProtocol.handler = { request in
            requests.append(request); bodies.append(try StubProtocol.body(request))
            if request.url!.path == "/v1/free/claim" {
                return (200, try JSONSerialization.data(withJSONObject: ["code":"fixture-only", "expires_at":Date().timeIntervalSince1970 * 1000 + 60000]))
            }
            return (200, Data("{\"content\":[{\"type\":\"thinking\",\"thinking\":\"private\"},{\"type\":\"text\",\"text\":\"누구의 불편을 보았나요?\"}],\"stop_reason\":\"end_turn\"}".utf8))
        }
        defer { StubProtocol.handler = nil }
        let grant = try await service.claim(installID:"2E3582EE-361E-4112-A890-B82D103F1868")
        var project = Project(); try project.append("가게 예약이 어렵다")
        let reply = try await service.reply(project: project, grant: grant)
        XCTAssertEqual(reply,"누구의 불편을 보았나요?")
        let claim = try JSONSerialization.jsonObject(with: bodies[0]) as! [String:Any]
        XCTAssertEqual(claim["install_id"] as? String,"2e3582ee-361e-4112-a890-b82d103f1868")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField:"x-hps-turn-id"),project.messages.last!.id)
        XCTAssertEqual(requests[1].value(forHTTPHeaderField:"x-hps-effort"),"low")
        let body = try JSONSerialization.jsonObject(with: bodies[1]) as! [String:Any]
        XCTAssertEqual(body["max_tokens"] as? Int,2048)
        XCTAssertNil(body["system"])
    }
}
