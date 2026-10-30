/** Native DEV-only HTTP boundary. No registration, credentials store, polling or protocol crypto. */
import { ExtensionMode, type ExtensionContext } from 'vscode';
import { Buffer } from 'node:buffer';
import { accountPreviewEnabled, type AccountSession } from './accountSession.ts';
import type { CompanionAdapterPairingTransport, CompanionAdapterRelayTransport } from './companionClientAdapter.ts';

type Role = 'host' | 'device';
interface Config { service: string; site: string }
interface Identity { accountId: string; sessionId: string }
export interface CompanionAuthenticatedTransportPorts {
  context: Pick<ExtensionContext, 'extensionMode'>;
  accounts: Pick<AccountSession, 'matches' | 'accessToken' | 'sessionIdentity'>;
  configured(): Config;
  /** Already resolved native owner binding. Never supplied by a browser request. */
  identity: Readonly<Identity>;
  role: Role;
  /**
   * ONE existing session owner admits each actual HTTP request here. For example:
   * (url, init) => budget.run(() => fetch(url, init), init?.signal ?? undefined).
   * Or pass raw fetch when the existing client adapter already admits its one-HTTP
   * transport calls; explicitly admit initial resolveIdentity through that same owner.
   * Choose ONE layer: never nest those admissions. This boundary owns no budget/retry.
   */
  dispatch: typeof fetch;
  timeoutMs?: number;
}
export interface CompanionAuthenticatedTransport {
  /** Explicit one-time /me resolution. Stored identity is routing, never current server authority. */
  resolveIdentity(signal?: AbortSignal): Promise<Readonly<Identity>>;
  pairing: CompanionAdapterPairingTransport;
  relay: CompanionAdapterRelayTransport;
}
const REQUEST_BYTES = 8192, RESPONSE_BYTES = 64 * 1024;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
class TransportFailure extends Error {}
const fail = (code: string): never => { throw new TransportFailure(`companion_authenticated_${code}`); };
const id = (v: string) => /^ci_[a-f0-9]{32}$/.test(v);
const pairActions = { host: [null, 'publish', 'status', 'approve', 'revoke'], device: ['inspect', 'claim', 'status', 'consume'] };
const relayActions = ['offer', 'keys', 'send', 'receive', 'ack'];

