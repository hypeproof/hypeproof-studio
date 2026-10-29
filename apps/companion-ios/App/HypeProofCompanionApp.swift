import SwiftUI
import SafariServices

@MainActor
final class SignInModel: ObservableObject {
    @Published var challenge: ApprovalChallenge?
    @Published var status = "컴퓨터에서 작업 공간을 먼저 준비해 주세요."
    @Published var busy = false
    @Published var account: String?
    private let client = DeviceSignIn(transport: DeviceHTTP())
    private var session: AccountSession?
    private var task: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var generation = UUID()

    func start() {
        cancel()
        let attempt = generation
        busy = true; status = "로그인 코드를 준비하고 있어요."
        task = Task {
            do {
                let verified = try await client.run { [weak self] approval in
                    await self?.show(approval, attempt: attempt)
                }
                guard generation == attempt, !Task.isCancelled else { await client.logout(verified); return }
                session = verified; account = verified.accountID; challenge = nil; busy = false
                status = "계정을 확인했어요. 컴퓨터 연결은 아직 준비 중이에요."
                expiryTask?.cancel()
                expiryTask = Task {
                    do { try await client.waitUntilExpiry(verified) } catch { return }
                    guard !Task.isCancelled, generation == attempt else { return }
                    logout(); status = "로그인 시간이 끝났어요. 다시 로그인해 주세요."
                }
            } catch {
                guard generation == attempt else { return }
                challenge = nil; busy = false
                status = error is CancellationError ? "로그인을 취소했어요." : "로그인을 완료하지 못했어요. 새 코드로 다시 시도해 주세요."
            }
        }
    }
    private func show(_ approval: ApprovalChallenge, attempt: UUID) {
        guard generation == attempt else { return }
        challenge = approval; status = "브라우저에서 아래 코드를 확인하고 승인해 주세요."
    }
    func cancel() {
        generation = UUID(); task?.cancel(); task = nil; challenge = nil; busy = false
        status = "로그인을 취소했어요."
    }
    func logout() {
        cancel()
        expiryTask?.cancel(); expiryTask = nil
        let previous = session; session = nil; account = nil
        status = "이 기기에서 로그아웃했어요."
        if let previous { Task { await client.logout(previous) } }
    }
    func resume() {
        if let session, client.isExpired(session) {
            logout(); status = "로그인 시간이 끝났어요. 다시 로그인해 주세요."
        }
    }
}

struct ApprovalBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

struct CompanionHome: View {
    @StateObject private var model = SignInModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var browser = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image(systemName: "desktopcomputer").font(.largeTitle).accessibilityHidden(true)
                    Text("컴퓨터 작업을 이어갈 준비").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                    Text("작업 원본과 실행은 컴퓨터에 있어요. 이 앱에서 계정을 확인한 뒤 컴퓨터 연결을 준비해요.")
                    Text(model.status).accessibilityIdentifier("signInStatus")
                    if let approval = model.challenge {
                        Text(approval.code).font(.title.monospaced().bold()).textSelection(.enabled).accessibilityLabel("로그인 코드 " + approval.code)
                        Button("브라우저에서 코드 승인") { browser = true }.buttonStyle(.borderedProminent)
                        Text("hypeproof-ai.xyz에서 같은 코드인지 확인해 주세요. 앱으로 돌아오면 계정을 확인해요.").font(.callout)
                    }
                    if model.account != nil {
                        Label("계정 확인됨 · 컴퓨터 미연결", systemImage: "person.crop.circle.badge.checkmark")
                        Button("로그아웃") { model.logout() }.buttonStyle(.bordered)
                    } else if model.busy {
                        ProgressView().accessibilityLabel("로그인 승인 대기")
                        Button("로그인 취소") { model.cancel() }.buttonStyle(.bordered)
                    } else {
                        Button("계정으로 로그인") { model.start() }.buttonStyle(.borderedProminent).accessibilityIdentifier("signInButton")
                    }
                    Text("현재는 계정 로그인만 준비되어 있어요. 작업 실행·사진·마이크 권한은 사용하지 않아요.").font(.footnote).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 600, alignment: .leading).frame(maxWidth: .infinity)
            }.navigationTitle("HypeProof")
        }
        .sheet(isPresented: $browser) { if let approval = model.challenge { ApprovalBrowser(url: approval.url) } }
        .onChange(of: model.challenge == nil) { empty in if empty { browser = false } }
        .onChange(of: scenePhase) { phase in if phase == .active { model.resume() } }
    }
}

@main
struct HypeProofCompanionApp: App { var body: some Scene { WindowGroup { CompanionHome() } } }
