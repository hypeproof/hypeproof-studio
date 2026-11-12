import Foundation

/// Bounded in-memory PCM16/WAV for optional self-listening. No filesystem or transport.
public struct VoiceReviewPCM: Sendable {
    public let sampleRate: Int
    public let channels: Int
    private var pcm = Data()
    public init?(sampleRate: Int, channels: Int) {
        guard (8000...192000).contains(sampleRate), (1...2).contains(channels) else { return nil }
        self.sampleRate = sampleRate; self.channels = channels
    }
    public mutating func append(_ samples: [Int16]) {
        let remaining = (sampleRate * channels * 30 * 2 - pcm.count) / 2
        let count = min(samples.count / channels * channels, remaining)
        guard count > 0 else { return }
        var bytes = Data(count: count * 2)
        bytes.withUnsafeMutableBytes { raw in
            let out = raw.bindMemory(to: UInt8.self)
            for i in 0..<count {
                let value = UInt16(bitPattern: samples[i])
                out[i * 2] = UInt8(truncatingIfNeeded: value)
                out[i * 2 + 1] = UInt8(truncatingIfNeeded: value >> 8)
            }
        }
        pcm.append(bytes)
    }
    public var wav: Data? {
        guard !pcm.isEmpty else { return nil }
        var data = Data()
        func word(_ value: UInt32, bytes: Int) { for shift in 0..<bytes { data.append(UInt8(truncatingIfNeeded: value >> (shift * 8))) } }
        data.append(contentsOf: "RIFF".utf8); word(UInt32(pcm.count + 36), bytes: 4)
        data.append(contentsOf: "WAVEfmt ".utf8); word(16, bytes: 4); word(1, bytes: 2)
        word(UInt32(channels), bytes: 2); word(UInt32(sampleRate), bytes: 4)
        word(UInt32(sampleRate * channels * 2), bytes: 4); word(UInt32(channels * 2), bytes: 2); word(16, bytes: 2)
        data.append(contentsOf: "data".utf8); word(UInt32(pcm.count), bytes: 4); data.append(pcm)
        return data
    }
}
