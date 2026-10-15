// Minimal GitHub REST client for the one-click publish.
//
// Every request goes through the GitHub CLI (`gh api`) in the shipped app. The class already
// installs and signs in `gh` (githubAuth.ts), so `gh` holds the credential end to end: the
// token is never put on a request by this extension. Why not Octokit: it would be a runtime
// dependency, and runtime dependencies of this extension must ship through `dist/vendor`
// (build-pipeline.md, #349) — a cost far larger than the dozen endpoints used here.
//
// What stays here is the part `gh api` does not do for us. Three rules, all from GitHub's REST
// rate-limit documentation (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
//   1. Requests are SERIALIZED. "Make requests for a single user serially instead of
//      concurrently" is the documented way to avoid secondary limits, and a classroom of
//      participants shares one NAT IP. The publish is a short chain anyway; parallelism would
//      save seconds and risk minutes.
//   2. `retry-after` is honored first, then `x-ratelimit-remaining: 0` + `x-ratelimit-reset`,
//      then (a secondary limit with neither header) a fixed one-minute wait, as documented.
//      `gh api --include` prints the status line and headers, so these are read from it.
//   3. A wait longer than `maxRateWaitMs` is NOT slept through: it becomes a `rate_limited`
//      error the participant can read, instead of a progress bar frozen for an hour.
//
// The transport is injected: `createGhTransport` in the app, `createFetchTransport` only for a
// scripted GitHub on loopback (tests, publishConfig.ts). No `vscode` import, testable with a fake.

import type { ExecFileFn } from "./githubAuth.ts";

export interface HttpDeps {
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

/**
 * One HTTP exchange with the REST API: `path` is relative to the API root (`/user`,
 * `/repos/o/r/git/refs/heads/main`). Resolves for every HTTP status; throws
 * `GitHubTransportError("network")` only when no response arrived.
 */
export type GitHubTransport = (method: string, path: string, body: unknown) => Promise<ApiResponse>;

export interface GitHubApiOptions {
  transport: GitHubTransport;
  deps: HttpDeps;
  /** Longest single rate-limit wait we sleep through (default 90 s). */
  maxRateWaitMs?: number;
}

const MAX_ATTEMPTS = 4;
/** Documented minimum wait for a secondary limit that carries no reset headers. */
const SECONDARY_WAIT_MS = 60_000;

export interface GitHubApi {
  request(method: string, path: string, body?: unknown): Promise<ApiResponse>;
}

export function createGitHubApi(opts: GitHubApiOptions): GitHubApi {
  const maxWait = opts.maxRateWaitMs ?? 90_000;
  const { deps } = opts;
  // The serialization queue. Each request chains on the previous one's settlement (success
  // OR failure), so one failed call never wedges the queue for the rest of the pipeline.
  let tail: Promise<unknown> = Promise.resolve();

  async function once(method: string, path: string, body: unknown): Promise<ApiResponse> {
    try {
      return await opts.transport(method, path, body);
    } catch (err) {
      if (err instanceof GitHubTransportError) throw err;
      throw new GitHubTransportError("network", err instanceof Error ? err.message : String(err));
    }
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

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface GhTransportOptions {
  execFile: ExecFileFn;
  /** The resolved `gh` executable (githubAuth.ts `GhCliAuthProvider.bin`). */
  bin: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout (default 60 s: a blob upload carries a base64 photo). */
  timeoutMs?: number;
}

/**
 * `gh api --include` output → status, headers, body. The first line is the status line
 * (`HTTP/2.0 404 Not Found`), then `Name: value` headers, a blank line, and the body. Null when
 * the output is not a response at all (gh failed before one arrived).
 */
export function parseGhInclude(stdout: string): ApiResponse | null {
  const m = /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/.exec(stdout);
  if (!m) return null;
  const rest = stdout.slice(m[0].length);
  const sep = /\r?\n\r?\n/.exec(rest);
  const head = sep ? rest.slice(0, sep.index) : rest;
  const body = sep ? rest.slice(sep.index + sep[0].length) : "";
  const headers = new Headers();
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return { status: Number(m[1]), headers, json: parseJson(body.trim()) };
}

/**
 * The shipped transport: one `gh api` process per request. `gh` attaches the participant's
 * credential itself; this extension only names the method, path and JSON body (on stdin, so
 * a photo's base64 never sits on an argument vector). `gh` exits non-zero on a 4xx/5xx but
 * still prints the response, which is what the pipeline reads — the exit code is ignored
 * whenever a status line came back.
 */
export function createGhTransport(opts: GhTransportOptions): GitHubTransport {
  const timeout = opts.timeoutMs ?? 60_000;
  return async (method, path, body) => {
    const bin = await opts.bin();
    const args = [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      "--include",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
      ...(body !== undefined ? ["-H", "Content-Type: application/json", "--input", "-"] : []),
      path,
    ];
    return await new Promise<ApiResponse>((resolve, reject) => {
      let child: ReturnType<ExecFileFn>;
      try {
        child = opts.execFile(
          bin,
          args,
          { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...(opts.env ? { env: opts.env } : {}) },
          (err, stdout, stderr) => {
            const r = parseGhInclude(String(stdout ?? ""));
            if (r) return resolve(r);
            const why = String(stderr ?? "").trim() || (err ? err.message : "no output");
            // gh lost its login between the token probe and this call: answer the way GitHub
            // would, so the auth step starts a fresh sign-in instead of reporting a network fault.
            if (/gh auth login/i.test(why)) return resolve({ status: 401, headers: new Headers(), json: { message: why } });
            reject(new GitHubTransportError("network", `gh api ${method} ${path}: ${why.slice(0, 300)}`));
          },
        );
      } catch (err) {
        reject(new GitHubTransportError("network", err instanceof Error ? err.message : String(err)));
        return;
      }
      // Always close stdin: with no body, an open pipe is something gh could wait on.
      try {
        child.stdin?.end(body !== undefined ? JSON.stringify(body) : undefined);
      } catch {
        /* the process is already gone; the callback reports it */
      }
    });
  };
}

export interface FetchTransportOptions {
  /** API root, e.g. `http://127.0.0.1:18941/api`. Loopback only (publishConfig.ts). */
  base: string;
  token: string;
  fetch: typeof fetch;
  /** Per-request network timeout (default 30 s). */
  timeoutMs?: number;
}

/**
 * Plain HTTP to a scripted GitHub on this machine (tests, the e2e mock). Never used against
 * github.com: there the credential stays inside `gh` (createGhTransport).
 */
export function createFetchTransport(opts: FetchTransportOptions): GitHubTransport {
  const base = opts.base.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (method, path, body) => {
    let res: Response;
    try {
      res = await opts.fetch(`${base}${path}`, {
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
    return { status: res.status, headers: res.headers, json: parseJson(text) };
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
