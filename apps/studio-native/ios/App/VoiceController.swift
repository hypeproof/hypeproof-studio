import SwiftUI
import UIKit
@preconcurrency import Speech
@preconcurrency import AVFoundation

/// Optional, bounded review audio stays in memory and is never sent to Service.
private final class VoiceReviewCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var clip: VoiceReviewPCM
    init?(format: AVAudioFormat) {
        guard let clip = VoiceReviewPCM(sampleRate: Int(format.sampleRate), channels: Int(format.channelCount)) else { return nil }
        self.clip = clip
    }
    func append(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let count = Int(buffer.frameLength), width = Int(buffer.format.channelCount)
        var samples = [Int16](); samples.reserveCapacity(count * width)
        for frame in 0..<count {
            for channel in 0..<width {
                let value = buffer.format.isInterleaved ? channels[0][frame * width + channel] : channels[channel][frame]
                samples.append(value.isFinite ? Int16(max(-32768, min(32767, value * 32767))) : 0)
            }
        }
        lock.lock(); clip.append(samples); lock.unlock()
    }
    func finish() -> Data? { lock.lock(); defer { lock.unlock() }; return clip.wav }
}

@MainActor final class VoiceController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    @Published private(set) var turn = VoiceTurn()
    @Published private(set) var status = ""
    @Published private(set) var canReplayOwnVoice = false
    @Published private(set) var timeline = VoiceTimeline()
    private var captureObserved = false
    private var reviewEnabled = false
    private var reviewCapture: VoiceReviewCapture?
    private var reviewData: Data?
    private var reviewPlayer: AVAudioPlayer?
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var timeout: Task<Void, Never>?
    private var endpointTask: Task<Void, Never>?
    private var endpoint: VoiceEndpoint?
    private var emptyCaptureRetries = 0
    private var automaticContinuation = false
    private var nextTurn: (() -> Void)?
#if DEBUG
    private var fixtureSpeech: Task<Void, Never>?
    private var fixtureUtterance: AVSpeechUtterance?
