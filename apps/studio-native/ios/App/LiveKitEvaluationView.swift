#if DEBUG
import AVFoundation
import SwiftUI

/// Opt-in development surface. It never constructs the production conversation.
struct LiveKitEvaluationView: View {
    @StateObject private var model = LiveKitEvaluationController()
    @Environment(\.scenePhase) private var scenePhase
    @State private var endpoint = "ws://127.0.0.1:7880"
    @State private var token = ""
    @State private var consent = false

    var body: some View {
        NavigationStack {
            Form {
                Section("로컬 음성 개발 평가") {
                    Text("실제 마이크 소리를 로컬 평가 서버에 전송합니다. 고객 대화와 개인정보를 사용하지 마세요. 90초가 지나면 오디오를 차단하고 연결 종료를 요청합니다.")
                    Text("현재 기기의 loopback 주소만 허용합니다. iPhone의 127.0.0.1은 Mac 주소가 아닙니다.")
                        .font(.caption).foregroundStyle(.secondary)
                    TextField("로컬 WebSocket 주소", text: $endpoint)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .disabled(model.busy)
                    SecureField("로컬 평가용 임시 토큰", text: $token)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .disabled(model.busy)
                    Toggle("마이크 전송에 동의하고 평가 시작", isOn: $consent)
                        .disabled(model.busy)
                    Button("연결하고 한 번 평가") {
                        let suppliedToken = token
                        token = ""
                        model.start(endpoint: endpoint, token: suppliedToken, consent: consent)
                    }
                    .disabled(model.busy || !consent || token.isEmpty)
                    .accessibilityIdentifier("liveKitEvaluationStart")
                }
                Section("실행 상태") {
                    Text(model.status).accessibilityIdentifier("liveKitEvaluationStatus")
                    Text(model.observation).font(.caption)
                    Text("로컬 에너지 감지와 서버 감지로 출력을 중단합니다. 한국어 발화 구분·실제 청취 범위·스피커/Bluetooth 품질은 아직 검증하지 않았습니다.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("출력 끊기") { model.interrupt(reason: "user_interrupt") }
                        .disabled(!model.canInterrupt)
                        .accessibilityIdentifier("liveKitEvaluationInterrupt")
                    Button("멈추고 연결 끝내기", role: .destructive) { model.stop(reason: "user_stop") }
                        .disabled(!model.busy)
                        .accessibilityIdentifier("liveKitEvaluationStop")
                }
            }
            .navigationTitle("음성 개발 평가")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { token = ""; model.stop(reason: "background") }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in
            if let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               value == AVAudioSession.InterruptionType.began.rawValue {
                model.stop(reason: "audio_interruption")
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in
            if let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
               value == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue
                || value == AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue {
                model.stop(reason: "route_change")
            }
        }
        .onDisappear { token = ""; model.stop(reason: "view_closed") }
    }
}
#endif
