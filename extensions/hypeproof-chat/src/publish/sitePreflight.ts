import { privateOutboundPath } from "../outboundConsent.ts";
// Preflight for a GitHub Pages publish: decide, before anything leaves the machine, which
// workspace files go public and whether the site will work once it is there.
//
// The rule for blocking vs warning: BLOCK what works in Studio's preview but breaks or leaks on
// Pages; WARN about what is equally broken (or merely risky) in both places. A missing image is
// already missing in the preview, so the participant can see it; a `Logo.PNG` referenced as
// `logo.png` shows fine on a case-insensitive Mac and 404s on Pages, and nobody finds out until
// a patient opens the link. The second class is the one a deterministic tool must catch.
//
// Uses `node:fs` directly (no vscode); the smoke tests run it on temporary folders.

import * as fs from "node:fs";
import * as path from "node:path";

export type IssueSeverity = "block" | "warn";

export interface PreflightIssue {
  severity: IssueSeverity;
  code:
    | "no_index"
    | "index_case"
    | "ref_case"
    | "ref_root_absolute"
    | "ref_excluded"
    | "ref_missing"
    | "file_too_large"
    | "site_too_large"
    | "too_many_files"
    | "secret"
    | "text_unscanned"
    | "rrn"
    | "non_ascii_name"
    | "symlink"
    | "agent_md_notice"
    | "tel_mismatch"
    | "data_phone_no_script";
  file?: string;
  message_ko: string;
}

export interface SiteFile {
  /** POSIX path relative to the site root — the path it gets in the repository. */
  path: string;
  abs: string;
  size: number;
}

export interface PreflightReport {
  files: SiteFile[];
  /** Relative paths left out on purpose (dot entries, node_modules, keys). */
  excluded: string[];
  issues: PreflightIssue[];
  blocked: boolean;
  totalBytes: number;
  /** `<!-- 여기고치기: <label> -->` counts across the HTML files, in order of first appearance (D24). */
  markers: MarkerCount[];
}

export interface MarkerCount {
  label: string;
  count: number;
}

/**
 * Pages limits (docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits):
 * the published site may be at most 1 GB. 50 MB per file is GitHub's own "large file" warning
 * line and, more to the point, a blob above it travels base64-inflated in one JSON request.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_SITE_BYTES = 1024 * 1024 * 1024;
/**
 * Not a GitHub limit: each new file is one blob request, and GitHub's secondary limit allows
 * about 80 content-creating requests a minute. A dental homepage is tens of files; a thousand
 * means a stray folder (an export, a photo library) and is worth stopping for.
 */
export const MAX_FILES = 1000;
/** Bound text inspection; uninspected text blocks publishing. Binary media use other limits. */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** Paths the pipeline writes itself; a workspace copy of these is replaced, not merged. */
export const GENERATED_PATHS = new Set([".github/workflows/pages.yml", "hps-build.txt", "CNAME", ".nojekyll"]);

const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".xml", ".svg", ".yml", ".yaml", ".csv", ".webmanifest", ".map", ".tsv"]);
const HTML_EXT = new Set([".html", ".htm"]);

/**
 * What never goes public. Every dot entry is out (`.git`, `.DS_Store`, `.env*`, `.vscode`,
 * Studio's own state folders, a user `.github` — the pipeline writes its own workflow), plus
 * `node_modules` and private-key files. Excluding all dot entries rather than a list is the
 * fail-closed choice: a new tool's dot folder appearing next year is excluded by default.
 */
export function isExcludedName(name: string, isDir: boolean): boolean {
  if (name.startsWith(".")) return true;
  if (isDir && name === "node_modules") return true;
  if (!isDir && /\.(pem|key|p12|pfx)$/i.test(name)) return true;
  if (!isDir && (name === "Thumbs.db" || name === "desktop.ini")) return true;
  return false;
}

interface SecretPattern {
  code: "secret" | "rrn";
  label: string;
  re: RegExp;
}

/**
 * Token shapes are bounded by their real formats so ordinary words do not trip them: `sk-` alone
 * would match "task-list"; `sk-` followed by 20+ token characters will not. The RRN pattern is
 * a Korean resident registration number (주민등록번호) — a patient's or staff member's, which
 * must never reach a public repository (D2 ②).
 */
