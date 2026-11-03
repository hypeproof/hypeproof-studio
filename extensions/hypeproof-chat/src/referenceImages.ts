// Explicit re-reading is different from replaying thumbnails from chat history.
// The caller supplies only the active activity's history and its resolved workspace.
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { MODEL_IMAGE_MAX_COUNT, MODEL_IMAGE_MAX_DATA_URL_CHARS } from "./visionInput.ts";

export interface ReferenceImageAsset { path: string; mime: string; sha256: string; bytes: number }
export interface ReferenceImageFailure { path: string; reason: string }

/** Sniff supported vision formats from bytes, never a file extension or caller MIME. */
export function referenceImageMime(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Paths from host-produced image notes, without inspecting assistant prose or arbitrary files. */
export function imagePathsFromNotes(text: string): string[] {
  const blocks = [...text.matchAll(/<pasted-images>([\s\S]*?)<\/pasted-images>|\[첨부한 사진\]([^<]*?)(?=\n\n|$)/g)];
  const paths = blocks.flatMap((m) => (m[1] ?? m[2] ?? "").split(/\r?\n/)
    .map((line) => line.replace(/^\s*-?\s*/, "").trim())
    .filter((line) => /^(assets|images)\/[^\r\n<>]+\.(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(line)));
  return [...new Set(paths)];
}

/** Only an explicit prior-image request authorizes a fresh read; ordinary follow-ups do not. */
export function selectReferencedImagePaths(userText: string, history: readonly { role: string; content: string }[]): { requested: boolean; paths: string[] } {
  const eligible = [...new Set(history.filter((m) => m.role === "user").flatMap((m) => imagePathsFromNotes(m.content)))];
  const named = eligible.filter((p) => userText.includes(p) || userText.includes(path.basename(p)));
  const previous = /(?:이전|아까|방금|첨부한|붙여넣은|올린|위의?|그)\s*(?:참고\s*)?(?:이미지|사진|스크린샷)|(?:previous|earlier|attached|pasted)\s+(?:image|photo|screenshot)/i.test(userText);
  return { requested: named.length > 0 || previous, paths: named.length ? named : previous ? eligible : [] };
}

export function readWorkspaceReferenceImages(args: { cwd: string; paths: readonly string[]; allowed: boolean }): {
  images: string[]; assets: ReferenceImageAsset[]; failures: ReferenceImageFailure[];
} {
  const images: string[] = [], assets: ReferenceImageAsset[] = [], failures: ReferenceImageFailure[] = [];
  for (const rel of [...new Set(args.paths)]) {
    let fd: number | undefined;
    try {
      if (!args.allowed) throw new Error("이 활동은 이미지 분석을 허용하지 않아요.");
      if (images.length >= MODEL_IMAGE_MAX_COUNT) throw new Error("이미지는 한 번에 4장까지 분석할 수 있어요. 사용할 사진을 골라 주세요.");
      if (!rel || path.isAbsolute(rel) || /[\\\x00]/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..")) {
        throw new Error("작업 폴더 안의 이미지 상대경로만 읽을 수 있어요.");
      }
      const root = fs.realpathSync(args.cwd);
      const file = path.resolve(root, rel);
      const contained = (p: string) => { const r = path.relative(root, p); return r !== "" && !r.startsWith(`..${path.sep}`) && r !== ".." && !path.isAbsolute(r); };
      if (!contained(file)) throw new Error("작업 폴더 밖의 이미지는 읽을 수 없어요.");
      let segment = root;
      for (const part of rel.split("/")) {
        segment = path.join(segment, part);
        const entry = fs.lstatSync(segment);
        if (segment === file && !entry.isFile() && !entry.isSymbolicLink()) throw new Error("일반 이미지 파일만 읽을 수 있어요.");
        if (entry.isSymbolicLink()) throw new Error("연결된 파일·폴더의 이미지는 읽지 않았어요. 작업 폴더에 원본을 넣어 주세요.");
      }
      if (!contained(fs.realpathSync(file))) throw new Error("작업 폴더 밖의 이미지는 읽을 수 없어요.");
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size === 0) throw new Error("이미지 파일이 비어 있거나 일반 파일이 아니에요.");
      if (stat.size > 4_874_970) throw new Error("이미지가 너무 커서 분석하지 못했어요. 작은 사본을 첨부해 주세요.");
      const bytes = fs.readFileSync(fd);
      const after = fs.statSync(file);
      if (stat.dev !== after.dev || stat.ino !== after.ino || !contained(fs.realpathSync(file))) throw new Error("읽는 동안 이미지 위치가 바뀌었어요. 다시 시도해 주세요.");
      const mime = referenceImageMime(bytes);
      if (!mime) throw new Error("분석할 수 있는 PNG·JPEG·GIF·WebP 이미지가 아니에요. 지원 형식 사본을 첨부해 주세요.");
      const url = `data:${mime};base64,${bytes.toString("base64")}`;
      if (url.length > MODEL_IMAGE_MAX_DATA_URL_CHARS) throw new Error("이미지가 너무 커서 분석하지 못했어요.");
      images.push(url);
      assets.push({ path: rel, mime, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      failures.push({ path: rel, reason: code === "ENOENT" ? "이미지 파일이 없어요. 다시 첨부하거나 경로를 알려 주세요." : code === "EACCES" || code === "EPERM" ? "이미지 파일을 읽을 권한이 없어요." : e instanceof Error && !code ? e.message : "이미지 파일을 읽지 못했어요. 다시 첨부해 주세요." });
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  return { images, assets, failures };
}

export function referenceImageFailuresNote(failures: readonly ReferenceImageFailure[], missingPrevious = false): string {
  const lines = failures.map((f) => `${f.path}: ${f.reason}`);
  if (missingPrevious) lines.push("이 활동의 대화에서 이전 이미지 경로를 찾지 못했어요. 이미지를 다시 첨부하거나 작업 폴더 경로를 알려 주세요.");
  return lines.length ? `[참고 이미지 확인 실패]\n${lines.join("\n")}\n이미지를 보았다고 말하지 말고 확인하지 못한 부분을 분명히 알려 주세요.` : "";
}
