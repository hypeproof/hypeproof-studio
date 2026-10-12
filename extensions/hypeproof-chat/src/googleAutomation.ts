import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export interface EmailRecipe {
  schema: 'hps-email-automation/1'; title: string; description: string; category: 'email';
  subjectTemplate: string; bodyTemplate: string;
  columns: { email: string; name: string; document: string; dueDate: string };
}
export interface EmailMessage { readonly id: string; readonly to: string; readonly subject: string; readonly body: string }
export interface EmailPreview { readonly id: string; readonly createdAt: number; readonly messages: readonly EmailMessage[] }
export interface SendRecord { id: string; status: 'sending' | 'sent' | 'unknown' | 'failed'; providerId?: string; error?: string }
export interface OAuthListener { redirectUri: string; wait: Promise<URL>; close(): void }
export interface GoogleAutomationDeps {
  clientId: string; clientSecret?: string; maxRecipients?: number;
  secrets: { get(key: string): PromiseLike<string | undefined>; store(key: string, value: string): PromiseLike<void>; delete(key: string): PromiseLike<void> };
  openBrowser(url: string): PromiseLike<unknown>;
  ledger: { load(): Promise<Record<string, SendRecord>>; save(records: Record<string, SendRecord>): Promise<void> };
  isAllowed(): boolean;
  fetchImpl?: typeof fetch;
  listenOAuth?: () => Promise<OAuthListener>;
  now?: () => number;
}
const TOKEN_KEY = 'hps.google.email-automation.v1';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const fail = (message: string): never => { throw new Error(message); };
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(k => keys.includes(k));

export function validateEmailRecipe(value: unknown): EmailRecipe {
  if (!plain(value) || !exact(value, ['schema','title','description','category','subjectTemplate','bodyTemplate','columns']) || value.schema !== 'hps-email-automation/1' || value.category !== 'email') fail('자동화 형식이 올바르지 않아요.');
  const v = value as Record<string, unknown>;
  for (const [key, max] of [['title',120],['description',1000],['subjectTemplate',240],['bodyTemplate',10000]] as const) {
    if (typeof v[key] !== 'string' || !(v[key] as string).trim() || (v[key] as string).length > max || /[\x00]/.test(v[key] as string)) fail('자동화 제목과 내용을 확인해 주세요.');
  }
  if (/[\r\n]/.test(v.subjectTemplate as string)) fail('메일 제목에 줄바꿈을 넣을 수 없어요.');
  if (!plain(v.columns) || !exact(v.columns, ['email','name','document','dueDate']) || Object.values(v.columns).some(x => typeof x !== 'string' || !x.trim() || x.length > 120 || /[\r\n\x00]/.test(x))) fail('열 이름을 확인해 주세요.');
  for (const key of ['subjectTemplate','bodyTemplate']) {
    const stripped = (v[key] as string).replace(/\{\{(name|document|dueDate)\}\}/g, '');
    if (/\{\{|\}\}/.test(stripped)) fail('이름·요청 자료·기한 변수만 사용할 수 있어요.');
  }
  if (Buffer.byteLength(JSON.stringify(v)) > 32768) fail('자동화가 너무 커요.');
  return structuredClone(value) as EmailRecipe;
}

/** Binds only IPv4 loopback and releases the port on success, cancellation or timeout. */
export async function listenGoogleOAuth(): Promise<OAuthListener> {
  let accept!: (url: URL) => void;
  let reject!: (error: Error) => void;
  const wait = new Promise<URL>((yes, no) => { accept = yes; reject = no; });
  // Attach a handler immediately: opening the system browser can itself fail.
  void wait.catch(() => {});
  let redirectUri = '';
  let done = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (req.method !== 'GET' || url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return; }
    if (done) { res.writeHead(409); res.end(); return; }
    done = true;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Studio로 돌아가 연결 결과를 확인해 주세요.');
    accept(url);
  });
  await new Promise<void>((resolve, rejectListen) => { server.once('error', rejectListen); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); return fail('로그인 연결을 준비하지 못했어요.'); }
  redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
  const timer = setTimeout(() => { done = true; reject(new Error('로그인 시간이 만료됐어요. 다시 연결해 주세요.')); server.close(); }, 180000);
  return { redirectUri, wait, close() { clearTimeout(timer); server.close(); if (!done) { done = true; reject(new Error('로그인을 취소했어요.')); } } };
}

