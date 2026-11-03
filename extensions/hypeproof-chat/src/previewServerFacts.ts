// #3425 — what a loopback preview server serves, told to the coach in words.
//
// A member's coach could not say which file `http://localhost:9000` served: the folder it was started in
// (`homepage/`) had no index.html, and nothing the coach could read named the folder or the file. It asked
// the learner to describe the screen instead. These helpers turn what the host can observe into one line:
// the server's address and port, the folder it serves, and the file a visitor gets at `/`.
//
// Two kinds of server, two levels of certainty:
// - Studio's own preview server: the host knows its root, so the root and the entry file are facts.
// - Any other loopback server (one a background command started, e.g. `python -m http.server 9000`): the
//   host only sees its HTTP answer. The folder is named only when that answer matches exactly one folder of
//   the work folder (a directory listing whose names all exist there, or a page whose bytes equal one file).
//   Otherwise the line says the folder is unknown — never a guess.
//
// vscode-free and synchronous over node:fs so it runs under `node --experimental-strip-types`.

import * as fs from "node:fs";
import * as path from "node:path";

const HTML_FILE = /\.html?$/i;
/** How many HTML files a line names before it says "외 N개". */
const LIST_MAX = 8;
/** Folder depth below the work folder that is searched for a match (the work folder itself is depth 0). */
const SEARCH_DEPTH = 2;
/** Upper bound on folders scanned for one match, so a huge work folder cannot stall a tool call. */
const SEARCH_FOLDERS_MAX = 200;
const SKIP_DIRS = new Set(["node_modules", ".git", ".hypeproof", ".vscode"]);

export interface PreviewServerFact {
  /** `127.0.0.1:9000` */
  address: string;
  port: string;
  /** Studio's own preview server (root known) or another loopback server (root inferred or unknown). */
  studio: boolean;
  /** The served folder relative to the work folder: "." for the work folder itself; undefined = unknown. */
  folder?: string;
  /** The file served at `/`, relative to the work folder; null = nothing is served there (no index.html). */
  entry?: string | null;
  /** The answer at `/` when it is a directory listing instead of a page. */
  listing?: boolean;
  /** HTML files at the root of the served folder (relative to the work folder), when the folder is known. */
  htmlFiles?: string[];
}

function rel(workRoot: string | undefined, abs: string): string {
  if (!workRoot) return abs;
  const r = path.relative(workRoot, abs);
  if (r === "") return ".";
  if (r.startsWith("..") || path.isAbsolute(r)) return abs;
  return r.split(path.sep).join("/");
}

function htmlFilesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && HTML_FILE.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** `http://127.0.0.1:9000/x` → { address: "127.0.0.1:9000", port: "9000" }; null when not a loopback http(s) URL with a port. */
export function loopbackAddress(url: string): { address: string; port: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])$/i.test(u.hostname)) return null;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return { address: `${u.hostname}:${port}`, port };
  } catch {
    return null;
  }
}

/** Studio's own preview server: the root is known, so the entry at `/` is read off the disk the way serveStatic serves it. */
export function studioServerFact(url: string, root: string, workRoot: string | undefined): PreviewServerFact | null {
  const addr = loopbackAddress(url);
  if (!addr) return null;
  // The folder the requested address points at (a sub-folder like `/homepage/`), else the server's root.
  let dir = path.resolve(root);
  try {
    const sub = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    const cand = path.resolve(dir, sub);
    if (sub && (cand === dir || cand.startsWith(dir + path.sep)) && fs.statSync(cand).isDirectory()) dir = cand;
  } catch { /* not a folder of the root: describe the root */ }
  const html = htmlFilesIn(dir);
  const index = html.find((n) => n.toLowerCase() === "index.html") ?? null;
  return {
    ...addr,
    studio: true,
    folder: rel(workRoot ?? root, dir),
    entry: index ? rel(workRoot ?? root, path.join(dir, index)) : null,
    htmlFiles: html.map((n) => rel(workRoot ?? root, path.join(dir, n))),
  };
}

/**
 * The names a directory-listing page links to (Python's http.server "Directory listing for /", the
 * common "Index of /" pages). Null when the page is not a listing.
 */
export function parseDirectoryListing(html: string): string[] | null {
  if (!/<title>\s*(?:Directory listing for|Index of)\b/i.test(html)) return null;
  const names: string[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href="([^"?#]+)"/gi)) {
    let name: string;
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    if (name.startsWith("/") || name.startsWith("..") || /^[a-z]+:/i.test(name)) continue;
    name = name.replace(/\/$/, "");
    if (name && !name.includes("/") && !names.includes(name)) names.push(name);
  }
  return names;
}

function* candidateFolders(workRoot: string): Generator<string> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: workRoot, depth: 0 }];
  let seen = 0;
  while (queue.length && seen < SEARCH_FOLDERS_MAX) {
    const { dir, depth } = queue.shift()!;
    seen += 1;
    yield dir;
    if (depth >= SEARCH_DEPTH) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of entries) {
      if (d.isDirectory() && !d.name.startsWith(".") && !SKIP_DIRS.has(d.name)) queue.push({ dir: path.join(dir, d.name), depth: depth + 1 });
    }
  }
}

