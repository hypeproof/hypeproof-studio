/** DMC-04/06/12/14: local adapter seam, deliberately not a relay or pairing authority. */
import { createHash } from 'node:crypto';
import { CommandRunner, type JournalStore, type JournalState, type CommandEnvelope } from './classroomOpsCommands.ts';
import { fileAttachAllowed, readWorkspaceTextFile } from './fileAttachment.ts';

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export interface CompanionHostRequest {
  schema: 'hps-companion-host-request/1'; requestId: string; actorId: string; deviceId: string;
  hostId: string; workspaceId: string; projectId: string; taskId: string;
  version: number; epoch: number; consentRevision: number; artifactId: string; artifactVersion: string;
  operation: 'preview.read' | 'desktop.continue';
}
/** Supplied by the existing authenticated session/profile/selected activity adapter, never request JSON. */
export interface CompanionHostContext {
  actorId: string; deviceId: string; hostId: string; workspaceId: string; projectId: string; taskId: string;
  version: number; epoch: number; consentRevision: number;
  host: 'online' | 'offline' | 'unknown'; access: 'active' | 'expired' | 'revoked';
  /** Separate current runtime authority. Pairing preview execution_authorized:false maps to false. */
  executionAuthorized: boolean;
  /** Exact operation resolved from that existing runtime authority, never the pairing capability. */
  capability: CompanionHostRequest['operation'];
  profile: { sdk_tools?: { read?: boolean } } | null; instructor: boolean; folderReadAllowed: boolean;
  /** Desktop-selected artifact: a mobile request cannot select a path, URL, command or tool. */
  artifact: { id: string; version: string; path: string }; workspaceRoot: string;
}
export interface CompanionDispatchResult {
  state: 'denied' | 'wait_for_host' | 'desktop_handoff' | 'accepted' | 'running' | 'outcome_unknown' | 'completed' | 'failed';
  code: string;
  requestId?: string;
  artifact?: { id: string; version: string; text: string };
}
const fields = ['schema', 'requestId', 'actorId', 'deviceId', 'hostId', 'workspaceId', 'projectId', 'taskId', 'version', 'epoch', 'consentRevision', 'artifactId', 'artifactVersion', 'operation'];
function parse(bytes: unknown): CompanionHostRequest | null {
  if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 4096) return null;
  try {
    const r = JSON.parse(bytes);
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).length !== fields.length || Object.keys(r).some(k => !fields.includes(k))) return null;
    if (r.schema !== 'hps-companion-host-request/1' || !['requestId', 'actorId', 'deviceId', 'hostId', 'workspaceId', 'projectId', 'taskId', 'artifactId'].every(k => id(r[k])) || !digest(r.artifactVersion)
      || ![r.version, r.epoch, r.consentRevision].every(integer) || !['preview.read', 'desktop.continue'].includes(r.operation)) return null;
    return r;
  } catch { return null; }
}
function gate(r: CompanionHostRequest, c: CompanionHostContext | null): CompanionDispatchResult | null {
  const deny = (code: string): CompanionDispatchResult => ({ state: 'denied', code, requestId: r.requestId });
  if (!c || c.access !== 'active' || c.executionAuthorized !== true) return deny('runtime_authority_required');
  if (c.capability !== r.operation) return deny('runtime_capability_denied');
  if (!['actorId', 'deviceId', 'hostId', 'workspaceId', 'projectId', 'taskId', 'version', 'epoch', 'consentRevision'].every(k => r[k as keyof CompanionHostRequest] === c[k as keyof CompanionHostContext])) return deny('scope_or_version_changed');
  if (!fileAttachAllowed(c.profile, c.instructor) || c.folderReadAllowed !== true) return deny('profile_read_denied');
  if (!c.artifact || r.artifactId !== c.artifact.id || r.artifactVersion !== c.artifact.version) return deny('artifact_version_changed');
  if (c.host !== 'online') return { state: 'wait_for_host', code: 'host_unavailable', requestId: r.requestId };
  return null;
}

/**
 * One instance per existing account/activity journal; never share its journal with another runner.
 * JournalStore.load returns null only for a genuinely absent file; read/parse errors must throw.
 */
