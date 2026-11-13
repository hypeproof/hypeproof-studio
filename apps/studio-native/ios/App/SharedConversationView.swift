import SwiftUI
import AVFoundation

struct StudioRoot: View {
    var body: some View {
        SharedConversationView().tint(ConversationStyle.accent)
#if DEBUG
            // XCTest's AppleInterfaceStyle launch preference does not change
            // iOS appearance reliably. Exercise the real SwiftUI environment.
            .preferredColorScheme(NativeJourneyFixture.enabled && ProcessInfo.processInfo.arguments.contains("--journey-dark") ? .dark : nil)
#endif
    }
}
// Desktop chat uses its host canvas, quiet assistant prose and a rounded composer.
// Keep those semantic roles with native Dynamic Type and system light/dark surfaces.
private enum ConversationStyle {
    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 213/255, green: 242/255, blue: 121/255, alpha: 1)
            : UIColor(red: 32/255, green: 44/255, blue: 36/255, alpha: 1)
    })
    static let onAccent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 24/255, green: 35/255, blue: 28/255, alpha: 1)
            : UIColor(red: 244/255, green: 246/255, blue: 240/255, alpha: 1)
    })
    static let canvas = Color(uiColor: .systemBackground)
    static let surface = Color(uiColor: .secondarySystemBackground)
}
private struct ConversationTimelineLayout: Equatable {
    let generation: UUID
    let conversation: String?
    let tail: SharedMessage?
    let localRequestID: String?
    let content: CGRect
    let viewportHeight: CGFloat
    var atLatest: Bool { content.maxY - viewportHeight <= 48 }
}
private struct ConversationTimelinePreference: PreferenceKey {
    static let defaultValue: ConversationTimelineLayout? = nil
    static func reduce(value: inout ConversationTimelineLayout?, nextValue: () -> ConversationTimelineLayout?) {
        value = nextValue() ?? value
    }
}

