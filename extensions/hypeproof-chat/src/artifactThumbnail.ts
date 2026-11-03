// CGP-KNOW-D-011 (DES-KNOW-20) — the 내 작품 drawer's image thumbnails. The host reads one small
// raster image from inside the work folder and hands the webview a data: URI, so the webview never
// loads a file or a network address itself. Anything else (HTML, SVG, a link, a large or unreadable
// file) gets the type glyph instead.

import * as fs from "fs";
import * as path from "path";

/** Larger images keep the type glyph: the bytes travel over postMessage. */
export const THUMBNAIL_MAX_BYTES = 512 * 1024;
/** One request names one listed path; longer is not a work-folder path the list shows. */
export const THUMBNAIL_PATH_MAX = 1024;

type ThumbnailMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const BY_EXTENSION: Record<string, ThumbnailMime> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** The image kind the file's own bytes claim; the extension alone never decides. */
export function sniffImage(bytes: Uint8Array): ThumbnailMime | null {
  const at = (offset: number, ...values: number[]) => values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** C0 controls, DEL, U+2028/U+2029 and a backslash. */
const controlOrSlash = (c: string): boolean => { const n = c.codePointAt(0) ?? 0; return n < 0x20 || n === 0x7f || n === 0x2028 || n === 0x2029 || c === "\\"; };

/** Does the list offer a thumbnail for this path at all (by name); the bytes still decide. */
export function thumbnailCandidate(relPath: string): boolean {
  return Object.hasOwn(BY_EXTENSION, path.posix.extname(relPath).toLowerCase());
}

/**
 * A data: URI for one image inside `workspaceRoot`, or null. `relPath` is a list path ("a/b.png",
 * forward slashes). Refused: absolute paths, `..`, empty or dot segments, control characters, a
 * link anywhere on the way, a non-file, a file over THUMBNAIL_MAX_BYTES, bytes that are not the
 * image kind the extension names, and a file that changed while it was read. Never throws.
 */
export function readWorkspaceThumbnail(workspaceRoot: string | undefined, relPath: unknown): string | null {
  if (!workspaceRoot || typeof relPath !== "string" || !relPath || relPath.length > THUMBNAIL_PATH_MAX) return null;
  // Control characters, line and paragraph separators and backslashes never name a listed file.
  if ([...relPath].some(controlOrSlash) || relPath.startsWith("/")) return null;
  const parts = relPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  const expected = BY_EXTENSION[path.posix.extname(relPath).toLowerCase()];
  if (!expected) return null;
  let fd: number | undefined;
  try {
    const root = fs.realpathSync(workspaceRoot);
    // Every component's identity, so a folder swapped for a link after this walk is caught below.
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
    if (!before) return null;
    const segment = path.join(root, ...parts);
    const relative = path.relative(root, fs.realpathSync(segment));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    fd = fs.openSync(segment, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = fs.fstatSync(fd);
    // A hard link is a second name for a file that may live outside the folder.
    if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0 || stat.size > THUMBNAIL_MAX_BYTES) return null;
    const bytes = fs.readFileSync(fd);
    // The opened file must be the walked one: same components, no link, same file as the descriptor.
    const after = walk();
    if (!after || after.join("/") !== before.join("/") || after[after.length - 1] !== `${stat.dev}:${stat.ino}` || bytes.length !== stat.size) return null;
    const mime = sniffImage(bytes);
    // A .png that is really a JPEG is still a picture; a .png that is HTML or SVG is not.
    if (!mime) return null;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