export class CompanionHostDispatcher {
  private journalState: JournalState = { entries: [] };
  private readonly runner: CommandRunner;
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;
  private poisoned = false;
  private readonly ports: { journal: JournalStore; context(): Promise<CompanionHostContext | null>; now(): number };
  constructor(ports: CompanionHostDispatcher['ports']) {
    this.ports = ports;
    this.runner = new CommandRunner({
      journal: {
        // A corrupt/unreadable existing journal MUST NOT become an empty inbox in CommandRunner.recover.
        load: async () => this.journalState,
        save: async s => { await ports.journal.save(s); this.journalState = structuredClone(s); },
      },
      monotonic: () => performance.now(), now: ports.now, epoch: () => this.epoch,
      executors: { 'companion.desktop.continue': { mutating: false, acceptsArgs: a => typeof a.bytes === 'string', run: async (_signal, command) => {
        const r = parse(command.args.bytes as string);
        return r && !gate(r, await this.currentContext()) ? { ok: true, code: 'continuation_required' } : { ok: false, code: 'authority_changed' };
      } }, 'companion.preview.read': { mutating: false, acceptsArgs: a => typeof a.bytes === 'string', run: async (_signal, command) => {
        const r = parse(command.args.bytes as string);
        const context = await this.currentContext();
        if (!r || gate(r, context) || !context) return { ok: false, code: 'authority_changed' };
        const read = readWorkspaceTextFile(context.workspaceRoot, context.artifact.path);
        if (!read.ok) return { ok: false, code: `artifact_${read.cause}` };
        if (hash(read.preview.text) !== r.artifactVersion) return { ok: false, code: 'artifact_version_changed' };
        // Recheck current consent/profile/scope after reading; never return cached data after revocation.
        if (gate(r, await this.currentContext())) return { ok: false, code: 'authority_changed' };
        return { ok: true, code: 'preview_read', output: { id: r.artifactId, version: r.artifactVersion, text: read.preview.text } };
      } } },
    });
  }
  private epoch = 0;
  private async currentContext(): Promise<CompanionHostContext | null> {
    try { return await this.ports.context(); } catch { return null; }
  }
  async recover(): Promise<void> {
    this.ready = false;
    const held = await this.ports.journal.load();
    if (held !== null && (!held || !Array.isArray(held.entries) || held.entries.length > 200)) throw Error('invalid_companion_journal');
    const seen = new Set<string>();
    for (const entry of held?.entries ?? []) {
      const r = parse(entry?.envelope?.args?.bytes);
      const out = entry.output as CompanionDispatchResult['artifact'];
      if (!r || seen.has(r.requestId) || entry.envelope.command_id !== r.requestId || entry.envelope.action !== `companion.${r.operation}`
        || entry.envelope.connection_epoch !== r.epoch || !['accepted', 'running', 'succeeded', 'failed', 'rejected', 'outcome_unknown', 'unsupported'].includes(entry.state)
        || (entry.state === 'succeeded' && r.operation === 'preview.read' && (!out || out.id !== r.artifactId || out.version !== r.artifactVersion || typeof out.text !== 'string' || hash(out.text) !== r.artifactVersion))) throw Error('invalid_companion_journal');
      seen.add(r.requestId);
    }
    this.journalState = held ?? { entries: [] };
    await this.runner.recover(); this.ready = true;
  }
  dispatch(bytes: string): Promise<CompanionDispatchResult> {
    const next = this.queue.then(() => this.run(bytes));
    this.queue = next.catch(() => {}); return next;
  }
  private async run(bytes: string): Promise<CompanionDispatchResult> {
    const r = parse(bytes);
    if (!r) return { state: 'denied', code: 'invalid_request' };
    if (!this.ready || this.poisoned) return { state: 'denied', code: 'journal_unavailable', requestId: r.requestId };
    const context = await this.currentContext();
    const refused = gate(r, context); if (refused) return refused;
    const previous = this.journalState.entries.find(e => e.envelope.command_id === r.requestId);
    if (previous && previous.envelope.args.bytes !== bytes) return { state: 'denied', code: 'request_id_conflict', requestId: r.requestId };
    // Validate the actual selected resource before accepting; no path is taken from the request.
    if (!previous && r.operation === 'preview.read') {
      const read = readWorkspaceTextFile(context!.workspaceRoot, context!.artifact.path);
      if (!read.ok || hash(read.preview.text) !== r.artifactVersion) return { state: 'denied', code: 'artifact_unavailable_or_changed', requestId: r.requestId };
    }
    this.epoch = context!.epoch;
    try {
      if (!previous) {
        if (this.journalState.entries.length >= 200) return { state: 'denied', code: 'journal_capacity', requestId: r.requestId };
        const envelope: CommandEnvelope = { schema_version: 1, command_id: r.requestId, action: `companion.${r.operation}`, args: { bytes }, lease_generation: 0, connection_epoch: r.epoch, issued_at: this.ports.now(), start_within_ms: 10_000, run_within_ms: 10_000 };
        await this.runner.onCommands([envelope]); // exact payload durable before accepted/running
        await this.runner.onAcks([{ command_id: r.requestId, state: 'accepted', proceed: true, reason: 'local_authority_checked' }]);
      }
      const result = this.runner.result(r.requestId);
      if (!result) return { state: 'denied', code: 'journal_unavailable', requestId: r.requestId };
      if (gate(r, await this.currentContext())) return { state: 'denied', code: 'authority_changed', requestId: r.requestId };
      return { state: result.state === 'succeeded' ? r.operation === 'desktop.continue' ? 'desktop_handoff' : 'completed' : result.state === 'rejected' || result.state === 'unsupported' ? 'denied' : result.state,
        code: result.code, requestId: r.requestId, ...(result.state === 'succeeded' && result.output ? { artifact: result.output as CompanionDispatchResult['artifact'] } : {}) };
    } catch {
      // A failed durable write is not ACK. Stop this instance; recovery must inspect the held journal.
      this.poisoned = true; this.runner.close();
      return { state: 'denied', code: 'journal_unavailable', requestId: r.requestId };
    }
  }
}
