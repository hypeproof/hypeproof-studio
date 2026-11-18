import Foundation

public struct TeamGitHubObservation: Codable, Equatable, Sendable {
    public struct Issue: Codable, Equatable, Sendable { public let number: Int; public let state: String }
    public struct Historical: Codable, Equatable, Sendable { public let source_sha: String; public let run_id, attempt: Int }
    public struct Pull: Codable, Equatable, Sendable { public let number: Int; public let state: String; public let merged: Bool; public let head_sha: String; public let merge_sha: String?; public let source_matches_historical: Bool }
    public struct CI: Codable, Equatable, Sendable { public let run_id, attempt: Int; public let source_sha, status: String; public let conclusion: String?; public let source_matches_historical, source_matches_current_pull: Bool }
    public let schema, repo: String
    public let issue: Issue
    public let historical: Historical?
    public let pull: Pull?
    public let ci: CI?
    public let testflight, reporter_confirmation: String
    public func validate() throws {
        guard schema == "hps-team-github-observation/1", repo.count <= 100, repo.range(of:"^hypeproof/[a-z0-9][a-z0-9-]*$",options:.regularExpression) != nil,
              TeamGitHubDraft.number(issue.number), ["open","closed"].contains(issue.state), testflight == "not_observed", reporter_confirmation == "not_observed" else { throw SyncFailure.invalidResponse }
        guard let historical else { guard pull == nil, ci == nil else { throw SyncFailure.invalidResponse }; return }
        guard let pull, let ci, TeamGitHubDraft.sha(historical.source_sha), TeamGitHubDraft.number(historical.run_id), TeamGitHubDraft.number(historical.attempt),
              TeamGitHubDraft.number(pull.number), ["open","closed"].contains(pull.state), TeamGitHubDraft.sha(pull.head_sha),
              pull.merged ? (pull.state == "closed" && pull.merge_sha.map(TeamGitHubDraft.sha) == true) : pull.merge_sha == nil,
              ci.run_id == historical.run_id, TeamGitHubDraft.number(ci.attempt), ci.attempt >= historical.attempt, TeamGitHubDraft.sha(ci.source_sha),
              ["queued","in_progress","completed","requested","waiting","pending"].contains(ci.status) else { throw SyncFailure.invalidResponse }
        let source = pull.merged ? pull.merge_sha! : pull.head_sha
        guard pull.source_matches_historical == (source == historical.source_sha), ci.source_matches_historical == (ci.source_sha == historical.source_sha),
              ci.source_matches_current_pull == (ci.source_sha == source), ci.status == "completed" ? ci.conclusion.map({ ["success","failure","cancelled","timed_out","action_required","neutral","skipped","stale","startup_failure"].contains($0) }) == true : ci.conclusion == nil else { throw SyncFailure.invalidResponse }
    }
    public func sameAssociation(as other: Self) -> Bool { repo == other.repo && issue.number == other.issue.number && historical == other.historical && pull?.number == other.pull?.number }
}
public struct TeamGitHubObservationEvent: Decodable, Identifiable, Sendable {
    public let revision: Int
    public let observed_at: Double
    public let metadata: TeamGitHubObservation
    public var id: Int { revision }
}
public struct TeamGitHubObservationPage: Decodable, Sendable {
    public let schema, request_id: String
    public let association_id: String?
    public let association_revision: Int?
    public let current: TeamGitHubObservation?
    public let observed_at, valid_until: Double?
    public let fresh: Bool
    public let last_checked_at: Double?
    public let last_error: String?
    public let events: [TeamGitHubObservationEvent]
    public let next_cursor: String?
    public var retention: TeamContentRetention? = nil
    public static func cursor(_ value: String) -> (String, Int)? {
        let parts = value.split(separator:":",omittingEmptySubsequences:false)
        guard parts.count == 2, parts[0].range(of:"^tgl_[a-f0-9]{32}$",options:.regularExpression) != nil,
              let revision = Int(parts[1]), revision > 0, revision < 1_000_000_000, String(revision) == parts[1] else { return nil }
        return (String(parts[0]),revision)
    }
    public func isFresh(at milliseconds: Double) -> Bool { fresh && last_error == nil && current != nil && observed_at.map { $0 <= milliseconds } == true && valid_until.map { $0 > milliseconds } == true }
    public func validate(request: String, after: String?) throws {
        try retention?.validate()
        if retention?.hidden == true { guard current == nil, observed_at == nil, valid_until == nil, !fresh, events.isEmpty, next_cursor == nil else { throw SyncFailure.invalidResponse } }
        guard schema == "hps-team-github-observations/1", request_id == request, TeamRequestRecord.validID(request), events.count <= 50,
              [observed_at,valid_until,last_checked_at].allSatisfy({ $0.map { $0.isFinite && $0 > 0 } ?? true }),
              last_error.map({ ["provider_timeout","provider_unavailable"].contains($0) }) ?? true else { throw SyncFailure.invalidResponse }
        guard let association_id else {
            guard association_revision == nil, current == nil, observed_at == nil, valid_until == nil, last_checked_at == nil, last_error == nil, !fresh, events.isEmpty, next_cursor == nil, after == nil else { throw SyncFailure.invalidResponse }; return
        }
        guard Self.cursor(association_id + ":1") != nil, association_revision.map({ $0 > 0 && $0 < 1_000_000_000 }) == true else { throw SyncFailure.invalidResponse }
        if let after { guard let parsed = Self.cursor(after), parsed.0 == association_id else { throw SyncFailure.invalidResponse } }
        if let current {
            try current.validate()
            guard let observed_at, let last_checked_at, last_checked_at >= observed_at else { throw SyncFailure.invalidResponse }
            if let valid_until { guard valid_until > observed_at, valid_until <= observed_at + 1_800_000 else { throw SyncFailure.invalidResponse } }
        } else { guard observed_at == nil, valid_until == nil, events.isEmpty, !fresh else { throw SyncFailure.invalidResponse } }
        guard !fresh || (current != nil && valid_until != nil && last_error == nil) else { throw SyncFailure.invalidResponse }
        var previous = after.flatMap(Self.cursor)?.1 ?? 0
        for event in events {
            try event.metadata.validate()
            guard event.revision > previous, event.revision < 1_000_000_000, event.observed_at.isFinite, event.observed_at > 0,
                  let current, event.metadata.sameAssociation(as:current), event.observed_at <= (last_checked_at ?? 0) else { throw SyncFailure.invalidResponse }
            previous = event.revision
        }
        if let next_cursor { guard let parsed = Self.cursor(next_cursor), parsed.0 == association_id, parsed.1 == events.last?.revision else { throw SyncFailure.invalidResponse } }
    }
}

