import SwiftUI

@MainActor final class TeamOutcomePresentation: ObservableObject {
    @Published var state = TeamOutcomeController.View()
    var controller: TeamOutcomeController?
}
struct TeamOutcomeView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TeamOutcomePresentation
    @State private var confirmSend = false
    @State private var confirmLeave = false
    init(model: TeamOutcomePresentation) { _model = StateObject(wrappedValue: model) }
    private var editable: Bool { model.state.page?.can_respond == true && !model.state.busy && model.state.storageReady && model.state.draft?.phase == .draft }
    private func event(_ item: TeamOutcomeEvent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.action == "resolved" ? "해결됐어요" : "아직 문제가 있어요").font(.headline)
            Text("버전 \(item.version) · 빌드 \(item.build)")
            if let result = item.result { Text(result).textSelection(.enabled) }
            Text("작성자가 남긴 결과 · \(Date(timeIntervalSince1970: item.created_at / 1000).formatted())").font(.caption).foregroundStyle(.secondary)
        }.accessibilityIdentifier("teamOutcomeHistory\(item.revision)")
    }
    var body: some View {
        List {
#if DEBUG
            if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic outcome trace").font(.caption2).accessibilityIdentifier("teamOutcomeTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamOutcomeMessage") }
            if let page = model.state.page {
                if let current = page.current { Section("최근 확인 결과") { event(current) } }
                if !page.can_respond { Text("이 요청을 작성한 멤버만 해결 여부를 남길 수 있어요.").accessibilityIdentifier("teamOutcomeReadOnly") }
                if let draft = model.state.draft, page.can_respond {
                    Section {
                        Button("해결됐어요") { model.controller?.edit(action: "resolved") }.disabled(!editable).accessibilityIdentifier("teamOutcomeResolved")
                        Button("아직 문제가 있어요") { model.controller?.edit(action: "reopened") }.disabled(!editable).accessibilityIdentifier("teamOutcomeReopened")
                        Text(draft.action == "resolved" ? "선택: 해결됐어요" : draft.action == "reopened" ? "선택: 아직 문제가 있어요" : "직접 확인한 결과를 선택해 주세요.").font(.caption)
                        if let targets = model.controller?.eligibleTargets(for: draft.action), targets.count > 1 {
                            ForEach(targets, id: \.deliveryID) { target in
                                Button("버전 \(target.version) · 빌드 \(target.build) 선택") { model.controller?.chooseBuild(target) }.disabled(!editable)
                            }
                        }
                        if let target = draft.target { Text("확인할 버전 \(target.version) · 빌드 \(target.build)").accessibilityIdentifier("teamOutcomeBuild") }
                        else { Text("결과와 연결할 배포 버전을 아직 확인하지 못했어요.") }
                        TextEditor(text: Binding(get: { model.state.draft?.result ?? "" }, set: { model.controller?.edit(result: $0) }))
                            .frame(minHeight: 100).disabled(!editable).accessibilityLabel("확인 결과 설명").accessibilityIdentifier("teamOutcomeResult")
                        Text(draft.action == "reopened" ? "아직 남은 문제를 적어 주세요. (필수)" : "확인한 내용을 덧붙일 수 있어요. (선택)").font(.caption)
                        ShareLink("결과 초안 내보내기", item: draft.exportText)
                        if let receipt = draft.receipt, draft.phase == .received {
                            Text("버전 \(receipt.version) · 빌드 \(receipt.build)의 결과를 저장했어요.").accessibilityIdentifier("teamOutcomeReceipt")
                            if (page.current?.revision ?? 0) < receipt.revision { Text("새로고침한 뒤 다른 결과를 작성할 수 있어요.").font(.caption) }
                            Button("다른 결과 작성") { model.controller?.newResponse() }.disabled(model.state.busy || !model.state.storageReady || (page.current?.revision ?? 0) < receipt.revision)
                        } else if draft.phase == .conflict {
                            Button("최신 버전과 결과 다시 선택") { model.controller?.rebase() }.disabled(model.state.busy || !model.state.storageReady)
                        } else {
                            Button(draft.phase == .uncertain ? "같은 내용으로 결과 다시 확인" : "확인 결과 보내기") { confirmSend = true }
                                .disabled(model.state.busy || !model.state.storageReady || (try? draft.payload()) == nil).accessibilityIdentifier("teamOutcomeSend")
                        }
                    } header: { Text("직접 확인한 결과") } footer: { Text("직접 사용해 본 결과를 남겨 주세요.") }
                }
                if !model.state.events.isEmpty {
                    Section("확인 이력") { ForEach(model.state.events) { event($0) }; if page.next_cursor != nil { Button("확인 이력 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) } }
                }
                Section("보관 안내") { Text("서버에서는 해결 확인 후 90일, 미해결 요청은 유지하는 정책이에요."); if !page.retention.purge_implemented { Text("자동 삭제는 아직 적용되지 않았어요.").font(.caption).foregroundStyle(.secondary) } }
            } else if let draft = model.state.draft { ShareLink("결과 초안 내보내기", item: draft.exportText) }
        }.navigationTitle("해결 여부 확인").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(model.state.busy || !model.state.storageReady)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                ToolbarItem(placement: .topBarLeading) { if model.state.busy || !model.state.storageReady { Button("뒤로") { if !model.state.storageReady { confirmLeave = true } else { dismiss() } } } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }.onDisappear { model.controller?.invalidate() }
            .alert("이 버전의 확인 결과를 보낼까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("보내기") { Task { await model.controller?.submit() } }
            } message: { Text(model.state.draft?.exportText ?? "") }
            .alert("저장되지 않은 결과 초안이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 결과 초안을 내보내 주세요.") }
    }
}
