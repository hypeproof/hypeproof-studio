// DEC-11e (Jay 2026-11-04) — outward destinations the learner allowed, per activity and work folder.
//
// Like the publish-destination memory (publishRegistry.ts `remembersFor`, DEC-11b): once the learner allows a
// shell command that sends to a destination (a git remote address, an ssh host, an upload host), a later command
// to the same destination from the same activity and work folder runs without asking. Another destination,
// another folder or another activity asks again. Stored in the extension's globalState, so it survives a restart.
// Only destinations the reader could name are stored (shellOutward.ts); an unknown one is never remembered.
// Destination keys never carry credentials (shellOutward `gitDestination` / `urlDestination` drop them).
//
// Pure apart from the injected store (structurally `vscode.Memento`) and `runGitQuietly` below.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface OutwardStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export const OUTWARD_MEMORY_KEY = "hps.outward.destinations.v1";
/** Bounds, so a runaway agent cannot grow globalState without limit (the oldest entries go first). */
const MAX_SCOPES = 100;
const MAX_PER_SCOPE = 50;

/** The scope a destination is remembered in, or null when there is no activity or folder to tie it to. */
export function outwardScopeKey(parts: { cohort: string | null | undefined; activity: string | null | undefined; folder: string | null | undefined }): string | null {
  if (!parts.activity || !parts.folder) return null;
  return JSON.stringify([parts.cohort ?? null, parts.activity, parts.folder]);
}

export class OutwardMemory {
  private readonly store: OutwardStore;
  constructor(store: OutwardStore) { this.store = store; }

  private all(): Record<string, string[]> {
    const v = this.store.get<Record<string, string[]>>(OUTWARD_MEMORY_KEY);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  /** Every destination was allowed before in this scope (an empty list is never "remembered"). */
  remembersAll(scope: string | null, destinations: readonly string[]): boolean {
    if (!scope || destinations.length === 0) return false;
    const known = this.all()[scope];
    return Array.isArray(known) && destinations.every((d) => known.includes(d));
  }

  async remember(scope: string | null, destinations: readonly string[]): Promise<void> {
    if (!scope || destinations.length === 0) return;
    const current = this.all();
    const merged = [...(current[scope] ?? []).filter((d) => !destinations.includes(d)), ...destinations].slice(-MAX_PER_SCOPE);
    const { [scope]: _old, ...others } = current;
    const keep = Object.entries(others).slice(-(MAX_SCOPES - 1));
    await this.store.update(OUTWARD_MEMORY_KEY, { ...Object.fromEntries(keep), [scope]: merged });
  }
}

/**
 * Runs `git <args>` in `cwd` for shellOutward `resolveOutwardDestinations`: read-only config and remote queries,
 * no prompt, a short timeout. Null on any failure (the caller then treats the destination as unknown or literal).
 */
export function runGitQuietly(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });
    const text = out.trim();
    return text ? text : null;
  } catch { return null; }
}

/**
 * Another git repository (or worktree) somewhere below `root` (depth 4, `node_modules` skipped, at most 4000
 * folders read). The agent's shell keeps its folder between commands, so a later bare `git push` might run there.
 * True when the walk cannot finish (unreadable or too large): the caller then cannot place a remote name.
 */
export function hasNestedGitRepo(root: string): boolean {
  let budget = 4000;
  const walk = (dir: string, depth: number): boolean => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return dir !== root; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      if (!e.isDirectory()) continue;
      if (--budget < 0) return true;
      const child = path.join(dir, e.name);
      try { if (fs.existsSync(path.join(child, ".git"))) return true; } catch { return true; }
      if (depth < 4 && walk(child, depth + 1)) return true;
    }
    return false;
  };
  return walk(root, 1);
}
