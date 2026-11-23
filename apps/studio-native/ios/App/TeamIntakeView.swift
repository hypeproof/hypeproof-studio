import SwiftUI
import CryptoKit

/// Public presentation metadata only; secrets stay in the separate Intake Keychain.
struct TeamIntakeSelection: Codable { var principalID: String? }
@MainActor final class TeamIntakePresentation: ObservableObject {
    @Published var state = IntakeProposalController.View()
    @Published var auth = IntakeDeviceAuth.View()
    @Published var principal: IntakePrincipal?
    @Published var summary = IntakeProposal()
    @Published var repository: String?
    @Published var policyRevision: String?
    @Published var message = ""
    @Published var ready = false
    @Published var storageReady = true
    @Published var canAssociate = false
    var controller: IntakeProposalController?
    var device: IntakeDeviceAuth?
    var client: IntakeClient?
    var configure: () async throws -> Void = {}
    var restore: () throws -> Void = {}
    var persistSummary: (IntakeProposal) throws -> Void = { _ in }
    var clearSecret: () throws -> Void = {}
    var github: TeamGitHubPresentation?
    private var generation = 0
    func open() async {
        guard storageReady, state.storageReady, !state.busy else { return }
        let g = generation
        do { try await configure(); guard g == generation else { return }; try restore(); ready = true; if principal != nil { await controller?.open() } }
        catch { if g == generation { message = "연결을 확인하지 못했어요. 다시 확인해 주세요." } }
    }
    private func resetPresentation() {
        generation += 1; controller?.invalidate(); client?.invalidate(); github?.controller?.invalidate()
        controller = nil; client = nil; device = nil; auth = .init(); principal = nil
        ready = false; storageReady = true; state = .init(); summary = .init(); repository = nil; policyRevision = nil; message = ""
    }
    func invalidate() { try? device?.cancel(); try? clearSecret(); resetPresentation() }
    func disconnect() async {
        guard !state.busy, storageReady, state.storageReady else { return }
        do {
            if let device { try device.cancel() } else { try clearSecret() }
            resetPresentation(); await open()
        } catch {
            // A failed deletion is not a successful disconnect. Never restore/reconnect here.
            message = "Lab 연결 정보를 지우지 못했어요. 연결 해제를 다시 눌러 주세요."
        }
    }
    func login() async { do { try await device?.start() } catch { message = "Lab 로그인을 시작하지 못했어요. 다시 시도해 주세요." } }
    func checkLogin() async {
        do { try await device?.poll(); if let p = device?.view.principal { principal = p; try restore(); await controller?.open() } }
        catch IntakeFailure.tooEarly { message = "잠시 후 로그인 확인을 다시 눌러 주세요." }
        catch { message = "로그인을 확인하지 못했어요. Lab 로그인을 다시 시작해 주세요." }
    }
    func edit(_ change: (inout IntakeProposal) -> Void) { controller?.cancelConfirmation(); change(&summary); do { try persistSummary(summary); storageReady = true } catch { storageReady = false; message = "작성 내용을 저장하지 못했어요. 내용을 내보낸 뒤 다시 시도해 주세요." } }
    func prepareAssociation() async -> Bool {
        guard let receipt = state.operation?.receipt, let number = receipt.publication?.issue_number, let github else { return false }
        let g = generation
        await github.controller?.open()
        guard generation == g, github.state.page?.can_manage == true, github.state.page?.configured_repository == receipt.draft.target_repo else { message = "게시된 요청은 유지했어요. 현재 제품의 연결 권한과 위치를 확인해 주세요."; return false }
        guard github.state.storageReady, !github.state.busy else { return false }
        if github.state.draft?.phase == .received, github.state.draft?.issue != String(number) { github.controller?.newChange() }
        if let draft = github.state.draft, !draft.issue.isEmpty, draft.issue != String(number) {
            message = "다른 GitHub 요청의 연결 초안이 남아 있어요. 기존 연결 화면에서 먼저 확인해 주세요. 이번에 게시된 요청은 그대로 유지돼요."; return false
        }
        if github.state.draft?.phase == .draft, github.state.draft?.issue.isEmpty == true {
            github.controller?.edit { draft in draft.issue = String(number); draft.reason = "이 내부 요청에서 확인한 공개 요약의 게시 결과를 연결합니다." }
        }
        return github.state.storageReady
    }
    func preview() async { guard storageReady, let repository else { return }; summary.target_repo = repository; await controller?.preview(summary) }
    static func publicText(_ value: IntakeProposal) -> String { [value.title, value.intent, value.requested_change, value.acceptance.joined(separator: "\n"), value.references.joined(separator: "\n"), value.target_repo].joined(separator: "\n\n") }
    var exportText: String { Self.publicText(summary) }
}
@MainActor final class TeamIntakePresentations {
    private struct Entry { weak var value: TeamIntakePresentation? }
    private var entries: [Entry] = []
    func register(_ value: TeamIntakePresentation) { entries.removeAll { $0.value == nil }; entries.append(.init(value: value)) }
    func invalidate() { entries.removeAll { $0.value == nil }; entries.forEach { $0.value?.invalidate() } }
}

