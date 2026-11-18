#if DEBUG
import AVFoundation
import Combine
import Foundation
import LiveKit
import SwiftUI

/// Synthetic PCM enters the actual SDK capture mixer. No microphone, provider,
/// transcript, or physical playout is represented by this developer-only source.
@MainActor
final class LiveKitEvaluationSyntheticInput {
    private var task: Task<Void, Never>?
    private var sample: UInt64 = 0
    private var burstFrames = 0

    // 80ms is below the native 120ms onset threshold; the server must observe
    // real incoming PCM and its shorter three-frame threshold for this case.
    func requestEnergyBurst() { burstFrames = 4 }
    func stop() { task?.cancel(); task = nil; burstFrames = 0 }
    func start() {
        guard task == nil else { return }
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                    sampleRate: 48_000, channels: 1, interleaved: false),
                    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 960),
                    let samples = buffer.floatChannelData?[0] else { return }
                buffer.frameLength = 960
                let amplitude: Double = self.burstFrames > 0 ? 0.4 : 0.001
                if self.burstFrames > 0 { self.burstFrames -= 1 }
                for index in 0..<960 {
                    samples[index] = Float(amplitude * sin(2 * .pi * 220 * Double(self.sample) / 48_000))
                    self.sample += 1
                }
                AudioManager.shared.mixer.capture(appAudio: buffer)
                do { try await Task.sleep(nanoseconds: 20_000_000) } catch { return }
            }
        }
    }
}

struct LiveKitEvaluationCIState: Codable {
    let sessionID: UUID
    let turnID: UUID?
    let generation: UInt32
    let phase: String
    let busy: Bool
    let captureOpen: Bool
    let outputOpen: Bool
    let roomAttached: Bool
    let manualRendering: Bool
    let decodedBuffers: Int
    let decodedSamples: Int
    let events: [String]
}

private struct LiveKitEvaluationCIConfig: Decodable {
    let url: String
    let token: String
    let evaluator_identity: String
    let client_identity: String
    let expires_at: Int
    let room: String
    let candidate_source_sha: String
    let run_id: UUID
    let scenario: String
    let synthetic_consent: Bool
}

private struct LiveKitEvaluationCIReceipt: Encodable {
    let schema = "hps-native-livekit-evaluation/1"
    let runID: UUID?
    let scenario: String
    let room: String?
    let candidateSourceSHA: String?
    let status: String
    let failure: String?
    let beforeFence: LiveKitEvaluationCIState?
    let afterFence: LiveKitEvaluationCIState?
    let afterDrain: LiveKitEvaluationCIState?
    let final: LiveKitEvaluationCIState
    let physicalMicrophone = "NOT_RUN"
    let physicalPlayout = "UNKNOWN"
    let unobservedTransportTail = "UNKNOWN"
    let humanSpeechAndAEC = "NOT_RUN"
    let postCleanupGraceMilliseconds = 700
    let stabilityWindowMilliseconds = 700
}

@MainActor
private final class LiveKitEvaluationCIRun: ObservableObject {
    @Published var status = "합성 오디오 전송 검사 준비"
    private let controller = LiveKitEvaluationController()
    private let input = LiveKitEvaluationSyntheticInput()
    private var started = false
    private enum Failure: String, Error { case config, receipt, interruption, fence, cleanup }

    func stop() { input.stop(); controller.stop(reason: "view_closed") }

    private func wait(_ seconds: Double, until predicate: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(seconds))
        while !predicate() {
            guard clock.now < deadline else { throw Failure.receipt }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
    }

