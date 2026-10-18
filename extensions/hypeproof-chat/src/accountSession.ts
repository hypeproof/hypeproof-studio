import { randomBytes } from 'node:crypto';

/** Host-only personal account credentials. Presentation state deliberately has no credential fields. */
export const ACCOUNT_SECRET_KEY = 'hypeproofChat.personalAccount.v1';
export interface AccountIdentity { id: string; email: string; display_name: string }
export interface AccountPass {
  id: string; product_name: string; status: string; requests_used: number; requests_limit: number;
  requests_remaining: number; starts_at: number | null; expires_at: number | null; amount: number;
  duration_seconds: number; activation_deadline_at: number | null;
}
export interface AccountView {
  status: 'signedOut' | 'waiting' | 'signedIn'; busy?: boolean; message?: string;
  userCode?: string; expiresAt?: number; account?: AccountIdentity; passes?: AccountPass[];
}
export interface AccountPassBinding { sessionId: string; passId: string }
interface Bundle { service: string; accessToken: string; refreshToken: string; expiresAt: number; sessionId: string }
interface SecretStore { get(key: string): PromiseLike<string | undefined>; store(key: string, value: string): PromiseLike<void>; delete(key: string): PromiseLike<void> }
interface Options {
  service: string; site: string; secrets: SecretStore; label: string;
  openBrowser(url: string): PromiseLike<boolean>; changed?(): void;
  /** Resolves the original desktop window through VS Code's URI router. No credentials. */
  createReturnUri?(state: string): PromiseLike<string>;
  returned?(): PromiseLike<void>;
  invalidated?(sessionId: string): Promise<void>;
  /** Serializes mutation across extension-host windows, not only concurrent requests in one host. */
  lock?<T>(work: () => Promise<T>): Promise<T>;
  fetch?: typeof fetch; now?: () => number;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const identity = (v: unknown): AccountIdentity | undefined => record(v) && typeof v.id === 'string' && typeof v.email === 'string'
  ? { id: v.id, email: v.email, display_name: typeof v.display_name === 'string' ? v.display_name : v.email } : undefined;
export function accountPreviewEnabled(enabled: boolean, service: string, site: string): boolean {
  if (!enabled) return false;
  try { return [service, site].every(value => { const u = new URL(value); return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash; }); }
  catch { return false; }
}
export function safeDeviceUrl(value: unknown, site: string): value is string {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value), configured = new URL(site); return u.origin === configured.origin && u.pathname === '/studio/connect' && !u.username && !u.password && !u.hash && [...u.searchParams.keys()].every(k => k === 'code'); }
  catch { return false; }
}
export class AccountError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const friendly = (code: string): string => {
  if (/denied/.test(code)) return '브라우저에서 연결을 거절했어요. 다시 시작할 수 있어요.';
  if (/expired/.test(code)) return '로그인 시간이 지났어요. Google로 시작하기를 다시 눌러 주세요.';
  if (/revoked|suspended|deleted|invalid.*token|unauthorized|refresh.*reuse/.test(code)) return '이 기기의 로그인이 끝났어요. Google로 다시 로그인해 주세요.';
  if (/pass|trial/.test(code)) return '이 이용권을 사용할 수 없어요. 이용권 목록을 새로고침해 주세요.';
  return '계정에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
};
export class AccountSession {
  private readonly options: Options;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private serial: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private device?: { code: string; url: string; expiresAt: number; interval: number; generation: number };
  private timer?: ReturnType<typeof setTimeout>;
  private browserReturn?: { state: string; uri: string; expiresAt: number; received: boolean };
  private polling?: Promise<void>;
  private passTokens = new Map<string, { token: string; expiresAt: number; sessionId: string }>();
  private lastSession?: string;
  private state: AccountView = { status: 'signedOut' };
  constructor(options: Options) { this.options = options; this.request = options.fetch ?? fetch; this.now = options.now ?? Date.now; }
  matches(service: string, site: string): boolean { return service === this.options.service && site === this.options.site; }
  view(): AccountView { return structuredClone(this.state); }
  private emit(): void { this.options.changed?.(); }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(() => this.options.lock ? this.options.lock(work) : work());
    this.serial = next.catch(() => undefined); return next;
  }
  private async read(): Promise<Bundle | undefined> {
    const raw = await this.options.secrets.get(ACCOUNT_SECRET_KEY);
    if (!raw) return;
    try { const b = JSON.parse(raw); if (b.service === this.options.service && typeof b.accessToken === 'string' && typeof b.refreshToken === 'string' && typeof b.sessionId === 'string' && Number.isFinite(b.expiresAt)) { this.lastSession = b.sessionId; return b; } }
    catch { /* An unreadable or foreign-service credential never leaves storage. */ }
  }
  private parseBundle(body: any): Bundle {
    if (!record(body) || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || typeof body.session_id !== 'string' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new AccountError('invalid_response', friendly('invalid_response'));
    return { service: this.options.service, accessToken: body.access_token, refreshToken: body.refresh_token, sessionId: body.session_id, expiresAt: this.now() + body.expires_in * 1000 };
  }
  private async call(path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
    try {
      const r = await this.request(this.options.service.replace(/\/+$/, '') + path, {
        method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
      const value: any = await r.json();
      if (!r.ok) { const code = typeof value?.error === 'string' ? value.error : typeof value?.error?.code === 'string' ? value.error.code : `http_${r.status}`; throw new AccountError(code, friendly(code)); }
      return { status: r.status, body: value };
    } catch (error) { if (error instanceof AccountError) throw error; throw new AccountError('unavailable', friendly('unavailable')); }
  }
  private async forget(bundle: Bundle, message: string): Promise<void> {
    this.passTokens.clear(); this.lastSession = undefined;
    await this.options.secrets.delete(ACCOUNT_SECRET_KEY);
    await this.options.invalidated?.(bundle.sessionId);
    this.state = { status: 'signedOut', message }; this.emit();
  }
  private async save(bundle: Bundle, previous?: Bundle): Promise<void> {
    try { await this.options.secrets.store(ACCOUNT_SECRET_KEY, JSON.stringify(bundle)); }
    catch {
      await this.call('/auth/logout', {}, bundle.accessToken).catch(() => undefined);
      await this.options.secrets.delete(ACCOUNT_SECRET_KEY);
      this.passTokens.clear(); this.lastSession = undefined;
      if (previous) await this.options.invalidated?.(previous.sessionId);
      this.state = {status:'signedOut',message:'이 기기에 로그인 정보를 저장하지 못했어요. 다시 로그인해 주세요.'}; this.emit();
      throw new AccountError('storage_failed', this.state.message!);
    }
  }
  /** Every refresh reads storage under the lock: another window may already have rotated it. */
  async accessToken(): Promise<string | undefined> {
    return this.exclusive(async () => {
      const b = await this.read(); if (!b) return;
      if (b.expiresAt > this.now() + 300_000) return b.accessToken;
      try { const response = await this.call('/auth/refresh', { refresh_token: b.refreshToken }); const next = this.parseBundle(response.body); await this.save(next, b); return next.accessToken; }
      catch (e) { if (e instanceof AccountError && /^(invalid_refresh|refresh_reuse|session_revoked|invalid_token|authentication_required)$/.test(e.code)) await this.forget(b, e.message); throw e; }
    });
  }
  private async authenticated(path: string, body?: unknown): Promise<any> {
    const token = await this.accessToken(); if (!token) throw new AccountError('unauthorized', friendly('unauthorized'));
    try { return (await this.call(path, body, token)).body; }
    catch (e) {
      if (e instanceof AccountError && /^(account_(suspended|deleted|session_revoked)|session_revoked|unauthorized|invalid_token|authentication_required|http_401)$/.test(e.code)) {
        await this.exclusive(async () => { const b = await this.read(); if (b?.accessToken === token) await this.forget(b, e.message); });
      }
      throw e;
    }
  }
  async refreshView(): Promise<void> {
    const initial = await this.read();
    if (!initial) {
      if (this.lastSession) { const old = this.lastSession; this.lastSession = undefined; this.passTokens.clear(); await this.options.invalidated?.(old); }
      if (!this.device) this.state = { status: 'signedOut', message: this.state.message }; this.emit(); return;
    }
    try {
      const me = await this.authenticated('/me');
      const passes = await this.authenticated('/me/passes');
      const a = identity(me.account); if (!a || !Array.isArray(passes.passes)) throw new AccountError('invalid_response', friendly('invalid_response'));
      if ((await this.read())?.sessionId !== initial.sessionId) return;
      // Whitelist fields, even if a server accidentally adds credentials to an account response.
      this.state = { status: 'signedIn', account: a, passes: passes.passes.filter((p: any) => record(p) && typeof p.id === 'string').map((p: any) => ({ id: p.id, product_name: String(p.product_name ?? '이용권'), status: String(p.status), requests_used: Number(p.requests_used), requests_limit: Number(p.requests_limit), requests_remaining: Number(p.requests_remaining), starts_at: p.starts_at ?? null, expires_at: p.expires_at ?? null, amount: Number(p.amount), duration_seconds: Number(p.duration_seconds) || 0, activation_deadline_at: p.activation_deadline_at ?? null })) };
    } catch (e) { this.state = { ...this.state, message: e instanceof AccountError ? e.message : friendly('unavailable') }; }
    this.emit();
    await this.completeReturn();
  }
  async start(): Promise<void> {
    if (await this.read()) return;
    this.cancel(false); const generation = this.generation;
    this.state = { status: 'signedOut', busy: true }; this.emit();
    try {
      const state = randomBytes(32).toString('hex');
      const returnUri = await this.options.createReturnUri?.(state);
      if (generation !== this.generation) return;
      const { body: d } = await this.call('/auth/device/start', { label: this.options.label, ...(returnUri ? { return_uri: returnUri } : {}) });
      if (generation !== this.generation) return;
      const url = d.verification_uri_complete ?? d.verification_uri;
      if (!safeDeviceUrl(url, this.options.site) || typeof d.device_code !== 'string' || typeof d.user_code !== 'string' || !Number.isFinite(d.expires_in) || d.expires_in <= 0) throw new AccountError('invalid_response', friendly('invalid_response'));
      const expiresAt = this.now() + Math.min(d.expires_in, 600) * 1000;
      this.browserReturn = returnUri ? { state, uri: returnUri, expiresAt, received: false } : undefined;
      this.device = { code: d.device_code, url, expiresAt, interval: Math.max(3, Number(d.interval) || 3) * 1000, generation };
      this.state = { status: 'waiting', userCode: d.user_code, expiresAt, message: '브라우저에서 Google 로그인 후 이 Studio 연결을 승인해 주세요.' }; this.emit();
      if (!await this.options.openBrowser(url)) { this.state.message = '브라우저를 열지 못했어요. 로그인 창 다시 열기를 눌러 주세요.'; this.emit(); }
      this.schedule();
    } catch (e) { if (generation === this.generation) { this.state = { status: 'signedOut', message: e instanceof AccountError ? e.message : friendly('unavailable') }; this.emit(); } }
  }
  private schedule(): void { if (this.timer) clearTimeout(this.timer); if (this.device) this.timer = setTimeout(() => { void this.poll(); }, this.device.interval); }
  async reopen(): Promise<void> {
    if (!this.device) return;
    try {
      const opened = await this.options.openBrowser(this.device.url);
      this.state.message = opened ? '브라우저에서 연결 번호를 확인하고 승인해 주세요.' : '브라우저를 열지 못했어요. 기본 브라우저 설정을 확인하고 다시 시도해 주세요.';
    } catch { this.state.message = '브라우저를 열지 못했어요. 기본 브라우저 설정을 확인하고 다시 시도해 주세요.'; }
    this.emit();
  }
  /** Callback is a wake-up signal only. The Service's explicit device approval grants credentials. */
  async browserReturned(state: string): Promise<boolean> {
    const pending = this.browserReturn;
    if (!pending || state !== pending.state || this.now() >= pending.expiresAt) return false;
    pending.received = true;
    await this.poll();
    return this.state.status === 'signedIn';
  }
  private async completeReturn(): Promise<void> {
    const pending = this.browserReturn;
    if (!pending || this.state.status !== 'signedIn' || this.now() >= pending.expiresAt) return;
    this.browserReturn = undefined;
    try { await this.options.returned?.(); }
    catch { this.state.message = '로그인됐어요. Studio 시작 화면을 다시 열면 이용권을 확인할 수 있어요.'; this.emit(); }
    if (!pending.received) {
      // Do not await URI dispatch: its handler can join this very poll. VS Code's
      // resolved URI carries the originating windowId and requests OS foreground.
      void Promise.resolve().then(() => this.options.openBrowser(pending.uri)).then(opened => {
        if (!opened && this.state.status === 'signedIn') { this.state.message = '로그인됐어요. Dock 또는 작업 표시줄에서 Studio를 선택해 주세요.'; this.emit(); }
      }).catch(() => {
        if (this.state.status === 'signedIn') { this.state.message = '로그인됐어요. Dock 또는 작업 표시줄에서 Studio를 선택해 주세요.'; this.emit(); }
      });
    }
  }
  async poll(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = this.pollOnce();
    try { await this.polling; } finally { this.polling = undefined; }
  }
  private async pollOnce(): Promise<void> {
    const d = this.device; if (!d) return;
    if (this.now() >= d.expiresAt) { this.cancel(false); this.state = { status: 'signedOut', message: friendly('device_expired') }; this.emit(); return; }
    try {
      const result = await this.call('/auth/device/poll', { device_code: d.code });
      if (this.device !== d || d.generation !== this.generation) {
        // Cancellation during the final poll must revoke the just-created session, never install it.
        if (result.body?.access_token) await this.call('/auth/logout', {}, result.body.access_token).catch(() => undefined);
        return;
      }
      if (result.status === 202 || result.body.status === 'pending') { this.schedule(); return; }
      const bundle = this.parseBundle(result.body);
      await this.exclusive(async () => {
        if (this.device !== d) { await this.call('/auth/logout', {}, bundle.accessToken).catch(() => undefined); return; }
        await this.save(bundle);
        if (this.device !== d) { await this.call('/auth/logout', {}, bundle.accessToken).catch(() => undefined); await this.options.secrets.delete(ACCOUNT_SECRET_KEY); }
      });
      if (this.device !== d) return;
      // Retain only the short-lived return nonce until the browser routes the original window.
      const browserReturn = this.browserReturn;
      this.cancel(false); this.browserReturn = browserReturn;
      await this.refreshView();
      await this.completeReturn();
    } catch (e) {
      if (this.device !== d) return;
      if (e instanceof AccountError && (e.code === 'unavailable' || e.code === 'slow_down' || e.code === 'rate_limited' || /^http_5/.test(e.code))) { if (e.code === 'slow_down') d.interval = Math.min(d.interval + 1000, 15000); this.state.message = '연결을 다시 확인하고 있어요. 잠시만 기다려 주세요.'; this.emit(); this.schedule(); return; }
      this.cancel(false); this.state = { status: 'signedOut', message: e instanceof AccountError ? e.message : friendly('unavailable') }; this.emit();
    }
  }
  cancel(notify = true): void { this.browserReturn = undefined; this.generation++; this.device = undefined; if (this.timer) clearTimeout(this.timer); this.timer = undefined; if (notify) { this.state = { status: 'signedOut', message: '로그인을 취소했어요.' }; this.emit(); } }
  async activate(passId: string): Promise<{ token: string; binding: AccountPassBinding }> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(passId)) throw new AccountError('invalid_pass', friendly('invalid_pass'));
    const before = await this.read(); if (!before) throw new AccountError('unauthorized', friendly('unauthorized'));
    const r = await this.authenticated(`/me/passes/${encodeURIComponent(passId)}/activate`, {});
    const current = await this.read();
    if (!current || current.sessionId !== before.sessionId) throw new AccountError('unauthorized', friendly('unauthorized'));
    if (typeof r.access_token !== 'string' || !Number.isFinite(r.expires_in)) throw new AccountError('invalid_response', friendly('invalid_response'));
    this.passTokens.set(passId, { token: r.access_token, expiresAt: this.now() + r.expires_in * 1000, sessionId: current.sessionId });
    return { token: r.access_token, binding: { passId, sessionId: current.sessionId } };
  }
  /** Invoked by ActivityConnections.token(), the credential path used by both proxy and SDK turns. */
  async resolvePass(binding: AccountPassBinding): Promise<string | undefined> {
    const current = await this.read(); if (!current || current.sessionId !== binding.sessionId) return;
    const cached = this.passTokens.get(binding.passId);
    if (cached?.sessionId === current.sessionId && cached.expiresAt > this.now() + 300_000) return cached.token;
    return (await this.activate(binding.passId)).token;
  }
  async signOut(): Promise<void> {
    this.cancel(false);
    await this.exclusive(async () => {
      const b = await this.read(); if (!b) { this.state = { status: 'signedOut' }; this.emit(); return; }
      // Local credentials are removed even offline. Remote revoke failures are visible and retryable on the account site.
      let revoked = true;
      try {
        // Already inside the cross-window lock: refresh directly, never nest accessToken().
        let token = b.accessToken;
        if (b.expiresAt <= this.now() + 60_000) token = this.parseBundle((await this.call('/auth/refresh', {refresh_token:b.refreshToken})).body).accessToken;
        await this.call('/auth/logout', {}, token);
      } catch { revoked = false; }
      await this.forget(b, revoked ? '이 기기에서 로그아웃했어요.' : '이 기기의 로그인 정보를 지웠어요. 서버에 연결하지 못해 원격 로그아웃은 확인하지 못했어요. 계정 페이지에서 기기 로그아웃을 확인해 주세요.');
    });
  }
  async openAccount(): Promise<void> { await this.options.openBrowser(new URL('/account', this.options.site).href); }
  dispose(): void { this.cancel(false); }
}