struct SharedConversationView: View {
    @StateObject private var model = SharedConversationModel()
    @StateObject private var voice = VoiceController()
    @Environment(\.scenePhase) private var phase
    @Environment(\.openURL) private var openURL
    @FocusState private var focused: Bool
    @State private var showContext = false
    @State private var voiceRequestID: String?
    @State private var voiceCompletionWaitStarted: Date?
    @State private var speakAnswers = true
    @State private var reviewRecording = false
    @State private var exportURL: URL?
    @State private var clearCache = false
    @State private var showHistory = false
    @State private var showNotebook = false
    @State private var notebookAfterHistory = false
    @State private var showPrivacy = false
    @State private var timelineGeneration = UUID()
    @State private var timelineLayout: ConversationTimelineLayout?
    @State private var timelineFollowing = true
    @State private var timelineProgrammatic = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.colorScheme) private var colorScheme
    private var navigationContent: some View {
        NavigationStack {
            Group {
                if !model.signedIn { welcome }
                else if model.selected == nil { waitingForConversation }
                else { timeline }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .background(ConversationStyle.canvas)
            .navigationTitle(!model.signedIn || model.isReflection ? "나의 질문" : model.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { voice.stop(); focused = false; showHistory = true } label: {
                        Image(systemName: "sidebar.left").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("대화 기록").accessibilityIdentifier("conversationHistory")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if model.signedIn {
                            if model.selected != nil { Button("내 상황과 의도") { voice.stop(); focused = false; showContext = true } }
                            Button("새로 고침") { model.refresh() }
                            Button("이 기기의 연동 기록 내보내기") { voice.stop(); focused = false; exportURL = model.exportCache() }
                            Button("이 기기의 사본 삭제") { voice.stop(); focused = false; clearCache = true }
                            Button("로그아웃") { voice.stop(); model.logout() }.disabled(model.busy || model.syncing)
                        }
                        Button("이 기기의 기록") { voice.stop(); focused = false; showNotebook = true }.accessibilityIdentifier("localNotebook")
                        Button("대화와 개인정보") { voice.stop(); focused = false; showPrivacy = true }
#if DEBUG
                        if NativeJourneyFixture.longHistory {
                            Button("Simulate remote reply") { NativeJourneyFixture.advanceHistory() }.accessibilityIdentifier("nativeJourneyAdvanceHistory")
                        }
#endif
                        Toggle("음성 대화의 답변 읽기", isOn: $speakAnswers)
                        Toggle("내 목소리 다시 듣기", isOn: $reviewRecording)
                    } label: { Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("대화 설정").accessibilityIdentifier("conversationSettings")
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
            if value == .background { voice.stop() }
            else if value == .inactive, voice.turn.phase != .authorizing { voice.stop() }
            else if value == .active { voice.resumeIfActive() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification).receive(on: RunLoop.main)) { _ in voice.stop() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { notification in
            if let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { voice.stop() }
        }
        .onChange(of: model.selected) { _, _ in voice.stop() }
        .onChange(of: model.signedIn) { _, _ in voice.stop() }
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
#if DEBUG
        .overlay(alignment: .topLeading) { journeyDiagnostics }
#endif
        .sheet(isPresented: $showContext) { contextSheet }
        .sheet(isPresented: $showHistory, onDismiss: {
            if notebookAfterHistory { notebookAfterHistory = false; showNotebook = true }
        }) { historySheet }
        .sheet(isPresented: $showNotebook) {
            StudioHome(onReturnToConversation: { showNotebook = false })
        }
        .sheet(isPresented: $showPrivacy) {
            NavigationStack {
                List {
                    Text("보내기 전의 글은 이 기기에 보관해요. 로그인만으로 AI에 보내지 않아요.")
                    Text("직접 보낸 글과 AI 답변은 내 계정에 저장되어 같은 계정의 기기에서 이어집니다. 질문에 필요한 최근 글은 AI 제공자에게 전달돼요.")
                    Text("질문 대화에는 컴퓨터를 켜 둘 필요가 없어요. 만들고 싶은 것이 구체화되면 기존 데스크톱 HP Studio에서 이어갈 수 있어요.")
                }.navigationTitle("대화와 개인정보").navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("닫기") { showPrivacy = false } }
            }
        }
        .sheet(isPresented: Binding(get: { exportURL != nil }, set: { if !$0 { exportURL = nil } })) { if let exportURL { ShareSheet(url: exportURL) } }
        .confirmationDialog("이 iPhone의 사본만 삭제할까요?", isPresented: $clearCache, titleVisibility: .visible) {
            Button("이 기기의 사본 삭제", role: .destructive) { voice.stop(); model.clearCache() }
        } message: { Text("서버의 계정 대화와 데스크톱의 기록은 남아요. 서버 기록은 계정의 데이터 관리 대상입니다.") }
    }
    private var welcome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                openingQuestion
                if !model.accountStorageReady { Button("계정 저장소 다시 확인") { model.restoreAccount() }.accessibilityIdentifier("retryAccountStorage") }
#if DEBUG
                if model.accountStorageVerified { Text("계정 저장소 확인됨").font(.caption).accessibilityIdentifier("accountStorageVerified") }
#endif
                status
            }.padding(.horizontal, 24).padding(.top, 36).padding(.bottom, 20)
                .frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }.scrollDismissesKeyboard(.interactively).accessibilityIdentifier("conversationTimeline")
    }
    private var openingQuestion: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.signedIn ? model.opening : "요즘 어떤 일에 시간을 많이 쓰세요?")
                .font(.title2.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(model.signedIn ? "reflectionOpening" : "firstQuestion")
            Text("아직 정리되지 않아도 괜찮아요. 다른 이야기부터 시작해도 좋아요.")
                .font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
    private var waitingForConversation: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                openingQuestion
                status
                if !model.syncing { Button("대화 다시 불러오기") { model.refresh() } }
            }.padding(24).frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity)
        }
    }
    private var historySheet: some View {
        NavigationStack {
            List {
                if model.signedIn {
                    ForEach(model.conversations) { item in
                        Button { model.choose(item.id); showHistory = false } label: {
                            Label(item.title, systemImage: item.id == SharedConversationModel.personalID ? "bubble.left.and.bubble.right" : "desktopcomputer")
                                .foregroundStyle(.primary).padding(.vertical, 8)
                        }
                    }
                    if model.conversations.isEmpty { Text("대화 기록을 아직 불러오지 못했어요.").foregroundStyle(.secondary); Button("다시 확인") { model.refresh() } }
                } else {
                    Text("로그인하면 같은 계정의 대화 기록을 볼 수 있어요.").foregroundStyle(.secondary)
                }
                Section { Button { notebookAfterHistory = true; showHistory = false } label: { Label("이 기기의 기록", systemImage: "book.closed") }.accessibilityIdentifier("historyLocalNotebook") }
            }
            .navigationTitle("대화 기록").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("닫기") { showHistory = false } }
        }
    }
    private var timeline: some View {
        GeometryReader { viewport in
        ScrollViewReader { scroll in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    if model.isReflection && model.cache.messages.isEmpty {
                        openingQuestion.padding(.top, 16)
                    }
                    if model.isReflection && model.hasEarlierReflection { Text("최근 대화를 보여줘요. 이전 기록은 계정 내보내기에 남아 있어요.").font(.caption).foregroundStyle(.secondary) }
                    ForEach(model.cache.messages) { message in
                        if message.role == "user" {
                            HStack {
                                Spacer(minLength: 32)
                                Text(message.content).textSelection(.enabled).lineSpacing(4)
                                    .padding(.horizontal, 16).padding(.vertical, 12)
                                    .background(ConversationStyle.surface, in: UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18))
                                    .accessibilityIdentifier("sharedMessage")
                                    .accessibilityLabel("내 메시지. \(message.content)")
                            }
                        } else {
                            Text(message.content).textSelection(.enabled).lineSpacing(5)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
                                .accessibilityIdentifier("sharedReply")
                                .accessibilityLabel("HP Studio의 답변. \(message.content)")
                        }
                    }
                    if let request = model.cache.request {
                        VStack(alignment: .leading, spacing: 8) {
                            if request.status != "completed" && (!model.isReflection || !model.cache.messages.contains(where: { $0.id == request.id && $0.role == "user" && $0.content == request.text })) {
                                Text(request.text).textSelection(.enabled)
                            }
                            Text(model.isReflection ? request.reflectionStatusLabel : request.statusLabel).font(.caption).foregroundStyle(.secondary)
                            if request.status == "local" { Button("다시 보내기") { model.retry() }.disabled(model.busy || model.syncing).accessibilityIdentifier("sharedRetry") }
                            if model.isReflection && request.status == "failed" {
                                Button { voice.stop(); if model.restoreFailedReflectionDraft() { focused = true } } label: {
                                    Text("입력란에 가져오기").frame(minHeight: 44)
                                }
                                .buttonStyle(.bordered).font(.callout)
                                .disabled(!model.canRestoreFailedReflectionDraft).accessibilityIdentifier("restoreFailedReflectionDraft")
                                if !model.draftText.isEmpty { Text("작성 중인 글을 먼저 확인해 주세요. 보낸 이야기는 그대로 남아 있어요.").font(.caption).foregroundStyle(.secondary) }
                            }
                            if model.isReflection && request.outstanding {
                                Button {
                                    voice.stop(); voiceRequestID = nil; voiceCompletionWaitStarted = nil
                                    model.stopReflection()
                                } label: {
                                    Label(model.stoppingReflection ? "중지 확인 중" : "답변 중지", systemImage: "stop.fill").frame(minHeight: 44)
                                }
                                .buttonStyle(.bordered).disabled(!model.canStopReflection)
                                .accessibilityIdentifier("sharedResponseStop")
                            }
                            if !model.isReflection && request.status == "pending" { Button("대기 중인 요청 취소") { model.cancelPending() }.disabled(model.busy || model.syncing) }
                        if model.isReflection && request.status == "running" && Date().timeIntervalSince1970 * 1000 - request.updated_at > 120000 {
                                Button("완료되지 않은 요청 정리") { model.recoverReflection() }.disabled(model.busy || model.syncing)
                            }
                        }.padding(.vertical, 8)
                    }
                    status
                    Color.clear.frame(height: 1).id("sharedBottom")
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
                    .background {
                        GeometryReader { content in
                            Color.clear.preference(key: ConversationTimelinePreference.self, value: ConversationTimelineLayout(
                                generation: timelineGeneration, conversation: model.selected, tail: model.cache.messages.last,
                                localRequestID: model.cache.request?.status == "local" ? model.cache.request?.id : nil,
                                content: content.frame(in: .named("conversationTimelineViewport")), viewportHeight: viewport.size.height))
                        }
                    }
            }.coordinateSpace(name: "conversationTimelineViewport")
                .scrollDismissesKeyboard(.interactively).accessibilityIdentifier("conversationTimeline")
                .onAppear {
                    // Cached account data can precede the first layout. A new
                    // appearance also fences a later account with the same IDs.
                    timelineGeneration = UUID(); timelineLayout = nil
                    timelineFollowing = true; timelineProgrammatic = false
                }
                .onPreferenceChange(ConversationTimelinePreference.self) { layout in
                    if let layout { positionTimeline(layout, scroll: scroll) }
                }
                .simultaneousGesture(DragGesture().onChanged { _ in
                    timelineProgrammatic = false; timelineFollowing = false
                })
                .overlay(alignment: .bottomTrailing) {
                    if !timelineFollowing, timelineLayout?.atLatest == false {
                        Button { latestTimeline(scroll, animated: true) } label: {
                            Label("최신 메시지", systemImage: "arrow.down").frame(minHeight: 44)
                        }.buttonStyle(.borderedProminent).font(.callout)
                            .padding(.trailing, 20).padding(.bottom, 12).accessibilityIdentifier("conversationLatest")
                    }
                }
        }
        }
    }
    private func latestTimeline(_ scroll: ScrollViewProxy, animated: Bool = false) {
        timelineFollowing = true; timelineProgrammatic = timelineLayout?.atLatest != true
        // Automatic following is instant, like the desktop. Only a deliberate
        // catch-up press may animate, and Reduce Motion always disables it.
        withAnimation(animated && !reduceMotion ? .easeOut(duration: 0.2) : nil) {
            scroll.scrollTo("sharedBottom", anchor: .bottom)
        }
    }
    private func positionTimeline(_ next: ConversationTimelineLayout, scroll: ScrollViewProxy) {
        guard next.generation == timelineGeneration, next.conversation == model.selected,
              next.viewportHeight > 0, next.content.height > 0 else { return }
        let old = timelineLayout
        let changedConversation = old == nil || old?.generation != next.generation || old?.conversation != next.conversation
        let sent = next.localRequestID != nil && old?.localRequestID != next.localRequestID
        let changedContent = old?.tail != next.tail || old?.content.height != next.content.height || old?.viewportHeight != next.viewportHeight
        let moved = old.map { abs($0.content.minY - next.content.minY) > 0.5 } ?? false
        timelineLayout = next
        if changedConversation || sent { latestTimeline(scroll); return }
        if timelineProgrammatic {
            if next.atLatest { timelineProgrammatic = false }
            else if changedContent { latestTimeline(scroll) }
            return
        }
        // A stable-layout scroll includes touch, keyboard and accessibility
        // navigation. Content/keyboard/font changes alone are not reader intent.
        if moved && !changedContent { timelineFollowing = next.atLatest }
        if changedContent && timelineFollowing { latestTimeline(scroll) }
        else if next.atLatest { timelineFollowing = true }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.pendingGuestDraft != nil && model.signedIn {
                HStack(alignment: .top) {
                    Text("로그인 전에 쓴 글도 이 기기에 남아 있어요.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("가져오기") { voice.stop(); if model.restoreGuestDraft() { focused = true } }
                        .disabled(!model.canRestoreGuestDraft).accessibilityIdentifier("restoreGuestDraft")
                }
            }
            if !voice.isActive && !focused && model.draftText.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if model.cache.messages.isEmpty {
                            Button("요즘 신경 쓰이는 일") { insert("요즘 신경 쓰이는 일은 ") }.accessibilityIdentifier("starterConcern")
                            Button("해보고 싶은 것") { insert("지금 해보고 싶은 것은 ") }.accessibilityIdentifier("starterWish")
                        } else {
                            Button("다른 질문") { insert("다른 관점에서 생각할 수 있는 질문을 해 주세요.") }
                            Button("작게 해보기") { insert("내가 원하는 변화를 확인할 수 있는 가장 작은 실험을 함께 정해 주세요.") }
                        }
                    }.buttonStyle(.bordered).font(.callout).controlSize(.large)
                }.disabled(!model.canEditDraft)
            }
            VStack(alignment: .leading, spacing: 8) {
                TextField("메시지를 입력하세요", text: Binding(get: { model.draftText }, set: model.editDraft), axis: .vertical)
                    .font(.body).lineLimit(1...(textSize.isAccessibilitySize ? 2 : 5)).padding(.horizontal, 4).padding(.top, 4)
                    .focused($focused).disabled(voice.isCapturing || !model.canEditDraft).accessibilityIdentifier("sharedInput")
                    .accessibilityLabel("메시지")
                HStack(spacing: 4) {
                    if voice.isActive {
                        Label(voice.isCapturing ? "듣고 있어요" : "대화 중", systemImage: voice.isCapturing ? "waveform" : "speaker.wave.2").font(.callout)
                        Spacer()
                        Button("멈춤") { voice.stop() }.frame(minWidth: 44, minHeight: 44).accessibilityLabel("음성 멈춤").accessibilityIdentifier("sharedVoiceStop")
                    } else {
                        Button { beginVoice(.dictation) } label: { Image(systemName: "mic").font(.system(size: 20)).frame(width: 44, height: 44) }
                            .disabled(!model.canEditDraft || model.busy).accessibilityLabel("말로 적기").accessibilityIdentifier("sharedDictate")
                        Button { if model.signedIn { beginVoice(.conversation) } else { startLogin() } } label: {
                            Image(systemName: "waveform").font(.system(size: 20)).frame(width: 44, height: 44)
                        }.accessibilityLabel(model.signedIn ? "음성 대화" : "로그인하고 음성 대화")
                            .accessibilityIdentifier("sharedVoice")
                            .disabled(model.signedIn ? !model.canSend || !model.draftText.isEmpty : model.busy || !model.accountStorageReady)
                        Spacer(minLength: 0)
                        if model.signedIn {
                            Button { focused = false; voice.stop(); model.send() } label: {
                                Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 44, height: 44)
                                    .background(model.canSend && !model.draftText.isEmpty ? ConversationStyle.accent : ConversationStyle.surface, in: Circle())
                                    .foregroundStyle(model.canSend && !model.draftText.isEmpty ? ConversationStyle.onAccent : Color.secondary)
                            }.disabled(!model.canSend || (try? SharedRequest.checkedText(model.draftText)) == nil)
                                .accessibilityLabel("대화 보내기").accessibilityIdentifier("sharedSend")
                        } else if model.busy {
                            ProgressView().padding(.horizontal, 8)
                            Button("취소") { model.cancelLogin() }.frame(minHeight: 44).accessibilityLabel("로그인 취소").accessibilityIdentifier("accountCancel")
                        } else {
                            Button("로그인") { startLogin() }.font(.callout.weight(.semibold))
                                .padding(.horizontal, 16).frame(minHeight: 44)
                                .background(ConversationStyle.accent, in: Capsule()).foregroundStyle(ConversationStyle.onAccent)
                                .disabled(!model.accountStorageReady).accessibilityLabel("로그인하고 대화하기").accessibilityIdentifier("linkDesktop")
                        }
                    }
                }.buttonStyle(.plain)
            }.padding(12).background(ConversationStyle.surface, in: RoundedRectangle(cornerRadius: 20))
            if !model.signedIn {
                if !focused || model.busy {
                    Text(model.busy ? (model.loginStatus.isEmpty ? "로그인을 마무리하고 있어요. 쓴 글은 남아 있어요." : model.loginStatus) : "먼저 적어도 좋아요. 로그인 후 직접 보내면 AI가 답해요.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                // The disclosure is visible before editing; while the keyboard
                // is up it remains in Settings, leaving space for the thought.
                if !focused {
                    Button { voice.stop(); focused = false; showPrivacy = true } label: {
                        Text("보낸 대화는 계정에 저장되고 AI에 전달돼요. 자세히").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                    }.buttonStyle(.plain).accessibilityIdentifier("conversationPrivacy")
                }
            }
            if !voice.status.isEmpty { Text(voice.status).font(.caption).foregroundStyle(.secondary) }
            if reviewRecording { Text("원음은 최대 30초만 메모리에 담아요. 파일이나 서버에 저장하지 않으며 화면을 나가거나 다음 녹음을 시작하면 지워요.").font(.caption2).foregroundStyle(.secondary) }
            if voice.canReplayOwnVoice {
                HStack {
                    Button("내 목소리 다시 듣기") { voice.replayOwnVoice() }.disabled(voice.isActive)
                    Spacer(); Button("녹음 지우기") { voice.stop() }
                }
            }
        }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 8)
            .frame(maxWidth: 672).frame(maxWidth: .infinity).background(ConversationStyle.canvas)
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
                    Text("만들 준비가 되면 컴퓨터의 기존 HP Studio에서 ‘나의 질문’을 열고 ‘만들기로 이어가기’를 선택하세요. 확인한 의도만 새 제작 작업의 초안으로 옮겨요. 보내기와 파일 변경·배포 확인은 컴퓨터에서 해요.").font(.footnote).foregroundStyle(.secondary)
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
        if !model.notice.isEmpty { Text(model.notice).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("sharedStatus") }
        if model.syncing { ProgressView("대화 확인 중").font(.caption).accessibilityIdentifier("sharedSyncing") }
    }
