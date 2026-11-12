import Foundation

public struct Message: Codable, Identifiable, Equatable, Sendable {
    public var id: String = UUID().uuidString
    public var role: String
    public var content: String
    public init(role: String, content: String) { self.role = role; self.content = content }
}
public struct Revision: Codable, Equatable, Sendable {
    public var revision: Int
    public var text: String
    public var confirmedAt: Date
    public var author = "user"
}
public struct Project: Codable, Identifiable, Equatable, Sendable {
    public var id: String = UUID().uuidString
    public var title: String
    public var messages: [Message] = []
    public var revisions: [Revision] = []
    public var draft = ""
    public var intentDraft = ""
    // Optional so every previously exported v1 notebook remains readable.
    // These are human-owned notes, never an AI-confirmed intention.
    public var reflection: [String: String]?
    public var updatedAt = Date()
    public init(title: String = "새로운 생각") { self.title = title }
    public var reflectionSummary: String {
        ReflectionField.allCases.compactMap { reflection?[$0.rawValue]?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty } ?? ""
    }
    public var displayTitle: String {
        messages.isEmpty && title == "새로운 생각" && !reflectionSummary.isEmpty ? String(reflectionSummary.prefix(32)) : title
    }
    public var summary: String { revisions.last?.text ?? (!draft.isEmpty ? "작성 중 · " + draft : reflectionSummary) }
    public func matches(_ search: String) -> Bool {
        search.isEmpty || ([title, summary] + Array((reflection ?? [:]).values)).contains { $0.localizedCaseInsensitiveContains(search) }
    }
    public mutating func append(_ text: String) throws {
        let value = try Self.checked(text)
        if messages.isEmpty { title = String(value.prefix(32)) }
        messages.append(Message(role: "user", content: value)); draft = ""; updatedAt = Date()
    }
    public mutating func confirm(_ text: String) throws {
        revisions.append(Revision(revision: revisions.count + 1, text: try Self.checked(text), confirmedAt: Date()))
        intentDraft = ""; updatedAt = Date()
    }
    public static func checked(_ text: String) throws -> String {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 4000 else { throw StudioError.message("1~4,000자로 적어 주세요.") }
        return value
    }
    public func conversation() -> [[String: String]] {
        let guidance = "HP Studio 모바일에서 내 생각을 구체화하고 싶습니다. 관찰한 사실과 추측을 구분하고 다른 사람의 관점을 살핀 뒤 작은 실천으로 생각을 수정하도록 도와주세요. 한 번에 짧은 질문 하나 또는 작은 다음 행동을 제안해 주세요. 목적이 충분히 분명하면 질문을 반복하지 말고 예시나 실행 가능한 다음 행동을 제시해 주세요. 사람의 가치나 성장을 점수화하지 마세요. 도구 실행이나 배포를 했다고 주장하지 마세요."
        let intent = revisions.last.map { "\n내가 현재 확인한 의도: \($0.text)" } ?? ""
        return [["role": "user", "content": guidance + intent]] + messages.suffix(20).map { ["role": $0.role, "content": $0.content] }
    }
}
public enum ReflectionField: String, CaseIterable, Identifiable, Sendable {
    case observation, audience, change, experiment, learning
    public var id: String { rawValue }
    public var title: String {
        switch self {
        case .observation: return "관찰"
        case .audience: return "사람"
        case .change: return "바라는 변화"
        case .experiment: return "작은 실천"
        case .learning: return "돌아보기"
        }
    }
    public var question: String {
        switch self {
        case .observation: return "직접 본 것은 무엇인가요?"
        case .audience: return "누구의 어떤 불편인가요?"
        case .change: return "무엇이 달라지면 좋을까요?"
        case .experiment: return "가장 작게 확인할 행동은 무엇인가요?"
        case .learning: return "해보니 무엇이 달랐나요?"
        }
    }
}
public struct Notebook: Codable, Equatable, Sendable {
    public var version = 1
    public var projects: [Project] = []
    public init() {}
    public func includingEdits(_ edits: [String: String]) -> Notebook {
        var snapshot = self
        for index in snapshot.projects.indices {
            let id = snapshot.projects[index].id
            if let draft = edits[id + ":draft"] { snapshot.projects[index].draft = draft }
            if let intent = edits[id + ":intent"] { snapshot.projects[index].intentDraft = intent }
            for field in ReflectionField.allCases {
                if let note = edits[id + ":reflection:" + field.rawValue] {
                    if snapshot.projects[index].reflection == nil { snapshot.projects[index].reflection = [:] }
                    snapshot.projects[index].reflection?[field.rawValue] = note
                }
            }
        }
        return snapshot
    }
    public func updating(_ id: String, visibleEdits: [String: String], edit: (inout Project) throws -> Void) throws -> Notebook {
        var next = includingEdits(visibleEdits)
        guard let index = next.projects.firstIndex(where: { $0.id == id }) else { throw StudioError.message("기록을 찾지 못했어요.") }
        try edit(&next.projects[index])
        return next
    }
    public func encode() throws -> Data {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
    public static func decode(_ data: Data) throws -> Notebook {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let value = try decoder.decode(Notebook.self, from: data)
        guard value.version == 1, value.projects.count <= 100,
              Set(value.projects.map(\.id)).count == value.projects.count,
              value.projects.allSatisfy({ project in
                  project.messages.allSatisfy { ["user", "assistant"].contains($0.role) } &&
                  project.revisions.enumerated().allSatisfy { $0.element.author == "user" && $0.element.revision == $0.offset + 1 }
              }) else { throw StudioError.message("저장된 기록을 읽지 못했어요. 원본은 보존되어 있어요.") }
        return value
    }
}
public enum StudioError: Error, LocalizedError {
    case message(String)
    public var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
