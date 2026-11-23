import SwiftUI

@MainActor final class TeamTextRevisionPresentation: ObservableObject {
    @Published var state = TeamTextRevisionController.View()
    var controller: TeamTextRevisionController?
}
struct TeamTextRevisionScreen: View {
    @StateObject private var model: TeamTextRevisionPresentation
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var confirmSend = false
    @State private var confirmLeave = false
    @State private var editing = false
    init(make: @escaping @MainActor () -> TeamTextRevisionPresentation) { _model = StateObject(wrappedValue: make()) }
    private var allowed: Bool { model.controller?.editingAllowed == true }
    private func date(_ value: Double) -> String { Date(timeIntervalSince1970: value / 1000).formatted() }
    private func version(_ item: TeamTextVersion, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.body).textSelection(.enabled).accessibilityIdentifier(identifier)
            Text("작성자: \(item.authorID)").font(.caption).foregroundStyle(.secondary)
            Text("\(item.revision == 1 ? "처음 작성" : "수정") · \(date(item.created_at))").font(.caption).foregroundStyle(.secondary)
        }
    }
    var body: some View {
        let _ = teamRenderCount("body.text")
        List {
#if DEBUG
            if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic text trace").font(.caption2).accessibilityIdentifier("teamTextTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamTextMessage") }
            if let page = model.state.page {
                Section("현재 내용") { version(page.current, identifier: "teamTextCurrent") }
                Section("처음 남긴 원문") { version(page.original, identifier: "teamTextOriginal") }
                if let retention = page.retention, retention.hidden { Text(retention.marker).accessibilityIdentifier("teamTextHidden") }
                if !page.can_edit { Text("작성자만 내용을 수정할 수 있어요. 보관 기한이 지난 글은 읽기만 가능해요.").font(.caption).accessibilityIdentifier("teamTextReadOnly") }
                else if !model.state.supported { Text("지금은 수정 기능을 사용할 수 없어요. 기록은 읽을 수 있어요.").font(.caption) }
                if allowed, model.state.draft?.phase != .uncertain {
                    Button(model.state.draft?.phase == .conflict ? "현재 기록 기준으로 새 수정 작성" : "내용 수정") {
                        model.controller?.beginEdit(); editing = true
                    }.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamTextBeginEdit")
                }
            }
            if model.state.acknowledgedPending { Text("이전에 저장한 수정본을 서버 기록과 확인 중이에요. 확인 전에는 기기 사본을 표시하지 않아요.").font(.caption) }
            if let draft = model.state.draft {
                if draft.phase == .received {
                    Text("수정본이 저장됐어요.").accessibilityIdentifier("teamTextReceipt")
                } else if !draft.body.isEmpty || editing {
                    Section("수정할 내용") {
                        if draft.phase == .draft {
                            TextEditor(text: Binding(get: { model.state.draft?.body ?? "" }, set: { model.controller?.editBody($0) }))
                                .frame(minHeight: 140).focused($focused).disabled(model.state.busy || !model.state.storageReady || !allowed)
                                .accessibilityLabel("수정할 내용").accessibilityIdentifier("teamTextBody")
                        } else { Text(draft.body).textSelection(.enabled).accessibilityIdentifier("teamTextPreservedBody") }
                        Text("\(draft.body.utf16.count)/5,000단위").font(.caption).foregroundStyle(.secondary)
                        ShareLink("수정 내용 내보내기", item: draft.exportText).accessibilityIdentifier("teamTextExport")
                        if draft.phase == .uncertain { Text("저장 여부가 불확실해요. 먼저 새로고침한 뒤 같은 내용과 전송 번호로 다시 확인할 수 있어요.").font(.caption).accessibilityIdentifier("teamTextUnknown") }
                        if draft.phase == .conflict { Text("다른 수정본과 충돌했어요. 새로고침 후 글을 유지한 새 수정을 선택해 주세요.").accessibilityIdentifier("teamTextConflict") }
                        if draft.phase == .draft || draft.phase == .uncertain {
                            Button(draft.phase == .uncertain ? "같은 수정 다시 확인" : "수정 저장") { focused = false; confirmSend = true }
                                .disabled(model.state.busy || !model.state.storageReady || !allowed || (try? draft.payload()) == nil)
                                .accessibilityIdentifier("teamTextSend")
                        }
                    }
                }
            }
            if !model.state.events.isEmpty {
                Section("수정 이력") {
                    ForEach(model.state.events, id: \.revision) { item in version(item, identifier: "teamTextHistory\(item.revision)") }
                    if model.state.page?.next_cursor != nil && model.state.events.count < 500 {
                        Button("수정 이력 더 보기") { focused = false; Task { await model.controller?.more() } }.disabled(model.state.busy || !model.state.storageReady)
                    }
                    if model.state.historyNeedsRefresh { Text("보관 상태가 바뀌었어요. 새로고침해 주세요.") }
                }
            }
        }.navigationTitle("내용과 수정 이력").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(model.state.busy || !model.state.storageReady)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { focused = false; Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamTextRefresh") }
                ToolbarItem(placement: .topBarLeading) { if model.state.busy || !model.state.storageReady { Button("뒤로") { confirmLeave = true }.disabled(model.state.busy) } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }
            .onAppear { teamRenderCount("appear.text") }
            .onDisappear { focused = false; model.controller?.invalidate() }
            .alert("이 내용으로 수정할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("저장") { Task { await model.controller?.submit() } }
            } message: { Text("원문과 수정 이력은 유지돼요. 질문 종류나 답글 대상은 바뀌지 않아요.") }
            .alert("기기에 저장하지 못한 수정 내용이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("필요한 글은 먼저 내보내 주세요.") }
    }
}
