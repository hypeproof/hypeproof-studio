import XCTest
import CryptoKit
@testable import StudioCore

final class NativeAccountAuthTests: XCTestCase {
    func testExpiredExchangeRequestsNewLoginWithoutDesktopInstruction() {
        for code in ["native_signin_expired", "native_signin_not_pending", "invalid_native_signin"] {
            XCTAssertEqual(SyncFailure.http(400, code).errorDescription, "로그인 요청이 만료됐거나 이미 사용됐어요. 로그인을 다시 시작해 주세요.")
        }
        XCTAssertFalse(SyncFailure.http(503, "unavailable").errorDescription?.contains("컴퓨터") == true)
    }
    func testPKCEAndCallbackBindOneAppLoginWithoutCredentialsInURL() throws {
        let proof = NativeAccountProof(), other = NativeAccountProof()
        XCTAssertEqual(proof.state.count, 64)
        XCTAssertEqual(proof.verifier.count, 43)
        XCTAssertNotEqual(proof.state, other.state)
        let hash = Data(SHA256.hash(data: Data(proof.verifier.utf8))).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(proof.challenge, hash)
        let code = String(repeating: "b", count: 64)
        let callback = URL(string: NativeAccountProof.redirectURI + "?code=\(code)&state=\(proof.state)")!
        XCTAssertEqual(try proof.authorizationCode(from: callback), code)
        XCTAssertThrowsError(try other.authorizationCode(from: callback))
        let expired = URL(string: NativeAccountProof.redirectURI + "?error=login_expired&state=\(proof.state)")!
        XCTAssertThrowsError(try proof.authorizationCode(from: expired)) { error in
            XCTAssertEqual(error.localizedDescription, "로그인 시간이 지났어요. 다시 시작해 주세요.")
        }
        XCTAssertThrowsError(try other.authorizationCode(from: expired)) { error in
            XCTAssertEqual(error.localizedDescription, SyncFailure.invalidResponse.localizedDescription)
        }
        for value in [callback.absoluteString + "&state=" + proof.state,
                      callback.absoluteString + "&access_token=secret",
                      callback.absoluteString + "#fragment",
                      callback.absoluteString.replacingOccurrences(of: "account-return?", with: "account-return/else?"),
                      callback.absoluteString.replacingOccurrences(of: "hypeproof-studio-mobile:", with: "https:")] {
            XCTAssertThrowsError(try proof.authorizationCode(from: URL(string: value)!))
        }
    }
    func testBrowserDestinationCannotBeChangedToAnotherOriginOrEndpoint() throws {
        let request = String(repeating: "a", count: 64)
        func response(_ uri: String, ttl: Double = 600) throws -> NativeAccountStart {
            let data = try JSONSerialization.data(withJSONObject: ["authorization_uri": uri, "expires_in": ttl])
            return try JSONDecoder().decode(NativeAccountStart.self, from: data)
        }
        let valid = "https://hypeproof-ai.xyz/api/studio-native?request=" + request
        XCTAssertNoThrow(try response(valid).validate())
        for value in [valid.replacingOccurrences(of: "hypeproof-ai.xyz", with: "hypeproof-ai.xyz.evil.test"),
                      valid.replacingOccurrences(of: "/api/studio-native", with: "/studio/connect"),
                      valid + "&return=https://evil.test", valid + "#fragment"] {
            XCTAssertThrowsError(try response(value).validate())
        }
        XCTAssertThrowsError(try response(valid, ttl: 601).validate())
    }
}
