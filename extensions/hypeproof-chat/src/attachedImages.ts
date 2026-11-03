import { createHash } from "node:crypto";
import { attachmentReadFailure } from "./attachmentFailure.ts";
// Photos attached to a chat message as files (hype-dental D-028, issue #1611).
//
// A cohort with `input.image_files` takes photos dropped or pasted into the chat as files,
// not as images for the model to look at:
//   1. drop / paste  → the original bytes are kept in a temporary staging folder
//   2. send          → they move into `<workspace>/images/` under their own names, and the
//                      message gets an `[첨부한 사진]` list of those paths
//   3. removed or never sent → the staged file is deleted (on remove, on panel dispose,
//                      and leftovers from an earlier run on the next start)
// The coach uses the paths to put the photos on the page and opens a photo only when asked
// to copy its look (Service `_attached-images-contract.md`).
//
// This differs from #421 (pastedImages.ts) on purpose: that path downscales the image,
// shows it to the model, and saves it under `assets/` with a generated name. Here the
// participant's own file name is kept, because they refer to their photos by name.

import * as fs from "node:fs";
import * as path from "node:path";

/** Workspace folder for attached photos; design-craft puts its web copies in the same place. */
export const ATTACHED_IMAGE_DIR = "images";
/** One phone photo is 3–12 MB; anything larger is more likely a mistake than a photo. */
export const ATTACHED_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHED_IMAGE_MAX_COUNT = 10;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
};
const KNOWN_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif"]);

/** The extension a staged photo keeps; null when it is not a photo type we take. */
export function attachedImageExt(name: string, mime: string): string | null {
  const fromName = /\.([A-Za-z0-9]{2,5})$/.exec(name)?.[1]?.toLowerCase();
  if (fromName && KNOWN_EXTS.has(fromName)) return fromName;
  return EXT_BY_MIME[mime.toLowerCase()] ?? null;
}

/**
 * A file name that is safe to create in `images/` and still reads as the participant's own.
 * macOS hands file names over decomposed (NFD), so Korean names are recomposed (NFC);
 * otherwise "외관.jpg" in the message and on disk would not be the same string.
 */
export function safeAttachedImageName(name: string, ext: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).normalize("NFC");
  let stem = base.replace(/\.[A-Za-z0-9]{2,5}$/, "");
  stem = stem
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!stem) stem = "사진";
  if (stem.length > 60) stem = stem.slice(0, 60).trim();
  return `${stem}.${ext}`;
}

/** `외관.jpg` → `외관-2.jpg` … until `taken` says the name is free. Never overwrites. */
export function freeAttachedImageName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** The lines appended to the message. The Service contract reads exactly this shape. */
export function attachedImagesNote(relPaths: readonly string[]): string {
  if (relPaths.length === 0) return "";
  return ["[첨부한 사진]", ...relPaths.map((p) => `- ${p}`)].join("\n");
}

/** The tool line shown after a send that saved photos. */
export function attachedImagesSavedLabel(relPaths: readonly string[]): string {
  return relPaths.length === 1
    ? `사진을 저장했어요 — ${relPaths[0]}`
    : `사진 ${relPaths.length}장을 저장했어요 — ${relPaths.join(" · ")}`;
}

/** The tool line shown when some attached photos could not be saved. */
export function attachedImagesFailedLabel(count: number): string {
  return `사진 ${count}장을 작업 폴더에 저장하지 못했어요. 다시 끌어다 놓아 주세요.`;
}

