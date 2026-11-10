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
}
final class ServiceTests: XCTestCase {
    func testNativeServiceBoundary() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let service = StudioService(session: URLSession(configuration: config), base: URL(string:"https://fixture.invalid")!)
        var requests: [URLRequest] = []
        StubProtocol.handler = { request in
            requests.append(request)
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
        let claim = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String:Any]
        XCTAssertEqual(claim["install_id"] as? String,"2e3582ee-361e-4112-a890-b82d103f1868")
        XCTAssertEqual(requests[1].value(forHTTPHeaderField:"x-hps-turn-id"),project.messages.last!.id)
        XCTAssertEqual(requests[1].value(forHTTPHeaderField:"x-hps-effort"),"low")
        let body = try JSONSerialization.jsonObject(with: requests[1].httpBody!) as! [String:Any]
        XCTAssertEqual(body["max_tokens"] as? Int,2048)
        XCTAssertNil(body["system"])
    }
}
