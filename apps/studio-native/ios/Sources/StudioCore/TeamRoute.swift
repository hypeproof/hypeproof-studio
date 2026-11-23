/// One value-based navigation stack for the team screens (#4432 F11-D).
///
/// Main runs 45200802507 and 45225111226 re-ran a pushed team screen's wrapper hundreds of times with only a
/// few passes of the detail that built it: the stack re-evaluated `navigationDestination(isPresented:)` content
/// on its own, and the screens' per-init StateObject closures made every re-evaluation "changed". Each push is
/// now a `TeamStep` value in one path, and each screen's presentation is kept per step by `TeamStepStore`.
public enum TeamRoute: Hashable, Sendable {
    case detail(request: String)
    case workflow(request: String, product: String)
    case outcome(request: String)
    case delivery(request: String)
    case github(request: String)
    case subscription(request: String, product: String)
    case intake(request: String, product: String)
    case text(request: String, target: String, product: String)
    case relations(request: String, product: String)
    /// The GitHub status records of the GitHub screen directly below this step.
    case observations
    /// The GitHub screen of the intake screen directly below this step.
    case intakeGitHub

    /// Counter and log name.
    public var kind: String {
        switch self {
        case .detail: return "detail"
        case .workflow: return "workflow"
        case .outcome: return "outcome"
        case .delivery: return "delivery"
        case .github: return "github"
        case .subscription: return "subscription"
        case .intake: return "intake"
        case .text: return "text"
        case .relations: return "relations"
        case .observations: return "observations"
        case .intakeGitHub: return "intakeGitHub"
        }
    }
}

/// One pushed screen. `id` is unique in its path, so the same route pushed twice (detail → related →
/// the same detail) gets its own step and its own presentation.
public struct TeamStep: Hashable, Sendable, Identifiable {
    public let id: Int
    public let route: TeamRoute
    public init(id: Int, route: TeamRoute) { self.id = id; self.route = route }
}

/// The steps of one stack. Ids are never reused within a path value.
public struct TeamPath: Equatable, Sendable {
    public private(set) var steps: [TeamStep] = []
    private var nextID = 1
    public init() {}
    @discardableResult
    public mutating func push(_ route: TeamRoute) -> TeamStep {
        let step = TeamStep(id: nextID, route: route)
        nextID += 1; steps.append(step)
        return step
    }
    /// Pushes `route` only while `screen` is the top step, so a late tap or async result of a covered screen
    /// pushes nothing. `nil` is the stack's root list, which pushes unconditionally.
    @discardableResult
    public mutating func push(_ route: TeamRoute, above screen: TeamStep?) -> TeamStep? {
        if let screen, steps.last != screen { return nil }
        return push(route)
    }
    /// Removes `step` and everything above it. A step that is no longer in the path changes nothing.
    public mutating func pop(_ step: TeamStep) {
        guard let index = steps.firstIndex(of: step) else { return }
        steps.removeSubrange(index...)
    }
    /// Replaces the whole path with new steps for `routes` (a notification opening a request).
    public mutating func reset(_ routes: [TeamRoute]) {
        steps = []; routes.forEach { push($0) }
    }
    /// Accepts the stack's own change (system back, swipe). Only a prefix of the current steps can come back;
    /// anything else is ignored, so a step is never created outside `push`.
    public mutating func accept(_ new: [TeamStep]) {
        guard new.count <= steps.count, Array(steps.prefix(new.count)) == new else { return }
        steps = new
    }
    /// The step directly below `step`, if both are in the path.
    public func parent(of step: TeamStep) -> TeamStep? {
        guard let index = steps.firstIndex(of: step), index > 0 else { return nil }
        return steps[index - 1]
    }
}

/// Presentation objects per step. A value lives while its step is in the path: `retain(_:)` drops the others,
/// so a popped and re-pushed screen gets a new value, as a new StateObject did.
public struct TeamStepStore<Value> {
    public private(set) var values: [Int: Value] = [:]
    public init() {}
    /// The value of `step`, made by `make` on first use. `created` tells which happened (for counters).
    public mutating func value(for step: TeamStep, make: () -> Value) -> (value: Value, created: Bool) {
        if let value = values[step.id] { return (value, false) }
        let value = make(); values[step.id] = value
        return (value, true)
    }
    public func existing(_ step: TeamStep) -> Value? { values[step.id] }
    /// Keeps only the values of `steps`.
    public mutating func retain(_ steps: [TeamStep]) {
        let live = Set(steps.map(\.id))
        values = values.filter { live.contains($0.key) }
    }
}
