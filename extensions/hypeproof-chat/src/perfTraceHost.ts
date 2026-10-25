// CGP-AGENT-R-030 / REQ-STUDIO-PERF-TRACE: host side of the "느려요 기록" performance trace.
//
// Flow: a modal with the consent text and one "기록 시작" button (the only way to start) → a red
// status bar pill "기록 중 · 멈추기" while recording → stop (pill, command, ten-minute limit, or the
// seat stops qualifying) → the trace is written to this machine's extension storage → optional note →
// review modal with the file size and two buttons, "내 컴퓨터에만 두기" (first, default) and "보내기".
// Only 보내기, then the shared outbound confirmation, sends anything: a summary through the existing
// problem-report route (POST {proxy}/report, `attachments.perf_trace`), the note as its description.

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TOKEN_KEY } from "./extension";
import { confirmOutbound } from "./outboundConsentHost";
import { postProblemReport, reportRecipient } from "./reportProblemHelpers";
import { contentBytes, type OutboundConfirmation } from "./outboundConsent";
import {
  PerfTraceRecorder, perfTraceSummary, cleanNote, perfTraceReview,
  PERF_TRACE_MAX_MS, PERF_TRACE_SAMPLE_MS, PERF_TRACE_START_QUESTION, PERF_TRACE_START_BUTTON, PERF_TRACE_CONSENT_LINES,
  PERF_TRACE_PILL, PERF_TRACE_PILL_LABEL, PERF_TRACE_NOTE_PROMPT, PERF_TRACE_KEEP, PERF_TRACE_SEND, PERF_TRACE_NOTE_NONE,
  PERF_TRACE_SEAT_REFUSED, PERF_TRACE_ALREADY, PERF_TRACE_KEPT, PERF_TRACE_TITLE,
  type PerfTrace, type PerfTraceStop,
} from "./perfTrace";

export const PERF_TRACE_SETTING = "performanceTraceEnabled";
export const PERF_TRACE_DIR = "perf-traces";

export interface PerfTraceDeps {
  context: Pick<vscode.ExtensionContext, "secrets" | "globalStorageUri"> & { extension?: { packageJSON?: { version?: unknown } } };
  /** True only for an instructor or a resolved non-minor seat (perfTraceSeatAllowed). Read at start, on every sample and at send. */
  seatAllowed: () => boolean;
  getProfileId: () => string | undefined;
  /** Test seams. */
  now?: () => number;
  memory?: () => { rss: number; heapUsed: number };
  setTimer?: (fn: () => void, ms: number) => { dispose(): void };
  confirm?: OutboundConfirmation;
  fetchImpl?: typeof fetch;
}

interface Active { recorder: PerfTraceRecorder; startedAt: number; lastTick: number; timer: { dispose(): void }; pill: vscode.StatusBarItem }

export class PerfTraceController {
  private active: Active | undefined;
  private busy = false;
  constructor(private readonly deps: PerfTraceDeps) {}

  get recording(): boolean { return !!this.active; }
  private now(): number { return (this.deps.now ?? Date.now)(); }
  private enabled(): boolean { return vscode.workspace.getConfiguration("hypeproofChat").get<boolean>(PERF_TRACE_SETTING, false) === true; }

  /** Every host message passes here; only stream lifecycle messages of the recording reach the recorder. */
  observe(msg: { type?: unknown; streamId?: unknown; failed?: unknown }): void {
    this.active?.recorder.observe(msg, this.now());
  }