    func run() async {
        guard !started else { return }; started = true
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let configuration = directory.appendingPathComponent("hps-livekit-ci-config.json")
        let receipt = directory.appendingPathComponent("hps-livekit-ci-result.json")
        var config: LiveKitEvaluationCIConfig?
        var before: LiveKitEvaluationCIState?, fenced: LiveKitEvaluationCIState?
        var drained: LiveKitEvaluationCIState?
        var failure: String?
        do {
            let data = try Data(contentsOf: configuration)
            try FileManager.default.removeItem(at: configuration)
            guard data.count <= 24_576 else { throw Failure.config }
            let supplied = try JSONDecoder().decode(LiveKitEvaluationCIConfig.self, from: data)
            guard supplied.synthetic_consent,
                  supplied.evaluator_identity == VoiceEvaluationSession.evaluatorIdentity,
                  supplied.client_identity == "hps-voice-client",
                  ["energy_interrupt", "stop"].contains(supplied.scenario),
                  supplied.expires_at > Int(Date().timeIntervalSince1970),
                  supplied.expires_at <= Int(Date().timeIntervalSince1970) + 600 else { throw Failure.config }
            config = supplied
            controller.start(endpoint: supplied.url, token: supplied.token, consent: true, syntheticInput: input)
            try await wait(35) { controller.ciState.decodedBuffers >= 10 }
            before = controller.ciState
            guard before?.phase == "playing", before?.captureOpen == true,
                  before?.outputOpen == true, before?.events.contains("admitted") == true else { throw Failure.receipt }
            if supplied.scenario == "energy_interrupt" {
                // No direct interrupt call: actual SDK PCM must reach the server's
                // energy detector while a real remote reply is arriving.
                input.requestEnergyBurst()
                try await wait(8) { controller.ciState.phase == "interrupted" }
                guard controller.ciState.events.contains("local_energy_onset")
                    || controller.ciState.events.contains("interrupted_received") else { throw Failure.interruption }
            } else {
                controller.stop(reason: "user_stop")
            }
            fenced = controller.ciState
            guard fenced?.captureOpen == false, fenced?.outputOpen == false else { throw Failure.fence }
            controller.stop(reason: "user_stop")
            try await wait(10) { !controller.busy }
            let stopped = controller.ciState
            guard stopped.phase == "stopped", !stopped.roomAttached,
                  !stopped.captureOpen, !stopped.outputOpen, !stopped.manualRendering,
                  stopped.events.contains("renderer_detached"),
                  stopped.events.contains("stop_acknowledged"),
                  stopped.events.contains("cleanup_complete") else { throw Failure.cleanup }
            // Immediate fence may have an in-flight renderer tail. Measure it;
            // only require stability after detach/cleanup and a bounded grace.
            try await Task.sleep(nanoseconds: 700_000_000)
            drained = controller.ciState
            try await Task.sleep(nanoseconds: 700_000_000)
            guard controller.ciState.decodedBuffers == drained?.decodedBuffers,
                  controller.ciState.decodedSamples == drained?.decodedSamples,
                  !controller.busy else { throw Failure.fence }
        } catch {
            failure = (error as? Failure)?.rawValue ?? "bounded_execution"
            stop()
            try? await wait(10) { !controller.busy }
        }
        input.stop()
        let result = LiveKitEvaluationCIReceipt(runID: config?.run_id,
            scenario: config?.scenario ?? "unknown", room: config?.room,
            candidateSourceSHA: config?.candidate_source_sha, status: failure == nil ? "PASS" : "FAIL",
            failure: failure, beforeFence: before, afterFence: fenced, afterDrain: drained, final: controller.ciState)
        do {
            let data = try JSONEncoder().encode(result)
            try data.write(to: receipt, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receipt.path)
            status = failure == nil ? "합성 전송 검사 통과 · 실제 마이크/청취 미검증" : "합성 전송 검사 실패"
        } catch { status = "검사 기록 저장 실패" }
    }
}

struct LiveKitEvaluationCIView: View {
    @StateObject private var run = LiveKitEvaluationCIRun()
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Text(run.status).padding().task { await run.run() }
            .onChange(of: scenePhase) { _, phase in if phase == .background { run.stop() } }
            .onDisappear { run.stop() }
    }
}
#endif
