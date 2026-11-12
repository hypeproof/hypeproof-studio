// REQ-STUDIO-DOCTOR — the host side of Studio 진단. The checks, copy and sanitizers are in studioDoctor.ts (pure).
//
// When it runs (Jay 2026-11-03: learners do not run a doctor themselves):
// - once, about 60 s after startup, in the background (never during activation);
// - after a failure the panel recorded (error card / failed turn), debounced;
// - before a problem report is sent, for the 「진단 결과 첨부」 attachment.
// Silent when everything passes. A failing check shows ONE quiet line in the chat (role=status, with its safe fix
// button if any), at most once per check per day, and sends one content-free `doctor_<code>` signal through the
// level-1 problem-signal path when the learner's auto-report switch is on. The command 「HypeProof Chat: 진단 실행」
// and the error card's 「진단하기」 show the whole list for support.
import * as os from "node:os";
import * as vscode from "vscode";
import { openMacPrivacySettings } from "./macPrivacySettings";
import { freeBytesAt, lowDiskThresholdBytes, LOW_DISK_SETTING } from "./lowDisk";
import { problemDiagnostic, postAutoReport } from "./problemReport";
import { autoProblemReportEnabled } from "./problemReportHost";
import { fetchProfileResult } from "./proxyClient";
import { resolveSdkBinaryForHost } from "./sdkCoach";
import { SDK_INSTALL_PAGE } from "./sdkRequiredHelpers";
import {
  doctorNotice, doctorRows, doctorSignalFacts, doctorSummary, dueChecks, isProtectedWindowsFolder, markShown,
  probeService, probeWorkFolder, runBinaryVersion, runDoctor, DOCTOR_COMMAND_TITLE,
  type DoctorDayLog, type DoctorFixId, type DoctorNotice, type DoctorResult,
} from "./studioDoctor";

const LINE_LOG_KEY = "hypeproof.doctor.lineShown";
const SIGNAL_LOG_KEY = "hypeproof.doctor.signalSent";
const STARTUP_DELAY_MS = 60_000;
const FAILURE_DEBOUNCE_MS = 5_000;

/** What the doctor needs from the chat panel; kept narrow so this file does not import the panel. */
export interface DoctorPanel {
  workFolder(): string | undefined;
  sdkRequired(): boolean;
  hasActiveStream(): boolean;
  refreshProfile(): Promise<boolean>;
  /** The REQ-M46 seed offer; false when the seed is switched off for this seat. */
  reseedSdk(): Promise<boolean>;
  showNotice(notice: DoctorNotice | null): Promise<boolean | void>;
  token(): Promise<string | undefined>;
}

