import SwiftUI

@MainActor final class TeamGitHubObservationPresentation: ObservableObject {
    @Published var state = TeamGitHubObservationController.View()
    var controller: TeamGitHubObservationController?
}
struct TeamGitHubObservationScreen: View {
    @StateObject private var model: TeamGitHubObservationPresentation
    init(model: TeamGitHubObservationPresentation) { _model = StateObject(wrappedValue: model) }
    private func date(_ milliseconds: Double) -> String { Date(timeIntervalSince1970: milliseconds / 1000).formatted(date: .abbreviated, time: .shortened) }
    private func status(_ ci: TeamGitHubObservation.CI) -> String {
        guard ci.status == "completed" else { return ["queued","waiting","pending","requested"].contains(ci.status) ? "대기 중" : "진행 중" }
        switch ci.conclusion { case "success": return "성공"; case "failure", "startup_failure": return "실패"; case "cancelled": return "취소됨"; case "timed_out": return "시간 초과"; case "action_required": return "확인 필요"; case "skipped": return "건너뜀"; case "neutral": return "중립"; default: return "유효하지 않은 결과" }
    }
    private func record(_ value: TeamGitHubObservation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Link("이슈 #\(value.issue.number) · \(value.issue.state == "closed" ? "닫힘" : "열림")", destination: URL(string: "https://github.com/\(value.repo)/issues/\(value.issue.number)")!)
            if let pull = value.pull {
                Link("PR #\(pull.number) · \(pull.merged ? "병합됨" : pull.state == "closed" ? "닫힘 · 미병합" : "열림")", destination: URL(string: "https://github.com/\(value.repo)/pull/\(pull.number)")!)
                if !pull.source_matches_historical { Text("PR의 소스가 연결 당시 기록과 달라졌어요.").font(.caption) }
            }
            if let ci = value.ci {
                Link("연결된 검사 실행 · 시도 \(ci.attempt) · \(status(ci))", destination: URL(string: "https://github.com/\(value.repo)/actions/runs/\(ci.run_id)/attempts/\(ci.attempt)")!)
                Text("연결된 실행의 최근 시도예요. PR 전체의 최신 검사라는 뜻은 아니에요.").font(.caption).foregroundStyle(.secondary)
                if !ci.source_matches_current_pull { Text("이 검사 결과는 현재 PR 소스의 결과가 아니에요.").font(.caption).accessibilityIdentifier("teamObservationSourceMismatch") }
                if !ci.source_matches_historical { Text("이 검사 소스는 연결 당시 기록과 달라요.").font(.caption) }
            }
        }
    }
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            List {
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamObservationUnavailable") }
                if let page = model.state.page {
                    Section(page.isFresh(at: context.date.timeIntervalSince1970 * 1000) ? "최근 확인한 상태" : "이전 확인 기록") {
                        if let current = page.current {
                            Text(page.isFresh(at: context.date.timeIntervalSince1970 * 1000) ? "확인한 시점에는 아래 상태였어요." : "현재 상태는 다시 확인이 필요해요.").accessibilityIdentifier("teamObservationFreshness")
                            record(current)
                            if let observed = page.observed_at { Text("확인한 시각: \(date(observed))").font(.caption) }
                            if let expiry = page.valid_until, page.isFresh(at: context.date.timeIntervalSince1970 * 1000) { Text("유효: \(date(expiry))까지").font(.caption) }
                        } else { Text(page.retention?.hidden == true ? page.retention!.marker : "아직 확인된 GitHub 상태 기록이 없어요.").accessibilityIdentifier("teamObservationEmpty") }
                        if page.last_error != nil { Text("최근 GitHub 확인에 실패했어요. 이전 기록을 보여 드려요.").accessibilityIdentifier("teamObservationProviderError") }
                        if let checked = page.last_checked_at { Text("마지막 확인 시도: \(date(checked))").font(.caption) }
                        Text("빌드 제공·이 기기의 설치·요청 해결 여부는 이 기록으로 확인할 수 없어요.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if !model.state.events.isEmpty {
                        Section("상태 변경 기록") {
                            ForEach(model.state.events) { event in
                                VStack(alignment: .leading, spacing: 8) { Text(date(event.observed_at)).font(.caption); record(event.metadata) }
                            }
                            if model.state.events.count >= 500 { Text("표시할 수 있는 기록을 모두 불러왔어요. 새로고침해 현재 상태를 확인해 주세요.") }
                            else if page.next_cursor != nil { Button("기록 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
                        }
                    }
                }
                Text("새로고침은 서버에 저장된 확인 기록을 다시 읽어요.").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("GitHub 상태 기록").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy).accessibilityIdentifier("teamObservationRefresh") } }
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
    }
}