/** Constructing this object does not read credentials or perform an HTTP operation. */
export function createCompanionAuthenticatedTransport(ports: CompanionAuthenticatedTransportPorts): CompanionAuthenticatedTransport {
  const expected = Object.freeze({ ...ports.identity }), role = ports.role;
  const timeoutMs = ports.timeoutMs ?? 12_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12_000) fail('invalid_bounds');
  let dead = false, binding: Config | undefined, resolved = false;
  let resolving: Promise<Readonly<Identity>> | undefined;
  const invalidate = (): never => { dead = true; return fail('binding_changed'); };
  const config = (): Config => {
    if (dead) fail('binding_changed');
    const c = ports.configured();
    if (ports.context.extensionMode !== ExtensionMode.Development || !c || !ports.accounts.matches(c.service, c.site)
      || !accountPreviewEnabled(true, c.service, c.site) || !/^\/v1\/?$/.test(new URL(c.service).pathname)
      || new URL(c.site).pathname !== '/' || !expected.accountId || !expected.sessionId || !['host', 'device'].includes(role)) return invalidate();
    if (binding && (binding.service !== c.service || binding.site !== c.site)) return invalidate();
    return { service: c.service, site: c.site };
  };
  async function operation<T>(signal: AbortSignal | undefined, work: (scope: Scope) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(new TransportFailure('companion_authenticated_cancelled'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new TransportFailure('companion_authenticated_timeout')), timeoutMs);
    let onAbort!: () => void;
    const stopped = new Promise<never>((_, reject) => { onAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', onAbort, { once: true }); });
    const check = () => { if (controller.signal.aborted) throw controller.signal.reason; };
    const wait = async <V>(promise: PromiseLike<V>): Promise<V> => { check(); return Promise.race([Promise.resolve(promise), stopped]); };
    try {
      check(); const before = config();
      const token = await wait(ports.accounts.accessToken()); check();
      const current = await wait(ports.accounts.sessionIdentity()); check();
      if (!token || !current || current.service !== before.service || current.sessionId !== expected.sessionId) return invalidate();
      const fresh = async () => {
        check(); const after = config();
        if (after.service !== before.service || after.site !== before.site) return invalidate();
        const identity = await wait(ports.accounts.sessionIdentity());
        const liveToken = await wait(ports.accounts.accessToken()); check(); config();
        if (!identity || identity.sessionId !== expected.sessionId || identity.service !== before.service || liveToken !== token) return invalidate();
      };
      await fresh();
      const request = async (path: string, raw?: string): Promise<Record<string, unknown>> => {
        await fresh();
        const dispatched = ports.dispatch(before.service.replace(/\/+$/, '') + path, {
          method: raw === undefined ? 'GET' : 'POST',
          headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(raw === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(raw === undefined ? {} : { body: raw }), redirect: 'error', credentials: 'omit', signal: controller.signal,
        });
        void dispatched.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const response = await wait(dispatched);
        if (response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
          // No reader owns this body yet. Release it before the operation clears
          // its deadline, including a live body that never completes by itself.
          void response.body?.cancel().catch(() => {});
          fail('invalid_response');
        }
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) { void response.body?.cancel().catch(() => {}); fail('response_too_large'); }
        const reader = response.body?.getReader(); if (!reader) return fail('invalid_response');
        const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '';
        try {
          for (;;) { const chunk = await wait(reader.read()); if (chunk.done) break; size += chunk.value.byteLength;
            if (size > RESPONSE_BYTES) fail('response_too_large'); text += decoder.decode(chunk.value, { stream: true }); }
          text += decoder.decode();
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        let value: unknown; try { value = JSON.parse(text); } catch { return fail('invalid_response'); }
        await fresh();
        if (!record(value)) return fail('invalid_response');
        if (!response.ok || value.error !== undefined) {
          const code = typeof value.error === 'string' && /^[a-z0-9_]{1,64}$/.test(value.error) ? value.error : 'companion_authenticated_denied';
          throw new TransportFailure(code);
        }
        return value;
      };
      const value = await work({ request }); await fresh(); return value;
    } catch (error) {
      // Fetch/account/decoder errors can include implementation details; never echo a raw body or credential.
      if (error instanceof TransportFailure) throw error;
      return fail('unavailable');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort); }
  }
  interface Scope { request(path: string, raw?: string): Promise<Record<string, unknown>> }
  const protocol = (kind: 'pairing' | 'relay', requestRole: Role, invitationId: string | null | undefined, action: string | null, raw: string, signal?: AbortSignal) => {
    // Route/body checks are synchronous and occur before credentials or admission.
    if (requestRole !== role || typeof raw !== 'string' || Buffer.byteLength(raw) > REQUEST_BYTES) return Promise.reject(Error('companion_authenticated_invalid_request'));
    let body: unknown; try { body = JSON.parse(raw); } catch { return Promise.reject(Error('companion_authenticated_invalid_request')); }
    if (!record(body) || (kind === 'pairing' && !(pairActions[role] as readonly (string | null)[]).includes(action))
      || (kind === 'relay' && !relayActions.includes(action ?? '')) || (action === null ? invitationId !== null : !id(invitationId ?? ''))) return Promise.reject(Error('companion_authenticated_invalid_request'));
    return operation(signal, async ({ request }) => {
      if (!resolved) fail('identity_required');
      const path = '/companion/invitations' + (action === null ? '' : '/' + invitationId + (kind === 'relay' ? '/relay/' : '/') + action);
      const value = await request(path, raw);
      if (kind === 'pairing' && record(value.invitation) && value.invitation.account_id !== expected.accountId) return invalidate();
      if (value.execution_authorized !== false || value.scope_authority !== 'authenticated_declaration'
        || (kind === 'relay' ? value.schema !== 'hps-companion-relay-dev/1' || value.transport_only !== true || value.host_durable_accepted !== false
          : !record(value.invitation) || value.invitation.schema !== 'hps-companion-pairing-preview/2' || value.invitation.account_id !== expected.accountId
            || (role === 'host' && value.invitation.host_session_id !== expected.sessionId))) fail('invalid_response');
      if (kind === 'relay') {
        const shape = action === 'offer' ? record(value.offer) : action === 'keys' ? Array.isArray(value.offers) && typeof value.context_digest === 'string'
          : action === 'receive' ? Array.isArray(value.messages) && value.messages.length <= 8 && value.messages.every(record)
          : typeof value.message_id === 'string' && typeof value.message_hash === 'string'
            && (action === 'ack' ? value.state === 'transport_acknowledged' : ['transport_accepted', 'transport_acknowledged'].includes(String(value.state)));
        if (!shape) fail('invalid_response');
      }
      return value;
    });
  };
  return {
    resolveIdentity(signal) {
      if (resolving) return resolving;
      if (resolved) return Promise.reject(Error('companion_authenticated_already_resolved'));
      let candidate!: Config;
      resolving = operation(signal, async ({ request }) => {
        candidate = config(); const me = await request('/me');
        if (!record(me.account) || me.account.id !== expected.accountId || me.session_id !== expected.sessionId) return invalidate();
        return Object.freeze({ ...expected });
      }).then(identity => {
        const c = config(); if (c.service !== candidate.service || c.site !== candidate.site) return invalidate();
        binding = candidate; resolved = true; return identity;
      }).finally(() => { resolving = undefined; });
      return resolving;
    },
    pairing: (requestRole, invitationId, action, payload, signal) => {
      let raw: string; try { if (!record(payload)) return Promise.reject(Error('companion_authenticated_invalid_request')); raw = JSON.stringify(payload); } catch { return Promise.reject(Error('companion_authenticated_invalid_request')); }
      return protocol('pairing', requestRole, invitationId, action, raw, signal);
    },
    relay: (requestRole, invitationId, action, raw, signal) => protocol('relay', requestRole, invitationId, action, raw, signal),
  };
}
