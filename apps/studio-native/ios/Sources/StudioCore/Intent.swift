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
    public var updatedAt = Date()
    public init(title: String = "새로운 생각") { self.title = title }
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
        }
        return snapshot
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
