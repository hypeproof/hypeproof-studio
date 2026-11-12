import Foundation
import CryptoKit

/// Proof stays in app memory. The browser receives only its challenge and state;
/// callback URLs never carry account credentials.
public struct NativeAccountProof: Sendable {
    public static let redirectURI = "hypeproof-studio-mobile://account-return"
    public let state: String
    public let verifier: String
    public var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    public init() {
        state = (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
        verifier = Self.base64url(Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
    }
    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    public func authorizationCode(from url: URL) throws -> String {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "hypeproof-studio-mobile", parts.host == "account-return",
              parts.path.isEmpty, parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              let query = parts.queryItems, query.count == 2,
              query.filter({ $0.name == "state" }).count == 1,
              query.first(where: { $0.name == "state" })?.value == state
        else { throw SyncFailure.invalidResponse }
        if let error = query.first(where: { $0.name == "error" })?.value {
            switch error {
            case "login_expired": throw StudioError.message("로그인 시간이 지났어요. 다시 시작해 주세요.")
            case "login_denied": throw StudioError.message("로그인이 취소됐어요. 준비되면 다시 시작해 주세요.")
            case "login_unavailable": throw StudioError.message("로그인을 마치지 못했어요. 잠시 뒤 다시 시도해 주세요.")
            default: throw SyncFailure.invalidResponse
            }
        }
        guard let code = query.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
        else { throw SyncFailure.invalidResponse }
        return code
    }
}

public struct NativeAccountStart: Decodable, Sendable {
    public let authorization_uri: URL
    public let expires_in: Double
    public func validate() throws {
        guard let parts = URLComponents(url: authorization_uri, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.host == "hypeproof-ai.xyz", parts.port == nil,
              parts.user == nil, parts.password == nil, parts.fragment == nil,
              parts.path == "/api/studio-native", let query = parts.queryItems, query.count == 1,
              query[0].name == "request", let value = query[0].value,
              value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              expires_in.isFinite, expires_in > 0, expires_in <= 600 else { throw SyncFailure.invalidResponse }
    }
}
