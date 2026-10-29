// Issue #64: in-Studio bug report. Since REQ-STUDIO-PROBLEM-REPORT (2026-10-29) the chat panel's in-panel form is
// the primary surface; this QuickInput cascade remains only as the fallback when no chat panel can be shown. Collects a short description + auto-
// attached metadata (request_id, jti hash, profile, version, OS) and POSTs
// to the Worker's /v1/report endpoint. Discord-first triage on the receiving
// side — see worker/src/routes/report.ts.
//
// Public API:
//   runReportProblemCommand(deps): runs the QuickInput cascade and submits.
//
// Design notes:
//   - Uses VS Code's built-in QuickInput primitives instead of a webview
//     panel. Simpler, no new bridge messages, no DOM. The "modal" in the
//     spec is achieved by a 3-step QuickInput sequence:
//        1. describe what went wrong (multi-line allowed)
//        2. include recent turns? (QuickPick yes/no)
//        3. contact (optional input)
//     Then a Progress notification while submitting.
//   - jti is hashed locally via SubtleCrypto so we never send the full token,
//     never persist it, and the Discord card / D1 row only ever see 16 hex.
//   - Failure modes: network error / 4xx — surface a Warning toast with the
//     error reason. The whole point of this feature is that THIS path stays
//     working even when the chat path is broken, so it must never throw to
//     the user.

import * as vscode from "vscode";
import * as os from "os";
import { TOKEN_KEY } from "./extension";
import { ChatMessage } from "./protocol";
import { reportContactPlaceholder, reportContactPrompt, reportReceipt, type SeatAudience } from "./seatVocabulary";
import {
  hashJti,
  extractJtiUnverified,
  sanitizeRecentTurns,
  confirmProblemReport,
  postProblemReport,
} from "./reportProblemHelpers";
import { confirmOutbound } from "./outboundConsentHost";

export interface ReportProblemDeps {
  context: vscode.ExtensionContext;
  /**
   * Last response/error's request_id, if any. ChatPanelProvider stashes this
   * after every streamError/streamEnd so a report immediately after a failure
   * picks the right one up.
   */
  getLastRequestId: () => string | undefined;
  /**
   * Currently-resolved profile_id (from cached profile), if any.
   */
  getProfileId: () => string | undefined;
  /**
   * Most recent N chat turns (already in workspaceState). The caller pages
   * the array — we only ever take the tail.
   */
  getRecentTurns: () => ChatMessage[];
  /** Trial diagnosis D3 — solo seats are not told to wait for "Jay". Omitted → classroom copy. */
  getAudience?: () => SeatAudience;
}

// Fallback only. The installed extension reports its own package version (#751 R1):
// a constant here drifted to 0.1.2 while the package was 0.1.5.
const REPORT_VERSION_UNKNOWN = "unknown";

/**
 * Build the metadata blob attached to every report. Each item is itemized
 * so the confirmation can show what's being sent. The only opt-in is
 * recent_turns, which is PII-bearing. Shared with the in-panel form
 * (REQ-STUDIO-PROBLEM-REPORT, chatPanelProvider.openProblemReport).
 */
export function collectReportMetadata(context: vscode.ExtensionContext, ids: { requestId?: string; profileId?: string; jtiHash?: string }): Record<string, unknown> {
  return {
    studio_version: typeof context.extension?.packageJSON?.version === "string" ? context.extension.packageJSON.version : REPORT_VERSION_UNKNOWN,
    extension: "hypeproof-chat",
    os: `${os.platform()}-${os.release()}-${os.arch()}`,
    locale: vscode.env.language,
    vscode_version: vscode.version,
    profile_id: ids.profileId,
    jti_hash: ids.jtiHash,
    last_request_id: ids.requestId,
    ts_client: new Date().toISOString(),
  };
}