struct TeamIntakeScreen: View, Equatable {
    @StateObject private var model: TeamIntakePresentation
    @State private var confirm = false
    @State private var confirmPolicy = false
    @State private var policyToConfirm: String?
    @State private var leave = false
    @State private var association = false
    @FocusState private var focused: String?
    @Environment(\.dismiss) private var dismiss
    init(key: TeamScreenKey, make: @escaping @MainActor () -> TeamIntakePresentation) { self.key = key; _model = StateObject(wrappedValue: make()) }
    let key: TeamScreenKey
    nonisolated static func == (a: Self, b: Self) -> Bool { teamScreenEqual("intake", a.key, b.key) }
    private var locked: Bool { model.state.busy || !model.storageReady || !model.state.storageReady }
    private func field(_ title: String, _ key: WritableKeyPath<IntakeProposal, String>, _ id: String) -> some View {
        TextField(title, text: Binding(get: { model.summary[keyPath: key] }, set: { text in model.edit { $0[keyPath: key] = text } }), axis: .vertical)
            .focused($focused, equals: id).accessibilityIdentifier(id)
    }
    private func summary(_ p: IntakeProposal) -> some View {
        Group { Text(p.title).font(.headline); Text(p.intent); Text(p.requested_change); ForEach(Array(p.acceptance.enumerated()), id: \.offset) { Text($0.element) }; ForEach(Array(p.references.enumerated()), id: \.offset) { Text($0.element) }; Text("공개 위치: \(p.target_repo)") }
    }
    var body: some View {
        let _ = teamRenderCount("body.intake")
        let _ = teamWhy(Self.self)
        List {
#if DEBUG
            if TeamIntakeFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic Intake trace").accessibilityIdentifier("teamIntakeTrace").accessibilityValue(TeamIntakeFixture.trace) } }
#endif
            Text("내부 대화는 자동으로 공개하지 않아요. 공개해도 되는 요약만 직접 작성해 주세요.").font(.caption)
            if !model.message.isEmpty { Text(model.message).accessibilityIdentifier("teamIntakeMessage") }
            if let p = model.principal, p.expiresAt > Date() {
                Section("제출할 Lab 계정") { Text(p.id).textSelection(.enabled); Text("로그인 만료: \(p.expiresAt.formatted())").font(.caption)
                    Button("Lab 연결 해제") { Task { await model.disconnect() } }.disabled(locked).accessibilityIdentifier("teamIntakeDisconnect") }
            } else {
                Section("Lab 로그인") {
                    Text("Studio 로그인과 별도로 공개 요청을 제출할 Lab 계정을 확인해요.")
                    Button("Lab 로그인 시작") { Task { await model.login() } }.disabled(!model.ready || model.auth.busy).accessibilityIdentifier("teamIntakeLogin")
                    if let code = model.auth.code, let url = model.auth.verificationURL { Text(code).accessibilityIdentifier("teamIntakeCode"); Link("Lab에서 계정 확인", destination: url); TimelineView(.periodic(from: .now, by: 0.25)) { timeline in Button("로그인 확인") { Task { await model.checkLogin() } }.disabled(model.auth.busy || model.auth.nextPollAt.map { timeline.date < $0 } == true).accessibilityIdentifier("teamIntakePoll") } }
                }
            }
            if let failure = model.state.failure { Text(failure == .storage ? "저장하지 못했어요. 내보내기로 내용을 보존해 주세요." : "요청을 완료하지 못했어요. 기존 전송 내용과 결과를 유지했어요.").accessibilityIdentifier("teamIntakeFailure") }
            if model.state.failure == .confirmationRequired, model.state.operation?.phase == .uncertain {
                if let revision = model.policyRevision { Text("현재 게시 정책: \(revision)").font(.caption) }
                Button("현재 정책으로 같은 전송 복구 확인") { policyToConfirm = model.policyRevision; confirmPolicy = true }.disabled(locked || model.policyRevision == nil)
            }
            if let op = model.state.operation {
                Section("확인한 공개 요약") { summary(op.proposal); ShareLink("요약 내보내기", item: TeamIntakePresentation.publicText(op.proposal)).accessibilityIdentifier("teamIntakeExport") }
                if let receipt = op.receipt {
                    Section("제출 결과") { Text(receipt.feedback.reason); Text(receipt.feedback.next_action); ForEach(receipt.feedback.questions, id: \.self) { Text($0) }
                        if let url = receipt.issueURL { Link("생성된 GitHub 요청 보기", destination: url).accessibilityIdentifier("teamIntakeIssue"); Text(receipt.boardComplete ? "프로젝트에도 연결됐어요." : "요청은 생성됐어요. 프로젝트 연결은 아직 확인되지 않았어요.") }
                        else { Text("아직 생성된 GitHub 요청은 확인되지 않았어요.") }
                        Button("기존 결과 다시 확인") { Task { await model.controller?.reconcileKnown() } }.disabled(locked)
                        if ["reviewed", "held"].contains(receipt.state), receipt.issueURL == nil { Button("현재 결과를 읽고 요약 수정") { Task { await model.controller?.prepareExisting(proposal: model.summary) } }.disabled(locked) }
                        if ["approved", "publishing", "issued"].contains(receipt.state) { Button("기존 요청의 게시 다시 확인 준비") { Task { await model.controller?.prepareExisting(retryPublication: true); if let proposal = model.state.operation?.proposal { model.summary = proposal } } }.disabled(locked) }
                        if receipt.issueURL != nil, model.canAssociate { Button("이 내부 요청에 연결하기") { Task { association = await model.prepareAssociation() } }.disabled(locked).accessibilityIdentifier("teamIntakeAssociate") }
                        else if receipt.issueURL != nil { Text("내부 요청 연결은 제품 운영자가 할 수 있어요. 게시된 요청은 그대로 유지돼요.").font(.caption) }
                    }
                }
                if op.phase == .preview || op.phase == .confirmed || op.phase == .uncertain {
                    Section { Text("확인 후 전송하면 공개 GitHub 요청이 바로 생성될 수 있어요. 서비스가 검토 안내를 덧붙일 수 있어요.")
                        Button(op.phase == .uncertain ? "같은 요약과 전송 번호로 다시 확인" : "이 요약으로 공개 요청 제안") { focused = nil; confirm = true }.disabled(locked || model.principal == nil || (op.phase != .uncertain && op.proposal != model.summary)).accessibilityIdentifier("teamIntakeSend")
                        if op.phase == .confirmed { Button("확인 취소") { model.controller?.cancelConfirmation() }.disabled(locked) }
                    }
                }
            }
            if model.state.operation?.phase != .uncertain, model.state.operation?.receipt.map({ ["reviewed", "held"].contains($0.state) && $0.issueURL == nil }) ?? true {
                Section("공개할 내용 작성") {
                    field("제목", \.title, "teamIntakeTitle"); field("목적", \.intent, "teamIntakeIntent"); field("요청하는 변경", \.requested_change, "teamIntakeChange")
                    TextField("확인 기준 (한 줄에 하나)", text: Binding(get: { model.summary.acceptance.joined(separator: "\n") }, set: { text in model.edit { $0.acceptance = text.split(separator: "\n").map(String.init) } }), axis: .vertical).focused($focused, equals: "teamIntakeAcceptance").accessibilityIdentifier("teamIntakeAcceptance")
                    if let repo = model.repository { Text("공개 위치: \(repo)") } else { Text("현재 제품의 공개 요청 위치를 확인하지 못했어요.") }
                    ShareLink("작성 내용 내보내기", item: model.exportText).accessibilityIdentifier("teamIntakeSummaryExport")
                    Button(model.state.operation?.receipt == nil ? "공개 요약 미리 보기" : "수정 요약 미리 보기") { focused = nil; Task {
                        if model.state.operation?.receipt == nil { await model.preview() }
                        else { await model.controller?.prepareExisting(proposal: model.summary) }
                    } }.disabled(locked || model.principal == nil || model.repository == nil).accessibilityIdentifier("teamIntakePreview")
                }.disabled(model.state.busy || model.principal == nil)
            }
            Button("새 로그인으로 기존 전송 복구") { Task { await model.controller?.recoverForCurrentSession() } }.disabled(locked || model.principal == nil)
            Button("연결 새로고침") { Task { await model.open() } }.disabled(model.state.busy).accessibilityIdentifier("teamIntakeRefresh")
        }.accessibilityIdentifier("teamIntakeForm").navigationTitle("공개 요청 제안").task { await model.open() }
        .onAppear { teamRenderCount("appear.intake") }
        .teamPublishCount(model.objectWillChange, "pub.intake").teamChangeCount(focused, "focus.intake")
        .onDisappear { if model.principal == nil { try? model.device?.cancel() } }
        .navigationDestination(isPresented: $association) { if let github = model.github { TeamGitHubScreen(model: github).equatable() } }
        .navigationBarBackButtonHidden(locked).interactiveDismissDisabled(locked)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("입력 완료") { focused = nil }.accessibilityIdentifier("teamIntakeKeyboardDone")
            }
            ToolbarItem(placement: .topBarTrailing) { if locked { Button("닫기") { leave = true } } }
        }
        .alert("현재 정책으로 기존 전송을 확인할까요?", isPresented: $confirmPolicy) { Button("취소", role: .cancel) {}; Button("같은 요약 복구에 동의") { Task { if let revision = policyToConfirm { await model.controller?.confirmRecoveryUnderCurrentPolicy(expectedPolicyRevision: revision) } } } } message: { Text("표시된 공개 요약과 위치, 전송 번호를 그대로 유지하며 게시 정책 \(policyToConfirm ?? "")에 동의해요. 동의만으로 전송하지 않으며, 이후 다시 확인 버튼을 눌러 주세요.") }
        .alert("이 내용으로 공개 요청을 제안할까요?", isPresented: $confirm) { Button("취소", role: .cancel) {}; Button("확인하고 전송") { Task { if model.state.operation?.phase == .preview { await model.controller?.confirm() }; await model.controller?.send() } } } message: { Text("표시된 Lab 계정과 공개 위치로 전송해요. GitHub 요청이 즉시 생성될 수 있어요.") }
        .alert("저장하지 못한 내용이 있어요", isPresented: $leave) { Button("계속 작성", role: .cancel) {}; Button("내보낸 뒤 닫기", role: .destructive) { dismiss() } } message: { Text("먼저 작성 내용을 내보내 주세요. 닫으면 저장하지 못한 내용은 사라질 수 있어요.") }
    }
}
