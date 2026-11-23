import SwiftUI
import Combine
#if DEBUG
import os
import OSLog
#endif

@MainActor final class TeamRequestPresentation: ObservableObject {
    @Published var state = TeamRequestController.View()
    var makeIntake: (String, String) -> TeamIntakePresentation = { _, _ in TeamIntakePresentation() }
    var makeTextHistory: (String, String, String) -> TeamTextRevisionPresentation = { _, _, _ in TeamTextRevisionPresentation() }
    var makeOutcome: (String) -> TeamOutcomePresentation = { _ in TeamOutcomePresentation() }
    var makeDelivery: (String) -> TeamDeliveryPresentation = { _ in TeamDeliveryPresentation() }
    var makeGitHub: (String) -> TeamGitHubPresentation = { _ in TeamGitHubPresentation() }
    var makeRelations: (String, String) -> TeamRelationPresentation = { _, _ in TeamRelationPresentation() }
    var makeWorkflow: (String, String) -> TeamWorkflowPresentation = { _, _ in TeamWorkflowPresentation() }
    var controller: TeamRequestController?
    var inbox: TeamInboxPresentation?
    var detail: (String, String?) async throws -> TeamRequestDetail = { _, _ in throw CancellationError() }
    var commentSchemas: (String) async throws -> [String] = { _ in throw CancellationError() }
    var comment: (TeamCommentDraft) async throws -> String = { _ in throw CancellationError() }
    var loadComment: (String) throws -> TeamCommentDraft = { _ in throw CancellationError() }
    var saveComment: (TeamCommentDraft) throws -> Void = { _ in throw CancellationError() }
}
private func productLabel(_ id: String) -> String { ["studio": "Studio", "lab": "Lab", "foundry": "Foundry"][id] ?? id }

