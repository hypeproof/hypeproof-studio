// Pure helpers used by reportProblem.ts. Kept in a separate file so tests
// can import them without dragging in the `vscode` host module. Do NOT import
// anything from "vscode" or any side-effectful Node module here.

import type { ChatMessage } from "./protocol";
import { contentBytes, type OutboundConfirmation, type OutboundItem } from "./outboundConsent.ts";

/**
 * Hash a JWT-ish identifier with SHA-256, return the first 16 hex chars.
 * Stable across runs (same input → same hash). The Worker also computes a
 * server-authoritative hash from the Bearer token; this client copy is
 * mostly useful when the token is too broken to verify server-side (so we
 * can still correlate multiple reports from the same user).
 */
export async function hashJti(jti: string): Promise<string> {
  const data = new TextEncoder().encode(jti);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

/**
 * Extract the jti from a HypeProof v2 token WITHOUT verifying the signature.
 * The Worker re-verifies properly; we just need a stable opaque id for
 * client-side correlation (e.g., attach to the metadata blob even when the
 * server can't verify the token).
 *
 * Token format: <base64url(payload)>.<base64url(sig)>
 * payload JSON contains a `jti` field for v2 tokens.
 */
export function extractJtiUnverified(token: string): string | undefined {
  try {
    const [payloadB64] = token.split(".", 2);
    if (!payloadB64) return undefined;
    const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const payload = JSON.parse(json) as { jti?: string };
    return payload.jti;
  } catch {
    return undefined;
  }
}

/**
 * Strip recent turns to the last 3 messages and cap each content at 2000
 * chars. Drops system messages entirely — system messages aren't shown to
 * the user anyway, and they may contain prompt-engineering context we don't
 * want to leak in a bug report.
 *
 * Defense in depth — the Worker also enforces this (see report.ts), but
 * no need to send the giant payload if the user opted in.
 */
export function sanitizeRecentTurns(
  turns: ChatMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return turns
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-3)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content ?? "").slice(0, 2000),
    }));
}

export interface SubmitResult { ok: true; reportId: string }
export interface SubmitFail { ok: false; reason: string; httpStatus?: number }

/**
 * REQ-KNOW-09 (CGP-KNOW-R-006): what a problem report sends, item by item, to whom. The description and contact are the
 * learner's own words, and the optional recent turns are their conversation, so the report is confirmed like every other
 * outbound action. Sizes are of the exact JSON each part takes in the frozen body.
 */
export function reportManifestItems(body: { description?: unknown; contact?: unknown; recent_turns?: unknown; attachments?: unknown; request_id?: unknown; profile_id?: unknown }): OutboundItem[] {
  const size = (v: unknown) => contentBytes(JSON.stringify(v ?? null));
  const items: OutboundItem[] = [{ name: "내가 쓴 문제 설명", bytes: size(body.description) }];
  if (typeof body.contact === "string" && body.contact) items.push({ name: "내가 적은 연락처", bytes: size(body.contact) });
  if (Array.isArray(body.recent_turns)) body.recent_turns.forEach((t: { role?: string }, i: number) => items.push({ name: `최근 대화 ${i + 1} · ${t?.role === "user" ? "내가 보낸 말" : "AI의 답"}`, bytes: size(t) }));
  items.push({ name: "앱 정보 (버전·운영체제·요청 번호·프로필)", bytes: size({ attachments: body.attachments, request_id: body.request_id, profile_id: body.profile_id }) });
  return items;
}
export const reportRecipient = (proxyBase: string): string => { let host = "알 수 없는 주소"; try { host = new URL(proxyBase).host; } catch { /* shown as unknown */ } return `Studio 운영팀 (문제 신고 채널) · ${host}`; };

/**
 * Freeze the body and ask. Returns the exact JSON to send, or null: Cancel, a closed dialog, an invalid manifest or no
 * confirmation adapter authorize nothing. The caller POSTs the returned string unchanged (postProblemReport).
 */
export async function confirmProblemReport(proxyBase: string, body: Record<string, unknown>, confirm: OutboundConfirmation | undefined): Promise<string | null> {
  const frozen = JSON.stringify(body);
  if (!confirm || !await confirm({ recipient: reportRecipient(proxyBase), items: reportManifestItems(JSON.parse(frozen)) })) return null;
  return frozen;
}

export async function postProblemReport(proxyBase: string, frozen: string, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<SubmitResult | SubmitFail> {
  const url = proxyBase.replace(/\/+$/, "") + "/report";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = "Bearer " + token;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers, body: frozen });
  } catch (err) {
    return { ok: false, reason: `네트워크 오류: ${(err as Error).message}` };
  }
  if (res.status === 429) {
    return { ok: false, reason: "신고가 너무 자주 들어오고 있어요. 잠시 후 다시 시도해주세요.", httpStatus: 429 };
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { error?: { message?: string } | string };
      const msg = typeof json.error === "string" ? json.error : json.error?.message;
      if (msg) detail = msg;
    } catch { /* fallthrough */ }
    return { ok: false, reason: detail, httpStatus: res.status };
  }
  try {
    const j = (await res.json()) as { report_id?: string };
    if (!j.report_id) return { ok: false, reason: "서버 응답에 report_id가 없어요." };
    return { ok: true, reportId: j.report_id };
  } catch (err) {
    return { ok: false, reason: `응답 파싱 실패: ${(err as Error).message}` };
  }
}
