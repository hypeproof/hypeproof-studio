#if DEBUG
import AVFoundation
import Combine
import Foundation
import LiveKit

@MainActor
final class LiveKitEvaluationController: NSObject, ObservableObject, RoomDelegate {
    @Published private(set) var busy = false
    @Published private(set) var canInterrupt = false
    @Published private(set) var status = "연결 전 · 마이크 꺼짐"
    @Published private(set) var observation = "수신 전 · 실제 재생/청취 범위 알 수 없음"

    private var session = VoiceEvaluationSession()
    private var room: Room?
    private var connectionID: UUID?
    private var audioOwner: UUID?
    private var captureGate: LiveKitEvaluationAudioGate?
    private var outputGate: LiveKitEvaluationAudioGate?
    private var activity: LiveKitEvaluationActivity?
    private var connectionTask: Task<Void, Never>?
    private var controlTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var cleanupTask: Task<Void, Never>?
    private var cleanupDeadlineTask: Task<Void, Never>?
    private var priorEngineAvailability: AudioEngineAvailability?
    private var remoteReceipt: (track: RemoteAudioTrack, observer: LiveKitEvaluationAudioReceipt)?

    func start(endpoint: String, token: String, consent: Bool) {
        guard !busy else { return }
        guard consent, Self.isLoopbackEndpoint(endpoint), !token.isEmpty, token.utf8.count <= 16_384 else {
            status = "동의와 로컬 주소·평가용 토큰을 확인해 주세요."
            return
        }
        // Existing SDK audio owners must not be replaced by this evaluation.
        guard AudioManager.shared.capturePostProcessingDelegate == nil,
              AudioManager.shared.renderPreProcessingDelegate == nil else {
            status = "다른 음성 작업을 끝낸 뒤 다시 시작해 주세요."
            return
        }
        busy = true; canInterrupt = false
        status = "마이크 권한 확인 중"
        observation = "수신 전 · 실제 재생/청취 범위 알 수 없음"
        let owner = UUID()
        connectionID = owner
        session = VoiceEvaluationSession()
        timeoutTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 90_000_000_000) } catch { return }
            guard let self, self.connectionID == owner else { return }
            self.stop(reason: "session_limit")
        }
        connectionTask = Task { [weak self] in
            guard let self else { return }
            let permitted = await LiveKitEvaluationPermission.request { reply in
                AVAudioSession.sharedInstance().requestRecordPermission { allowed in reply(allowed) }
            }
            guard self.connectionID == owner, !Task.isCancelled else { return }
            guard permitted else { self.stop(reason: "microphone_denied"); return }
            guard self.installAudioGates(owner: owner) else {
                self.stop(reason: "audio_owner_busy"); return
            }
            let currentRoom = Room(delegate: self,
                connectOptions: ConnectOptions(autoSubscribe: false, reconnectAttempts: 0, enableMicrophone: false))
            self.room = currentRoom
            self.status = "로컬 평가 서버에 연결 중"
            do {
                try await currentRoom.connect(url: endpoint, token: token)
                guard self.isCurrent(currentRoom, owner: owner), !Task.isCancelled else {
                    await currentRoom.disconnect(); return
                }
                guard currentRoom.localParticipant.identity?.stringValue == "hps-voice-client" else {
                    self.stop(reason: "transport_error"); return
                }
                self.status = "서버 입장 확인 대기 · 마이크 꺼짐"
                guard try await self.waitForAdmission(in: currentRoom, owner: owner) else {
                    if self.isCurrent(currentRoom, owner: owner) { self.stop(reason: "admission_timeout") }
                    return
                }
                guard self.isCurrent(currentRoom, owner: owner), !Task.isCancelled else { return }
                self.captureGate?.setOpen(true)
                try await currentRoom.localParticipant.setMicrophone(enabled: true,
                    captureOptions: AudioCaptureOptions(echoCancellation: true, autoGainControl: true, noiseSuppression: true))
                guard self.isCurrent(currentRoom, owner: owner), !Task.isCancelled else {
                    try? await currentRoom.localParticipant.setMicrophone(enabled: false)
                    await currentRoom.disconnect(); return
                }
                guard let message = self.session.beginTurn() else { self.stop(reason: "invalid_state"); return }
                self.canInterrupt = true
                self.status = "마이크 전송 중 · 평가 응답 대기"
                try await Self.publish(message, to: currentRoom)
            } catch {
                // Raw SDK errors may include URLs or credentials. Keep UI errors fixed.
                if self.isCurrent(currentRoom, owner: owner) { self.stop(reason: "transport_error") }
            }
        }
    }

    func interrupt(reason: String) {
        guard let currentRoom = room, let owner = connectionID,
              let message = session.interrupt(reason: Self.wireReason(reason)) else { return }
        fenceAudio()
        status = "출력 중단 · 새 평가는 연결을 끝낸 뒤 시작해 주세요."
        observation = "소프트웨어 출력 차단 · 이미 기기에 전달된 오디오의 실제 재생 범위 알 수 없음"
        controlTask = Task { [weak self] in
            try? await currentRoom.localParticipant.setMicrophone(enabled: false)
            guard let self, self.isCurrent(currentRoom, owner: owner), !Task.isCancelled else { return }
            do { try await Self.publish(message, to: currentRoom) }
            catch { if self.isCurrent(currentRoom, owner: owner) { self.stop(reason: "control_failed") } }
        }
        unsubscribeAll(in: currentRoom)
    }

    /// Fence all local state before the first suspension. No callback can reopen
    /// this connection, including a permission/connect/publish completion after Stop.
    func stop(reason: String) {
        guard busy, cleanupTask == nil else { return }
        let message = session.stop(reason: Self.wireReason(reason))
        let previousRoom = room
        let previousOwner = audioOwner
        connectionID = nil
        fenceAudio()
        let pendingConnect = connectionTask
        pendingConnect?.cancel(); connectionTask = nil
        controlTask?.cancel(); controlTask = nil
        timeoutTask?.cancel(); timeoutTask = nil
        status = "소프트웨어 오디오 차단 · 연결 종료 중"
        cleanupDeadlineTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 3_000_000_000) } catch { return }
            guard let self, self.busy, self.cleanupTask != nil else { return }
            self.status = "오디오 차단 유지 · SDK 연결 종료 확인 중"
            self.observation = "새 연결은 차단되어 있어요. 실제 장치/연결 종료 시점은 아직 확인되지 않았어요."
        }
        cleanupTask = Task { [weak self] in
            if let previousRoom {
                // Initiate mic disable first, but do not let a serial publish wait
                // prevent disconnect from resetting the SDK's pending completers.
                let disableMicrophone = Task {
                    try? await previousRoom.localParticipant.setMicrophone(enabled: false)
                }
                // Reliable delivery is best effort during teardown, not an acknowledgement.
                // Disconnect does not wait for a remote stop acknowledgement.
                let stopDelivery = Task {
                    if let message { try? await Self.publish(message, to: previousRoom) }
                }
                // A short bounded grace lets the local reliable channel send Stop.
                // It is not evidence that the peer received or acknowledged it.
                try? await Task.sleep(nanoseconds: 200_000_000)
                await previousRoom.disconnect()
                stopDelivery.cancel()
                await pendingConnect?.value
                await disableMicrophone.value
                await previousRoom.disconnect()
            } else {
                // The permission resolver is cancellation-aware even if the OS sheet stays open.
                await pendingConnect?.value
            }
            guard let self else { return }
            self.cleanupDeadlineTask?.cancel(); self.cleanupDeadlineTask = nil
            self.releaseAudioGates(owner: previousOwner)
            self.room = nil
            self.busy = false
            self.status = Self.endStatus(reason)
            self.observation = "연결 종료 · 실제 재생/청취 범위 알 수 없음"
            self.cleanupTask = nil
        }
    }

    private func installAudioGates(owner: UUID) -> Bool {
        guard AudioManager.shared.capturePostProcessingDelegate == nil,
              AudioManager.shared.renderPreProcessingDelegate == nil else { return false }
        let availability = AudioManager.shared.engineAvailability
        guard availability.isInputAvailable, availability.isOutputAvailable else { return false }
        priorEngineAvailability = availability
        let capture = LiveKitEvaluationAudioGate(), output = LiveKitEvaluationAudioGate()
        let observer = LiveKitEvaluationActivity { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.connectionID == owner, self.session.phase == .playing else { return }
                self.interrupt(reason: "local_energy")
            }
        }
        captureGate = capture; outputGate = output; activity = observer; audioOwner = owner
        AudioManager.shared.capturePostProcessingDelegate = capture
        AudioManager.shared.renderPreProcessingDelegate = output
        AudioManager.shared.add(localAudioRenderer: observer)
        return true
    }

    private func releaseAudioGates(owner: UUID?) {
        guard let owner, audioOwner == owner else { return }
        if ownsAudioGates, let priorEngineAvailability {
            // Pending connect/publish work has finished before restoring the engine.
            // Clear pending recording first so restoration cannot replay our request.
            try? AudioManager.shared.stopLocalRecording()
            let availability = AudioManager.shared.engineAvailability
            if !availability.isInputAvailable && !availability.isOutputAvailable {
                try? AudioManager.shared.setEngineAvailability(priorEngineAvailability)
            }
        }
        if let activity { AudioManager.shared.remove(localAudioRenderer: activity) }
        if let captureGate, (AudioManager.shared.capturePostProcessingDelegate as AnyObject?) === captureGate {
            AudioManager.shared.capturePostProcessingDelegate = nil
        }
        if let outputGate, (AudioManager.shared.renderPreProcessingDelegate as AnyObject?) === outputGate {
            AudioManager.shared.renderPreProcessingDelegate = nil
        }
        captureGate = nil; outputGate = nil; activity = nil; audioOwner = nil
        priorEngineAvailability = nil
    }

    private var ownsAudioGates: Bool {
        guard audioOwner != nil, let captureGate, let outputGate else { return false }
        return (AudioManager.shared.capturePostProcessingDelegate as AnyObject?) === captureGate
            && (AudioManager.shared.renderPreProcessingDelegate as AnyObject?) === outputGate
    }

    private func fenceAudio() {
        outputGate?.setOpen(false)
        captureGate?.setOpen(false)
        activity?.setArmed(false)
        if let remoteReceipt {
            remoteReceipt.observer.disable()
            remoteReceipt.track.remove(audioRenderer: remoteReceipt.observer)
            self.remoteReceipt = nil
        }
        // The SDK's engine fence outranks late capture/play requests. Keep it
        // disabled until pending SDK work settles; never overwrite a new owner.
        if ownsAudioGates { try? AudioManager.shared.setEngineAvailability(.none) }
        canInterrupt = false
        guard let room else { return }
        for participant in room.remoteParticipants.values {
            for publication in participant.audioTracks {
                (publication.track as? RemoteAudioTrack)?.volume = 0
            }
        }
    }

    private func unsubscribeAll(in currentRoom: Room) {
        for participant in currentRoom.remoteParticipants.values {
            for case let publication as RemoteTrackPublication in participant.audioTracks {
                Task { try? await publication.set(subscribed: false) }
            }
        }
    }

    private func isCurrent(_ candidate: Room, owner: UUID) -> Bool {
        room === candidate && connectionID == owner && session.phase != .stopped
    }

    /// Read SDK participant state, never retry Start. Room.connect may finish
    /// before the evaluator has observed the participant_connected event.
    private func waitForAdmission(in currentRoom: Room, owner: UUID) async throws -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(8))
        while clock.now < deadline {
            try Task.checkCancellation()
            guard isCurrent(currentRoom, owner: owner) else { return false }
            let localSID = currentRoom.localParticipant.sid?.stringValue
            if currentRoom.remoteParticipants.values.contains(where: { participant in
                VoiceEvaluationSession.isAdmitted(
                    participantIdentity: participant.identity?.stringValue ?? "",
                    admittedSID: participant.attributes[VoiceEvaluationSession.admissionAttribute],
                    localSID: localSID)
            }) { return true }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    private static func publish(_ message: VoiceEvaluationEnvelope, to room: Room) async throws {
        try await room.localParticipant.publish(data: JSONEncoder().encode(message), options: DataPublishOptions(
            destinationIdentities: [Participant.Identity(from: VoiceEvaluationSession.evaluatorIdentity)],
            topic: VoiceEvaluationSession.topic, reliable: true))
    }

    private static func isLoopbackEndpoint(_ value: String) -> Bool {
        guard let parts = URLComponents(string: value), parts.scheme == "ws",
              ["127.0.0.1", "[::1]", "::1"].contains(parts.host ?? ""),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/", let port = parts.port, (1...65535).contains(port) else { return false }
        return true
    }

    private static func wireReason(_ reason: String) -> String {
        switch reason {
        case "user_interrupt", "local_energy": return "user_speech"
        case "view_closed": return "disappear"
        case "session_limit": return "limit"
        case "user_stop", "background", "audio_interruption", "route_change": return reason
        case "remote_stop": return "user_stop"
        default: return "connection_error"
        }
    }

    private static func endStatus(_ reason: String) -> String {
        switch reason {
        case "session_limit": return "90초 평가 종료 · 마이크 꺼짐"
        case "microphone_denied": return "마이크 권한이 없어 종료했어요."
        case "admission_timeout": return "서버가 입장을 확인하지 않아 종료했어요. 마이크는 열지 않았어요."
        case "transport_error", "control_failed": return "연결이 끊겨 평가를 끝냈어요. 자동으로 다시 연결하지 않아요."
        case "audio_owner_busy": return "다른 음성 작업이 있어 평가를 끝냈어요."
        default: return "평가 종료 · 마이크 꺼짐"
        }
    }

    private func authorizeSubscriptions(in currentRoom: Room) {
        for participant in currentRoom.remoteParticipants.values {
            for case let publication as RemoteTrackPublication in participant.audioTracks {
                let identity = participant.identity?.stringValue ?? ""
                guard session.shouldSubscribe(trackName: publication.name, participantIdentity: identity) else { continue }
                Task { [weak self] in
                    do { try await publication.set(subscribed: true) }
                    catch { if self?.room === currentRoom { self?.stop(reason: "transport_error") }; return }
                    guard let self, self.room === currentRoom, self.connectionID != nil,
                          self.session.shouldSubscribe(trackName: publication.name, participantIdentity: identity) else {
                        (publication.track as? RemoteAudioTrack)?.volume = 0
                        try? await publication.set(subscribed: false)
                        return
                    }
                }
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data,
                          forTopic topic: String, encryptionType: EncryptionType) {
        // SDK 2.19.0 does not expose reliable/lossy kind on this receive callback.
        // Only sender/topic/session/turn/generation authorization is claimed here.
        guard topic == VoiceEvaluationSession.topic, data.count <= 4096,
              let identity = participant?.identity?.stringValue,
              let message = try? JSONDecoder().decode(VoiceEvaluationEnvelope.self, from: data) else { return }
        Task { @MainActor [weak self] in
            guard let self, self.room === room, self.connectionID != nil,
                  self.session.receive(message, participantIdentity: identity) else { return }
            switch message.event {
            case .started:
                self.status = "응답 트랙 승인 · 마이크 전송 중"
                self.observation = "started 수신 · 재생 큐/실제 청취 범위 알 수 없음"
                self.authorizeSubscriptions(in: room)
            case .interrupted:
                self.fenceAudio(); self.unsubscribeAll(in: room)
                self.status = "서버 감지로 출력 중단 · 연결을 끝내 주세요."
                self.observation = "interrupted 수신 · 실제 재생/청취 범위 알 수 없음"
                Task { try? await room.localParticipant.setMicrophone(enabled: false) }
            case .stopped: self.stop(reason: "remote_stop")
            default: break
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        Task { @MainActor [weak self] in
            guard let self, self.room === room, self.connectionID != nil else { return }
            self.authorizeSubscriptions(in: room)
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor [weak self] in
            guard let self, self.room === room, self.connectionID != nil,
                  self.session.shouldSubscribe(trackName: publication.name,
                    participantIdentity: participant.identity?.stringValue ?? ""),
                  let audioTrack = publication.track as? RemoteAudioTrack else {
                (publication.track as? RemoteAudioTrack)?.volume = 0
                try? await publication.set(subscribed: false)
                return
            }
            self.outputGate?.setOpen(true)
            self.activity?.setArmed(true)
            if self.remoteReceipt == nil {
                let observer = LiveKitEvaluationAudioReceipt { [weak self] in
                    Task { @MainActor [weak self] in
                        guard let self, self.room === room, self.connectionID != nil,
                              self.session.shouldSubscribe(trackName: publication.name,
                                participantIdentity: participant.identity?.stringValue ?? "") else { return }
                        self.observation = "오디오 프레임 수신 · 실제 재생/큐 비움/청취 범위 알 수 없음"
                    }
                }
                self.remoteReceipt = (audioTrack, observer)
                audioTrack.add(audioRenderer: observer)
            }
            self.observation = "오디오 트랙 연결 · 소프트웨어 출력 허용 · 실제 재생/청취 범위 알 수 없음"
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor [weak self] in
            guard let self, self.room === room, self.connectionID != nil else { return }
            self.stop(reason: "transport_error")
        }
    }

    nonisolated func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        Task { @MainActor [weak self] in
            guard let self, self.room === room, self.connectionID != nil else { return }
            self.stop(reason: "transport_error")
        }
    }
}
#endif
