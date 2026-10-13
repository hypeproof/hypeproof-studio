// GitHub credentials for the one-click publish.
//
// The default provider reuses the GitHub CLI's login. Rationale:
//   - The class already installs and logs in `gh` (`gh auth login -s workflow` is the
//     pre-class task, D7 ④; dependencies.yaml lists gh as required), so the participant has
//     exactly one GitHub login on the machine and we do not add a second one.
//   - The device flow `gh` runs is GitHub CLI's own OAuth app. Using it needs no OAuth app
//     registration by HypeProof and puts no client id in the App (plan §4-1).
//   - The token never touches disk on our side: it is read per run (`gh auth token`) and held
//     only in memory for that run.
//
// `AuthProvider` is the seam for a native device-flow provider later (client id served by the
// profile). It is not implemented now: nothing in the profile carries a client id yet, and an
// unused second login path would be one more thing for a participant to end up half-inside.
//
// No shell anywhere: `execFile` with an argument vector, so a workspace or login string can
// never become shell syntax.

import type { ChildProcess } from "node:child_process";

/** Interactive authorization in progress: show `code`, wait on `done`. */
export interface PendingUserAuth {
  code: string;
  verificationUri: string;
  /** Resolves true when the provider now holds a token with the requested scopes. */
  done: Promise<boolean>;
  cancel(): void;
}

export interface AuthProvider {
  readonly kind: string;
  /** The current token, or null when nobody is signed in. Throws `AuthToolMissingError`. */
  token(): Promise<string | null>;
  /**
   * Start (or join) an interactive authorization that ends with `scopes` granted.
   * `signedIn` picks between adding scopes to the existing login and a fresh login.
   */
  beginUserAuth(scopes: readonly string[], signedIn: boolean): Promise<PendingUserAuth & { joined: boolean }>;
}

export class AuthToolMissingError extends Error {
  constructor(message = "gh not found") {
    super(message);
    this.name = "AuthToolMissingError";
  }
}

/** Node's `execFile` (callback form) — injected so tests can script `gh`. */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv; windowsHide?: boolean },
  callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void,
) => Pick<ChildProcess, "stdout" | "stderr" | "stdin" | "kill">;

/**
 * `! First copy your one-time code: ABCD-1234`. Anchored on the label, as the github-repo
 * skill learned the hard way: grabbing any 8-character token from the log can read out a
 * different string and send the participant to type the wrong code.
 */
export const DEVICE_CODE_PATTERN = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/;
const DEVICE_URI_PATTERN = /(https:\/\/github\.com\/login\/device)/;
export const DEFAULT_VERIFICATION_URI = "https://github.com/login/device";

export interface GhCliOptions {
  execFile: ExecFileFn;
  platform: NodeJS.Platform;
  /** Explicit gh path (test/dev override). When set, it is the ONLY candidate. */
  ghPath?: string;
  env?: NodeJS.ProcessEnv;
  /** How long the device flow process may live (default 5 min; the class budget, not GitHub's 15). */
  userAuthTimeoutMs?: number;
  /** How long to wait for gh to print the one-time code (default 20 s). */
  codeWaitMs?: number;
}

/**
 * Where to look for `gh`. PATH first; then the standard install locations, because an app
 * started from the Dock/Finder may not see the login shell's PATH (VS Code resolves the shell
 * environment, but that resolution can time out on a slow profile), and "gh is not installed"
 * would then be a false diagnosis for a participant who did install it.
 */
export function ghCandidates(platform: NodeJS.Platform, override?: string): string[] {
  if (override) return [override];
  if (platform === "darwin") return ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
  if (platform === "win32") return ["gh", "C:\\Program Files\\GitHub CLI\\gh.exe", "C:\\Program Files (x86)\\GitHub CLI\\gh.exe"];
  return ["gh", "/usr/local/bin/gh", "/usr/bin/gh"];
}

function run(
  execFile: ExecFileFn,
  file: string,
  args: readonly string[],
  opts: { timeout: number; env?: NodeJS.ProcessEnv },
): Promise<{ ok: boolean; missing: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: opts.timeout, maxBuffer: 1024 * 1024, windowsHide: true, ...(opts.env ? { env: opts.env } : {}) }, (err, stdout, stderr) => {
        const missing = !!err && (err as { code?: unknown }).code === "ENOENT";
        resolve({ ok: !err, missing, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      });
    } catch {
      resolve({ ok: false, missing: true, stdout: "", stderr: "" });
    }
  });
}

