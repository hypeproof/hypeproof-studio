import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { AccountPassBinding } from './accountSession';
import type { ResolvedProfile } from './protocol';
import type { ActivitySummary } from './startPageProtocol';
import { FREE_FOLDER_COUNT, isFreeSeat } from './seatVocabulary';
export type { ActivitySummary } from './startPageProtocol';

export class ActivityConnectionError extends Error {}
/** The refusal for a folder another activity holds. The free-start path never shows it (it moves on). */
export const FOLDER_TAKEN_MESSAGE = '이 폴더는 다른 활동에 연결돼 있습니다. 다른 작업 폴더를 선택해 주세요.';
export const ACTIVITY_TOKEN_KEY = 'hypeproofChat.workshopToken';
const PREFIX = 'hps.activity.credential.';
const ACTIVE = 'hps.activity.active';
const DISCONNECTED_REF = 'hps.activity.disconnectedRef';
export interface ActivityRecord extends ActivitySummary {
  version: 1; service: string; serverId: string;
  token: string; savedAt: number; accountPass?: AccountPassBinding;
}
const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function activityService(url: string): string {
  const u = new URL(url);
  if (u.username || u.password || u.search || u.hash) throw new ActivityConnectionError('Service 주소를 확인해 주세요.');
  return u.href.replace(/\/+$/, '');
}
/**
 * The one spelling of a folder used for stored identities (binding file names, resume keys,
 * `record.workspace`). JS `realpathSync` keeps the drive letter as given, and Windows paths reach
 * us both ways: `C:\…` from `os.homedir()`, `c:\…` from `workspaceFolders`. Hashing both made the
 * folder opened by a reload miss its own binding, so entry fell back to the start page.
 */
const upperDrive = (p: string) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());
export const canonicalRoot = (root: string) => upperDrive(fs.realpathSync(root));
const canonical = canonicalRoot;
/** canonicalRoot for a folder that may not exist yet (deleted, or about to be created): its parent's spelling plus its name. */
const canonicalLoose = (root: string) => { try { return canonical(root); } catch { return upperDrive(path.join(fs.realpathSync(path.dirname(root)), path.basename(root))); } };
/**
 * REQ-L12 — a bought pass continues in its home folder, the way Claude Code continues in the folder
 * it is started in (Jay, 2026-10-14). Only the profile's own `workspace_root` can be taken over, and
 * only by a pass. A local folder choice must not change the Service profile's home.
 */
export function passTakesOver(p: Pick<ResolvedProfile, 'pass' | 'workspace_root'>, root: string): boolean {
  return !!p.pass && isHome(p, root);
}
function expandHome(p: Pick<ResolvedProfile, 'workspace_root'>): string | undefined {
  if (!p.workspace_root) return undefined;
  return p.workspace_root.startsWith('~/') ? path.join(os.homedir(), p.workspace_root.slice(2)) : p.workspace_root;
}
function isHome(p: Pick<ResolvedProfile, 'workspace_root'>, root: string): boolean {
  const home = expandHome(p);
  if (!home) return false;
  try { return canonicalLoose(home) === canonicalLoose(root); } catch { return false; }
}
/** The free seat's home and its numbered siblings (`~/HypeProofTrial-2`, `-3`, …): where a free seat may work. */
export function freeFolderCandidates(p: Pick<ResolvedProfile, 'workspace_root'>): string[] {
  const home = expandHome(p);
  if (!home) return [];
  return [home, ...Array.from({ length: FREE_FOLDER_COUNT - 1 }, (_, i) => `${home}-${i + 2}`)];
}
function isFreeFolder(p: Pick<ResolvedProfile, 'workspace_root'>, root: string): boolean {
  let r: string;
  try { r = canonicalLoose(root); } catch { return false; }
  return freeFolderCandidates(p).some(c => { try { return canonicalLoose(c) === r; } catch { return false; } });
}
/**
 * Who holds a folder, as far as a new free seat is concerned. Resolved asynchronously from
 * SecretStorage (`ActivityConnections.folderOwners`) before the synchronous `prepare()`.
 * - `free`    — an earlier free seat.
 * - `trial`   — an earlier non-pass trial (`kind: 'trial'`, no pass): the code-issued trials.
 * - `unknown` — the binding's record is gone or unreadable.
 * - `held`    — a class or lesson activity, a personal activity, or a pass.
 */
