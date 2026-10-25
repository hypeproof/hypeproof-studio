import { randomUUID } from 'node:crypto';
import { accountPreviewEnabled, type AccountView } from './accountSession';
import type { PersonalWorkspace, PersonalProject } from './personalSpace';
import { PersonalRecordStore } from './personalRecordStore';
import { canonicalRecord, fixtureText, recordHash, sameScope, syntheticRecord, SYNTHETIC_RECORD_NOTICE, validateIntent } from './personalRecordFixture';
import type { PersonalRecord, PersonalRecordsView, RecordIntent, RecordManifest, RecordPreview, RecordScope } from './personalRecordTypes';

interface Options {
  account: { view(): AccountView; accessToken(): Promise<string | undefined>; matches(service: string, site: string): boolean };
  settings(): { proxyUrl: string; siteBase: string; preview: boolean };
  directory: string; changed(): void; confirm(preview: RecordPreview): Promise<boolean>;
  download(value: { name: string; bytes: Uint8Array; current(): boolean }): Promise<boolean>;
  fetch?: typeof fetch; mutationId?: () => string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 160 && v.trim() === v && !v.startsWith('.') && !v.endsWith('.') && !/[\\/:<>"|?*\u0000-\u001f\u007f]/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
class RecordClientError extends Error { constructor(readonly code: string) { super(code); } }
const authError = (error: unknown) => error instanceof RecordClientError && /^(http_401|unauthorized|session_revoked|authentication_required|invalid_token|account_deleted|account_suspended)$/.test(error.code);
const errorMessage = (error: unknown): string => authError(error) ? '로그인을 확인하지 못했어요. 계정을 새로고침한 뒤 기록을 다시 열어 주세요.'
  : object(error) && error.code === 'EEXIST' ? '같은 이름의 파일이 이미 있어요. 원본은 그대로예요. 다른 이름이나 위치를 골라 다시 저장해 주세요.'
  : error instanceof Error && error.message === 'outbox_corrupt' ? '저장 대기 사본을 확인할 수 없어요. 이 기기의 사본은 보존했어요. 테스트 담당자에게 복구를 요청해 주세요.'
  : error instanceof RecordClientError && error.code === 'record_consent_mismatch' ? '테스트 서비스의 저장 안내 버전이 맞지 않아요. 테스트 설정을 확인한 뒤 기록을 다시 열어 주세요. 저장 대기 사본은 보존했어요.'
  : error instanceof Error && error.message === 'pending_exists' ? '이 프로젝트에 저장 대기 사본이 있어요. 같은 사본의 저장을 마친 뒤 새 기록을 검토해 주세요.'
  : error instanceof RecordClientError && /record_feature_unavailable|record_configuration_required/.test(error.code) ? '이 로컬 서비스에서 합성 기록 테스트를 사용할 수 없어요. 테스트 설정을 확인해 주세요.'
  : error instanceof RecordClientError && /integrity|invalid_response/.test(error.code) ? '기록이나 파일의 내용이 저장 확인과 맞지 않아요. 내려받지 않았어요. 목록을 다시 확인해 주세요.'
  : error instanceof RecordClientError && /record_deleted|record_not_found|http_404|http_410/.test(error.code) ? '이 기록을 사용할 수 없어요. 삭제 여부를 확인하고 목록을 다시 열어 주세요.'
  : '기록 처리를 마치지 못했어요. 원본과 저장 대기 사본은 그대로예요. 연결을 확인한 뒤 같은 요청을 다시 시도해 주세요.';

function manifest(value: unknown): RecordManifest {
  if (!object(value) || !exact(value, ['schema', 'source', 'title', 'messages', 'artifacts']) || value.schema !== 'hps-personal-record/1' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || value.title.includes('\0')
    || !object(value.source) || !exact(value.source, ['kind', 'task_id', 'revision']) || value.source.kind !== 'synthetic-personal' || !id(value.source.task_id) || !integer(value.source.revision)
    || !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 8 || !Array.isArray(value.artifacts) || value.artifacts.length > 2) throw new RecordClientError('invalid_response');
  const messageIds = new Set();
  for (const m of value.messages) {
    if (!object(m) || !exact(m, ['id', 'role', 'content', 'created_at']) || !id(m.id) || messageIds.has(m.id) || !['user', 'assistant', 'tool_status'].includes(String(m.role)) || typeof m.role !== 'string' || typeof m.content !== 'string' || m.content.includes('\0') || !integer(m.created_at)) throw new RecordClientError('invalid_response');
    messageIds.add(m.id);
  }
  const fileIds = new Set();
  for (const f of value.artifacts) {
    if (!object(f) || !exact(f, ['client_ref', 'name', 'bytes', 'sha256', 'media_type']) || !id(f.client_ref) || fileIds.has(f.client_ref) || !name(f.name) || !integer(f.bytes) || f.bytes < 1 || f.bytes > 1024 || !digest(f.sha256) || typeof f.media_type !== 'string' || f.media_type.length > 128) throw new RecordClientError('invalid_response');
    fileIds.add(f.client_ref);
  }
  return structuredClone(value) as unknown as RecordManifest;
}

/** #2832: disabled-by-default localhost fixture consumer; no task/model authority. */
export class PersonalRecords {
  private readonly store: PersonalRecordStore;
  private identity?: string;
  private generation = 0;
  private suspended = false;
  private scope?: RecordScope;
  private destination = '';
  private state: PersonalRecordsView = { enabled: true, records: [] };
  constructor(private readonly options: Options) { this.store = new PersonalRecordStore(options.directory); }
  private enabled(): boolean { const s = this.options.settings(); return accountPreviewEnabled(s.preview, s.proxyUrl, s.siteBase); }
  private clear(): void { this.generation++; this.scope = undefined; this.destination = ''; this.state = { enabled: true, records: [] }; }
  sync(): void {
    const account = this.options.account.view(), s = this.options.settings();
    if (account.status !== 'signedIn') this.suspended = false;
    const next = this.enabled() && this.options.account.matches(s.proxyUrl, s.siteBase) && !this.suspended && account.status === 'signedIn' && id(account.account?.id) ? canonicalRecord([s.proxyUrl, s.siteBase, account.account!.id]) : undefined;
    if (this.identity !== next) { this.clear(); this.identity = next; }
  }
  signOut(): void { this.suspended = true; this.clear(); this.identity = undefined; }
  view(): PersonalRecordsView | undefined { this.sync(); return this.identity ? structuredClone(this.state) : undefined; }
  private current(generation: number, scope: RecordScope): boolean { this.sync(); return !!this.identity && generation === this.generation && !!this.scope && sameScope(scope, this.scope); }
  async select(workspace?: PersonalWorkspace, project?: PersonalProject): Promise<void> {
    this.sync(); const account = this.options.account.view().account;
    if (!this.identity || !account || !workspace || !project || workspace.owner_account_id !== account.id || project.workspace_id !== workspace.id || !id(workspace.id) || !id(project.id)) {
      if (this.scope) this.clear(); return;
    }
    const scope = { service: new URL(this.options.settings().proxyUrl).href.replace(/\/+$/, ''), accountId: account.id, workspaceId: workspace.id, projectId: project.id };
    if (this.scope && sameScope(this.scope, scope)) return;
    this.clear(); this.scope = scope; this.destination = project.title; this.state.projectId = project.id;
    const generation = this.generation;
    try { const pending = await this.store.load(scope); if (this.current(generation, scope)) this.state.pending = pending ? { mutation_id: pending.mutation_id, digest: pending.manifest_sha256, title: pending.manifest.title } : undefined; }
    catch (error) { if (this.current(generation, scope)) { this.state.failed = true; this.state.message = errorMessage(error); } }
    this.options.changed();
  }
  /** Only a boolean selection is admitted. No caller can supply a task/path/transcript. */
  prepare(includeFile: boolean): void {
    this.sync(); if (!this.scope || this.state.busy || this.state.pending || typeof includeFile !== 'boolean') return;
    const fixture = syntheticRecord(includeFile), account = this.options.account.view().account!;
    this.state.preview = { nonce: randomUUID(), digest: recordHash(canonicalRecord(fixture.manifest)), account: account.email || account.id, service: this.scope.service, destination: this.destination, manifest: fixture.manifest,
      files: fixture.manifest.artifacts.map(file => ({ ...file, text: fixtureText })) };
    this.state.message = undefined; this.state.failed = false; this.options.changed();
  }
  cancel(nonce: string): void { if (this.state.preview?.nonce === nonce) { this.state.preview = undefined; this.options.changed(); } }
  private base(scope: RecordScope): string { return `/me/workspaces/${encodeURIComponent(scope.workspaceId)}/projects/${encodeURIComponent(scope.projectId)}/records`; }
  private async call(scope: RecordScope, generation: number, route: string, method = 'GET', body?: unknown, raw?: Uint8Array, limit = 1_048_576): Promise<{ value: unknown; bytes: Uint8Array; headers: Headers }> {
    const settings = this.options.settings();
    if (!this.options.account.matches(settings.proxyUrl, settings.siteBase) || !this.current(generation, scope)) throw new RecordClientError('stale');
    const token = await this.options.account.accessToken();
    if (!this.current(generation, scope)) throw new RecordClientError('stale');
    if (!token) throw new RecordClientError('unauthorized');
    const response = await (this.options.fetch ?? fetch)(scope.service + route, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined && raw === undefined ? {} : { body: raw ? Buffer.from(raw) : JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (response.status === 401) { await response.body?.cancel(); if (!this.current(generation, scope)) throw new RecordClientError('stale'); throw new RecordClientError('http_401'); }
    const maximum = response.ok ? limit : 8192;
    const parts: Uint8Array[] = []; let length = 0;
    if (response.body) { const reader = response.body.getReader(); try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > maximum) { await reader.cancel(); throw new RecordClientError('integrity'); } parts.push(part.value); } } finally { reader.releaseLock(); } }
    if (!this.current(generation, scope)) throw new RecordClientError('stale');
    const bytes = new Uint8Array(Buffer.concat(parts)); let value: unknown; try { value = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { /* artifact bytes */ }
    if (!response.ok) throw new RecordClientError(response.status === 401 ? 'http_401' : object(value) && typeof value.error === 'string' ? value.error : `http_${response.status}`);
    return { value, bytes, headers: response.headers };
  }
  private record(value: unknown, scope: RecordScope, complete = false): PersonalRecord {
    if (!object(value) || !id(value.id) || value.workspace_id !== scope.workspaceId || value.project_id !== scope.projectId || !['staging', 'complete'].includes(String(value.state)) || value.revision !== 1 || !digest(value.manifest_sha256) || !integer(value.created_at)
      || !(value.state === 'complete' ? integer(value.completed_at) : value.completed_at === null) || !Array.isArray(value.artifacts) || value.artifacts.length > 2 || (complete && value.state !== 'complete')) throw new RecordClientError('invalid_response');
    const parsed = value.state === 'complete' ? manifest(value.manifest) : undefined;
    if (parsed && recordHash(canonicalRecord(parsed)) !== value.manifest_sha256) throw new RecordClientError('integrity');
    const artifacts = value.artifacts.map(f => {
      if (!object(f) || !id(f.id) || !id(f.client_ref) || !name(f.name) || !integer(f.bytes) || f.bytes < 1 || f.bytes > 1024 || !digest(f.sha256) || typeof f.media_type !== 'string') throw new RecordClientError('invalid_response');
      const descriptor = { client_ref: f.client_ref, name: f.name, bytes: f.bytes, sha256: f.sha256, media_type: f.media_type };
      if (parsed && !parsed.artifacts.some(item => canonicalRecord(item) === canonicalRecord(descriptor))) throw new RecordClientError('integrity');
      return { ...descriptor, id: f.id };
    });
    if (new Set(artifacts.map(f => f.id)).size !== artifacts.length || new Set(artifacts.map(f => f.client_ref)).size !== artifacts.length || (parsed && parsed.artifacts.length !== artifacts.length)) throw new RecordClientError('integrity');
    return { id: value.id, workspace_id: scope.workspaceId, project_id: scope.projectId, state: value.state as 'staging' | 'complete', revision: 1, manifest_sha256: value.manifest_sha256, created_at: value.created_at, completed_at: value.completed_at as number | null, ...(parsed ? { manifest: parsed } : {}), artifacts };
  }
  private async run(work: (scope: RecordScope, generation: number) => Promise<void>): Promise<void> {
    this.sync(); if (!this.scope || this.state.busy) return;
    const scope = { ...this.scope }, generation = this.generation;
    this.state.busy = true; this.state.failed = false; this.state.message = undefined; this.options.changed();
    try { await work(scope, generation); }
    catch (error) {
      if (this.current(generation, scope)) {
        if (authError(error)) this.state = { enabled: true, projectId: scope.projectId, records: [], authenticationRequired: true };
        this.state.failed = true; this.state.message = errorMessage(error);
      }
    } finally { if (this.current(generation, scope)) { this.state.busy = false; this.options.changed(); } }
  }
  async save(nonce: string, reviewedDigest: string): Promise<void> {
    await this.run(async (scope, generation) => {
      const preview = this.state.preview;
      if (!preview || preview.nonce !== nonce || preview.digest !== reviewedDigest) return;
      const approved = await this.options.confirm(structuredClone(preview));
      if (!this.current(generation, scope) || this.state.preview?.nonce !== nonce) return;
      this.state.preview = undefined;
      if (!approved) { this.state.message = '저장하지 않았어요. 다시 검토한 뒤 저장할 수 있어요.'; return; }
      const fixture = syntheticRecord(preview.manifest.artifacts.length === 1);
      const intent: RecordIntent = { version: 1, scope, mutation_id: (this.options.mutationId ?? randomUUID)(), manifest: fixture.manifest, manifest_sha256: preview.digest,
        consent: { purpose: 'personal-record-save', notice_version: SYNTHETIC_RECORD_NOTICE, manifest_sha256: preview.digest }, files: fixture.files };
      try { await this.store.create(intent); }
      catch (error) {
        if (error instanceof Error && error.message === 'pending_exists') {
          const existing = await this.store.load(scope);
          if (this.current(generation, scope) && existing) this.state.pending = { mutation_id: existing.mutation_id, digest: existing.manifest_sha256, title: existing.manifest.title };
        }
        throw error;
      }
      if (!this.current(generation, scope)) return;
      await this.send(intent, generation);
    });
  }
  async retry(): Promise<void> {
    await this.run(async (scope, generation) => {
      const intent = await this.store.load(scope); if (!this.current(generation, scope)) return;
      if (!intent) { this.state.pending = undefined; this.state.message = '저장 대기 요청이 없어요. 목록을 확인해 주세요.'; return; }
      await this.send(intent, generation);
    });
  }
  private async send(value: RecordIntent, generation: number): Promise<void> {
    const intent = validateIntent(value, value.scope), scope = intent.scope;
    this.state.pending = { mutation_id: intent.mutation_id, digest: intent.manifest_sha256, title: intent.manifest.title }; this.options.changed();
    const staged = await this.call(scope, generation, this.base(scope), 'POST', { mutation_id: intent.mutation_id, manifest: intent.manifest, manifest_sha256: intent.manifest_sha256, consent: intent.consent });
    let record = this.record(object(staged.value) ? staged.value.record : undefined, scope);
    if (record.manifest_sha256 !== intent.manifest_sha256 || record.artifacts.length !== intent.files.length) throw new RecordClientError('integrity');
    for (const file of record.artifacts) {
      const expected = intent.manifest.artifacts.find(f => f.client_ref === file.client_ref);
      const { id: _id, ...descriptor } = file;
      if (!expected || canonicalRecord(expected) !== canonicalRecord(descriptor)) throw new RecordClientError('integrity');
    }
    // A lost completion reply may already have committed. Never PUT a completed immutable record.
    if (record.state !== 'complete') {
      for (const file of record.artifacts) {
        const frozen = intent.files.find(f => f.client_ref === file.client_ref); if (!frozen) throw new RecordClientError('integrity');
        const upload = await this.call(scope, generation, this.base(scope) + '/' + record.id + '/artifacts/' + file.id, 'PUT', undefined, Buffer.from(frozen.base64, 'base64'));
        if (!object(upload.value) || upload.value.stored !== true || upload.value.bytes !== file.bytes || upload.value.sha256 !== file.sha256) throw new RecordClientError('integrity');
      }
      const completed = await this.call(scope, generation, this.base(scope) + '/' + record.id + '/complete', 'POST', { manifest_sha256: intent.manifest_sha256 });
      record = this.record(object(completed.value) ? completed.value.record : undefined, scope, true);
    }
    if (record.manifest_sha256 !== intent.manifest_sha256 || canonicalRecord(record.manifest) !== canonicalRecord(intent.manifest)) throw new RecordClientError('integrity');
    await this.store.acknowledged(scope, intent.mutation_id, intent.manifest_sha256);
    if (!this.current(generation, scope)) return;
    this.state.pending = undefined; this.state.loaded = true; this.state.selected = record; this.state.records = [record, ...this.state.records.filter(r => r.id !== record.id)]; this.state.message = '합성 기록을 저장했어요. 읽기용 사본이며 실제 작업은 가져오지 않았어요.';
  }
  async open(recordId?: string): Promise<void> {
    await this.run(async (scope, generation) => {
      if (recordId !== undefined && !id(recordId)) return;
      const result = await this.call(scope, generation, this.base(scope) + (recordId ? '/' + encodeURIComponent(recordId) : ''));
      if (!object(result.value)) throw new RecordClientError('invalid_response');
      if (recordId) { const record = this.record(result.value.record, scope, true); if (record.id !== recordId) throw new RecordClientError('integrity'); this.state.selected = record; }
      else { if (!Array.isArray(result.value.records)) throw new RecordClientError('invalid_response'); this.state.records = result.value.records.map(r => this.record(r, scope, true)); this.state.selected = undefined; this.state.loaded = true; this.state.message = this.state.records.length ? '저장된 합성 기록을 골라 읽을 수 있어요.' : '저장된 합성 기록이 없어요.'; }
      const pending = await this.store.load(scope); if (!this.current(generation, scope)) return;
      this.state.pending = pending ? { mutation_id: pending.mutation_id, digest: pending.manifest_sha256, title: pending.manifest.title } : undefined;
      this.state.authenticationRequired = false;
    });
  }
  async download(artifactId: string): Promise<void> {
    await this.run(async (scope, generation) => {
      const record = this.state.selected, file = record?.artifacts.find(f => f.id === artifactId);
      if (!record || !file) return;
      const result = await this.call(scope, generation, this.base(scope) + '/' + record.id + '/artifacts/' + file.id, 'GET', undefined, undefined, file.bytes);
      if (result.bytes.length !== file.bytes || recordHash(result.bytes) !== file.sha256 || result.headers.get('x-hps-content-sha256') !== file.sha256 || Number(result.headers.get('content-length')) !== file.bytes
        || result.headers.get('content-type') !== 'application/octet-stream' || !result.headers.get('content-disposition')?.startsWith('attachment;') || result.headers.get('x-content-type-options') !== 'nosniff' || result.headers.get('cache-control') !== 'no-store') throw new RecordClientError('integrity');
      const saved = await this.options.download({ name: file.name, bytes: result.bytes, current: () => this.current(generation, scope) });
      if (this.current(generation, scope)) this.state.message = saved ? '확인된 파일 사본을 저장했어요. 파일은 실행하지 않았어요.' : '파일을 저장하지 않았어요.';
    });
  }
}
