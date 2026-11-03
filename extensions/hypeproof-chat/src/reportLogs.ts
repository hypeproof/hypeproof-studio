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
/**
 * #3426 — how much of each log file is read before its noise is collapsed and the LOG_TAIL_BYTES tail is taken. A
 * Windows report's exthost.log tail was 542 copies of one i18n warning, so reading only the last 64 KB left nothing
 * useful once those were gone; scanning further back keeps the real lines that came before the flood.
 */
export const LOG_SCAN_BYTES = 2 * 1024 * 1024;
/** #3426 — the share of the exthost_log budget given to the HypeProof Coach output channel (where the coach's own errors go). */
export const COACH_LOG_TAIL_BYTES = 16 * 1024;
export const COACH_LOG_HEADER = "--- HypeProof Coach output channel (this session) ---";
/** A line whose text (timestamp aside) appears at least this often in the scanned part is kept once, with its count. */
export const FREQUENT_LINE_MIN = 20;
/**
 * Known noise kept once, with its count, however its varying part (a key, a path) differs. VS Code's extension host
 * logs the i18n line for every vscode.l10n.t() call of an extension that has no bundle for the display language.
 */
export const LOG_NOISE_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "i18n-default-string", re: /Using default string since no string found in i18n bundle that has the key:/ },
];
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

const TIMESTAMP_PREFIX = /^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?\]?\s*/;

/**
 * #3426 — collapses repeated lines before a tail is taken, so a flood of one message cannot push the useful lines out.
 * Known noise (LOG_NOISE_PATTERNS) and any unindented line seen FREQUENT_LINE_MIN times or more is kept only at its
 * last occurrence, prefixed with `[×N]`; a run of identical consecutive lines becomes its last line with `[×N]`.
 * Timestamps are ignored when comparing. Indented lines (stack frames) are never moved, only collapsed when
 * consecutive, so an error keeps its own stack. Pure and order-preserving otherwise; nothing is added but the counts.
 */
export function collapseLogNoise(text: string): string {
  const lines = text.split("\n");
  const key = (line: string): string => {
    const noise = LOG_NOISE_PATTERNS.find((p) => p.re.test(line));
    if (noise) return `noise:${noise.id}`;
    return `line:${line.replace(TIMESTAMP_PREFIX, "").trimEnd()}`;
  };
  const keys = lines.map(key);
  const movable = (i: number) => keys[i].startsWith("noise:") || (keys[i].length > 12 && !/^\s/.test(lines[i].replace(TIMESTAMP_PREFIX, "")));
  const count = new Map<string, number>();
  const last = new Map<string, number>();
  keys.forEach((k, i) => { if (movable(i)) { count.set(k, (count.get(k) ?? 0) + 1); last.set(k, i); } });
  const frequent = (k: string) => (k.startsWith("noise:") && (count.get(k) ?? 0) > 1) || (count.get(k) ?? 0) >= FREQUENT_LINE_MIN;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const k = keys[i];
    if (movable(i) && frequent(k)) {
      if (last.get(k) === i) out.push(`[×${count.get(k)}] ${lines[i]}`);
      continue;
    }
    let run = 1;
    while (i + run < lines.length && keys[i + run] === k && lines[i].trim() !== "" && !(movable(i + run) && frequent(keys[i + run]))) run++;
    out.push(run > 1 ? `[×${run}] ${lines[i + run - 1]}` : lines[i]);
    i += run - 1;
  }
  return out.join("\n");
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

/**
 * #3426 — this session's HypeProof Coach output channel lines, kept in memory (the channel has no file of its own we
 * can find reliably) so a problem report can carry the coach's own errors. Raw lines are bounded here and redacted
 * only when a report is assembled, like the log files.
 */
export class LogLineBuffer {
  private lines: string[] = [];
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly lineMax: number;
  constructor(maxBytes = LOG_TAIL_BYTES, lineMax = 4000) { this.maxBytes = maxBytes; this.lineMax = lineMax; }
  push(line: string, now = Date.now()): void {
    const entry = `${new Date(now).toISOString()} ${String(line).slice(0, this.lineMax)}`;
    this.lines.push(entry);
    this.bytes += entry.length + 1;
    while (this.bytes > this.maxBytes && this.lines.length > 1) this.bytes -= this.lines.shift()!.length + 1;
  }
  get size(): number { return this.lines.length; }
  text(): string { return this.lines.join("\n"); }
}