export type FolderOwner = 'free' | 'trial' | 'unknown' | 'held';
export type FolderOwners = ReadonlyMap<string, FolderOwner>;
/** A binding's identity for the owner lookup. A binding rewritten after the lookup (another ref) misses it. */
export const bindingOwnerKey = (bound: { id?: unknown; ref?: unknown }) => JSON.stringify([bound.id ?? null, bound.ref ?? null]);
/**
 * REQ-L12 ⑭ / REQ-STUDIO-FREE-START — a new free seat may take over its own free folder (its
 * `workspace_root` home, or a numbered sibling it fell back to) from the machine owner's earlier
 * solo use: an earlier free seat, an earlier code-issued trial, or an owner whose record is lost.
 *
 * Why an unknown owner counts as the machine owner's own: records live in this install's
 * SecretStorage (the OS keychain of this user account). A class or pass record that is still
 * there resolves to `held`. A record that is missing means the keychain was cleared or the app
 * reinstalled, and the binding can no longer be entered from this machine at all (`forWorkspace`
 * refuses it); refusing the folder would lock the newcomer out of the home the Service named,
 * while the files stay either way.
 *
 * A folder held by a class, a lesson or a pass stays held. Files are never moved or deleted; the
 * earlier activity keeps its saved record and, selected later, reports the folder as taken.
 */
export function freeTakesOver(p: Parameters<typeof isFreeSeat>[0] & Pick<ResolvedProfile, 'workspace_root'>, root: string, bound: { free?: unknown } | undefined, owner?: FolderOwner): boolean {
  if (!isFreeSeat(p) || !isFreeFolder(p, root)) return false;
  return bound?.free === true || owner === 'free' || owner === 'trial' || owner === 'unknown';
}
const contexts = new WeakMap<vscode.ExtensionContext, ActivityConnections>();
export function activityConnections(context: vscode.ExtensionContext): ActivityConnections | undefined { return contexts.get(context); }

