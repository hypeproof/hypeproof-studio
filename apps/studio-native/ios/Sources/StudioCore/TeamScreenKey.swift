/// The value inputs of one pushed team screen (#4432 F11-destination).
///
/// Run 45200802507: the request detail's destination wrapper re-ran 1205 times while the detail ran twice, and each
/// pass built a new text screen with a new `make:` closure, so SwiftUI judged the screen changed ("@self") and ran
/// its body again, 1:1 with the wrapper. A screen that is Equatable on this key is re-run only by its own state,
/// its observed objects or its environment, not by a wrapper pass with the same inputs.
///
/// The fields are the inputs the screen is built from: the shared request model, the request, the product and
/// the target, and for a screen built from an existing model, that model (`source`). Objects are compared by
/// identity. A key belongs to a live screen, whose objects stay alive while it is shown.
public struct TeamScreenKey: Sendable, Equatable {
    public let requests: ObjectIdentifier?
    public let requestID: String
    public let product: String
    public let target: String
    public let source: ObjectIdentifier?
    public init(requests: AnyObject? = nil, requestID: String = "", product: String = "", target: String = "", source: AnyObject? = nil) {
        self.requests = requests.map(ObjectIdentifier.init)
        self.requestID = requestID
        self.product = product
        self.target = target
        self.source = source.map(ObjectIdentifier.init)
    }
    public static func == (a: Self, b: Self) -> Bool {
        a.requests == b.requests && a.requestID == b.requestID && a.product == b.product && a.target == b.target && a.source == b.source
    }
}
