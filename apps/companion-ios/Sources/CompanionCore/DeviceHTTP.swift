import Foundation
import CoreFoundation

private final class RejectRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

// Fixed HTTPS origins, ephemeral cookies/cache, bounded streaming JSON, default system TLS trust.
public struct DeviceHTTP: DeviceTransport {
    public init() {}
    public func call(_ route: DeviceRoute, body: [String: String]?, bearer: String?) async throws -> DeviceReply {
        try Task.checkCancellation()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 12; configuration.timeoutIntervalForResource = 12
        let session = URLSession(configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: DeviceSignIn.serviceOrigin + route.rawValue)!)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse,
              http.url == request.url,
              http.value(forHTTPHeaderField: "Content-Type")?.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() == "application/json",
              response.expectedContentLength <= 65_536 else { throw SignInFailure.invalidResponse }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < 65_536 else { throw SignInFailure.invalidResponse }
            data.append(byte)
        }
        return try Self.decode(data, status: http.statusCode)
    }
    static func decode(_ data: Data, status: Int) throws -> DeviceReply {
        guard data.count <= 65_536, String(data: data, encoding: .utf8) != nil,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw SignInFailure.invalidResponse }
        var fields: [String: String] = [:], numbers: [String: Int] = [:]
        if json.keys.contains("error"), !(json["error"] is String) { throw SignInFailure.invalidResponse }
        for name in ["error", "status", "device_code", "user_code", "verification_uri", "verification_uri_complete", "access_token", "session_id"] {
            if let value = json[name] as? String { fields[name] = value }
        }
        for name in ["expires_in", "interval"] {
            if let value = json[name] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
               value.doubleValue.isFinite, value.doubleValue >= 0, value.doubleValue <= 3600,
               value.doubleValue.rounded() == value.doubleValue { numbers[name] = value.intValue }
        }
        if let account = json["account"] as? [String: Any] {
            fields["account_id"] = account["id"] as? String
            fields["account_status"] = account["status"] as? String
        }
        // Refresh tokens and all profile/consent fields are intentionally dropped.
        return DeviceReply(status: status, fields: fields, numbers: numbers)
    }
}