/** Local binding over VS Code's existing stores. This class grants no remote authority. */
export class ActivityConnections {
  private active?: ActivityRecord;
  private readonly dir: string;
  constructor(private raw: vscode.ExtensionContext, private service: () => string, private root: () => string | undefined,
    private validate: (token: string) => Promise<ResolvedProfile>) {
    this.dir = path.join(raw.globalStorageUri.fsPath, 'activity-bindings');
  }
  accountToken?: (binding: AccountPassBinding) => Promise<string | undefined>;
  get current(): ActivityRecord | undefined { return this.active; }
  get scope(): string | undefined { return this.active?.id; }
  get matchesService(): boolean { try { return !!this.active && this.active.service === activityService(this.service()); } catch { return false; } }
  async initialize(): Promise<void> {
    const ref = this.raw.workspaceState.get<string | null>(ACTIVE);
    const root = this.root();
    const disconnectedRef = this.raw.workspaceState.get<string>(DISCONNECTED_REF);
    // A disconnect applies to that saved generation, not a later explicit re-entry from another folder.
    if (ref === null && (!disconnectedRef || !root || (await this.forWorkspace(root))?.ref === disconnectedRef)) return;
    let record: ActivityRecord | undefined;
    if (root && fs.existsSync(root)) {
      // The folder binding is authoritative, even if this workspace has a stale pointer.
      record = await this.forWorkspace(root);
    } else if (ref?.startsWith(PREFIX)) record = await this.read(ref);
    if (record) this.active = record; // pinned to this window, never follows another window's writes
  }
  async forWorkspace(root: string): Promise<ActivityRecord | undefined> {
    const file = [this.bindingPath(root), this.legacyBindingPath(root)].find((f): f is string => !!f && fs.existsSync(f));
    if (!file) return;
    const bound = JSON.parse(fs.readFileSync(file, 'utf8'));
    const record = typeof bound.ref === 'string' ? await this.read(bound.ref) : undefined;
    if (!record || bound.version !== 1 || bound.id !== record.id || record.workspace !== canonical(root))
      throw new ActivityConnectionError('이 폴더의 활동 연결을 읽지 못했습니다. 저장된 활동을 선택해 다시 연결해 주세요.');
    if (record.service !== activityService(this.service()))
      throw new ActivityConnectionError('이 폴더는 다른 서버의 활동에 연결돼 있습니다. 연결 서버를 확인해 주세요.');
    // Found under the old spelling: carry it to the new name once. Otherwise the next claim()
    // (acquire, on send) writes a ref-less binding there, and the reload after that finds it
    // first and can no longer read the folder's activity.
    const current = this.bindingPath(root);
    if (file !== current) {
      try { fs.writeFileSync(current, fs.readFileSync(file), { flag: 'wx', mode: 0o600 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    return record;
  }
  private async read(ref: string): Promise<ActivityRecord | undefined> {
    if (!ref.startsWith(PREFIX)) return;
    const value = await this.raw.secrets.get(ref);
    if (!value) return;
    let r: ActivityRecord;
    try { r=JSON.parse(value); } catch { throw new ActivityConnectionError('저장된 활동 연결을 읽지 못했습니다. 코드를 다시 입력해 주세요.'); }
    if (r.version !== 1 || r.ref !== ref || typeof r.token !== 'string' || typeof r.name !== 'string' || !Number.isFinite(r.savedAt) || !/^[a-f0-9]{64}$/.test(r.serverId) ||
      r.id !== digest(JSON.stringify([r.service, r.serverId])) || !path.isAbsolute(r.workspace)) throw new ActivityConnectionError('저장된 활동 연결을 읽지 못했습니다. 코드를 다시 입력해 주세요.');
    // Saved before canonicalRoot: the drive letter may be VS Code's `c:`. Compare in one spelling.
    r.workspace = upperDrive(r.workspace);
    return r;
  }
  /** CGP-SHELL-R-028: the unscoped SecretStorage, read only, so a work export can redact every value it holds. */
  heldSecrets(): { get(key: string): Thenable<string | undefined>; keys(): Thenable<string[]> } {
    return { get: key => this.raw.secrets.get(key), keys: () => this.raw.secrets.keys() };
  }
  async hasLegacyConnection():Promise<boolean> { return (await this.raw.secrets.keys()).includes(ACTIVITY_TOKEN_KEY); }
  async list(): Promise<ActivitySummary[]> {
    const found = new Map<string, ActivityRecord>();
    for (const ref of await this.raw.secrets.keys()) {
      if (!ref.startsWith(PREFIX)) continue;
      const r = await this.read(ref);
      if (r?.service !== activityService(this.service())) continue;
      if (!found.has(r.id) || found.get(r.id)!.savedAt < r.savedAt) found.set(r.id, r);
    }
    return [...found.values()].map(({ref,id,name,kind,pass,free,lesson,workspace}) => ({ref,id,name,kind,...(pass?{pass:true}:{}),...(free&&!pass?{free:true}:{}),...(lesson?{lesson:true}:{}),workspace}));
  }
  async candidate(ref: string): Promise<ActivityRecord> {
    const r = await this.read(ref);
    if (!r || r.service !== activityService(this.service())) throw new ActivityConnectionError('현재 서버의 저장된 활동이 아닙니다.');
    if (r.accountPass) { const token = await this.accountToken?.(r.accountPass); if (!token) throw new ActivityConnectionError('Google로 다시 로그인해 주세요.'); return { ...r, token }; }
    return r;
  }
  async token(): Promise<string | undefined> {
    if (!this.matchesService || !this.active) return;
    return this.active.accountPass ? this.accountToken?.(this.active.accountPass) : this.active.token;
  }
  /** Revoking an account removes only that session's credentials; classroom records and files remain. */
  async forgetAccount(sessionId: string): Promise<boolean> {
    const wasActive = this.active?.accountPass?.sessionId === sessionId;
    if (wasActive) await this.disconnect();
    for (const key of await this.raw.secrets.keys()) {
      if (!key.startsWith(PREFIX)) continue;
      const r = await this.read(key);
      if (r?.accountPass?.sessionId === sessionId) await this.raw.secrets.delete(key);
    }
    return wasActive;
  }
  private bindingPath(root: string): string { return path.join(this.dir, digest(canonicalLoose(root)) + '.json'); }
  /**
   * The same folder's binding as written before canonicalRoot, when the window's root was
   * VS Code's `c:\…`. Read only, so an update keeps every folder's activity; new writes use
   * bindingPath. Undefined where there is no drive letter (macOS, Linux).
   */
  private legacyBindingPath(root: string): string | undefined {
    const c = canonicalLoose(root), lower = c.replace(/^[A-Z]:/, (d) => d.toLowerCase());
    return lower === c ? undefined : path.join(this.dir, digest(lower) + '.json');
  }
  private claim(root: string, id: string, takeover: boolean | ((bound: { free?: unknown; ref?: unknown; id?: unknown }) => boolean) = false, free = false): void {
    fs.mkdirSync(this.dir, {recursive:true,mode:0o700});
    const file = this.bindingPath(root);
    const fresh = JSON.stringify({version:1,id,...(free?{free:true}:{})});
    try { fs.writeFileSync(file, fresh, {flag:'wx',mode:0o600}); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const bound = JSON.parse(fs.readFileSync(file,'utf8'));
    if (bound.id === id) return;
    // The earlier activity keeps its saved record; selecting it later reports this folder as taken.
    if (typeof takeover === 'function' ? takeover(bound) : takeover) { fs.writeFileSync(file, fresh, {mode:0o600}); return; }
    throw new ActivityConnectionError(FOLDER_TAKEN_MESSAGE);
  }
  /** The binding files that may hold this folder, under the current and the pre-canonicalRoot spelling. */
  private bindingFiles(root: string): string[] {
    return [this.bindingPath(root), this.legacyBindingPath(root)].filter((f): f is string => !!f && fs.existsSync(f));
  }
  /**
   * Resolve who holds `root` (see FolderOwner) before the synchronous `prepare()` and the claim
   * in `commit()`. Never throws: an unreadable record is `unknown`, a missing folder has no owner.
   */
  async folderOwners(root: string): Promise<FolderOwners> {
    const owners = new Map<string, FolderOwner>();
    let files: string[];
    try { files = this.bindingFiles(root); } catch { return owners; }
    for (const file of files) {
      let bound: { id?: unknown; ref?: unknown; free?: unknown };
      try { bound = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      let owner: FolderOwner = 'unknown';
      if (bound.free === true) owner = 'free';
      else if (typeof bound.ref === 'string') {
        try {
          const r = await this.read(bound.ref);
          if (r && r.id === bound.id) owner = r.pass || r.accountPass ? 'held' : r.free ? 'free' : r.kind === 'trial' ? 'trial' : 'held';
        } catch { /* unreadable record: unknown */ }
      }
      owners.set(bindingOwnerKey(bound), owner);
    }
    return owners;
  }
  /**
   * REQ-STUDIO-FREE-START — the folder a free seat enters, without a question: its home when it is
   * free to use or may be taken over, otherwise the first numbered sibling that is (`~/HypeProofTrial-2`,
   * `-3`, …). A sibling already holding someone's files that no binding names is skipped, never
   * reused. Undefined only for a profile that is not a free seat or names no home.
   */
  async freeWorkspace(p: ResolvedProfile, skip: ReadonlySet<string> = new Set()): Promise<string | undefined> {
    if (!isFreeSeat(p) || !/^[a-f0-9]{64}$/.test(p.activity_id ?? '')) return undefined;
    const id = digest(JSON.stringify([activityService(this.service()), p.activity_id]));
    const candidates = freeFolderCandidates(p);
    const loose = (f: string) => { try { return canonicalLoose(f); } catch { return f; } };
    const skipped = new Set([...skip].map(loose));
    for (const [i, folder] of candidates.entries()) {
      if (skipped.has(loose(folder))) continue;
      try {
        const exists = fs.existsSync(folder);
        if (exists && !fs.statSync(folder).isDirectory()) continue;
        const files = this.bindingFiles(folder);
        if (!files.length) {
          // The home is always the seat's own; a sibling is used only while it is new or empty.
          if (!exists || i === 0 || fs.readdirSync(folder).every(n => n.startsWith('.'))) return folder;
          continue;
        }
        const owners = await this.folderOwners(folder);
        const usable = files.every(f => {
          const bound = JSON.parse(fs.readFileSync(f, 'utf8'));
          return bound.id === id || freeTakesOver(p, folder, bound, owners.get(bindingOwnerKey(bound)));
        });
        if (usable) return folder;
      } catch { /* an unreadable candidate is skipped, never fatal */ }
    }
    return undefined;
  }
  prepare(root:string,p:ResolvedProfile,prepare:()=>void,owners?:FolderOwners):void {
    if (!/^[a-f0-9]{64}$/.test(p.activity_id ?? '')) throw new ActivityConnectionError('활동 정보를 다시 확인해 주세요.');
    fs.mkdirSync(root,{recursive:true});
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    const release=this.lock(root);
    try {
      // Preparation must not replace the binding that commit snapshots for rollback.
      const id=digest(JSON.stringify([activityService(this.service()),p.activity_id]));
      const taken=[this.bindingPath(root),this.legacyBindingPath(root)].some(f=>{
        if (!f || !fs.existsSync(f)) return false;
        const bound=JSON.parse(fs.readFileSync(f,'utf8'));
        return bound.id !== id && !freeTakesOver(p,root,bound,owners?.get(bindingOwnerKey(bound)));
      });
      if (taken && !passTakesOver(p,root)) {
        throw new ActivityConnectionError(FOLDER_TAKEN_MESSAGE);
      }
      prepare();
    } finally { release(); }
  }
  /**
   * `replacesFree` (CONV-PURCHASE-R-005): the binding id of the free seat a paid pass replaces in
   * place. Only that free seat's binding, and only for a pass, may be taken over through it; any
   * other holder stays held exactly as before.
   */
  async commit(token: string, p: ResolvedProfile, root: string, accountPass?: AccountPassBinding, opts?: { replacesFree?: string }): Promise<() => Promise<void>> {
    if (!/^[a-f0-9]{64}$/.test(p.activity_id ?? '')) throw new ActivityConnectionError('서버가 활동 분리를 지원하지 않습니다. 연결 서버를 업데이트해 주세요.');
    const service = activityService(this.service()), workspace = canonical(root);
    const id = digest(JSON.stringify([service,p.activity_id]));
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    // Resolved before the lock; a binding rewritten in between misses the lookup and stays held.
    const owners = isFreeSeat(p) ? await this.folderOwners(workspace) : undefined;
    const release=this.lock(workspace);
    const previous = this.active;
    const previousPointer = this.raw.workspaceState.get<string | null>(ACTIVE);
    const bindingFile = this.bindingPath(workspace);
    const oldBinding = fs.existsSync(bindingFile) ? fs.readFileSync(bindingFile,'utf8') : undefined;
    // The window's folder may be gone (REQ-STUDIO-MISSING-TASK-FOLDER: 다시 고르기 commits a new folder
    // from a window whose folder was moved away); a root that no longer resolves is not this folder.
    const sameWindowRoot = (() => { const open = this.root(); if (!open) return false; try { return canonical(open) === workspace; } catch { return false; } })();
    const ref = PREFIX + crypto.randomUUID();
    const next: ActivityRecord = {version:1,ref,id,service,serverId:p.activity_id!,workspace,token,...(accountPass ? {accountPass} : {}),
      name:p.lesson?.content.title ?? p.display_name,kind:p.activity_kind,...(p.pass?{pass:true}:{}),...(p.lesson?{lesson:true}:{}),...(isFreeSeat(p)?{free:true}:{}),savedAt:Date.now()};
    const restore = () => {
      if (!fs.existsSync(bindingFile)) return;
      const bound=JSON.parse(fs.readFileSync(bindingFile,'utf8'));
      // Ours: written with this ref, or claimed for this id without a ref yet.
      if (bound.ref !== ref && !(bound.id===id && !bound.ref)) return;
      if (oldBinding===undefined) fs.unlinkSync(bindingFile);
      else fs.writeFileSync(bindingFile,oldBinding,{mode:0o600});
    };
    const tmp = bindingFile + '.' + crypto.randomUUID();
    try {
      const free = isFreeSeat(p);
      const replacesFree = (bound: { free?: unknown; id?: unknown }) => !!p.pass && !!opts?.replacesFree && bound.id === opts.replacesFree && bound.free === true;
      this.claim(workspace,id,(bound)=>passTakesOver(p,workspace) || freeTakesOver(p,workspace,bound,owners?.get(bindingOwnerKey(bound))) || replacesFree(bound),free);
      await this.raw.secrets.store(ref,JSON.stringify(next));
      fs.writeFileSync(tmp,JSON.stringify({version:1,id,ref,...(free?{free:true}:{})}),{flag:'wx',mode:0o600});
      fs.renameSync(tmp,bindingFile);
      if (sameWindowRoot) await this.raw.workspaceState.update(ACTIVE,ref);
      this.active = next;
    } catch (e) {
      restore();
      await this.raw.secrets.delete(ref);
      throw e;
    } finally {
      if(fs.existsSync(tmp)) fs.unlinkSync(tmp);
      release();
    }
    return async () => {
      const unlock=this.lock(workspace);
      try {
        if (sameWindowRoot && this.raw.workspaceState.get(ACTIVE)===ref) await this.raw.workspaceState.update(ACTIVE,previousPointer);
        restore();
        this.active = previous;
        await this.raw.secrets.delete(ref);
      } finally { unlock(); }
    };
  }
  async disconnect(): Promise<void> {
    if (this.active) await this.raw.workspaceState.update(DISCONNECTED_REF, this.active.ref);
    await this.raw.workspaceState.update(ACTIVE, null);
    this.active = undefined;
  }
  /** One active writer per physical folder across extension-host processes. */
  acquire(): () => void {
    const r = this.active, root = this.root();
    if (!r || !this.matchesService) throw new ActivityConnectionError('활동에 다시 연결한 뒤 보내 주세요.');
    if (!root || canonical(root) !== r.workspace) throw new ActivityConnectionError('이 활동의 작업 폴더를 열고 다시 보내 주세요.');
    this.claim(root,r.id);
    return this.lock(root);
  }
  private lock(root:string):()=>void {
    const lock = this.bindingPath(root) + '.lock';
    const recovery=lock+'.recovery';
    const busy=()=>new ActivityConnectionError('다른 창에서 이 폴더를 사용 중입니다. 작업이 끝난 뒤 다시 보내 주세요.');
    const nonce = crypto.randomUUID();
    for (let attempt=0;attempt<2;attempt++) {
      if (fs.existsSync(recovery)) throw busy();
      try { fs.writeFileSync(lock,JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});
        if (fs.existsSync(recovery)) { fs.unlinkSync(lock); throw busy(); }
        return () => { if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock,'utf8')).nonce === nonce) fs.unlinkSync(lock); };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const owner = JSON.parse(fs.readFileSync(lock,'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new ActivityConnectionError('작업 폴더 잠금 정보를 확인할 수 없습니다.');
        try { process.kill(owner.pid,0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            // Serialize dead-owner recovery. Acquirers check this barrier both
            // before and after creating a lock, so recovery cannot unlink a new owner.
            try { fs.mkdirSync(recovery,{mode:0o700}); } catch { throw busy(); }
            try {
              if (fs.existsSync(lock)) {
                const latest=JSON.parse(fs.readFileSync(lock,'utf8'));
                if (latest.nonce===owner.nonce) fs.unlinkSync(lock);
              }
            } finally { fs.rmdirSync(recovery); }
            continue;
          }
        }
        throw new ActivityConnectionError('다른 창에서 이 폴더를 사용 중입니다. 작업이 끝난 뒤 다시 보내 주세요.');
      }
    }
    throw new ActivityConnectionError('작업 폴더 잠금을 얻지 못했습니다. 다시 시도해 주세요.');
  }
  wrap(): vscode.ExtensionContext {
    const original = this.raw.secrets;
    const scoped = Object.create(this.raw) as vscode.ExtensionContext;
    const secrets: vscode.SecretStorage = {
      get:key => key===ACTIVITY_TOKEN_KEY ? this.token() : original.get(key),
      store:async (key,value) => {
        if (key!==ACTIVITY_TOKEN_KEY) return original.store(key,value);
        const root=this.root(); if (!root) throw new ActivityConnectionError('작업 폴더를 먼저 선택해 주세요.');
        await this.commit(value,await this.validate(value),root,value === await this.token() ? this.active?.accountPass : undefined);
      },
      delete:key => key===ACTIVITY_TOKEN_KEY ? this.disconnect() : original.delete(key),
      keys:()=>original.keys(), onDidChange:original.onDidChange,
    };
    Object.defineProperty(scoped,'secrets',{value:secrets});
    contexts.set(scoped,this);
    return scoped;
  }
}
