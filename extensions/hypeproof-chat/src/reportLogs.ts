// REQ-STUDIO-REPORT-LOGS (Jay 2026-11-02): diagnostics a problem report carries without the person having to find
// renderer.log. Pure: no vscode or fs import, so test/report-logs.smoke.mjs runs it under plain Node.
//
//   - recent webview crashes (the error boundary's message and component stack), kept per machine and attached to the
//     next report automatically;
//   - on an explicit checkbox, the tail of this session's renderer.log and exthost.log.
// Everything that leaves goes through redactLog first: tokens, keys, emails and the home folder's user name.

/** globalState key of the kept crash records. */
export const WEBVIEW_ERRORS_KEY = "hypeproof.recentWebviewErrors";
/** Most recent webview crashes kept per machine. */
export const WEBVIEW_ERROR_LIMIT = 5;
/** Bytes kept from the end of each log file (after redaction the text can only get shorter or stay close). */
export const LOG_TAIL_BYTES = 64 * 1024;
const MESSAGE_MAX = 500;
const STACK_MAX = 3000;

export interface WebviewErrorRecord {
  at: string;
  message: string;
  componentStack: string;
  app_version: string;
  os: string;
}

export interface ReportLogs {
  webview_errors: WebviewErrorRecord[];
  renderer_log?: string;
  exthost_log?: string;
}

/**
 * Removes what could identify a person or open an account: bearer and API tokens, JWT-shaped strings, key=value
 * secrets, email addresses, and the user name inside home-folder paths (macOS, Windows, Linux, and the exact home
 * folder given). Applied to every log text and crash record before it is shown or sent.
 */
export function redactLog(text: string, home?: string): string {
  let out = text;
  if (home && home.length > 3) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped.replace(/\\\\/g, "[\\\\/]"), "gi"), "~");
  }
  return out
    .replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(?:hps|ghp|ghs|gho|ghu|github_pat|sk|sk-ant|xox[abp]|AKIA)[-_][A-Za-z0-9_-]{8,}/g, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?/g, "[redacted-jwt]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(/((?:token|key|secret|password|passwd|auth|authorization|code|jti)["']?\s*[:=]\s*["']?)[^\s"'&,;}]{4,}/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(\/Users\/|\/home\/|[A-Za-z]:\\Users\\|[A-Za-z]:\/Users\/)[^/\\\s"']+/gi, "$1<user>");
}

/** The last `max` bytes of a log, starting at a line boundary, with a note when it was cut. */
export function logTail(text: string, max = LOG_TAIL_BYTES): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= max) return text;
  let tail = new TextDecoder().decode(bytes.subarray(bytes.byteLength - max));
  const nl = tail.indexOf("\n");
  if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1);
  return `[앞부분 생략, 마지막 ${Math.round(max / 1024)} KB]\n${tail}`;
}

/** One crash as kept and sent: bounded and redacted. */
export function webviewErrorRecord(input: { message: unknown; componentStack: unknown }, env: { appVersion: string; os: string; home?: string; now?: number }): WebviewErrorRecord {
  const text = (v: unknown, max: number) => redactLog(typeof v === "string" ? v : "", env.home).slice(0, max);
  return {
    at: new Date(env.now ?? Date.now()).toISOString(),
    message: text(input.message, MESSAGE_MAX),
    componentStack: text(input.componentStack, STACK_MAX),
    app_version: env.appVersion,
    os: env.os,
  };
}

/** Newest last, at most WEBVIEW_ERROR_LIMIT. Malformed stored entries are dropped. */
export function rememberWebviewError(stored: unknown, record: WebviewErrorRecord): WebviewErrorRecord[] {
  return [...validWebviewErrors(stored), record].slice(-WEBVIEW_ERROR_LIMIT);
}

export function validWebviewErrors(stored: unknown): WebviewErrorRecord[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((e): e is WebviewErrorRecord => !!e && typeof e === "object"
    && ["at", "message", "componentStack", "app_version", "os"].every((k) => typeof (e as Record<string, unknown>)[k] === "string"))
    .slice(-WEBVIEW_ERROR_LIMIT);
}
