// One AVSpeechSynthesisVoice.speechVoices() call on a simulator, for measurement only (#4432).
// The seed job builds this for the iOS simulator SDK and runs it with `simctl spawn` on a device
// whose first-boot work has stopped. It prints one JSON line: how long the call took, how many
// voices it returned, and the ko-KR voices with their quality.
import AVFoundation
import Foundation

let started = Date()
let voices = AVSpeechSynthesisVoice.speechVoices()
let seconds = Date().timeIntervalSince(started)
let korean = voices.filter { $0.language == "ko-KR" }.map { voice -> [String: Any] in
    ["identifier": voice.identifier, "quality": voice.quality.rawValue]
}
let line: [String: Any] = ["milliseconds": Int((seconds * 1000).rounded()), "voices": voices.count, "ko_KR": korean]
let data = try JSONSerialization.data(withJSONObject: line, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