/// Counts one body pass, destination factory call or factory argument (#4432). A no-op outside DEBUG.
func teamRenderCount(_ key: String) {
#if DEBUG
    TeamRenderTrace.shared.count(key)
#endif
}
/// Records, once per process, the first write of `what` that runs off the main thread (#4432 F5).
/// Diagnostics only: it changes no behaviour. Run 44994131331 logged "Updating ObservedObject<TeamRequestPresentation>
/// from background threads"; code reading and a strict-concurrency type-check found no off-main writer.
/// The record goes to the runtime-issue log (the team trace JSON gets only "offMain": 1), which XCTest reports as a test warning.
/// Logs which properties changed for this body pass (#4432 F11), via SwiftUI's `_logChanges()`.
/// DEBUG simulator journeys only, iOS 17.1+. The stall watcher reads these lines back from this
/// process's log store and adds the counts to its stall lines. The trace JSON never carries them.
@MainActor func teamWhy<V: View>(_ view: V.Type) {
#if DEBUG
    guard NativeJourneyFixture.enabled else { return }
    if #available(iOS 17.1, macOS 14.1, *) { V._logChanges() }
#endif
}
extension View {
    /// Counts each `objectWillChange` of an observed model under `key` (#4432 F11). DEBUG only; log-only key.
    func teamPublishCount<P: Publisher>(_ publisher: P, _ key: String) -> some View where P.Failure == Never {
#if DEBUG
        onReceive(publisher) { _ in teamRenderCount(key) }
#else
        self
#endif
    }
    /// Counts each change of a focus value under `key` (#4432 F11). DEBUG only; log-only key.
    func teamChangeCount<T: Equatable>(_ value: T, _ key: String) -> some View {
#if DEBUG
        onChange(of: value) { teamRenderCount(key) }
#else
        self
#endif
    }
}
func teamOffMainCheck(_ what: String) {
#if DEBUG
    guard !Thread.isMainThread else { return }
    TeamRenderTrace.shared.recordOffMain(what)
#endif
}
#if DEBUG
/// DEBUG-only render counters for #4432. Each key keeps its count and the first and last
/// system uptime in ms, so a reader can tell bounded render work from an unbounded update loop.
/// The trace JSON shows the counts only; the uptimes appear in the main-stall line.
/// Trace tickers are deliberately not counted: the trace is an accessibility value, and a count that
/// changed on every 0.25 s tick flooded testmanagerd with accessibility notifications while idle.
final class TeamRenderTrace: @unchecked Sendable {
    static let shared = TeamRenderTrace()
    /// Push marks, publish counters ("pub.") and focus counters ("focus.") feed only the stall lines.
    private static let pushMarkPrefixes = ["tap.", "async.", "appear.", "pub.", "focus."]
    /// Destination body and observation-factory counters (F11 GitHub loop) go only to the stall lines.
    /// Keeping them out of the trace keeps its value the same length as before (#4457).
    private static let logOnlyKeys: Set<String> = ["body.workflow", "body.outcome", "body.delivery", "body.github", "body.intake", "body.text", "body.observations", "body.subscription", "make.observations"]
    private let lock = NSLock()
    private var rows: [String: (count: Int, first: Int, last: Int)] = [:]
    func count(_ key: String) {
        let now = Int(ProcessInfo.processInfo.systemUptime * 1000)
        lock.lock(); defer { lock.unlock() }
        let row = rows[key] ?? (0, now, now)
        rows[key] = (row.count + 1, row.first, now)
    }
    private var offMain: [String: Any]?
    func recordOffMain(_ what: String) {
        let queue = String(cString: __dispatch_queue_get_label(nil))
        let frames = Thread.callStackSymbols.prefix(40).map { line -> String in
            let parts = line.split(separator: " ", omittingEmptySubsequences: true)
            return parts.count > 3 ? String(parts[1]) + " " + parts.dropFirst(3).joined(separator: " ") : line
        }
        let record: [String: Any] = ["what": what, "queue": queue, "thread": Thread.current.description, "uptime_ms": Int(ProcessInfo.processInfo.systemUptime * 1000), "stack": Array(frames)]
        lock.lock()
        let first = offMain == nil
        if first { offMain = record }
        lock.unlock()
        guard first else { return }
        let text = "HPStudio off-main write: \(what) on queue \(queue); stack: " + frames.joined(separator: " <- ")
        os_log("%{public}@", dso: teamRuntimeIssueDSO ?? #dsohandle, log: OSLog(subsystem: "com.apple.runtime-issues", category: "HPStudio"), type: .fault, text as NSString)
    }
    func snapshot() -> [String: [String: Int]] {
        lock.lock(); defer { lock.unlock() }
        return rows.mapValues { ["count": $0.count, "first_ms": $0.first, "last_ms": $0.last] }
    }
    /// Adds the counters to a trace JSON object under "render"; other keys stay unchanged.
    /// The trace is an accessibility value, and a long value can lose its later keys before a test
    /// reads them (#4432 F12). So the trace carries only short values: "render" holds counts only
    /// (first_ms/last_ms feed the stall line), plus "offMain": 1 and "stalls": N.
    /// The off-main stack and the stall details stay in their runtime-issue lines, and the push marks
    /// (tap., async., appear.) only feed the stall line.
    static func merged(into trace: String) -> String {
        guard var object = (try? JSONSerialization.jsonObject(with: Data(trace.utf8))) as? [String: Any] else { return trace }
        object["render"] = shared.snapshot().filter { key, _ in !logOnlyKeys.contains(key) && !pushMarkPrefixes.contains { key.hasPrefix($0) } }.mapValues { $0["count"] ?? 0 }
        shared.lock.lock(); let offMain = shared.offMain != nil; shared.lock.unlock()
        if offMain { object["offMain"] = 1 }
        let stalls = TeamMainStallWatch.shared.reportCount()
        if stalls > 0 { object["stalls"] = stalls }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return trace }
        return String(data: data, encoding: .utf8) ?? trace
    }
}
/// DEBUG-only main-thread stall reporter (#4432 F11). F5 and F11 froze the request detail screen for
/// 86-140 s after a tap, and no sample covered the frozen time. A background timer pings the main queue
/// at most every 0.5 s. A ping answered after 100 ms or more starts or extends a stall. Three fast
/// answers in a row end it, because a render loop leaves short gaps in which one ping can be answered
/// quickly. A stall longer than 2 s (first slow ping to last slow answer) is reported once: one
/// runtime-issue line (an XCTest warning). It lists the render counters that changed from the last
/// quiet ping until the stall ended, each with its last uptime, so tap, async, make and appear can be
/// ordered against the stall start. The team trace JSON gets only the count ("stalls": N), so it
/// changes only when a stall is reported, never on a ping. At most 8 reports per process.
///
/// A stall that never ends (the main queue never answers, or the test is killed first) would give no
/// final line. So the timer also checks an ongoing stall on every tick. An unanswered ping that is
/// 100 ms or older counts as a stall from the time it was sent. When an ongoing stall reaches 10 s,
/// 20 s and 40 s, one "(ongoing)" line is logged with the same render changes. These lines do not
/// change the trace JSON or the "stalls" count. At most 3 per stall and 12 per process.
/// The queue is user-initiated, not utility. Run 45033852560 had no ping handled for about 51 s after
/// a tap on a heavily loaded runner; a starved utility queue is the inferred reason (not proven).
final class TeamMainStallWatch: @unchecked Sendable {
    static let shared = TeamMainStallWatch()
    private static let interval = 0.5, slowMs = 100, quietPings = 3, reportMs = 2_000, maxReports = 8
    private static let interimMs = [10_000, 20_000, 40_000], maxInterim = 12
    private static func now() -> Int { Int(ProcessInfo.processInfo.systemUptime * 1000) }
    private let queue = DispatchQueue(label: "ai.hypeproof.studio.main-stall-watch", qos: .userInitiated)
    // Touched only on `queue`.
    private var timer: DispatchSourceTimer?
    private var waiting = false
    /// Send time of the ping that the main queue has not answered yet.
    private var pendingSent = 0
    private var reports = 0
    /// Ongoing-stall lines logged for the current stall, and in this process.
    private var interimDone = 0, interimTotal = 0
    /// Counters at the last quiet ping, so a tap just before the stall is in its changes.
    private var quietBefore: [String: [String: Int]] = [:]
    private var stall: (start: Int, end: Int, pings: Int, fast: Int, quiet: Int, worst: Int, before: [String: [String: Int]])?
    private let lock = NSLock()
    private var reportedStalls = 0
    func start() {
        queue.async { [self] in
            guard timer == nil else { return }
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now() + Self.interval, repeating: Self.interval, leeway: .milliseconds(100))
            source.setEventHandler { [weak self] in self?.ping() }
            timer = source; source.resume()
        }
    }
    func reportCount() -> Int { lock.lock(); defer { lock.unlock() }; return reportedStalls }
    private func ping() {
        guard reports < Self.maxReports else { timer?.cancel(); return }
        interim()
        guard !waiting else { return }
        waiting = true
        let sent = Self.now(), before = stall == nil ? TeamRenderTrace.shared.snapshot() : [:]
        pendingSent = sent
        DispatchQueue.main.async { [self] in
            let answered = Self.now()
            queue.async { self.answer(sent: sent, answered: answered, before: before) }
        }
    }
    /// Logs one "(ongoing)" line when the current stall passes its next 10 s, 20 s or 40 s mark.
    private func interim() {
        guard interimDone < Self.interimMs.count, interimTotal < Self.maxInterim else { return }
        let now = Self.now(), outstanding = waiting ? now - pendingSent : 0
        let start: Int
        if let s = stall { start = s.start } else if outstanding >= Self.slowMs { start = pendingSent } else { return }
        let length = now - start
        guard length >= Self.interimMs[interimDone] else { return }
        interimDone += 1; interimTotal += 1
        let text = "HPStudio main stall (ongoing): \(length) ms since uptime \(start) ms; outstanding ping \(outstanding) ms; \(stall?.pings ?? 0) slow pings answered; render changes: "
            + changes(since: stall?.before ?? quietBefore) + "; why: " + why(since: start)
        os_log("%{public}@", dso: teamRuntimeIssueDSO ?? #dsohandle, log: OSLog(subsystem: "com.apple.runtime-issues", category: "HPStudio"), type: .fault, text as NSString)
    }
    private let launched = Date()
    /// Body-change lines already counted at the previous report (touched only on `queue`).
    private var whyLinesSeen = 0
    /// Which body properties changed since `start` (uptime ms), from the `teamWhy` lines in this process's
    /// log store, most frequent first. The tail gives the window count, the process total (a non-zero total
    /// shows the probe works: positive control) and the age of the newest line.
    /// On the iOS simulator, `position(date:)` for a recent date skipped lines that a read from launch
    /// returned (run 45116092106), so this reads from launch and filters by each entry's own date.
    /// If no entry falls in the window but new lines arrived since the previous report, it counts those
    /// instead and says so ("since last report").
    private func why(since start: Int) -> String {
        let cutoff = Date().addingTimeInterval(-(Double(Self.now() - start) / 1000 + 0.5))
        guard let store = try? OSLogStore(scope: .currentProcessIdentifier) else { return "store unavailable" }
        let predicate = NSPredicate(format: "subsystem == %@ AND category == %@", "com.apple.SwiftUI", "Changed Body Properties")
        guard let entries = try? store.getEntries(at: store.position(date: launched), matching: predicate) else { return "read failed" }
        let lines = entries.compactMap { entry -> (date: Date, text: String)? in
            (entry as? OSLogEntryLog).map { ($0.date, $0.composedMessage) }
        }
        let previous = min(whyLinesSeen, lines.count); whyLinesSeen = lines.count
        let window = lines.filter { $0.date >= cutoff }.map(\.text)
        let newest = lines.last.map { String(format: "%.1f", Date().timeIntervalSince($0.date)) } ?? "-"
        let tail = " (window \(window.count) of \(lines.count) lines; newest line \(newest)s ago)"
        if !window.isEmpty { return Self.summary(window) + tail }
        if lines.count > previous { return "since last report: " + Self.summary(lines[previous...].map(\.text)) + tail }
        return "none" + tail
    }
    /// "TeamIntakeScreen: _dismiss, _model changed." lines as "<View>.<property>+N", 12 most frequent.
    private static func summary(_ lines: [String]) -> String {
        var counts: [String: Int] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let type = line[..<colon]
            var rest = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if rest.hasSuffix(" changed.") { rest.removeLast(" changed.".count) }
            for part in rest.split(separator: ",") { counts[type + "." + part.trimmingCharacters(in: .whitespaces), default: 0] += 1 }
        }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.prefix(12).map { "\($0.key)+\($0.value)" }.joined(separator: " ")
    }
    /// Render counters that grew since `before`, oldest last change first.
    private func changes(since before: [String: [String: Int]]) -> String {
        let changed = TeamRenderTrace.shared.snapshot().compactMap { key, row -> (key: String, count: Int, last: Int)? in
            let count = (row["count"] ?? 0) - (before[key]?["count"] ?? 0)
            return count > 0 ? (key, count, row["last_ms"] ?? 0) : nil
        }.sorted { $0.last < $1.last }
        return changed.isEmpty ? "none" : changed.map { "\($0.key)+\($0.count)@\($0.last)" }.joined(separator: " ")
    }
    private func answer(sent: Int, answered: Int, before: [String: [String: Int]]) {
        waiting = false
        let latency = answered - sent
        if latency >= Self.slowMs {
            if let s = stall { stall = (s.start, answered, s.pings + 1, s.fast + s.quiet, 0, max(s.worst, latency), s.before) }
            else { stall = (sent, answered, 1, 0, 0, latency, quietBefore) }
            return
        }
        guard let s = stall else { quietBefore = before; return }
        guard s.quiet + 1 >= Self.quietPings else { stall = (s.start, s.end, s.pings, s.fast, s.quiet + 1, s.worst, s.before); return }
        let changed = changes(since: s.before)
        stall = nil; interimDone = 0; quietBefore = TeamRenderTrace.shared.snapshot()
        let length = s.end - s.start
        guard length > Self.reportMs else { return }
        reports += 1
        lock.lock(); reportedStalls += 1; lock.unlock()
        let text = "HPStudio main stall: \(length) ms from uptime \(s.start) ms; \(s.pings) slow and \(s.fast) fast pings, worst \(s.worst) ms; render changes: " + changed
            + "; why: " + why(since: s.start)
        os_log("%{public}@", dso: teamRuntimeIssueDSO ?? #dsohandle, log: OSLog(subsystem: "com.apple.runtime-issues", category: "HPStudio"), type: .fault, text as NSString)
    }
}
/// Runtime issues are expected to surface as XCTest warnings only when the log call names a system
/// image (as SwiftUI's own "Updating ObservedObject" issue did), so the issue uses SwiftUI's image handle.
/// If the lookup fails it falls back to this image; the trace JSON "offMain" marker is kept either way.
nonisolated(unsafe) private let teamRuntimeIssueDSO: UnsafeRawPointer? = {
    var info = Dl_info()
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "$s7SwiftUI4ViewMp"), dladdr(symbol, &info) != 0, let base = info.dli_fbase else { return nil }
    return UnsafeRawPointer(base)
}()
#endif

