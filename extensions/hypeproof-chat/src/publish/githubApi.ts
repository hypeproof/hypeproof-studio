// Minimal GitHub REST client for the one-click publish.
//
// Why not Octokit: it would be a runtime dependency, and runtime dependencies of this
// extension must ship through `dist/vendor` (build-pipeline.md, #349) — a cost far larger than
// the dozen endpoints used here. Why not the `gh api` CLI: every call would be a process spawn
// with the token on the child's environment, and we need response headers (`x-oauth-scopes`,
// `retry-after`) that `gh api` only prints in a format we would then have to parse.
//
// Three rules, all from GitHub's REST rate-limit documentation
// (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
//   1. Requests are SERIALIZED. "Make requests for a single user serially instead of
//      concurrently" is the documented way to avoid secondary limits, and a classroom of
//      participants shares one NAT IP. The publish is a short chain anyway; parallelism would
//      save seconds and risk minutes.
//   2. `retry-after` is honored first, then `x-ratelimit-remaining: 0` + `x-ratelimit-reset`,
//      then (a secondary limit with neither header) a fixed one-minute wait, as documented.
//   3. A wait longer than `maxRateWaitMs` is NOT slept through: it becomes a `rate_limited`
//      error the participant can read, instead of a progress bar frozen for an hour.
//
// Pure apart from the injected `fetch`/`sleep`/`now`: no `vscode`, testable with a fake.

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or null when the body was empty / not JSON. */
  json: unknown;
}

/** Thrown for conditions the caller cannot handle per-endpoint (rate limit, network). */
export class GitHubTransportError extends Error {
  readonly kind: "rate_limited" | "network";
  constructor(kind: "rate_limited" | "network", message: string) {
    super(message);
    this.name = "GitHubTransportError";
    this.kind = kind;
  }
}

export interface GitHubApiOptions {
  base: string;
  token: string;
  deps: HttpDeps;
  /** Longest single rate-limit wait we sleep through (default 90 s). */
  maxRateWaitMs?: number;
  /** Per-request network timeout (default 30 s). */
  timeoutMs?: number;
}

const MAX_ATTEMPTS = 4;
/** Documented minimum wait for a secondary limit that carries no reset headers. */
const SECONDARY_WAIT_MS = 60_000;

export interface GitHubApi {
  request(method: string, path: string, body?: unknown): Promise<ApiResponse>;
}

export function createGitHubApi(opts: GitHubApiOptions): GitHubApi {
  const base = opts.base.replace(/\/+$/, "");
  const maxWait = opts.maxRateWaitMs ?? 90_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { deps } = opts;
  // The serialization queue. Each request chains on the previous one's settlement (success
  // OR failure), so one failed call never wedges the queue for the rest of the pipeline.
  let tail: Promise<unknown> = Promise.resolve();

  async function once(method: string, path: string, body: unknown): Promise<ApiResponse> {
    let res: Response;
    try {
      res = await deps.fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "HypeProof-Studio",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new GitHubTransportError("network", err instanceof Error ? err.message : String(err));
    }
    const text = await res.text().catch(() => "");
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, headers: res.headers, json };
  }

  /** How long to wait before retrying, or null when this response is not a rate limit. */
  function rateLimitWait(r: ApiResponse): number | null {
    if (r.status !== 403 && r.status !== 429) return null;
    const retryAfter = r.headers.get("retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter.trim())) return Number(retryAfter.trim()) * 1000;
    if (r.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(r.headers.get("x-ratelimit-reset") ?? "");
      if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - deps.now()) + 1000;
      return SECONDARY_WAIT_MS;
    }
    // A 403 is usually a permission answer (missing scope, not the owner). Only treat it as a
    // limit when GitHub says so in the message — otherwise we would sleep a minute and then
    // report a scope problem anyway.
    const message = String((r.json as { message?: unknown } | null)?.message ?? "");
    if (r.status === 429 || /rate limit/i.test(message)) return SECONDARY_WAIT_MS;
    return null;
  }

  async function run(method: string, path: string, body: unknown): Promise<ApiResponse> {
    for (let attempt = 1; ; attempt++) {
      let r: ApiResponse;
      try {
        r = await once(method, path, body);
      } catch (err) {
        // A dropped connection on classroom Wi-Fi is the common case; two short retries cover
        // it. Writes are retried too: every write in the pipeline is idempotent or is re-read
        // and reconciled by the caller (repo create → 422 → re-GET; ref update → fast-forward only).
        if (attempt >= 3) throw err;
        await deps.sleep(1000 * attempt);
        continue;
      }
      const wait = rateLimitWait(r);
      if (wait !== null) {
        if (wait > maxWait || attempt >= MAX_ATTEMPTS) {
          throw new GitHubTransportError("rate_limited", `GitHub rate limit (${r.status}); retry in ${Math.ceil(wait / 1000)} s`);
        }
        await deps.sleep(wait);
        continue;
      }
      if (r.status >= 500 && r.status <= 504 && attempt < 3) {
        await deps.sleep(2000 * attempt);
        continue;
      }
      return r;
    }
  }

  return {
    request(method, path, body) {
      const next = tail.then(
        () => run(method, path, body),
        () => run(method, path, body),
      );
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** The `message` field GitHub puts on error bodies, for logs and Korean error details. */
export function ghMessage(r: ApiResponse): string {
  return String((r.json as { message?: unknown } | null)?.message ?? "");
}

/** `x-oauth-scopes: repo, workflow` → {"repo","workflow"}; null when the header is absent. */
export function parseOAuthScopes(header: string | null | undefined): Set<string> | null {
  if (header === null || header === undefined) return null;
  return new Set(
    header
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export const REQUIRED_SCOPES = ["repo", "workflow"] as const;

/**
 * Which required scopes are missing. A null set (no `x-oauth-scopes` header — fine-grained
 * PATs and GitHub App tokens do not send one) means "unknown", which is reported as nothing
 * missing: we cannot prove a gap, and a real gap still surfaces as a 403/404 on the write
 * that needs it, where it is mapped to `missing_scope`.
 */
export function missingScopes(scopes: Set<string> | null): string[] {
  if (!scopes) return [];
  return REQUIRED_SCOPES.filter((s) => !scopes.has(s));
}
