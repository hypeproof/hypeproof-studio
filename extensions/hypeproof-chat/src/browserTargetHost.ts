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
//   내 컴퓨터 파일 — a `file:` URL, shown by its file name only (never the folder path);
//   인터넷         — everything else, including `localhost.evil.com`, `127.0.0.1.nip.io`, `localhost@evil.com`.

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

export interface BrowserTarget {
  /** Normalized ASCII host (no scheme, userinfo, port, path, query, fragment), or a file's name. Null when none. */
  host: string | null;
  place: BrowserTargetPlace;
  label: string;
  /** True for http(s) targets: the only ones a site-wide "항상 허용" can name. */
  web: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
// Control and bidirectional-override characters could reorder a file name on screen (`gpj.exe` → `exe.jpg`).
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f؜‎‏‪-‮⁦-⁩]/g;

function fileName(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep the encoded form */ }
  name = name.replace(UNSAFE_NAME_CHARS, "").trim();
  return name || UNNAMED_FILE_TEXT;
}

const target = (host: string | null, place: BrowserTargetPlace, web: boolean): BrowserTarget =>
  ({ host, place, label: BROWSER_TARGET_LABELS[place], web });

export function browserTarget(rawUrl: string | undefined): BrowserTarget {
  const raw = (rawUrl ?? "").trim();
  let url: URL;
  try { url = new URL(raw); } catch { return target(null, "internet", false); }
  if (url.protocol === "file:") return target(fileName(url), "file", false);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return target(null, "internet", false);
  const host = url.hostname;
  const preview = LOOPBACK_HOSTS.has(host) && isLoopbackPreview(raw);
  return target(host, preview ? "preview" : "internet", true);
}

const isBlank = (rawUrl: string | undefined): boolean => (rawUrl ?? "").trim() === "about:blank";

/** The approval body: the host on its own line, the label on the next. `about:blank` names no target. */
export function browserTargetDetail(rawUrl: string | undefined): string {
  if (isBlank(rawUrl)) return BLANK_TARGET_TEXT;
  const t = browserTarget(rawUrl);
  return `${t.host ?? UNKNOWN_HOST_TEXT}\n${t.label}`;
}

/** One-line form for tool lines and request descriptions: `host · label`. */
export function browserTargetInline(rawUrl: string | undefined): string {
  if (isBlank(rawUrl)) return BLANK_TARGET_TEXT;
  const t = browserTarget(rawUrl);
  return `${t.host ?? UNKNOWN_HOST_TEXT} · ${t.label}`;
}

/** The "remember this site" button, naming the same normalized host as the body. Null for non-web targets. */
export function browserRememberLabel(rawUrl: string | undefined): string | null {
  const t = browserTarget(rawUrl);
  return t.web && t.host ? `이 사이트는 항상 허용 (${t.host})` : null;
}