struct TeamRequestsView: View {
    @ObservedObject var model: TeamRequestPresentation
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSend = false
    @State private var confirmClose = false
    var body: some View {
        NavigationStack {
            List {
#if DEBUG
                if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic request trace").font(.caption2).accessibilityIdentifier("teamRequestTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamRequestStatus") }
                if let draft = model.state.draft {
                    Section {
                        if let access = model.state.access {
                            Picker("제품", selection: Binding(get: { model.state.draft?.product ?? "studio" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: current.body, product: value, category: current.category) })) {
                                ForEach(access.products, id: \.self) { Text(productLabel($0)).tag($0) }
                            }.disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        }
                        Picker("종류", selection: Binding(get: { model.state.draft?.category ?? "bug" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: current.body, product: current.product, category: value) })) {
                            Text("불편·문제").tag("bug"); Text("개선 아이디어").tag("improvement"); Text("질문").tag("question")
                        }.disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        if draft.phase != .received {
                        TextEditor(text: Binding(get: { model.state.draft?.body ?? "" }, set: { value in guard let current = model.state.draft else { return }; model.controller?.edit(body: value, product: current.product, category: current.category) }))
                            .frame(minHeight: 130).accessibilityLabel("내부 요청 내용").accessibilityIdentifier("teamRequestBody")
                            .disabled(draft.phase != .draft || model.state.busy || !model.state.storageReady)
                        Text("\(draft.body.utf16.count)/5,000단위 · 이모지는 여러 단위로 계산돼요.").font(.caption).foregroundStyle(.secondary)
                        if !draft.body.isEmpty { ShareLink("내용 내보내기", item: draft.body) }
                        }
                        if let receipt = draft.receipt {
                            Text("접수 번호: \(receipt)").font(.caption).textSelection(.enabled).accessibilityIdentifier("teamRequestReceipt")
                            NavigationLink("요청과 논의 보기") { TeamRequestDetailView(model: model, requestID: receipt) }
                            Button("새 요청 작성") { model.controller?.newDraft() }.disabled(model.state.busy || !model.state.storageReady)
                        } else {
                            if draft.phase == .uncertain {
                                Button("접수 결과 확인") { Task { await model.controller?.submit(recoveryOnly: true) } }.disabled(model.state.busy)
                                    .accessibilityIdentifier("teamRequestRecover")
                            }
                            Button(draft.phase == .uncertain ? "같은 번호로 다시 보내기" : "내부 팀에 보내기") { confirmSend = true }
                                .disabled(model.state.busy || !model.state.storageReady || model.state.access?.products.contains(draft.product) != true || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                .accessibilityIdentifier("teamRequestSend")
                        }
                    } header: { Text("새 의견·질문") } footer: {
                        Text("해당 제품 권한이 있는 Lab 내부 멤버 전체가 요청과 댓글을 볼 수 있어요. 미해결 요청은 유지하며, 작성자가 해결을 확인한 뒤 90일 동안 보관해요. 대화·음성·계정 비밀은 함께 보내지 않아요.")
                    }
                    Section("\(productLabel(draft.product))의 요청") {
                        if model.state.requests.isEmpty && !model.state.busy { Text("표시할 요청이 없어요.").foregroundStyle(.secondary) }
                        ForEach(model.state.requests) { request in
                            NavigationLink { TeamRequestDetailView(model: model, requestID: request.id) } label: {
                                VStack(alignment: .leading, spacing: 6) { Text(request.body).lineLimit(3); Text("접수됨 · \(request.account_id)").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                        if model.state.nextCursor != nil { Button("이전 요청 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
                    }
                }
            }.navigationTitle("팀 요청").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                    ToolbarItem(placement: .confirmationAction) { Button("닫기") { if !model.state.storageReady { confirmClose = true } else { dismiss() } }.accessibilityIdentifier("teamRequestClose") }
                }
                .task { await model.controller?.open() }
                .alert("내부 팀에 보낼까요?", isPresented: $confirmSend) {
                    Button("취소", role: .cancel) {}
                    Button("보내기") { Task { await model.controller?.submit() } }
                } message: { Text("작성한 내용은 이 제품 권한이 있는 내부 멤버에게 공개돼요. 같은 전송 번호는 서버에서 하나의 요청으로 처리해요.") }
                .alert("저장되지 않은 내용이 있어요", isPresented: $confirmClose) {
                    Button("계속 작성", role: .cancel) {}; Button("닫기", role: .destructive) { dismiss() }
                } message: { Text("닫기 전에 내용을 내보내 주세요.") }
                .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
        }
    }
}

struct TeamRequestDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLeave = false
    @ObservedObject var model: TeamRequestPresentation
    let requestID: String
    @State private var history = TeamCommentHistory()
    private var detail: TeamRequestDetail? { history.detail }
    private var comments: [TeamRequestComment] { history.comments }
    @State private var commentSchemas: [String] = []
    @FocusState private var commentFocused: Bool
    @State private var showIntake = false
    @State private var intakeProduct = "studio"
    @State private var showRelated = false
    @State private var relatedProduct = "studio"
    @State private var showTextHistory = false
    @State private var textTarget = ""
    @State private var textProduct = "studio"
    @State private var draft: TeamCommentDraft?
    @State private var busy = false
    @State private var storageReady = true
    @State private var confirmSend = false
    @State private var message = ""
    @State private var generation = UUID()
    var body: some View {
        let _ = teamRenderCount("body.detail")
        let _ = teamWhy(Self.self)
        List {
            if !message.isEmpty { Text(message).accessibilityIdentifier("teamCommentStatus") }
            if let detail {
                Section("원문") {
                    Text(detail.request.body).textSelection(.enabled); Text("작성자: \(detail.request.account_id) · \(Date(timeIntervalSince1970: detail.request.created_at / 1000).formatted())").font(.caption)
                    Button("현재 내용과 수정 이력") { openTextHistory(requestID, product: detail.request.product) }.buttonStyle(.borderless).disabled(busy || !storageReady).accessibilityIdentifier("teamRequestTextHistory")
                    if canChooseIntent { Button("원문에 답글") { choose("reply", target: requestID) }.buttonStyle(.borderless).accessibilityIdentifier("teamReplyToRequest") }
                    if let retention = detail.retention, retention.hidden { Text(retention.marker).font(.caption).accessibilityIdentifier("teamHiddenContentNotice") }
                }
                if let question = detail.latest_question {
                    Section("최근 올라온 질문") {
                        Text("작성자: \(question.account_id) · \(Date(timeIntervalSince1970: question.created_at / 1000).formatted())").font(.caption)
                        Button("질문 내용과 수정 이력 보기") { openTextHistory(question.target_id, product: detail.request.product) }.buttonStyle(.borderless).disabled(busy || !storageReady).accessibilityIdentifier("teamLatestQuestion")
                        Text("작성 시각 기준이에요. 답변 여부나 해결 상태를 뜻하지 않아요.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section { NavigationLink("담당·진행 상태와 이력") { TeamDetailDestination(kind: .workflow, model: model, requestID: requestID, product: detail.request.product).equatable() }.accessibilityIdentifier("teamWorkflowEntry") }
                Section { NavigationLink("해결 여부 확인") { TeamDetailDestination(kind: .outcome, model: model, requestID: requestID).equatable() }.disabled(busy || !storageReady).accessibilityIdentifier("teamOutcomeEntry") }
                Section { NavigationLink("배포 버전과 확인 안내") { TeamDetailDestination(kind: .delivery, model: model, requestID: requestID).equatable() }.disabled(busy || !storageReady).accessibilityIdentifier("teamDeliveryEntry") }
                Section { Button("공개 요청으로 제안") {
                    teamRenderCount("tap.intake"); commentFocused = false; intakeProduct = detail.request.product; let expected = generation
                    DispatchQueue.main.async { if generation == expected && !busy && storageReady && self.detail?.retention?.hidden != true { teamRenderCount("async.intake"); showIntake = true } }
                }.disabled(busy || !storageReady || detail.retention?.hidden == true).accessibilityIdentifier("teamIntakeEntry") }
                Section { NavigationLink("GitHub 연결과 근거") { TeamDetailDestination(kind: .github, model: model, requestID: requestID).equatable() }.disabled(busy || !storageReady).accessibilityIdentifier("teamGitHubEntry")
                    Button("관련 요청") {
                        teamRenderCount("tap.related"); commentFocused = false; relatedProduct = detail.request.product
                        let expected = generation
                        // Commit focus resignation before NavigationStack captures the source view.
                        DispatchQueue.main.async { if generation == expected && !busy && storageReady { teamRenderCount("async.related"); showRelated = true } }
                    }.disabled(busy || !storageReady).accessibilityIdentifier("teamRelationsEntry") }
                if let inbox = model.inbox { Section { NavigationLink("이 요청의 알림 설정") { TeamDetailDestination(kind: .subscription, model: model, requestID: requestID, product: detail.request.product, inbox: inbox).equatable() }.disabled(busy || !storageReady).accessibilityIdentifier("teamRequestSubscription") } }
                Section("논의") {
                    ForEach(comments) { comment in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(intentLabel(comment.discussionIntent)).font(.caption).accessibilityIdentifier("teamCommentIntent-" + comment.id)
                            if let target = comment.reply_to { Text(targetLabel(target)).font(.caption) }
                            Text("처음 남긴 내용").font(.caption).foregroundStyle(.secondary)
                            Text(comment.body).textSelection(.enabled); Text("\(comment.account_id) · \(Date(timeIntervalSince1970: comment.created_at / 1000).formatted())").font(.caption).foregroundStyle(.secondary)
                            Button("현재 내용과 수정 이력") { openTextHistory(comment.id, product: detail.request.product) }.buttonStyle(.borderless).disabled(busy || !storageReady).accessibilityIdentifier("teamCommentTextHistory-" + comment.id)
                            if canChooseIntent { Button("이 댓글에 답글") { choose("reply", target: comment.id) }.buttonStyle(.borderless).accessibilityIdentifier("teamReplyTo-" + comment.id) }
                        }
                    }
                    if detail.next_comments_cursor != nil { Button("댓글 더 보기") { Task { await refresh(more: true) } }.disabled(busy) }
                }
            }
            if let draft, !history.canDisplay(draft) {
                Text("저장된 댓글 내용은 서버 기록을 확인한 뒤 표시해요. 새로고침하거나 이전 댓글을 더 확인해 주세요.")
                Button("새 댓글") { newComment(from: draft) }.disabled(busy || !storageReady || detail?.retention?.hidden == true)
            }
            if let draft, history.canDisplay(draft) {
                    Section {
                        Text(draft.needsReplyTarget == true ? "답글 대상을 선택해 주세요" : intentLabel(draft.discussionIntent)).accessibilityIdentifier("teamCommentSelectedIntent")
                        if let target = draft.replyTo { Text(targetLabel(target)).accessibilityIdentifier("teamCommentReplyTarget") }
                        if canChooseIntent {
                            Button("논의로 작성") { choose("discussion", target: nil) }.accessibilityIdentifier("teamCommentChooseDiscussion")
                            Button("질문으로 작성") { choose("question", target: nil) }.accessibilityIdentifier("teamCommentChooseQuestion")
                        }
                        TextEditor(text: Binding(get: { self.draft?.body ?? "" }, set: { edit($0) })).frame(minHeight: 110).accessibilityLabel("댓글 내용").accessibilityIdentifier("teamCommentBody")
                            .focused($commentFocused)
                            .disabled(busy || !storageReady || draft.phase != .draft)
                        if !draft.body.isEmpty { ShareLink("댓글 내용 내보내기", item: draft.body) }
                        if draft.phase == .received {
                            Text("댓글이 접수됐어요.")
                            Button("새 댓글") { newComment(from: draft) }.disabled(busy || !storageReady || detail?.retention?.hidden == true)
                        } else if draft.definitiveRejection == "team_reply_target_unavailable" {
                            Button("다른 대상으로 새 답글 작성") { startFreshReplyChoice() }
                                .disabled(busy || !storageReady || !commentSchemas.contains("hps-team-comment/2"))
                                .accessibilityIdentifier("teamCommentNewTarget")
                            Text("원래 답글은 저장되지 않았어요. 글을 유지한 채 새 대상을 직접 선택할 수 있어요.").font(.caption)
                        } else if draft.definitiveRejection == "team_content_expired" {
                            Text("서버 보관 기간이 지나 지금은 추가할 수 없어요. 작성한 글은 내보낼 수 있어요.")
                        } else {
                            Button { confirmSend = true } label: {
                                Text(draft.phase == .uncertain ? "같은 번호로 다시 보내기" : "댓글 보내기")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                                .buttonStyle(.borderless)
                                .disabled(detail?.retention?.hidden == true || busy || !storageReady || draft.needsReplyTarget == true || draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (draft.phase == .draft && !commentSchemas.contains(draft.wireSchema)))
                                .accessibilityIdentifier("teamCommentSend")
                        }
                    } header: { Text("댓글 남기기") } footer: { Text("댓글도 이 제품 권한이 있는 내부 멤버 전체가 볼 수 있어요. 전송 결과를 모를 때 같은 번호로 다시 보내면 중복 댓글을 만들지 않아요.") }
            }
        }.accessibilityIdentifier("teamRequestDetailList").navigationTitle("요청과 논의").navigationBarTitleDisplayMode(.inline)
            // Each destination is an Equatable value (#4432 F11): a detail body pass that
            // leaves its inputs unchanged does not re-run the pushed screen's body.
            .navigationDestination(isPresented: $showIntake) { TeamDetailDestination(kind: .intake, model: model, requestID: requestID, product: intakeProduct).equatable() }
            .navigationDestination(isPresented: $showTextHistory) { TeamDetailDestination(kind: .text, model: model, requestID: requestID, product: textProduct, target: textTarget).equatable() }
            .navigationDestination(isPresented: $showRelated) { TeamDetailDestination(kind: .relations, model: model, requestID: requestID, product: relatedProduct).equatable() }
            .navigationBarBackButtonHidden(!storageReady || busy)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if !storageReady || busy { Button("뒤로") { if !storageReady { confirmLeave = true } else { dismiss() } }.accessibilityIdentifier("teamCommentBack") }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await refresh() } }.disabled(busy || !storageReady) }
            }
            .interactiveDismissDisabled(busy || !storageReady)
            .alert("저장되지 않은 댓글이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 댓글 내용을 내보내 주세요. 저장되지 않은 수정은 사라질 수 있어요.") }
            .task(id: requestID) {
                do { draft = try model.loadComment(requestID) } catch { storageReady = false; message = "저장된 댓글을 읽지 못했어요. 원본을 유지했어요." }
                await refresh()
            }.onDisappear { commentFocused = false; generation = UUID(); busy = false; history.clear() }
            .teamPublishCount(model.objectWillChange, "pub.requests.detail").teamChangeCount(commentFocused, "focus.detail")
            .alert("댓글을 보낼까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("보내기") { Task { await submit() } }
            } message: { Text("이 제품 권한이 있는 내부 멤버에게 \(intentLabel(draft?.discussionIntent ?? "discussion"))를 공유해요. \(draft?.replyTo.map(targetLabel) ?? "")") }
    }
    private func openTextHistory(_ target: String, product: String) {
        guard !busy, storageReady, TeamTextVersion.validTarget(target, request: requestID) else { return }
        teamRenderCount("tap.text"); commentFocused = false; textTarget = target; textProduct = product
        let expected = generation
        DispatchQueue.main.async { if generation == expected && !busy && storageReady { teamRenderCount("async.text"); showTextHistory = true } }
    }
    private var canChooseIntent: Bool { detail?.retention?.hidden != true && !busy && storageReady && draft?.phase == .draft && commentSchemas.contains("hps-team-comment/2") }
    private func intentLabel(_ intent: String) -> String { ["discussion":"논의", "question":"질문", "reply":"답글"][intent] ?? "논의" }
    private func targetLabel(_ target: String) -> String {
        if target == requestID { return "원문에 남기는 답글" }
        if let comment = comments.first(where: { $0.id == target }) { return "답글 대상: " + String(comment.body.prefix(80)) }
        return "이전 댓글에 남기는 답글 (" + target + ")"
    }
    private func choose(_ intent: String, target: String?) {
        guard canChooseIntent, let draft else { return }
        commentFocused = false
        do {
            let next = try draft.choosing(intent, reply: target, loadedComments: comments)
            try model.saveComment(next); self.draft = next
        } catch { storageReady = false; message = "작성 방식을 저장하지 못했어요. 원래 글은 유지했어요." }
    }
    private func startFreshReplyChoice() {
        guard !busy, storageReady, commentSchemas.contains("hps-team-comment/2"), let draft else { return }
        commentFocused = false
        do { let next = try draft.freshReplyChoice(); try model.saveComment(next); self.draft = next; message = "답글 대상을 다시 선택해 주세요. 글은 유지했어요." }
        catch { storageReady = false; message = "새 선택을 저장하지 못했어요. 원래 글과 전송 번호는 유지했어요." }
    }
    private func reject(_ code: String, generation expected: UUID) {
        guard generation == expected, var local = draft, local.recordDefinitiveRejection(code) else { return }
        draft = local
        do { try model.saveComment(local) } catch { storageReady = false; message = "서버 결과를 기기에 저장하지 못했어요. 원래 글을 내보내 주세요." }
    }
    private func edit(_ text: String) {
        guard !busy, storageReady, var draft, draft.phase == .draft, text.utf16.count <= 5000 else { return }
        draft.body = text; self.draft = draft
        do { try model.saveComment(draft) } catch { storageReady = false; message = "댓글을 기기에 저장하지 못했어요. 내용을 내보내 주세요." }
    }
    private func newComment(from received: TeamCommentDraft) {
        guard received.phase == .received, !busy, storageReady, detail?.retention?.hidden != true else { return }
        let next = TeamCommentDraft(accountID: received.accountID, requestID: requestID)
        do { try model.saveComment(next); draft = next } catch { storageReady = false; message = "새 댓글을 저장하지 못했어요." }
    }
    private func reconcileAcknowledged(_ result: TeamRequestDetail) {
        if var local = draft, local.observeTombstone(result) {
            draft = local
            do { try model.saveComment(local) } catch { storageReady = false; message = "서버에서 숨긴 내용의 기기 사본을 정리하지 못했어요." }
        }
    }
    private func refresh(more: Bool = false) async {
        guard !busy else { return }; busy = true; let g = generation
        defer { if g == generation { busy = false } }
        if !more { history.beginRefresh() }
        do {
            var result = try await model.detail(requestID, more ? detail?.next_comments_cursor : nil)
            guard g == generation, !Task.isCancelled else { return }
            try result.validate(id: requestID)
            reconcileAcknowledged(result)
            if try !history.accept(result, more: more) {
                // A purge between pages invalidates every previously loaded row.
                // Fetch from the beginning; never append another generation.
                result = try await model.detail(requestID, nil)
                guard g == generation, !Task.isCancelled else { return }
                _ = try history.accept(result, more: false)
            }
            reconcileAcknowledged(result)
            do {
                let supported = try await model.commentSchemas(result.request.product)
                guard g == generation, !Task.isCancelled else { return }; commentSchemas = supported
            } catch { if g == generation { commentSchemas = []; message = "지금 작성 가능한 방식을 확인하지 못했어요. 새로고침해 주세요." } }
        } catch { if g == generation { history.clear(); commentSchemas = []; message = "논의를 불러오지 못했어요. 로그인과 제품 권한을 확인해 주세요." } }
    }
    private func submit() async {
        guard detail?.retention?.hidden != true, !busy, storageReady, var draft, draft.phase != .received, draft.definitiveRejection == nil, draft.needsReplyTarget != true,
              draft.phase == .uncertain || commentSchemas.contains(draft.wireSchema) else { return }
        commentFocused = false
        let g = generation; busy = true
        defer { if g == generation { busy = false } }
        do {
            draft.phase = .uncertain
            do { try model.saveComment(draft) } catch { storageReady = false; message = "보내지 않았어요. 전송 상태를 저장하지 못했어요."; return }
            self.draft = draft
            let receipt = try await model.comment(draft)
            guard g == generation, !Task.isCancelled else { return }
            draft.phase = .received; draft.receipt = receipt; draft.definitiveRejection = nil; self.draft = draft
            do { try model.saveComment(draft); message = "댓글이 접수됐어요. 새로고침하면 논의에서 확인할 수 있어요." }
            catch { storageReady = false; message = "접수됐지만 기기에 저장하지 못했어요. 댓글 내용을 내보내 주세요." }
        } catch SyncFailure.http(409, "team_content_expired") {
            if g == generation { message = "서버 보관 기간이 지나 지금은 이 내용에 추가할 수 없어요. 작성한 글과 전송 번호는 이 기기에 유지돼요."; reject("team_content_expired", generation:g) }
        } catch SyncFailure.http(409, "team_reply_target_unavailable") {
            if g == generation { message = "답글 대상을 지금 확인할 수 없어요. 원래 글과 전송 번호는 유지돼요. 새로고침해 주세요."; reject("team_reply_target_unavailable", generation:g) }
        } catch { if g == generation { message = "접수 여부를 확인하지 못했어요. 댓글과 전송 번호는 유지돼요." } }
    }
}

