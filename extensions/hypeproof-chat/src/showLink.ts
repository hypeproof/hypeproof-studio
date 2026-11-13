// REQ-STUDIO-SHOW-LINK (#3794 slice 2) — "링크로 보여주기": after "이대로 할래요", a separate step that shows
// exactly what will be uploaded, asks for the consent item, and only on the person's press stores the
// composition in the Service (hypeproof-service /v1/me/show-links) and shows a private, read-only link the
// person can copy and turn off ("링크 끄기"). Pure and vscode-free: copy, the share-step reducer, the bundle
// (what is sent, byte for byte) and the checks on what comes back. No model call.
//
// What is sent: the composition (index.html, the show-what-i-made/1 template, regenerated from the person's
// own answers exactly as it played), the one material picture as it was copied into the show folder, and the
// four vendored playback files from Studio's own media folder, each pinned by sha256 (media/show/VENDORED.json).
// The Service refuses anything else. Nothing is sent before the press; opening the step only reads the
// person's own link list and consent state with their account session.

import { createHash, randomBytes } from "node:crypto";
import { SHOW_ANIME_FILE, SHOW_FONT_FILE, SHOW_PLAYER_FILE, SHOW_RUNTIME_FILE } from "./showWhatIMade.ts";

/** The consent item, its version (hypeproof-service lib/show-links.ts SHOW_CONSENT_VERSION) and its text. */
export const SHOW_CONSENT_VERSION = "2026-11-12.5";
export const SHOW_CONSENT_ITEM = "내가 만든 것을 영상·링크로 공유";

/** Cross-repo template digest, same inputs and value as hypeproof-service lib/show-template.ts. */
export const SHOW_TEMPLATE_FIXTURE = { headline: "우리 반 친구들이 쓰는 투표 앱 & <첫 화면>", audience: "우리 반 친구들", materialFile: "material-1.png" } as const;
export const SHOW_TEMPLATE_FIXTURE_SHA256 = "e1edb4dc57210819ca54c4ef1936a6a7e3af747a747de27b849653f546c89467";

/** The Service's per-upload cap on the picture (lib/show-links.ts SHOW_LIMITS.materialBytes). */
export const SHOW_LINK_MATERIAL_BYTES = 10 * 1024 * 1024;

