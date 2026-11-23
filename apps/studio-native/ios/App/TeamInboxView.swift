import SwiftUI

@MainActor final class TeamInboxPresentation: ObservableObject {
    @Published var state = TeamInboxController.View()
    var controller: TeamInboxController?
}
struct TeamSubscriptionControls: View {
    @ObservedObject var model: TeamInboxPresentation
    let product: String
    let request: String?
    @State private var confirmation: Bool?
    @State private var showConfirmation = false
    private var pendingDescription: String {
        guard let pending = model.state.pending else { return "저장 중이던 설정" }
        return "\(pending.product.capitalized) \(pending.requestID.map { "요청 " + $0 } ?? "제품 전체") 알림 \(pending.enabled ? "받기" : "끄기")"
    }
    private var blocked: Bool { model.state.busy || !model.state.storageReady || !model.state.subscriptionsCurrent || model.state.pending?.phase == .uncertain }
    var body: some View {
        Text(model.controller?.effectiveEnabled(product: product, request: request) == true ? "알림 받는 중" : "알림 꺼짐").accessibilityIdentifier("teamSubscriptionState")
        if request != nil, model.controller?.preference(product: product, request: request) == nil { Text("현재 제품 알림 설정을 따르고 있어요.").font(.caption) }
        Button("알림 받기") { confirmation = true; showConfirmation = true }.disabled(blocked).accessibilityIdentifier("teamSubscribe")
        Button("알림 끄기") { confirmation = false; showConfirmation = true }.disabled(blocked).accessibilityIdentifier("teamUnsubscribe")
        if model.state.pending?.phase == .uncertain {
            Button("저장 중이던 설정 다시 확인") { confirmation = nil; showConfirmation = true }.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamSubscriptionRecover")
            Text("\(pendingDescription): 저장 여부를 먼저 확인해 주세요. 자동으로 다시 보내지 않아요.").font(.caption)
        }
        Text(request == nil ? "켜진 뒤 새로 생긴 알림부터 받아요. 요청별 알림 끄기가 우선해요." : "이 요청의 설정이 제품 설정보다 우선해요.").font(.caption)
            .alert("알림 설정을 저장할까요?", isPresented: $showConfirmation) {
                Button("취소", role: .cancel) {}
                Button("저장") { Task { if let confirmation { await model.controller?.change(product: product, request: request, enabled: confirmation) } else { await model.controller?.recover() } } }
            } message: { Text(confirmation == nil ? "\(pendingDescription): 이전 번호와 내용으로 확인해요." : "시스템 알림 허용과 별개로 앱 안의 팀 알림함에 적용돼요.") }
    }
}
struct TeamSubscriptionScreen: View {
    @ObservedObject var model: TeamInboxPresentation
    let product: String
    let request: String
    var body: some View {
        let _ = teamRenderCount("body.subscription")
        List {
            if !model.state.message.isEmpty { Text(model.state.message) }
            TeamSubscriptionControls(model: model, product: product, request: request)
        }.navigationTitle("이 요청의 알림").task { await model.controller?.open() }
            .toolbar { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy) }
    }
}
struct TeamInboxView: View {
    @ObservedObject var model: TeamInboxPresentation
    @ObservedObject var requests: TeamRequestPresentation
    @Environment(\.dismiss) private var dismiss
    @State private var product = "studio"
    @State private var path: [String] = []
    @State private var initialRequestConsumed = false
    let initialRequest: String?
    init(model: TeamInboxPresentation, requests: TeamRequestPresentation, initialRequest: String? = nil) { self.model = model; self.requests = requests; self.initialRequest = initialRequest }
    private func title(_ item: TeamInboxItem) -> String {
        switch item.label {
        case "build_linked": return "확인할 새 빌드가 연결됐어요"
        case "reporter_response": return item.action == "resolved" ? "작성자가 해결됐다고 확인했어요" : "작성자가 문제가 남았다고 알려왔어요"
        case "question_posted": return "새 질문이 올라왔어요"
        case "reply_posted": return "새 답글이 올라왔어요"
        default: return "새 논의가 올라왔어요"
        }
    }
    var body: some View {
        NavigationStack(path: $path) {
            List {
#if DEBUG
                if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic inbox trace").accessibilityIdentifier("teamInboxTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
                Text("시스템 알림을 꺼도 여기에서 새 소식을 확인할 수 있어요.").font(.caption)
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamInboxMessage") }
                if !model.state.products.isEmpty {
                    Section("제품 알림") {
                        Picker("제품", selection: $product) { ForEach(model.state.products, id: \.self) { Text($0.capitalized).tag($0) } }
                        TeamSubscriptionControls(model: model, product: product, request: nil)
                    }
                }
                Section("팀 알림") {
                    if model.state.page != nil, model.state.items.isEmpty { Text("새 알림이 없어요.").accessibilityIdentifier("teamInboxEmpty") }
                    ForEach(model.state.items) { item in
                        Button { Task { if let request = await model.controller?.openItem(item) { path.append(request) } } } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(title(item)).font(.headline)
                                if let version = item.version, let build = item.build { Text("버전 \(version) · 빌드 \(build)") }
                                Text(item.read_at == nil ? "읽지 않음" : "읽음").font(.caption)
                                Text(Date(timeIntervalSince1970: item.created_at / 1000).formatted()).font(.caption).foregroundStyle(.secondary)
                            }
                        }.disabled(model.state.busy).accessibilityIdentifier("teamInboxItem\(item.sequence)")
                    }
                    if model.state.items.count >= 500 { Text("한 번에 500개까지 표시해요. 새로고침해 최신 상태를 확인해 주세요.").font(.caption) }
                    else if model.state.page?.next_cursor != nil || model.state.page?.catchup_pending == true {
                        Button("알림 더 확인하기") { Task { await model.controller?.more() } }.disabled(model.state.busy).accessibilityIdentifier("teamInboxMore")
                    }
                }
            }.navigationTitle("팀 알림함")
                .navigationDestination(for: String.self) { TeamRequestDetailView(model: requests, requestID: $0) }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
                    ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy) }
                }
                .task {
                    await model.controller?.open()
                    if !model.state.products.contains(product), let first = model.state.products.first { product = first }
                    if !initialRequestConsumed, let initialRequest, !model.state.products.isEmpty {
                        initialRequestConsumed = true; path = [initialRequest]
                    }
                }
        }
    }
}
