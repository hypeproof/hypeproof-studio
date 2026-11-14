import SwiftUI

@MainActor final class StudioModel: ObservableObject {
    @Published private(set) var notebook = Notebook()
    @Published var active: String?
    @Published var error: String?
    @Published private(set) var readOnly = false
    @Published private var editing: [String: String] = [:]
    var hasUnsavedEdits: Bool { !editing.isEmpty }
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
    private let file: URL
    var visibleNotebook: Notebook { notebook.includingEdits(editing) }
    var project: Project? { visibleNotebook.projects.first { $0.id == active } }
    init() {
        var directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
#if DEBUG
        if let id = ProcessInfo.processInfo.environment["HP_NOTEBOOK_FIXTURE_ID"], UUID(uuidString: id) != nil {
            directory = directory.appendingPathComponent("notebook-exit-fixture-" + id)
        }
#endif
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
        editing.removeAll()
        error = nil
    }
    @discardableResult func savePendingEdits() -> Bool {
        guard hasUnsavedEdits else { return true }
        do { try persist(visibleNotebook); return true }
        catch { self.error = "아직 저장하지 못했어요. 작성한 글을 지키기 위해 기록 화면에 머물러요. 다시 저장하거나 내보내 주세요."; return false }
    }
    @discardableResult func update(_ edit: (inout Project) throws -> Void) -> Bool {
        guard let active else { return false }
        do { try persist(notebook.updating(active, visibleEdits: editing, edit: edit)); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func newProject() {
        guard notebook.projects.count < 100 else { error = "기록이 100개예요. 내보낸 뒤 필요 없는 기록을 정리해 주세요."; return }
        var value = notebook.includingEdits(editing); let project = Project(); value.projects.insert(project, at: 0)
        do { try persist(value); active = project.id } catch { self.error = error.localizedDescription }
    }
    func select(_ id: String) { active = id }
    func deleteProject() {
        var value = notebook.includingEdits(editing); value.projects.removeAll { $0.id == active }
        do { try persist(value); active = value.projects.first?.id } catch { self.error = error.localizedDescription }
    }
    // Device records never dispatch AI; account questions use SharedConversationModel.
    @discardableResult func saveThought() -> Bool {
        guard let project else { return false }
        do {
            let text = draftText
            try persist(notebook.updating(project.id, visibleEdits: editing) { try $0.append(text) })
            editing[project.id + ":draft"] = nil
            return true
        } catch { self.error = error.localizedDescription; return false }
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
            try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
#if DEBUG
            if notebookFixtureEnabled { fixtureExport = url }
#endif
            return url
        } catch { self.error = error.localizedDescription; return nil }
    }
#if DEBUG
    // Disposable native-journey storage only. A real directory collision drives
    // the normal atomic-write error; no save result is replaced by the fixture.
    var notebookFixtureEnabled: Bool { file.deletingLastPathComponent().lastPathComponent.hasPrefix("notebook-exit-fixture-") }
    @Published private var fixtureExport: URL?
    private var fixtureBackup: URL { file.deletingLastPathComponent().appendingPathComponent("preserved-v1.json") }
    func blockNotebookFixtureWrites() {
        guard notebookFixtureEnabled else { return }
        do {
            try FileManager.default.moveItem(at: file, to: fixtureBackup)
            try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
            try Data("fixture".utf8).write(to: file.appendingPathComponent("write-blocker"))
            objectWillChange.send()
        } catch { self.error = error.localizedDescription }
    }
    func restoreNotebookFixtureWrites() {
        guard notebookFixtureEnabled, FileManager.default.fileExists(atPath: fixtureBackup.path),
              FileManager.default.fileExists(atPath: file.appendingPathComponent("write-blocker").path) else { return }
        do {
            try FileManager.default.removeItem(at: file)
            try FileManager.default.moveItem(at: fixtureBackup, to: file)
            objectWillChange.send()
        } catch { self.error = error.localizedDescription }
    }
    var notebookFixtureEvidence: String {
        guard notebookFixtureEnabled else { return "" }
        let blocked = FileManager.default.fileExists(atPath: fixtureBackup.path)
        var result: [String: Any] = ["blocked": blocked]
        if let data = try? Data(contentsOf: blocked ? fixtureBackup : file),
           let value = try? JSONSerialization.jsonObject(with: data) {
            result["disk"] = value; result["disk_bytes"] = data.base64EncodedString()
        }
        if let url = fixtureExport, let data = try? Data(contentsOf: url),
           let value = try? JSONSerialization.jsonObject(with: data) { result["export"] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }
#endif
}
