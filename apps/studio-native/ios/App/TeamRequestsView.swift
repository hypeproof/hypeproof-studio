import SwiftUI

@MainActor final class TeamRequestPresentation: ObservableObject {
    @Published var state = TeamRequestController.View()
    var makeOutcome: (String) -> TeamOutcomePresentation = { _ in TeamOutcomePresentation() }
    var makeDelivery: (String) -> TeamDeliveryPresentation = { _ in TeamDeliveryPresentation() }
    var makeGitHub: (String) -> TeamGitHubPresentation = { _ in TeamGitHubPresentation() }
    var makeRelations: (String, String) -> TeamRelationPresentation = { _, _ in TeamRelationPresentation() }
    var makeWorkflow: (String, String) -> TeamWorkflowPresentation = { _, _ in TeamWorkflowPresentation() }
    var controller: TeamRequestController?
    var inbox: TeamInboxPresentation?
    var detail: (String, String?) async throws -> TeamRequestDetail = { _, _ in throw CancellationError() }
    var commentSchemas: (String) async throws -> [String] = { _ in throw CancellationError() }
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

struct TeamRequestDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLeave = false
    @ObservedObject var model: TeamRequestPresentation
    let requestID: String
    @State private var history = TeamCommentHistory()
    private var detail: TeamRequestDetail? { history.detail }
    private var comments: [TeamRequestComment] { history.comments }
    @State private var commentSchemas: [String] = []
    @FocusState private var commentFocused: Bool
    @State private var showRelated = false
    @State private var relatedProduct = "studio"
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
                Section("원문") {
                    Text(detail.request.body).textSelection(.enabled); Text("작성자: \(detail.request.account_id)").font(.caption)
                    if canChooseIntent { Button("원문에 답글") { choose("reply", target: requestID) }.accessibilityIdentifier("teamReplyToRequest") }
                    if detail.retention?.content_purged_at != nil { Text("서버 보관 기간이 지난 내용은 삭제됐어요.").font(.caption) }
                }
                Section { NavigationLink("담당·진행 상태와 이력") { TeamWorkflowScreen(model: model.makeWorkflow(requestID, detail.request.product), requests: model) }.accessibilityIdentifier("teamWorkflowEntry") }
                Section { NavigationLink("해결 여부 확인") { TeamOutcomeView(model: model.makeOutcome(requestID)) }.disabled(busy || !storageReady).accessibilityIdentifier("teamOutcomeEntry") }
                Section { NavigationLink("배포 버전과 확인 안내") { TeamDeliveryScreen(model: model.makeDelivery(requestID)) }.disabled(busy || !storageReady).accessibilityIdentifier("teamDeliveryEntry") }
                Section { NavigationLink("GitHub 연결과 근거") { TeamGitHubScreen(model: model.makeGitHub(requestID)) }.disabled(busy || !storageReady).accessibilityIdentifier("teamGitHubEntry")
                    Button("관련 요청") {
                        commentFocused = false; relatedProduct = detail.request.product
                        let expected = generation
                        // Commit focus resignation before NavigationStack captures the source view.
                        DispatchQueue.main.async { if generation == expected && !busy && storageReady { showRelated = true } }
                    }.disabled(busy || !storageReady).accessibilityIdentifier("teamRelationsEntry") }
                if let inbox = model.inbox { Section { NavigationLink("이 요청의 알림 설정") { TeamSubscriptionScreen(model: inbox, product: detail.request.product, request: requestID) }.disabled(busy || !storageReady).accessibilityIdentifier("teamRequestSubscription") } }
                Section("논의") {
                    ForEach(comments) { comment in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(intentLabel(comment.discussionIntent)).font(.caption).accessibilityIdentifier("teamCommentIntent-" + comment.id)
                            if let target = comment.reply_to { Text(targetLabel(target)).font(.caption) }
                            Text(comment.body).textSelection(.enabled); Text(comment.account_id).font(.caption).foregroundStyle(.secondary)
                            if canChooseIntent { Button("이 댓글에 답글") { choose("reply", target: comment.id) }.accessibilityIdentifier("teamReplyTo-" + comment.id) }
                        }
                    }
                    if detail.next_comments_cursor != nil { Button("댓글 더 보기") { Task { await refresh(more: true) } }.disabled(busy) }
                }
            }
            if let draft, !history.canDisplay(draft) {
                Text("보관 상태가 바뀌어 저장된 댓글 내용을 다시 확인하고 있어요. 새로고침하거나 이전 댓글을 더 확인해 주세요.")
            }
            if let draft, history.canDisplay(draft) {
                    Section {
                        Text(draft.needsReplyTarget == true ? "답글 대상을 선택해 주세요" : intentLabel(draft.discussionIntent)).accessibilityIdentifier("teamCommentSelectedIntent")
                        if let target = draft.replyTo { Text(targetLabel(target)).accessibilityIdentifier("teamCommentReplyTarget") }
                        if canChooseIntent {
                            Button("논의로 작성") { choose("discussion", target: nil) }.accessibilityIdentifier("teamCommentChooseDiscussion")
                            Button("질문으로 작성") { choose("question", target: nil) }.accessibilityIdentifier("teamCommentChooseQuestion")
                        }
                        TextEditor(text: Binding(get: { self.draft?.body ?? "" }, set: edit)).frame(minHeight: 110).accessibilityLabel("댓글 내용").accessibilityIdentifier("teamCommentBody")
                            .focused($commentFocused)
                            .disabled(busy || !storageReady || draft.phase != .draft)
                        if !draft.body.isEmpty { ShareLink("댓글 내용 내보내기", item: draft.body) }
                        if draft.phase == .received {
                            Text("댓글이 접수됐어요.")
                            Button("새 댓글") {
                                let next = TeamCommentDraft(accountID: draft.accountID, requestID: requestID)
                                do { try model.saveComment(next); self.draft = next } catch { storageReady = false; message = "새 댓글을 저장하지 못했어요." }
                            }.disabled(busy || !storageReady)
                        } else if draft.definitiveRejection == "team_reply_target_unavailable" {
                            Button("다른 대상으로 새 답글 작성") { startFreshReplyChoice() }
                                .disabled(busy || !storageReady || !commentSchemas.contains("hps-team-comment/2"))
                                .accessibilityIdentifier("teamCommentNewTarget")
                            Text("원래 답글은 저장되지 않았어요. 글을 유지한 채 새 대상을 직접 선택할 수 있어요.").font(.caption)
                        } else if draft.definitiveRejection == "team_content_expired" {
                            Text("서버 보관 기간이 지나 지금은 추가할 수 없어요. 작성한 글은 내보낼 수 있어요.")
                        } else {
                            Button(draft.phase == .uncertain ? "같은 번호로 다시 보내기" : "댓글 보내기") { confirmSend = true }
                                .disabled(busy || !storageReady || draft.needsReplyTarget == true || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (draft.phase == .draft && !commentSchemas.contains(draft.wireSchema)))
                                .accessibilityIdentifier("teamCommentSend")
                        }
                    } header: { Text("댓글 남기기") } footer: { Text("댓글도 이 제품 권한이 있는 내부 멤버 전체가 볼 수 있어요. 전송 결과를 모를 때 같은 번호로 다시 보내면 중복 댓글을 만들지 않아요.") }
            }
        }.navigationTitle("요청과 논의").navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $showRelated) { TeamRelationScreen(model: model.makeRelations(requestID, relatedProduct), requests: model) }
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
            }.onDisappear { commentFocused = false; generation = UUID(); busy = false; history.clear() }
            .alert("댓글을 보낼까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("보내기") { Task { await submit() } }
            } message: { Text("이 제품 권한이 있는 내부 멤버에게 \(intentLabel(draft?.discussionIntent ?? "discussion"))를 공유해요. \(draft?.replyTo.map(targetLabel) ?? "")") }
    }
    private var canChooseIntent: Bool { !busy && storageReady && draft?.phase == .draft && commentSchemas.contains("hps-team-comment/2") }
    private func intentLabel(_ intent: String) -> String { ["discussion":"논의", "question":"질문", "reply":"답글"][intent] ?? "논의" }
    private func targetLabel(_ target: String) -> String {
        if target == requestID { return "원문에 남기는 답글" }
        if let comment = comments.first(where: { $0.id == target }) { return "답글 대상: " + String(comment.body.prefix(80)) }
        return "이전 댓글에 남기는 답글 (" + target + ")"
    }
    private func choose(_ intent: String, target: String?) {
        guard canChooseIntent, let draft else { return }
        commentFocused = false
        do {
            let next = try draft.choosing(intent, reply: target, loadedComments: comments)
            try model.saveComment(next); self.draft = next
        } catch { storageReady = false; message = "작성 방식을 저장하지 못했어요. 원래 글은 유지했어요." }
    }
    private func startFreshReplyChoice() {
        guard !busy, storageReady, commentSchemas.contains("hps-team-comment/2"), let draft else { return }
        commentFocused = false
        do { let next = try draft.freshReplyChoice(); try model.saveComment(next); self.draft = next; message = "답글 대상을 다시 선택해 주세요. 글은 유지했어요." }
        catch { storageReady = false; message = "새 선택을 저장하지 못했어요. 원래 글과 전송 번호는 유지했어요." }
    }
    private func reject(_ code: String, generation expected: UUID) {
        guard generation == expected, var local = draft, local.recordDefinitiveRejection(code) else { return }
        draft = local
        do { try model.saveComment(local) } catch { storageReady = false; message = "서버 결과를 기기에 저장하지 못했어요. 원래 글을 내보내 주세요." }
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
            var result = try await model.detail(requestID, more ? detail?.next_comments_cursor : nil)
            guard g == generation, !Task.isCancelled else { return }
            if try !history.accept(result, more: more) {
                // A purge between pages invalidates every previously loaded row.
                // Fetch from the beginning; never append another generation.
                result = try await model.detail(requestID, nil)
                guard g == generation, !Task.isCancelled else { return }
                _ = try history.accept(result, more: false)
            }
            if var local = draft, local.observeTombstone(result) {
                draft = local
                do { try model.saveComment(local) } catch { storageReady = false; message = "서버에서 삭제된 내용의 기기 사본을 정리하지 못했어요." }
            }
            do {
                let supported = try await model.commentSchemas(result.request.product)
                guard g == generation, !Task.isCancelled else { return }; commentSchemas = supported
            } catch { if g == generation { commentSchemas = []; message = "지금 작성 가능한 방식을 확인하지 못했어요. 새로고침해 주세요." } }
        } catch { if g == generation { history.clear(); commentSchemas = []; message = "논의를 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    private func submit() async {
        guard !busy, storageReady, var draft, draft.phase != .received, draft.definitiveRejection == nil, draft.needsReplyTarget != true,
              draft.phase == .uncertain || commentSchemas.contains(draft.wireSchema) else { return }
        commentFocused = false
        let g = generation; busy = true
        defer { if g == generation { busy = false } }
        do {
            draft.phase = .uncertain
            do { try model.saveComment(draft) } catch { storageReady = false; message = "보내지 않았어요. 전송 상태를 저장하지 못했어요."; return }
            self.draft = draft
            let receipt = try await model.comment(draft)
            guard g == generation, !Task.isCancelled else { return }
            draft.phase = .received; draft.receipt = receipt; draft.definitiveRejection = nil; self.draft = draft
            do { try model.saveComment(draft); message = "댓글이 접수됐어요. 새로고침하면 논의에서 확인할 수 있어요." }
            catch { storageReady = false; message = "접수됐지만 기기에 저장하지 못했어요. 댓글 내용을 내보내 주세요." }
        } catch SyncFailure.http(409, "team_content_expired") {
            if g == generation { message = "서버 보관 기간이 지나 지금은 이 내용에 추가할 수 없어요. 작성한 글과 전송 번호는 이 기기에 유지돼요."; reject("team_content_expired", generation:g) }
        } catch SyncFailure.http(409, "team_reply_target_unavailable") {
            if g == generation { message = "답글 대상을 지금 확인할 수 없어요. 원래 글과 전송 번호는 유지돼요. 새로고침해 주세요."; reject("team_reply_target_unavailable", generation:g) }
        } catch { if g == generation { message = "접수 여부를 확인하지 못했어요. 댓글과 전송 번호는 유지돼요." } }
    }
}

