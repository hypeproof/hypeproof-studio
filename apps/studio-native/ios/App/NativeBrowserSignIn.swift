import AuthenticationServices
import UIKit

@MainActor final class NativeBrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var pending: CheckedContinuation<URL, Error>?
    private var generation = UUID()
    private var timeout: Task<Void, Never>?
    func authenticate(_ url: URL, expiresIn: Double) async throws -> URL {
#if DEBUG
        if NativeJourneyFixture.enabled, let callback = try await NativeJourneyFixture.authenticate(url: url) { return callback }
#endif
        try Task.checkCancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled, pending == nil else { continuation.resume(throwing: CancellationError()); return }
                let id = UUID(); generation = id; pending = continuation
                let browser = ASWebAuthenticationSession(url: url, callbackURLScheme: "hypeproof-studio-mobile") { [weak self] callback, error in
                    Task { @MainActor in
                        guard let self, self.generation == id else { return }
                        if let callback { self.finish(.success(callback)) }
                        else { self.finish(.failure(error ?? CancellationError())) }
                    }
                }
                browser.presentationContextProvider = self
                // Reuse the person's browser account; identity and PKCE are still
                // checked by Service and the pending app transaction.
                session = browser
                guard browser.start() else { finish(.failure(StudioError.message("로그인 화면을 열지 못했어요. 다시 시도해 주세요."))); return }
                timeout = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(expiresIn * 1_000_000_000))
                    guard !Task.isCancelled, let self, self.generation == id else { return }
                    self.finish(.failure(StudioError.message("로그인 시간이 지났어요. 다시 시작해 주세요.")))
                }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.cancel() } }
    }
    func cancel() { finish(.failure(CancellationError())) }
    private func finish(_ result: Result<URL, Error>) {
        generation = UUID(); timeout?.cancel(); timeout = nil
        let continuation = pending; pending = nil
        let browser = session; session = nil; browser?.cancel()
        continuation?.resume(with: result)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
