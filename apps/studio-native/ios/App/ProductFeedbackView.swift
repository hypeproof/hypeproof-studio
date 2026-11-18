import SwiftUI

@MainActor private final class ProductFeedbackPresentation: ObservableObject {
    let controller: ProductFeedbackController
    init(scope: String) {
        var directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("product-feedback", isDirectory: true)
#if DEBUG
        if NativeJourneyFixture.enabled {
            directory = directory.appendingPathComponent(NativeJourneyFixture.namespace, isDirectory: true)
        }
#endif
        let key = Data(scope.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
        let file = directory.appendingPathComponent(key + ".json")
        controller = ProductFeedbackController(load: {
            guard FileManager.default.fileExists(atPath: file.path) else { return ProductFeedback() }
            return try JSONDecoder().decode(ProductFeedback.self, from: Data(contentsOf: file))
        }, save: { value in
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var folder = directory; var attributes = URLResourceValues(); attributes.isExcludedFromBackup = true
            try folder.setResourceValues(attributes)
            try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }, send: { request in
#if DEBUG
            if NativeJourneyFixture.enabled {
                NativeJourneyFixture.feedbackRequests += 1
                if ProcessInfo.processInfo.environment["HP_FEEDBACK_RESULT"] == "uncertain" {
                    throw URLError(.timedOut)
                }
                return (Data(#"{"report_id":"synthetic-feedback-4337"}"#.utf8), 200)
            }
#endif
            // Isolated anonymous support request: no account cookies or bearer token.
            let config = URLSessionConfiguration.ephemeral
            config.httpShouldSetCookies = false; config.httpCookieStorage = nil
            config.urlCredentialStorage = nil; config.timeoutIntervalForResource = 25
            let session = URLSession(configuration: config, delegate: FeedbackRedirectGuard(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        })
        controller.changed = { [weak self] in self?.objectWillChange.send() }
    }
}

private final class FeedbackRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor struct ProductFeedbackView: View {
    @StateObject private var model: ProductFeedbackPresentation
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSend = false
    @State private var confirmClear = false
    @State private var confirmClose = false
    init(scope: String) { _model = StateObject(wrappedValue: ProductFeedbackPresentation(scope: scope)) }
    private var controller: ProductFeedbackController { model.controller }
    private var version: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown") + " (" +
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown") + ")"
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("불편한 점이나 바라는 점을 적어 주세요. 로그인 없이도 운영팀에 보낼 수 있어요.")
                    TextEditor(text: Binding(get: { controller.value.text }, set: {
                        controller.edit(text: $0, contact: controller.value.contact)
                    })).frame(minHeight: 130).accessibilityLabel("의견 내용").accessibilityIdentifier("feedbackText")
                        .disabled(controller.busy || controller.readOnly || controller.value.phase != .draft)
                    TextField("답을 받을 연락처 (선택)", text: Binding(get: { controller.value.contact }, set: {
                        controller.edit(text: controller.value.text, contact: $0)
                    })).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("feedbackContact")
                        .disabled(controller.busy || controller.readOnly || controller.value.phase != .draft)
                } footer: {
                    Text("의견은 5,000단위, 연락처는 200단위까지 입력할 수 있어요. 한글·영문은 보통 1단위이며 이모지는 여러 단위로 계산돼요. 현재 의견 \(controller.value.text.utf16.count)/5,000 · 연락처 \(controller.value.contact.utf16.count)/200. 작성 중인 의견은 이 기기에 저장돼요. 로그인 전 기록과 계정별 기록은 따로 보관해요.")
                }
#if DEBUG
                if NativeJourneyFixture.enabled {
                    Text("Synthetic requests: \(NativeJourneyFixture.feedbackRequests)")
                        .accessibilityIdentifier("feedbackRequestCount")
                }
#endif
                Section("함께 보내는 정보") {
                    Text("앱 버전: \(version)")
                    Text("운영체제: iOS \(UIDevice.current.systemVersion)")
                    Text("내가 적은 내용과 연락처, 위 앱 정보만 운영팀에 보내요. 대화·음성·계정 정보는 첨부하지 않아요.")
                    Text("받는 곳: Studio 운영팀 · api.hypeproof-ai.xyz")
                }
                Section {
                    if controller.busy {
                        ProgressView("접수 확인 중…").accessibilityIdentifier("feedbackSending")
                    } else if controller.value.phase == .received {
                        Text("운영팀에 접수됐어요.")
                        Text("접수 번호: \(controller.value.receipt ?? "")").textSelection(.enabled)
                            .accessibilityIdentifier("feedbackReceipt")
                        Text("GitHub 이슈 생성이나 수정 완료를 뜻하지는 않아요.")
                    } else if controller.value.phase == .uncertain {
                        Text("접수 여부 확인 필요").font(.headline)
                        Text("운영팀에 도착했을 수도 있어요. 다시 보내기 전에 확인해 주세요. 앱을 다시 열어도 자동 전송하지 않아요.")
                    }
                    if let error = controller.error { Text(error).foregroundStyle(.red).accessibilityIdentifier("feedbackError") }
                    if controller.value.phase == .draft {
                        Button("운영팀에 보내기") { confirmSend = true }
                            .frame(minHeight: 44).accessibilityIdentifier("feedbackSend")
                            .disabled(controller.busy || controller.readOnly || controller.value.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    ShareLink(item: controller.value.text + "\n" + controller.value.contact + "\n" + (controller.value.receipt ?? "")) {
                        Label("내용과 접수 번호 내보내기", systemImage: "square.and.arrow.up")
                    }
                    Button("이 기기의 의견 지우기", role: .destructive) { confirmClear = true }
                        .disabled(controller.busy || controller.readOnly)
                }
            }.navigationTitle("의견·문제 보내기").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("닫기") {
                    if controller.error != nil { confirmClose = true } else { dismiss() }
                }.disabled(controller.busy).accessibilityIdentifier("feedbackClose") }
        }
        .interactiveDismissDisabled(controller.busy || controller.error != nil)
        .alert("작성한 내용과 표시된 앱 정보를 운영팀에 보낼까요?", isPresented: $confirmSend) {
            Button("보내기") { Task { await controller.submit(version: version, os: "iOS " + UIDevice.current.systemVersion) } }
            Button("취소", role: .cancel) {}
        }
        .confirmationDialog("기기의 기록만 지워요. 이미 보낸 의견은 취소되지 않아요. 접수 여부가 불확실하면 새 의견이 중복될 수 있어요.", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("기기 기록 지우기", role: .destructive) { controller.clear() }
        }
        .confirmationDialog("저장하지 못한 내용이나 접수 번호가 있다면 먼저 내보내 주세요.", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("닫기", role: .destructive) { dismiss() }
        }
    }
}