/// One request-detail destination as a value (#4432 F11). Main runs showed TeamRequestDetailView.body and the
/// pushed screen's body re-running about 1:1 in a main-thread loop. The pushed screen used to be built inline
/// with a `make:` closure, which SwiftUI cannot compare, so every detail body pass re-ran the pushed body.
/// `==` covers every input the screen is built from; each screen observes its own state (StateObject or
/// ObservedObject), so skipping a pass with equal inputs drops no update. The factories run, and are counted,
/// exactly where they were before: inside the screens' StateObject autoclosures.
private struct TeamDetailDestination: View, Equatable {
    enum Kind { case workflow, outcome, delivery, github, subscription, intake, text, relations }
    let kind: Kind
    let model: TeamRequestPresentation
    let requestID: String
    var product = ""
    var target = ""
    var inbox: TeamInboxPresentation?
    nonisolated static func == (a: Self, b: Self) -> Bool {
        a.kind == b.kind && a.model === b.model && a.requestID == b.requestID && a.product == b.product && a.target == b.target && a.inbox === b.inbox
    }
    var body: some View {
        let model = model, requestID = requestID, product = product, target = target
        switch kind {
        case .workflow: TeamWorkflowScreen(make: { teamRenderCount("make.workflow"); return model.makeWorkflow(requestID, product) }, requests: model)
        case .outcome: TeamOutcomeView(make: { teamRenderCount("make.outcome"); return model.makeOutcome(requestID) })
        case .delivery: TeamDeliveryScreen(make: { teamRenderCount("make.delivery"); return model.makeDelivery(requestID) })
        case .github: TeamGitHubScreen(make: { teamRenderCount("make.github"); return model.makeGitHub(requestID) })
        case .subscription: if let inbox { TeamSubscriptionScreen(model: inbox, product: product, request: requestID) }
        case .intake: TeamIntakeScreen(make: { teamRenderCount("make.intake"); teamRenderCount("arg.intake." + product); return model.makeIntake(requestID, product) })
        case .text: TeamTextRevisionScreen(make: { teamRenderCount("make.text"); return model.makeTextHistory(requestID, target, product) })
        case .relations: TeamRelationScreen(make: { teamRenderCount("make.relations"); teamRenderCount("arg.relations." + product); return model.makeRelations(requestID, product) }, requests: model)
        }
    }
}

