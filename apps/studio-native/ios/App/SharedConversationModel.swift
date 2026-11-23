import SwiftUI
import Security
import CryptoKit
import AuthenticationServices

private enum AccountKeychain {
    static var query: [String: Any] {
        var value: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.hypeproof.studio.mobile.account", kSecAttrAccount as String: "device-session"]
#if DEBUG
        if NativeJourneyFixture.enabled { value[kSecAttrService as String] = "ai.hypeproof.studio.mobile.journey." + NativeJourneyFixture.namespace }
#endif
        return value
    }
    private static func failure(_ operation: String, _ status: OSStatus, _ message: String) -> StudioError {
        // Never log a query, account identifier, credential or stored bytes.
        NSLog("HP Studio account storage %@ failed (%d)", operation, status)
        return .message(message)
    }
    private static func readData(_ query: [String: Any]) throws -> Data? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data else { throw failure("read", status, "안전한 계정 저장소를 읽지 못했어요.") }
        return bytes
    }
    private static func saveData(_ data: Data, query: [String: Any]) throws {
        let update = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if result == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(q as CFDictionary, nil)
            guard added == errSecSuccess else { throw failure("add", added, "로그인을 안전하게 저장하지 못했어요.") }
        } else if result != errSecSuccess { throw failure("update", result, "로그인을 안전하게 저장하지 못했어요.") }
    }
    private static func removeData(_ query: [String: Any]) throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw failure("delete", result, "이 기기의 로그인을 지우지 못했어요.") }
    }
    static func read() throws -> StoredAccount? {
        guard let bytes = try readData(query) else { return nil }
        return try JSONDecoder().decode(StoredAccount.self, from: bytes)
    }
    static func save(_ value: StoredAccount) throws { try saveData(JSONEncoder().encode(value), query: query) }
    static func remove() throws { try removeData(query) }
#if DEBUG
    static func verifyNativeStorage() throws {
        // Exercise this app's actual Keychain entitlement with an isolated synthetic item.
        var probe = query; probe[kSecAttrService as String] = "ai.hypeproof.studio.mobile.verification." + UUID().uuidString
        defer { try? removeData(probe) }
        let first = Data(UUID().uuidString.utf8), second = Data(UUID().uuidString.utf8)
        try saveData(first, query: probe)
        guard try readData(probe) == first else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
        try saveData(second, query: probe)
        guard try readData(probe) == second else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
        let tokens = AccountTokens(access_token: "synthetic-access", refresh_token: String(repeating: "a", count: 64), expires_in: 3600, session_id: "synthetic-session")
        let pending = try StoredAccount(accountID: "synthetic-account", tokens: tokens, expiresAt: Date(), refreshPending: true)
        try saveData(JSONEncoder().encode(pending), query: probe)
        guard let stored = try readData(probe), try JSONDecoder().decode(StoredAccount.self, from: stored).refreshPending else {
            throw StudioError.message("로그인 갱신 상태를 안전하게 저장하지 못했어요.")
        }
        try removeData(probe)
        guard try readData(probe) == nil else { throw StudioError.message("계정 저장소 확인에 실패했어요.") }
    }
#endif
}
private struct SharedCacheFile: Codable {
    let accountID: String
    var conversations: [SharedConversation] = []
    var entries: [String: ConversationCache] = [:]
}

