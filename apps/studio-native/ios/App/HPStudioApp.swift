import SwiftUI

@main struct HPStudioApp: App {
    var body: some Scene { WindowGroup { StudioHome() } }
}
struct StudioHome: View {
    @StateObject private var model = StudioModel()
    @State private var showConsent = false
    @State private var showIntent = false
    @State private var showHistory = false
    @State private var showDelete = false
    @State private var ageOK = false
    @State private var transferOK = false
    @State private var exportURL: URL?
    private let ink = Color(red: 0.10, green: 0.20, blue: 0.18)
    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        HStack { Text("생각을 실천으로").font(.caption.weight(.semibold)); Spacer(); Text("NATIVE PREVIEW").font(.caption2.monospaced()) }.foregroundStyle(.secondary)
                        if let project = model.project {
                            Text(project.messages.isEmpty ? "마음에 남은 장면이\n있나요?" : project.title).font(.largeTitle.bold()).accessibilityIdentifier("projectTitle")
                            if let revision = project.revisions.last {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("내가 확인한 의도 · \(revision.revision)").font(.caption.bold())
                                    Text(revision.text).textSelection(.enabled)
                                }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 18))
                            }
                            if project.messages.isEmpty { introduction }
                            ForEach(project.messages) { message in
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(message.role == "user" ? "나의 생각" : "함께 생각하기").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    Text(message.content).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                                }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(message.role == "user" ? Color(uiColor: .secondarySystemGroupedBackground) : .green.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
                            }
                            if let error = model.error { Text(error).font(.callout).foregroundStyle(.red).accessibilityIdentifier("statusError") }
                            if model.busy {
                                HStack { ProgressView(); Text("생각을 이어가고 있어요"); Spacer(); Button("취소") { model.cancel() } }.font(.callout)
                            }
                            if !model.busy, project.messages.last?.role == "user", model.connected {
                                Button("이 생각에 질문 받기") { model.ask() }.accessibilityIdentifier("askAgain")
                            }
                            if !project.messages.isEmpty {
                                Button { showIntent = true } label: { Label("지금의 의도 정리하기", systemImage: "square.and.pencil") }.buttonStyle(.bordered).accessibilityIdentifier("openIntent")
                            }
                        } else {
                            Text("질문에서 시작하는\n나의 다음 한 걸음").font(.largeTitle.bold())
                            introduction
                            Button("첫 생각 기록하기") { model.newProject() }.buttonStyle(.borderedProminent).controlSize(.large).accessibilityIdentifier("startProject").disabled(model.readOnly)
                            if let error = model.error { Text(error).foregroundStyle(.red) }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
                }.onChange(of: model.project?.messages.count) { _, _ in withAnimation { scroll.scrollTo("bottom", anchor: .bottom) } }
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("HP Studio").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button { showHistory = true } label: { Image(systemName: "square.stack") }.accessibilityLabel("나의 기록") }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("새 생각") { model.newProject() }
                        Button(model.connected ? "AI 연결 해제" : "무료 AI 연결") { if model.connected { model.disconnect() } else { showConsent = true } }
                        Button("전체 기록 내보내기") { exportURL = model.export() }
                        if model.project != nil { Button("현재 기록 삭제", role: .destructive) { showDelete = true } }
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("기록 메뉴")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.project != nil {
                    VStack(spacing: 10) {
                        if !model.connected { Button("무료 AI 연결하고 질문 받기") { showConsent = true }.font(.callout).accessibilityIdentifier("connectAI") }
                        HStack(alignment: .bottom, spacing: 12) {
                            TextField("정리되지 않은 말도 괜찮아요", text: Binding(get: { model.project?.draft ?? "" }, set: { text in model.update { $0.draft = text } }), axis: .vertical)
                                .lineLimit(1...5).padding(12).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14)).accessibilityIdentifier("thoughtInput")
                            Button { model.send() } label: { Image(systemName: "arrow.up").font(.headline).padding(14) }.buttonStyle(.borderedProminent)
                                .accessibilityLabel(model.connected ? "생각 보내기" : "생각 기록하기").accessibilityIdentifier("sendThought")
                                .disabled(model.busy || (model.project?.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) || model.readOnly)
                        }
                        Text(model.connected ? "현재 생각의 대화와 확인한 의도를 AI에 보내요." : "AI 연결 전에는 이 기기에만 기록해요.").font(.caption2).foregroundStyle(.secondary)
                    }.padding(.horizontal, 20).padding(.vertical, 12).background(.regularMaterial)
                }
            }
        }.tint(ink)
        .sheet(isPresented: $showConsent) {
            NavigationStack {
                Form {
                    Section("생각을 이어갈 질문") { Text("현재 생각의 최근 대화 20개와 확인한 의도를 HypeProof Service 및 AI 제공자에게 보내 답변을 받아요. 무료 사용량에는 비용 한도가 있어요. 연결 없이도 기록과 의도 정리는 가능해요.") }
                    Section { Toggle("만 14세 이상이에요", isOn: $ageOK); Toggle("위 내용의 AI 전송에 동의해요", isOn: $transferOK) }
                    Button("동의하고 연결") { showConsent = false; model.connect() }.disabled(!ageOK || !transferOK)
                }.navigationTitle("무료 AI 연결").toolbar { Button("닫기") { showConsent = false } }
            }.presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showIntent) { intentSheet }
        .sheet(isPresented: $showHistory) {
            NavigationStack {
                List {
                    Button("새 생각 기록하기") { model.newProject(); showHistory = false }
                    ForEach(model.notebook.projects) { project in Button(project.title) { model.select(project.id); showHistory = false } }
                }.navigationTitle("나의 기록").toolbar { Button("닫기") { showHistory = false } }
            }
        }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) { if let exportURL { ShareSheet(url: exportURL) } }
        .confirmationDialog("이 기록을 삭제할까요?", isPresented: $showDelete, titleVisibility: .visible) {
            Button("이 기기에서 삭제", role: .destructive) { model.deleteProject() }
        } message: { Text("대화와 의도 변경 기록을 삭제해요. AI에 이미 전송된 내용은 이 작업으로 삭제되지 않아요.") }
    }
    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("주변 사람의 작은 불편, 바꾸고 싶은 일, 아직 이름 붙이지 못한 생각부터 시작해요.").font(.body).foregroundStyle(.secondary)
            Text("관찰 → 다른 관점 → 작은 실천 → 성찰").font(.callout.weight(.medium))
            Text("동양철학의 성찰과 배움에서 출발합니다. 답을 정하는 사람은 나예요.").font(.footnote).foregroundStyle(.secondary)
        }
    }
    private var intentSheet: some View {
        NavigationStack {
            Form {
                Section("지금 내가 원하는 변화") {
                    Text("누구를 위해, 무엇을 바꾸고, 어떤 작은 행동으로 확인할지 내 말로 적어 보세요.")
                    TextEditor(text: Binding(get: { model.project?.intentDraft ?? "" }, set: { text in model.update { $0.intentDraft = text } })).frame(minHeight: 140).accessibilityIdentifier("intentInput")
                    Button("내 의도로 확인") {
                        guard let text = model.project?.intentDraft, (try? Project.checked(text)) != nil else { return }
                        if model.update({ try $0.confirm(text) }) { showIntent = false }
                    }.disabled((try? Project.checked(model.project?.intentDraft ?? "")) == nil).accessibilityIdentifier("confirmIntent")
                }
                if let revisions = model.project?.revisions, !revisions.isEmpty {
                    Section("생각이 바뀐 기록") {
                        ForEach(Array(revisions.enumerated()), id: \.offset) { _, revision in VStack(alignment: .leading) { Text("\(revision.revision)번째 확인").font(.caption); Text(revision.text) } }
                    }
                }
            }.navigationTitle("나의 의도").toolbar { Button("닫기") { showIntent = false } }
        }
    }
}
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
