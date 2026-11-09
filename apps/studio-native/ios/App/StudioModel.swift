import SwiftUI

@MainActor final class StudioModel: ObservableObject {
    @Published private(set) var notebook = Notebook()
    @Published var active: String?
    @Published var error: String?
    @Published var busy = false
    @Published var connected = false
    @Published private(set) var readOnly = false
    private var grant: Grant?
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private let service = StudioService()
    private let file: URL
    let installID: String
    var project: Project? { notebook.projects.first { $0.id == active } }
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
        let data = try JSONEncoder().encode(value)
        try data.write(to: file, options: [.atomic, .completeUntilFirstUserAuthentication])
        var url = file
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        notebook = value
    }
    @discardableResult func update(_ edit: (inout Project) throws -> Void) -> Bool {
        guard let index = notebook.projects.firstIndex(where: { $0.id == active }) else { return false }
        do { var value = notebook; try edit(&value.projects[index]); try persist(value); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func newProject() {
        cancel()
        guard notebook.projects.count < 100 else { error = "기록이 100개예요. 내보낸 뒤 필요 없는 기록을 정리해 주세요."; return }
        var value = notebook; let project = Project(); value.projects.insert(project, at: 0)
        do { try persist(value); active = project.id } catch { self.error = error.localizedDescription }
    }
    func select(_ id: String) { cancel(); active = id }
    func deleteProject() {
        cancel(); var value = notebook; value.projects.removeAll { $0.id == active }
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
            var changed = project; try changed.append(project.draft)
            var value = notebook
            guard let i = value.projects.firstIndex(where: { $0.id == project.id }) else { return }
            value.projects[i] = changed; try persist(value)
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
    func export() -> URL? {
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("HP-Studio-records.json")
            let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(notebook).write(to: url, options: [.atomic, .completeUntilFirstUserAuthentication]); return url
        } catch { self.error = error.localizedDescription; return nil }
    }
}