/**
 * Another loopback server: infer its folder from its answer at `/`. A listing matches the one folder whose
 * entries include every listed name (and the same count); a page matches the one HTML file with the same
 * bytes. More than one match, or none, leaves the folder unknown.
 */
export function inferServedFact(url: string, workRoot: string | undefined, answer: { status: number; contentType: string; body: string }): PreviewServerFact | null {
  const addr = loopbackAddress(url);
  if (!addr) return null;
  const fact: PreviewServerFact = { ...addr, studio: false };
  const isHtml = /text\/html/i.test(answer.contentType);
  const listing = isHtml ? parseDirectoryListing(answer.body) : null;
  if (listing) fact.listing = true;
  if (!workRoot || answer.status !== 200) return fact;
  const matches: string[] = [];
  if (listing) {
    for (const dir of candidateFolders(workRoot)) {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      if (names.length === listing.length && listing.every((n) => names.includes(n))) matches.push(dir);
      if (matches.length > 1) break;
    }
    if (matches.length === 1) {
      const html = htmlFilesIn(matches[0]);
      fact.folder = rel(workRoot, matches[0]);
      fact.entry = null;
      fact.htmlFiles = html.map((n) => rel(workRoot, path.join(matches[0], n)));
    }
    return fact;
  }
  if (!isHtml) return fact;
  const body = Buffer.from(answer.body, "utf8");
  const files: string[] = [];
  for (const dir of candidateFolders(workRoot)) {
    for (const n of htmlFilesIn(dir)) {
      const file = path.join(dir, n);
      try {
        if (fs.statSync(file).size === body.length && fs.readFileSync(file).equals(body)) files.push(file);
      } catch { /* unreadable: not a match */ }
    }
    if (files.length > 1) break;
  }
  if (files.length === 1) {
    const dir = path.dirname(files[0]);
    fact.folder = rel(workRoot, dir);
    fact.entry = rel(workRoot, files[0]);
    fact.htmlFiles = htmlFilesIn(dir).map((n) => rel(workRoot, path.join(dir, n)));
  }
  return fact;
}

function names(list: string[]): string {
  const shown = list.slice(0, LIST_MAX).join(", ");
  return list.length > LIST_MAX ? `${shown} 외 ${list.length - LIST_MAX}개` : shown;
}

/** One coach-facing line: address/port, served folder, and the file a visitor gets at `/`. */
export function previewServerFactText(fact: PreviewServerFact): string {
  const who = fact.studio ? "Studio 미리보기 서버" : "학생 컴퓨터의 다른 로컬 서버";
  const parts = [`[미리보기 서버] ${fact.address} (포트 ${fact.port}, ${who})`];
  if (fact.folder === undefined) {
    parts.push(
      fact.listing
        ? "서빙 폴더: 확인 불가 — / 는 파일 목록(디렉터리 목록)을 보여 줘요(index.html 없음)"
        : "서빙 폴더: 확인 불가 — 작업 폴더의 어느 파일과도 일치하지 않아요",
    );
    return parts.join(" · ");
  }
  parts.push(`서빙 폴더: ${fact.folder === "." ? "작업 폴더 전체" : `작업 폴더/${fact.folder}`}`);
  if (fact.entry) {
    parts.push(`/ 에서 보이는 파일: ${fact.entry}`);
  } else {
    parts.push(`/ 에서 보이는 파일: 없음 — 이 폴더에 index.html 이 없어요${fact.listing ? "(파일 목록이 보여요)" : ""}`);
    const prefix = fact.folder === "." ? "" : `${fact.folder}/`;
    if (fact.htmlFiles?.length) {
      const first = fact.htmlFiles[0].slice(prefix.length);
      parts.push(`이 폴더의 HTML: ${names(fact.htmlFiles)} — 열려면 http://${fact.address}/${encodeURI(first)} 처럼 파일 이름까지 적어요`);
    }
  }
  return parts.join(" · ");
}

/** What the host can observe about one loopback address, gathered without vscode (tests pass fakes). */
export interface LoopbackServerProbe {
  /** Studio's own preview server address, when one is up. */
  liveUrl?: string | null;
  /** Its root folder. */
  liveRoot?: string | null;
  /** The learner's work folder. */
  workRoot?: string;
  /** GET `<origin>/`; null when nothing answers. */
  fetchRoot(origin: string): Promise<{ status: number; contentType: string; body: string } | null>;
}

/**
 * The coach-facing line for `url` (#3425), or null when `url` is not a loopback address or nothing
 * answers there. Studio's own server (same port as `liveUrl`) is described from its root on disk;
 * any other loopback server from its answer at `/`.
 */
export async function describeLoopbackServer(url: string, probe: LoopbackServerProbe): Promise<string | null> {
  const addr = loopbackAddress(url);
  if (!addr) return null;
  const live = probe.liveUrl ? loopbackAddress(probe.liveUrl) : null;
  if (live && live.port === addr.port && probe.liveRoot) {
    const fact = studioServerFact(url, probe.liveRoot, probe.workRoot);
    return fact ? previewServerFactText(fact) : null;
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  let answer: { status: number; contentType: string; body: string } | null;
  try {
    answer = await probe.fetchRoot(origin);
  } catch {
    answer = null;
  }
  if (!answer) return null;
  const fact = inferServedFact(url, probe.workRoot, answer);
  return fact ? previewServerFactText(fact) : null;
}