@MainActor final class TeamWorkflowPresentation: ObservableObject {
    @Published var state = TeamWorkflowController.View()
    var controller: TeamWorkflowController?
}
private func workflowLabel(_ value: String) -> String {
    ["submitted":"접수됨", "discussing":"논의 중", "on_hold":"보류", "duplicate":"중복 연결", "rejected":"반려", "unclassified":"미정", "low":"낮음", "normal":"보통", "high":"높음"][value] ?? value
}
private struct TeamWorkflowScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TeamWorkflowPresentation
    let requests: TeamRequestPresentation
    @State private var confirmSend = false
    @State private var confirmLeave = false
    init(make: @escaping @MainActor () -> TeamWorkflowPresentation, requests: TeamRequestPresentation) { _model = StateObject(wrappedValue: make()); self.requests = requests }
    private var editable: Bool { model.state.page?.can_manage == true && model.state.page?.retention?.hidden != true && model.state.draft?.phase == .draft && !model.state.busy && model.state.storageReady }
    private func memberName(_ id: String?) -> String {
        guard let id else { return "담당 미정" }
        return model.state.members.first { $0.account_id == id }?.display_name ?? "계정: \(id)"
    }
    var body: some View {
        let _ = teamRenderCount("body.workflow")
        let _ = teamWhy(Self.self)
        List {
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamWorkflowMessage") }
            if let page = model.state.page {
                Section("최근 확인한 상태") {
                    LabeledContent("진행 상태", value: workflowLabel(page.current.status)).accessibilityIdentifier("teamWorkflowCurrent")
                    LabeledContent("담당", value: memberName(page.current.assignee_account_id))
                    LabeledContent("우선순위", value: workflowLabel(page.current.priority))
                    if let next = page.current.next_action { Text("다음 행동: \(next)") }
                    if let target = page.current.duplicate_request_id { NavigationLink("대표 요청 보기") { TeamRequestDetailView(model: requests, requestID: target) }.disabled(model.state.busy || !model.state.storageReady) }
                    if !page.can_manage { Text("현재 권한으로 상태와 이력을 볼 수 있어요. 담당·상태 변경 권한은 별도로 확인해요.").font(.caption).foregroundStyle(.secondary) }
                }
            }
            if let draft = model.state.draft {
                Section("변경 제안") {
                    Picker("진행 상태", selection: Binding(get: { model.state.draft?.status ?? "submitted" }, set: { value in model.controller?.edit { $0.status = value; if value != "duplicate" { $0.duplicateID = nil } } })) {
                        ForEach(TeamWorkflowSnapshot.statuses, id: \.self) { Text(workflowLabel($0)).tag($0) }
                    }.disabled(!editable).accessibilityIdentifier("teamWorkflowState")
                    Picker("담당자", selection: Binding(get: { model.state.draft?.assignee ?? "" }, set: { value in model.controller?.edit { $0.assignee = value.isEmpty ? nil : value } })) {
                        Text("담당 미정").tag("")
                        ForEach(model.state.members) { Text($0.display_name ?? "이름 미등록 · \($0.account_id)").tag($0.account_id) }
                        if let existing = draft.assignee, !model.state.members.contains(where: { $0.account_id == existing }) { Text("기존 담당 · 권한 재확인 필요").tag(existing) }
                    }.disabled(!editable).accessibilityIdentifier("teamWorkflowAssignee")
                    Picker("우선순위", selection: Binding(get: { model.state.draft?.priority ?? "unclassified" }, set: { value in model.controller?.edit { $0.priority = value } })) {
                        ForEach(TeamWorkflowSnapshot.priorities, id: \.self) { Text(workflowLabel($0)).tag($0) }
                    }.disabled(!editable)
                    if draft.status == "duplicate" {
                        Picker("대표 요청", selection: Binding(get: { model.state.draft?.duplicateID ?? "" }, set: { value in model.controller?.edit { $0.duplicateID = value.isEmpty ? nil : value } })) {
                            Text("선택해 주세요").tag("")
                            ForEach(model.state.targets) { Text(String($0.body.prefix(80))).tag($0.id) }
                            if let old = draft.duplicateID, !model.state.targets.contains(where: { $0.id == old }) { Text("기존 연결 · 상세 확인 필요").tag(old) }
                        }.disabled(!editable)
                        if model.state.targetCursor != nil { Button("이전 요청 더 불러오기") { Task { await model.controller?.moreTargets() } }.disabled(model.state.busy) }
                    }
                    if draft.phase != .received {
                    TextField("다음 행동", text: Binding(get: { model.state.draft?.nextAction ?? "" }, set: { value in model.controller?.edit { $0.nextAction = value } }), axis: .vertical)
                        .disabled(!editable).accessibilityIdentifier("teamWorkflowNext")
                    TextEditor(text: Binding(get: { model.state.draft?.reason ?? "" }, set: { value in model.controller?.edit { $0.reason = value } }))
                        .frame(minHeight: 100).disabled(!editable).accessibilityLabel("변경 사유").accessibilityIdentifier("teamWorkflowReason")
                    Text("변경 사유 \(draft.reason.utf16.count)/2,000단위").font(.caption)
                    if !draft.reason.isEmpty || !draft.nextAction.isEmpty { ShareLink("변경 내용 내보내기", item: "\(draft.reason)\n\(draft.nextAction)") }
                    }
                    if draft.phase == .received {
                        Text("변경이 서버에 저장됐어요.").accessibilityIdentifier("teamWorkflowReceipt")
                        Button("다음 변경 작성") { model.controller?.newChange() }.disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true)
                    } else if draft.phase == .conflict {
                        Button("최신 상태 기준으로 제안 유지") { model.controller?.rebase() }.disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true).accessibilityIdentifier("teamWorkflowRebase")
                    } else {
                        Button(draft.phase == .uncertain ? "같은 번호로 다시 저장" : "변경 저장") { confirmSend = true }
                            .disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true || (try? draft.payload()) == nil).accessibilityIdentifier("teamWorkflowSend")
                    }
                }
            }
            Section("변경 이력") {
                ForEach(model.state.events, id: \.revision) { event in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(workflowLabel(event.status)) · \(workflowLabel(event.priority))")
                        Text(event.reason ?? (event.retention?.confirmsPurge(at: event.redacted_at) == true ? TeamContentRetention.purgedMarker : event.retention?.hidden == true ? event.retention!.marker : "작성자 삭제로 내용이 제거됐어요."))
                        Text("변경 \(event.revision) · \(event.actor_account_id ?? "삭제된 계정")").font(.caption).foregroundStyle(.secondary)
                        if let time = event.created_at { Text(Date(timeIntervalSince1970: time / 1000), style: .date).font(.caption) }
                    }
                }
                if model.state.page?.next_cursor != nil { Button("변경 이력 더 보기") { Task { await model.controller?.moreHistory() } }.disabled(model.state.busy) }
            }
        }.navigationTitle("담당·진행 상태").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(!model.state.storageReady || model.state.busy)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                ToolbarItem(placement: .topBarLeading) { if !model.state.storageReady || model.state.busy { Button("뒤로") { if !model.state.storageReady { confirmLeave = true } else { dismiss() } } } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
            .teamPublishCount(model.objectWillChange, "pub.workflow")
            .alert("담당·상태 변경을 저장할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("저장") { Task { await model.controller?.submit() } }
            } message: { Text("표시된 담당자·상태·다음 행동과 변경 사유를 내부 팀의 이력에 남겨요.") }
            .alert("저장되지 않은 변경이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 변경 내용을 내보내 주세요.") }
    }
}

