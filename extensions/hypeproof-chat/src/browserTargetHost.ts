// REQ-E3 / CGP-AGENT-R-006 — where a browser action goes, in two plain words. Pure: no vscode.
//
// A browser-open approval names the destination HOST on its own line (never the full URL: a query or path can carry
// tokens, and userinfo can make `localhost@evil.com` read like the learner's own machine) plus one label:
//   내 미리보기 — the learner's own loopback preview, decided by `isLoopbackPreview` and nothing looser;
//   인터넷     — everything else, including every loopback lookalike (`localhost.evil.com`, `127.0.0.1.nip.io`,
//                `[::ffff:127.0.0.1]`, decimal/hex/octal IPv4 spellings, userinfo tricks, file: URLs).
// The host is the WHATWG-parsed hostname, so an IDN host shows as punycode (ASCII) and cannot pass as a known site.

import { isLoopbackPreview } from "./previewRecovery.ts";

export type BrowserTargetPlace = "preview" | "internet";
export const BROWSER_TARGET_LABELS: Record<BrowserTargetPlace, string> = { preview: "내 미리보기", internet: "인터넷" };
export const BLANK_TARGET_TEXT = "빈 브라우저";
export const UNKNOWN_HOST_TEXT = "알 수 없는 주소";

export interface BrowserTarget {
  /** ASCII host only: no scheme, userinfo, port, path, query or fragment. Null when there is no web host. */
  host: string | null;
  place: BrowserTargetPlace;
  label: string;
}

const DOTTED_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const NUMERIC_HOST_SPELLING = /^[0-9a-fx.]+$/i;

/** The host exactly as written in the URL (after userinfo, before port); "" when it cannot be found. */
function writtenHost(raw: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/\\?#]*)/i.exec(raw.trim());
  if (!m) return "";
  const authority = m[1].slice(m[1].lastIndexOf("@") + 1);
  return authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.replace(/:\d*$/, "");
}

function displayHost(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
  const host = url.hostname;
  // `http://2130706433/` parses to 127.0.0.1. Showing the canonical form next to 인터넷 would read like a mistake,
  // so a numeric spelling the parser rewrote is shown as the learner's coach wrote it (it is ASCII by construction).
  const written = writtenHost(raw).toLowerCase();
  if (DOTTED_IPV4.test(host) && written && written !== host && NUMERIC_HOST_SPELLING.test(written)) return written;
  return host;
}

export function browserTarget(rawUrl: string | undefined): BrowserTarget {
  const raw = rawUrl ?? "";
  const place: BrowserTargetPlace = isLoopbackPreview(raw) ? "preview" : "internet";
  return { host: displayHost(raw), place, label: BROWSER_TARGET_LABELS[place] };
}

/** The approval body: the host on its own line, the label on the next. `about:blank` names no target. */
export function browserTargetDetail(rawUrl: string | undefined): string {
  if ((rawUrl ?? "").trim() === "about:blank") return BLANK_TARGET_TEXT;
  const t = browserTarget(rawUrl);
  return `${t.host ?? UNKNOWN_HOST_TEXT}\n${t.label}`;
}
