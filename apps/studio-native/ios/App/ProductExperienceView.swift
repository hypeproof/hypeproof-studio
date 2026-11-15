import SwiftUI

@MainActor final class ProductExperiencePresentation: ObservableObject {
    @Published var state = ProductExperienceController.View()
    var controller: ProductExperienceController?
}
struct ProductExperienceView: View {
    @ObservedObject var model: ProductExperiencePresentation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Text(model.state.title).font(.headline)
                if !model.state.notice.isEmpty { Text(model.state.notice) }
                if !model.state.status.isEmpty { Text(model.state.status).accessibilityIdentifier("productExperienceStatus") }
                if model.state.available {
                    Text(model.state.granted ? "공유 켜짐" : "공유 꺼짐")
                    Button { Task { await model.controller?.choose(true) } } label: { Text("동의하고 공유하기").frame(minHeight: 44) }
                        .disabled(model.state.busy || model.state.granted).accessibilityIdentifier("productExperienceAllow")
                    Button { Task { await model.controller?.choose(false) } } label: { Text("공유하지 않기").frame(minHeight: 44) }
                        .disabled(model.state.busy).accessibilityIdentifier("productExperienceDecline")
                }
                Button("설정 다시 확인") { Task { await model.controller?.refresh() } }.disabled(model.state.busy)
#if DEBUG
                if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Team entry trace").font(.caption2).accessibilityIdentifier("teamEntryTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
            }.navigationTitle("사용 경험 공유").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
                .task { await model.controller?.refresh() }
        }
    }
}