/** Why a photo was not taken, in the participant's words; null = taken. */
export function attachedImageRefusal(args: { name: string; mime: string; bytes: number; alreadyStaged: number }): string | null {
  if (args.alreadyStaged >= ATTACHED_IMAGE_MAX_COUNT) return `사진은 한 번에 ${ATTACHED_IMAGE_MAX_COUNT}장까지 보낼 수 있어요.`;
  if (!attachedImageExt(args.name, args.mime)) return "사진 파일(jpg·png·heic 등)만 붙일 수 있어요.";
  if (args.bytes > ATTACHED_IMAGE_MAX_BYTES) return "사진이 너무 커요(25MB까지). 휴대폰에서 보통 크기로 다시 보내 주세요.";
  if (args.bytes === 0) return "빈 파일이에요. 사진을 다시 끌어다 놓아 주세요.";
  return null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `<tmp>/hypeproof-studio-staged-images/<pid>-<random>`: one folder per chat panel. */
export function stagingRootFor(tmpDir: string, pid: number, nonce: string): { rootParent: string; root: string } {
  const rootParent = path.join(tmpDir, "hypeproof-studio-staged-images");
  return { rootParent, root: path.join(rootParent, `${pid}-${nonce}`) };
}

interface Staged {
  file: string;
  name: string;
  saved?: { root: string; relative: string; hash: string };
}

/**
 * The temporary staging folder for one chat panel. Everything under `root` belongs to this
 * process; `rootParent` holds earlier runs' folders, which `purgeLeftovers` removes.
 */
export class ImageStaging {
  private readonly staged = new Map<string, Staged>();
  // Plain fields (no parameter properties) so the module loads under node --experimental-strip-types.
  private readonly rootParent: string;
  private readonly root: string;

  constructor(rootParent: string, root: string) {
    this.rootParent = rootParent;
    this.root = root;
  }

  /**
   * Delete staging folders an earlier run left behind (a crash, a killed window). Folder
   * names start with the owning process id; a folder whose process is still alive belongs
   * to another open Studio window and is left alone.
   */
  purgeLeftovers(isAlive: (pid: number) => boolean = processAlive): void {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(this.rootParent);
    } catch {
      return;
    }
    for (const e of entries) {
      const dir = path.join(this.rootParent, e);
      if (dir === this.root) continue;
      const pid = Number(/^(\d+)-/.exec(e)?.[1]);
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* another live window may still own it; it cleans up after itself */
      }
    }
  }

  has(id: string): boolean { return this.staged.has(id); }
  name(id: string): string { return this.staged.get(id)?.name ?? "사진"; }

  count(): number {
    return this.staged.size;
  }

  /** Keep the bytes until the message is sent or the photo is removed. */
  stage(id: string, name: string, bytes: Uint8Array): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("bad stage id");
    fs.mkdirSync(this.root, { recursive: true });
    const file = path.join(this.root, id);
    fs.writeFileSync(file, bytes);
    this.staged.set(id, { file, name });
  }

  discard(id: string): void {
    const s = this.staged.get(id);
    if (!s) return;
    this.staged.delete(id);
    try {
      fs.rmSync(s.file, { force: true });
    } catch {
      /* the folder goes on dispose */
    }
  }

  /**
   * Move the staged photos into `<cwd>/images/`, in the order given. Returns the workspace-
   * relative paths saved and how many could not be. Failed staged files remain; successful destinations are cached until discard.
   */
  commit(ids: readonly string[], cwd: string, directory: string = ATTACHED_IMAGE_DIR): { relPaths: string[]; failed: number; failures: { id: string; name: string; reason: string }[] } {
    if (!["images", "assets"].includes(directory)) throw new Error("Invalid attachment directory");
    const relPaths: string[] = [];
    let failed = 0;
    const failures: { id: string; name: string; reason: string }[] = [];
    for (const id of [...new Set(ids)]) {
      const s = this.staged.get(id);
      if (!s) {
        failed++; failures.push({ id, name: "사진", reason: "사진 준비 기록이 없어요. 이 사진을 다시 골라 주세요." });
        continue;
      }
      let destination: string | undefined;
      let destinationFd: number | undefined;
      let saved = false;
      try {
        const workspace = fs.realpathSync(cwd);
        if (s.saved) {
          const previous = path.join(workspace, s.saved.relative);
          if (s.saved.root !== workspace || fs.lstatSync(path.dirname(previous)).isSymbolicLink() || fs.lstatSync(previous).isSymbolicLink() || createHash("sha256").update(fs.readFileSync(previous)).digest("hex") !== s.saved.hash) throw new Error("Prepared photo changed");
          relPaths.push(s.saved.relative); continue;
        }
        const workspaceEntry = fs.statSync(workspace, { bigint: true });
        const dir = path.join(workspace, directory);
        fs.mkdirSync(dir, { recursive: true });
        const name = freeAttachedImageName(s.name, (n) => fs.existsSync(path.join(dir, n)));
        // Check the actual destination before exclusive creation. lstat also rejects
        // Windows directory junctions; a workspace opened through a link remains valid.
        const entry = fs.lstatSync(dir, { bigint: true });
        if (!entry.isDirectory() || entry.isSymbolicLink() || path.relative(workspace, fs.realpathSync(dir)) !== directory) {
          throw new Error("Photo destination is not a workspace directory");
        }
        destination = path.join(dir, name);
        // O_EXCL never replaces an existing file or final-component link. Opening
        // creates an empty placeholder only: no photo bytes precede validation.
        destinationFd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0));
        const opened = fs.fstatSync(destinationFd, { bigint: true });
        // Node has no portable directory-relative open/unlink. These rechecks
        // detect boundary substitutions, not atomic protection from all OS renames.
        const validate = (size: number) => {
          const rootNow = fs.statSync(workspace, { bigint: true });
          const parentNow = fs.lstatSync(dir, { bigint: true });
          const fileNow = fs.lstatSync(destination!, { bigint: true });
          const handleNow = fs.fstatSync(destinationFd!, { bigint: true });
          if (fs.realpathSync(cwd) !== workspace || rootNow.dev !== workspaceEntry.dev || rootNow.ino !== workspaceEntry.ino ||
              !parentNow.isDirectory() || parentNow.isSymbolicLink() || parentNow.dev !== entry.dev || parentNow.ino !== entry.ino || path.relative(workspace, fs.realpathSync(dir)) !== directory ||
              !handleNow.isFile() || handleNow.nlink !== 1n || handleNow.size !== BigInt(size) || handleNow.dev !== opened.dev || handleNow.ino !== opened.ino ||
              !fileNow.isFile() || fileNow.isSymbolicLink() || fileNow.dev !== opened.dev || fileNow.ino !== opened.ino || path.relative(destination!, fs.realpathSync(destination!)) !== "") {
            throw new Error("Photo destination changed during commit");
          }
        };
        validate(0);
        const bytes = fs.readFileSync(s.file);
        validate(0);
        fs.writeFileSync(destinationFd, bytes);
        validate(bytes.length);
        saved = true;
        relPaths.push(`${directory}/${name}`);
        s.saved = { root: workspace, relative: `${directory}/${name}`, hash: createHash("sha256").update(bytes).digest("hex") };
      } catch (error) {
        failed++; failures.push({ id, name: s.name, reason: attachmentReadFailure(error) });
      } finally {
        if (destinationFd !== undefined) {
          if (!saved) {
            // Only this exclusive creation is ours. Clear its bytes even if a
            // concurrent rename made its new name unknowable, then unlink only
            // when the current path still names that same opened inode.
            try { fs.ftruncateSync(destinationFd, 0); } catch { /* best effort */ }
            try {
              const own = fs.fstatSync(destinationFd, { bigint: true });
              const current = fs.lstatSync(destination!, { bigint: true });
              if (current.isFile() && !current.isSymbolicLink() && current.dev === own.dev && current.ino === own.ino) fs.unlinkSync(destination!);
            } catch { /* a renamed path must never authorize deleting another file */ }
          }
          fs.closeSync(destinationFd);
        }
        if (saved) { try { fs.rmSync(s.file, { force: true }); } catch { /* disposed later */ } }
      }
    }
    return { relPaths, failed, failures };
  }

  /** Remove everything this panel staged (panel closed, window closing). */
  dispose(): void {
    this.staged.clear();
    try {
      fs.rmSync(this.root, { recursive: true, force: true });
    } catch {
      /* best effort; purgeLeftovers on the next start */
    }
  }
}
