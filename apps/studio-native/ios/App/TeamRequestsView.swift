import SwiftUI

@MainActor final class TeamRequestPresentation: ObservableObject {
    @Published var state = TeamRequestController.View()
    var controller: TeamRequestController?
    var detail: (String, String?) async throws -> TeamRequestDetail = { _, _ in throw CancellationError() }
    var comment: (TeamCommentDraft) async throws -> String = { _ in throw CancellationError() }
    var loadComment: (String) throws -> TeamCommentDraft = { _ in throw CancellationError() }
    var saveComment: (TeamCommentDraft) throws -> Void = { _ in throw CancellationError() }
}
private func productLabel(_ id: String) -> String { ["studio": "Studio", "lab": "Lab", "foundry": "Foundry"][id] ?? id }

struct TeamRequestsView: View {
    @ObservedObject var model: TeamRequestPresentation
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSend = false
    @State private var confirmClose = false
    var body: some View {
        NavigationStack {
            List {
#if DEBUG
                if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic request trace").font(.caption2).accessibilityIdentifier("teamRequestTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamRequestStatus") }
                if let draft = model.state.draft {
                    Section {
                        if let access = model.state.access {
                            Picker("제품", selection: Binding(get: { model.state.draft?.product ?? "studio" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: current.body, product: value, category: current.category) })) {
                                ForEach(access.products, id: \.self) { Text(productLabel($0)).tag($0) }
                            }.disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        }
                        Picker("종류", selection: Binding(get: { model.state.draft?.category ?? "bug" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: current.body, product: current.product, category: value) })) {
                            Text("불편·문제").tag("bug"); Text("개선 아이디어").tag("improvement"); Text("질문").tag("question")
                        }.disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        TextEditor(text: Binding(get: { model.state.draft?.body ?? "" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: value, product: current.product, category: current.category) }))
                            .frame(minHeight: 130).accessibilityLabel("내부 요청 내용").accessibilityIdentifier("teamRequestBody")
                            .disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        Text("\(draft.body.utf16.count)/5,000단위 · 이모지는 여러 단위로 계산돼요.").font(.caption).foregroundStyle(.secondary)
                        if !draft.body.isEmpty { ShareLink("내용 내보내기", item: draft.body) }
                        if let receipt = draft.receipt {
                            Text("접수 번호: \(receipt)").font(.caption).textSelection(.enabled).accessibilityIdentifier("teamRequestReceipt")
                            NavigationLink("요청과 논의 보기") { TeamRequestDetailView(model: model, requestID: receipt) }
                            Button("새 요청 작성") { model.controller?.newDraft() }.disabled(model.state.busy || !model.state.storageReady)
                        } else {
                            if draft.phase == .uncertain {
                                Button("접수 결과 확인") { Task { await model.controller?.submit(recoveryOnly: true) } }.disabled(model.state.busy)
                                    .accessibilityIdentifier("teamRequestRecover")
                            }
                            Button(draft.phase == .uncertain ? "같은 번호로 다시 보내기" : "내부 팀에 보내기") { confirmSend = true }
                                .disabled(model.state.busy || !model.state.storageReady || model.state.access?.products.contains(draft.product) != true || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                .accessibilityIdentifier("teamRequestSend")
                        }
                    } header: { Text("새 의견·질문") } footer: {
                        Text("해당 제품 권한이 있는 Lab 내부 멤버 전체가 요청과 댓글을 볼 수 있어요. 미해결 요청은 유지하며, 작성자가 해결을 확인한 뒤 90일 동안 보관해요. 대화·음성·계정 비밀은 함께 보내지 않아요.")
                    }
                    Section("\(productLabel(draft.product))의 요청") {
                        if model.state.requests.isEmpty && !model.state.busy { Text("표시할 요청이 없어요.").foregroundStyle(.secondary) }
                        ForEach(model.state.requests) { request in
                            NavigationLink { TeamRequestDetailView(model: model, requestID: request.id) } label: {
                                VStack(alignment: .leading, spacing: 6) { Text(request.body).lineLimit(3); Text("접수됨 · \(request.account_id)").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        if model.state.nextCursor != nil { Button("이전 요청 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
                    }
                }
            }.navigationTitle("팀 요청").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                    ToolbarItem(placement: .confirmationAction) { Button("닫기") { if !model.state.storageReady { confirmClose = true } else { dismiss() } }.accessibilityIdentifier("teamRequestClose") }
                }
                .task { await model.controller?.open() }
                .alert("내부 팀에 보낼까요?", isPresented: $confirmSend) {
                    Button("취소", role: .cancel) {}
                    Button("보내기") { Task { await model.controller?.submit() } }
                } message: { Text("작성한 내용은 이 제품 권한이 있는 내부 멤버에게 공개돼요. 같은 전송 번호는 서버에서 하나의 요청으로 처리해요.") }
                .alert("저장되지 않은 내용이 있어요", isPresented: $confirmClose) {
                    Button("계속 작성", role: .cancel) {}; Button("닫기", role: .destructive) { dismiss() }
                } message: { Text("닫기 전에 내용을 내보내 주세요.") }
                .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
        }
    }
}

private struct TeamRequestDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLeave = false
    @ObservedObject var model: TeamRequestPresentation
    let requestID: String
    @State private var detail: TeamRequestDetail?
    @State private var comments: [TeamRequestComment] = []
    @State private var draft: TeamCommentDraft?
    @State private var busy = false
    @State private var storageReady = true
    @State private var confirmSend = false
    @State private var message = ""
    @State private var generation = UUID()
    var body: some View {
        List {
            if !message.isEmpty { Text(message).accessibilityIdentifier("teamCommentStatus") }
            if let detail {
                Section("원문") { Text(detail.request.body).textSelection(.enabled); Text("작성자: \(detail.request.account_id)").font(.caption) }
                Section("논의") {
                    ForEach(comments) { comment in VStack(alignment: .leading, spacing: 6) { Text(comment.body).textSelection(.enabled); Text(comment.account_id).font(.caption).foregroundStyle(.secondary) } }
                    if detail.next_comments_cursor != nil { Button("댓글 더 보기") { Task { await refresh(more: true) } }.disabled(busy) }
                }
            }
            if let draft {
                    Section {
                        TextEditor(text: Binding(get: { self.draft?.body ?? "" }, set: edit)).frame(minHeight: 110).accessibilityLabel("댓글 내용").accessibilityIdentifier("teamCommentBody")
                            .disabled(busy || !storageReady || draft.phase != .draft)
                        if !draft.body.isEmpty { ShareLink("댓글 내용 내보내기", item: draft.body) }
                        if draft.phase == .received {
                            Text("댓글이 접수됐어요.")
                            Button("새 댓글") {
                                let next = TeamCommentDraft(accountID: draft.accountID, requestID: requestID)
                                do { try model.saveComment(next); self.draft = next } catch { storageReady = false; message = "새 댓글을 저장하지 못했어요." }
                            }.disabled(busy || !storageReady)
                        } else {
                            Button(draft.phase == .uncertain ? "같은 번호로 다시 보내기" : "댓글 보내기") { confirmSend = true }
                                .disabled(busy || !storageReady || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                .accessibilityIdentifier("teamCommentSend")
                        }
                    } header: { Text("댓글 남기기") } footer: { Text("댓글도 이 제품 권한이 있는 내부 멤버 전체가 볼 수 있어요. 전송 결과를 모를 때 같은 번호로 다시 보내면 중복 댓글을 만들지 않아요.") }
            }
        }.navigationTitle("요청과 논의").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(!storageReady || busy)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !storageReady || busy { Button("뒤로") { if !storageReady { confirmLeave = true } else { dismiss() } }.accessibilityIdentifier("teamCommentBack") }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await refresh() } }.disabled(busy || !storageReady) }
            }
            .interactiveDismissDisabled(busy || !storageReady)
            .alert("저장되지 않은 댓글이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 댓글 내용을 내보내 주세요. 저장되지 않은 수정은 사라질 수 있어요.") }
            .task(id: requestID) {
                do { draft = try model.loadComment(requestID) } catch { storageReady = false; message = "저장된 댓글을 읽지 못했어요. 원본을 유지했어요." }
                await refresh()
            }.onDisappear { generation = UUID(); busy = false; detail = nil; comments = [] }
            .alert("댓글을 보낼까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("보내기") { Task { await submit() } }
            } message: { Text("이 제품 권한이 있는 내부 멤버에게 댓글을 공유해요.") }
    }
    private func edit(_ text: String) {
        guard !busy, storageReady, var draft, draft.phase == .draft, text.utf16.count <= 5000 else { return }
        draft.body = text; self.draft = draft
        do { try model.saveComment(draft) } catch { storageReady = false; message = "댓글을 기기에 저장하지 못했어요. 내용을 내보내 주세요." }
    }
    private func refresh(more: Bool = false) async {
        guard !busy else { return }; busy = true; let g = generation
        defer { if g == generation { busy = false } }
        do {
            let result = try await model.detail(requestID, more ? detail?.next_comments_cursor : nil)
            guard g == generation, !Task.isCancelled else { return }
            if more { let known = Set(comments.map(\.id)); comments += result.comments.filter { !known.contains($0.id) } } else { comments = result.comments }
            detail = result
        } catch { if g == generation { detail = nil; comments = []; message = "논의를 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    private func submit() async {
        guard !busy, storageReady, var draft, draft.phase != .received else { return }
        let g = generation; busy = true
        defer { if g == generation { busy = false } }
        do {
            draft.phase = .uncertain
            do { try model.saveComment(draft) } catch { storageReady = false; message = "보내지 않았어요. 전송 상태를 저장하지 못했어요."; return }
            self.draft = draft
            let receipt = try await model.comment(draft)
            guard g == generation, !Task.isCancelled else { return }
            draft.phase = .received; draft.receipt = receipt; self.draft = draft
            do { try model.saveComment(draft); message = "댓글이 접수됐어요. 새로고침하면 논의에서 확인할 수 있어요." }
            catch { storageReady = false; message = "접수됐지만 기기에 저장하지 못했어요. 댓글 내용을 내보내 주세요." }
        } catch { if g == generation { message = "접수 여부를 확인하지 못했어요. 댓글과 전송 번호는 유지돼요." } }
    }
}