#if DEBUG
    // Overlay diagnostics never participate in transcript/composer measurement.
    // Explicit AX values retain the same machine-readable seam without drawing
    // JSON or appearance words in native screenshots. Release has no overlay.
    @ViewBuilder private var journeyDiagnostics: some View {
        if NativeJourneyFixture.enabled {
            VStack(spacing: 0) {
                if NativeJourneyFixture.responseStop {
                    // Observe a genuinely in-flight transport without changing
                    // production state or occupying transcript layout.
                    TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                        journeyDiagnostic("nativeJourneyTrace", label: "Native journey trace", value: NativeJourneyFixture.trace)
                    }
                } else {
                    journeyDiagnostic("nativeJourneyTrace", label: "Native journey trace", value: NativeJourneyFixture.trace)
                }
                journeyDiagnostic("nativeJourneyAppearance", label: "Native journey appearance", value: colorScheme == .dark ? "dark" : "light")
                if NativeJourneyFixture.longHistory {
                    journeyDiagnostic("nativeJourneyLoadedRevision", label: "Applied history revision", value: String(model.cache.cursor))
                }
            }
        }
    }
    private func journeyDiagnostic(_ id: String, label: String, value: String) -> some View {
        Color.clear.frame(width: 1, height: 1).accessibilityElement(children: .ignore)
            .accessibilityLabel(label).accessibilityValue(value).accessibilityIdentifier(id)
    }