  async start(): Promise<boolean> {
    if (this.active) { void vscode.window.showInformationMessage(PERF_TRACE_ALREADY); return false; }
    if (this.busy || !this.enabled()) return false;
    if (!this.deps.seatAllowed()) { void vscode.window.showInformationMessage(PERF_TRACE_SEAT_REFUSED); return false; }
    this.busy = true;
    try {
      const answer = await vscode.window.showInformationMessage(PERF_TRACE_START_QUESTION, { modal: true, detail: PERF_TRACE_CONSENT_LINES.join("\n") }, PERF_TRACE_START_BUTTON);
      // Only the button starts. The seat is checked again: it may have changed while the dialog was open.
      if (answer !== PERF_TRACE_START_BUTTON || this.active || !this.enabled() || !this.deps.seatAllowed()) return false;
      const startedAt = this.now();
      const pill = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10000);
      pill.text = PERF_TRACE_PILL;
      pill.tooltip = PERF_TRACE_PILL_LABEL;
      pill.accessibilityInformation = { label: PERF_TRACE_PILL_LABEL, role: "button" };
      pill.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      pill.command = "hypeproof-chat.stopPerformanceTrace";
      pill.show();
      const recorder = new PerfTraceRecorder(startedAt);
      const timer = (this.deps.setTimer ?? defaultTimer)(() => this.tick(), PERF_TRACE_SAMPLE_MS);
      this.active = { recorder, startedAt, lastTick: startedAt, timer, pill };
      this.tick();
      return true;
    } finally {
      this.busy = false;
    }
  }

  private tick(): void {
    const a = this.active;
    if (!a) return;
    const now = this.now();
    if (!this.enabled() || !this.deps.seatAllowed()) { void this.stop("seat"); return; }
    const mem = (this.deps.memory ?? (() => process.memoryUsage()))();
    // Event-loop lag: how late this tick ran against its schedule (0 for the first sample).
    const lag = now === a.startedAt ? 0 : Math.max(0, now - a.lastTick - PERF_TRACE_SAMPLE_MS);
    a.lastTick = now;
    a.recorder.sample(now, mem.rss, mem.heapUsed, lag);
    if (now - a.startedAt >= PERF_TRACE_MAX_MS) void this.stop("limit");
  }

  /** Stops, writes the local file, asks for the optional note and offers keep (default) or send. Returns the file path. */
  async stop(by: PerfTraceStop = "learner"): Promise<string | undefined> {
    const a = this.active;
    if (!a) return undefined;
    this.active = undefined;
    a.timer.dispose(); a.pill.hide(); a.pill.dispose();
    // A new start waits until this file is written and the learner has chosen keep or send.
    this.busy = true;
    try { return await this.finishStop(a, by); }
    catch (err) { void vscode.window.showWarningMessage(`느려요 기록을 저장하지 못했어요: ${err instanceof Error ? err.message : String(err)}. 아무것도 보내지 않았어요.`); return undefined; }
    finally { this.busy = false; }
  }

  private async finishStop(a: Active, by: PerfTraceStop): Promise<string> {
    const version = this.deps.context.extension?.packageJSON?.version;
    const trace = a.recorder.finish(this.now(), by, { studioVersion: typeof version === "string" ? version : "unknown", os: `${os.platform()}-${os.release()}-${os.arch()}` });
    const file = path.join(this.deps.context.globalStorageUri.fsPath, PERF_TRACE_DIR, `trace-${new Date(a.startedAt).toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(trace, null, 2), { mode: 0o600 });
    const rawNote = await vscode.window.showInputBox({ title: PERF_TRACE_TITLE, prompt: PERF_TRACE_NOTE_PROMPT, ignoreFocusOut: true, validateInput: (v) => (Array.from(v ?? "").length > 1000 ? "1000자 이하로 줄여 주세요." : null) });
    const note = cleanNote(rawNote);
    if (note) { trace.note = note; await fs.promises.writeFile(file, JSON.stringify(trace, null, 2), { mode: 0o600 }); }
    const bytes = (await fs.promises.stat(file)).size;
    const review = perfTraceReview(bytes, by);
    // A seat that no longer qualifies is not offered a send it would refuse.
    const canSend = this.enabled() && this.deps.seatAllowed();
    const choice = canSend
      ? await vscode.window.showInformationMessage(review.message, { modal: true, detail: review.detail }, PERF_TRACE_KEEP, PERF_TRACE_SEND)
      : await vscode.window.showInformationMessage(review.message, { modal: true, detail: PERF_TRACE_KEPT }, PERF_TRACE_KEEP);
    if (choice === PERF_TRACE_SEND) await this.send(trace);
    else void vscode.window.showInformationMessage(PERF_TRACE_KEPT);
    return file;
  }

  /** The shared outbound confirmation lists recipient, items and sizes of the frozen body; anything but approval sends nothing. */
  private async send(trace: PerfTrace): Promise<boolean> {
    if (!this.enabled() || !this.deps.seatAllowed()) { void vscode.window.showInformationMessage(`${PERF_TRACE_SEAT_REFUSED} ${PERF_TRACE_KEPT}`); return false; }
    const version = this.deps.context.extension?.packageJSON?.version;
    const body = {
      description: trace.note || PERF_TRACE_NOTE_NONE,
      profile_id: this.deps.getProfileId(),
      include_recent_turns: false,
      attachments: { kind: "perf_trace", studio_version: typeof version === "string" ? version : "unknown", os: trace.os, ts_client: new Date(this.now()).toISOString(), perf_trace: perfTraceSummary(trace) },
    };
    const frozen = JSON.stringify(body);
    const sent = JSON.parse(frozen) as typeof body;
    const proxyUrl = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    const items = [
      { name: trace.note ? "내가 쓴 메모" : "메모 없음 표시", bytes: contentBytes(JSON.stringify(sent.description)) },
      { name: "느려요 기록 요약 (걸린 시간·멈칫한 시간·메모리)", bytes: contentBytes(JSON.stringify(sent.attachments.perf_trace)) },
      { name: "앱 정보 (버전·운영체제·프로필)", bytes: contentBytes(JSON.stringify({ profile_id: sent.profile_id, kind: sent.attachments.kind, studio_version: sent.attachments.studio_version, os: sent.attachments.os, ts_client: sent.attachments.ts_client })) },
    ];
    const ok = await (this.deps.confirm ?? confirmOutbound)({ recipient: reportRecipient(proxyUrl), items });
    if (!ok) { void vscode.window.showInformationMessage(PERF_TRACE_KEPT); return false; }
    const token = await this.deps.context.secrets.get(TOKEN_KEY);
    const result = await postProblemReport(proxyUrl, frozen, token, this.deps.fetchImpl ?? fetch);
    if (result.ok) void vscode.window.showInformationMessage(`느려요 기록을 보냈어요. 접수 번호: ${result.reportId}. 이 컴퓨터의 기록은 그대로 남아 있어요.`);
    else void vscode.window.showWarningMessage(`느려요 기록을 보내지 못했어요: ${result.reason} 기록은 이 컴퓨터에 그대로 있어요.`);
    return result.ok;
  }

  dispose(): void {
    const a = this.active;
    this.active = undefined;
    if (a) { a.timer.dispose(); a.pill.dispose(); }
  }
}

function defaultTimer(fn: () => void, ms: number): { dispose(): void } {
  const id = setInterval(fn, ms);
  return { dispose: () => clearInterval(id) };
}