#endif
    private var tapInstalled = false
    private var utteranceID: ObjectIdentifier?
    private var authorizedToken: UUID?
    private var transcript: (String) -> Void = { _ in }
    private var final: (String, VoiceTurn.Mode) -> Bool = { _, _ in false }
    var isCapturing: Bool { [.authorizing, .listening, .finalizing].contains(turn.phase) }
    var isActive: Bool { ![.idle, .ready].contains(turn.phase) }
    var activityLabel: String {
        switch turn.phase {
        case .authorizing: return "마이크 준비 중"
        case .listening: return "듣고 있어요"
        case .finalizing: return "말씀 정리 중"
        case .waiting: return "답변 기다리는 중"
        case .speaking: return "답변 읽는 중"
        case .ready: return "다음 말 준비 중"
        case .idle: return "음성 대화"
        }
    }
    override init() { super.init(); speaker.delegate = self }

    func start(projectID: String, mode: VoiceTurn.Mode, reviewRecording: Bool = false,
               nextTurn: (() -> Void)? = nil,
               transcript: @escaping (String) -> Void,
               final: @escaping (String, VoiceTurn.Mode) -> Bool) {
        let retries = automaticContinuation ? emptyCaptureRetries : 0
        stop(reason: .restart); self.transcript = transcript; self.final = final; reviewEnabled = reviewRecording
        emptyCaptureRetries = retries
        self.nextTurn = mode == .conversation ? nextTurn : nil
        let token = turn.start(projectID: projectID, mode: mode)
        record(.start)
        authorizeSpeech(token)
    }
    private func authorizeSpeech(_ token: UUID) {
        guard turn.token == token, turn.phase == .authorizing else { return }
        status = "마이크와 음성 인식 권한을 확인하고 있어요."
        // Already granted permissions do not need another asynchronous request
        // between natural playback completion and the next microphone capture.
        let authorization: SFSpeechRecognizerAuthorizationStatus
#if DEBUG
        authorization = NativeJourneyFixture.enabled ? .authorized : SFSpeechRecognizer.authorizationStatus()
#else
        authorization = SFSpeechRecognizer.authorizationStatus()
#endif
        switch authorization {
        case .authorized:
            record(.speechPermissionGranted)
            authorizeMicrophone(token)
        case .notDetermined:
            record(.speechPermissionRequested)
            SFSpeechRecognizer.requestAuthorization { [weak self] authorization in
                Task { @MainActor in
                    guard let self, self.turn.token == token, self.turn.phase == .authorizing else { return }
                    guard authorization == .authorized else {
                        self.fail("음성 인식 권한이 없어요. 설정에서 허용하거나 글로 계속할 수 있어요."); return
                    }
                    self.record(.speechPermissionGranted)
                    self.authorizeMicrophone(token)
                }
            }
        default: fail("음성 인식 권한이 없어요. 설정에서 허용하거나 글로 계속할 수 있어요.")
        }
    }
    private func authorizeMicrophone(_ token: UUID) {
        guard turn.token == token, turn.phase == .authorizing else { return }
        let permission: AVAudioSession.RecordPermission
#if DEBUG
        permission = NativeJourneyFixture.enabled ? .granted : AVAudioSession.sharedInstance().recordPermission
#else
        permission = AVAudioSession.sharedInstance().recordPermission
#endif
        switch permission {
        case .granted: microphoneAuthorized(token)
        case .undetermined:
            record(.microphonePermissionRequested)
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
                Task { @MainActor in
                    guard let self, self.turn.token == token, self.turn.phase == .authorizing else { return }
                    guard allowed else { self.fail("마이크 권한이 없어요. 글로 계속 적을 수 있어요."); return }
                    self.microphoneAuthorized(token)
                }
            }
        default: fail("마이크 권한이 없어요. 글로 계속 적을 수 있어요.")
        }
    }
    private func microphoneAuthorized(_ token: UUID) {
        guard turn.token == token, turn.phase == .authorizing else { return }
        record(.microphonePermissionGranted)
        authorizedToken = token
        resumeIfActive()
    }
    func resumeIfActive() {
        guard UIApplication.shared.applicationState == .active,
              let token = authorizedToken, turn.token == token, turn.phase == .authorizing else { return }
        authorizedToken = nil
        record(.captureStarting)
        listen(token)
    }
    private func listen(_ token: UUID) {
#if DEBUG
        if NativeJourneyFixture.enabled {
            guard turn.advance(token, from: [.authorizing], to: .listening) else { return }
            record(.syntheticCaptureStarted)
            endpoint = VoiceEndpoint(now: ProcessInfo.processInfo.systemUptime)
            watchEndpoint(token)
            fixtureSpeech = NativeJourneyFixture.speech(deliver: { [weak self] text, isFinal in
                self?.receiveTranscript(text, isFinal: isFinal, token: token)
            }, stopAfterEmpty: { [weak self] in
                guard let self, self.turn.token == token else { return }
                // Deterministic controller cancellation at the actual scheduled
                // retry boundary; the separate UI Stop journey remains required.
                NativeJourneyFixture.recordEmptyStopBoundary(active: self.isActive, phase: self.turn.phase.rawValue)
                self.stop()
            })
            return
        }
#endif
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ko-KR")),
              recognizer.supportsOnDeviceRecognition, recognizer.isAvailable else {
            fail("이 기기에서 한국어 음성 인식을 사용할 수 없어요. 글로 계속할 수 있어요."); return
        }
        guard turn.advance(token, from: [.authorizing], to: .listening) else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement)
            try audio.setActive(true)
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                fail("사용할 수 있는 마이크가 없어요. 글로 계속할 수 있어요."); return
            }
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.requiresOnDeviceRecognition = true
            request.shouldReportPartialResults = true
            self.request = request
            let review = reviewEnabled ? VoiceReviewCapture(format: format) : nil
            reviewCapture = review
            endpoint = VoiceEndpoint(now: ProcessInfo.processInfo.systemUptime); captureObserved = false
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                request.append(buffer); review?.append(buffer)
                guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
                let stride = buffer.format.isInterleaved ? Int(buffer.format.channelCount) : 1
                var energy = 0.0
                for index in 0..<Int(buffer.frameLength) { let sample = Double(samples[index * stride]); energy += sample * sample }
                let rms = sqrt(energy / Double(buffer.frameLength)), now = ProcessInfo.processInfo.systemUptime
                Task { @MainActor [weak self] in
                    guard let self, self.turn.token == token, self.turn.phase == .listening else { return }
                    if !self.captureObserved { self.captureObserved = true; self.record(.captureAudioObserved) }
                    self.endpoint?.audio(rms: rms, now: now)
                }
            }
            tapInstalled = true
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let ended = result?.isFinal == true
                let failed = error != nil
                Task { @MainActor in
                    guard let self, self.turn.token == token,
                          [.listening, .finalizing].contains(self.turn.phase) else { return }
                    if let text { self.receiveTranscript(text, isFinal: ended, token: token) }
                    if failed, !ended { self.fail("음성 인식이 멈췄어요. 인식한 글은 입력창에 남겨 두었어요.") }
                }
            }
            engine.prepare(); try engine.start()
            record(.captureStarted)
            watchEndpoint(token)
        } catch { record(.captureFailed); fail("마이크를 시작하지 못했어요. 입력한 글은 그대로 남아 있어요.") }
    }
    private func receiveTranscript(_ text: String, isFinal: Bool, token: UUID) {
        guard turn.token == token, [.listening, .finalizing].contains(turn.phase) else { return }
        endpoint?.recognized(text, now: ProcessInfo.processInfo.systemUptime)
        let words = endpoint?.transcript ?? ""
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptyCaptureRetries = 0
            transcript(words)
        } else {
            record(words.isEmpty ? .emptyRecognition : .partialRetained)
        }
        if isFinal { finish(words, token: token) }
    }
    private func watchEndpoint(_ token: UUID) {
        status = turn.mode == .conversation ? "듣고 있어요. 말을 마치면 자동으로 보내요." : "듣고 있어요. 말을 마치면 입력창에 담아요."
        endpointTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 200_000_000)
                    guard !Task.isCancelled, let self, self.turn.token == token, self.turn.phase == .listening else { return }
                    switch self.endpoint?.decision(now: ProcessInfo.processInfo.systemUptime) {
                    case .finish: self.endSpeech(); return
                    case .noSpeech: self.finish("", token: token); return
                    default: break
                    }
                }
        }
    }
    func endSpeech() {
        let token = turn.token
        guard turn.advance(token, from: [.listening], to: .finalizing) else { return }
        timeout?.cancel(); endpointTask?.cancel(); stopInput(); request?.endAudio()
        status = "인식한 말을 정리하고 있어요."
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled, let self, self.turn.token == token, self.turn.phase == .finalizing else { return }
            // Some on-device recognizers never emit a final result after endAudio.
            // The stable partial is already visible; use it once after endpoint detection.
            self.finish(self.endpoint?.transcript ?? "", token: token)
        }
    }
    private func finish(_ text: String, token: UUID) {
        let mode = turn.mode
        guard turn.token == token, [.listening, .finalizing].contains(turn.phase) else { return }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            recoverEmptyCapture(token); return
        }
        guard turn.advance(token, from: [.listening, .finalizing], to: mode == .conversation ? .waiting : .ready) else { return }
        timeout?.cancel(); endpointTask?.cancel(); stopInput(); request?.endAudio(); recognition?.cancel()
        recognition = nil; request = nil
        reviewData = reviewCapture?.finish(); canReplayOwnVoice = reviewData != nil
        deactivateAudio()
        if mode == .dictation { status = "입력창에 담았어요. 확인하고 직접 기록하거나 보내 주세요." }
        else { status = "답변을 기다리고 있어요." }
        if !final(text, mode) { fail("인식한 글을 입력창에 남겼어요. 연결 상태를 확인하고 직접 보내 주세요.") }
    }
    private func recoverEmptyCapture(_ token: UUID) {
        guard turn.token == token, [.listening, .finalizing].contains(turn.phase) else { return }
        guard turn.mode == .conversation, nextTurn != nil, emptyCaptureRetries < 2 else {
            stop(reason: .noSpeechPaused)
            status = "말씀이 없어 잠시 쉬고 있어요. 준비되면 다시 말하거나 글로 이어가세요."
            return
        }
        guard turn.advance(token, from: [.listening, .finalizing], to: .authorizing) else { return }
        emptyCaptureRetries += 1
        timeout?.cancel(); endpointTask?.cancel(); endpointTask = nil
#if DEBUG
        fixtureSpeech?.cancel(); fixtureSpeech = nil
#endif
        stopInput(); request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
        reviewCapture = nil; reviewData = nil; canReplayOwnVoice = false
        endpoint = nil; authorizedToken = nil; deactivateAudio()
        status = "말씀을 기다리고 있어요. 준비되면 편하게 말해 주세요."
        record(.noSpeechRetryScheduled)
        // Bound empty-result recovery and let the screen recheck its current
        // account, foreground, request and draft before starting another capture.
        // The authorizing phase keeps Stop reachable during this short backoff.
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled, let self, self.turn.token == token, self.turn.phase == .authorizing else { return }
            guard UIApplication.shared.applicationState == .active else { self.stop(reason: .background); return }
            self.record(.noSpeechRetry)
            self.requestNextTurn()
        }
    }
    private func requestNextTurn() {
        automaticContinuation = true
        defer { automaticContinuation = false }
        nextTurn?()
    }
    func reply(_ text: String, projectID: String) {
        guard turn.projectID == projectID, turn.advance(turn.token, from: [.waiting], to: .speaking) else { return }
#if DEBUG
        if NativeJourneyFixture.heldPlayback {
            // A condition-driven external playback port delivers the actual
            // delegate entry, so tests cannot bypass its utterance/token fences.
            let utterance = AVSpeechUtterance(string: text)
            fixtureUtterance = utterance; utteranceID = ObjectIdentifier(utterance)
            record(.syntheticPlaybackQueued)
            status = "답변을 읽고 있어요. 마이크는 꺼져 있어요."
            speechSynthesizer(speaker, didStart: utterance)
            return
        }
        if NativeJourneyFixture.enabled && !NativeJourneyFixture.realPlayback {
            let token = turn.token
            status = "답변을 읽고 있어요. 마이크는 꺼져 있어요."
            timeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 400_000_000)
                guard !Task.isCancelled, let self, self.turn.token == token else { return }
                self.completeReply()
            }
            return
        }
