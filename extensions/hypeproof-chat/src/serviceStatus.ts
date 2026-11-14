// CGP-AGENT-R-031 / CGP-AGENT-D-027 (REQ-CGP-AGENT-66): "AI가 지금 붐벼요" before send.
//
// The Service serves `GET /v1/service-status` → `{busy: boolean}` to an authenticated participant
// seat (hypeproof-service#465). The body names no provider. This module is DOM-free and imports
// nothing from vscode, so test/service-status.smoke.mjs drives it with a scripted fetch.
//
// Fail quiet: only an explicit `busy: true` from a 200 shows the banner. A network error, a timeout,
// a 401, or a 404 from a Service without the route all read as not busy. A seat the route does
// not serve (401/403/404) stops asking, and errors back off (nextServiceStatusAt). The offline banner
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
 * What one ask found. `unserved` (401/403/404) means this seat is not served the route: stop asking
 * until its token or the Service address changes. `error` (network, timeout, 5xx, bad body) backs off.
 */
export type ServiceStatusAnswer = { busy: boolean; outcome: 'ok' | 'unserved' | 'error' | 'skipped' };

/**
 * Ask the Service once. No token means no request: a seat that is not signed in has nothing to
 * ask and shows nothing.
 */
export async function askServiceStatus(fetchImpl: FetchLike, args: { proxyUrl: string; token: string | undefined; timeoutMs?: number }): Promise<ServiceStatusAnswer> {
  if (!args.token) return { busy: false, outcome: 'skipped' };
  try {
    const res = await fetchImpl(serviceStatusUrl(args.proxyUrl), {
      headers: { authorization: `Bearer ${args.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(args.timeoutMs ?? SERVICE_STATUS_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) return { busy: false, outcome: 'unserved' };
    if (!res.ok) return { busy: false, outcome: 'error' };
    return { busy: parseServiceStatus(await res.json()), outcome: 'ok' };
  } catch {
    return { busy: false, outcome: 'error' };
  }
}

/** The boolean alone, for callers that only need it. */
export async function fetchServiceBusy(fetchImpl: FetchLike, args: { proxyUrl: string; token: string | undefined; timeoutMs?: number }): Promise<boolean> {
  return (await askServiceStatus(fetchImpl, args)).busy;
}

/** Longest wait between asks after repeated errors. */
export const SERVICE_STATUS_MAX_BACKOFF_MS = 15 * 60_000;

/**
 * Pure: when the next ask may go out. A good answer keeps the normal minute; each error in a row
 * doubles the wait up to SERVICE_STATUS_MAX_BACKOFF_MS; an unserved seat never asks again
 * (until a remount resets the state).
 */
export function nextServiceStatusAt(now: number, outcome: ServiceStatusAnswer['outcome'], errorsInRow: number): number {
  if (outcome === 'unserved') return Number.POSITIVE_INFINITY;
  if (outcome === 'error') return now + Math.min(SERVICE_STATUS_POLL_MS * 2 ** Math.max(0, errorsInRow), SERVICE_STATUS_MAX_BACKOFF_MS);
  return now + SERVICE_STATUS_POLL_MS - 1_000;
}