#endif
    private func startLogin() { voice.stop(); focused = false; model.login() }
    private func insert(_ text: String) { voice.stop(); focused = true; guard model.draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { model.error = "작성 중인 글을 남겨 두었어요. 먼저 보내거나 고쳐 주세요."; return }; model.editDraft(text) }
    private func beginVoice(_ mode: VoiceTurn.Mode) {
#if DEBUG
        NativeJourneyFixture.voiceStartAttempt(mode: mode == .conversation ? "conversation" : "dictation",
                                              hasSelection: model.selected != nil, canSend: model.canSend,
                                              draftEmpty: model.draftText.isEmpty)
#endif
        guard model.canEditDraft else { return }
        guard mode != .conversation || (model.canSend && model.draftText.isEmpty) else { return }
        let selection = model.selected, signedIn = model.signedIn
        let id = selection ?? "local-first-thought"
        focused = false; voiceRequestID = nil; voiceCompletionWaitStarted = nil; let prefix = model.draftText
        voice.start(projectID: id, mode: mode, reviewRecording: reviewRecording, nextTurn: {
            guard phase == .active, model.selected == selection, model.signedIn == signedIn, model.canSend, model.draftText.isEmpty else { voice.stop(); return }
            beginVoice(.conversation)
        }, transcript: { text in
            guard model.selected == selection, model.signedIn == signedIn else { return }
            model.editDraft(prefix.isEmpty ? text : prefix + "\n" + text)
        }, final: { _, mode in
            guard model.selected == selection, model.signedIn == signedIn else { return false }
            if mode == .dictation { return true }
            guard model.canSend else { return false }
            model.send(); voiceRequestID = model.cache.request?.id; return model.cache.request?.outstanding == true
        })
    }
    private func reconcileVoiceReply() {
        guard voice.turn.phase == .waiting, let requestID = voiceRequestID, let id = model.selected else { return }
        let completedWaitExpired = voiceCompletionWaitStarted.map { Date().timeIntervalSince($0) >= 30 } ?? false
        switch ConversationVoiceReply.resolve(id: requestID, request: model.cache.request, messages: model.cache.messages, sending: model.sendingCurrentRequest, readAloud: speakAnswers, completedWaitExpired: completedWaitExpired) {
        case .waiting:
            // Desktop event and request reads are separate. Allow the next poll to deliver its answer.
            if model.cache.request?.status == "completed" && voiceCompletionWaitStarted == nil { voiceCompletionWaitStarted = Date() }
        case .speak(let text): voiceRequestID = nil; voice.reply(text, projectID: id)
        case .finished: voiceRequestID = nil; voice.completeReply()
        case .needsAttention:
            voiceRequestID = nil; voice.fail("음성 답변 기다리기를 멈췄어요. 보낸 말과 전송 상태를 대화에서 확인해 주세요.")
        }
    }
}
