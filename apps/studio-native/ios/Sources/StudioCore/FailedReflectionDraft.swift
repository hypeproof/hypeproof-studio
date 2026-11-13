import Foundation

extension ConversationCache {
    /// A recorded failure is terminal. An uncertain/local request must retain
    /// its existing identity instead of being copied into a new send.
    public var canRestoreFailedReflectionDraft: Bool {
        guard draft.isEmpty, let request, request.status == "failed" else { return false }
        return (try? SharedRequest.checkedText(request.text)) != nil
    }

    /// Restore only into an empty effective draft. Keep the failed request and
    /// transcript unchanged; enqueue creates a fresh ID only after explicit Send.
    @discardableResult
    public mutating func restoreFailedReflectionDraft() -> Bool {
        guard canRestoreFailedReflectionDraft, let request else { return false }
        draft = request.text
        return true
    }
}
