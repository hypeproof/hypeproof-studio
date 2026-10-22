// CGP-SHELL-R-002: durable, single-consumer handoff after the native quit vetoes.
// Only the updater writes this private record, after download verification. No webview
// payload is accepted here. Fingerprints detect changes to the prepared app or script.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { accountLock } from './accountLock.ts';

export const INSTALL_STAGED_UPDATE_COMMAND = '_hypeproof.update.installOnQuit';
/** Shared by the explicit-restart and confirmed-quit entry points. */
export function updateInstallAllowed(provider: { hasActiveStream(): boolean; isClassUpdateHeld(): boolean }): boolean {
  return !provider.hasActiveStream() && !provider.isClassUpdateHeld();
}

interface PreparedUpdate {
  id: string;
  version: string;
  platform: 'darwin' | 'win32';
  script: string;
  artifacts: string[];
  fingerprints: string[];
}

export function updateFingerprint(target: string): string {
  const hash = crypto.createHash('sha256');
  function visit(file: string, relative: string): void {
    const stat = fs.lstatSync(file);
    hash.update(JSON.stringify([relative, stat.mode]));
    if (stat.isSymbolicLink()) hash.update('link:' + fs.readlinkSync(file));
    else if (stat.isDirectory()) {
      hash.update('dir:');
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), path.join(relative, name));
    } else if (stat.isFile()) hash.update(fs.readFileSync(file));
    else throw new Error('Unsupported update artifact');
  }
  visit(target, '');
  return hash.digest('hex');
}

/** started = installer launched; busy = another installer holds a live lease; held = a turn or class started. */
export type HandoffResult = 'started' | 'busy' | 'held';

/** Longest a lease can hold updates back. The Windows Setup and the macOS copy finish well inside it. */
export const HANDOFF_LEASE_MS = 10 * 60 * 1000;

interface HandoffLease { pid: number; nonce: string; startedAt: number }

function leaseHeld(marker: string, now: number): boolean {
  let lease: Partial<HandoffLease>;
  // Missing, unreadable or partial lease (it is written by rename): no lease.
  try { lease = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { return false; }
  const { pid, nonce, startedAt } = lease ?? {};
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0 || typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce) ||
      typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  const age = now - startedAt;
  // A lease from the future (clock moved back) or past its bound no longer identifies our process.
  if (age < -60_000 || age >= HANDOFF_LEASE_MS) return false;
  try { process.kill(pid as number, 0); return true; } catch (error) {
    // EPERM: a live process we cannot signal. Within the bound, treat it as the installer.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export class StagedUpdate {
  private readonly pending: string;
  constructor(directory: string) {
    this.pending = path.join(directory, 'pending-update.json');
  }

  stage(platform: 'darwin' | 'win32', script: string, artifacts: string[], version: string): string {
    const files = [script, ...artifacts];
    const record: PreparedUpdate = { id: crypto.randomUUID(), version, platform, script, artifacts: files, fingerprints: files.map(updateFingerprint) };
    fs.mkdirSync(path.dirname(this.pending), { recursive: true, mode: 0o700 });
    const temporary = this.pending + '.' + crypto.randomUUID();
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(temporary, this.pending);
    return record.id;
  }

  clear(id: string): void {
    const claimed = this.pending + '.' + crypto.randomUUID() + '.claimed';
    try { fs.renameSync(this.pending, claimed); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    try {
      if (JSON.parse(fs.readFileSync(claimed, 'utf8')).id !== id) this.restore(claimed);
    } finally { fs.rmSync(claimed, { force: true }); }
  }

  private restore(claimed: string): void {
    try { fs.copyFileSync(claimed, this.pending, fs.constants.COPYFILE_EXCL); } catch (error) {
      // A newer download won the race; keep it instead of overwriting it.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  /**
   * Share exclusion with explicit restart, including a different pending version.
   * The lease names the launched process by pid, a per-launch nonce and the launch time.
   * A pid can be reused by an unrelated process, so the lease also expires after
   * HANDOFF_LEASE_MS: a reused pid can hold updates back for at most that long, never
   * indefinitely. A lease whose process is gone is deleted.
   */
  async handoff(launch: () => Promise<number | undefined>, now: () => number = Date.now): Promise<HandoffResult> {
    const directory = path.join(path.dirname(this.pending), 'handoff');
    return accountLock(directory)(async () => {
      const marker = path.join(directory, 'installer-pid.json');
      if (leaseHeld(marker, now())) return 'busy';
      fs.rmSync(marker, { force: true });
      const pid = await launch();
      if (pid === undefined) return 'held';
      const lease: HandoffLease = { pid, nonce: crypto.randomUUID(), startedAt: now() };
      const temporary = marker + '.' + lease.nonce;
      fs.writeFileSync(temporary, JSON.stringify(lease), { mode: 0o600 });
      fs.renameSync(temporary, marker);
      return 'started';
    });
  }

  async install(allowed: () => boolean, isNewer: (version: string) => boolean, launch: (platform: 'darwin' | 'win32', script: string) => Promise<number>): Promise<boolean> {
    if (!allowed()) return false;
    // Rename consumes the record across extension hosts/windows. Cancellation never
    // calls this method; reload and workspace switches never reach the native hook.
    const claimed = this.pending + '.' + crypto.randomUUID() + '.claimed';
    try { fs.renameSync(this.pending, claimed); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    try {
      const record = JSON.parse(fs.readFileSync(claimed, 'utf8')) as PreparedUpdate;
      if (!record || typeof record.version !== 'string' || !/^[0-9]+(?:\.[0-9]+){2}$/.test(record.version) || !['darwin', 'win32'].includes(record.platform) ||
          !Array.isArray(record.artifacts) || !Array.isArray(record.fingerprints) ||
          record.artifacts.length < 2 || record.artifacts.length !== record.fingerprints.length ||
          record.artifacts[0] !== record.script ||
          !record.artifacts.every(p => typeof p === 'string' && path.isAbsolute(p)) ||
          !record.artifacts.every((p, i) => updateFingerprint(p) === record.fingerprints[i])) {
        throw new Error('Staged update changed; keeping the installed app');
      }
      if (!isNewer(record.version)) return false;
      if (!allowed()) {
        // A class/turn may start while reading the prepared artifacts. Keep it for
        // the next eligible quit; do not replace a newer download from another window.
        this.restore(claimed);
        return false;
      }
      const started = await this.handoff(async () => {
        if (!allowed() || !isNewer(record.version)) return undefined;
        return launch(record.platform, record.script);
      });
      if (started !== 'started') this.restore(claimed);
      return started === 'started';
    } finally { fs.rmSync(claimed, { force: true }); }
  }
}