@MainActor final class SharedConversationModel: ObservableObject {
    private let intakePresentations = TeamIntakePresentations()
    private let deliveryControllers = TeamDeliveryControllers()
    private let outcomeControllers = TeamOutcomeControllers()
    private let githubObservationControllers = TeamGitHubObservationControllers()
    private let relationControllers = TeamRelationControllers()
    private let textRevisionControllers = TeamTextRevisionControllers()
    static let personalID = "personal-reflection"
    @Published private(set) var opening = "요즘 어떤 일에 시간을 많이 쓰세요?"
    @Published private(set) var openingHint = "일, 공부, 돌봄, 쉬는 시간까지 어떤 이야기든 좋아요."
    @Published private(set) var hasEarlierReflection = false
    var isReflection: Bool { selected == Self.personalID }
    @Published private var guestDraft = GuestDraft()
    private var guestDraftReadable = true
    private var guestDraftFailure: String?
    @Published private(set) var signedIn = false
    @Published private(set) var approvalEntryVisible = false
    @Published private(set) var conversations: [SharedConversation] = []
    @Published private(set) var entries: [String: ConversationCache] = [:]
    @Published private(set) var signIn: DeviceSignIn?
    @Published private(set) var busy = false
    @Published private(set) var syncing = false
    @Published private(set) var showsSyncProgress = false
    @Published private(set) var displayName: String?
    @Published private(set) var loggingOut = false
    @Published private(set) var stoppingReflection = false
    private var reflectionCredential: Task<String, Error>?
    private var responseGeneration = UUID()
    private var stoppedResponse: (generation: UUID, requestID: String, accountID: String, sessionID: String, failure: String?)?
    private var stopOperation: Task<Void, Never>?
    @Published private(set) var accountStorageReady = false
#if DEBUG
    @Published private(set) var accountStorageVerified = false
#endif
    @Published var selected: String?
    @Published var error: String?
    @Published var notice = ""
    @Published private var editing: [String: [String: [String: String]]] = [:]
    var visibleAccountID: String? { signedIn ? account?.accountID : nil }
    var feedbackScope: String { signedIn ? "account-" + (account?.accountID ?? "unavailable") : "guest" }
    private var account: StoredAccount?
    private let tokenFlight = AccountTokenRefreshFlight()
    private lazy var teamService: ConversationService = {
#if DEBUG
        return TeamEntryFixture.service ?? service
#else
        return service
#endif
    }()
    // The presentations below are built by methods, not by `lazy var x = { ... }()`.
    // Async closures made inside a lazy initializer ran on the cooperative pool, and
    // their `await` on main-actor code did not hop to the main actor (#4432).
    lazy var experience: ProductExperiencePresentation = makeExperience()
    private func makeExperience() -> ProductExperiencePresentation {
        let presentation = ProductExperiencePresentation()
        presentation.controller = ProductExperienceController(identity: { [weak self] in
            guard let self, self.signedIn, !self.loggingOut, let account = self.account else { return nil }
            return .init(accountID: account.accountID, sessionID: account.tokens.session_id)
        }, version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", consent: { [weak self] binding, granted in
            guard let self else { throw CancellationError() }; let token = try await self.approvalToken(binding)
            return try await self.teamService.productExperienceConsent(granted, token: token)
        }, send: { [weak self] binding, events in
            guard let self else { throw CancellationError() }; let token = try await self.approvalToken(binding)
            return try await self.teamService.productExperienceEvents(events, token: token)
        }, load: { [weak self] account in
            guard let self else { throw CancellationError() }; let file = try self.experienceFile(account)
            guard FileManager.default.fileExists(atPath: file.path) else { return .init() }
            let data = try Data(contentsOf: file); guard data.count <= 32768 else { throw SyncFailure.invalidResponse }
            let queue = try JSONDecoder().decode(ProductExperienceQueue.self, from: data); try queue.validate(); return queue
        }, save: { [weak self] account, queue in
            guard let self else { throw CancellationError() }; try queue.validate(); let file = try self.experienceFile(account)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var folder = file.deletingLastPathComponent(); var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
            try JSONEncoder().encode(queue).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }, changed: { [weak self, weak presentation] in presentation?.state = $0; self?.questions.controller?.startAvailabilityChanged() })
        return presentation
    }
    lazy var push: AccountPushPresentation = makePush()
    private func makePush() -> AccountPushPresentation {
        let presentation = AccountPushPresentation()
        presentation.controller = AccountPushController(identity: { [weak self] in
            guard let self, self.signedIn, !self.loggingOut, let account = self.account else { return nil }
            return .init(accountID: account.accountID, sessionID: account.tokens.session_id)
        }, load: { [weak self] in guard let self else { throw CancellationError() }; return try self.loadPushPreference() }, save: { [weak self] in
            guard let self else { throw CancellationError() }; try self.savePushPreference($0)
        }, call: { [weak self] binding, method, id, body in
            guard let self else { throw CancellationError() }; let token = try await self.approvalToken(binding)
            try await self.service.accountPush(id, method: method, body: body, token: token)
        }, changed: { [weak presentation] in presentation?.state = $0 }, teamCapabilities: { [weak self] binding in
            guard let self else { throw CancellationError() }
            let attempt = await self.epoch
            do {
                let access = try await self.teamService.teamRequestAccess(token: self.approvalToken(binding)); try access.validate(account: binding.accountID)
                return access.products.isEmpty ? [] : try TeamPushCapabilities.supported(access.supported_push_capabilities)
            } catch SyncFailure.http(let status, let code) {
                if status == 404 || (status == 403 && code == "team_product_denied") { return [] }
                if status == 401 { await self.teamPushDiscoveryDenied(binding, attempt: attempt, status: status, code: code) }
                throw SyncFailure.http(status, code)
            }
        }, registerTeam: { [weak self] binding, id, body, capabilities in
            guard let self else { throw CancellationError() }
            try await self.teamService.accountPush(id, method: "PUT", body: body, token: self.approvalToken(binding), capabilities: capabilities)
        }, openTeam: { [weak self] binding, id, reference in
            guard let self else { throw CancellationError() }
            return try await self.teamService.openedTeamPush(installation: id, reference: reference, token: self.approvalToken(binding))
        })
        return presentation
    }
    private func teamPushDiscoveryDenied(_ binding: MemberApprovalIdentity, attempt: UUID, status: Int, code: String) {
        guard epoch == attempt, account?.accountID == binding.accountID, account?.tokens.session_id == binding.sessionID else { return }
        failure(SyncFailure.http(status, code))
    }
    private func commentSchemas(product: String) async throws -> [String] {
        let attempt = epoch
        guard let binding = try await approvalIdentity() else { throw CancellationError() }
        let access = try await teamService.teamRequestAccess(token: approvalToken(binding)); try access.validate(account: binding.accountID)
        guard epoch == attempt, try await approvalIdentity() == binding, access.products.contains(product) else { throw CancellationError() }
        return try TeamCommentSupport.schemas(access.supported_comment_schemas)
    }
    private func sendTeamComment(_ draft: TeamCommentDraft) async throws -> String {
        let attempt = epoch
        guard let binding = try await approvalIdentity(), epoch == attempt, binding.accountID == draft.accountID else { throw CancellationError() }
        try draft.validate(account: binding.accountID, request: draft.requestID)
        let receipt = try await teamService.teamRequestComment(draft, token: approvalToken(binding))
        guard epoch == attempt, try await approvalIdentity() == binding else { throw CancellationError() }
        return receipt
    }
    func authorizedTeamPushRequest(_ destination: TeamPushDestination) async -> String? {
        let attempt = epoch
        var captured: MemberApprovalIdentity?
        do {
            guard let binding = try await approvalIdentity(), epoch == attempt else { return nil }
            captured = binding
            let detail = try await teamService.teamRequestDetail(id: destination.requestID, token: approvalToken(binding)); try detail.validate(id: destination.requestID)
            guard try await approvalIdentity() == binding, epoch == attempt else { return nil }
            return destination.requestID
        } catch {
            if let captured, epoch == attempt, signedIn, !loggingOut, account?.accountID == captured.accountID, account?.tokens.session_id == captured.sessionID {
                push.controller?.unavailable("이 요청을 열 수 없어요. 팀 알림함에서 권한과 최신 상태를 확인해 주세요.")
            }
            return nil
        }
    }
    private func loadPushPreference() throws -> AccountPushPreference {
        let file = directory.appendingPathComponent("push-device-v1.json")
        guard FileManager.default.fileExists(atPath: file.path) else { let value = AccountPushPreference(); try savePushPreference(value); return value }
        let data = try Data(contentsOf: file); guard data.count <= 4096 else { throw SyncFailure.invalidResponse }
        let value = try JSONDecoder().decode(AccountPushPreference.self, from: data); try value.validate(); return value
    }
    private func savePushPreference(_ value: AccountPushPreference) throws {
        try value.validate(); try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var folder = directory; var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
        try JSONEncoder().encode(value).write(to: directory.appendingPathComponent("push-device-v1.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    lazy var teamInbox: TeamInboxPresentation = makeTeamInbox()
    private func makeTeamInbox() -> TeamInboxPresentation {
        let presentation = TeamInboxPresentation()
        presentation.controller = TeamInboxController(identity: { [weak self] in try await self?.approvalIdentity() }, access: { [weak self] account in
            guard let self else { throw CancellationError() }; return try await self.teamService.teamRequestAccess(token: self.approvalToken(account))
        }, subscriptions: { [weak self] account in
            guard let self else { throw CancellationError() }; return try await self.teamService.teamSubscriptions(token: self.approvalToken(account))
        }, inbox: { [weak self] account, after in
            guard let self else { throw CancellationError() }; return try await self.teamService.teamInbox(after: after, token: self.approvalToken(account))
        }, mutate: { [weak self] account, mutation in
            guard let self else { throw CancellationError() }; return try await self.teamService.setTeamSubscription(mutation, token: self.approvalToken(account))
        }, detail: { [weak self] account, request in
            guard let self else { throw CancellationError() }; return try await self.teamService.teamRequestDetail(id: request, token: self.approvalToken(account))
        }, read: { [weak self] account, sequence in
            guard let self else { throw CancellationError() }; return try await self.teamService.readTeamNotification(sequence: sequence, token: self.approvalToken(account))
        }, load: { [weak self] account in
            guard let self else { throw CancellationError() }; return try self.readTeamDraft(TeamSubscriptionMutation.self, account: account, name: "subscription.json")
        }, save: { [weak self] mutation in
            guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == mutation.accountID else { throw CancellationError() }
            try mutation.validate(account: mutation.accountID); try self.writeTeamDraft(mutation, account: mutation.accountID, name: "subscription.json")
        }, changed: { [weak presentation] in presentation?.state = $0 })
        return presentation
    }
    lazy var teamRequests: TeamRequestPresentation = makeTeamRequests()
    private func makeTeamRequests() -> TeamRequestPresentation {
        let presentation = TeamRequestPresentation()
        presentation.inbox = teamInbox
        presentation.controller = TeamRequestController(identity: { [weak self] in try await self?.approvalIdentity() }, access: { [weak self] identity in
            guard let self else { throw CancellationError() }
            return try await self.teamService.teamRequestAccess(token: self.approvalToken(identity))
        }, list: { [weak self] identity, product, before in
            guard let self else { throw CancellationError() }
            return try await self.teamService.teamRequestList(product: product, before: before, token: self.approvalToken(identity))
        }, send: { [weak self] identity, draft in
            guard let self else { throw CancellationError() }
            return try await self.teamService.sendTeamRequest(draft, token: self.approvalToken(identity))
        }, recover: { [weak self] identity, draft in
            guard let self else { throw CancellationError() }
            return try await self.teamService.recoverTeamRequest(draft, token: self.approvalToken(identity))
        }, load: { [weak self] account in
            guard let self else { throw CancellationError() }
            let stored = try self.readTeamDraft(TeamRequestDraft.self, account: account, name: "request.json")
#if DEBUG
            // Synthetic journey only: an already-acknowledged request (#4432).
            if stored == nil, let seeded = TeamEntryFixture.seededRequest(account: account) { return seeded }
#endif
            return stored
        }, save: { [weak self] draft in
            guard let self else { throw CancellationError() }
            try draft.validate(account: draft.accountID); try self.writeTeamDraft(draft, account: draft.accountID, name: "request.json")
        }, changed: { [weak presentation] in teamOffMainCheck("TeamRequestPresentation.state"); presentation?.state = $0 })
        presentation.detail = { [weak self] id, after in
            guard let self, let binding = try await self.approvalIdentity() else { throw CancellationError() }
            let result = try await self.teamService.teamRequestDetail(id: id, after: after, token: self.approvalToken(binding))
            guard try await self.approvalIdentity() == binding else { throw CancellationError() }
            try result.validate(id: id)
            await self.teamRequests.controller?.observeHidden(result.request, account: binding)
            return result
        }
        presentation.commentSchemas = { [weak self] product in
            guard let self else { throw CancellationError() }; return try await self.commentSchemas(product: product)
        }
        presentation.comment = { [weak self] draft in
            guard let self else { throw CancellationError() }; return try await self.sendTeamComment(draft)
        }
        presentation.loadComment = { [weak self] request in
            guard let self, self.signedIn, !self.loggingOut, let account = self.account?.accountID, TeamRequestRecord.validID(request) else { throw CancellationError() }
            let draft = try self.readTeamDraft(TeamCommentDraft.self, account: account, name: request + ".json") ?? TeamCommentDraft(accountID: account, requestID: request)
            try draft.validate(account: account, request: request); return draft
        }
        presentation.saveComment = { [weak self] draft in
            guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
            try draft.validate(account: draft.accountID, request: draft.requestID)
            try self.writeTeamDraft(draft, account: draft.accountID, name: draft.requestID + ".json")
        }
        presentation.makeOutcome = { [weak self] request in
            let outcome = TeamOutcomePresentation()
            let controller = TeamOutcomeController(requestID: request, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, after in
                guard let self else { throw CancellationError() }; return try await self.teamService.teamOutcomes(id: request, after: after, token: self.approvalToken(binding))
            }, deliveries: { [weak self] binding in
                guard let self else { throw CancellationError() }; return try await self.teamService.teamDeliveries(id: request, token: self.approvalToken(binding))
            }, send: { [weak self] binding, draft in
                guard let self else { throw CancellationError() }; return try await self.teamService.reportTeamOutcome(draft, token: self.approvalToken(binding))
            }, load: { [weak self] account in
                guard let self else { throw CancellationError() }; return try self.readTeamDraft(TeamOutcomeDraft.self, account: account, name: request + "-outcome.json")
            }, save: { [weak self] draft in
                guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
                try draft.validate(account: draft.accountID, request: request); try self.writeTeamDraft(draft, account: draft.accountID, name: request + "-outcome.json")
            }, changed: { [weak outcome] in outcome?.state = $0 })
            outcome.controller = controller; self?.outcomeControllers.register(controller); return outcome
        }
        presentation.makeDelivery = { [weak self] request in
            let delivery = TeamDeliveryPresentation()
            let controller = TeamDeliveryController(requestID: request, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, after in
                guard let self else { throw CancellationError() }
                return try await self.teamService.teamDeliveries(id: request, after: after, token: self.approvalToken(binding))
            }, changed: { [weak delivery] in delivery?.state = $0 })
            delivery.controller = controller; self?.deliveryControllers.register(controller)
            return delivery
        }
        presentation.makeIntake = { [weak self] request, product in self?.makeTeamIntake(request: request, product: product) ?? TeamIntakePresentation() }
        presentation.makeTextHistory = { [weak self] request, target, product in
            let text = TeamTextRevisionPresentation()
            let controller = TeamTextRevisionController(requestID: request, targetID: target, identity: { [weak self] in try await self?.approvalIdentity() }, discover: { [weak self] binding in
                guard let self else { throw CancellationError() }
                let access = try await self.teamService.teamRequestAccess(token: self.approvalToken(binding)); try access.validate(account: binding.accountID)
                guard access.products.contains(product) else { throw SyncFailure.http(403, "team_product_denied") }
                return access.supported_text_revision_schemas ?? []
            }, fetch: { [weak self] binding, after in
                guard let self else { throw CancellationError() }; return try await self.teamService.teamTextHistory(id: request, target: target, after: after, token: self.approvalToken(binding))
            }, send: { [weak self] binding, draft in
                guard let self else { throw CancellationError() }; return try await self.teamService.reviseTeamText(draft, token: self.approvalToken(binding))
            }, load: { [weak self] account in
                guard let self else { throw CancellationError() }; return try self.readTeamDraft(TeamTextRevisionDraft.self, account: account, name: target + "-text.json")
            }, save: { [weak self] draft in
                guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
                try draft.validate(account: draft.accountID, request: request, target: target); try self.writeTeamDraft(draft, account: draft.accountID, name: target + "-text.json")
            }, changed: { [weak text] in text?.state = $0 })
            text.controller = controller; self?.textRevisionControllers.register(controller); return text
        }
        presentation.makeRelations = { [weak self] request, product in
            let related = TeamRelationPresentation()
            let controller = TeamRelationController(requestID: request, product: product, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, target, after in
                guard let self else { throw CancellationError() }; return try await self.teamService.teamRelations(id: request, target: target, after: after, token: self.approvalToken(binding))
            }, targets: { [weak self] binding, before in
                guard let self else { throw CancellationError() }; return try await self.teamService.teamRequestList(product: product, before: before, token: self.approvalToken(binding))
            }, send: { [weak self] binding, draft in
                guard let self else { throw CancellationError() }; return try await self.teamService.changeTeamRelation(draft, token: self.approvalToken(binding))
            }, load: { [weak self] account in
                guard let self else { throw CancellationError() }; return try self.readTeamDraft(TeamRelationDraft.self, account: account, name: request + "-related.json")
            }, save: { [weak self] draft in
                guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
                try draft.validate(account: draft.accountID, request: request, product: product); try self.writeTeamDraft(draft, account: draft.accountID, name: request + "-related.json")
            }, changed: { [weak related] in related?.state = $0 })
            related.controller = controller; self?.relationControllers.register(controller); return related
        }
        presentation.makeGitHub = { [weak self] request in
            let github = TeamGitHubPresentation()
            github.makeObservations = { [weak self] in
                let observation = TeamGitHubObservationPresentation()
                let controller = TeamGitHubObservationController(requestID: request, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, after in
                    guard let self else { throw CancellationError() }
                    return try await self.teamService.teamGitHubObservations(id: request, after: after, token: self.approvalToken(binding))
                }, changed: { [weak observation] in observation?.state = $0 })
                observation.controller = controller; self?.githubObservationControllers.register(controller)
                return observation
            }
            github.controller = TeamGitHubController(requestID: request, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, after in
                guard let self else { throw CancellationError() }
                return try await self.teamService.teamGitHub(id: request, after: after, token: self.approvalToken(binding))
            }, send: { [weak self] binding, draft in
                guard let self else { throw CancellationError() }
                return try await self.teamService.associateTeamGitHub(draft, token: self.approvalToken(binding))
            }, load: { [weak self] account in
                guard let self else { throw CancellationError() }
                return try self.readTeamDraft(TeamGitHubDraft.self, account: account, name: request + "-github.json")
            }, save: { [weak self] draft in
                guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
                try draft.validate(account: draft.accountID, request: request)
                try self.writeTeamDraft(draft, account: draft.accountID, name: request + "-github.json")
            }, changed: { [weak github] in github?.state = $0 })
            return github
        }
        presentation.makeWorkflow = { [weak self] request, product in
            let workflow = TeamWorkflowPresentation()
            workflow.controller = TeamWorkflowController(requestID: request, product: product, identity: { [weak self] in try await self?.approvalIdentity() }, fetch: { [weak self] binding, after in
                guard let self else { throw CancellationError() }
                return try await self.teamService.teamWorkflow(id: request, after: after, token: self.approvalToken(binding))
            }, members: { [weak self] binding in
                guard let self else { throw CancellationError() }
                return try await self.teamService.teamAssignmentMembers(product: product, account: binding.accountID, token: self.approvalToken(binding))
            }, targets: { [weak self] binding, before in
                guard let self else { throw CancellationError() }
                return try await self.teamService.teamRequestList(product: product, before: before, token: self.approvalToken(binding))
            }, send: { [weak self] binding, draft in
                guard let self else { throw CancellationError() }
                return try await self.teamService.changeTeamWorkflow(draft, token: self.approvalToken(binding))
            }, load: { [weak self] account in
                guard let self else { throw CancellationError() }
                return try self.readTeamDraft(TeamWorkflowDraft.self, account: account, name: request + "-workflow.json")
            }, save: { [weak self] draft in
                guard let self, self.signedIn, !self.loggingOut, self.account?.accountID == draft.accountID else { throw CancellationError() }
                try draft.validate(account: draft.accountID, request: request)
                try self.writeTeamDraft(draft, account: draft.accountID, name: request + "-workflow.json")
            }, changed: { [weak workflow] in workflow?.state = $0 })
            return workflow
        }
        return presentation
    }
    private func teamDraftFile(account: String, name: String) throws -> URL {
        let key = try approvalDirectory(account).lastPathComponent
        return directory.appendingPathComponent("team-requests", isDirectory: true).appendingPathComponent(key, isDirectory: true).appendingPathComponent(name)
    }
    private func clearIntakeCredentials(accountID: String) throws {
        try IntakeKeychain(studioAccountID: accountID, origin: teamService.serviceOrigin).removeAllForStudioAccount()
    }
    private func invalidateIntake() {
        intakePresentations.invalidate()
        if let id = account?.accountID {
            do { try clearIntakeCredentials(accountID: id) }
            catch { self.error = "Lab 연결 정보를 지우지 못했어요. 다시 로그인하기 전에 저장소를 확인해 주세요." }
        }
    }
    private func makeTeamIntake(request: String, product: String) -> TeamIntakePresentation {
        let presentation = TeamIntakePresentation()
        presentation.configure = { [weak self, weak presentation] in
            guard let self, let presentation, let initial = try await self.approvalIdentity() else { throw IntakeFailure.identityChanged }
            let access = try await self.teamService.teamRequestAccess(token: self.approvalToken(initial)); try access.validate(account: initial.accountID)
            guard access.products.contains(product), try await self.approvalIdentity() == initial else { throw IntakeFailure.identityChanged }
            let page = try await self.teamService.teamGitHub(id: request, after: nil, token: self.approvalToken(initial))
            guard try await self.approvalIdentity() == initial else { throw IntakeFailure.identityChanged }
            presentation.repository = page.configured_repository; presentation.canAssociate = page.can_manage
            if presentation.controller != nil { return }
            let origin = self.teamService.serviceOrigin
            let vault = try IntakeKeychain(studioAccountID: initial.accountID, origin: origin)
            let wire = try IntakeURLSessionTransport(origin: origin)
            let transport: IntakeTransport = { url, headers, body in
#if DEBUG
                if TeamIntakeFixture.enabled { return try await TeamIntakeFixture.send(url, headers: headers, body: body) }
#endif
                return try await wire.send(url, headers: headers, body: body)
            }
            let current: () -> Bool = { [weak self] in self?.signedIn == true && self?.loggingOut == false && self?.account?.accountID == initial.accountID && self?.account?.tokens.session_id == initial.sessionID }
            let selectionName = request + "-intake-selection.json"
            let name: (IntakePrincipal, String) -> String = { principal, suffix in
                let scope = principal.id + "|" + principal.endpoint
                let hash = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
                return request + "-intake-" + hash + suffix
            }
            presentation.clearSecret = { try vault.removeAllForStudioAccount() }
            presentation.device = try IntakeDeviceAuth(origin: origin, studioIdentity: { current() ? initial.accountID + ":" + initial.sessionID : nil }, transport: transport, saveSecret: { [weak self, weak presentation] principal, token in
                guard current(), let self else { throw IntakeFailure.identityChanged }
                try vault.save(principal: principal, token: token)
                do { try self.writeTeamDraft(TeamIntakeSelection(principalID: principal.id), account: initial.accountID, name: selectionName) }
                catch { try? vault.remove(principalID: principal.id); throw error }
                presentation?.principal = principal
            }, clearSecret: { [weak presentation] in
#if DEBUG
                if TeamIntakeFixture.enabled, ProcessInfo.processInfo.environment["HP_TEAM_INTAKE_DISCONNECT_FAIL"] == "1", presentation?.principal != nil { throw IntakeFailure.storage }
#endif
                try vault.removeAllForStudioAccount()
            }, changed: { [weak presentation] in presentation?.auth = $0 })
            presentation.restore = { [weak self, weak presentation] in
                guard current(), let self, let presentation else { throw IntakeFailure.identityChanged }
                presentation.principal = nil
                if let selected = try self.readTeamDraft(TeamIntakeSelection.self, account: initial.accountID, name: selectionName), let id = selected.principalID, let credential = try vault.read(principalID: id) {
                    presentation.principal = credential.principal
                    presentation.summary = try self.readTeamDraft(IntakeProposal.self, account: initial.accountID, name: name(credential.principal, "-summary.json")) ?? IntakeProposal()
                }
            }
            presentation.persistSummary = { [weak self, weak presentation] summary in
                guard current(), let self, let principal = presentation?.principal else { throw IntakeFailure.identityChanged }
#if DEBUG
                if TeamIntakeFixture.enabled, ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "intake", summary.title.contains("Unstored") { throw CocoaError(.fileWriteOutOfSpace) }
#endif
                guard try JSONEncoder().encode(summary).count <= 65_536 else { throw IntakeFailure.storage }
                try self.writeTeamDraft(summary, account: initial.accountID, name: name(principal, "-summary.json"))
            }
            let client = try IntakeClient(origin: origin, token: { [weak presentation] in
                guard current(), let principal = presentation?.principal else { return nil }
                return try? vault.read(principalID: principal.id)?.bearer()
            }, transport: transport)
            presentation.client = client
            presentation.controller = IntakeProposalController(context: { [weak self, weak presentation] in
                guard let self, let principal = presentation?.principal, principal.expiresAt > Date(), let binding = try await self.approvalIdentity(), binding == initial else { return nil }
                let access = try await self.teamService.teamRequestAccess(token: self.approvalToken(binding)); try access.validate(account: binding.accountID)
                guard access.products.contains(product) else { throw IntakeFailure.routing }
                let detail = try await self.teamService.teamRequestDetail(id: request, after: nil, token: self.approvalToken(binding))
                let history = try await self.teamService.teamTextHistory(id: request, target: request, after: nil, token: self.approvalToken(binding))
                guard current(), try await self.approvalIdentity() == binding, detail.request.product == product, detail.retention?.hidden != true else { throw IntakeFailure.identityChanged }
                return IntakeBinding(studioAccountID: binding.accountID, studioSessionEpoch: binding.sessionID, principal: principal, requestID: request, sourceRevision: detail.request.revision, sourceTextRevision: history.current.revision)
            }, route: { [weak self, weak presentation] binding in
                guard current(), let self, presentation?.principal?.id == binding.intakePrincipalID else { throw IntakeFailure.identityChanged }
                let page = try await self.teamService.teamGitHub(id: request, after: nil, token: self.approvalToken(initial))
                let policy = try await client.call("get_intake_policy")
                guard current(), let values = policy["policy"]?["repositories"]?.array, let revision = policy["policy"]?["revision"]?.string else { throw IntakeFailure.invalidResponse }
                let repos = values.compactMap { $0.string }; guard repos.count == values.count else { throw IntakeFailure.invalidResponse }
                presentation?.repository = page.configured_repository; presentation?.canAssociate = page.can_manage; presentation?.policyRevision = revision
                return IntakeRoute(configuredRepository: page.configured_repository, repositories: repos, policyRevision: revision)
            }, call: { tool, arguments in try await client.call(tool, arguments: arguments) }, load: { [weak self] binding in
                guard current(), let self else { throw IntakeFailure.identityChanged }
                let principal = IntakePrincipal(id: binding.intakePrincipalID, endpoint: binding.endpoint, expiresAt: Date())
                return try self.readTeamDraft(IntakeOperation.self, account: binding.studioAccountID, name: name(principal, "-operation.json"), maxBytes: 262144)
            }, save: { [weak self] operation in
                guard current(), let self, operation.binding.studioAccountID == initial.accountID else { throw IntakeFailure.identityChanged }
                let principal = IntakePrincipal(id: operation.binding.intakePrincipalID, endpoint: operation.binding.endpoint, expiresAt: Date())
                guard try JSONEncoder().encode(operation).count <= 262144 else { throw IntakeFailure.storage }
                try self.writeTeamDraft(operation, account: initial.accountID, name: name(principal, "-operation.json"))
            }, changed: { [weak presentation] in presentation?.state = $0 })
            presentation.github = self.teamRequests.makeGitHub(request)
        }
        intakePresentations.register(presentation); return presentation
    }
    private func readTeamDraft<T: Decodable>(_ type: T.Type, account: String, name: String, maxBytes: Int = 65_536) throws -> T? {
        let file = try teamDraftFile(account: account, name: name)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let data = try Data(contentsOf: file); guard data.count <= maxBytes else { throw SyncFailure.invalidResponse }
        return try JSONDecoder().decode(type, from: data)
    }
    private func writeTeamDraft<T: Encodable>(_ value: T, account: String, name: String) throws {
#if DEBUG
        if NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "text", name.hasSuffix("-text.json"), let draft = value as? TeamTextRevisionDraft, draft.body.contains("Unstored") { throw CocoaError(.fileWriteOutOfSpace) }
        if NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "related", name.hasSuffix("-related.json"), let draft = value as? TeamRelationDraft, !draft.reason.isEmpty { throw CocoaError(.fileWriteOutOfSpace) }
        if NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "outcome", name.hasSuffix("-outcome.json"), let draft = value as? TeamOutcomeDraft, !draft.result.isEmpty { throw CocoaError(.fileWriteOutOfSpace) }
        if NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "github", name.hasSuffix("-github.json"), let draft = value as? TeamGitHubDraft, !draft.reason.isEmpty { throw CocoaError(.fileWriteOutOfSpace) }
        if NativeJourneyFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_DRAFT_SAVE_FAILURE"] == "comment" && name.hasPrefix("trq_") { throw CocoaError(.fileWriteOutOfSpace) }
#endif
        let file = try teamDraftFile(account: account, name: name)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var folder = file.deletingLastPathComponent(); var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private var observedReflectionID: String?
    lazy var questions: AccountQuestionPresentation = makeQuestions()
    private func makeQuestions() -> AccountQuestionPresentation {
        let presentation = AccountQuestionPresentation()
        presentation.controller = AccountQuestionController(identity: { [weak self] in try await self?.approvalIdentity() }, load: { [weak self] binding in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.teamService.accountQuestion(token)
        }, act: { [weak self] binding, key, action, body in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.teamService.accountQuestionAction(key, action: action, body: body, token: token)
        }, start: { [weak self] binding, id, choice in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            try await self.teamService.startAccountQuestion(id: id, choice: choice, token: token)
        }, loadIntent: { [weak self] account in
            guard let self else { throw CancellationError() }
            let file = try self.questionIntentFile(account)
            guard FileManager.default.fileExists(atPath: file.path) else { return nil }
            let data = try Data(contentsOf: file); guard data.count < 4096 else { throw SyncFailure.invalidResponse }
            let intent = try JSONDecoder().decode(AccountQuestionIntent.self, from: data); try intent.validate(account: account); return intent
        }, saveIntent: { [weak self] account, intent in
            guard let self else { throw CancellationError() }
            let file = try self.questionIntentFile(account)
            if let intent {
                try intent.validate(account: account)
                try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                var folder = file.deletingLastPathComponent(); var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try folder.setResourceValues(flags)
                try JSONEncoder().encode(intent).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } else if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }, observed: { [weak self] event in self?.experience.controller?.record(event) }, startingAvailable: { [weak self] account in self?.experience.controller?.available(for: account) == true }, changed: { [weak presentation] in presentation?.state = $0 })
        return presentation
    }
    lazy var approvals: MemberApprovalPresentation = makeApprovals()
    private func makeApprovals() -> MemberApprovalPresentation {
        let presentation = MemberApprovalPresentation()
        presentation.controller = MemberApprovalController(identity: { [weak self] in try await self?.approvalIdentity() }, list: { [weak self] binding in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.service.approvalInbox(token)
        }, card: { [weak self] binding, id, decision in
            guard let self else { throw CancellationError() }
            let token = try await self.approvalToken(binding)
            return try await self.service.approvalCard(id, decision: decision, token: token)
        }, load: { [weak self] account in
            guard let self else { throw CancellationError() }
            let folder = try self.approvalDirectory(account)
            guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            guard files.count <= 50 else { throw SyncFailure.invalidResponse }
            return try files.map { file in
                let data = try Data(contentsOf: file)
                guard data.count < 4096 else { throw SyncFailure.invalidResponse }
                let value = try JSONDecoder().decode(MemberApprovalPending.self, from: data)
                try value.validate(account: account); return value
            }
        }, save: { [weak self] account, pending in
            guard let self else { throw CancellationError() }
            try pending.validate(account: account)
            let folder = try self.approvalDirectory(account)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var excluded = folder; var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try excluded.setResourceValues(flags)
            try JSONEncoder().encode(pending).write(to: folder.appendingPathComponent(pending.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }, remove: { [weak self] account, id in
            guard let self, UUID(uuidString: id)?.uuidString.lowercased() == id else { throw SyncFailure.invalidResponse }
            let file = try self.approvalDirectory(account).appendingPathComponent(id + ".json")
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }, changed: { [weak presentation, weak self] state in presentation?.state = state; self?.approvalEntryVisible = state.entryVisible })
        return presentation
    }
    private func discoverApprovals() {
        let attempt = epoch
        Task { [weak self] in
            guard let self, self.epoch == attempt, self.signedIn else { return }
            await self.approvals.controller?.discover()
        }
        Task { [weak self] in await self?.refreshDisplayName(attempt: attempt) }
        Task { [weak self] in await self?.experience.controller?.refresh() }
        Task { [weak self] in if self?.push.controller?.enabled == true { await NativePushCenter.shared.register() } }
    }
    private func refreshDisplayName(attempt: UUID) async {
        guard let before = account else { return }
        do {
            let credential = try await token()
            let profile = try await service.accountProfile(credential, sessionID: before.tokens.session_id)
            guard epoch == attempt, signedIn, account?.accountID == before.accountID,
                  account?.tokens.session_id == before.tokens.session_id, profile.id == before.accountID else { return }
            displayName = profile.displayName
        } catch { /* Greeting availability never blocks conversation or grants membership. */ }
    }
    private func approvalDirectory(_ account: String) throws -> URL {
        guard StoredAccount.validID(account) else { throw SyncFailure.invalidResponse }
        let key = Data(account.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "")
        return directory.appendingPathComponent("approval-decisions", isDirectory: true).appendingPathComponent(key, isDirectory: true)
    }
    private func experienceFile(_ account: String) throws -> URL {
        let key = try approvalDirectory(account).lastPathComponent
        return directory.appendingPathComponent("product-experience", isDirectory: true).appendingPathComponent(key + ".json")
    }
    private func questionIntentFile(_ account: String) throws -> URL {
        let key = try approvalDirectory(account).lastPathComponent
        return directory.appendingPathComponent("question-intents", isDirectory: true).appendingPathComponent(key + ".json")
    }
    private func approvalIdentity() async throws -> MemberApprovalIdentity? {
        guard signedIn, !loggingOut, let before = account else { return nil }
        let attempt = epoch, credential = try await token()
        let returned = try await service.accountID(credential, sessionID: before.tokens.session_id)
        guard epoch == attempt, signedIn, !loggingOut, let current = account, current.accountID == returned, current.accountID == before.accountID, current.tokens.session_id == before.tokens.session_id else { throw CancellationError() }
        return MemberApprovalIdentity(accountID: returned, sessionID: current.tokens.session_id)
    }
    private func approvalToken(_ binding: MemberApprovalIdentity) async throws -> String {
        let attempt = epoch, credential = try await token()
        guard epoch == attempt, signedIn, !loggingOut, account?.accountID == binding.accountID, account?.tokens.session_id == binding.sessionID else { throw CancellationError() }
        return credential
    }
    private var operation: Task<Void, Never>?
    private var polling: Task<Void, Never>?
    private var personalHistoryNeedsRetry = false
    private var conversationListFlight: (id: UUID, epoch: UUID, task: Task<Void, Never>)?
    @Published private(set) var conversationListError: String?
    private var epoch = UUID()
    private var visible = true
    private var cacheReadable = true
    private let service: ConversationService
    private let browser = NativeBrowserSignIn()
    @Published private(set) var loginStatus = ""
    private var queuedSend: (id: String, requestID: String)?
    private struct LogoutIntent {
        let epoch: UUID
        let accountID: String
        let sessionID: String
    }
    private var queuedLogout: LogoutIntent?
    private let directory: URL
    var cache: ConversationCache { overlay(entries[selected ?? ""] ?? ConversationCache(), id: selected ?? "") }
    var draftText: String { signedIn ? cache.draft : guestDraft.text }
    var canEditDraft: Bool { !loggingOut && (signedIn ? selected != nil && cacheReadable : guestDraftReadable) }
    var canLogout: Bool { signedIn && account != nil && !busy && !stoppingReflection }
    var pendingGuestDraft: String? { signedIn && !guestDraft.text.isEmpty ? guestDraft.text : nil }
    var canRestoreGuestDraft: Bool {
        // Ordinary history reads preserve the current local draft. A synchronous
        // explicit restore can safely use the same durable edit path as typing.
        signedIn && account != nil && accountStorageReady && cacheReadable && guestDraftReadable && isReflection
            && !busy && !loggingOut && !stoppingReflection && guestDraft.canRestore(into: cache)
    }
    var canRestoreFailedReflectionDraft: Bool {
        // A history GET never owns the local draft. Restore from the current
        // cache while it is pending, just as ordinary typing remains available.
        signedIn && accountStorageReady && cacheReadable && isReflection && !busy
            && !loggingOut && !stoppingReflection && cache.canRestoreFailedReflectionDraft
    }
    @discardableResult func restoreFailedReflectionDraft() -> Bool {
#if DEBUG
        NativeJourneyFixture.failedDraftRestoreAttempt(eligible: canRestoreFailedReflectionDraft)
#endif
        guard canRestoreFailedReflectionDraft else { return false }
        do {
            try edit(Self.personalID) { _ = $0.restoreFailedReflectionDraft() }
#if DEBUG
            NativeJourneyFixture.failedDraftRestored()
#endif
            notice = "입력란에 가져왔어요. 내용을 확인한 뒤 보내 주세요."
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    var title: String { conversations.first { $0.id == selected }?.title ?? "대화 이어가기" }
    var canStopReflection: Bool {
        signedIn && accountStorageReady && cacheReadable && isReflection && !stoppingReflection
            && !syncing && (reflectionCredential != nil || !busy) && cache.request?.outstanding == true
    }
    var canSend: Bool { !stoppingReflection && signedIn && cacheReadable && conversations.contains(where: { $0.id == selected }) && cache.request?.outstanding != true && !busy }
    var sendingCurrentRequest: Bool {
        busy || (queuedSend != nil && queuedSend?.id == selected && queuedSend?.requestID == cache.request?.id)
    }
    init() {
#if DEBUG
        service = NativeJourneyFixture.service ?? ConversationService()
        let cacheName = NativeJourneyFixture.enabled ? "native-journey-" + NativeJourneyFixture.namespace : "shared-conversations"
#else
        service = ConversationService()
        let cacheName = "shared-conversations"
#endif
        directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(cacheName, isDirectory: true)
        restoreAccount()
        do { guestDraft = try GuestDraft.load(from: guestFile) }
        catch {
            guestDraftReadable = false; guestDraftFailure = GuestDraftError.unreadable.localizedDescription
            self.error = guestDraftFailure
        }
    }
    func restoreAccount() {
        guard !busy, !syncing, !stoppingReflection, !signedIn else { return }
        error = nil; accountStorageReady = false
#if DEBUG
        accountStorageVerified = false
#endif
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            account = try AccountKeychain.read()
            if account?.refreshPending == true {
                // The previous process may have consumed the one-use token.
                // Never retry it. Conversation files remain untouched.
                account = nil
                try AccountKeychain.remove()
                error = "로그인 갱신이 중단됐어요. 다시 로그인하면 저장된 대화를 이어갈 수 있어요."
            }
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--verify-account-storage") {
                try AccountKeychain.verifyNativeStorage(); accountStorageVerified = true
            }
#endif
            accountStorageReady = true; signedIn = account != nil
            if let account { try load(account.accountID); discoverApprovals() }
        } catch { self.error = error.localizedDescription }
    }
    private func file(_ accountID: String) -> URL {
        // Identity-derived filename never accepts path components from the server.
        directory.appendingPathComponent(Data(accountID.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_") + ".json")
    }
    private var guestFile: URL { directory.appendingPathComponent("guest-draft-v1.json") }
    private func load(_ id: String) throws {
        // The local personal draft is editable immediately, even offline. Send
        // still requires the authenticated server conversation in canSend.
        entries = [:]; conversations = []; selected = Self.personalID; cacheReadable = true
#if DEBUG
        try NativeJourneyFixture.seedAccountDraftIfNeeded(at: file(id), accountID: id)
#endif
        guard FileManager.default.fileExists(atPath: file(id).path) else { return }
        do {
            let value = try JSONDecoder().decode(SharedCacheFile.self, from: Data(contentsOf: file(id)))
            guard value.accountID == id else { throw SyncFailure.invalidResponse }
            entries = value.entries; conversations = value.conversations
        } catch { cacheReadable = false; throw StudioError.message("이 기기의 연동 기록을 읽지 못했어요. 원본을 보존하기 위해 덮어쓰지 않아요.") }
    }
    private func persist(entries: [String: ConversationCache], conversations: [SharedConversation]? = nil) throws {
        guard cacheReadable, let account else { throw StudioError.message("연동 기록을 안전하게 저장할 수 없어요.") }
        let list = conversations ?? self.conversations
        let bytes = try JSONEncoder().encode(SharedCacheFile(accountID: account.accountID, conversations: list, entries: entries))
        var url = file(account.accountID)
        try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        self.entries = entries; self.conversations = list
    }
    private func edit(_ id: String, _ change: (inout ConversationCache) throws -> Void) throws {
        var next = entries; var value = overlay(next[id] ?? ConversationCache(), id: id); try change(&value); next[id] = value
        try persist(entries: next)
        if let account { editing[account.accountID]?[id] = nil }
    }
    private func overlay(_ original: ConversationCache, id: String) -> ConversationCache {
        original.applyingEdits(editing[account?.accountID ?? ""]?[id] ?? [:])
    }
    func editDraft(_ value: String) {
        guard canEditDraft else { return }
        if !signedIn {
            guestDraft.text = value
            do {
                guard guestDraftReadable else { throw GuestDraftError.unreadable }
                try guestDraft.save(to: guestFile)
                if error == guestDraftFailure { error = nil }
                guestDraftFailure = nil
            } catch { guestDraftFailure = error.localizedDescription; self.error = guestDraftFailure }
            return
        }
        guard let selected, let account else { return }
        editing[account.accountID, default: [:]][selected, default: [:]]["draft"] = value
        do { try edit(selected) { $0.draft = value } } catch { self.error = error.localizedDescription }
    }
    @discardableResult func restoreGuestDraft() -> Bool {
        guard canRestoreGuestDraft else { return false }
        return adoptGuestDraft()
    }
    private func adoptGuestDraft() -> Bool {
        guard signedIn, accountStorageReady, cacheReadable, guestDraftReadable, isReflection,
              account != nil, guestDraft.canRestore(into: cache) else { return false }
        var next = guestDraft
        do {
            let restored = try next.handoff(into: cache, saveAccount: { value in
                try self.edit(Self.personalID) { $0 = value }
            }, saveGuest: { try $0.save(to: self.guestFile) })
            guestDraft = next
            if error == guestDraftFailure { error = nil }
            guestDraftFailure = nil
            return restored
        } catch { guestDraftFailure = error.localizedDescription; self.error = guestDraftFailure; return false }
    }
    func editContext(_ key: String, value: String) {
        guard !loggingOut, let selected, let account else { return }
        editing[account.accountID, default: [:]][selected, default: [:]][key] = value
        do { try edit(selected) { if $0.context == nil { $0.context = [:] }; $0.context?[key] = value } }
        catch { self.error = error.localizedDescription }
    }
    func shareContextDraft() -> Bool {
        guard !loggingOut else { return false }
        guard let selected, cache.draft.isEmpty else { error = "작성 중인 글을 먼저 확인해 주세요. 덮어쓰지 않았어요."; return false }
        let fields = [("goal", "바라는 변화"), ("audience", "도움을 주고 싶은 사람"), ("experience", "지금 알고 있는 것과 어려운 것"), ("style", "편한 질문 방식")]
        let lines = fields.compactMap { key, title -> String? in
            guard let value = cache.context?[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
            return title + ": " + value
        }
        guard !lines.isEmpty else { error = "공유하고 싶은 내용 한 가지만 적어도 괜찮아요."; return false }
        do { try edit(selected) { $0.draft = "내가 직접 정리한 현재 맥락이에요. 바뀌면 다시 알려드릴게요.\n" + lines.joined(separator: "\n") }; return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func choose(_ id: String?) { selected = id; error = nil; refresh() }
    func setVisible(_ value: Bool) {
        visible = value; polling?.cancel(); polling = nil
        if value {
            refresh()
            polling = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 4_000_000_000)
                    guard !Task.isCancelled, let self, self.visible else { return }
                    await self.synchronize(automatic: true)
                }
            }
        }
        // Keep an in-flight refresh alive to store rotated credentials. No new reads are scheduled in background.
    }
    func login() {
#if DEBUG
        // Which guard returned, if any (#4432 F23: run 44866066162 never sent the sign-in start).
        if busy || syncing || stoppingReflection || !accountStorageReady {
            NativeJourneyFixture.signInFinished(busy ? "ignored.busy" : syncing ? "ignored.syncing" : stoppingReflection ? "ignored.stopping" : "ignored.storage")
        }
#endif
        guard !busy, !syncing, !stoppingReflection else { return }
        guard accountStorageReady else { error = "계정 저장소를 먼저 다시 확인해 주세요."; return }
        busy = true; error = nil; loginStatus = "계정 로그인 화면을 열고 있어요."; let attempt = epoch
#if DEBUG
        NativeJourneyFixture.signInMark("busy")
#endif
        operation = Task {
            var acquired: AccountTokens?
            do {
                let proof = NativeAccountProof()
                let start = try await service.startNativeSignIn(proof)
#if DEBUG
                NativeJourneyFixture.signInMark("started")
#endif
                guard epoch == attempt else { return }
                loginStatus = "계정 로그인을 마치면 자동으로 돌아와요."
                let callback = try await browser.authenticate(start.authorization_uri, expiresIn: start.expires_in)
#if DEBUG
                NativeJourneyFixture.signInMark("callback")
#endif
                try Task.checkCancellation()
                guard epoch == attempt else { return }
                loginStatus = "로그인을 마무리하고 있어요."
                // The code is single-use. Never retry an ambiguous exchange.
                let tokens = try await service.exchangeNativeSignIn(callback: callback, proof: proof)
                acquired = tokens
                let id = try await service.accountID(tokens.access_token, sessionID: tokens.session_id)
                try Task.checkCancellation()
                guard epoch == attempt else { try? await service.logout(tokens.access_token); return }
                let value = try StoredAccount(accountID: id, tokens: tokens, expiresAt: Date().addingTimeInterval(tokens.expires_in))
                do {
                    // Purge independently of any live screen, including a previous failed boundary cleanup.
                    if let old = account?.accountID { try clearIntakeCredentials(accountID: old) }
                    try clearIntakeCredentials(accountID: value.accountID)
                    try AccountKeychain.save(value)
                }
                catch { accountStorageReady = false; throw error }
                tokenFlight.invalidate(); approvals.invalidate(); questions.controller?.invalidate(); teamRequests.controller?.invalidate(); teamInbox.controller?.invalidate(); deliveryControllers.invalidate(); outcomeControllers.invalidate(); githubObservationControllers.invalidate(); relationControllers.invalidate(); textRevisionControllers.invalidate(); invalidateIntake(); experience.controller?.invalidate(); push.controller?.invalidate(); NativePushCenter.shared.stop(); observedReflectionID = nil; displayName = nil
                account = value; signedIn = true; acquired = nil
#if DEBUG
                NativeJourneyFixture.signInFinished("signedIn")
#endif
                try load(id)
                // Only this successful, epoch-fenced explicit login may adopt
                // guest writing. This changes a local draft, never the outbox.
                _ = adoptGuestDraft()
                discoverApprovals()
            } catch {
#if DEBUG
                NativeJourneyFixture.signInFinished("failed")
#endif
                if let acquired { try? await service.logout(acquired.access_token) }
                if epoch == attempt {
                    if error is CancellationError || (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        notice = "로그인을 취소했어요. 준비되면 다시 시작해 주세요."
                    } else { self.error = error.localizedDescription }
                }
            }
            if epoch == attempt { busy = false; loginStatus = ""; await synchronize() }
        }
    }
    func cancelLogin() {
        epoch = UUID(); browser.cancel(); operation?.cancel(); operation = nil
        queuedLogout = nil; loggingOut = false
        signIn = nil; busy = false; loginStatus = ""; notice = "로그인을 취소했어요."
    }
    private func token() async throws -> String {
        guard accountStorageReady, let current = account else { throw SyncFailure.http(401, "account_required") }
        if current.expiresAt > Date().addingTimeInterval(90) { return current.tokens.access_token }
        return try await tokenFlight.run(identity: MemberApprovalIdentity(accountID: current.accountID, sessionID: current.tokens.session_id), current: { [weak self] in
            guard let account = self?.account else { return nil }
            return MemberApprovalIdentity(accountID: account.accountID, sessionID: account.tokens.session_id)
        }, renew: { try await self.renewToken() })
    }
    private func renewToken() async throws -> String {
        guard accountStorageReady, let old = account else { throw SyncFailure.http(401, "account_required") }
        if old.expiresAt > Date().addingTimeInterval(90) { return old.tokens.access_token }
        do {
            let next = try await AccountCredentialRefresh.renew(old, save: { value in
                guard self.account?.tokens.session_id == old.tokens.session_id else { throw CancellationError() }
                do { try AccountKeychain.save(value) }
                catch { self.accountStorageReady = false; throw error }
            }, refresh: { try await self.service.refresh($0) }, accountID: { tokens in
                try await self.service.accountID(tokens.access_token, sessionID: tokens.session_id)
            }, revoke: { try? await self.service.logout($0) })
            guard account?.accountID == old.accountID, account?.tokens.session_id == old.tokens.session_id else { throw CancellationError() }
            account = next; return next.tokens.access_token
        } catch {
            // Refresh tokens rotate once. An uncertain response requires fresh login, never reuse.
            if account?.tokens.session_id == old.tokens.session_id { clearAccount() }
            throw error
        }
    }
    private func clearAccount() {
        displayName = nil
        questions.controller?.invalidate(); teamRequests.controller?.invalidate(); teamInbox.controller?.invalidate(); deliveryControllers.invalidate(); outcomeControllers.invalidate(); githubObservationControllers.invalidate(); relationControllers.invalidate(); textRevisionControllers.invalidate(); invalidateIntake(); experience.controller?.invalidate(); push.controller?.invalidate(); NativePushCenter.shared.stop(); observedReflectionID = nil
        conversationListFlight?.task.cancel(); conversationListFlight = nil; conversationListError = nil
        tokenFlight.invalidate(); approvals.invalidate()
        do { try AccountKeychain.remove() } catch { accountStorageReady = false }
        account = nil; signedIn = false; entries = [:]; conversations = []; selected = nil
    }
    func refresh() { Task { await synchronize() } }
    private func synchronize(automatic: Bool = false) async {
        guard signedIn, cacheReadable, visible, !busy, !syncing, !stoppingReflection else { return }
        guard !automatic || !isReflection || !personalHistoryNeedsRetry else { return }
        // Periodic reads keep reconciliation active without repeatedly moving
        // an already usable personal transcript. Explicit recovery stays visible.
        showsSyncProgress = !automatic || !isReflection || !conversations.contains(where: { $0.id == Self.personalID })
        syncing = true; let attempt = epoch; let current = selected
#if DEBUG
        NativeJourneyFixture.synchronizationStarted(automatic: automatic)
#endif
        defer {
            syncing = false
            showsSyncProgress = false
            // Preserve one-use credential rotation. Explicit logout wins over
            // queued Send after the existing refresh/read has fully unwound.
            if let intent = queuedLogout, intent.epoch == attempt {
                queuedLogout = nil
                if matches(intent) { finishLogout(intent) }
                else if epoch == attempt { busy = false; loggingOut = false; notice = "" }
            }
            // Only this session's explicit Send can start a queued request. Reads,
            // restart and ambiguous network failures never schedule a replay.
            if let queued = queuedSend {
                queuedSend = nil
                if epoch == attempt, visible, selected == queued.id,
                   entries[queued.id]?.request?.id == queued.requestID { retry() }
            }
        }
        do {
            let credential = try await token()
#if DEBUG
            // Only the isolated logout journey holds HTTP for deliberate UI
            // actions. Release and every other scenario retain the 25s limit.
            let personal = try await service.reflection(credential, timeout: NativeJourneyFixture.logoutSync ? 90 : 25)
#else
            let personal = try await service.reflection(credential)
#endif
            guard epoch == attempt else { return }
            try applyReflection(personal)
#if DEBUG
            NativeJourneyFixture.failedDraftHistoryApplied()
#endif
            personalHistoryNeedsRetry = false
            let personalItem = SharedConversation(id: Self.personalID, title: "나를 알아가는 대화", host_session_id: "", revision: personal.state.revision, updated_at: personal.state.messages.last?.created_at ?? 0)
            // A desktop-list outage must not hide an already available personal conversation.
            try persist(entries: entries, conversations: [personalItem] + conversations.filter { $0.id != Self.personalID })
            if current == Self.personalID {
                refreshConversationList(credential, attempt: attempt)
                error = guestDraftFailure ?? cache.requestFailure
                notice = ""
                return
            }
            var list = try await service.list(credential)
            list.insert(personalItem, at: 0)
            guard epoch == attempt else { return }
            try persist(entries: entries, conversations: list)
            if let id = current, id != Self.personalID, list.contains(where: { $0.id == id }) {
                // Read completion before events: an observed completion must include its final answer.
                let requests = try await service.requests(id, token: credential)
                guard epoch == attempt else { return }
                var caughtUp = false
                // Page repeatedly with a bound; the next polling cycle continues if more remain.
                for _ in 0..<10 {
                    let page = try await service.events(id, after: entries[id]?.cursor ?? 0, token: credential)
                    guard epoch == attempt else { return }
                    try edit(id) { try $0.apply(page) }
                    if !page.has_more { caughtUp = true; break }
                }
                if let own = entries[id]?.request, let found = requests.first(where: { $0.id == own.id }) {
                    if found.status != "completed" || caughtUp { try edit(id) { $0.request = found } }
                } else if entries[id]?.request?.outstanding != true, let active = requests.first(where: { $0.outstanding }) {
                    try edit(id) { $0.request = active }
                }
            }
            error = guestDraftFailure ?? cache.requestFailure
            notice = isReflection ? "" : "동기화됨 · 이 작업의 실행은 데스크톱에 있어요"
        } catch {
            if epoch == attempt {
                if !(error is CancellationError), (error as? URLError)?.code != .cancelled {
                    if current == Self.personalID { personalHistoryNeedsRetry = true }
                    failure(error)
                }
            }
        }
    }
    private func refreshConversationList(_ credential: String, attempt: UUID) {
        guard conversationListFlight?.epoch != attempt, let identity = account else { return }
        conversationListFlight?.task.cancel()
        let id = UUID()
        let task = Task { [weak self] in
            guard let self else { return }
            defer { if conversationListFlight?.id == id { conversationListFlight = nil } }
            do {
                let list = try await service.list(credential)
                try Task.checkCancellation()
                guard epoch == attempt, signedIn, account?.accountID == identity.accountID,
                      account?.tokens.session_id == identity.tokens.session_id else { return }
                // Read current entries and personal metadata after the GET. A
                // concurrent draft edit or answer must not be replaced by the
                // snapshot captured when discovery started.
                let personal = conversations.filter { $0.id == Self.personalID }
                try persist(entries: entries, conversations: personal + list)
                conversationListError = nil
            } catch {
                guard !(error is CancellationError), epoch == attempt, signedIn,
                      account?.accountID == identity.accountID,
                      account?.tokens.session_id == identity.tokens.session_id else { return }
                conversationListError = "컴퓨터의 대화 목록을 확인하지 못했어요. 나의 질문은 계속 쓸 수 있어요."
            }
        }
        conversationListFlight = (id, attempt, task)
    }
    private func applyReflection(_ value: PersonalReflection) throws {
        try edit(Self.personalID) { try $0.applyReflection(value) }
        if let request = entries[Self.personalID]?.request, request.status == "completed", request.id == observedReflectionID {
            observedReflectionID = nil; experience.controller?.record(.reflectionAnswered)
        }
        opening = value.opening; openingHint = value.hint; hasEarlierReflection = value.state.has_earlier
    }
    private func failure(_ error: Error) {
        self.error = (error as? URLError)?.code == .timedOut
            ? "대화를 확인하는 데 시간이 오래 걸려요. 작성한 글은 남아 있어요. 다시 확인해 주세요."
            : error.localizedDescription
        if case SyncFailure.http(let status, let code) = error, status == 401 || ["session_revoked", "account_inactive", "refresh_reuse"].contains(code) {
            clearAccount()
        }
    }
    func send() {
        guard canSend, let id = selected else { return }
        do { try edit(id) { try $0.enqueue(reflection: id == Self.personalID) } } catch { self.error = error.localizedDescription; return }
        if syncing, let request = entries[id]?.request {
            queuedSend = (id, request.id); notice = "보낸 말을 저장했어요. 대화 확인이 끝나면 전송해요."
        } else { retry() }
    }
    var canRetryLocalRequest: Bool {
        signedIn && accountStorageReady && cacheReadable && !loggingOut
            && !stoppingReflection && !sendingCurrentRequest && cache.request?.status == "local"
    }
    // An explicit user Retry can wait behind a read just like explicit Send.
    // Reads/restarts/uncertain results themselves never create a retry intent.
    func retryFromUser() {
        guard canRetryLocalRequest, let id = selected, let request = entries[id]?.request else { return }
        if syncing {
            queuedSend = (id, request.id)
            notice = "보낸 말을 저장했어요. 대화 확인이 끝나면 전송해요."
        } else { retry() }
    }
    func retry() {
#if DEBUG
        NativeJourneyFixture.recordRetry("attempt")
#endif
        guard !busy, !syncing, !stoppingReflection, let id = selected, let request = entries[id]?.request, request.status == "local" else {
#if DEBUG
            NativeJourneyFixture.recordRetry(busy ? "blocked_busy" : syncing ? "blocked_syncing" : stoppingReflection ? "blocked_stopping" : "blocked_request")
#endif
            return
        }
#if DEBUG
        NativeJourneyFixture.recordRetry("admitted")
#endif
        busy = true; let attempt = epoch; error = nil
        let generation = UUID(); responseGeneration = generation; stoppedResponse = nil
        let credentialTask = Task { try await self.token() }
        reflectionCredential = id == Self.personalID ? credentialTask : nil
        operation = Task {
            do {
                let credential = try await credentialTask.value
                guard epoch == attempt, responseGeneration == generation else { return }
                if id == Self.personalID {
                    observedReflectionID = request.id; experience.controller?.record(.reflectionStarted)
#if DEBUG
                    NativeJourneyFixture.recordRetry("post")
#endif
                    let result = try await service.reflect(request, token: credential)
                    guard epoch == attempt, responseGeneration == generation else { return }
                    try applyReflection(result)
                } else {
                let result = try await service.submit(id, request: request, token: credential)
                guard epoch == attempt, responseGeneration == generation else { return }
                guard result.id == request.id, result.text == request.text else { throw SyncFailure.invalidResponse }
                try edit(id) { $0.request = result }
                }
            } catch {
                if epoch == attempt, responseGeneration == generation {
                    // Successful history reads cannot erase a failed send (for
                    // example missing AI access, a budget limit or network loss).
                    try? edit(id) { $0.requestFailure = error.localizedDescription }
                    if case SyncFailure.http(let status, _) = error, status == 400 || (id == Self.personalID && status == 409) {
                        try? edit(id) { value in
                            value.draft = value.draft.isEmpty ? request.text : value.draft + "\n" + request.text
                            value.request = nil
                        }
                    }
                    failure(error)
                } else if epoch == attempt, id == Self.personalID,
                          stoppedResponse?.generation == generation,
                          stoppedResponse?.requestID == request.id,
                          stoppedResponse?.accountID == account?.accountID,
                          stoppedResponse?.sessionID == account?.tokens.session_id,
                          !(error is CancellationError), (error as? URLError)?.code != .cancelled {
                    // Stop can race a typed admission failure. Preserve its
                    // reason only for this failed row, never a cancelled or
                    // completed turn, newer send, account or voice continuation.
                    stoppedResponse?.failure = error.localizedDescription
                    if entries[id]?.request?.id == request.id, entries[id]?.request?.status == "failed" {
                        try? edit(id) { $0.requestFailure = error.localizedDescription }
                        if selected == id { self.error = error.localizedDescription }
                    }
                }
            }
            if epoch == attempt, responseGeneration == generation { reflectionCredential = nil; busy = false; await synchronize() }
        }
    }
    func stopReflection() {
        guard canStopReflection, let request = cache.request, let accountID = account?.accountID, let sessionID = account?.tokens.session_id else { return }
        let attempt = epoch, credentialTask = reflectionCredential
        let originalOperation = operation
        // A late POST result must not overwrite the independently acknowledged
        // cancel snapshot or restart read-aloud. Keep its durable outbox identity.
        stoppedResponse = (responseGeneration, request.id, accountID, sessionID, nil)
        responseGeneration = UUID(); stoppingReflection = true; error = nil
        notice = "답변 중지를 확인하고 있어요. 이미 실행된 AI 비용은 발생할 수 있어요."
        stopOperation = Task {
            var awaitFailedResponse = false
            defer {
                if !awaitFailedResponse { originalOperation?.cancel() }
                if epoch == attempt {
                    reflectionCredential = nil; busy = false; stoppingReflection = false
                    stopOperation = nil
                }
            }
            do {
                let credential: String
                if let credentialTask { credential = try await credentialTask.value }
                else { credential = try await token() }
                // /cancel is a no-op before Service inserts the running row.
                // Wait briefly for that exact human turn, never infer success
                // from an unrelated/empty snapshot and never replay the POST.
                let deadline = ProcessInfo.processInfo.systemUptime + 8
                for check in 0..<10 {
                    guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                    let remaining = deadline - ProcessInfo.processInfo.systemUptime
                    guard remaining > 0 else { break }
                    let current = try await service.reflection(credential, timeout: remaining)
                    guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                    if let turn = current.state.turn, turn.id == request.id, turn.text == request.text {
                        let remaining = deadline - ProcessInfo.processInfo.systemUptime
                        guard remaining > 0 else { break }
                        let result = turn.outstanding ? try await service.cancelReflection(request.id, token: credential, timeout: remaining) : current
                        guard epoch == attempt, account?.accountID == accountID, account?.tokens.session_id == sessionID else { return }
                        guard let confirmed = result.state.turn, confirmed.id == request.id,
                              confirmed.text == request.text, !confirmed.outstanding else {
                            throw StudioError.message("아직 중지를 확인하지 못했어요. 보낸 글은 남아 있어요. 다시 확인해 주세요.")
                        }
                        try edit(Self.personalID) {
                            try $0.applyReflectionStop(result, request: request)
                            if confirmed.status == "failed", let reason = stoppedResponse?.failure { $0.requestFailure = reason }
                        }
                        awaitFailedResponse = confirmed.status == "failed"
                        if confirmed.status == "failed" { error = entries[Self.personalID]?.requestFailure }
                        opening = result.opening; openingHint = result.hint; hasEarlierReflection = result.state.has_earlier
                        switch confirmed.status {
                        case "cancelled": notice = "답변 받기를 중지했어요. 이미 실행된 AI 비용은 발생할 수 있어요."
                        case "completed": notice = "답변이 이미 도착했어요. 대화에서 확인해 주세요."
                        case "failed": notice = "답변을 받지 못했어요. 보낸 이야기는 남아 있어요."
                        default: notice = "완료 여부를 확인하지 못했어요. 보낸 이야기는 남아 있으며 자동으로 다시 보내지 않아요."
                        }
                        return
                    }
                    if check < 9 { try await Task.sleep(nanoseconds: 200_000_000) }
                }
                throw StudioError.message("아직 중지를 확인하지 못했어요. 보낸 글은 남아 있어요. 다시 확인해 주세요.")
            } catch { if epoch == attempt { failure(error) } }
        }
    }
    func recoverReflection() {
        guard isReflection, !busy, !syncing, !stoppingReflection, let request = cache.request, request.status == "running" else { return }
        busy = true; let attempt = epoch
        operation = Task {
            do {
                let credential = try await token()
                let result = try await service.abandonReflection(request.id, token: credential)
                guard epoch == attempt else { return }; try applyReflection(result)
            } catch { if epoch == attempt { failure(error) } }
            if epoch == attempt { busy = false }
        }
    }
    func cancelPending() {
        guard !busy, !syncing, !stoppingReflection, let id = selected, let request = cache.request else { return }
        guard request.status == "pending" else { return }
        busy = true; let attempt = epoch
        operation = Task {
            do {
                let credential = try await token()
                let result = try await service.cancel(id, requestID: request.id, token: credential)
                guard epoch == attempt else { return }; try edit(id) { $0.request = result }
            } catch { if epoch == attempt { failure(error) } }
            if epoch == attempt { busy = false }
        }
    }
    func logout() {
        guard canLogout, let account else { return }
        guard (editing[account.accountID] ?? [:]).isEmpty else {
            error = "저장하지 못한 수정이 있어요. 기록을 내보내고 저장 오류를 확인해 주세요."; return
        }
        do { try clearIntakeCredentials(accountID: account.accountID) }
        catch { self.error = "Lab 연결 정보를 지우지 못했어요. 저장소를 확인한 뒤 로그아웃을 다시 눌러 주세요."; return }
        approvals.invalidate(); questions.controller?.invalidate(); teamRequests.controller?.invalidate(); teamInbox.controller?.invalidate(); deliveryControllers.invalidate(); outcomeControllers.invalidate(); githubObservationControllers.invalidate(); relationControllers.invalidate(); textRevisionControllers.invalidate(); invalidateIntake(); experience.controller?.invalidate(); push.controller?.invalidate(); NativePushCenter.shared.stop(); observedReflectionID = nil
        let intent = LogoutIntent(epoch: epoch, accountID: account.accountID, sessionID: account.tokens.session_id)
        // Consume only the in-memory scheduling intent, never durable words or
        // request identity. Reopening must not replay an uncertain request.
        queuedSend = nil; busy = true; loggingOut = true; error = nil
        notice = "진행 중인 계정 확인을 마친 뒤 로그아웃할게요."
        if syncing { queuedLogout = intent }
        else { finishLogout(intent) }
    }
    private func matches(_ intent: LogoutIntent) -> Bool {
        epoch == intent.epoch && account?.accountID == intent.accountID && account?.tokens.session_id == intent.sessionID
    }
    private func finishLogout(_ intent: LogoutIntent) {
        guard matches(intent), !syncing, let current = account else { return }
        guard (editing[current.accountID] ?? [:]).isEmpty else {
            busy = false; loggingOut = false; notice = ""
            error = "저장하지 못한 수정이 있어요. 기록을 내보내고 저장 오류를 확인해 주세요."; return
        }
        // Let a shared credential refresh finish before invalidating its flight.
        tokenFlight.invalidate()
        epoch = UUID()
        conversationListFlight?.task.cancel(); conversationListFlight = nil; conversationListError = nil
        let execution = LogoutIntent(epoch: epoch, accountID: current.accountID, sessionID: current.tokens.session_id)
        operation = Task {
            defer {
                if epoch == execution.epoch && (matches(execution) || account == nil) {
                    busy = false; loggingOut = false
                }
            }
            do {
                if var pref = try? loadPushPreference(), pref.matches(.init(accountID: current.accountID, sessionID: current.tokens.session_id)) {
                    pref.enabled = false; try savePushPreference(pref)
                    try? await service.accountPush(pref.installation, method: "DELETE", body: nil, token: current.tokens.access_token)
                    guard matches(execution) else { return }
                }
                try await service.logout(current.tokens.access_token)
                guard matches(execution) else { return }
                try AccountKeychain.remove()
                questions.controller?.invalidate(); teamRequests.controller?.invalidate(); teamInbox.controller?.invalidate(); deliveryControllers.invalidate(); outcomeControllers.invalidate(); githubObservationControllers.invalidate(); relationControllers.invalidate(); textRevisionControllers.invalidate(); invalidateIntake(); experience.controller?.invalidate(); push.controller?.invalidate(); NativePushCenter.shared.stop(); observedReflectionID = nil; displayName = nil
                account = nil; signedIn = false; entries = [:]; conversations = []; selected = nil
                notice = "로그아웃했어요. 이 기기의 기록 사본은 보존했어요."
            } catch {
                if matches(execution) {
                    notice = ""; self.error = "서버의 기기 연결을 해제하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요."
                }
            }
        }
    }
    func exportCache() -> URL? {
        guard let account else { return nil }
        do {
            let output = FileManager.default.temporaryDirectory.appendingPathComponent(cacheReadable ? "HP-Studio-shared-records.json" : "HP-Studio-shared-recovery-original.json")
            let snapshot = ConversationCache.exportSnapshot(entries: entries, edits: editing[account.accountID] ?? [:])
            let bytes = try cacheReadable ? JSONEncoder().encode(SharedCacheFile(accountID: account.accountID, conversations: conversations, entries: snapshot)) : Data(contentsOf: file(account.accountID))
            try bytes.write(to: output, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); return output
        } catch { self.error = error.localizedDescription; return nil }
    }
    func clearCache() {
        guard !busy, !syncing, !stoppingReflection, let account, (editing[account.accountID] ?? [:]).isEmpty, !entries.values.contains(where: { $0.request?.outstanding == true || !$0.draft.isEmpty }) else {
            error = "작성 중인 글이나 처리 중인 요청이 있어요. 먼저 내보내고 요청 상태를 확인해 주세요."; return
        }
        do {
            if FileManager.default.fileExists(atPath: file(account.accountID).path) { try FileManager.default.removeItem(at: file(account.accountID)) }
            entries = [:]; selected = Self.personalID; cacheReadable = true
            notice = "이 기기의 사본을 삭제했어요. 서버의 대화와 데스크톱 원본은 남아 있어요."
        } catch { self.error = error.localizedDescription }
    }
}