@MainActor final class TeamGitHubPresentation: ObservableObject {
    @Published var state = TeamGitHubController.View()
    var controller: TeamGitHubController?
    var makeObservations: (() -> TeamGitHubObservationPresentation)?
}
struct TeamGitHubScreen: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TeamGitHubPresentation
    @State private var confirmSend = false
    @State private var confirmLeave = false
    init(make: @escaping @MainActor () -> TeamGitHubPresentation) { _model = StateObject(wrappedValue: make()) }
    init(model: TeamGitHubPresentation) { self.init(make: { model }) }
    private var editable: Bool { model.state.page?.can_manage == true && model.state.page?.retention?.hidden != true && model.state.draft?.phase == .draft && !model.state.busy && model.state.storageReady }
    private func field(_ title: String, _ key: WritableKeyPath<TeamGitHubDraft, String>, _ identifier: String) -> some View {
        TextField(title, text: Binding(get: { model.state.draft?[keyPath: key] ?? "" }, set: { value in model.controller?.edit { $0[keyPath: key] = value } }))
            .textInputAutocapitalization(.never).autocorrectionDisabled().disabled(!editable).accessibilityIdentifier(identifier)
    }
    private func evidence(_ event: TeamGitHubEvent, history: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(event.repo) · 이슈 #\(event.issue_number)").accessibilityIdentifier(history ? "teamGitHubHistoryEntry\(event.revision)" : "teamGitHubCurrentIssue")
            Text("연결 관계: 운영자 지정 · 변경 \(event.revision)").font(.caption)
            if let proof = event.evidence {
                Link("확인된 이슈 열기", destination: URL(string: proof.issue.url)!)
                Text("연결 당시 상태: \(proof.issue.state == "closed" ? "닫힘" : "열림")")
                if let pull = proof.pull { Link("PR #\(pull.number) · \(pull.merged ? "병합됨" : "미병합")", destination: URL(string: pull.url)!) }
                if let sha = proof.source_sha { Text("소스 SHA: \(sha)").font(.caption).textSelection(.enabled) }
                if let ci = proof.ci { Link("CI 실행 \(ci.run_id) · 시도 \(ci.attempt) · \(ci.conclusion)", destination: URL(string: ci.url)!) }
            } else { Text(event.retention?.confirmsPurge(at: event.redacted_at) == true ? TeamContentRetention.purgedMarker : event.retention?.hidden == true ? event.retention!.marker : "작성자 삭제로 연결 근거가 제거됐어요.") }
            if let reason = event.reason { Text(reason).textSelection(.enabled) }
            Text("연결 당시 확인: \(Date(timeIntervalSince1970: event.verified_at / 1000).formatted())").font(.caption)
            Text("TestFlight 제공 여부·사용자 해결 확인: 확인되지 않음").font(.caption).foregroundStyle(.secondary)
        }
    }
    var body: some View {
        let _ = teamRenderCount("body.github")
        let _ = teamWhy(Self.self)
        List {
#if DEBUG
            if TeamEntryFixture.enabled { TimelineView(.periodic(from: .now, by: 0.25)) { _ in Text("Synthetic GitHub trace").font(.caption2).accessibilityIdentifier("teamGitHubTrace").accessibilityValue(TeamEntryFixture.trace) } }
#endif

            if let make = model.makeObservations {
                NavigationLink { TeamGitHubObservationScreen(make: { teamRenderCount("make.observations"); return make() }) } label: { Text("최근 확인한 GitHub 상태") }
                    .disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamGitHubObservationsOpen")
            }
            if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamGitHubMessage") }
            if let page = model.state.page {
                Section("연결 당시 기록") {
                    if let event = page.current { evidence(event).accessibilityIdentifier("teamGitHubCurrent") }
                    else { Text("아직 연결된 GitHub 근거가 없어요.") }
                    if !page.can_manage { Text("조회 권한으로 보고 있어요. 연결 변경은 권한이 있는 운영자만 할 수 있어요.").accessibilityIdentifier("teamGitHubReadOnly") }
                }
            }
            if let draft = model.state.draft {
                Section {
                    if draft.phase != .received {
                    field("기존 이슈 번호", \.issue, "teamGitHubIssue")
                    Toggle("PR·소스·CI 근거 함께 확인", isOn: Binding(get: { model.state.draft?.lineage ?? false }, set: { value in model.controller?.edit { $0.lineage = value } })).disabled(!editable)
                    if draft.lineage {
                        field("PR 번호", \.pull, "teamGitHubPull")
                        field("40자리 소스 SHA", \.sourceSHA, "teamGitHubSHA")
                        field("CI 실행 번호", \.run, "teamGitHubRun")
                        field("CI 시도 번호", \.attempt, "teamGitHubAttempt")
                    }
                    TextEditor(text: Binding(get: { model.state.draft?.reason ?? "" }, set: { value in model.controller?.edit { $0.reason = value } }))
                        .frame(minHeight: 100).disabled(!editable).accessibilityLabel("연결 사유").accessibilityIdentifier("teamGitHubReason")
                    Text("연결 사유 \(draft.reason.utf16.count)/2,000단위").font(.caption)
                    ShareLink("연결 초안 내보내기", item: "이슈: \(draft.issue)\nPR: \(draft.pull)\nSHA: \(draft.sourceSHA)\nCI: \(draft.run), 시도: \(draft.attempt)\n\(draft.reason)")
                    }
                    if draft.phase == .received {
                        Text("연결이 저장됐어요.").accessibilityIdentifier("teamGitHubReceipt")
                        Button("다음 연결 작성") { model.controller?.newChange() }.disabled(!model.state.storageReady || model.state.busy || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true)
                    } else if draft.phase == .conflict {
                        Button("최신 상태 기준으로 제안 유지") { model.controller?.rebase() }.disabled(!model.state.storageReady || model.state.busy || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true)
                    } else {
                        Button(draft.phase == .uncertain ? "같은 번호로 다시 확인·저장" : "연결 확인·저장") { confirmSend = true }
                            .disabled(model.state.busy || !model.state.storageReady || model.state.page?.can_manage != true || model.state.page?.retention?.hidden == true || (try? draft.payload()) == nil).accessibilityIdentifier("teamGitHubSend")
                    }
                } header: { Text("기존 GitHub 기록 연결") } footer: { Text("제품 저장소는 서버에서 정해요. 새 공개 이슈를 만들지 않으며, 요청 원문과 연결 사유를 GitHub에 보내지 않아요. CI 성공만으로 배포·설치·해결을 판단하지 않아요.") }
            }
            Section("연결 이력") {
                ForEach(model.state.events) { event in evidence(event, history: true) }
                if model.state.page?.next_cursor != nil { Button("연결 이력 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
            }
        }.navigationTitle("GitHub 연결 근거").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(!model.state.storageReady || model.state.busy)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy || !model.state.storageReady) }
                ToolbarItem(placement: .topBarLeading) { if !model.state.storageReady || model.state.busy { Button("뒤로") { if !model.state.storageReady { confirmLeave = true } else { dismiss() } }.accessibilityIdentifier("teamGitHubBack") } }
            }
            .interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
            .teamPublishCount(model.objectWillChange, "pub.github")
            .alert("GitHub 기록을 연결할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}; Button("저장") { Task { await model.controller?.submit() } }
            } message: { Text("서버가 GitHub 기록을 확인한 뒤 연결 사유와 함께 내부 이력에 저장해요. 공개 GitHub 글을 작성하지 않아요.") }
            .alert("저장되지 않은 연결 초안이 있어요", isPresented: $confirmLeave) {
                Button("계속 작성", role: .cancel) {}; Button("나가기", role: .destructive) { dismiss() }
            } message: { Text("나가기 전에 연결 초안을 내보내 주세요.") }
    }
}

