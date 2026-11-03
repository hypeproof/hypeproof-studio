/**
 * TUX-COND-08 — the optional "이메일로 소식 받기" on a free seat's end card (Jay 2026-10-19).
 * Pure: no VS Code API. The host calls these with the seat's own credential.
 *
 * The address goes webview → host → Service (`POST /v1/free/notify-optin`) and nowhere else: it
 * is never written to settings, globalState, SecretStorage, logs or traces. The only thing kept
 * locally is a "this seat already submitted" flag, keyed by a hash of the credential, so a later
 * end card shows "소식을 보내 드릴게요." with "그만 받기" instead of the empty form.
 */
import { createHash } from "node:crypto";

export const NOTIFY_OPTIN_ROUTE = "/free/notify-optin";
/** globalState key of the submitted flags: `{ [seatKey]: true }`. Never an address. */
export const NOTIFY_SUBMITTED_KEY = "hypeproofChat.freeNotifySubmitted";
export const MAX_EMAIL_CHARS = 254;

const base = (proxyUrl: string) => proxyUrl.replace(/\/+$/, "");

/** A short, one-way key for the seat behind a credential. */
export function notifySeatKey(token: string): string {
  return createHash("sha256").update(`hps-notify/1\u0000${token}`).digest("hex").slice(0, 32);
}

/** The cheap shape check the host runs before calling the Service (which validates again). */
export function plausibleEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length > 0 && v.length <= MAX_EMAIL_CHARS && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export type NotifyOptinOutcome = { ok: true } | { ok: false; message: string };

export const NOTIFY_OPTIN_ERRORS = {
  invalid: "이메일 주소를 다시 확인해 주세요.",
  failed: "지금은 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
} as const;

/** The Service's own Korean sentence when it sent one, else the generic failure. */
async function refusal(r: Response): Promise<NotifyOptinOutcome> {
  try {
    const body = (await r.json()) as { error?: { message?: unknown } } | null;
    const m = body?.error?.message;
    if (typeof m === "string" && /[가-힣]/.test(m) && m.length <= 200) return { ok: false, message: m };
  } catch { /* not JSON */ }
  return { ok: false, message: NOTIFY_OPTIN_ERRORS.failed };
}

export async function submitNotifyOptin(proxyUrl: string, token: string, email: string, consentVersion: string, timeoutMs = 10_000): Promise<NotifyOptinOutcome> {
  try {
    const r = await fetch(`${base(proxyUrl)}${NOTIFY_OPTIN_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, consent: true, consent_version: consentVersion }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? { ok: true } : await refusal(r);
  } catch {
    return { ok: false, message: NOTIFY_OPTIN_ERRORS.failed };
  }
}

export async function withdrawNotifyOptin(proxyUrl: string, token: string, timeoutMs = 10_000): Promise<NotifyOptinOutcome> {
  try {
    const r = await fetch(`${base(proxyUrl)}${NOTIFY_OPTIN_ROUTE}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? { ok: true } : await refusal(r);
  } catch {
    return { ok: false, message: NOTIFY_OPTIN_ERRORS.failed };
  }
}

type Memento = { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> };

export function notifySubmitted(store: Memento | undefined, token: string | undefined): boolean {
  if (!store || !token) return false;
  try {
    const flags = store.get<Record<string, unknown>>(NOTIFY_SUBMITTED_KEY);
    return !!flags && flags[notifySeatKey(token)] === true;
  } catch {
    return false;
  }
}

export async function setNotifySubmitted(store: Memento | undefined, token: string, submitted: boolean): Promise<void> {
  if (!store) return;
  const flags = { ...(store.get<Record<string, true>>(NOTIFY_SUBMITTED_KEY) ?? {}) };
  if (submitted) flags[notifySeatKey(token)] = true;
  else delete flags[notifySeatKey(token)];
  await store.update(NOTIFY_SUBMITTED_KEY, flags);
}
