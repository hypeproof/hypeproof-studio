// CGP-AGENT-R-031 / CGP-AGENT-D-027 (REQ-CGP-AGENT-66): "AI가 지금 붐벼요" before send.
//
// The Service serves `GET /v1/service-status` → `{busy: boolean}` to an authenticated participant
// seat (hypeproof-service#465). The body names no provider. This module is DOM-free and imports
// nothing from vscode, so test/service-status.smoke.mjs drives it with a scripted fetch.
//
// Fail quiet: only an explicit `busy: true` from a 200 shows the banner. A network error, a timeout,
// a 401, or a 404 from a Service without the route all read as not busy. The offline banner
// (CGP-SHELL-R-011) already covers a lost network, and a guess must never alarm a learner.

/** How often the panel asks while it is visible. */
export const SERVICE_STATUS_POLL_MS = 60_000;
/** A slow answer is dropped instead of holding a request open. */
export const SERVICE_STATUS_TIMEOUT_MS = 5_000;

/** `https://api…/v1` → `https://api…/v1/service-status`. */
export function serviceStatusUrl(proxyUrl: string): string {
  return proxyUrl.replace(/\/+$/, '') + '/service-status';
}

/** Only `{busy: true}` is busy. Anything else (missing, a string, null, an error body) is not. */
export function parseServiceStatus(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { busy?: unknown }).busy === true;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Ask the Service once. No token means no request: a seat that is not signed in has nothing to
 * ask and shows nothing.
 */
export async function fetchServiceBusy(fetchImpl: FetchLike, args: { proxyUrl: string; token: string | undefined; timeoutMs?: number }): Promise<boolean> {
  if (!args.token) return false;
  try {
    const res = await fetchImpl(serviceStatusUrl(args.proxyUrl), {
      headers: { authorization: `Bearer ${args.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(args.timeoutMs ?? SERVICE_STATUS_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    return parseServiceStatus(await res.json());
  } catch {
    return false;
  }
}
