// Compile with -D DEBUG and ios/App/LiveKitEvaluationPermission.swift; run the resulting executable.
import Foundation

@main
struct PermissionProbe {
    @MainActor
    static func main() async {
        var submissions = 0
        let cancelledBeforeSubmission = Task {
            await LiveKitEvaluationPermission.request { reply in
                submissions += 1
                reply(true)
            }
        }
        cancelledBeforeSubmission.cancel()
        let before = await cancelledBeforeSubmission.value
        precondition(!before && submissions == 0, "Cancelled evaluation must not request microphone access")

        var osReply: (@Sendable (Bool) -> Void)?
        let waitingForOS = Task {
            await LiveKitEvaluationPermission.request { reply in osReply = reply }
        }
        for _ in 0..<1000 {
            if osReply != nil { break }
            await Task.yield()
        }
        precondition(osReply != nil, "Permission request must reach the controlled OS boundary")
        waitingForOS.cancel()
        let after = await waitingForOS.value
        precondition(!after, "Stop must finish without an OS permission reply")
        osReply?(true)
        osReply?(false)
        let afterLateGrant = await waitingForOS.value
        precondition(!afterLateGrant, "A late OS grant cannot revive the cancelled evaluation")

        let allowed = await LiveKitEvaluationPermission.request { reply in reply(true); reply(false) }
        precondition(allowed, "The first real grant wins; duplicate callbacks do not resume twice")
        let denied = await LiveKitEvaluationPermission.request { reply in reply(false); reply(true) }
        precondition(!denied, "The first denial wins; duplicate grants cannot reverse it")
        print("PASS permission cancellation and late callback controls (pure Foundation; no iOS/SDK claim)")
    }
}
