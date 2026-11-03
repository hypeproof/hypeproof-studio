// REQ-STUDIO-PREVIEW-RECOVERY (CGP-ART-R-009 / REQ-ART-09, DES-ART-09; extends #751 U4) — why the learner's
// preview cannot show a page, in one calm sentence with exactly one action. Pure: no vscode, no DOM, no
// network. Imported by the extension host (which measures the signals and runs the action) and by the
// webview (which adds navigator.onLine and draws the line).
//
// The cause comes from measured signals only: the live server's state for the tab's address, the HTTP
// status the page answered with, whether the page needs the network, and navigator.onLine. Error text is
// never read. Anything the signals do not pin down stays generic ("unknown") and claims no cause.

import { isLoopbackPreview, isTabOfServer, previewPagePath } from "./previewRecovery.ts";

/**
 * The live server, seen from one preview tab's address. "Off" is decided from the server's own state, never from a
 * slow answer:
 * - `running`: the address is on Studio's server, which is listening, and the page answered;
 * - `slow`: the address is on Studio's server, which is listening, but the page did not answer in time;
 * - `stopped`: Studio's server for that address is not listening (it closed or crashed), or the address is an old
 *   Studio port where nothing listens any more (the connection was refused);
 * - `other`: something else answers (or hangs) on a port our server used before. Its answers are not the learner's page.
 */
export type PreviewServerState = "running" | "slow" | "stopped" | "other";

/** What probing the page gave: an HTTP status, a refused connection (nothing listens on the port), or no answer in time. */
export type PreviewProbe = number | "refused" | "timeout";

/** Studio's preview server as the host sees it now: its address and whether its socket is listening. */
export interface LivePreviewState { base: string | undefined; listening: boolean }

export interface PreviewSignals {
  server: PreviewServerState;
  /** HTTP status the page answered with; null when nothing answered. */
  status: number | null;
  /** Path of the page in the tab ("/", "/game.html"). Only its file name is ever shown. */
  path: string;
  /** True when the page is not served from this computer. The learner's loopback preview never is. */
  needsNetwork: boolean;
}

export type PreviewCause = "server_down" | "not_found" | "slow" | "offline" | "unknown";
export type PreviewRecoveryAction = "restart_preview" | "show_files" | "retry";

/** One action per cause. The host and the webview read the same table. */
export const PREVIEW_RECOVERY_ACTIONS: Record<PreviewCause, { action: PreviewRecoveryAction; label: string }> = {
  server_down: { action: "restart_preview", label: "다시 켜기" },
  not_found: { action: "show_files", label: "파일 목록 보기" },
  slow: { action: "retry", label: "다시 시도" },
  offline: { action: "retry", label: "다시 시도" },
  unknown: { action: "retry", label: "다시 시도" },
};

export const PREVIEW_RECOVERY_COPY = {
  server_down: "미리보기 서버가 꺼져 있어요.",
  notFound: (file: string) => `${file} 파일이 없어서 페이지를 열 수 없어요.`,
  slow: "미리보기가 응답이 늦어요.",
  offline: "인터넷 연결이 끊겨서 미리보기를 열 수 없어요.",
  unknown: "미리보기를 열지 못했어요.",
  detailSummary: "자세히",
} as const;

/** The line after a press that did not run (refused for the state measured at press time) or that failed. */
export const PREVIEW_RECOVERY_NOTES = {
  refused: "지금 상태와 맞지 않아 실행하지 않았어요. 위 안내를 확인해 주세요.",
  refusedGone: "미리보기 상태가 바뀌어서 실행하지 않았어요.",
  failed: "실행하지 못했어요. 잠시 뒤 다시 눌러 주세요.",
} as const;
export type PreviewRecoveryResult = "done" | "refused" | "failed";

const MAX_NAME = 60;

/** The file name of the page, never its folders: "/a/b/menu.html?x" → "menu.html"; a folder → its index.html. */
export function previewPageFileName(path: string): string {
  let bare = (path || "/").split(/[?#]/)[0];
  // Decode first, then cut: an encoded separator (%2F, %5C) must not smuggle folders into the line.
  try { bare = decodeURIComponent(bare); } catch { /* shown as it is */ }
  const last = /[\\/]$/.test(bare) ? "" : bare.slice(Math.max(bare.lastIndexOf("/"), bare.lastIndexOf("\\")) + 1);
  const name = last || "index.html";
  if (name.length <= MAX_NAME) return name;
  // Shorten in the middle and keep the extension, so the name still matches the file list.
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  const stem = name.slice(0, name.length - ext.length);
  const room = MAX_NAME - ext.length - 1;
  const head = Math.ceil(room * 0.6), tail = room - head;
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}

/**
 * Server state for a tab. On Studio's current address the server's own socket state decides "off"; an answer that
 * did not come in time is `slow`, never `stopped`. On an old address only a refused connection (nothing listens on
 * that port) is `stopped`; anything else there is another process.
 */
export function previewServerState(tabUrl: string, live: LivePreviewState, probe: PreviewProbe): PreviewServerState {
  if (isTabOfServer(tabUrl, live.base)) {
    if (!live.listening) return "stopped";
    return typeof probe === "number" ? "running" : probe === "timeout" ? "slow" : "stopped";
  }
  return probe === "refused" ? "stopped" : "other";
}

/** The signals for one tab: the server's state now (`live`) and the page's own answer (`probe`). A probe that throws counts as a timeout. */
export async function measurePreview(tabUrl: string, live: () => LivePreviewState, probe: (url: string) => Promise<PreviewProbe>): Promise<PreviewSignals> {
  let answer: PreviewProbe;
  try { answer = await probe(tabUrl); } catch { answer = "timeout"; }
  // Read the server state after the probe: a server that closed while we waited is off, one that is still listening is not.
  const server = previewServerState(tabUrl, live(), answer);
  return { server, status: typeof answer === "number" ? answer : null, path: previewPagePath(tabUrl), needsNetwork: !isLoopbackPreview(tabUrl) };
}

/** Node-side probe: HTTP status, "refused" for ECONNREFUSED (nothing listens), "timeout" for anything else (no answer in time). */
export async function probePreviewPage(url: string, timeoutMs = 3000): Promise<PreviewProbe> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" })).status;
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    return code === "ECONNREFUSED" ? "refused" : "timeout";
  }
}

