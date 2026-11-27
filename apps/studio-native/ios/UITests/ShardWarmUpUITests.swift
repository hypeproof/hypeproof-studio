import XCTest

/// Runs first in every iOS UI shard and in the dedicated voice job (#4432). ios-ui-shards.py puts it at the
/// front of each `-only-testing` row and never skips it in the catch-all row; xcodebuild runs test classes in
/// name order, and this class name sorts first.
///
/// Why: the first case of a shard runs at the most loaded moment after boot. Four first cases failed there.
/// In runs 45828625133 and 45842954516, typed characters arrived 0.5-1 s after typeText returned. In runs
/// 45780219172 and 45853481934, the app signed in, but the sign-in opening was exposed only after its 5 s
/// wait. In the same shards, the tap-to-type gap was 4.9-12 s for the first case and 1.1-1.8 s for later cases.
///
/// What: Settings first. This case warms the system keyboard and the accessibility path, and records how long
/// each step took. Then it launches the app under test once and leaves it in the background (P4, approved by
/// chalk-po 2026-11-27): the first product case's first launch took a median 13.2 s on main against 8.1 s for
/// later cases, up to 87 s. The app runs the `first-answer` journey fixture in its own `warmup…` namespace and
/// nothing is tapped, so no account, draft, conversation or permission state reaches a product case: those
/// are keyed by each launch's own namespace. The first product case's launch terminates this instance, as every
/// later case's launch terminates the one before it. The app launch time is recorded, not judged: this case
/// does not measure the product's first-run performance.
///
/// Rules: this is environment preparation, like poster-wait. It never fails and never skips. Each step ends
/// on a measured state, not a fixed sleep, and the whole case is bounded by `limit`. If a step does not reach
/// its state, the case stops, records `settled: false` in the "shard-warm-up" attachment and one log activity,
/// and passes. It is not a gate or nightly case.
final class ShardWarmUpUITests: XCTestCase {
    static let limit: TimeInterval = 60
    static let text = "warm up keyboard"
    /// Two accessibility snapshots in a row, each under this, count as a settled accessibility path.
    /// At the failed sign-in in run 45780219172, one snapshot took 2.9 s.
    static let settledSnapshot: TimeInterval = 0.5
    /// A scenario on the fixture's list (NativeJourneyFixture `JourneyConfiguration`). Any other value turns the
    /// fixture off, and the app would start against the real server and the real Keychain.
    static let appScenario = "first-answer"

    @MainActor func testWarmUpSystemKeyboardAndAccessibility() {
        let start = Date()
        var steps: [[String: Any]] = []
        var stoppedAt: String?
        func left() -> TimeInterval { max(0, Self.limit - Date().timeIntervalSince(start)) }
        func rounded(_ seconds: TimeInterval) -> Double { (seconds * 1000).rounded() / 1000 }
        /// Runs one step while time is left and records its time and whether it reached its state.
        func step(_ name: String, _ detail: inout [String: Any], _ body: (inout [String: Any]) -> Bool) {
            guard stoppedAt == nil else { return }
            let began = Date()
            let reached = left() > 0 && body(&detail)
            var row = detail; row["step"] = name; row["seconds"] = rounded(Date().timeIntervalSince(began)); row["reached"] = reached
            steps.append(row)
            if !reached { stoppedAt = name }
        }
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        var none: [String: Any] = [:]
        step("launch", &none) { _ in
            settings.launch()
            return settings.wait(for: .runningForeground, timeout: left())
        }
        var ax: [String: Any] = [:]
        step("accessibility", &ax) { detail in
            var durations: [Double] = []
            var quick = 0
            while quick < 2, left() > 0 {
                let began = Date()
                let ok = (try? settings.snapshot()) != nil
                let seconds = Date().timeIntervalSince(began)
                durations.append(rounded(seconds))
                quick = ok && seconds < Self.settledSnapshot ? quick + 1 : 0
            }
            detail["snapshot_seconds"] = durations
            return quick == 2
        }
        let search = settings.searchFields.firstMatch
        var keyboard: [String: Any] = [:]
        step("keyboard", &keyboard) { detail in
            guard search.waitForExistence(timeout: left()) else { detail["missing"] = "search field"; return false }
            guard search.isHittable else { detail["missing"] = "hittable search field"; return false }
            search.tap()
            return settings.keyboards.firstMatch.waitForExistence(timeout: left())
        }
        var typing: [String: Any] = [:]
        step("typing", &typing) { detail in
            search.typeText(Self.text)
            let returned = Date()
            // The quantity that failed in runs 45828625133 and 45842954516: when the typed text arrives
            // after typeText returns.
            let arrived = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", Self.text), object: search)
            let result = XCTWaiter().wait(for: [arrived], timeout: max(0.1, left()))
            detail["arrival_after_return_seconds"] = rounded(Date().timeIntervalSince(returned))
            if result != .completed { detail["value"] = search.value as? String ?? "not a string" }
            return result == .completed
        }
        // The app under test, once, in its own namespace (P4). Launch only: nothing is tapped.
        let app = studioApp()
        app.launchArguments = ["--native-journey"]
        app.launchEnvironment["HP_NATIVE_JOURNEY"] = Self.appScenario
        app.launchEnvironment["HP_NATIVE_JOURNEY_ID"] = "warmup" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        var appLaunch: [String: Any] = ["scenario": Self.appScenario]
        step("app-launch", &appLaunch) { _ in
            // Environment preparation never fails: an issue XCTest records while launching (for example
            // "Failed to get launch progress") is recorded as an expected failure of this case, not of a product case.
            let options = XCTExpectedFailure.Options(); options.isStrict = false
            return XCTExpectFailure("The warm-up launch is environment preparation (#4432 P4).", options: options) {
                app.launch()
                return app.wait(for: .runningForeground, timeout: left())
            }
        }
        // Home instead of terminate: under load "Failed to terminate" is itself a test failure (#4432 F6).
        // The app under test comes to the front at its own launch, which terminates this instance.
        XCUIDevice.shared.press(.home)
        let total = rounded(Date().timeIntervalSince(start))
        let settled = stoppedAt == nil
        let record: [String: Any] = ["schema": "hps-ios-shard-warm-up/1", "settled": settled, "seconds": total,
                                     "limit_seconds": Self.limit, "stopped_at": stoppedAt ?? NSNull(), "steps": steps]
        let data = (try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])) ?? Data("{}".utf8)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "shard-warm-up"; attachment.lifetime = .keepAlways; add(attachment)
        let appSeconds = steps.first { $0["step"] as? String == "app-launch" }?["seconds"].map { "\($0)" } ?? "not run"
        let line = (settled ? "HPStudio warm-up: settled in \(total) s"
            : "HPStudio warm-up: not settled after \(total) s at \(stoppedAt ?? "?")") + "; app launch \(appSeconds) s"
        XCTContext.runActivity(named: line) { _ in }
    }
}
