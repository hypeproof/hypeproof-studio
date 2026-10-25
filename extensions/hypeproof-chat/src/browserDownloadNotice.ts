// CGP-KNOW-R-021 (REQ-STUDIO-BROWSER-DOWNLOADS) — the words of a download line.
//
// Shared by the host (which writes the line) and the webview and task store (which accept
// only a line this module could have produced). No Node or vscode imports: the webview
// bundles it.

export type DownloadDenyCause = "profile-unknown" | "safe-session" | "no-workspace" | "bad-folder";

// C0/C1 controls, bidi marks/embeddings/overrides/isolates, U+2028/2029, BOM, zero-width joiners.
const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069\ufeff]/gu;
const DISPLAY_MAX = 80;

/** A file name as the learner sees it: no control or direction characters, at most 80 characters. */
export function displayFileName(raw: unknown): string {
  const clean = (typeof raw === "string" ? raw : "").replace(UNSAFE_DISPLAY, "").trim();
  if (!clean) return "이름 없는 파일";
  const chars = Array.from(clean);
  return chars.length > DISPLAY_MAX ? `${chars.slice(0, DISPLAY_MAX - 1).join("")}…` : clean;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "크기 모름";
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export type DownloadFailure = DownloadDenyCause | "interrupted" | "not-found" | "folder-changed" | "unobserved";

const DENY_COPY: Record<DownloadDenyCause, string> = {
  "profile-unknown": "이용 정보를 아직 확인하지 못해 받을 수 없어요. 잠시 뒤 다시 받아 보세요.",
  "safe-session": "수업용 안전 브라우저에서는 파일을 내려받을 수 없어요.",
  "no-workspace": "열린 작업 폴더가 없어 저장할 곳이 없어요.",
  "bad-folder": "작업 폴더의 downloads가 폴더가 아니거나 다른 곳을 가리켜요. 그 항목의 이름을 바꾼 뒤 다시 받아 보세요.",
};
const FAIL_COPY: Record<Exclude<DownloadFailure, DownloadDenyCause>, string> = {
  interrupted: "받는 중에 멈췄어요(취소되었거나 연결이 끊겼어요). 다시 받아 보세요.",
  "not-found": "받은 파일을 downloads 폴더에서 찾지 못했어요.",
  "folder-changed": "받는 동안 downloads 폴더가 바뀌어 저장된 곳을 확인하지 못했어요.",
  unobserved: "탭이 닫혀 끝까지 확인하지 못했어요. downloads 폴더에서 파일을 확인해 보세요.",
};

const DONE_PREFIX = "다운로드 완료: downloads/";
const FAILED_PREFIX = "다운로드 실패: ";
const BLOCKED_PREFIX = "다운로드 막힘: ";
const LABEL_MAX = 400;

/** One timeline line. `done` only after the file was found as a regular file inside `downloads/`. */
export interface DownloadNotice {
  state: "done" | "error";
  label: string;
}

/**
 * Chromium overwrites a same-name file in `downloads/` and has already reserved the target by
 * the time `downloadWillBegin` arrives, so "replaced an older copy" cannot be told apart from
 * "this download's own placeholder". The line therefore makes no such claim.
 */
export function downloadDoneNotice(name: string, size: number): DownloadNotice {
  return { state: "done", label: `${DONE_PREFIX}${displayFileName(name)} (${formatBytes(size)})` };
}

export function downloadFailedNotice(name: unknown, cause: DownloadFailure): DownloadNotice {
  const blocked = cause === "profile-unknown" || cause === "safe-session" || cause === "no-workspace" || cause === "bad-folder";
  const text = blocked ? DENY_COPY[cause] : FAIL_COPY[cause];
  return { state: "error", label: `${blocked ? BLOCKED_PREFIX : FAILED_PREFIX}${displayFileName(name)} — ${text}` };
}

/** Is `label` a download line this host could have written (stored history and webview posts are re-checked)? */
export function isDownloadNoticeLabel(label: unknown, state: unknown): boolean {
  if (typeof label !== "string" || label.length > LABEL_MAX || new RegExp(UNSAFE_DISPLAY.source, "u").test(label)) return false;
  if (state === "done") return label.startsWith(DONE_PREFIX) && label.length > DONE_PREFIX.length;
  if (state === "error") return (label.startsWith(FAILED_PREFIX) || label.startsWith(BLOCKED_PREFIX)) && label.includes(" — ");
  return false;
}
