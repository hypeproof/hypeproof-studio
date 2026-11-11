import SwiftUI
import AVFoundation

struct StudioRoot: View {
    var body: some View {
        TabView {
            SharedConversationView().tabItem { Label("질문", systemImage: "bubble.left.and.bubble.right") }
            StudioHome().tabItem { Label("기기 기록", systemImage: "book.closed") }
        }.tint(.green)
    }
}
struct SharedConversationView: View {
    @StateObject private var model = SharedConversationModel()
    @StateObject private var voice = VoiceController()
    @Environment(\.scenePhase) private var phase
    @Environment(\.openURL) private var openURL
    @FocusState private var focused: Bool
    @State private var consent = false
    @State private var storageOK = false
    @State private var voiceConsent = false
    @State private var voiceConsentAccepted = false
    @State private var voiceConsentID: String?
    @State private var showContext = false
    @State private var voiceRequestID: String?
    @State private var voiceCompletionWaitStarted: Date?
    @State private var speakAnswers = true
    @State private var reviewRecording = false
    @State private var exportURL: URL?
    @State private var clearCache = false
    private var navigationContent: some View {
        NavigationStack {
            Group {
                if !model.signedIn { welcome }
                else if model.selected == nil { conversationList }
                else { timeline }
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(model.selected == nil ? "HP Studio" : model.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.selected != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { voice.stop(); focused = false; model.choose(nil) } label: { Label("대화 목록", systemImage: "chevron.left") }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if model.signedIn {
                            if model.selected != nil { Button("내 상황과 의도") { voice.stop(); focused = false; showContext = true } }
                            Button("새로 고침") { model.refresh() }
                            Button("이 기기의 연동 기록 내보내기") { exportURL = model.exportCache() }
                            Button("이 기기의 사본 삭제") { clearCache = true }
                            Button("로그아웃") { voice.stop(); model.logout() }.disabled(model.busy || model.syncing)
                        }
                        Toggle("음성 대화의 답변 읽기", isOn: $speakAnswers)
                        Toggle("내 목소리 다시 듣기", isOn: $reviewRecording)
                    } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("연동 설정")
                }
            }
        }
    }
    private var lifecycleContent: some View {
        navigationContent
        .onAppear { model.setVisible(phase == .active) }
        .onDisappear { voice.stop(); model.setVisible(false) }
        .onChange(of: phase) { _, value in
            model.setVisible(value == .active)
            if value == .background { voice.stop(); voiceConsentAccepted = false; voiceConsentID = nil; voiceConsent = false }
            else if value == .inactive, voice.turn.phase != .authorizing { voice.stop() }
            else if value == .active { voice.resumeIfActive() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification).receive(on: RunLoop.main)) { _ in voice.stop() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { notification in
            if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { voice.stop() }
        }
        .onChange(of: model.selected) { _, _ in voice.stop(); voiceConsentAccepted = false; voiceConsentID = nil; voiceConsent = false }
        .onChange(of: model.cache.request) { _, _ in reconcileVoiceReply() }
        .onChange(of: model.busy) { _, _ in reconcileVoiceReply() }
        .onChange(of: model.syncing) { _, syncing in if !syncing { reconcileVoiceReply() } }
        .onChange(of: model.cache.messages.last) { _, _ in reconcileVoiceReply() }
        .onChange(of: speakAnswers) { _, enabled in
            if !enabled && voice.turn.phase == .speaking { voice.stop(); voiceRequestID = nil }
            else { reconcileVoiceReply() }
        }
        .onChange(of: reviewRecording) { _, enabled in if !enabled { voice.stop() } }
    }
    var body: some View {
        lifecycleContent
        .sheet(isPresented: $consent) {
            NavigationStack {
                Form {
                    Section("같은 대화를 두 기기에서") {
                        Text("내가 보낸 글과 AI의 답변을 내 계정의 HypeProof Service에 저장해요. 같은 계정으로 로그인한 기존 데스크톱과 iPhone에서 이 대화를 열 수 있어요. 나이·직업을 꼭 알려주지 않아도 괜찮아요.")
                        Text("기기 사이 전송은 암호화됩니다. 서버가 대화 글을 저장하므로 종단간 암호화는 아닙니다. 질문 대화의 최근 글은 Service와 AI 제공자에게 전송되고 기존 계정의 AI 이용 한도가 적용돼요. 수업 기록이나 기록 없이 묻기는 공유하지 않아요.").font(.footnote)
                    }
                    Section {
                        Toggle("대화 글의 서버 저장과 연결 방식을 이해했어요", isOn: $storageOK)
                        Button("같은 계정으로 연결") { consent = false; model.login() }.disabled(!storageOK || !model.accountStorageReady)
                    }
                }.navigationTitle("내 이야기 이어가기").toolbar { Button("닫기") { consent = false } }
            }
        }
        .sheet(isPresented: $voiceConsent, onDismiss: {
            let accepted = voiceConsentAccepted && voiceConsentID == model.selected && phase == .active
            voiceConsentAccepted = false; voiceConsentID = nil
            if accepted { beginVoice(.conversation) }
        }) {
            NavigationStack {
                Form {
                    Section {
                        Text("말하기를 마치면 인식한 글을 지금 열린 대화로 보내요. 답변을 읽는 동안 마이크는 꺼져 있어요. 다음 차례는 직접 눌러 시작해요.")
                        Text("전송 전에 고치고 싶으면 ‘말로 적기’를 사용해 주세요. 질문 대화는 컴퓨터 없이도 답변을 받아요. 연결된 제작 작업은 컴퓨터가 필요해요.")
                    }
                    Button("말하고 보내기 시작") { voiceConsentAccepted = true; voiceConsent = false }.accessibilityIdentifier("linkedVoiceStart")
                    Button("나중에", role: .cancel) { voiceConsentAccepted = false; voiceConsent = false }.accessibilityIdentifier("linkedVoiceCancel")
                }.navigationTitle("음성 대화").navigationBarTitleDisplayMode(.inline)
            }.presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showContext) { contextSheet }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) { if let exportURL { ShareSheet(url: exportURL) } }
        .confirmationDialog("이 iPhone의 사본만 삭제할까요?", isPresented: $clearCache, titleVisibility: .visible) {
            Button("이 기기의 사본 삭제", role: .destructive) { voice.stop(); model.clearCache() }
        } message: { Text("서버의 계정 대화와 데스크톱의 기록은 남아요. 서버 기록은 계정의 데이터 관리 대상입니다.") }
    }
    private var welcome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 44)).foregroundStyle(.green).accessibilityHidden(true)
                Text("요즘 어떤 일에\n시간을 많이 쓰세요?").font(.largeTitle.bold())
                Text("일, 공부, 돌봄, 쉬는 시간까지 어떤 이야기든 좋아요. 아직 정리되지 않아도 괜찮아요.").foregroundStyle(.secondary)
                Text("정답을 정하는 사람은 나예요. 답하기 어려운 질문은 건너뛰어도 괜찮아요.").font(.callout)
                if let signIn = model.signIn {
                    VStack(alignment: .leading, spacing: 12) {
                        Button("계정 로그인 열기") { openURL(signIn.verification_uri_complete) }.buttonStyle(.borderedProminent)
                        Text("계정 화면에서 로그인을 마친 뒤 돌아오세요. 이야기는 이 앱에서 나눠요.").font(.footnote)
                        Button("연결 취소") { model.cancelLogin() }
                    }.padding().background(.background, in: RoundedRectangle(cornerRadius: 18))
                } else {
                    Button("내 계정으로 시작하기") { consent = true }.buttonStyle(.borderedProminent).controlSize(.large).disabled(model.busy || !model.accountStorageReady).accessibilityIdentifier("linkDesktop")
                    if !model.accountStorageReady {
                        Button("계정 저장소 다시 확인") { model.restoreAccount() }.accessibilityIdentifier("retryAccountStorage")
                        Text("iPhone 잠금을 해제한 뒤 다시 확인해 주세요. 기기의 메모는 계속 사용할 수 있어요.").font(.footnote)
                    }
#if DEBUG
                    if model.accountStorageVerified { Text("계정 저장소 확인됨").font(.caption).accessibilityIdentifier("accountStorageVerified") }
#endif
                }
                Text("같은 계정의 HP Studio에서 나눈 이야기를 이어갑니다. 질문 대화에는 컴퓨터를 켜 둘 필요가 없어요. 제작이 필요해지면 기존 데스크톱 앱을 안내해요.").font(.footnote).foregroundStyle(.secondary)
                if model.busy { ProgressView("연결 확인 중") }
                status
            }.padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }
    }
    private var conversationList: some View {
        List {
            Section {
                Text("하나의 작업, 하나의 대화").font(.headline)
                Text("나를 알아가는 대화와 기존 데스크톱에서 연결한 작업을 함께 볼 수 있어요.").font(.subheadline).foregroundStyle(.secondary)
            }
            if model.conversations.isEmpty {
                Section {
                    Text("연결된 대화가 아직 없어요.")
                    Text("컴퓨터의 HP Studio에서 원하는 대화를 열고 ‘iPhone과 이 대화 연결’을 선택해 주세요.").foregroundStyle(.secondary)
                    Button("다시 확인") { model.refresh() }
                }
            }
            ForEach(model.conversations) { item in
                Button { model.choose(item.id) } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).font(.headline).foregroundStyle(.primary)
                        Text(item.id == SharedConversationModel.personalID ? "어느 기기에서든 나누는 이야기" : "컴퓨터에서 이어지는 작업").font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 8)
                }
            }
            Section { status }
        }.refreshable { model.refresh() }
    }
    private var timeline: some View {
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if model.isReflection && model.cache.messages.isEmpty {
                        Text(model.opening).font(.largeTitle.bold()).accessibilityIdentifier("reflectionOpening")
                        Text(model.openingHint).foregroundStyle(.secondary)
                        Text("답하기 어려우면 다른 이야기부터 해도 좋아요.").font(.callout)
                    }
                    if model.isReflection && model.hasEarlierReflection { Text("최근 대화를 보여줘요. 이전 기록은 계정 내보내기에 남아 있어요.").font(.caption).foregroundStyle(.secondary) }
                    ForEach(model.cache.messages) { message in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(message.role == "user" ? "나의 생각" : "함께 생각하기").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Text(message.content).textSelection(.enabled)
                        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                            .background(message.role == "user" ? Color(uiColor: .secondarySystemGroupedBackground) : .green.opacity(0.07), in: RoundedRectangle(cornerRadius: 18))
                    }
                    if let request = model.cache.request {
                        VStack(alignment: .leading, spacing: 8) {
                            if request.status != "completed" { Text(request.text).textSelection(.enabled) }
                            Text(model.isReflection ? request.reflectionStatusLabel : request.statusLabel).font(.caption).foregroundStyle(.secondary)
                            if request.status == "local" { Button("같은 요청 다시 전송") { model.retry() }.disabled(model.busy || model.syncing) }
                            if !model.isReflection && request.status == "pending" { Button("대기 중인 요청 취소") { model.cancelPending() }.disabled(model.busy || model.syncing) }
                        if model.isReflection && request.status == "running" && Date().timeIntervalSince1970 * 1000 - request.updated_at > 120000 {
                                Button("완료되지 않은 요청 정리") { model.recoverReflection() }.disabled(model.busy || model.syncing)
                            }
                        }.padding().background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                    }
                    status
                    Color.clear.frame(height: 1).id("sharedBottom")
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.scrollDismissesKeyboard(.interactively)
                .onChange(of: model.cache.messages.count) { _, _ in withAnimation { scroll.scrollTo("sharedBottom", anchor: .bottom) } }
        }
        .safeAreaInset(edge: .bottom) { composer }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !voice.isActive {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        Button("다음 질문") { insert("지금까지 나눈 이야기에서 내가 더 생각해 볼 질문 하나를 해 주세요.") }
                        Button("이 질문은 건너뛰기") { insert("이 질문은 지금 답하고 싶지 않아요. 다른 관점이나 작은 다음 행동으로 이어가 주세요.") }
                        Button("작게 해보기") { insert("내가 원하는 변화를 확인할 수 있는 가장 작은 실험을 함께 정해 주세요.") }
                    }.buttonStyle(.bordered).font(.callout)
                }.disabled(!model.canSend || !model.cache.draft.isEmpty)
            }
            HStack(alignment: .bottom) {
                TextField("편하게 말하거나 적어 주세요", text: Binding(get: { model.cache.draft }, set: model.editDraft), axis: .vertical)
                    .lineLimit(1...5).focused($focused).disabled(voice.isCapturing).accessibilityIdentifier("sharedInput")
                Button { focused = false; voice.stop(); model.send() } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
                    .disabled(!model.canSend || model.syncing || (try? SharedRequest.checkedText(model.cache.draft)) == nil || voice.isCapturing).accessibilityLabel("대화 보내기").accessibilityIdentifier("sharedSend")
            }
            HStack {
                if voice.isActive {
                    if voice.turn.phase == .listening { Button("말하기 끝") { voice.endSpeech() } }
                    Spacer(); Button("음성 멈춤") { voice.stop() }
                } else {
                    Button { beginVoice(.dictation) } label: { Label("말로 적기", systemImage: "mic") }
                    Spacer()
                    Button("음성 대화") { focused = false; voiceConsentAccepted = false; voiceConsentID = model.selected; voiceConsent = true }.disabled(!model.canSend || !model.cache.draft.isEmpty)
                }
            }.buttonStyle(.bordered).disabled(model.busy && !voice.isActive)
            if !voice.status.isEmpty { Text(voice.status).font(.caption).foregroundStyle(.secondary) }
            if reviewRecording { Text("원음은 최대 30초만 메모리에 담아요. 파일이나 서버에 저장하지 않으며 화면을 나가거나 다음 녹음을 시작하면 지워요.").font(.caption2).foregroundStyle(.secondary) }
            if voice.canReplayOwnVoice {
                HStack {
                    Button("내 목소리 다시 듣기") { voice.replayOwnVoice() }.disabled(voice.isActive)
                    Spacer(); Button("녹음 지우기") { voice.stop() }
                }
            }
        }.padding(16).background(.regularMaterial)
    }
    private var contextSheet: some View {
        NavigationStack {
            Form {
                Section {
                    Text("내가 알려주고 싶은 것만 적어요. AI가 성격이나 능력을 판정하는 프로필이 아니에요. 언제든 고치거나 비워 둘 수 있어요.")
                    Text("지금은 이 iPhone에 저장해요. ‘대화에 공유할 글 만들기’를 누른 뒤 직접 보내면 컴퓨터와 같은 대화에 남고 다음 질문의 맥락이 돼요.").font(.footnote).foregroundStyle(.secondary)
                }
                contextField("goal", title: "무엇이 달라지면 좋을까요?")
                contextField("audience", title: "누구의 어떤 불편을 보았나요?")
                contextField("experience", title: "어디까지 해 봤고 무엇이 어려운가요?")
                contextField("style", title: "예시, 짧은 질문, 천천히 설명 중 무엇이 편한가요?")
                Section {
                    Button("대화에 공유할 글 만들기") { if model.shareContextDraft() { showContext = false; focused = true } }
                    Text("만들 준비가 되면 같은 대화를 컴퓨터에서 열어 작은 MVP로 이어가세요. 파일 변경이나 배포에 필요한 확인은 컴퓨터에서 해요.").font(.footnote).foregroundStyle(.secondary)
                }
                status
            }.navigationTitle("내 상황과 의도").navigationBarTitleDisplayMode(.inline).toolbar { Button("닫기") { showContext = false } }
        }
    }
    private func contextField(_ key: String, title: String) -> some View {
        Section(title) {
            TextField("비워 두어도 괜찮아요", text: Binding(get: { model.cache.context?[key] ?? "" }, set: { model.editContext(key, value: $0) }), axis: .vertical).lineLimit(2...5)
        }
    }
    @ViewBuilder private var status: some View {
        if let error = model.error { Text(error).font(.callout).foregroundStyle(.red).accessibilityIdentifier("sharedError") }
        if !model.notice.isEmpty { Text(model.notice).font(.caption).foregroundStyle(.secondary) }
        if model.syncing { ProgressView("대화 확인 중").font(.caption) }
    }
    private func insert(_ text: String) { voice.stop(); focused = true; guard model.cache.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { model.error = "작성 중인 글을 남겨 두었어요. 먼저 보내거나 고쳐 주세요."; return }; model.editDraft(text) }
    private func beginVoice(_ mode: VoiceTurn.Mode) {
        guard let id = model.selected, model.canSend, !model.syncing else { return }
        focused = false; voiceRequestID = nil; voiceCompletionWaitStarted = nil; let prefix = model.cache.draft
        voice.start(projectID: id, mode: mode, reviewRecording: reviewRecording, transcript: { text in
            guard model.selected == id else { return }
            model.editDraft(prefix.isEmpty ? text : prefix + "\n" + text)
        }, final: { _, mode in
            guard model.selected == id else { return false }
            if mode == .dictation { return true }
            guard model.canSend, !model.syncing else { return false }
            model.send(); voiceRequestID = model.cache.request?.id; return model.cache.request?.outstanding == true
        })
    }
    private func reconcileVoiceReply() {
        guard voice.turn.phase == .waiting, let requestID = voiceRequestID, let id = model.selected else { return }
        let completedWaitExpired = voiceCompletionWaitStarted.map { Date().timeIntervalSince($0) >= 30 } ?? false
        switch ConversationVoiceReply.resolve(id: requestID, request: model.cache.request, messages: model.cache.messages, sending: model.busy, readAloud: speakAnswers, completedWaitExpired: completedWaitExpired) {
        case .waiting:
            // Desktop event and request reads are separate. Allow the next poll to deliver its answer.
            if model.cache.request?.status == "completed" && voiceCompletionWaitStarted == nil { voiceCompletionWaitStarted = Date() }
        case .speak(let text): voiceRequestID = nil; voice.reply(text, projectID: id)
        case .finished: voiceRequestID = nil; voice.stop()
        case .needsAttention:
            voiceRequestID = nil; voice.fail("음성 답변 기다리기를 멈췄어요. 보낸 말과 전송 상태를 대화에서 확인해 주세요.")
        }
    }
}
