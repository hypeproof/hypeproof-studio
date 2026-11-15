// CGP-KNOW-R-028 — the host-only half of the task memory switches: does a coach tool's path land in the activity's
// memory folder? Node-only (fs), so it lives apart from taskMemorySwitches.ts, which the webview imports for its copy and
// types (extension-dev rule: no Node imports reach webview-ui).
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A path as the file system will resolve it: the real path of its deepest existing ancestor (links followed), then the
 * rest of the segments. So `<root>/link/a.md` with `link -> .hypeproof/memory` lands inside the memory folder.
 */
export function canonicalPath(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** macOS (APFS default) and Windows compare names without case: `.HYPEPROOF/MEMORY` is the same folder there. */
export function foldsCase(platform: string = process.platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/** True when `target` is the memory folder or inside it, after links are resolved and case is folded where the OS does. */
export function insideFolder(folder: string, target: string, platform: string = process.platform): boolean {
  const fold = (p: string) => (foldsCase(platform) ? p.toLowerCase() : p);
  const rel = path.relative(fold(canonicalPath(folder)), fold(canonicalPath(target)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