/** RFC 2047 subject and base64 body keep sheet data out of MIME headers. */
export function gmailMime(message: EmailMessage): string {
  if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(message.to) || /[\r\n\x00]/.test(message.subject)) fail('수신자 또는 메일 제목이 올바르지 않아요.');
  const encodedSubject = [...message.subject].reduce<string[]>((parts, char) => { const i = parts.length - 1; if (i < 0 || Buffer.byteLength(parts[i]! + char) > 42) parts.push(char); else parts[i] += char; return parts; }, []).map(part => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`).join('\r\n ');
  const body = Buffer.from(message.body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  return Buffer.from(`To: ${message.to}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}\r\n`).toString('base64url');
}

interface GoogleToken { accessToken: string; refreshToken?: string; expiresAt: number; accountId?: string; connectionId?: string }
export function createGoogleAutomationRuntime(deps: GoogleAutomationDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const maxRecipients = Math.max(1, Math.min(100, Math.floor(deps.maxRecipients ?? 20)));
  const previews = new Map<string, EmailPreview>();
  const previewRevisions = new Map<string, string>();
  const rowRevisions = new WeakMap<string[][], string>();
  let sending = false;
  let connecting = false;
  let generation = 0;
  let cachedSheet: { rows: string[][]; revision: string } | null = null;
  let sheetRequestId = 0;
  const allowed = () => { if (!deps.isAllowed()) fail('이 수업에서는 이메일 자동화를 사용할 수 없어요.'); };
  const request = (url: string, init: RequestInit) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(30000), redirect: 'error' });
  async function stored(): Promise<GoogleToken | null> {
    const text = await deps.secrets.get(TOKEN_KEY);
    if (!text) return null;
    try { const value = JSON.parse(text); return typeof value.accessToken === 'string' && typeof value.expiresAt === 'number' ? value : null; } catch { return null; }
  }
  async function connectionRevision(): Promise<string | null> {
    allowed();
    if (connecting) return null;
    const value = await stored();
    return value?.accountId ? revisionFor(value) : null;
  }
  const revisionFor = (value: GoogleToken) => `${generation}:${value.accountId}:${value.connectionId ?? 'legacy'}`;
  async function exchange(params: Record<string,string>, old?: GoogleToken): Promise<GoogleToken> {
    const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: deps.clientId, ...(deps.clientSecret ? { client_secret: deps.clientSecret } : {}), ...params }) });
    if (!response.ok) return fail('Google 연결을 갱신하지 못했어요. 다시 연결해 주세요.');
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number' || body.expires_in <= 0) return fail('Google 로그인 응답을 확인하지 못했어요.');
    if (typeof body.scope === 'string' && !SCOPES.every(scope => (body.scope as string).split(' ').includes(scope))) return fail('시트 읽기와 메일 보내기 권한이 필요해요.');
    return { accountId: old?.accountId, connectionId: old?.connectionId, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : old?.refreshToken, expiresAt: now() + body.expires_in * 1000 };
  }
  async function token(): Promise<GoogleToken> {
    allowed();
    const state = generation;
    let value = await stored();
    if (!value) return fail('Google 계정을 먼저 연결해 주세요.');
    if (value.expiresAt <= now() + 60000) {
      if (!value.refreshToken) return fail('Google 계정을 다시 연결해 주세요.');
      const expectedRevision = revisionFor(value);
      value = await exchange({ grant_type: 'refresh_token', refresh_token: value.refreshToken }, value);
      if (state !== generation || expectedRevision !== await connectionRevision()) return fail('Google 연결이 변경됐어요.');
      await deps.secrets.store(TOKEN_KEY, JSON.stringify(value));
    }
    return value;
  }
  async function preview(args: { recipe: EmailRecipe; rows: string[][] }): Promise<EmailPreview> {
    allowed();
    const revision = await connectionRevision();
    if (!revision) return fail('Google 계정을 먼저 연결해 주세요.');
    const rowRevision = rowRevisions.get(args.rows);
    if (rowRevision && rowRevision !== revision) return fail('Google 연결이 변경됐어요. 시트를 다시 읽어 주세요.');
    const recipe = validateEmailRecipe(args.recipe);
    if (!Array.isArray(args.rows) || args.rows.length < 2 || args.rows.length > maxRecipients + 1 || args.rows.some(row => !Array.isArray(row) || row.length > 100 || row.some(cell => typeof cell !== 'string' || cell.length > 10000 || /\x00/.test(cell)))) return fail(`시트는 머리글과 최대 ${maxRecipients}명의 수신자로 구성해 주세요.`);
    const headers = args.rows[0]!;
    const keys = ['email','name','document','dueDate'] as const;
    const indexes = Object.fromEntries(keys.map(key => { const name = recipe.columns[key]; if (headers.filter(h => h === name).length !== 1) fail(`시트의 ${name} 열을 하나만 준비해 주세요.`); return [key, headers.indexOf(name)]; })) as Record<typeof keys[number],number>;
    const recipients = new Set<string>();
    const messages = args.rows.slice(1).filter(row => row.some(cell => cell.trim())).map(row => {
      const fields = Object.fromEntries(keys.map(key => [key, row[indexes[key]]?.trim() ?? ''])) as Record<typeof keys[number], string>;
      if (keys.some(key => !fields[key])) fail('빈 수신자·이름·요청 자료·기한이 있어요.');
      if (recipients.has(fields.email.toLowerCase())) fail('중복 수신자가 있어요. 시트를 확인해 주세요.');
      recipients.add(fields.email.toLowerCase());
      const render = (template: string) => template.replace(/\{\{(name|document|dueDate)\}\}/g, (_, key: string) => fields[key as keyof typeof fields]);
      const subject = render(recipe.subjectTemplate);
      const body = render(recipe.bodyTemplate);
      if (subject.length > 998 || body.length > 100000) fail('메일 내용이 너무 길어요.');
      const message = { id: hash(JSON.stringify([fields.email.toLowerCase(),subject,body])), to: fields.email, subject, body };
      gmailMime(message);
      return Object.freeze(message);
    });
    if (!messages.length) return fail('보낼 수신자가 없어요.');
    const result = Object.freeze({ id: nonce(), createdAt: now(), messages: Object.freeze(messages) });
    // One current snapshot prevents accidental approval of a stale preview.
    previews.clear(); previewRevisions.clear(); previews.set(result.id, result); previewRevisions.set(result.id, revision);
    return result;
  }
  async function send(args: { previewId: string; approved: boolean }): Promise<{ records: SendRecord[] }> {
    allowed();
    if (args.approved !== true) return fail('미리보기를 확인하고 발송을 승인해 주세요.');
    if (sending) return fail('발송 중이에요. 완료될 때까지 기다려 주세요.');
    const snapshot = previews.get(args.previewId);
    if (!snapshot || now() - snapshot.createdAt > 30 * 60 * 1000) return fail('미리보기를 다시 만들고 확인해 주세요.');
    sending = true;
    try {
      const state = generation;
      if (snapshot.messages.length > maxRecipients) fail('수업 발송 한도를 넘었어요.');
      const expectedRevision = previewRevisions.get(snapshot.id);
      if (!expectedRevision || expectedRevision !== await connectionRevision()) return fail('보내는 계정이 변경됐어요. 미리보기를 다시 확인해 주세요.');
      const account = await token();
      if (revisionFor(account) !== expectedRevision) return fail('보내는 계정이 변경됐어요. 미리보기를 다시 확인해 주세요.');
      const accessToken = account.accessToken;
      const accountId = account.accountId ?? fail('보내는 계정을 확인하려면 Google을 다시 연결해 주세요.');
      const ledger = await deps.ledger.load();
      const results: SendRecord[] = [];
      for (const message of snapshot.messages) {
        allowed();
        if (state !== generation || expectedRevision !== await connectionRevision()) fail('Google 연결이 변경돼 발송을 중단했어요.');
        const ledgerKey = hash(`${accountId}:${message.id}`);
        const prior = ledger[ledgerKey];
        // A persisted sending entry is an uncertain outcome after a restart.
        if (prior) { results.push({ ...prior, status: prior.status === 'sending' ? 'unknown' : prior.status }); continue; }
        ledger[ledgerKey] = { id: message.id, status: 'sending' };
        // Durability precedes side effects. If this fails, no message is sent.
        await deps.ledger.save(structuredClone(ledger));
        if (expectedRevision !== await connectionRevision()) fail('Google 연결이 변경돼 발송을 중단했어요.');
        let record: SendRecord;
        try {
          const response = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw: gmailMime(message) }) });
          if (response.ok) {
            const result = await response.json() as { id?: unknown };
            record = typeof result.id === 'string' ? { id: message.id, status: 'sent', providerId: result.id } : { id: message.id, status: 'unknown', error: '결과를 확인할 수 없어요. Gmail 보낸편지함을 확인해 주세요.' };
          } else {
            record = { id: message.id, status: response.status >= 500 ? 'unknown' : 'failed', error: response.status >= 500 ? '결과를 확인할 수 없어요. Gmail 보낸편지함을 확인해 주세요.' : 'Google에서 발송을 거절했어요. 연결과 한도를 확인해 주세요.' };
          }
        } catch { record = { id: message.id, status: 'unknown', error: '결과를 확인할 수 없어요. Gmail 보낸편지함을 확인해 주세요.' }; }
        ledger[ledgerKey] = record;
        await deps.ledger.save(structuredClone(ledger));
        results.push(record);
        // Stop the batch on failure instead of amplifying an outage.
        if (record.status !== 'sent') break;
      }
      return { records: results };
    } finally { sending = false; }
  }
  return {
    preview, send,
    getConnectionRevision: connectionRevision,
    async previewLatestSheet(args: { recipe: EmailRecipe }): Promise<EmailPreview> {
      allowed();
      const sheet = cachedSheet;
      if (!sheet || sheet.revision !== await connectionRevision()) { cachedSheet = null; return fail('현재 Google 계정의 시트를 다시 읽어 주세요.'); }
      return preview({ recipe: args.recipe, rows: sheet.rows });
    },
    getPreview(id: string): EmailPreview | undefined { return previews.get(id); },
    async status() { return { connected: !!(await stored()), configured: !!deps.clientId.trim() }; },
    async connect() {
      allowed();
      if (!deps.clientId.trim()) fail('운영자가 Google 로그인 설정을 먼저 완료해야 해요.');
      if (connecting || sending) fail('진행 중인 연결 또는 발송이 끝난 뒤 다시 시도해 주세요.');
      connecting = true;
      const state = generation;
      let listener: OAuthListener | undefined;
      try {
        listener = await (deps.listenOAuth ?? listenGoogleOAuth)();
        const verifier = nonce(), csrf = nonce();
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: deps.clientId, redirect_uri: listener.redirectUri, response_type: 'code', scope: [...SCOPES, 'openid', 'email'].join(' '), state: csrf, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString();
        await deps.openBrowser(url.toString());
        const callback = await listener.wait;
        if (callback.origin + callback.pathname !== listener.redirectUri || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== csrf || callback.searchParams.has('error') || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) fail('Google 로그인 확인에 실패했어요. 다시 연결해 주세요.');
        const value = await exchange({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: verifier, redirect_uri: listener.redirectUri });
        const identityResponse = await request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${value.accessToken}` } });
        if (!identityResponse.ok) fail('Google 보내는 계정을 확인하지 못했어요. 다시 연결해 주세요.');
        const identity = await identityResponse.json() as { sub?: unknown };
        if (typeof identity.sub !== 'string' || !identity.sub) fail('Google 보내는 계정을 확인하지 못했어요.');
        value.accountId = hash(identity.sub as string);
        value.connectionId = nonce();
        if (state !== generation) fail('Google 연결이 변경됐어요.');
        await deps.secrets.store(TOKEN_KEY, JSON.stringify(value));
        generation++; cachedSheet = null; previews.clear(); previewRevisions.clear();
      } finally { listener?.close(); connecting = false; }
    },
    async disconnect() {
      generation++; cachedSheet = null; previews.clear(); previewRevisions.clear();
      const value = await stored();
      await deps.secrets.delete(TOKEN_KEY);
      if (value) { try { await request('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: value.refreshToken ?? value.accessToken }) }); } catch { /* Local credentials are removed even if revocation is unavailable. */ } }
    },
    async readSheet(args: { spreadsheetId: string; range: string }): Promise<string[][]> {
      allowed();
      cachedSheet = null;
      const requestId = ++sheetRequestId;
      const revision = await connectionRevision();
      if (!revision) return fail('Google 계정을 먼저 연결해 주세요.');
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(args.spreadsheetId) || typeof args.range !== 'string' || !args.range.trim() || args.range.length > 200 || /[\x00-\x1f]/.test(args.range)) return fail('스프레드시트 ID와 범위를 확인해 주세요.');
      const account = await token();
      if (revisionFor(account) !== revision) return fail('Google 연결이 변경됐어요. 시트를 다시 읽어 주세요.');
      const accessToken = account.accessToken;
      const response = await request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/${encodeURIComponent(args.range)}?valueRenderOption=FORMATTED_VALUE`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return fail('시트를 읽지 못했어요. 접근 권한과 범위를 확인해 주세요.');
      const result = await response.json() as { values?: unknown };
      if (!Array.isArray(result.values) || result.values.length > maxRecipients + 1 || result.values.some(row => !Array.isArray(row) || row.length > 100 || row.some(cell => typeof cell !== 'string' || cell.length > 10000))) return fail(`시트 형식 또는 크기를 확인해 주세요. 최대 ${maxRecipients}명의 수신자를 지원해요.`);
      if (!deps.isAllowed() || requestId !== sheetRequestId || revision !== await connectionRevision()) return fail('Google 연결 또는 선택한 시트가 변경됐어요. 시트를 다시 읽어 주세요.');
      cachedSheet = { rows: structuredClone(result.values as string[][]), revision };
      rowRevisions.set(cachedSheet.rows, revision);
      rowRevisions.set(result.values as string[][], revision);
      return result.values as string[][];
    },
  };
}
export type GoogleAutomationRuntime = ReturnType<typeof createGoogleAutomationRuntime>;
