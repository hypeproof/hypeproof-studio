#if DEBUG
import AVFoundation
import Foundation
import LiveKit

/// A software gate before the SDK hands audio to its next stage. It cannot prove
/// that a previously queued hardware buffer was heard or flushed.
final class LiveKitEvaluationAudioGate: NSObject, AudioCustomProcessingDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var open = false

    func setOpen(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        open = value
    }

    var isOpen: Bool { lock.lock(); defer { lock.unlock() }; return open }

    func audioProcessingInitialize(sampleRate sampleRateHz: Int, channels: Int) {}
    func audioProcessingRelease() {}

    func audioProcessingProcess(audioBuffer: LKAudioBuffer) {
        lock.lock(); defer { lock.unlock() }
        guard !open else { return }
        for channel in 0..<audioBuffer.channels {
            audioBuffer.rawBuffer(forChannel: channel).update(repeating: 0, count: audioBuffer.frames)
        }
    }
}

/// Bounded local energy onset, not speech recognition or a validated human VAD.
/// Samples remain inside this callback. Only a one-shot activity signal leaves it.
final class LiveKitEvaluationActivity: NSObject, AudioRenderer, @unchecked Sendable {
    private let lock = NSLock()
    private var armed = false
    private var sustainedSeconds = 0.0
    private let onset: @Sendable () -> Void

    init(onset: @escaping @Sendable () -> Void) { self.onset = onset }

    func setArmed(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        armed = value; sustainedSeconds = 0
    }

    func render(pcmBuffer: AVAudioPCMBuffer) {
        lock.lock()
        guard armed else { lock.unlock(); return }
        let frames = Int(pcmBuffer.frameLength)
        let rate = pcmBuffer.format.sampleRate
        guard frames > 0, frames <= 8192, rate > 0, !pcmBuffer.format.isInterleaved else {
            lock.unlock(); return
        }
        var squares = 0.0
        if let samples = pcmBuffer.floatChannelData?[0] {
            for index in 0..<frames {
                let value = Double(samples[index])
                // Unknown sample scaling is not evidence of voice activity.
                guard value.isFinite, abs(value) <= 1 else { lock.unlock(); return }
                squares += value * value
            }
        } else if let samples = pcmBuffer.int16ChannelData?[0] {
            for index in 0..<frames {
                let value = Double(samples[index]) / 32768.0
                squares += value * value
            }
        } else { lock.unlock(); return }
        let rms = sqrt(squares / Double(frames))
        sustainedSeconds = rms >= 0.025 ? sustainedSeconds + Double(frames) / rate : 0
        let detected = sustainedSeconds >= 0.12
        if detected { armed = false }
        lock.unlock()
        if detected { onset() }
    }
}

/// An in-memory transport observation, not a playback or human-heard receipt.
final class LiveKitEvaluationAudioReceipt: NSObject, AudioRenderer, @unchecked Sendable {
    private let lock = NSLock()
    private var enabled = true
    private let firstBuffer: @Sendable () -> Void
    private let recordsRawBuffers: Bool
    private var rawBuffers = 0
    private var rawSamples = 0

    init(recordsRawBuffers: Bool = false, firstBuffer: @escaping @Sendable () -> Void) {
        self.recordsRawBuffers = recordsRawBuffers; self.firstBuffer = firstBuffer
    }

    /// Independent of UI/session authority and disable(). Retain this observer
    /// after SDK removal to detect any already-in-flight callback tail.
    var rawCounts: (buffers: Int, samples: Int) {
        lock.lock(); defer { lock.unlock() }
        return (rawBuffers, rawSamples)
    }

    func disable() {
        lock.lock(); enabled = false; lock.unlock()
    }

    func render(pcmBuffer: AVAudioPCMBuffer) {
        lock.lock()
        if recordsRawBuffers && pcmBuffer.frameLength > 0 {
            rawBuffers += 1; rawSamples += Int(pcmBuffer.frameLength)
        }
        let notify = enabled && pcmBuffer.frameLength > 0
        if notify { enabled = false }
        lock.unlock()
        if notify { firstBuffer() }
    }
}
#endif