@MainActor final class TeamWorkflowPresentation: ObservableObject {
    @Published var state = TeamWorkflowController.View()
    var controller: TeamWorkflowController?
}
private func workflowLabel(_ value: String) -> String {
    ["submitted":"접수됨", "discussing":"논의 중", "on_hold":"보류", "duplicate":"중복 연결", "rejected":"반려", "unclassified":"미정", "low":"낮음", "normal":"보통", "high":"높음"][value] ?? value
}
private struct TeamWorkflowScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TeamWorkflowPresentation
    let requests: TeamRequestPresentation
    @State private var confirmSend = false
    @State private var confirmLeave = false
    init(model: TeamWorkflowPresentation, requests: TeamRequestPresentation) { _model = StateObject(wrappedValue: model); self.requests = requests }
    private var editable: Bool { model.state.page?.can_manage == true && model.state.draft?.phase == .draft && !model.state.busy && model.state.storageReady }
    private func memberName(_ id: String?) -> String {
        guard let id else { return "담당 미정" }
        return model.state.members.first { $0.account_id == id }?.display_name ?? "계정: \(id)"
    }
    var body: some View {
        List {
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamWorkflowMessage") }
            if let page = model.state.page {
                Section("최근 확인한 상태") {
                    LabeledContent("진행 상태", value: workflowLabel(page.current.status)).accessibilityIdentifier("teamWorkflowCurrent")
                    LabeledContent("담당", value: memberName(page.current.assignee_account_id))
                    LabeledContent("우선순위", value: workflowLabel(page.current.priority))
                    if let next = page.current.next_action { Text("다음 행동: \(next)") }
                    if let target = page.current.duplicate_request_id { NavigationLink("대표 요청 보기") { TeamRequestDetailView(model: requests, requestID: target) }.disabled(model.state.busy || !model.state.storageReady) }
                    if !page.can_manage { Text("현재 권한으로 상태와 이력을 볼 수 있어요. 담당·상태 변경 권한은 별도로 확인해요.").font(.caption).foregroundStyle(.secondary) }
                }
            }
            if let draft = model.state.draft {
                Section("변경 제안") {
                    Picker("진행 상태", selection: Binding(get: { model.state.draft?.status ?? "submitted" }, set: { value in model.controller?.edit { $0.status = value; if value != "duplicate" { $0.duplicateID = nil } } })) {
                        ForEach(TeamWorkflowSnapshot.statuses, id: \.self) { Text(workflowLabel($0)).tag($0) }
                    }.disabled(!editable).accessibilityIdentifier("teamWorkflowState")
                    Picker("담당자", selection: Binding(get: { model.state.draft?.assignee ?? "" }, set: { value in model.controller?.edit { $0.assignee = value.isEmpty ? nil : value } })) {
                        Text("담당 미정").tag("")
                        ForEach(model.state.members) { Text($0.display_name ?? "이름 미등록 · \($0.account_id)").tag($0.account_id) }
                        if let existing = draft.assignee, !model.state.members.contains(where: { $0.account_id == existing }) { Text("기존 담당 · 권한 재확인 필요").tag(existing) }
                    }.disabled(!editable).accessibilityIdentifier("teamWorkflowAssignee")
                    Picker("우선순위", selection: Binding(get: { model.state.draft?.priority ?? "unclassified" }, set: { value in model.controller?.edit { $0.priority = value } })) {
                        ForEach(TeamWorkflowSnapshot.priorities, id: \.self) { Text(workflowLabel($0)).tag($0) }
                    }.disabled(!editable)
                    if draft.status == "duplicate" {
                        Picker("대표 요청", selection: Binding(get: { model.state.draft?.duplicateID ?? "" }, set: { value in model.controller?.edit { $0.duplicateID = value.isEmpty ? nil : value } })) {
                            Text("선택해 주세요").tag("")
                            ForEach(model.state.targets) { Text(String($0.body.prefix(80))).tag($0.id) }
                            if let old = draft.duplicateID, !model.state.targets.contains(where: { $0.id == old }) { Text("기존 연결 · 상세 확인 필요").tag(old) }
                        }.disabled(!editable)
                        if model.state.targetCursor != nil { Button("이전 요청 더 불러오기") { Task { await model.controller?.moreTargets() } }.disabled(model.state.busy) }
                    }
                    TextField("다음 행동", text: Binding(get: { model.state.draft?.nextAction ?? "" }, set: { value in model.controller?.edit { $0.nextAction = value } }), axis: .vertical)
                        .disabled(!editable).accessibilityIdentifier("teamWorkflowNext")
                    TextEditor(text: Binding(get: { model.state.draft?.reason ?? "" }, set: { value in model.controller?.edit { $0.reason = value } }))
                        .frame(minHeight: 100).disabled(!editable).accessibilityLabel("변경 사유").accessibilityIdentifier("teamWorkflowReason")
                    Text("변경 사유 \(draft.reason.utf16.count)/2,000단위").font(.caption)
                    if !draft.reason.isEmpty || !draft.nextAction.isEmpty { ShareLink("변경 내용 내보내기", item: "\(draft.reason)\n\(draft.nextAction)") }
                    if draft.phase == .received {
                        Text("변경이 서버에 저장됐어요.").accessibilityIdentifier("teamWorkflowReceipt")
                        Button("다음 변경 작성") { model.controller?.newChange() }.disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true)
                    } else if draft.phase == .conflict {
                        Button("최신 상태 기준으로 제안 유지") { model.controller?.rebase() }.disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true).accessibilityIdentifier("teamWorkflowRebase")
                    } else {
                        Button(draft.phase == .uncertain ? "같은 번호로 다시 저장" : "변경 저장") { confirmSend = true }
                            .disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || (try? draft.payload()) == nil).accessibilityIdentifier("teamWorkflowSend")
                    }
                }
            }
            Section("변경 이력") {
                ForEach(model.state.events, id: \.revision) { event in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(workflowLabel(event.status)) · \(workflowLabel(event.priority))")
                        Text(event.reason ?? "작성자 삭제로 내용이 제거됐어요.")
                        Text("변경 \(event.revision) · \(event.actor_account_id ?? "삭제된 계정")").font(.caption).foregroundStyle(.secondary)
                        if let time = event.created_at { Text(Date(timeIntervalSince1970: time / 1000), style: .date).font(.caption) }
                    }
                }
                if model.state.page?.next_cursor != nil { Button("변경 이력 더 보기") { Task { await model.controller?.moreHistory() } }.disabled(model.state.busy) }
            }
        }.navigationTitle("담당·진행 상태").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(!model.state.storageReady || model.state.busy)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                ToolbarItem(placement: .topBarLeading) { if !model.state.storageReady || model.state.busy { Button("뒤로") { if !model.state.storageReady { confirmLeave = true } else { dismiss() } } } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
            .alert("담당·상태 변경을 저장할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("저장") { Task { await model.controller?.submit() } }
            } message: { Text("표시된 담당자·상태·다음 행동과 변경 사유를 내부 팀의 이력에 남겨요.") }
            .alert("저장되지 않은 변경이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 변경 내용을 내보내 주세요.") }
    }
}

