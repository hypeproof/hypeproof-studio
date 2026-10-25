import { randomUUID } from 'node:crypto';
import type { AccountView } from './accountSession.ts';

/** REA-W01 stores account-owned project metadata only. No local activity or AI authority. */
export interface PersonalWorkspace { id: string; kind: 'personal'; name: string; owner_account_id: string; created_at: number }
export interface PersonalProject { id: string; workspace_id: string; title: string; revision: number; created_at: number; updated_at: number }
export interface PersonalSpaceView {
  opened: boolean; busy?: boolean; loaded?: boolean; workspace?: PersonalWorkspace;
  projects: PersonalProject[]; selected?: PersonalProject; message?: string; failed?: boolean;
  pendingTitle?: string; authenticationRequired?: boolean;
  created?: { id: string; title: string };
}
interface Options {
  account: { view(): AccountView; accessToken(): Promise<string | undefined>; matches(service: string, site: string): boolean };
  settings(): { proxyUrl: string; siteBase: string }; changed(): void;
  fetch?: typeof fetch; mutationId?: () => string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const projectTitle = (v: unknown): string | undefined => typeof v === 'string' && !v.includes('\0') && v.trim().length > 0 && v.trim().length <= 160 ? v.trim() : undefined;
class SpaceError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const needsAccount = (error: unknown): boolean => object(error) && typeof error.code === 'string' && /401|unauthorized|authentication_required|invalid_token|session_revoked|account_suspended|account_deleted/.test(error.code);
const message = (error: unknown): string => needsAccount(error)
  ? '로그인을 확인하지 못했어요. 계정을 새로고침하거나 다시 로그인한 뒤 시도해 주세요.'
  : error instanceof SpaceError && error.code === 'mutation_conflict'
  ? '이름 저장 요청이 충돌했어요. 목록을 새로고침해 저장된 이름을 확인해 주세요.'
  : '개인 공간에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';

export class PersonalSpace {
  private identity?: string;
  private generation = 0;
  private suspended = false;
  private pending?: { mutation_id: string; title: string };
  private state: PersonalSpaceView = { opened: false, projects: [] };
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }
  /** Called on every account event and before reading/acting; old requests can never paint another account. */
  sync(): void {
    const account = this.options.account.view();
    if (account.status !== 'signedIn') this.suspended = false;
    const next = !this.suspended && account.status === 'signedIn' ? account.account?.id : undefined;
    if (next !== this.identity) { this.clear(); this.identity = next; }
  }
  signOut(): void { this.suspended = true; this.clear(); }
  clear(): void { this.generation++; this.identity = undefined; this.pending = undefined; this.state = { opened: false, projects: [] }; }
  view(): PersonalSpaceView { this.sync(); return { ...this.state, projects: this.state.projects.map(p => ({ ...p })), ...(this.state.workspace ? { workspace: { ...this.state.workspace } } : {}), ...(this.state.selected ? { selected: { ...this.state.selected } } : {}) }; }
  private current(generation: number): boolean { this.sync(); return generation === this.generation && !!this.identity; }
  private workspace(value: unknown): PersonalWorkspace {
    if (!object(value) || !id(value.id) || value.kind !== 'personal' || value.owner_account_id !== this.identity || value.name !== '개인 공간' || !time(value.created_at)) throw new SpaceError('invalid_response');
    return { id: value.id, kind: 'personal', owner_account_id: this.identity!, name: value.name, created_at: value.created_at };
  }
  private project(value: unknown, workspace: string): PersonalProject {
    if (!object(value) || !id(value.id) || value.workspace_id !== workspace || projectTitle(value.title) !== value.title || value.revision !== 1 || !time(value.created_at) || !time(value.updated_at)) throw new SpaceError('invalid_response');
    return { id: value.id, workspace_id: workspace, title: value.title as string, revision: value.revision, created_at: value.created_at, updated_at: value.updated_at };
  }
  private async call(path: string, generation: number, body?: unknown): Promise<Record<string, unknown>> {
    const settings = this.options.settings();
    if (!this.options.account.matches(settings.proxyUrl, settings.siteBase)) throw new SpaceError('settings_changed');
    const token = await this.options.account.accessToken();
    if (!this.current(generation)) throw new SpaceError('stale');
    if (!token) throw new SpaceError('unauthorized');
    const response = await (this.options.fetch ?? fetch)(settings.proxyUrl.replace(/\/+$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(12_000),
    });
    if (!this.current(generation)) throw new SpaceError('stale');
    const value: unknown = await response.json();
    if (!response.ok) throw new SpaceError(object(value) && typeof value.error === 'string' ? value.error : `http_${response.status}`);
    if (!object(value)) throw new SpaceError('invalid_response');
    return value;
  }
  private async run(work: (generation: number) => Promise<void>): Promise<void> {
    this.sync(); if (!this.identity || this.state.busy) return;
    const generation = this.generation;
    this.state = { ...this.state, opened: true, busy: true, message: undefined, failed: false, authenticationRequired: false }; this.options.changed();
    try { await work(generation); }
    catch (error) {
      if (this.current(generation)) {
        // A refused session may keep its account presentation until refresh. Do not keep
        // that account's cloud records on screen; an uncertain write stays host-private.
        if (needsAccount(error)) this.state = { opened: true, projects: [], authenticationRequired: true };
        this.state.message = message(error); this.state.failed = true;
      }
    }
    finally { if (this.current(generation)) { this.state.busy = false; this.options.changed(); } }
  }
  private async projects(workspace: PersonalWorkspace, generation: number): Promise<PersonalProject[]> {
    const body = await this.call(`/me/workspaces/${encodeURIComponent(workspace.id)}/projects`, generation);
    if (!Array.isArray(body.projects)) throw new SpaceError('invalid_response');
    return body.projects.map(p => this.project(p, workspace.id));
  }
  async open(selectedId?: string): Promise<void> {
    await this.run(async generation => {
      const body = await this.call('/me/workspaces', generation);
      if (!Array.isArray(body.workspaces) || body.workspaces.length > 1) throw new SpaceError('invalid_response');
      const workspace = body.workspaces.length ? this.workspace(body.workspaces[0]) : undefined;
      const projects = workspace ? await this.projects(workspace, generation) : [];
      if (!this.current(generation)) return;
      const selected = projects.find(p => p.id === (selectedId ?? this.state.selected?.id));
      this.state = { ...this.state, loaded: true, workspace, projects, selected, pendingTitle: this.pending?.title,
        ...(selectedId && !selected ? { message: '이 프로젝트를 찾지 못했어요. 새로고침한 목록에서 다시 골라 주세요.' } : {}) };
    });
  }
  async ensure(): Promise<void> {
    await this.run(async generation => {
      const workspace = this.workspace((await this.call('/me/workspaces', generation, {})).workspace);
      const projects = await this.projects(workspace, generation);
      if (this.current(generation)) this.state = { ...this.state, loaded: true, workspace, projects, pendingTitle: this.pending?.title };
    });
  }
  async create(title: unknown): Promise<void> {
    await this.run(async generation => {
      const normalized = projectTitle(title);
      if (!normalized) { this.state.message = '프로젝트 이름을 1~160자로 입력해 주세요.'; this.state.failed = true; return; }
      const workspace = this.state.workspace; if (!workspace) throw new SpaceError('workspace_not_found');
      if (this.pending && this.pending.title !== normalized) { this.state.message = '저장 중이던 이름으로 다시 시도해 주세요.'; this.state.failed = true; return; }
      this.pending ??= { mutation_id: (this.options.mutationId ?? randomUUID)(), title: normalized };
      this.state.pendingTitle = this.pending.title;
      const project = this.project((await this.call(`/me/workspaces/${encodeURIComponent(workspace.id)}/projects`, generation, this.pending)).project, workspace.id);
      if (!this.current(generation)) return;
      this.pending = undefined;
      this.state = { ...this.state, pendingTitle: undefined, created: { id: project.id, title: project.title }, projects: [project, ...this.state.projects.filter(p => p.id !== project.id)], selected: project, message: '프로젝트 이름을 저장했어요.' };
    });
  }
}
