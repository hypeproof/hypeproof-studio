// CGP-KNOW-R-011 (REQ-KNOW-20) — opening a 내 작품 row reveals the file: an HTML page in Studio's preview,
// anything else in a Studio editor tab (VS Code's own text or binary editor). Never the OS default app or an
// external browser. The host opens only a path the current provenance inventory listed, and only after the same
// canonical check the thumbnail uses, run again at open time: the file may have been replaced since the list.

import * as fs from "fs";
import * as path from "path";

/** One request names one listed path; longer is not a work-folder path the list shows. */
export const OPEN_PATH_MAX = 1024;

/** C0 controls, DEL, U+2028/U+2029 and a backslash. */
const controlOrSlash = (c: string): boolean => { const n = c.codePointAt(0) ?? 0; return n < 0x20 || n === 0x7f || n === 0x2028 || n === 0x2029 || c === "\\"; };

export type MyWorksOpenVia = "preview" | "image" | "text";
export type MyWorksOpenTarget = { ok: true; absPath: string; via: MyWorksOpenVia } | { ok: false };

/** The images VS Code's built-in image preview shows (an SVG there is an image: its scripts do not run). */
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
/**
 * How a listed file opens (verify-r027): an HTML page in Studio's preview; an allowlisted image in VS Code's built-in
 * image preview; everything else in the default text editor (`vscode.openWith(uri, "default")`), so no custom editor
 * or notebook renderer is ever chosen. A notebook (`.ipynb`) and a `.code-workspace` file open as text; a binary
 * (`.vsix`) gets the text editor's binary notice.
 */
export function myWorksOpenVia(relPath: string): MyWorksOpenVia {
  if (/\.html?$/i.test(relPath)) return "preview";
  return IMAGE.test(relPath) ? "image" : "text";
}
/** The VS Code editor id each way opens with (`vscode.openWith`); the preview goes through Studio's own command. */
export const MY_WORKS_EDITOR: Record<Exclude<MyWorksOpenVia, "preview">, string> = { image: "imagePreview.previewEditor", text: "default" };

/**
 * The file to open for a 내 작품 row, or `{ ok: false }`. `relPath` must be a path the current inventory listed
 * (`listed`). Refused: anything not listed, absolute paths, `..`, empty or dot segments, control characters, a
 * backslash, a link anywhere on the way, a folder or other non-file, a hard-linked file (a second name for a file
 * that may live outside the folder), and a path whose components changed while it was checked. Never throws.
 */
export function resolveMyWorksFile(workspaceRoot: string | undefined, relPath: unknown, listed: ReadonlySet<string>): MyWorksOpenTarget {
  const no = { ok: false } as const;
  if (!workspaceRoot || typeof relPath !== "string" || !relPath || relPath.length > OPEN_PATH_MAX) return no;
  if (!listed.has(relPath)) return no;
  if ([...relPath].some(controlOrSlash) || relPath.startsWith("/")) return no;
  const parts = relPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return no;
  // Windows: a colon names an alternate data stream (or a drive), and a trailing dot or space is dropped by the
  // file system, so the name would not be the file that was checked (verify-r027). Refused everywhere.
  if (parts.some((part) => part.includes(":") || /[. ]$/.test(part))) return no;
  try {
    const root = fs.realpathSync(workspaceRoot);
    // Every component's identity; the walk runs twice so a swap between the checks is caught.
    const walk = (): string[] | null => {
      const ids: string[] = [];
      let at = root;
      for (const part of parts) {
        at = path.join(at, part);
        const entry = fs.lstatSync(at);
        if (entry.isSymbolicLink()) return null;
        ids.push(`${entry.dev}:${entry.ino}`);
      }
      return ids;
    };
    const before = walk();
    if (!before) return no;
    const absPath = path.join(root, ...parts);
    const relative = path.relative(root, fs.realpathSync(absPath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return no;
    const stat = fs.lstatSync(absPath);
    if (!stat.isFile() || stat.nlink !== 1) return no;
    const after = walk();
    if (!after || after.join("/") !== before.join("/") || after[after.length - 1] !== `${stat.dev}:${stat.ino}`) return no;
    return { ok: true, absPath, via: myWorksOpenVia(relPath) };
  } catch {
    return no;
  }
}

/** The one line a refused open shows in the drawer. */
export const MY_WORKS_OPEN_REFUSED = "이 파일은 지금 열 수 없어요. 내 작품을 닫았다가 다시 열어 주세요.";
