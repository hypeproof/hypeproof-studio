import SwiftUI
import UserNotifications
import UIKit

@MainActor final class NativePushCenter: ObservableObject {
    static let shared = NativePushCenter()
    private var generation = UUID(), accepting = false
    @Published private(set) var token: String?
    @Published private(set) var reference: AccountPushReference?
    @Published private(set) var registrationFailed = false
    static var configured: Bool { (Bundle.main.object(forInfoDictionaryKey: "HPSPushConfigured") as? Bool == true) || (Bundle.main.object(forInfoDictionaryKey: "HPSPushConfigured") as? String == "YES") }
    func registered(_ data: Data) {
        let g = generation
        guard accepting else { return }
        Task { let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard generation == g, accepting, Self.configured, settings.authorizationStatus == .authorized else { return }
            registrationFailed = false; token = data.map { String(format: "%02x", $0) }.joined()
        }
    }
    func failed() { guard accepting else { return }; token = nil; registrationFailed = true }
    func received(_ value: [AnyHashable: Any]) { guard let raw = value["hps"] as? [String: Any], let parsed = try? AccountPushReference(raw), !parsed.withdraw else { return }; reference = parsed }
    /// Takes delivered approval alerts off the lock screen once their card no longer waits for this person:
    /// on a silent Service withdrawal and after every inbox refresh (Apple may drop background pushes).
    func clearSettled(_ settled: Set<String>) async {
        guard !settled.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications().map { (identifier: $0.request.identifier, userInfo: $0.request.content.userInfo) }
        let stale = AccountPushAlerts.stale(delivered, settled: settled)
        if !stale.isEmpty { center.removeDeliveredNotifications(withIdentifiers: stale) }
    }
    func consume() { reference = nil }
    func stop() { generation = UUID(); accepting = false; token = nil; reference = nil; UIApplication.shared.unregisterForRemoteNotifications() }
    func permits(_ value: String) async -> Bool {
        let g = generation
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard generation == g, accepting, token == value, Self.configured else { return false }
        guard settings.authorizationStatus == .authorized else { token = nil; accepting = false; return false }
        return true
    }
    func register() async {
        guard Self.configured else { return }
        let g = generation; accepting = true
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard generation == g, accepting else { return }
        guard settings.authorizationStatus == .authorized else { token = nil; accepting = false; return }
        UIApplication.shared.registerForRemoteNotifications()
    }
}
final class NativePushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { UNUserNotificationCenter.current().delegate = self; return true }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) { Task { @MainActor in NativePushCenter.shared.registered(deviceToken) } }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { Task { @MainActor in NativePushCenter.shared.failed() } }
    // Silent approval withdrawal (#522): only removes this app's own delivered alert; never opens or answers anything.
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard let raw = userInfo["hps"] as? [String: Any], let reference = try? AccountPushReference(raw), reference.withdraw else { completionHandler(.noData); return }
        let card = reference.id
        Task { @MainActor in await NativePushCenter.shared.clearSettled([card]); completionHandler(.newData) }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let value = response.notification.request.content.userInfo
        Task { @MainActor in NativePushCenter.shared.received(value); completionHandler() }
    }
    // No extra foreground notification or automatic opening while the person is working.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([]) }
}
@MainActor final class AccountPushPresentation: ObservableObject {
    @Published var state = AccountPushController.View()
    var controller: AccountPushController?
    /// The one explicit opt-in path, shared by the notification setting and the approval inbox prompt.
    func enable() async {
        guard controller?.enable() == true else { return }
        guard let ticket = controller?.permissionTicket else { return }
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard controller?.acceptsPermission(ticket) == true else { return }
            if granted { await NativePushCenter.shared.register() }
            else { await controller?.disable(); controller?.unavailable("알림을 허용하지 않았어요. 대화와 질문은 그대로 사용할 수 있어요.") }
        } catch { if controller?.acceptsPermission(ticket) == true { controller?.unavailable("시스템 알림 권한을 확인하지 못했어요.") } }
    }
}
struct AccountPushView: View {
    @ObservedObject var model: AccountPushPresentation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { VStack(alignment: .leading, spacing: 18) {
                Text("새 질문과 확인 요청이 오면 알려드려요. 알림을 열어도 답변이나 승인은 자동으로 전송되지 않아요.")
                Text(NativePushCenter.configured ? model.state.status : "이 버전은 알림 연결이 아직 준비되지 않았어요. 질문과 확인 요청에서 직접 확인할 수 있어요.").foregroundStyle(.secondary).accessibilityIdentifier("pushStatus")
                Button { Task { await model.enable() } } label: { Text("알림 켜기").frame(minHeight: 44) }.buttonStyle(.borderedProminent).disabled(!NativePushCenter.configured || model.state.busy).accessibilityIdentifier("enableAccountPush")
                Button { NativePushCenter.shared.stop(); Task { await model.controller?.disable() } } label: { Text("알림 끄기").frame(minHeight: 44) }.buttonStyle(.bordered).accessibilityIdentifier("disableAccountPush")
            }.padding(24) }.navigationTitle("질문 알림").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
        }
    }
}
