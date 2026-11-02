import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LOG_TAIL_BYTES, logTail, redactLog } from "./reportLogs.ts";

/**
 * REQ-STUDIO-REPORT-LOGS — this window's log files, found from the extension's own log folder so the paths hold on
 * macOS and Windows alike: `<logs>/<session>/window<N>/exthost/<extension id>` is `context.logUri`, so
 * `../exthost.log` and `../../renderer.log` are the extension host and renderer logs of the same window.
 */
export function sessionLogPaths(extensionLogDir: string): { renderer: string; exthost: string } {
  const exthostDir = path.dirname(extensionLogDir);
  return { exthost: path.join(exthostDir, "exthost.log"), renderer: path.join(path.dirname(exthostDir), "renderer.log") };
}

/** The last LOG_TAIL_BYTES of a file, decoded and redacted; undefined when it cannot be read. Reads only the tail. */
export async function readLogTail(file: string, home = os.homedir()): Promise<string | undefined> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, "r");
    const { size } = await handle.stat();
    // One extra KB so the tail can start at a line boundary.
    const want = Math.min(size, LOG_TAIL_BYTES + 1024);
    const buf = Buffer.alloc(want);
    await handle.read(buf, 0, want, size - want);
    const text = buf.toString("utf8");
    return redactLog(logTail(text, LOG_TAIL_BYTES), home);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function logsAvailable(extensionLogDir: string | undefined): boolean {
  if (!extensionLogDir) return false;
  const p = sessionLogPaths(extensionLogDir);
  return fs.existsSync(p.renderer) || fs.existsSync(p.exthost);
}

export async function readSessionLogs(extensionLogDir: string | undefined): Promise<{ renderer_log?: string; exthost_log?: string }> {
  if (!extensionLogDir) return {};
  const p = sessionLogPaths(extensionLogDir);
  const [renderer_log, exthost_log] = await Promise.all([readLogTail(p.renderer), readLogTail(p.exthost)]);
  return { ...(renderer_log ? { renderer_log } : {}), ...(exthost_log ? { exthost_log } : {}) };
}