@MainActor final class TeamGitHubPresentation: ObservableObject {
    @Published var state = TeamGitHubController.View()
    var controller: TeamGitHubController?
    var makeObservations: (() -> TeamGitHubObservationPresentation)?
}
private struct TeamGitHubScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TeamGitHubPresentation
    @State private var confirmSend = false
    @State private var confirmLeave = false
    init(model: TeamGitHubPresentation) { _model = StateObject(wrappedValue: model) }
    private var editable: Bool { model.state.page?.can_manage == true && model.state.draft?.phase == .draft && !model.state.busy && model.state.storageReady }
    private func field(_ title: String, _ key: WritableKeyPath<TeamGitHubDraft, String>, _ identifier: String) -> some View {
        TextField(title, text: Binding(get: { model.state.draft?[keyPath: key] ?? "" }, set: { value in model.controller?.edit { $0[keyPath: key] = value } }))
            .textInputAutocapitalization(.never).autocorrectionDisabled().disabled(!editable).accessibilityIdentifier(identifier)
    }
    private func evidence(_ event: TeamGitHubEvent, history: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(event.repo) · 이슈 #\(event.issue_number)").accessibilityIdentifier(history ? "teamGitHubHistoryEntry\(event.revision)" : "teamGitHubCurrentIssue")
            Text("연결 관계: 운영자 지정 · 변경 \(event.revision)").font(.caption)
            if let proof = event.evidence {
                Link("확인된 이슈 열기", destination: URL(string: proof.issue.url)!)
                Text("연결 당시 상태: \(proof.issue.state == "closed" ? "닫힘" : "열림")")
                if let pull = proof.pull { Link("PR #\(pull.number) · \(pull.merged ? "병합됨" : "미병합")", destination: URL(string: pull.url)!) }
                if let sha = proof.source_sha { Text("소스 SHA: \(sha)").font(.caption).textSelection(.enabled) }
                if let ci = proof.ci { Link("CI 실행 \(ci.run_id) · 시도 \(ci.attempt) · \(ci.conclusion)", destination: URL(string: ci.url)!) }
            } else { Text("작성자 삭제로 연결 근거가 제거됐어요.") }
            if let reason = event.reason { Text(reason).textSelection(.enabled) }
            Text("연결 당시 확인: \(Date(timeIntervalSince1970: event.verified_at / 1000).formatted())").font(.caption)
            Text("TestFlight 제공 여부·사용자 해결 확인: 확인되지 않음").font(.caption).foregroundStyle(.secondary)
        }
    }
    var body: some View {
        List {
#if DEBUG
            if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic GitHub trace").font(.caption2).accessibilityIdentifier("teamGitHubTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif

            if let make = model.makeObservations {
                NavigationLink { TeamGitHubObservationScreen(model: make()) } label: { Text("최근 확인한 GitHub 상태") }
                    .disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamGitHubObservationsOpen")
            }
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamGitHubMessage") }
            if let page = model.state.page {
                Section("연결 당시 기록") {
                    if let event = page.current { evidence(event).accessibilityIdentifier("teamGitHubCurrent") }
                    else { Text("아직 연결된 GitHub 근거가 없어요.") }
                    if !page.can_manage { Text("조회 권한으로 보고 있어요. 연결 변경은 권한이 있는 운영자만 할 수 있어요.").accessibilityIdentifier("teamGitHubReadOnly") }
                }
            }
            if let draft = model.state.draft {
                Section {
                    field("기존 이슈 번호", \.issue, "teamGitHubIssue")
                    Toggle("PR·소스·CI 근거 함께 확인", isOn: Binding(get: { model.state.draft?.lineage ?? false }, set: { value in model.controller?.edit { $0.lineage = value } })).disabled(!editable)
                    if draft.lineage {
                        field("PR 번호", \.pull, "teamGitHubPull")
                        field("40자리 소스 SHA", \.sourceSHA, "teamGitHubSHA")
                        field("CI 실행 번호", \.run, "teamGitHubRun")
                        field("CI 시도 번호", \.attempt, "teamGitHubAttempt")
                    }
                    TextEditor(text: Binding(get: { model.state.draft?.reason ?? "" }, set: { value in model.controller?.edit { $0.reason = value } }))
                        .frame(minHeight: 100).disabled(!editable).accessibilityLabel("연결 사유").accessibilityIdentifier("teamGitHubReason")
                    Text("연결 사유 \(draft.reason.utf16.count)/2,000단위").font(.caption)
                    ShareLink("연결 초안 내보내기", item: "이슈: \(draft.issue)\nPR: \(draft.pull)\nSHA: \(draft.sourceSHA)\nCI: \(draft.run), 시도: \(draft.attempt)\n\(draft.reason)")
                    if draft.phase == .received {
                        Text("연결이 저장됐어요.").accessibilityIdentifier("teamGitHubReceipt")
                        Button("다음 연결 작성") { model.controller?.newChange() }.disabled(!model.state.storageReady || model.state.busy || model.state.page?.can_manage != true)
                    } else if draft.phase == .conflict {
                        Button("최신 상태 기준으로 제안 유지") { model.controller?.rebase() }.disabled(!model.state.storageReady || model.state.busy || model.state.page?.can_manage != true)
                    } else {
                        Button(draft.phase == .uncertain ? "같은 번호로 다시 확인·저장" : "연결 확인·저장") { confirmSend = true }
                            .disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || (try? draft.payload()) == nil).accessibilityIdentifier("teamGitHubSend")
                    }
                } header: { Text("기존 GitHub 기록 연결") } footer: { Text("제품 저장소는 서버에서 정해요. 새 공개 이슈를 만들지 않으며, 요청 원문과 연결 사유를 GitHub에 보내지 않아요. CI 성공만으로 배포·설치·해결을 판단하지 않아요.") }
            }
            Section("연결 이력") {
                ForEach(model.state.events) { event in evidence(event, history: true) }
                if model.state.page?.next_cursor != nil { Button("연결 이력 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
            }
        }.navigationTitle("GitHub 연결 근거").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(!model.state.storageReady || model.state.busy)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                ToolbarItem(placement: .topBarLeading) { if !model.state.storageReady || model.state.busy { Button("뒤로") { if !model.state.storageReady { confirmLeave = true } else { dismiss() } }.accessibilityIdentifier("teamGitHubBack") } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
            .alert("GitHub 기록을 연결할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("저장") { Task { await model.controller?.submit() } }
            } message: { Text("서버가 GitHub 기록을 확인한 뒤 연결 사유와 함께 내부 이력에 저장해요. 공개 GitHub 글을 작성하지 않아요.") }
            .alert("저장되지 않은 연결 초안이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 연결 초안을 내보내 주세요.") }
    }
}

