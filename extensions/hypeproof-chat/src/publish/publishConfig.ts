// Where the publish talks to: GitHub's API and Pages host, or a local mock in tests.
//
// The overrides (`HPS_GITHUB_API_BASE`, `HPS_GITHUB_PAGES_BASE`, `HPS_GH_PATH`) exist so the
// e2e can run the real extension against a scripted GitHub. They are honored ONLY in a test
// run (the e2e fixture's HPS_TEST_E2E / test-state file, or HPS_E2E=1) or an Extension
// Development Host, and ONLY for loopback URLs. Reason: the API base receives the participant's
// GitHub token — a full `repo` credential. An environment variable is easy to plant (a shell
// profile, a launcher, another program), so in a shipped app an override must not be able to
// send that token anywhere, and even in a test run it may only point at this machine.
// `HPS_GH_PATH` is held to the same gate: whatever it names is executed and its stdout becomes
// the token.
//
// Pure; unit-tested in test/publish-host.smoke.mjs.

export const GITHUB_API_BASE = "https://api.github.com";

export interface PublishEndpoints {
  apiBase: string;
  pagesBase?: string;
  ghPath?: string;
  /** Overrides that were present but refused (for the developer log). */
  refused: string[];
}

export interface PublishOverrideSource {
  githubApiBase?: string;
  githubPagesBase?: string;
  ghPath?: string;
}

function isLoopbackHttp(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function resolvePublishEndpoints(args: {
  env: Record<string, string | undefined>;
  /** e2e fixture run (env HPS_TEST_E2E or the test-state file) or HPS_E2E=1. */
  testRun: boolean;
  /** vscode.ExtensionMode.Development. */
  devHost: boolean;
  /** Values from the e2e test-state file (env does not always reach the extension host). */
  testState?: PublishOverrideSource;
}): PublishEndpoints {
  const allowed = args.testRun || args.devHost || args.env["HPS_E2E"] === "1";
  const pick = (envKey: string, stateValue: string | undefined) => (args.env[envKey]?.trim() || stateValue?.trim() || undefined);
  const api = pick("HPS_GITHUB_API_BASE", args.testState?.githubApiBase);
  const pages = pick("HPS_GITHUB_PAGES_BASE", args.testState?.githubPagesBase);
  const gh = pick("HPS_GH_PATH", args.testState?.ghPath);
  const refused: string[] = [];
  const out: PublishEndpoints = { apiBase: GITHUB_API_BASE, refused };
  if (api) {
    if (allowed && isLoopbackHttp(api)) out.apiBase = api.replace(/\/+$/, "");
    else refused.push("HPS_GITHUB_API_BASE");
  }
  if (pages) {
    if (allowed && isLoopbackHttp(pages)) out.pagesBase = pages.replace(/\/+$/, "");
    else refused.push("HPS_GITHUB_PAGES_BASE");
  }
  if (gh) {
    if (allowed) out.ghPath = gh;
    else refused.push("HPS_GH_PATH");
  }
  return out;
}

/**
 * The tool path's time budget. The SDK stall watchdog aborts a turn after `stallMs` without
 * stream progress (default 240 s, #403), and a running MCP tool produces none. Finishing a
 * minute early leaves room for the approval modal and the result to stream back; a run that
 * needs longer answers "아직 만드는 중" and the coach re-checks with `check_only`.
 * `stallMs` 0 disables the watchdog, so the full documented bound applies.
 */
export function toolBudgetMs(stallMs: number | undefined): number {
  const s = typeof stallMs === "number" && Number.isFinite(stallMs) ? stallMs : 240_000;
  if (s <= 0) return 20 * 60_000;
  return Math.max(30_000, s - 60_000);
}

/** The button path waits as long as GitHub documents a deploy can take, twice (build + verify). */
export const BUTTON_BUDGET_MS = 20 * 60_000;
