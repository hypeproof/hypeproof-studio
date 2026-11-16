#if DEBUG
import Foundation

/// Resolves a permission wait once even when the OS reply arrives after Stop.
/// Cancellation cannot dismiss the OS sheet; it releases this evaluation's wait.
final class LiveKitEvaluationPermission: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Bool?
    private var continuation: CheckedContinuation<Bool, Never>?

    @MainActor
    static func request(_ submit: (@escaping @Sendable (Bool) -> Void) -> Void) async -> Bool {
        let reply = LiveKitEvaluationPermission()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard reply.install(continuation) else { return }
                submit { allowed in reply.complete(allowed) }
            }
        } onCancel: {
            reply.complete(false)
        }
    }

    private func install(_ continuation: CheckedContinuation<Bool, Never>) -> Bool {
        lock.lock()
        if let result {
            lock.unlock()
            continuation.resume(returning: result)
            return false
        }
        self.continuation = continuation
        lock.unlock()
        return true
    }

    private func complete(_ result: Bool) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: result)
    }
}
#endif