export class StudioDoctorHost implements vscode.Disposable {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private running: Promise<DoctorResult> | undefined;
  private sdkRunCache = new Map<string, "ok" | "failed" | "timeout">();
  private failureTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly panel: DoctorPanel) {}

  /** Background run after startup; never awaited by activation. */
  scheduleStartup(delayMs = STARTUP_DELAY_MS): void {
    const t = setTimeout(() => { this.timers.delete(t); void this.autoRun(); }, delayMs);
    // Never keeps a host (or a test process) alive on its own.
    t.unref?.();
    this.timers.add(t);
  }

  /** After a recorded failure; several failures in a burst run the doctor once. */
  noteFailure(): void {
    if (this.failureTimer) return;
    this.failureTimer = setTimeout(() => { this.failureTimer = undefined; void this.autoRun(); }, FAILURE_DEBOUNCE_MS);
    this.failureTimer.unref?.();
  }

  private proxyUrl(): string {
    return vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
  }

  /** One doctor run at a time; a second caller shares the first's result. */
  run(): Promise<DoctorResult> {
    if (this.running) return this.running;
    const proxy = this.proxyUrl();
    const run = runDoctor({
      sdk: async () => {
        const resolution = resolveSdkBinaryForHost({ settingPath: vscode.workspace.getConfiguration("hypeproofChat").get<string>("sdkBinaryPath") });
        const required = this.panel.sdkRequired();
        if (!resolution.available) return { available: false, run: "skipped", required };
        if (!resolution.path) return { available: true, source: resolution.source, run: "skipped", required };
        // A binary that answered once this session is not spawned again on every failure.
        let ran = this.sdkRunCache.get(resolution.path);
        if (ran !== "ok") { ran = await runBinaryVersion(resolution.path); this.sdkRunCache.set(resolution.path, ran); }
        return { available: true, source: resolution.source, run: ran, required };
      },
      service: () => probeService(proxy),
      login: async (reachable) => {
        const token = await this.panel.token();
        if (!token) return { hasToken: false, now: Date.now() };
        if (!reachable) return { hasToken: true, now: Date.now() };
        const r = await fetchProfileResult({ token, proxyUrl: proxy });
        return {
          hasToken: true, now: Date.now(),
          profile: r.ok ? { ok: true, trial: r.profile.trial ?? null, pass: r.profile.pass ?? null } : { ok: false, reason: r.failure.reason, code: r.failure.code },
        };
      },
      workFolder: async () => {
        const folder = this.panel.workFolder();
        if (!folder) return { folder: false, platform: process.platform, probe: "ok" };
        return { folder: true, platform: process.platform, probe: await probeWorkFolder(folder), protectedWindowsFolder: process.platform === "win32" && isProtectedWindowsFolder(folder, os.homedir()) };
      },
      disk: async () => {
        const threshold = lowDiskThresholdBytes(vscode.workspace.getConfiguration("hypeproofChat").get<unknown>(LOW_DISK_SETTING));
        return { free: await freeBytesAt(this.panel.workFolder() ?? os.homedir()), threshold };
      },
    });
    this.running = run;
    void run.finally(() => { if (this.running === run) this.running = undefined; });
    return run;
  }

  /** Automatic run: silent on success; one quiet line and content-free signals for what is newly failing today. */
  async autoRun(): Promise<DoctorResult | null> {
    if (this.disposed) return null;
    try {
      const r = await this.run();
      const now = Date.now();
      const lineLog = this.context.globalState.get<DoctorDayLog>(LINE_LOG_KEY) ?? {};
      const line = dueChecks(r, lineLog, now, true)[0];
      if (line && (await this.panel.showNotice(doctorNotice(line, `doctor-${now.toString(36)}`))) !== false)
        await this.context.globalState.update(LINE_LOG_KEY, markShown(lineLog, [line], now));
      await this.sendSignals(r, now);
      return r;
    } catch (err) {
      console.warn("[doctor] automatic run failed", err);
      return null;
    }
  }

  /** Counts only: one signal per failing check per day, through the learner's level-1 switch. */
  private async sendSignals(r: DoctorResult, now: number): Promise<void> {
    if (!autoProblemReportEnabled(this.context.globalState)) return;
    const log = this.context.globalState.get<DoctorDayLog>(SIGNAL_LOG_KEY) ?? {};
    const due = dueChecks(r, log, now, false);
    if (!due.length) return;
    const version = this.context.extension?.packageJSON?.version;
    const env = { appVersion: typeof version === "string" ? version : "unknown", platform: process.platform, arch: process.arch };
    for (const facts of doctorSignalFacts(due)) void postAutoReport(this.proxyUrl(), problemDiagnostic({ ...facts, status: 0 }, env));
    await this.context.globalState.update(SIGNAL_LOG_KEY, markShown(log, due, now));
  }

  /** Support view (command palette, error card 「진단하기」): every check with ✓/⚠ and its fix. */
  async showList(): Promise<void> {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Studio 진단 중…" }, () => this.run());
    const rows = doctorRows(r);
    type Item = vscode.QuickPickItem & { fix?: DoctorFixId };
    const items: Item[] = rows.map((row) => ({
      label: `${row.mark} ${row.label}`,
      detail: row.fix ? `${row.text} — 누르면: ${row.fix.label}` : row.text,
      ...(row.fix ? { fix: row.fix.id } : {}),
    }));
    const pick = await vscode.window.showQuickPick(items, { title: `${DOCTOR_COMMAND_TITLE} — ${doctorSummary(r)}`, placeHolder: "고칠 수 있는 항목을 누르면 바로 고쳐요", matchOnDetail: true });
    if (pick?.fix) await this.fix(pick.fix);
  }

  /** The safe fixes. None changes an OS security setting; each reuses an existing action. */
  async fix(id: DoctorFixId): Promise<void> {
    switch (id) {
      case "reseed_sdk":
        // A fixed Studio page (the SDK_MISSING_NOTICE address), never a URL from the webview.
        if (!(await this.panel.reseedSdk())) await vscode.env.openExternal(vscode.Uri.parse(`https://${SDK_INSTALL_PAGE}`));
        this.sdkRunCache.clear();
        return;
      case "reconnect":
        if (this.panel.hasActiveStream()) { void vscode.window.showInformationMessage("지금 하는 작업이 끝난 뒤에 다시 연결할 수 있어요."); return; }
        void vscode.window.showInformationMessage((await this.panel.refreshProfile()) ? "다시 연결했어요." : "아직 연결되지 않았어요. 잠시 뒤 다시 해 보세요.");
        return;
      case "mac_privacy": await openMacPrivacySettings(); return;
      case "open_folder": {
        const folder = this.panel.workFolder();
        if (folder) await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder));
        return;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.failureTimer) clearTimeout(this.failureTimer);
  }
}