const SECRET_PATTERNS: SecretPattern[] = [
  { code: "secret", label: "GitHub 토큰", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/ },
  { code: "secret", label: "GitHub 토큰", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { code: "secret", label: "API 키", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { code: "secret", label: "Supabase 비밀 키", re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { code: "secret", label: "AWS 키", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "secret", label: "개인 키", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { code: "rrn", label: "주민등록번호", re: /(?<!\d)\d{6}-[1-4]\d{6}(?!\d)/ },
];

/**
 * The RRN pattern alone also matches some order or receipt numbers. Requiring a real calendar
 * date in the first six digits (YYMMDD) removes most of those without missing a real number.
 */
function plausibleRrn(match: string): boolean {
  const mm = Number(match.slice(2, 4));
  const dd = Number(match.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

interface DirEntry {
  name: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export function preflightSite(root: string, privateDirectories: string[] = []): PreflightReport {
  const files: SiteFile[] = [];
  const excluded: string[] = [];
  const issues: PreflightIssue[] = [];
  const listings = new Map<string, DirEntry[]>();
  let totalBytes = 0;

  const list = (dirRel: string): DirEntry[] => {
    const cached = listings.get(dirRel);
    if (cached) return cached;
    let entries: DirEntry[] = [];
    try {
      entries = fs.readdirSync(path.join(root, dirRel), { withFileTypes: true }).map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
        isFile: d.isFile(),
        isSymlink: d.isSymbolicLink(),
      }));
    } catch {
      entries = [];
    }
    listings.set(dirRel, entries);
    return entries;
  };

  const walk = (dirRel: string) => {
    for (const e of list(dirRel)) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (isExcludedName(e.name, e.isDir) || privateOutboundPath(rel) || privateDirectories.some(dir => privateOutboundPath(rel, dir))) {
        excluded.push(rel);
        continue;
      }
      if (e.isSymlink) {
        // A link can point outside the workspace (a home folder, a key store). Following it
        // would publish whatever it points to, so it is left out and named.
        excluded.push(rel);
        issues.push({ severity: "warn", code: "symlink", file: rel, message_ko: `바로가기(링크) 파일은 올리지 않아요: ${rel}` });
        continue;
      }
      if (e.isDir) {
        walk(rel);
        continue;
      }
      if (!e.isFile) continue;
      if (GENERATED_PATHS.has(rel)) {
        excluded.push(rel);
        continue;
      }
      const abs = path.join(root, rel);
      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      files.push({ path: rel, abs, size });
      totalBytes += size;
    }
  };
  walk("");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // ── index.html, exact case, at the root ──────────────────────────────────
  const rootNames = list("").filter((e) => e.isFile).map((e) => e.name);
  if (!rootNames.includes("index.html")) {
    const variant = rootNames.find((n) => n.toLowerCase() === "index.html" || n.toLowerCase() === "index.htm");
    issues.push(
      variant
        ? { severity: "block", code: "index_case", file: variant, message_ko: `첫 화면 파일 이름을 '${variant}'에서 'index.html'(모두 소문자)로 바꿔 주세요.` }
        : { severity: "block", code: "no_index", message_ko: "작업 폴더 맨 위에 index.html(첫 화면)이 없어요." },
    );
  }

  // ── size and count ───────────────────────────────────────────────────────
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      issues.push({ severity: "block", code: "file_too_large", file: f.path, message_ko: `50MB가 넘는 파일은 올릴 수 없어요: ${f.path}` });
    }
  }
  if (totalBytes > MAX_SITE_BYTES) {
    issues.push({ severity: "block", code: "site_too_large", message_ko: "전체 크기가 1GB를 넘어요. 큰 영상·사진을 줄여 주세요." });
  }
  if (files.length > MAX_FILES) {
    issues.push({ severity: "block", code: "too_many_files", message_ko: `파일이 ${files.length}개예요. 홈페이지와 관계없는 폴더가 들어 있는지 확인해 주세요.` });
  }

  // ── names ────────────────────────────────────────────────────────────────
  for (const f of files) {
    // Pages serves them, but every link must then be percent-encoded exactly; a hand-written
    // `<img src="사진.jpg">` usually works and occasionally does not (normalization forms).
    if (/[^\x20-\x7e]/.test(f.path)) {
      issues.push({ severity: "warn", code: "non_ascii_name", file: f.path, message_ko: `파일 이름에 한글·특수문자가 있어요(영어 이름을 권해요): ${f.path}` });
    }
  }

  // ── content: secrets, RRN, references ────────────────────────────────────
  const included = new Set(files.map((f) => f.path));
  const markers: MarkerCount[] = [];
  for (const f of files) {
    const ext = path.extname(f.path).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    const unscanned = () => issues.push({ severity: "block" as const, code: "text_unscanned" as const, file: f.path, message_ko: `파일의 공개 전 검사를 끝내지 못했어요: ${f.path}. 텍스트 파일은 2MB 이하로 줄이고 읽을 수 있는지 확인한 뒤 다시 올려 주세요.` });
    if (f.size > MAX_SCAN_BYTES) { unscanned(); continue; }
    let text: string;
    let fd: number | undefined;
    try {
      fd = fs.openSync(f.abs, "r");
      const bytes = Buffer.alloc(MAX_SCAN_BYTES + 1);
      let count = 0;
      while (count < bytes.length) {
        const n = fs.readSync(fd, bytes, count, bytes.length - count, null);
        if (n === 0) break;
        count += n;
      }
      if (count > MAX_SCAN_BYTES) { unscanned(); continue; }
      text = bytes.subarray(0, count).toString("utf8");
    } catch {
      unscanned();
      continue;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    scanSecrets(f.path, text, issues);
    if (HTML_EXT.has(ext)) {
      for (const ref of htmlRefs(text)) checkRef(root, f.path, ref, included, list, issues);
      issues.push(...telIssues(f.path, text));
      for (const m of countMarkers(text)) {
        const hit = markers.find((x) => x.label === m.label);
        if (hit) hit.count += m.count;
        else markers.push({ ...m });
      }
    } else if (ext === ".css") {
      for (const ref of cssRefs(text)) checkRef(root, f.path, ref, included, list, issues);
    }
  }

  // ── agent.md is public (D2) — say so on its first line ───────────────────
  const agent = files.find((f) => f.path === "agent.md");
  if (agent) {
    try {
      const first = fs.readFileSync(agent.abs, "utf8").split(/\r?\n/).find((l) => l.trim()) ?? "";
      if (!/공개/.test(first)) {
        issues.push({
          severity: "warn",
          code: "agent_md_notice",
          file: "agent.md",
          message_ko: "agent.md도 공개돼요. 첫 줄에 \"이 문서는 공개 보관함에 있어 누구나 볼 수 있습니다\"를 넣고, 남에게 보여도 되는 것만 남겨 주세요.",
        });
      }
    } catch {
      /* unreadable → nothing to warn about */
    }
  }

  return { files, excluded, issues, blocked: issues.some((i) => i.severity === "block"), totalBytes, markers };
}

function scanSecrets(file: string, text: string, issues: PreflightIssue[]): void {
  const lines = text.split(/\r?\n/);
  for (const p of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const m = p.re.exec(lines[i]!);
      if (!m) continue;
      if (p.code === "rrn" && !plausibleRrn(m[0])) continue;
      // The value itself is never echoed — the message would otherwise copy the secret into
      // the chat transcript and the session log, two more places it must not be.
      issues.push({ severity: "block", code: p.code, file, message_ko: `${p.label}처럼 보이는 값이 있어요: ${file} ${i + 1}번째 줄` });
      break;
    }
  }
}

/** Strip comments and script bodies so `location.href = "/x"` inside JS is not read as a link. */
function markupOnly(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2");
}

const ATTR_RE = /\s(src|href|poster|data|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

export function htmlRefs(html: string): string[] {
  const out: string[] = [];
  const markup = markupOnly(html);
  // <style> bodies are CSS: their url(...) references count.
  for (const m of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(...cssRefs(m[1] ?? ""));
  for (const tag of markup.matchAll(/<[a-zA-Z][^>]*>/g)) {
    // <base href> changes how every other link resolves; checking against the wrong base would
    // be guessing, and a guessed verdict is worse than none.
    if (/^<base\b/i.test(tag[0])) continue;
    for (const a of tag[0].matchAll(ATTR_RE)) {
      const name = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (name === "srcset") {
        for (const part of value.split(",")) {
          const u = part.trim().split(/\s+/)[0];
          if (u) out.push(u);
        }
      } else if (name === "style") {
        out.push(...cssRefs(value));
      } else {
        out.push(value);
      }
    }
  }
  return out;
}

export function cssRefs(css: string): string[] {
  const out: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) out.push(m[2]!.trim());
  for (const m of clean.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) out.push(m[2]!.trim());
  return out;
}

/** External, fragment-only, data/mailto/tel/javascript, or a template placeholder. */
function notLocal(ref: string): boolean {
  if (!ref || ref.startsWith("#") || ref.startsWith("?")) return true;
  if (ref.startsWith("//")) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return true;
  if (/\{\{|\$\{|%%/.test(ref)) return true;
  return false;
}

function checkRef(
  root: string,
  from: string,
  raw: string,
  included: Set<string>,
  list: (dirRel: string) => DirEntry[],
  issues: PreflightIssue[],
): void {
  const ref = raw.trim();
  if (notLocal(ref)) return;
  if (ref.startsWith("/")) {
    // A project site lives under /<repo>/, so "/style.css" asks for <login>.github.io/style.css
    // — another site. Studio's preview serves the workspace at "/", so it works there.
    issues.push({
      severity: "block",
      code: "ref_root_absolute",
      file: from,
      message_ko: `${from}: '${ref}'처럼 슬래시(/)로 시작하는 경로는 인터넷 주소에서 깨져요. '${ref.replace(/^\/+/, "")}'처럼 바꿔 주세요.`,
    });
    return;
  }
  let target = ref.split("#")[0]!.split("?")[0]!;
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep the raw form */
  }
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  if (joined === ".." || joined.startsWith("../")) {
    issues.push({ severity: "warn", code: "ref_missing", file: from, message_ko: `${from}: 작업 폴더 밖을 가리키는 경로예요: ${ref}` });
    return;
  }
  // "./" and "sub/" name directories; Pages serves their index.html.
  const clean = joined.replace(/\/+$/, "");
  const verdict = resolveExact(clean === "." ? "" : clean, list);
  if (verdict.status === "missing") {
    issues.push({ severity: "warn", code: "ref_missing", file: from, message_ko: `${from}: 없는 파일을 가리켜요: ${ref}` });
    return;
  }
  if (verdict.status === "case") {
    issues.push({
      severity: "block",
      code: "ref_case",
      file: from,
      message_ko: `${from}: '${ref}'의 대소문자가 실제 파일 '${verdict.actual}'과 달라요. 이 컴퓨터에서는 열리지만 인터넷 주소에서는 깨져요.`,
    });
    return;
  }
  if (!included.has(verdict.actual)) {
    issues.push({
      severity: "block",
      code: "ref_excluded",
      file: from,
      message_ko: `${from}: '${ref}'는 올라가지 않는 파일(점으로 시작하는 폴더·node_modules 등)을 가리켜요.`,
    });
  }
}

/**
 * Resolve a site path segment by segment against REAL directory listings, comparing names
 * byte-for-byte. `fs.existsSync` cannot be used: on a case-insensitive macOS volume it says
 * yes to `IMG/Logo.png` when the file is `img/logo.png`, which is precisely the lie to catch.
 * A directory resolves to its index.html, as Pages does.
 */
function resolveExact(
  rel: string,
  list: (dirRel: string) => DirEntry[],
): { status: "ok"; actual: string } | { status: "case"; actual: string } | { status: "missing" } {
  const parts = rel ? rel.split("/") : [];
  let dir = "";
  let caseMismatch = false;
  for (let i = 0; i < parts.length; i++) {
    const want = parts[i]!;
    const entries = list(dir);
    let hit = entries.find((e) => e.name === want);
    if (!hit) {
      hit = entries.find((e) => e.name.toLowerCase() === want.toLowerCase());
      if (!hit) return { status: "missing" };
      caseMismatch = true;
    }
    dir = dir ? `${dir}/${hit.name}` : hit.name;
    if (i < parts.length - 1 && !hit.isDir) return { status: "missing" };
    if (i === parts.length - 1 && hit.isDir) {
      const idx = list(dir).find((e) => e.name === "index.html");
      if (!idx) return { status: "missing" };
      dir = `${dir}/index.html`;
    }
  }
  if (!parts.length) {
    if (!list("").some((e) => e.name === "index.html")) return { status: "missing" };
    dir = "index.html";
  }
  return caseMismatch ? { status: "case", actual: dir } : { status: "ok", actual: dir };
}

/** Korean one-liners for the preflight step: blocking issues first, at most `max`. */
export function summarizeIssues(issues: PreflightIssue[], max = 5): string[] {
  const ordered = [...issues.filter((i) => i.severity === "block"), ...issues.filter((i) => i.severity === "warn")];
  const lines = ordered.slice(0, max).map((i) => i.message_ko);
  if (ordered.length > max) lines.push(`외 ${ordered.length - max}건`);
  return lines;
}

// ── Phone links (D22) ────────────────────────────────────────────────────────
//
// A tel: link that dials a different number than the page shows is invisible in the preview
// (href is never on screen) and harms a patient the moment it is used — exactly the "works here,
// breaks there" class this file blocks. The coach's phone rule is prevention only; it was
// reported as followed when it was not (hype-dental S1/S2), so this check is the last gate.
// Pure and exported: the e2e prompt sweep runs the same function on its outputs (D24).

/** Digits only, with the Korean country code folded back to the trunk prefix (+82 2… → 02…). */
export function normalizePhoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("82")) d = `0${d.slice(2)}`;
  // "+82 (0)2 …" and "+82-02-…" carry the trunk zero twice once folded.
  if (d.startsWith("00")) d = d.slice(1);
  return d;
}

/**
 * Phone numbers as a person reads them on the page. Korean shapes only — a leading 0 or +82
 * (02-1234-5678, 010 1234 5678, +82-2-…) and the 15xx/16xx/18xx representative numbers — so
 * a date (2026.10.13) or an order number never counts as a phone number.
 */
const VISIBLE_PHONE = /(?:\+\s?82[\s.\-]*(?:\(0\)\s*)?|(?<![\d])0)\d{1,2}[)\s.\-]{0,3}\d{3,4}[\s.\-]{0,2}\d{4}(?!\d)|(?<!\d)1[5-9]\d{2}[\s.\-]?\d{4}(?!\d)/g;

/** Blank a matched region but keep its newlines, so offsets still map to the right line. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\n]/g, " "));
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/** Pretty "02-1234-5678" for a message from a digit string (best effort; digits stay exact). */
function showNumber(d: string): string {
  if (/^02\d{7,8}$/.test(d)) return `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  if (/^0\d{9,10}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
  if (/^1\d{7}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

export interface TelCheck {
  /** One per tel: link that dials a number the page does not show. */
  mismatches: Array<{ line: number; dials: string; shows: string | null; rule: "link_text" | "not_on_page" }>;
  /** `data-phone` is used but no script turns it into a link (the button then dials nothing). */
  dataPhoneWithoutScript: boolean;
  /** Normalized phone numbers visible on the page. */
  visible: string[];
}

/**
 * The phone-link rule (D22), on one HTML document:
 *   (a) `<a href="tel:X">text</a>` whose text holds ≥ 8 digits must dial those digits;
 *   (b) when the page shows any phone number, every tel: link must dial one of them — catches a
 *       number-less "전화하기" button still pointing at an old number.
 * Comments, scripts and styles are not page text; attribute values are not either.
 */
export function checkTelLinks(html: string): TelCheck {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "");
  let doc = blank(html, /<!--[\s\S]*?-->/g);
  doc = blank(doc, /<script\b[\s\S]*?<\/script>/gi);
  doc = blank(doc, /<style\b[\s\S]*?<\/style>/gi);
  const text = decodeEntities(doc.replace(/<[^>]*>/g, (m) => m.replace(/[^\n]/g, " ")));
  const visible = [...new Set([...text.matchAll(VISIBLE_PHONE)].map((m) => normalizePhoneDigits(m[0])))];

  const mismatches: TelCheck["mismatches"] = [];
  for (const m of doc.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] ?? "";
    const href = /\bhref\s*=\s*(?:"\s*tel:([^"]*)"|'\s*tel:([^']*)'|tel:([^\s>]+))/i.exec(attrs);
    if (!href) continue;
    const dials = normalizePhoneDigits(decodeEntities(href[1] ?? href[2] ?? href[3] ?? ""));
    const inner = decodeEntities((m[2] ?? "").replace(/<[^>]*>/g, " "));
    const innerDigits = inner.replace(/\D/g, "");
    const line = lineAt(html, m.index ?? 0);
    if (innerDigits.length >= 8) {
      const shows = normalizePhoneDigits(inner);
      if (shows !== dials) mismatches.push({ line, dials, shows, rule: "link_text" });
      continue;
    }
    if (visible.length > 0 && !visible.includes(dials)) mismatches.push({ line, dials, shows: null, rule: "not_on_page" });
  }

  const usesDataPhone = /\bdata-phone\b/i.test(doc);
  const scriptSetsHref = scripts.some((js) => /data-phone|dataset\.phone/i.test(js) && /href|tel:/i.test(js));
  return { mismatches, dataPhoneWithoutScript: usesDataPhone && !scriptSetsHref, visible };
}

function telIssues(file: string, html: string): PreflightIssue[] {
  const r = checkTelLinks(html);
  const out: PreflightIssue[] = r.mismatches.map((x) => ({
    severity: "block" as const,
    code: "tel_mismatch" as const,
    file,
    message_ko:
      x.rule === "link_text"
        ? `전화 링크 번호(tel:)가 화면의 전화번호와 달라요 — ${file} ${x.line}번째 줄. 화면 번호는 ${showNumber(x.shows!)}인데 누르면 ${x.dials}로 걸려요. 두 곳을 같은 번호로 고친 뒤 다시 '인터넷에 올리기'를 눌러 주세요.`
        : `전화 링크 번호(tel:)가 화면의 어느 전화번호와도 달라요 — ${file} ${x.line}번째 줄. 누르면 ${x.dials}로 걸려요. 화면에 보이는 번호와 같은 번호로 고친 뒤 다시 '인터넷에 올리기'를 눌러 주세요.`,
  }));
  if (r.dataPhoneWithoutScript) {
    out.push({
      severity: "warn",
      code: "data_phone_no_script",
      file,
      message_ko: `${file}: 전화 버튼(data-phone)은 있는데 전화를 걸어 주는 스크립트가 없어요. 이대로는 눌러도 전화가 걸리지 않아요.`,
    });
  }
  return out;
}

// ── Edit markers (D24) ───────────────────────────────────────────────────────

/**
 * `<!-- 여기고치기: 진료시간 -->` counts per label, in order of first appearance. Counted by code
 * because the coach's own counts disagreed within one run ("두 곳" vs "3곳", hype-dental S3); the
 * participant's next-day instructions quote these numbers.
 */
export function countMarkers(html: string): MarkerCount[] {
  const out: MarkerCount[] = [];
  for (const m of html.matchAll(/<!--\s*여기고치기\s*:\s*([\s\S]*?)\s*-->/g)) {
    const label = (m[1] ?? "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    const hit = out.find((x) => x.label === label);
    if (hit) hit.count++;
    else out.push({ label, count: 1 });
  }
  return out;
}

/** "다음에 고칠 표식: 진료시간 4곳 · 진료 안내 3곳", or "" when the site has none. */
export function markerSummary(markers: MarkerCount[] | undefined): string {
  if (!markers?.length) return "";
  return `다음에 고칠 표식: ${markers.map((m) => `${m.label} ${m.count}곳`).join(" · ")}`;
}
