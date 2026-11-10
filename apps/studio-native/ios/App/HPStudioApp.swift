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
    @State private var showRecovery = false
    @State private var showReflection = false
    @State private var search = ""
    @State private var ageOK = false
    @State private var transferOK = false
    @State private var exportURL: URL?
    private let ink = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.45, green: 0.82, blue: 0.67, alpha: 1)
            : UIColor(red: 0.10, green: 0.20, blue: 0.18, alpha: 1)
    })
    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("생각을 실천으로").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        if let project = model.project {
                            Text(project.messages.isEmpty ? "마음에 남은 장면이\n있나요?" : project.title).font(.largeTitle.bold()).accessibilityIdentifier("projectTitle")
                            if let revision = project.revisions.last {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("내가 확인한 의도 · \(revision.revision)").font(.caption.bold())
                                    Text(revision.text).textSelection(.enabled)
                                }.padding().frame(maxWidth: .infinity, alignment: .leading).background(.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 18))
                            }
                            if project.messages.isEmpty { introduction }
                            Button { showReflection = true } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "book.pages").font(.title2)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text("생각 정리").font(.headline)
                                        Text("관찰한 것부터, 해보고 배운 것까지").font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption)
                                }.padding(.vertical, 12)
                            }.buttonStyle(.plain).accessibilityIdentifier("openReflection")
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
                            Button("첫 생각 기록하기") { model.newProject() }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground)).controlSize(.large).accessibilityIdentifier("startProject").disabled(model.readOnly)
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
                        Button(model.readOnly ? "읽지 못한 원본 내보내기" : "전체 기록 내보내기") { exportURL = model.export() }
                        if model.readOnly { Button("원본 보존 후 새로 시작") { showRecovery = true } }
                        if model.project != nil { Button("현재 기록 삭제", role: .destructive) { showDelete = true } }
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("기록 메뉴")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.project != nil {
                    VStack(spacing: 10) {
                        if !model.connected { Button("무료 AI 연결하고 질문 받기") { showConsent = true }.font(.callout).accessibilityIdentifier("connectAI") }
                        HStack(alignment: .bottom, spacing: 12) {
                            TextField("정리되지 않은 말도 괜찮아요", text: Binding(get: { model.draftText }, set: { text in model.editDraft(text) }), axis: .vertical)
                                .lineLimit(1...5).padding(12).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14)).accessibilityIdentifier("thoughtInput")
                            Button { model.send() } label: { Image(systemName: "arrow.up").font(.headline).padding(14) }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground))
                                .accessibilityLabel(model.connected ? "생각 보내기" : "생각 기록하기").accessibilityIdentifier("sendThought")
                                .disabled(model.busy || model.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.readOnly)
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
        .sheet(isPresented: $showReflection) { reflectionSheet }
        .sheet(isPresented: $showHistory) {
            NavigationStack {
                List {
                    Button("새 생각 기록하기") { model.newProject(); showHistory = false }
                    ForEach(model.visibleNotebook.projects.filter { $0.matches(search) }) { project in
                        Button { model.select(project.id); showHistory = false } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(project.displayTitle).font(.headline).foregroundStyle(.primary)
                                if !project.summary.isEmpty { Text(project.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
                                Text(project.updatedAt, style: .date).font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 6)
                        }
                    }
                }.searchable(text: $search, prompt: "생각이나 의도로 찾기")
                    .navigationTitle("나의 기록").toolbar { Button("닫기") { showHistory = false } }
            }
        }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) { if let exportURL { ShareSheet(url: exportURL) } }
        .confirmationDialog("원본을 보존하고 새로 시작할까요?", isPresented: $showRecovery, titleVisibility: .visible) {
            Button("원본 보존 후 새로 시작") { model.recover() }
        } message: { Text("읽지 못한 원본은 기기에 별도 보관해요. 먼저 원본 내보내기로 외부에 복사해 두세요.") }
        .confirmationDialog("이 기록을 삭제할까요?", isPresented: $showDelete, titleVisibility: .visible) {
            Button("이 기기에서 삭제", role: .destructive) { model.deleteProject() }
        } message: { Text("대화와 의도 변경 기록을 삭제해요. AI에 이미 전송된 내용은 이 작업으로 삭제되지 않아요.") }
    }
    private var reflectionSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Text("한 칸부터 적어도 괜찮아요. 순서나 정답은 없어요.")
                    Text("이 메모는 기기에 저장해요. AI에 자동으로 보내거나 내 의도로 확정하지 않아요.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(ReflectionField.allCases) { field in
                    Section(field.title) {
                        Text(field.question).font(.subheadline).foregroundStyle(.secondary)
                        TextField("내 말로 적기", text: Binding(get: { model.reflectionText(field) }, set: { model.editReflection($0, field: field) }), axis: .vertical)
                            .lineLimit(3...8).accessibilityLabel(field.question).accessibilityIdentifier("reflection-" + field.rawValue).disabled(model.readOnly)
                    }
                }
                if let error = model.error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("생각 정리").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("닫기") { showReflection = false } }
        }
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
                    TextEditor(text: Binding(get: { model.intentText }, set: { text in model.editDraft(text, intent: true) })).frame(minHeight: 140).accessibilityIdentifier("intentInput")
                    Button("내 의도로 확인") {
                        if model.confirmIntent() { showIntent = false }
                    }.disabled((try? Project.checked(model.intentText)) == nil).accessibilityIdentifier("confirmIntent")
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