function collectMetadata(deps: ReportProblemDeps, jtiHash?: string): Record<string, unknown> {
  return collectReportMetadata(deps.context, { requestId: deps.getLastRequestId(), profileId: deps.getProfileId(), jtiHash });
}

export async function runReportProblemCommand(deps: ReportProblemDeps): Promise<void> {
  const audience: SeatAudience = deps.getAudience?.() ?? "classroom";
  // Step 1: description.
  const description = await vscode.window.showInputBox({
    title: "문제 신고하기",
    prompt: "무엇이 안 되나요? (10자 이상)",
    placeHolder: "예: 토큰 붙여넣었는데 '틀리다'고 떠요. 다섯 번 다시 해봐도 같은 메시지.",
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v || v.trim().length < 10) return "10자 이상 적어주세요.";
      if (v.length > 5000) return "5000자 이하로 줄여주세요.";
      return null;
    },
  });
  if (description === undefined || description.trim().length === 0) return;

  // Step 2: include recent turns? (default: no)
  const includeChoice = await vscode.window.showQuickPick(
    [
      { label: "$(eye-closed) 최근 대화는 포함하지 않기", value: false, description: "기본값 — 내가 쓴 설명·연락처와 앱 정보만 보내요" },
      { label: "$(eye) 최근 3개 대화 포함", value: true, description: "개인정보가 포함될 수 있어요. 신고에 도움이 될 때만 선택" },
    ],
    {
      title: "최근 대화 첨부 여부",
      placeHolder: "신고에 최근 대화 3개를 함께 보낼까요?",
      ignoreFocusOut: true,
    },
  );
  if (includeChoice === undefined) return;
  const includeRecentTurns = includeChoice.value;

  // Step 3: contact (optional).
  const contact = await vscode.window.showInputBox({
    title: "연락처 (선택)",
    prompt: reportContactPrompt(audience),
    placeHolder: reportContactPlaceholder(audience),
    ignoreFocusOut: true,
    validateInput: (v) => (v && v.length > 200 ? "200자 이하로 줄여주세요." : null),
  });
  // contact === undefined means user cancelled with Escape; treat as cancel.
  if (contact === undefined) return;

  // Build the exact body first. REQ-KNOW-09: the learner sees recipient, items and sizes and confirms before it leaves;
  // closing the dialog sends nothing. The progress toast appears only after that.
  const token = await deps.context.secrets.get(TOKEN_KEY);
  let jtiHash: string | undefined;
  if (token) {
    const jti = extractJtiUnverified(token);
    if (jti) jtiHash = await hashJti(jti);
  }
  const attachments = collectMetadata(deps, jtiHash);
  const recentTurns = includeRecentTurns ? sanitizeRecentTurns(deps.getRecentTurns()) : undefined;
  const body: Record<string, unknown> = {
    description: description.trim(),
    request_id: deps.getLastRequestId(),
    profile_id: deps.getProfileId(),
    contact: contact.trim() || undefined,
    include_recent_turns: includeRecentTurns,
    recent_turns: recentTurns,
    attachments,
  };
  const cfg = vscode.workspace.getConfiguration("hypeproofChat");
  const proxyUrl = cfg.get<string>("proxyUrl", "https://api.hypeproof-ai.xyz/v1");

  const frozen = await confirmProblemReport(proxyUrl, body, confirmOutbound);
  if (frozen === null) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "문제 신고 접수 중…", cancellable: false },
    async () => {
      const result = await postProblemReport(proxyUrl, frozen, token);
      if (result.ok) {
        vscode.window.showInformationMessage(reportReceipt(audience, result.reportId));
      } else {
        vscode.window.showWarningMessage(`신고 전송 실패: ${result.reason}`);
      }
    },
  );
}

// Exposed for tests. Pure functions only — keep DOM/VS Code APIs out so
// these can run under node --experimental-strip-types.
export const __testing = {
  hashJti,
  extractJtiUnverified,
  sanitizeRecentTurns,
};