@MainActor final class TeamDeliveryPresentation: ObservableObject {
    @Published var state = TeamDeliveryController.View()
    var controller: TeamDeliveryController?
}
private struct TeamDeliveryScreen: View {
    @StateObject private var model: TeamDeliveryPresentation
    init(make: @escaping @MainActor () -> TeamDeliveryPresentation) { _model = StateObject(wrappedValue: make()) }
    private func date(_ time: Double) -> String { Date(timeIntervalSince1970: time / 1000).formatted(date: .abbreviated, time: .shortened) }
    @ViewBuilder private func record(_ event: TeamDeliveryEvent, now: Date) -> some View {
        if let proof = event.evidence {
            Text("버전 \(proof.package.version) · 빌드 \(proof.package.build)").font(.headline).accessibilityIdentifier("teamDeliveryBuild\(event.revision)")
            Text(proof.isFresh(at: now) ? "확인한 시각: \(date(proof.observed_at)) · 유효: \(date(proof.valid_until))까지" : "확인한 시각: \(date(proof.observed_at)) · 현재 상태는 다시 확인이 필요해요.").font(.caption).accessibilityIdentifier("teamDeliveryFreshness\(event.revision)")
            Text(event.availability == "group_available" && proof.groupAvailable(at: now) ? "내부 테스트 그룹에 빌드가 제공된 것을 확인했어요." : "현재 그룹의 설치 가능 여부는 확인되지 않았어요.").accessibilityIdentifier("teamDeliveryAvailability\(event.revision)")
            Text("내 계정의 초대·참여 자격, 이 기기의 설치, 작성자의 해결 확인은 아직 확인되지 않았어요.").font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("teamDeliveryUnobserved\(event.revision)")
            if let instructions = event.instructions { Text(instructions).textSelection(.enabled).accessibilityIdentifier("teamDeliveryInstructions\(event.revision)") }
            Link("빌드 확인 기록 보기", destination: proof.observationURL)
        } else { Text(event.retention?.confirmsPurge(at: event.redacted_at) == true ? TeamContentRetention.purgedMarker : event.retention?.hidden == true ? event.retention!.marker : "작성자 삭제로 배포 근거가 제거됐어요.") }
    }
    var body: some View {
        let _ = teamRenderCount("body.delivery")
        let _ = teamWhy(Self.self)
        TimelineView(.periodic(from: .now, by: 1)) { context in
            List {
                if !model.state.message.isEmpty { Text(model.state.message).accessibilityIdentifier("teamDeliveryUnavailable") }
                if let page = model.state.page {
                    Section("최근 배포 기록") {
                        if let current = page.current { record(current, now: context.date) }
                        else { Text("아직 연결된 배포 기록이 없어요.").accessibilityIdentifier("teamDeliveryEmpty") }
                    }
                    if !model.state.events.isEmpty {
                        Section("이전 기록") {
                            ForEach(model.state.events.filter { $0.id != page.current?.id }) { event in
                                VStack(alignment: .leading, spacing: 8) { record(event, now: context.date) }
                            }
                            if page.next_cursor != nil { Button("기록 더 보기") { Task { await model.controller?.more() } }.disabled(model.state.busy) }
                        }
                    }
                }
                if model.state.busy { ProgressView().accessibilityLabel("배포 근거 불러오는 중") }
            }
        }.navigationTitle("배포 버전과 확인 안내").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("새로고침") { Task { await model.controller?.open() } }.disabled(model.state.busy) }
            .task { await model.controller?.open() }
            .onDisappear { model.controller?.invalidate() }
            .teamPublishCount(model.objectWillChange, "pub.delivery")
    }
}
