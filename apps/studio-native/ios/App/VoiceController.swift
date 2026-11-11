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
    private var reviewEnabled = false
    private var reviewCapture: VoiceReviewCapture?
    private var reviewData: Data?
    private var reviewPlayer: AVAudioPlayer?
    private let engine = AVAudioEngine()
    private let speaker = AVSpeechSynthesizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognition: SFSpeechRecognitionTask?
    private var timeout: Task<Void, Never>?
    private var tapInstalled = false
    private var utteranceID: ObjectIdentifier?
    private var authorizedToken: UUID?
    private var transcript: (String) -> Void = { _ in }
    private var final: (String, VoiceTurn.Mode) -> Bool = { _, _ in false }
    var isCapturing: Bool { [.authorizing, .listening, .finalizing].contains(turn.phase) }
    var isActive: Bool { ![.idle, .ready].contains(turn.phase) }
    override init() { super.init(); speaker.delegate = self }

    func start(projectID: String, mode: VoiceTurn.Mode, reviewRecording: Bool = false,
               transcript: @escaping (String) -> Void,
               final: @escaping (String, VoiceTurn.Mode) -> Bool) {
        stop(); self.transcript = transcript; self.final = final; reviewEnabled = reviewRecording
        let token = turn.start(projectID: projectID, mode: mode)
        status = "마이크와 음성 인식 권한을 확인하고 있어요."
        SFSpeechRecognizer.requestAuthorization { [weak self] authorization in
            Task { @MainActor in
                guard let self, self.turn.token == token else { return }
                guard authorization == .authorized else {
                    self.fail("음성 인식 권한이 없어요. 설정에서 허용하거나 글로 계속할 수 있어요."); return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
                    Task { @MainActor in
                        guard let self, self.turn.token == token else { return }
                        guard allowed else { self.fail("마이크 권한이 없어요. 글로 계속할 수 있어요."); return }
                        self.authorizedToken = token
                        self.resumeIfActive()
                    }
                }
            }
        }
    }
    func resumeIfActive() {
        guard UIApplication.shared.applicationState == .active,
              let token = authorizedToken, turn.token == token, turn.phase == .authorizing else { return }
        authorizedToken = nil
        listen(token)
    }
    private func listen(_ token: UUID) {
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
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer); review?.append(buffer) }
            tapInstalled = true
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let ended = result?.isFinal == true
                let failed = error != nil
                Task { @MainActor in
                    guard let self, self.turn.token == token,
                          [.listening, .finalizing].contains(self.turn.phase) else { return }
                    if let text { self.transcript(text) }
                    if ended, let text { self.finish(text, token: token) }
                    else if failed { self.fail("음성 인식이 멈췄어요. 인식한 글은 입력창에 남겨 두었어요.") }
                }
            }
            engine.prepare(); try engine.start()
            status = "듣고 있어요. 최대 30초 · 말을 마치면 ‘말하기 끝’을 눌러 주세요."
            timeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled, let self, self.turn.token == token else { return }
                self.endSpeech()
            }
        } catch { fail("마이크를 시작하지 못했어요. 입력한 글은 그대로 남아 있어요.") }
    }
    func endSpeech() {
        let token = turn.token
        guard turn.advance(token, from: [.listening], to: .finalizing) else { return }
        timeout?.cancel(); stopInput(); request?.endAudio()
        status = "인식한 말을 정리하고 있어요."
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled, let self, self.turn.token == token, self.turn.phase == .finalizing else { return }
            self.fail("음성 인식을 마치지 못했어요. 입력창의 글을 확인하고 직접 보낼 수 있어요.")
        }
    }
    private func finish(_ text: String, token: UUID) {
        let mode = turn.mode
        guard turn.advance(token, from: [.listening, .finalizing], to: mode == .conversation ? .waiting : .ready) else { return }
        timeout?.cancel(); stopInput(); request?.endAudio(); recognition?.cancel()
        recognition = nil; request = nil
        reviewData = reviewCapture?.finish(); canReplayOwnVoice = reviewData != nil
        deactivateAudio()
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { fail("인식된 말이 없어요. 다시 말하거나 글로 적어 주세요."); return }
        if mode == .dictation { status = "입력창에 담았어요. 확인하고 직접 기록하거나 보내 주세요." }
        else { status = "답변을 기다리고 있어요." }
        if !final(text, mode) { fail("인식한 글을 입력창에 남겼어요. 연결 상태를 확인하고 직접 보내 주세요.") }
    }
    func reply(_ text: String, projectID: String) {
        guard turn.projectID == projectID, turn.advance(turn.token, from: [.waiting], to: .speaking) else { return }
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
            speaker.speak(utterance)
        } catch { fail("답변을 읽지 못했어요. 화면에서 확인해 주세요.") }
    }
    func stop() {
        turn.stop(); timeout?.cancel(); timeout = nil; authorizedToken = nil
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
        } catch { status = "녹음을 재생하지 못했어요. 인식한 글은 그대로 남아 있어요." }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let id = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current = self.reviewPlayer, ObjectIdentifier(current) == id else { return }
            self.reviewPlayer = nil; self.deactivateAudio()
            self.status = flag ? "내 말을 들었어요. 고치고 싶은 생각을 글로 이어가도 좋아요." : "재생을 마치지 못했어요. 인식한 글을 확인해 주세요."
        }
    }
    func fail(_ message: String) { stop(); status = message }
    private func stopInput() {
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    }
    private func deactivateAudio() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.utteranceID == id,
                  self.turn.advance(self.turn.token, from: [.speaking], to: .ready) else { return }
            self.utteranceID = nil; self.deactivateAudio(); self.status = "내 차례예요. ‘다시 말하기’를 눌러 주세요."
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, self.utteranceID == id else { return }
            self.fail("읽기를 멈췄어요. 글로 계속할 수 있어요.")
        }
    }
}
