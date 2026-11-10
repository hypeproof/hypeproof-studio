import SwiftUI

@MainActor final class StudioModel: ObservableObject {
    @Published private(set) var notebook = Notebook()
    @Published var active: String?
    @Published var error: String?
    @Published var busy = false
    @Published var connected = false
    @Published private(set) var readOnly = false
    @Published private var editing: [String: String] = [:]
    var draftText: String { editing[(active ?? "") + ":draft"] ?? project?.draft ?? "" }
    var intentText: String { editing[(active ?? "") + ":intent"] ?? project?.intentDraft ?? "" }
    func editDraft(_ text: String, intent: Bool = false) {
        guard let active else { return }
        editing[active + (intent ? ":intent" : ":draft")] = text
        update { if intent { $0.intentDraft = text } else { $0.draft = text } }
    }
    func confirmIntent() -> Bool {
        let text = intentText
        if update({ try $0.confirm(text) }) { editing[(active ?? "") + ":intent"] = nil; return true }
        return false
    }
    func reflectionText(_ field: ReflectionField) -> String {
        editing[(active ?? "") + ":reflection:" + field.rawValue] ?? project?.reflection?[field.rawValue] ?? ""
    }
    func editReflection(_ text: String, field: ReflectionField) {
        guard let active else { return }
        editing[active + ":reflection:" + field.rawValue] = text
        update {
            if $0.reflection == nil { $0.reflection = [:] }
            $0.reflection?[field.rawValue] = text
            $0.updatedAt = Date()
        }
    }
    private var grant: Grant?
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private let service = StudioService()
    private let file: URL
    let installID: String
    var visibleNotebook: Notebook { notebook.includingEdits(editing) }
    var project: Project? { visibleNotebook.projects.first { $0.id == active } }
    init() {
        let defaults = UserDefaults.standard
        if let id = defaults.string(forKey: "studio.installation") { installID = id.lowercased() }
        else { installID = UUID().uuidString.lowercased(); defaults.set(installID, forKey: "studio.installation") }
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = directory.appendingPathComponent("studio-notebook-v1.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file.path) { notebook = try Notebook.decode(Data(contentsOf: file)) }
            active = notebook.projects.first?.id
        } catch { readOnly = true; self.error = "기록을 읽지 못했어요. 원본을 보존하기 위해 저장을 멈췄어요." }
    }
    private func persist(_ value: Notebook) throws {
        guard !readOnly else { throw StudioError.message("기록을 읽지 못한 상태에서는 덮어쓰지 않아요.") }
        let data = try value.encode()
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var url = file
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        notebook = value
    }
    @discardableResult func update(_ edit: (inout Project) throws -> Void) -> Bool {
        guard let active else { return false }
        do { try persist(notebook.updating(active, visibleEdits: editing, edit: edit)); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func newProject() {
        cancel()
        guard notebook.projects.count < 100 else { error = "기록이 100개예요. 내보낸 뒤 필요 없는 기록을 정리해 주세요."; return }
        var value = notebook.includingEdits(editing); let project = Project(); value.projects.insert(project, at: 0)
        do { try persist(value); active = project.id } catch { self.error = error.localizedDescription }
    }
    func select(_ id: String) { cancel(); active = id }
    func deleteProject() {
        cancel(); var value = notebook.includingEdits(editing); value.projects.removeAll { $0.id == active }
        do { try persist(value); active = value.projects.first?.id } catch { self.error = error.localizedDescription }
    }
    func cancel() { generation = UUID(); task?.cancel(); task = nil; busy = false }
    func disconnect() { cancel(); grant = nil; connected = false }
    func connect() {
        guard !busy else { return }; busy = true; error = nil
        let attempt = generation
        task = Task {
            do {
                let result = try await service.claim(installID: installID)
                guard !Task.isCancelled, generation == attempt else { return }
                grant = result; connected = true
            } catch { if !Task.isCancelled, generation == attempt { self.error = error.localizedDescription; if let failure = error as? ServiceFailure, [401, 403].contains(failure.status) { self.grant = nil; connected = false } } }
            if generation == attempt { busy = false }
        }
    }
    func send() {
        guard !busy, let project else { return }
        do {
            let text = draftText
            try persist(notebook.updating(project.id, visibleEdits: editing) { try $0.append(text) })
            editing[project.id + ":draft"] = nil
            if connected { ask() }
        } catch { self.error = error.localizedDescription }
    }
    func ask() {
        guard !busy, let project, let grant, grant.isValid else {
            if grant?.isValid != true { connected = false; error = "무료 AI를 다시 연결해 주세요. 기록은 그대로 남아 있어요." }; return
        }
        busy = true; error = nil; let attempt = generation
        task = Task {
            do {
                let text = try await service.reply(project: project, grant: grant)
                guard !Task.isCancelled, generation == attempt, active == project.id else { return }
                update { $0.messages.append(Message(role: "assistant", content: text)) }
            } catch { if !Task.isCancelled, generation == attempt { self.error = error.localizedDescription; if let failure = error as? ServiceFailure, [401, 403].contains(failure.status) { self.grant = nil; connected = false } } }
            if generation == attempt { busy = false }
        }
    }
    func recover() {
        guard readOnly else { return }
        do {
            let backup = file.deletingLastPathComponent().appendingPathComponent("recovery-\(UUID().uuidString).json")
            try FileManager.default.copyItem(at: file, to: backup)
            readOnly = false
            do { try persist(Notebook()); active = nil; error = nil } catch { readOnly = true; throw error }
        } catch { self.error = "원본을 보존하지 못해 초기화하지 않았어요. 먼저 원본을 내보내 주세요." }
    }
    func export() -> URL? {
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(readOnly ? "HP-Studio-recovery-original.json" : "HP-Studio-records.json")
            let snapshot = notebook.includingEdits(editing)
            let bytes = try readOnly ? Data(contentsOf: file) : snapshot.encode()
            try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); return url
        } catch { self.error = error.localizedDescription; return nil }
    }
}