export const SHOW_LINK_COPY = {
  open: "링크로 보여주기",
  heading: "링크로 보여주기",
  intro: "‘링크 만들기’를 누르면 아래 파일을 HypeProof 서버의 내 계정에 올리고, 이 장면을 볼 수 있는 링크를 만들어요. 누르기 전에는 아무것도 보내지 않아요.",
  filesHeading: "올라가는 파일",
  fileScene: "장면",
  fileMaterial: "내 작품 그림",
  filePlayback: "재생 파일 (누구나 쓰는 공개 파일, 바꾸지 않음)",
  textHeading: "링크를 연 사람이 보는 글",
  textHeadline: (s: string) => `제목: ${s}`,
  textClosing: (s: string) => `마지막 화면: 내가 만든 것 · ${s}에게`,
  who: "링크를 아는 사람은 누구나 볼 수 있어요. 로그인 없이 열리고, 검색에는 나오지 않아요. ‘링크 끄기’를 누르면 바로 열리지 않고, 올린 장면과 그림도 지워요.",
  consentLabel: SHOW_CONSENT_ITEM,
  consentDetail: "위 파일을 내 계정에 저장하고, 링크를 받은 사람에게 이 장면을 보여 주는 데 동의해요. 동의를 거두면 내 링크가 모두 꺼져요.",
  consentGiven: "이미 동의했어요.",
  consentNeeded: "링크를 만들려면 동의에 표시해 주세요.",
  create: "링크 만들기",
  back: "돌아가기",
  creating: "링크를 만들고 있어요…",
  sharedHeading: "링크를 만들었어요",
  sharedHint: "보여 주고 싶은 사람에게 이 링크를 보내 주세요.",
  linkLabel: "링크",
  copy: "링크 복사",
  copied: "링크를 복사했어요.",
  copyFailed: "복사하지 못했어요. 링크를 직접 골라서 복사해 주세요.",
  revoke: "링크 끄기",
  revokedHeading: "링크를 껐어요",
  revokedHint: "이제 이 링크로는 열리지 않아요. 올린 장면과 그림도 지웠어요.",
  again: "새 링크 만들기",
  close: "닫기",
  signIn: "링크로 보여주려면 먼저 시작 화면에서 Google로 로그인해 주세요.",
  off: "아직 링크로 보여주기를 쓸 수 없어요.",
  failed: "링크를 만들지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.",
  revokeFailed: "링크를 끄지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.",
  linkLimit: "링크는 20개까지 켜 둘 수 있어요. 안 쓰는 링크를 먼저 꺼 주세요.",
  bytesLimit: "올린 파일이 계정에 허용된 크기(100MB)를 넘어요. 안 쓰는 링크를 먼저 꺼 주세요.",
  tooLarge: "그림이 10MB보다 커서 올릴 수 없어요. 더 작은 그림으로 다시 만들어 주세요.",
  daily: "오늘은 링크를 더 만들 수 없어요. 내일 다시 해 주세요.",
  changed: "장면 파일이 처음과 달라져서 올릴 수 없어요. ‘다시 할래요’로 장면을 새로 만들어 주세요.",
  consentChanged: "동의 내용이 바뀌었어요. 화면을 닫고 다시 열어 주세요.",
  size: (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`,
} as const;

/** A Service code (AccountError.code) as the line the person reads. */
export function showLinkMessage(code: string): string {
  switch (code) {
    case "unauthorized": case "authentication_required": case "invalid_token": case "session_revoked": case "http_401": return SHOW_LINK_COPY.signIn;
    case "not_found": case "show_not_ready": case "show_origin_unavailable": return SHOW_LINK_COPY.off;
    case "show_link_limit": return SHOW_LINK_COPY.linkLimit;
    case "show_bytes_limit": return SHOW_LINK_COPY.bytesLimit;
    case "file_too_large": return SHOW_LINK_COPY.tooLarge;
    case "rate_limited": return SHOW_LINK_COPY.daily;
    case "consent_version_changed": return SHOW_LINK_COPY.consentChanged;
    case "show_consent_required": return SHOW_LINK_COPY.consentNeeded;
    default: return /^(html_|material_|vendored_|file_|bundle_|duplicate_)/.test(code) ? SHOW_LINK_COPY.changed : SHOW_LINK_COPY.failed;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The share step

export type ShareStep = "closed" | "review" | "shared" | "revoked";

export interface ShareCounts { open: number; share: number; copy: number; revoke: number }

export interface ShareState {
  step: ShareStep;
  /** The Service already holds a current consent for the item. */
  consentGiven: boolean;
  link: { id: string; url: string } | null;
  counts: ShareCounts;
}

export type ShareEvent =
  | { type: "open"; consentGiven: boolean }
  | { type: "back" }
  | { type: "shared"; link: { id: string; url: string } }
  | { type: "copied" }
  | { type: "revoked" };

export function shareInitialState(): ShareState {
  return { step: "closed", consentGiven: false, link: null, counts: { open: 0, share: 0, copy: 0, revoke: 0 } };
}

/** An event that does not belong to the current step leaves the state unchanged (same object). */
export function shareReduce(state: ShareState, event: ShareEvent): ShareState {
  const c = state.counts;
  switch (event.type) {
    case "open":
      if (state.step !== "closed" && state.step !== "revoked") return state;
      return { ...state, step: "review", consentGiven: event.consentGiven, link: null, counts: { ...c, open: c.open + 1 } };
    case "back":
      if (state.step !== "review") return state;
      return { ...state, step: "closed" };
    case "shared":
      if (state.step !== "review") return state;
      return { ...state, step: "shared", consentGiven: true, link: event.link, counts: { ...c, share: c.share + 1 } };
    case "copied":
      if (state.step !== "shared") return state;
      return { ...state, counts: { ...c, copy: c.copy + 1 } };
    case "revoked":
      if (state.step !== "shared") return state;
      return { ...state, step: "revoked", counts: { ...c, revoke: c.revoke + 1 } };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The bundle

export const SHOW_LINK_VENDORED = [SHOW_PLAYER_FILE, SHOW_RUNTIME_FILE, SHOW_ANIME_FILE, SHOW_FONT_FILE] as const;

export interface BundleFile { path: string; role: "scene" | "material" | "playback"; data: Uint8Array }
export interface WireFile { path: string; sha256: string; bytes: number; data: string }

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * The exact list that is shown and sent: the composition, the picture, the four vendored files. Each vendored
 * file must still match its pin, so a changed copy is refused here before anything leaves the machine.
 */
export function showBundle(input: { html: string; materialFile: string; material: Uint8Array; vendored: Record<string, Uint8Array>; pins: Record<string, string> }): BundleFile[] | { error: "changed" | "tooLarge" } {
  if (input.material.length > SHOW_LINK_MATERIAL_BYTES) return { error: "tooLarge" };
  const files: BundleFile[] = [
    { path: "index.html", role: "scene", data: new TextEncoder().encode(input.html) },
    { path: input.materialFile, role: "material", data: input.material },
  ];
  for (const name of SHOW_LINK_VENDORED) {
    const data = input.vendored[name];
    if (!data || sha256(data) !== input.pins[name]) return { error: "changed" };
    files.push({ path: name, role: "playback", data });
  }
  return files;
}

export const wireFiles = (files: BundleFile[]): WireFile[] =>
  files.map((f) => ({ path: f.path, sha256: sha256(f.data), bytes: f.data.length, data: Buffer.from(f.data).toString("base64") }));

/** One id per press of "링크 만들기"; a retry of the same press reuses it, so a resend is the same link. */
export const shareRequestId = () => "show_" + randomBytes(12).toString("hex");

/**
 * A link the Service returned, before it is shown or copied. Production: exactly
 * https://show-<16 hex>-try.hypeproof-ai.xyz/<32 hex>/. A local preview Service (localhost) may answer with an
 * http `.test.invalid` or localhost host of the same shape.
 */
export function safeShowLink(value: unknown, production: boolean): value is string {
  if (typeof value !== "string" || value.length > 200) return false;
  if (/^https:\/\/show-[0-9a-f]{16}-try\.hypeproof-ai\.xyz\/[0-9a-f]{32}\/$/.test(value)) return true;
  if (production) return false;
  return /^http:\/\/show-[0-9a-f]{16}[.-][a-z0-9.-]*(?::\d{2,5})?\/[0-9a-f]{32}\/$/.test(value)
    && (/\.test\.invalid(?::\d+)?\//.test(value) || /\.localhost(?::\d+)?\//.test(value));
}

/** The local record beside the composition: link ids and counts only, never the person's words. */
export const SHOW_SHARE_SCHEMA = "hps-show-share/1";
export function showShareRecord(state: ShareState, links: { id: string; url: string; created: string; revoked: string | null }[], updated: Date) {
  return { schema: SHOW_SHARE_SCHEMA, links, counts: { ...state.counts }, updated: updated.toISOString() };
}