@MainActor public final class TeamGitHubObservationController {
    public struct View { public var page: TeamGitHubObservationPage?; public var events: [TeamGitHubObservationEvent] = []; public var busy = false; public var message = ""; public init() {} }
    public private(set) var view = View()
    private let requestID: String
    private let identity: () async throws -> MemberApprovalIdentity?
    private let fetch: (MemberApprovalIdentity,String?) async throws -> TeamGitHubObservationPage
    private let changed: (View) -> Void
    private var generation = UUID()
    private var loadedAccount: MemberApprovalIdentity?
    public init(requestID: String, identity: @escaping () async throws -> MemberApprovalIdentity?, fetch: @escaping (MemberApprovalIdentity,String?) async throws -> TeamGitHubObservationPage, changed: @escaping (View) -> Void) { self.requestID=requestID;self.identity=identity;self.fetch=fetch;self.changed=changed }
    public func invalidate() { generation=UUID();loadedAccount=nil;view=View();changed(view) }
    private func current(_ g: UUID,_ account: MemberApprovalIdentity) async -> Bool {
        guard g == generation else { return false }
        guard (try? await identity()) == account, g == generation else { if g == generation { invalidate() }; return false }; return true
    }
    public func open() async { await read(more:false) }
    public func more() async { guard view.events.count < 500, view.page?.next_cursor != nil else { return }; await read(more:true) }
    private func read(more: Bool) async {
        guard !view.busy else { return }; let g=UUID();generation=g
        var previous=view.page, after=more ? previous?.next_cursor : nil
        if !more { view.page=nil;view.events=[] }
        view.busy=true;view.message="";changed(view)
        defer { if generation == g { view.busy=false;changed(view) } }
        var binding: MemberApprovalIdentity?
        do {
            guard let account=try await identity(), generation == g else { if generation == g { invalidate() }; return }; binding=account
            if loadedAccount != account { previous=nil;after=nil;view.page=nil;view.events=[];changed(view) }
            loadedAccount=account
            var page: TeamGitHubObservationPage
            var changedRetention: String?
            do {
                page=try await fetch(account,after)
                if after != nil, page.retention?.generationKey != previous?.retention?.generationKey { try page.validate(request:requestID,after:nil); changedRetention = page.retention?.generationKey ?? "legacy" }
                if after != nil, page.association_id != previous?.association_id || page.association_revision != previous?.association_revision || page.retention?.generationKey != previous?.retention?.generationKey { throw SyncFailure.http(409,"team_github_observation_cursor_changed") }
                try page.validate(request:requestID,after:after)
            } catch SyncFailure.http(409,"team_github_observation_cursor_changed") {
                guard await current(g,account) else { return };view.page=nil;view.events=[];changed(view)
                page=try await fetch(account,nil);try page.validate(request:requestID,after:nil)
                guard changedRetention == nil || changedRetention == (page.retention?.generationKey ?? "legacy") else { throw SyncFailure.invalidResponse }
            }
            guard await current(g,account) else { return }
            if !more || view.page == nil { view.events=[] }
            let known=Set(view.events.map(\.revision));view.events=Array((view.events+page.events.filter { !known.contains($0.revision) }).prefix(500));view.page=page
        } catch {
            guard generation == g else { return }
            if let binding, !(await current(g,binding)) { return }
            view.page=nil;view.events=[];view.message="GitHub 상태 기록을 불러오지 못했어요. 다시 확인해 주세요."
        }
    }
}
@MainActor public final class TeamGitHubObservationControllers {
    private final class Entry { weak var value: TeamGitHubObservationController?; init(_ value: TeamGitHubObservationController) { self.value=value } }
    private var entries:[Entry]=[]
    public init() {}
    public func register(_ controller: TeamGitHubObservationController) { entries.removeAll { $0.value == nil }; if !entries.contains(where: { $0.value === controller }) { entries.append(Entry(controller)) } }
    public func invalidate() { entries.removeAll { $0.value == nil };entries.forEach { $0.value?.invalidate() } }
}
