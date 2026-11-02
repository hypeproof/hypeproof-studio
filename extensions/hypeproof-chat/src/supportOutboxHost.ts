import * as vscode from "vscode";
import * as path from "node:path";
import { accountLock } from "./accountLock";
import { SupportOutbox, type SupportItem, type SupportResult } from "./supportOutbox";
import { postProblemReport } from "./reportProblemHelpers";
import { ProblemTracker, isAutomaticProblem, problemDiagnostic, autoReportBody } from "./problemReport";
import { autoProblemReportEnabled, setAutomaticProblemSink } from "./problemReportHost";
const KEY = "hypeproof.supportOutbox.v1";
let active: SupportOutbox | undefined;

export function registerSupportOutbox(context: vscode.ExtensionContext): void {
  const outbox = new SupportOutbox({
    lock: accountLock(path.join(context.globalStorageUri.fsPath, "support-outbox")),
    async load() {
      const raw = await context.secrets.get(KEY);
      if (!raw) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error("Support storage unavailable");
      return value as SupportItem[];
    },
    async save(items) { await context.secrets.store(KEY, JSON.stringify(items)); },
  }, async item => {
    if (item.kind === "manual") return postProblemReport(item.endpoint, item.body, undefined);
    if (!autoProblemReportEnabled(context.globalState)) return { ok: false, reason: "자동 보고가 꺼졌어요.", httpStatus: 403 };
    try {
      const res = await fetch(item.endpoint.replace(/\/+$/, "") + "/problems/auto", {
        method: "POST", headers: { "content-type": "application/json" }, body: item.body,
        signal: AbortSignal.timeout(10000), redirect: "error",
      });
      return res.status === 204 ? { ok: true, reportId: item.id } : { ok: false, reason: `HTTP ${res.status}`, httpStatus: res.status };
    } catch { return { ok: false, reason: "네트워크에 연결하지 못했어요." }; }
  });
  active = outbox;
  const tracker = new ProblemTracker();
  context.subscriptions.push(setAutomaticProblemSink(facts => {
    if (!autoProblemReportEnabled(context.globalState) || !isAutomaticProblem(facts)) return;
    const diagnostic = problemDiagnostic(facts, { appVersion: context.extension.packageJSON.version, platform: process.platform, arch: process.arch });
    if (!tracker.note(diagnostic).send) return;
    const endpoint = vscode.workspace.getConfiguration("hypeproofChat").get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");
    void submitSupportReport(endpoint, JSON.stringify(autoReportBody(diagnostic)), "auto");
  }));
  const flush = async () => {
    try {
      for (const { result } of await outbox.flush(autoProblemReportEnabled(context.globalState))) {
        if (result.ok && result.reportId.startsWith("rep_")) void vscode.window.showInformationMessage(`보관한 도움 요청이 접수됐어요. 접수 번호: ${result.reportId}`);
      }
    } catch { /* Retain stored reports; reporting must not interrupt work. */ }
  };
  const timer = setInterval(() => void flush(), 60000);
  timer.unref();
  context.subscriptions.push({ dispose() { clearInterval(timer); if (active === outbox) active = undefined; } });
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.supportPending", async () => {
    const items = await outbox.list();
    if (!items.length) { void vscode.window.showInformationMessage("보관 중인 도움 요청이 없어요."); return; }
    const item = await vscode.window.showQuickPick(items.map(i => ({ label: `${i.kind === "manual" ? "도움 요청" : "자동 오류 정보"} · ${i.id}`, description: i.nextAt === Number.MAX_SAFE_INTEGER ? "자동 재전송 중지 — 확인 필요" : "전송 대기", item: i })), { title: "보관된 도움 요청" });
    if (!item) return;
    const action = await vscode.window.showQuickPick(["다시 보내기", "내용 복사", "보관함에서 삭제"], { title: "서버 접수는 보관함 삭제로 취소되지 않아요" });
    if (action === "다시 보내기") void vscode.window.showInformationMessage(supportResultText(await outbox.retry(item.item.id)));
    else if (action === "내용 복사") await vscode.env.clipboard.writeText(item.item.body);
    else if (action === "보관함에서 삭제") await outbox.remove(item.item.id);
  }));
  void flush();
}
export async function submitSupportReport(endpoint: string, frozen: string, kind: SupportItem["kind"] = "manual"): Promise<SupportResult> {
  if (!active) return { ok: false, reason: "신고 보관함을 열지 못했어요. 앱을 다시 열어 주세요." };
  try { return await active.enqueue(endpoint, frozen, kind); }
  catch { return { ok: false, reason: "신고를 기기에 저장하지 못했어요. 설명을 복사해 두고 다시 시도해 주세요." }; }
}
export function supportResultText(result: SupportResult): string {
  if (result.ok) return `도움 요청이 접수됐어요. 접수 번호: ${result.reportId}`;
  return "queued" in result ? (result.retryable
    ? `아직 접수를 확인하지 못했어요. 이 기기에 보관했고 연결되면 다시 보내요. 보관 번호: ${result.localId}`
    : `서버가 접수를 거절했어요. 보관된 도움 요청에서 확인해 주세요. ${result.reason} · 보관 번호: ${result.localId}`) : result.reason;
}