@MainActor final class TeamDeliveryPresentation: ObservableObject {
    @Published var state = TeamDeliveryController.View()
    var controller: TeamDeliveryController?
}
private struct TeamDeliveryScreen: View {
    @StateObject private var model: TeamDeliveryPresentation
    init(model: TeamDeliveryPresentation) { _model = StateObject(wrappedValue: model) }
    private func date(_ time: Double) -> String { Date(timeIntervalSince1970: time / 1000).formatted(date: .abbreviated, time: .shortened) }
    @ViewBuilder private func record(_ event: TeamDeliveryEvent, now: Date) -> some View {
        if let proof = event.evidence {
            Text("버전 \(proof.package.version) · 빌드 \(proof.package.build)").font(.headline).accessibilityIdentifier("teamDeliveryBuild\(event.revision)")
            Text(proof.isFresh(at: now) ? "확인한 시각: \(date(proof.observed_at)) · 유효: \(date(proof.valid_until))까지" : "확인한 시각: \(date(proof.observed_at)) · 현재 상태는 다시 확인이 필요해요.").font(.caption).accessibilityIdentifier("teamDeliveryFreshness\(event.revision)")
            Text(event.availability == "group_available" && proof.groupAvailable(at: now) ? "내부 테스트 그룹에 빌드가 제공된 것을 확인했어요." : "현재 그룹의 설치 가능 여부는 확인되지 않았어요.").accessibilityIdentifier("teamDeliveryAvailability\(event.revision)")
            Text("내 계정의 초대·참여 자격, 이 기기의 설치, 작성자의 해결 확인은 아직 확인되지 않았어요.").font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("teamDeliveryUnobserved\(event.revision)")
            if let instructions = event.instructions { Text(instructions).textSelection(.enabled).accessibilityIdentifier("teamDeliveryInstructions\(event.revision)") }
            Link("빌드 확인 기록 보기", destination: proof.observationURL)
        } else { Text("작성자 삭제로 배포 근거가 제거됐어요.") }
    }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            List {
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamDeliveryUnavailable") }
                if let page = model.state.page {
                    Section("최근 배포 기록") {
                        if let current = page.current { record(current, now: context.date) }
                        else { Text("아직 연결된 배포 기록이 없어요.").accessibilityIdentifier("teamDeliveryEmpty") }
                    }
                    if !model.state.events.isEmpty {
                        Section("이전 기록") {
                            ForEach(model.state.events.filter { $0.id != page.current?.id }) { event in
                                VStack(alignment: .leading, spacing: 8) { record(event, now: context.date) }
                            }
                            if page.next_cursor != nil { Button("기록 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
                        }
                    }
                }
                if model.state.busy { ProgressView().accessibilityLabel("배포 근거 불러오는 중") }
            }
        }.navigationTitle("배포 버전과 확인 안내").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy) }
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
    }
}
