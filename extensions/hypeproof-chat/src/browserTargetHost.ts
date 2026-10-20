// REQ-E3 / CGP-AGENT-R-006 — where a browser action goes, in two plain words. Pure: no vscode.
//
// Every learner-facing surface that names a browser or network target (the openBrowser approval body, its
// "항상 허용" button, the request description, the detailed tool line) shows the HOST only, never the full URL:
// a query or path can carry tokens, and userinfo can make `localhost@evil.com` read like the learner's machine.
//
// One normalization feeds all of them: the WHATWG `URL.hostname`. So an IDN host is punycode (ASCII) and cannot
// pass as a known site, and `http://2130706433/` shows as `127.0.0.1` in the line AND in the button.
// The label is decided from that same normalized host:
//   내 미리보기    — the host is loopback AND `isLoopbackPreview` accepts the URL as written (the learner's preview
//                   server: plain `127.0.0.1` / `localhost`, a port, a path). A numeric or bracketed spelling that
//                   only normalizes to loopback (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`,
//                   `[::ffff:127.0.0.1]`) is not how Studio's preview is addressed, so it stays 인터넷;
//   내 컴퓨터 파일 — a local `file:` URL. Inside the work folder it shows as `작업 폴더/<relative path>`; outside it
//                   (or with no work folder) as `작업 폴더 밖 · <file name>`, never the full path. A `file://<host>/`
//                   URL naming a remote host is 인터넷 with that host, like any other remote target;
//   인터넷         — everything else, including `localhost.evil.com`, `127.0.0.1.nip.io`, `localhost@evil.com`.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoopbackPreview } from "./previewRecovery.ts";

export type BrowserTargetPlace = "preview" | "internet" | "file";
export const BROWSER_TARGET_LABELS: Record<BrowserTargetPlace, string> = {
  preview: "내 미리보기",
  internet: "인터넷",
  file: "내 컴퓨터 파일",
};
export const BLANK_TARGET_TEXT = "빈 브라우저";
export const UNKNOWN_HOST_TEXT = "알 수 없는 주소";
const UNNAMED_FILE_TEXT = "이름 없는 파일";
export const WORK_FOLDER_TEXT = "작업 폴더";
export const OUTSIDE_WORK_FOLDER_TEXT = "작업 폴더 밖";

export interface BrowserTarget {
  /** Normalized ASCII host (no scheme, userinfo, port, path, query, fragment), or a local file's display. Null when none. */
  host: string | null;
  place: BrowserTargetPlace;
  label: string;
  /** True for http(s) targets: the only ones a site-wide "항상 허용" can name. */
  web: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
// Characters that could fake a line or reorder text in the modal: C0 and C1 controls (incl. U+0085 NEL), DEL,
// U+2028/U+2029 line/paragraph separators, and every bidi control (ALM, LRM/RLM, LRE..RLO, LRI..PDI).
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

const cleanName = (name: string): string => name.replace(UNSAFE_NAME_CHARS, "").trim();

/** How a local file target is shown. `workspaceRoot` undefined = not known (file name only); null = no work folder. */
export interface BrowserTargetOptions {
  workspaceRoot?: string | null;
}

function localFileDisplay(url: URL, opts: BrowserTargetOptions): string {
  let filePath: string;
  try {
    filePath = fileURLToPath(new URL(url.pathname, "file:///"));
  } catch {
    filePath = url.pathname;
  }
  const name = cleanName(path.basename(filePath)) || UNNAMED_FILE_TEXT;
  if (!("workspaceRoot" in opts)) return name;
  const root = opts.workspaceRoot;
  if (root) {
    const rel = path.relative(root, filePath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      const parts = rel.split(/[\\/]+/).map(cleanName).filter(Boolean);
      if (parts.length) return `${WORK_FOLDER_TEXT}/${parts.join("/")}`;
    }
  }
  return `${OUTSIDE_WORK_FOLDER_TEXT} · ${name}`;
}

const target = (host: string | null, place: BrowserTargetPlace, web: boolean): BrowserTarget =>
  ({ host, place, label: BROWSER_TARGET_LABELS[place], web });

export function browserTarget(rawUrl: string | undefined, opts: BrowserTargetOptions = {}): BrowserTarget {
  const raw = (rawUrl ?? "").trim();
  let url: URL;
  try { url = new URL(raw); } catch { return target(null, "internet", false); }
  if (url.protocol === "file:") {
    // `file://server/share/x.html` names another machine: it is a remote target, shown by its host.
    if (url.hostname && url.hostname !== "localhost") return target(url.hostname, "internet", false);
    return target(localFileDisplay(url, opts), "file", false);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return target(null, "internet", false);
  const host = url.hostname;
  const preview = LOOPBACK_HOSTS.has(host) && isLoopbackPreview(raw);
  return target(host, preview ? "preview" : "internet", true);
}

const isBlank = (rawUrl: string | undefined): boolean => (rawUrl ?? "").trim() === "about:blank";

/** The approval body: the host on its own line, the label on the next. `about:blank` names no target. */
export function browserTargetDetail(rawUrl: string | undefined, opts: BrowserTargetOptions = {}): string {
  if (isBlank(rawUrl)) return BLANK_TARGET_TEXT;
  const t = browserTarget(rawUrl, opts);
  return `${t.host ?? UNKNOWN_HOST_TEXT}\n${t.label}`;
}

/** One-line form for tool lines and request descriptions: `host · label`. */
export function browserTargetInline(rawUrl: string | undefined, opts: BrowserTargetOptions = {}): string {
  if (isBlank(rawUrl)) return BLANK_TARGET_TEXT;
  const t = browserTarget(rawUrl, opts);
  return `${t.host ?? UNKNOWN_HOST_TEXT} · ${t.label}`;
}

/** The "remember this site" button, naming the same normalized host as the body. Null for non-web targets. */
export function browserRememberLabel(rawUrl: string | undefined): string | null {
  const t = browserTarget(rawUrl);
  return t.web && t.host ? `이 사이트는 항상 허용 (${t.host})` : null;
}
