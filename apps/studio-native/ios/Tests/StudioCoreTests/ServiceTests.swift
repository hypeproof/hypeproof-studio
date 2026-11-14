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
private final class StreamingHistoryProtocol: URLProtocol, @unchecked Sendable {
    static var stopped: (() -> Void)?
    static var started: ((URLRequest) -> Void)?
    private var timer: DispatchSourceTimer?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.started?(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        // A valid response header plus continuing bytes never completes its
        // body. An idle timeout alone is not an elapsed completion deadline.
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "history-body-fixture"))
        timer.schedule(deadline: .now(), repeating: .milliseconds(25))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.client?.urlProtocol(self, didLoad: Data(" ".utf8))
        }
        self.timer = timer; timer.resume()
    }
    override func stopLoading() { timer?.cancel(); timer = nil; Self.stopped?() }
}
final class ServiceTests: XCTestCase {
    func testHistoryDeadlineCancelsAContinuingBodyWithoutRetry() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StreamingHistoryProtocol.self]
        let session = URLSession(configuration: config)
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        let ended = expectation(description: "history returns a timeout"), stopped = expectation(description: "owned HTTP task stops")
        let started = expectation(description: "one authenticated history GET")
        started.assertForOverFulfill = true
        StreamingHistoryProtocol.started = { request in
            XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.url?.path, "/v1/me/reflection")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access")
            started.fulfill()
        }
        StreamingHistoryProtocol.stopped = { stopped.fulfill() }
        defer { session.invalidateAndCancel(); StreamingHistoryProtocol.stopped = nil; StreamingHistoryProtocol.started = nil }
        let read = Task {
            do { _ = try await service.reflection("synthetic-access", timeout: 0.15); XCTFail("An unfinished body cannot be a history response") }
            catch { XCTAssertEqual((error as? URLError)?.code, .timedOut) }
            ended.fulfill()
        }
        await fulfillment(of: [started, ended], timeout: 2)
        // Bounds the old-source negative too; cancellation is cleanup after the
        // assertion, never an alternative successful completion oracle.
        read.cancel(); _ = await read.result
        await fulfillment(of: [stopped], timeout: 2)
    }

    func testNativeLoginUsesVerifiedCallbackOnceAndNeverExchangesAnExpiredCallback() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let session = URLSession(configuration: config)
        defer { StubProtocol.handler = nil; session.invalidateAndCancel() }
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        let proof = NativeAccountProof(), code = String(repeating: "b", count: 64)
        var paths: [String] = []
        StubProtocol.handler = { request in
            paths.append(request.url!.path)
            switch request.url!.path {
            case "/v1/auth/native/start":
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                let body = try JSONSerialization.jsonObject(with: StubProtocol.body(request)) as! [String: Any]
                XCTAssertEqual(body["state"] as? String, proof.state)
                XCTAssertEqual(body["code_challenge"] as? String, proof.challenge)
                XCTAssertEqual(body["redirect_uri"] as? String, NativeAccountProof.redirectURI)
                return (200, try JSONSerialization.data(withJSONObject: ["authorization_uri": "https://hypeproof-ai.xyz/api/studio-native?request=" + String(repeating: "a", count: 64), "expires_in": 600]))
            case "/v1/auth/native/exchange":
                XCTAssertEqual(request.httpMethod, "POST")
                let body = try JSONSerialization.jsonObject(with: StubProtocol.body(request)) as! [String: Any]
                XCTAssertEqual(body["code"] as? String, code); XCTAssertEqual(body["code_verifier"] as? String, proof.verifier)
                return (200, try JSONSerialization.data(withJSONObject: ["access_token": "synthetic-access", "refresh_token": String(repeating: "c", count: 64), "expires_in": 3600, "session_id": "synthetic-session"]))
            case "/v1/me":
                XCTAssertEqual(request.httpMethod, "GET")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-access")
                return (200, Data(#"{"account":{"id":"synthetic-account","status":"active"},"session_id":"synthetic-session"}"#.utf8))
            default: XCTFail("Unexpected login request"); throw URLError(.badURL)
            }
        }
        _ = try await service.startNativeSignIn(proof)
        let expired = URL(string: NativeAccountProof.redirectURI + "?error=login_expired&state=" + proof.state)!
        do { _ = try await service.exchangeNativeSignIn(callback: expired, proof: proof); XCTFail("Expired callback must fail before HTTP") }
        catch { XCTAssertEqual(error.localizedDescription, "로그인 시간이 지났어요. 다시 시작해 주세요.") }
        XCTAssertEqual(paths, ["/v1/auth/native/start"], "A denied callback must never exchange or retry")
        let callback = URL(string: NativeAccountProof.redirectURI + "?code=" + code + "&state=" + proof.state)!
        let tokens = try await service.exchangeNativeSignIn(callback: callback, proof: proof)
        let identity = try await service.accountID(tokens.access_token, sessionID: tokens.session_id)
        XCTAssertEqual(identity, "synthetic-account")
        XCTAssertEqual(paths, ["/v1/auth/native/start", "/v1/auth/native/exchange", "/v1/me"])
        var failedCalls = 0
        StubProtocol.handler = { request in
            failedCalls += 1; XCTAssertEqual(request.url?.path, "/v1/auth/native/exchange")
            throw URLError(.timedOut)
        }
        let another = NativeAccountProof()
        let anotherCallback = URL(string: NativeAccountProof.redirectURI + "?code=" + code + "&state=" + another.state)!
        do { _ = try await service.exchangeNativeSignIn(callback: anotherCallback, proof: another); XCTFail("An uncertain exchange must fail without replay") }
        catch {
            XCTAssertEqual((error as? URLError)?.code, .timedOut)
            XCTAssertNotEqual(error.localizedDescription, "로그인 시간이 지났어요. 다시 시작해 주세요.")
        }
        XCTAssertEqual(failedCalls, 1)
    }

    func testCancellingHistoryStopsTheOwnedRequestAndDeadline() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StreamingHistoryProtocol.self]
        let session = URLSession(configuration: config)
        let service = ConversationService(session: session, base: URL(string: "https://fixture.invalid")!)
        let started = expectation(description: "history began"), ended = expectation(description: "cancel returned")
        let stopped = expectation(description: "owned request stopped")
        StreamingHistoryProtocol.started = { _ in started.fulfill() }
        StreamingHistoryProtocol.stopped = { stopped.fulfill() }
        defer { session.invalidateAndCancel(); StreamingHistoryProtocol.started = nil; StreamingHistoryProtocol.stopped = nil }
        let read = Task {
            do { _ = try await service.reflection("synthetic-access"); XCTFail("Cancelled history cannot be applied") }
            catch { XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled) }
            ended.fulfill()
        }
        await fulfillment(of: [started], timeout: 2)
        read.cancel()
        await fulfillment(of: [stopped, ended], timeout: 2)
        _ = await read.result
    }
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
