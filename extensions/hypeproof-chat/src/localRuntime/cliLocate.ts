// The instructor's own CLI subscription on the release app (#3597, chalk#14).
// The app never reads a CLI's login file or token. It only asks the CLI's own status command whether it
// succeeded (exit status), and it only looks for the CLI's absolute path. Nothing from either is logged.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { subscriptionEnv } from "./process.mjs";

export type CliProvider = "claude" | "codex";

const BINARY: Record<CliProvider, string> = { claude: "claude", codex: "codex" };
// The CLI's own status command. Only its exit status is read.
const STATUS_ARGS: Record<CliProvider, string[]> = { claude: ["auth", "status"], codex: ["login", "status"] };
const LOGIN_CHECK_TIMEOUT_MS = 15000;

/** The child environment for CLI calls: vendor keys, HPS_* values and token-shaped names are removed. */
export function releaseCliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return subscriptionEnv(base);
}

/** Finds the CLI by name on PATH and in the usual user install folders. Returns an absolute path or null. */
export function locateCli(provider: CliProvider, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = process.platform === "win32" ? `${BINARY[provider]}.exe` : BINARY[provider];
  const dirs = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * True when the CLI's status command exits 0. The output is discarded: it is never returned, stored or logged.
 * A timeout or a spawn failure counts as not logged in.
 */
export function cliLoginOk(executable: string, provider: CliProvider): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, STATUS_ARGS[provider], {
        env: releaseCliEnv(),
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(false); }, LOGIN_CHECK_TIMEOUT_MS);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}