const answered = (status: number | null) => status !== null && status >= 200 && status < 300;

/** The cause, or null when the page answered and there is nothing to say. `online` is navigator.onLine. */
export function previewCause(s: PreviewSignals | null, online: boolean): PreviewCause | null {
  if (!s) return null;
  if (s.needsNetwork && !online) return "offline";
  if (answered(s.status)) return null;
  if (s.server === "stopped") return "server_down";
  if (s.server === "slow") return "slow";
  if (s.server === "running" && s.status === 404) return "not_found";
  return "unknown";
}

export interface PreviewRecoveryView {
  cause: PreviewCause;
  text: string;
  action: PreviewRecoveryAction;
  actionLabel: string;
  /** Technical code under 자세히 (DES-ART-09): never in the cause line. */
  detail: string;
}

export function previewRecoveryView(s: PreviewSignals | null, online: boolean): PreviewRecoveryView | null {
  const cause = previewCause(s, online);
  if (!cause || !s) return null;
  const text = cause === "server_down" ? PREVIEW_RECOVERY_COPY.server_down
    : cause === "not_found" ? PREVIEW_RECOVERY_COPY.notFound(previewPageFileName(s.path))
    : cause === "slow" ? PREVIEW_RECOVERY_COPY.slow
    : cause === "offline" ? PREVIEW_RECOVERY_COPY.offline
    : PREVIEW_RECOVERY_COPY.unknown;
  const detail = cause === "offline" ? "offline" : cause === "slow" ? "no response in time" : s.status === null ? "no response" : `HTTP ${s.status}`;
  const { action, label } = PREVIEW_RECOVERY_ACTIONS[cause];
  return { cause, text, action, actionLabel: label, detail };
}

/**
 * Whether the host still accepts `action` for the state it measures now. The host cannot see navigator.onLine,
 * so it judges as if online, and also accepts 다시 시도 for a page that needs the network (it may be offline).
 */
export function previewActionFits(action: unknown, s: PreviewSignals | null): boolean {
  if (typeof action !== "string") return false;
  const cause = previewCause(s, true);
  if (cause && PREVIEW_RECOVERY_ACTIONS[cause].action === action) return true;
  return action === "retry" && !!s?.needsNetwork;
}

export interface PreviewRecoveryDeps {
  /** Measure the learner's preview now; null when no preview tab is open. */
  signals(): Promise<PreviewSignals | null>;
  /** The existing start path (startLivePreview): start or reuse the server and show the page in one tab. False = it did not run. */
  restart(): Promise<boolean>;
  /** The existing file list (Explorer). */
  showFiles(): Promise<void>;
  /** Load the tab's page again. */
  retry(): Promise<void>;
  /** The state after the press; `result` says whether the press ran, so the webview can re-enable its button. */
  post(s: PreviewSignals | null, result: PreviewRecoveryResult): Promise<void>;
}

/**
 * Runs the one action that fits the state measured right now; refuses anything else. Always posts exactly once, with
 * the result (also when measuring or the action throws), so the webview's button never stays disabled.
 */
export async function runPreviewRecoveryAction(action: unknown, deps: PreviewRecoveryDeps): Promise<PreviewRecoveryResult> {
  let result: PreviewRecoveryResult = "failed";
  try {
    const before = await deps.signals();
    if (!previewActionFits(action, before)) { result = "refused"; return result; }
    let ran = true;
    if (action === "restart_preview") ran = await deps.restart();
    else if (action === "show_files") await deps.showFiles();
    else await deps.retry();
    result = ran ? "done" : "failed";
    return result;
  } catch {
    result = "failed";
    return result;
  } finally {
    let after: PreviewSignals | null = null;
    try { after = await deps.signals(); } catch { after = null; }
    try { await deps.post(after, result); } catch { /* the webview is gone */ }
  }
}

/** The line shown after a press that did not run; null after one that ran. */
export function previewRecoveryNote(result: PreviewRecoveryResult | undefined, s: PreviewSignals | null): string | null {
  if (result === "failed") return PREVIEW_RECOVERY_NOTES.failed;
  if (result === "refused") return previewCause(s, true) ? PREVIEW_RECOVERY_NOTES.refused : PREVIEW_RECOVERY_NOTES.refusedGone;
  return null;
}
