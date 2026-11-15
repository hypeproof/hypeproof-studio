import SwiftUI

@MainActor final class AccountQuestionPresentation: ObservableObject {
    @Published var state = AccountQuestionController.View()
    var controller: AccountQuestionController?
    func refresh() { Task { await controller?.refresh() } }
    func answer(action: String? = nil, choice: String? = nil, skip: Bool = false) { Task { await controller?.submit(action: action, choice: choice, skip: skip) } }
}

struct AccountQuestionView: View {
    @ObservedObject var model: AccountQuestionPresentation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("accountQuestionStatus") }
                    if model.state.canStart {
                        ForEach([("goal", "목표를 정리하고 싶어요"), ("method", "방법이 막혔어요"), ("decision", "결정을 앞두고 있어요")], id: \.0) { choice in
                            Button { Task { await model.controller?.begin(choice.0) } } label: { Text(choice.1).frame(minHeight: 44) }
                                .buttonStyle(.bordered).disabled(model.state.busy || (model.state.pendingChoice != nil && model.state.pendingChoice != choice.0))
                        }
                    }
                    if let card = model.state.card {
                        if let title = card.title { Text(title).font(.headline) }
                        if let preface = card.preface { Text(preface).foregroundStyle(.secondary) }
                        Text(card.prompt).font(.title3).accessibilityIdentifier("accountQuestionPrompt")
                        ForEach(Array(card.segments.enumerated()), id: \.offset) { _, segment in
                            VStack(alignment: .leading) {
                                if let label = segment.label { Text(label).font(.caption).foregroundStyle(.secondary) }
                                Text(segment.text).textSelection(.enabled)
                            }
                        }
                        ForEach(card.choices) { choice in
                            Button {
                                if card.select == "tap" { model.answer(choice: choice.id) }
                                else { model.controller?.pick(choice.id) }
                            } label: {
                                HStack { Text(choice.label); if model.state.choice == choice.id { Image(systemName: "checkmark") } }.frame(minHeight: 44)
                            }.buttonStyle(.bordered).disabled(model.state.busy || !card.available())
                        }
                        if let input = card.text {
                            Text(input.label).font(.headline)
                            TextField(input.placeholder, text: Binding(get: { model.state.words }, set: { model.controller?.edit($0) }), axis: .vertical)
                                .lineLimit(3...8).textFieldStyle(.roundedBorder).disabled(model.state.busy).accessibilityIdentifier("accountQuestionAnswer")
                        }
                        ForEach(card.actions) { action in
                            Button { model.answer(action: action.id) } label: { Text(action.label).frame(minHeight: 44) }
                                .buttonStyle(.bordered).disabled(model.state.busy || !card.available() || (action.needs_answer && model.state.choice == nil && model.state.words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                        }
                        if let skip = card.skip { Button { model.answer(skip: true) } label: { Text(skip).frame(minHeight: 44) }.disabled(model.state.busy) }
                        if let note = card.note { Text(note).font(.caption).foregroundStyle(.secondary) }
                    }
#if DEBUG
                    if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Team entry trace").font(.caption2).accessibilityIdentifier("teamEntryTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
                }.padding().task(id: model.state.card.map { $0.key + ":" + String($0.attempt) }) {
                    if let key = model.state.card?.key { await model.controller?.presented(key) }
                }
            }.navigationTitle("도착한 질문").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("새로고침") { model.refresh() }.disabled(model.state.busy) }
                    ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } }
                }.task { await model.controller?.refresh() }.onDisappear { model.controller?.dismiss() }
        }
    }
}
