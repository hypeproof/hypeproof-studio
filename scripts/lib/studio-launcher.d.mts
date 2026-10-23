// Types for scripts/lib/studio-launcher.mjs (consumed by the TypeScript e2e suite).
import type { ChildProcess, SpawnOptions } from "node:child_process";

export type SecretStorage = "inmemory" | "os";
export interface LaunchMeta {
  label?: string;
  /** Required. 'inmemory' loses secrets when the window reloads or reopens; use 'os' for those flows. */
  secretStorage: SecretStorage;
  /** 'offscreen' (default) stashes Playwright windows; 'caller' when the test manages windows itself. */
  quiet?: "offscreen" | "caller";
  /** Needs real focus; refused unless HPS_LAUNCH_ALLOW_FOREGROUND=1 or CI. */
  foreground?: boolean;
  /** The caller already required an explicit operator opt-in for foreground input. */
  foregroundOptIn?: boolean;
  /** A person works in this window (dev host): visible, not quiet, still tracked and cleaned up. */
  interactive?: boolean;
  root?: string;
  session?: string | null;
  focusCheck?: boolean;
}
export interface RunManifest {
  format: string; id: string; label: string; session: string | null; dir: string;
  owner: { pid: number; start: string | null };
  secretStorage: SecretStorage; executable: string | null; userDataDir: string | null; extensionsDir: string | null;
  ownedDirs: string[]; callerDirs: string[]; pids: number[]; ports: number[];
  servers: { name: string; pid: number | null }[];
  focus: { checked: boolean; violations: { pid: number; at: string }[] };
  status: "running" | "leftover";
}
export class StudioRun {
  constructor(meta: LaunchMeta);
  readonly id: string;
  readonly dir: string;
  readonly manifest: RunManifest;
  readonly manifestPath: string;
  executable(executable: string): string;
  args(args?: string[]): string[];
  addPid(pid: number | undefined): void;
  addServer(server: number | { pid?: number; kill?(signal?: string): unknown; close?(): unknown }, name?: string): void;
  addDir(dir: string): void;
  cleanup(): Promise<void>;
  cleanupSync(): void;
}
export function createStudioRun(meta: LaunchMeta): StudioRun;
export function launchStudio<A extends { close(): Promise<void>; process(): { pid?: number } | null; evaluate: (...args: any[]) => Promise<any> }>(
  electron: { launch(options: any): Promise<A> },
  options: { executablePath: string; args?: string[]; [key: string]: unknown },
  meta: LaunchMeta,
): Promise<A & { hpsRun: StudioRun }>;
/** `hpsQuiet` resolves once the app runs with the macOS pre-start quiet hook (immediately without one). */
export function spawnStudio(binary: string, args: string[], options?: SpawnOptions, meta?: LaunchMeta | StudioRun): ChildProcess & { hpsRun: StudioRun; hpsQuiet: Promise<void> };
export function applyQuietMode(app: { evaluate: (...args: any[]) => Promise<any> }): Promise<void>;
export function hideStudioApp(app: { evaluate: (...args: any[]) => Promise<any> }): Promise<void>;
export function createOwnedDir(prefix?: string, root?: string): string;
export function removeOwnedDir(dir: string): void;
export function ownedDirRoot(root?: string): string;
export function launchRoot(): string;
export function newSessionId(): string;
export function verifySession(session: string, options?: { root?: string }): string[];
export function sweep(options?: { root?: string; dryRun?: boolean; ownerTree?: number | null; orphanAgeMs?: number; apps?: boolean; log?: (m: string) => void }): {
  cleaned: unknown[]; skipped: unknown[]; failed: unknown[]; dirs: unknown[]; apps: string[];
};
