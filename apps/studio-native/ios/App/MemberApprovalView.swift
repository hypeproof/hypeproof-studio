import SwiftUI

@MainActor final class MemberApprovalPresentation: ObservableObject {
    @Published var state = MemberApprovalController.View()
    var controller: MemberApprovalController?
    func refresh() { Task { await controller?.refresh() } }
    func decide(_ card: MemberApprovalCard, _ choice: MemberApprovalChoice) { Task { await controller?.decide(id: card.id, digest: card.request_digest, choice: choice) } }
    func invalidate() { controller?.invalidate() }
    func dismiss() { controller?.dismiss() }
}
struct MemberApprovalView: View {
    @ObservedObject var model: MemberApprovalPresentation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section { Text("내 판단이 필요한 변경만 확인해요. 선택을 보낸 뒤 실제 반영 결과까지 확인할 수 있어요.") }
                Section {
                    Button("새로고침") { model.refresh() }.disabled(model.state.busy).accessibilityIdentifier("approvalRefresh")
                    Text(model.state.message ?? status).accessibilityIdentifier("approvalInboxStatus")
                }
                ForEach(model.state.cards) { card in
                    Section {
                        Text("변경 내용").font(.caption).foregroundStyle(.secondary)
                        Text(changeSummary(card)).font(.body).lineLimit(3)
                            .accessibilityIdentifier("approvalChangeSummary-" + card.id)
                        Text("이 변경의 검토 담당자로 지정되어 확인을 요청했어요.")
                        Text(card.statusLabel).font(.headline).accessibilityIdentifier("approvalStatus-" + card.id)
                        Text("정확한 버전").font(.caption)
                        Text(card.source.head).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        DisclosureGroup("변경 설명과 검증 근거") {
                            Text("작성자가 설명한 변경").font(.headline)
                            ForEach(Array(card.brief.authored.enumerated()), id: \.offset) { _, text in Text(text) }
                            Text("검증된 근거").font(.headline)
                            ForEach(Array(card.brief.verified.enumerated()), id: \.offset) { _, text in Text(text) }
                            Text("기준: " + card.source.base)
                            Text("검토자: " + card.reviewer)
                        }
                        TimelineView(.periodic(from: .now, by: 1)) { clock in
                            let allowed = model.state.status == "ready" && !model.state.busy && !model.state.pending.contains(where: { $0.cardID == card.id }) && card.canDecide(now: clock.date.timeIntervalSince1970)
                            VStack(alignment: .leading, spacing: 12) {
                                if !allowed && card.decision == nil && card.review == nil { Text("지금 이 요청에 답할 수 없어요. 새로고침해 최신 요청을 확인해 주세요.").font(.caption) }
                                HStack {
                                    Button("승인") { model.decide(card, .approve) }.accessibilityIdentifier("approvalApprove-" + card.id)
                                    Button("보류") { model.decide(card, .reject) }.accessibilityIdentifier("approvalHold-" + card.id)
                                    Button("설명 요청") { model.decide(card, .question) }.accessibilityIdentifier("approvalQuestion-" + card.id)
                                }.buttonStyle(.bordered).disabled(!allowed)
                            }
                        }
                        if let review = card.review, let url = URL(string: review.html_url) { Link("GitHub에 반영된 승인 보기", destination: url) }
                    } header: { Text("\(card.source.repo) #\(card.source.pr)") }
                }
            }.navigationTitle("확인 요청").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("닫기") { dismiss() } }
                .task { await model.controller?.refresh() }
                .onDisappear { model.dismiss() }
        }
    }
    private func changeSummary(_ card: MemberApprovalCard) -> String {
        let authored = card.brief.authored.first ?? ""
        return authored.hasPrefix("summary: ") ? String(authored.dropFirst(9)) : authored
    }
    private var status: String {
        switch model.state.status {
        case "signedOut": return "로그인하면 내 확인 요청을 볼 수 있어요."
        case "loading": return "확인 요청을 불러오고 있어요."
        case "not_enrolled": return "아직 승인 담당자로 등록되지 않았어요."
        case "unavailable": return "지금은 확인 요청함을 이용할 수 없어요."
        case "error": return "요청함을 확인하지 못했어요. 다시 확인해 주세요."
        default: return model.state.cards.isEmpty ? "지금 확인할 요청이 없어요." : "최신 요청을 확인해 주세요."
        }
    }
}