export function createGhCliAuthProvider(opts: GhCliOptions): AuthProvider {
  let resolvedGh: string | null = null;
  let pending: { scopesKey: string; auth: PendingUserAuth; settled: boolean } | null = null;

  async function gh(): Promise<string> {
    if (resolvedGh) return resolvedGh;
    for (const candidate of ghCandidates(opts.platform, opts.ghPath)) {
      const r = await run(opts.execFile, candidate, ["--version"], { timeout: 10_000, env: opts.env });
      if (!r.missing && /gh version/i.test(r.stdout + r.stderr)) {
        resolvedGh = candidate;
        return candidate;
      }
    }
    throw new AuthToolMissingError();
  }

  return {
    kind: "gh_cli",

    async token() {
      const bin = await gh();
      const r = await run(opts.execFile, bin, ["auth", "token", "--hostname", "github.com"], { timeout: 15_000, env: opts.env });
      const t = r.stdout.trim();
      // Anything but a single token-shaped line (a warning, an upgrade notice) is not a token.
      return r.ok && /^[A-Za-z0-9_]{20,255}$/.test(t) ? t : null;
    },

    async beginUserAuth(scopes, signedIn) {
      const scopesKey = [...scopes].sort().join(",") + (signedIn ? "|refresh" : "|login");
      // Join a flow that is still running instead of starting a second one: two device flows
      // means two codes on screen, and the participant types the stale one.
      // `joined` lets the caller tell "the participant just got this code" (answer at once so
      // the code reaches them) from "they were already given it" (worth waiting a little).
      if (pending && !pending.settled && pending.scopesKey === scopesKey) return { ...pending.auth, joined: true };
      if (pending && !pending.settled) pending.auth.cancel();

      const bin = await gh();
      const args = signedIn
        ? ["auth", "refresh", "--hostname", "github.com", "--scopes", scopes.join(",")]
        : ["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--scopes", scopes.join(",")];
      const timeout = opts.userAuthTimeoutMs ?? 5 * 60_000;

      const fresh = await new Promise<PendingUserAuth>((resolve, reject) => {
        let output = "";
        let delivered = false;
        let resolveDone!: (v: boolean) => void;
        const done = new Promise<boolean>((r) => (resolveDone = r));
        let child: ReturnType<ExecFileFn>;
        try {
          child = opts.execFile(bin, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true, ...(opts.env ? { env: opts.env } : {}) }, (err) => {
            resolveDone(!err);
            if (pending && pending.auth === auth) pending.settled = true;
            if (!delivered) {
              delivered = true;
              clearTimeout(codeTimer);
              reject(new Error(`gh ${args[1]} ended before printing a code: ${output.slice(-300)}`));
            }
          });
        } catch (err) {
          reject(err);
          return;
        }
        // Non-TTY stdin: gh prints the code and the URL and skips "Press Enter to open the
        // browser" (measured 2026-10-13 with gh 2.89). Closing stdin makes sure no prompt can
        // ever wait on us.
        try {
          child.stdin?.end();
        } catch {
          /* already closed */
        }
        const auth: PendingUserAuth = {
          code: "",
          verificationUri: DEFAULT_VERIFICATION_URI,
          done,
          cancel: () => {
            try {
              child.kill();
            } catch {
              /* already gone */
            }
          },
        };
        const onData = (chunk: unknown) => {
          output += String(chunk);
          if (delivered) return;
          const m = DEVICE_CODE_PATTERN.exec(output);
          if (!m) return;
          delivered = true;
          clearTimeout(codeTimer);
          auth.code = m[1]!;
          auth.verificationUri = DEVICE_URI_PATTERN.exec(output)?.[1] ?? DEFAULT_VERIFICATION_URI;
          pending = { scopesKey, auth, settled: false };
          resolve(auth);
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        const codeTimer = setTimeout(() => {
          if (delivered) return;
          delivered = true;
          auth.cancel();
          reject(new Error("gh did not print a one-time code in time"));
        }, opts.codeWaitMs ?? 20_000);
      });
      return { ...fresh, joined: false };
    },
  };
}
