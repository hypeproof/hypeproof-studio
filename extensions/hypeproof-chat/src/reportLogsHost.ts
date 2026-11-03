import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { COACH_LOG_HEADER, COACH_LOG_TAIL_BYTES, LOG_SCAN_BYTES, LOG_TAIL_BYTES, collapseLogNoise, logTail, redactLog } from "./reportLogs.ts";

/**
 * REQ-STUDIO-REPORT-LOGS — this window's log files, found from the extension's own log folder so the paths hold on
 * macOS and Windows alike: `<logs>/<session>/window<N>/exthost/<extension id>` is `context.logUri`, so
 * `../exthost.log` and `../../renderer.log` are the extension host and renderer logs of the same window.
 */
export function sessionLogPaths(extensionLogDir: string): { renderer: string; exthost: string } {
  const exthostDir = path.dirname(extensionLogDir);
  return { exthost: path.join(exthostDir, "exthost.log"), renderer: path.join(path.dirname(exthostDir), "renderer.log") };
}

/**
 * The last `max` bytes of a file after its repeated noise is collapsed (#3426), decoded and redacted; undefined when
 * it cannot be read. Reads at most LOG_SCAN_BYTES from the end, never the whole file.
 */
export async function readLogTail(file: string, home = os.homedir(), max = LOG_TAIL_BYTES): Promise<string | undefined> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, "r");
    const { size } = await handle.stat();
    const want = Math.min(size, Math.max(LOG_SCAN_BYTES, max + 1024));
    const buf = Buffer.alloc(want);
    await handle.read(buf, 0, want, size - want);
    let text = buf.toString("utf8");
    // Started mid-file: drop the partial first line.
    if (want < size) { const nl = text.indexOf("\n"); if (nl >= 0) text = text.slice(nl + 1); }
    const collapsed = collapseLogNoise(text);
    // A shorter scan window than the file is a cut even when the collapsed text fits.
    const tail = logTail(collapsed, max);
    return redactLog(want < size && tail === collapsed ? `[앞부분 생략]\n${tail}` : tail, home);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** #3426 — the coach output channel block appended to exthost_log: collapsed, tail-bounded, redacted. "" when empty. */
export function coachLogBlock(coachLog: string | undefined, home = os.homedir()): string {
  if (!coachLog || !coachLog.trim()) return "";
  return `\n${COACH_LOG_HEADER}\n${redactLog(logTail(collapseLogNoise(coachLog), COACH_LOG_TAIL_BYTES), home)}`;
}

export function logsAvailable(extensionLogDir: string | undefined, coachLog?: string): boolean {
  if (coachLog && coachLog.trim()) return true;
  if (!extensionLogDir) return false;
  const p = sessionLogPaths(extensionLogDir);
  return fs.existsSync(p.renderer) || fs.existsSync(p.exthost);
}

/**
 * renderer.log and exthost.log tails; the coach output channel (#3426) rides at the end of exthost_log inside the same
 * LOG_TAIL_BYTES budget, because the Service accepts only these two log fields.
 */
export async function readSessionLogs(extensionLogDir: string | undefined, coachLog?: string, home = os.homedir()): Promise<{ renderer_log?: string; exthost_log?: string }> {
  const coach = coachLogBlock(coachLog, home);
  const p = extensionLogDir ? sessionLogPaths(extensionLogDir) : undefined;
  const exthostMax = LOG_TAIL_BYTES - Buffer.byteLength(coach);
  const [renderer_log, exthost] = p ? await Promise.all([readLogTail(p.renderer, home), readLogTail(p.exthost, home, exthostMax)]) : [undefined, undefined];
  const exthost_log = exthost || coach ? `${exthost ?? ""}${coach}` : undefined;
  return { ...(renderer_log ? { renderer_log } : {}), ...(exthost_log ? { exthost_log } : {}) };
}