#endif
        guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language == "ko-KR" }) else {
            fail("한국어 읽기 음성을 사용할 수 없어요. 답변을 화면에서 확인해 주세요."); return
        }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice; utterance.rate = AVSpeechUtteranceDefaultSpeechRate
            utteranceID = ObjectIdentifier(utterance)
            status = "답변을 읽고 있어요. 마이크는 꺼져 있어요."
            record(.playbackQueued)
            speaker.speak(utterance)
        } catch { fail("답변을 읽지 못했어요. 화면에서 확인해 주세요.") }
    }
#if DEBUG
    func finishFixturePlayback() {
        guard NativeJourneyFixture.heldPlayback, let fixtureUtterance else { return }
        record(.syntheticPlaybackFinished)
        speechSynthesizer(speaker, didFinish: fixtureUtterance)
    }
#endif
    func record(_ event: VoiceTimeline.Event) {
        timeline.record(event, phase: turn.phase, now: ProcessInfo.processInfo.systemUptime)
    }
    func stop(reason: VoiceTimeline.Event = .stopped) {
        record(reason)
        turn.stop(); timeout?.cancel(); timeout = nil; endpointTask?.cancel(); endpointTask = nil
        endpoint = nil; emptyCaptureRetries = 0; nextTurn = nil; authorizedToken = nil
#if DEBUG
        fixtureSpeech?.cancel(); fixtureSpeech = nil
#endif
        utteranceID = nil; speaker.stopSpeaking(at: .immediate)
        stopInput(); request?.endAudio(); recognition?.cancel(); request = nil; recognition = nil
        reviewPlayer?.stop(); reviewPlayer = nil; reviewData = nil; reviewCapture = nil; canReplayOwnVoice = false; reviewEnabled = false
        transcript = { _ in }; final = { _, _ in false }; deactivateAudio(); status = ""
    }
    func replayOwnVoice() {
        guard !isCapturing, turn.phase != .waiting, turn.phase != .speaking, let reviewData else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            let player = try AVAudioPlayer(data: reviewData); player.delegate = self; reviewPlayer = player
            guard player.play() else { throw StudioError.message("녹음을 재생하지 못했어요.") }
            status = "내 목소리를 다시 듣고 있어요. 다른 화면으로 이동하거나 다음 녹음을 시작하면 원음을 지워요."
        } catch {
            reviewPlayer?.stop(); reviewPlayer = nil; deactivateAudio()
            status = "녹음을 재생하지 못했어요. 인식한 글은 그대로 남아 있어요."
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let id = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.reviewPlayer, ObjectIdentifier(current) == id else { return }
            self.reviewPlayer = nil; self.deactivateAudio()
            self.status = flag ? "내 말을 들었어요. 고치고 싶은 생각을 글로 이어가도 좋아요." : "재생을 마치지 못했어요. 인식한 글을 확인해 주세요."
        }
    }
    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let id = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.reviewPlayer, ObjectIdentifier(current) == id else { return }
            current.stop(); self.reviewPlayer = nil; self.deactivateAudio()
            self.status = "녹음을 재생하지 못했어요. 인식한 글은 그대로 남아 있어요."
        }
    }
    func fail(_ message: String) { stop(reason: .failed); status = message }
    func completeReply() {
        guard turn.advance(turn.token, from: [.waiting, .speaking], to: .ready) else { return }
        record(.ready)
        utteranceID = nil; deactivateAudio()
        guard turn.mode == .conversation, UIApplication.shared.applicationState == .active, nextTurn != nil else {
            status = "답변을 받았어요. 준비되면 다시 말해 주세요."; return
        }
        // The screen checks its current account, request and draft before opening
        // a new capture. Stop/navigation clears this callback and invalidates tokens.
        record(.continuationRequested)
        requestNextTurn()
    }
    private func stopInput() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }
    private func deactivateAudio() {
        do { try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        catch { record(.audioDeactivationFailed) }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.utteranceID == id, self.turn.phase == .speaking else { return }
            self.record(.playbackStarted)
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard self.utteranceID == id, self.turn.phase == .speaking else { self.record(.stalePlaybackCallback); return }
            self.record(.playbackFinished)
            self.completeReply()
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.utteranceID == id else { return }
            self.record(.playbackCancelled)
            self.fail("읽기를 멈췄어요. 글로 계속할 수 있어요.")
        }
    }
}
