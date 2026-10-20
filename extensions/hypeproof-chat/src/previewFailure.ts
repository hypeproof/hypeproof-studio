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
 * The live server, seen from one preview tab's address:
 * - `running`: the address is on the server running now, and it answered;
 * - `stopped`: the address belongs to a Studio preview server and nothing answers there now
 *   (the process is gone, or our server object no longer answers);
 * - `other`: something else answers on a port our server used before. Its answers are not the learner's page.
 */
export type PreviewServerState = "running" | "stopped" | "other";

export interface PreviewSignals {
  server: PreviewServerState;
  /** HTTP status the page answered with; null when nothing answered. */
  status: number | null;
  /** Path of the page in the tab ("/", "/game.html"). Only its file name is ever shown. */
  path: string;
  /** True when the page is not served from this computer. The learner's loopback preview never is. */
  needsNetwork: boolean;
}

export type PreviewCause = "server_down" | "not_found" | "offline" | "unknown";
export type PreviewRecoveryAction = "restart_preview" | "show_files" | "retry";

/** One action per cause. The host and the webview read the same table. */
export const PREVIEW_RECOVERY_ACTIONS: Record<PreviewCause, { action: PreviewRecoveryAction; label: string }> = {
  server_down: { action: "restart_preview", label: "다시 켜기" },
  not_found: { action: "show_files", label: "파일 목록 보기" },
  offline: { action: "retry", label: "다시 시도" },
  unknown: { action: "retry", label: "다시 시도" },
};

export const PREVIEW_RECOVERY_COPY = {
  server_down: "미리보기 서버가 꺼져 있어요.",
  notFound: (file: string) => `${file} 파일이 없어서 페이지를 열 수 없어요.`,
  offline: "인터넷 연결이 끊겨서 미리보기를 열 수 없어요.",
  unknown: "미리보기를 열지 못했어요.",
  detailSummary: "자세히",
} as const;

const MAX_NAME = 60;

/** The file name of the page, never its folders: "/a/b/menu.html?x" → "menu.html"; a folder → its index.html. */
export function previewPageFileName(path: string): string {
  const bare = (path || "/").split(/[?#]/)[0];
  const last = bare.endsWith("/") ? "" : bare.slice(bare.lastIndexOf("/") + 1);
  let name = last || "index.html";
  try { name = decodeURIComponent(name); } catch { /* shown as it is */ }
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** Server state for a tab from the process (which server runs now) and the answer (did anything respond). */
export function previewServerState(tabUrl: string, liveBase: string | undefined, status: number | null): PreviewServerState {
  if (isTabOfServer(tabUrl, liveBase)) return status === null ? "stopped" : "running";
  return status === null ? "stopped" : "other";
}

/** The signals for one tab: the page's own answer (`statusOf`: HTTP status, or null when nothing answered) and the server running now. */
export async function measurePreview(tabUrl: string, liveBase: string | undefined, statusOf: (url: string) => Promise<number | null>): Promise<PreviewSignals> {
  let status: number | null;
  try { status = await statusOf(tabUrl); } catch { status = null; }
  return { server: previewServerState(tabUrl, liveBase, status), status, path: previewPagePath(tabUrl), needsNetwork: !isLoopbackPreview(tabUrl) };
}

const answered = (status: number | null) => status !== null && status >= 200 && status < 300;

/** The cause, or null when the page answered and there is nothing to say. `online` is navigator.onLine. */
export function previewCause(s: PreviewSignals | null, online: boolean): PreviewCause | null {
  if (!s) return null;
  if (s.needsNetwork && !online) return "offline";
  if (answered(s.status)) return null;
  if (s.server === "stopped") return "server_down";
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
    : cause === "offline" ? PREVIEW_RECOVERY_COPY.offline
    : PREVIEW_RECOVERY_COPY.unknown;
  const detail = cause === "offline" ? "offline" : s.status === null ? "no response" : `HTTP ${s.status}`;
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
  /** The existing start path (startLivePreview): start or reuse the server and show the page in one tab. */
  restart(): Promise<void>;
  /** The existing file list (Explorer). */
  showFiles(): Promise<void>;
  /** Load the tab's page again. */
  retry(): Promise<void>;
  post(s: PreviewSignals | null): Promise<void>;
}

/** Runs the one action that fits the state measured right now; refuses anything else. Posts the fresh state either way. */
export async function runPreviewRecoveryAction(action: unknown, deps: PreviewRecoveryDeps): Promise<"done" | "refused"> {
  const before = await deps.signals();
  if (!previewActionFits(action, before)) { await deps.post(before); return "refused"; }
  if (action === "restart_preview") await deps.restart();
  else if (action === "show_files") await deps.showFiles();
  else await deps.retry();
  await deps.post(await deps.signals());
  return "done";
}
