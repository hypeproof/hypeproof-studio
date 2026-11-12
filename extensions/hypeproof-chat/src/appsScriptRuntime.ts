import { createHash, randomBytes } from 'node:crypto';
import { gmailMime, listenGoogleOAuth, type EmailPreview, type OAuthListener, type SendRecord, type EmailRecipe } from './googleAutomation.ts';
import { APPS_SCRIPT_EXECUTION_SCOPES, appsScriptContentDigest, assertGeneratedAppsScriptProject, type AppsScriptEmailProject, type AppsScriptFile } from './appsScriptEmailProject.ts';
import { canonicalSharedRecipe, sharedRecipeDigest, validateSharedRunnerConfig, type SharedRunnerConfig } from './sharedRunnerConfig.ts';
export { generateAppsScriptEmailProject } from './appsScriptEmailProject.ts';

export const APPS_SCRIPT_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  ...APPS_SCRIPT_EXECUTION_SCOPES,
] as const;
export const APPS_SCRIPT_TOKEN_KEY = 'hps.google.apps-script.v1';
export const APPS_SCRIPT_REVOCATION_KEY = 'hps.google.apps-script.revocation.v1';
export class AppsScriptBlockedError extends Error {
  readonly code = 'APPS_SCRIPT_SETUP_REQUIRED';
  constructor() { super('Google Apps Script API와 계정의 API 접근을 켜고, 스크립트 설정에서 Studio OAuth와 같은 표준 Google Cloud 프로젝트를 연결해 주세요. 회사 관리자의 제한도 확인해 주세요.'); }
}
/** Only fixed, host-owned messages cross the model boundary; never Google response bodies. */
export class AppsScriptRecoveryError extends Error {
  readonly recovery: 'reconnect' | 'retry' | 'operator';
  readonly reason?: 'oauth_callback_incomplete';
  constructor(recovery: 'reconnect' | 'retry' | 'operator', message: string,
    reason?: 'oauth_callback_incomplete') { super(message); this.recovery = recovery; this.reason = reason; }
}
export interface AppsScriptDeps {
  clientId: string; clientSecret?: string;
  sharedRunner?: SharedRunnerConfig;
  secrets: { get(key: string): PromiseLike<string | undefined>; store(key: string, value: string): PromiseLike<void>; delete(key: string): PromiseLike<void> };
  openBrowser(url: string): PromiseLike<unknown>;
  isAllowed(): boolean;
  fetchImpl?: typeof fetch; listenOAuth?: () => Promise<OAuthListener>; now?: () => number;
}
interface Token { accessToken: string; refreshToken?: string; expiresAt: number; accountId: string; connectionId: string }
export interface AppsScriptDeployment { scriptId: string; deploymentId: string; versionNumber: number; digest: string; connectionIdentity: string; recipe?: EmailRecipe; recipeDigest?: string; sharedReleaseId?: string; maxRecipients?: number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(message); };
const checkedId = (value: string) => /^[A-Za-z0-9_-]{10,200}$/.test(value) ? value : fail('Google 프로젝트 또는 배포 ID를 확인해 주세요.');
const identity = (value: Token) => `${value.accountId}:${value.connectionId}`;
const retryError = () => new AppsScriptRecoveryError('retry', 'Google 사용량 제한 또는 일시적인 오류예요. 잠시 후 다시 시도해 주세요. 자동 재시도는 하지 않았어요.');
function oauthError(code: unknown): AppsScriptRecoveryError {
  if (code === 'admin_policy_enforced' || code === 'org_internal') return new AppsScriptRecoveryError('operator', '회사 Google 관리자가 이 앱의 연결을 허용해야 해요. 관리자에게 사용 가능 여부를 확인해 주세요. 반복 로그인으로는 해결되지 않아요.');
  if (code === 'invalid_client' || code === 'unauthorized_client') return new AppsScriptRecoveryError('operator', 'Studio의 Google 로그인 설정을 운영자가 확인해야 해요. 설정이 수정되기 전에는 계정을 다시 연결할 필요가 없어요.');
  if (code === 'temporarily_unavailable' || code === 'server_error') return retryError();
  if (code === 'invalid_grant') return new AppsScriptRecoveryError('reconnect', 'Google 연결을 다시 허용해 주세요. 권한 철회나 시험 앱의 연결 유효기간 등으로 기존 연결을 사용할 수 없어요.');
  if (code === 'access_denied') return new AppsScriptRecoveryError('reconnect', 'Google 연결이 허용되지 않았어요. 계정과 요청 권한을 확인한 뒤 다시 연결해 주세요.');
  return new AppsScriptRecoveryError('reconnect', 'Google 연결을 갱신하지 못했어요. Google 권한을 다시 연결해 주세요.');
}
/** Inspect only documented machine-code fields, never message text, metadata or headers. */
function forbiddenError(body: unknown): AppsScriptRecoveryError | AppsScriptBlockedError {
  const error = plain(body) && plain(body.error) ? body.error : {};
  const reasons: unknown[] = [];
  if (Array.isArray(error.errors)) for (const entry of error.errors) if (plain(entry)) reasons.push(entry.reason);
  if (Array.isArray(error.details)) for (const entry of error.details) {
    if (plain(entry) && entry['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && entry.domain === 'googleapis.com') reasons.push(entry.reason);
  }
  if (reasons.some(r => r === 'accessNotConfigured' || r === 'SERVICE_DISABLED')) return new AppsScriptRecoveryError('operator', 'Google API 사용 설정을 운영자가 확인해야 해요. 계정을 다시 연결해도 이 설정 문제는 해결되지 않아요.');
  if (reasons.some(r => r === 'insufficientPermissions' || r === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return new AppsScriptRecoveryError('reconnect', 'Google 작업에 필요한 권한이 부족해요. 계정을 다시 연결하고 요청한 권한을 허용해 주세요.');
  if (reasons.some(r => typeof r === 'string' && ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED'].includes(r))) return retryError();
  return new AppsScriptBlockedError();
}

/** Host must namespace SecretStorage by the current grant and serialize operations across windows. */
export function createAppsScriptRuntime(deps: AppsScriptDeps) {
  const request = deps.fetchImpl ?? fetch, now = deps.now ?? Date.now;
  const shared = deps.sharedRunner ? validateSharedRunnerConfig(deps.sharedRunner) : undefined;
  const oauthScopes: readonly string[] = shared ? APPS_SCRIPT_EXECUTION_SCOPES : APPS_SCRIPT_OAUTH_SCOPES;
  const ownerOnly = () => { if (shared) throw new AppsScriptRecoveryError('operator', '공통 실행기는 Studio가 관리해요. 개인 프로젝트 생성이나 코드 배포는 이 경로에서 지원하지 않아요.'); };
  let epoch = 0, busy = false;
  let pendingConnect: { cancelled: boolean; listener?: OAuthListener } | undefined;
  let disconnecting: Promise<void> | undefined;
  let locallyDisconnected = false;
  let current: { deployment: AppsScriptDeployment; preview: EmailPreview } | undefined;
  const allowed = () => { if (!deps.isAllowed()) fail('현재 활동에서는 이 작업을 할 수 없어요.'); };
  const rawRequest = async (url: string, init: RequestInit) => request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(url.includes(':run') ? 370000 : 30000) });
  async function stored(): Promise<Token | null> {
    if (locallyDisconnected || await deps.secrets.get(APPS_SCRIPT_REVOCATION_KEY)) return null;
    const raw = await deps.secrets.get(APPS_SCRIPT_TOKEN_KEY);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw);
      return plain(t) && typeof t.accessToken === 'string' && typeof t.expiresAt === 'number' && typeof t.accountId === 'string' && typeof t.connectionId === 'string' ? t as unknown as Token : null;
    } catch { return null; }
  }
  async function getConnectionIdentity(): Promise<string | null> { allowed(); const t = await stored(); return t ? identity(t) : null; }
  async function exchange(params: Record<string, string>, old?: Token): Promise<Token> {
    allowed();
    let r: Response;
    try { r = await rawRequest('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: deps.clientId, ...(deps.clientSecret ? { client_secret: deps.clientSecret } : {}) }) }); }
    catch { throw new AppsScriptRecoveryError('retry', 'Google에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'); }
    if (r.status === 429 || r.status >= 500) throw retryError();
    if (!r.ok) { const body: unknown = await r.json().catch(() => null); throw oauthError(plain(body) ? body.error : undefined); }
    const t: unknown = await r.json().catch(() => null);
    if (!plain(t) || typeof t.access_token !== 'string' || typeof t.expires_in !== 'number' || t.expires_in <= 0 || (typeof t.scope === 'string' && !oauthScopes.every(s => (t.scope as string).split(' ').includes(s)))) throw new AppsScriptRecoveryError('reconnect', 'Apps Script에 필요한 권한을 모두 허용해 주세요.');
    return { accessToken: t.access_token, expiresAt: now() + t.expires_in * 1000, refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : old?.refreshToken, accountId: old?.accountId ?? '', connectionId: old?.connectionId ?? '' };
  }
  async function token(): Promise<Token> {
    allowed(); const state = epoch; let t = await stored();
    if (!t) throw new AppsScriptRecoveryError('reconnect', 'Apps Script용 Google 연결을 먼저 허용해 주세요.');
    if (t.expiresAt <= now() + 420000) {
      if (!t.refreshToken) throw new AppsScriptRecoveryError('reconnect', 'Google 계정을 다시 연결해 주세요.');
      const before = identity(t); t = await exchange({ grant_type: 'refresh_token', refresh_token: t.refreshToken }, t);
      allowed(); if (state !== epoch || before !== await getConnectionIdentity()) return fail('Google 연결이 변경됐어요.');
      await deps.secrets.store(APPS_SCRIPT_TOKEN_KEY, JSON.stringify(t));
    }
    return t;
  }
  async function api(path: string, method: string, body?: unknown, expectedIdentity?: string): Promise<Record<string, unknown>> {
    const state = epoch, t = await token(), expected = expectedIdentity ?? identity(t);
    if (identity(t) !== expected) return fail('Google 연결이 변경됐어요.');
    allowed();
    if (state !== epoch || expected !== await getConnectionIdentity()) return fail('Google 연결이 변경됐어요.');
    let r: Response;
    try { r = await rawRequest(`https://script.googleapis.com/v1/${path}`, { method, headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new AppsScriptRecoveryError('retry', 'Google 작업 결과를 확인하지 못했어요. 자동으로 재시도하지 않았어요. 인터넷 연결과 Google 실행 기록을 확인해 주세요.'); }
    allowed(); if (state !== epoch || expected !== await getConnectionIdentity()) return fail('Google 연결이 변경됐어요. 작업 결과를 Google에서 확인해 주세요.');
    if (r.status === 403) {
      const error = forbiddenError(await r.json().catch(() => null));
      if (shared && error instanceof AppsScriptBlockedError) throw new AppsScriptRecoveryError('operator', '공통 Google 실행기 접근을 운영자가 확인해야 해요. 개인 프로젝트나 회사 관리 권한을 추가하지 마세요.');
      throw error;
    }
    if (r.status === 401) throw new AppsScriptRecoveryError('reconnect', 'Google에서 연결 권한을 확인하지 못했어요. 다시 연결해 주세요.');
    if (r.status === 429 || r.status >= 500) throw retryError();
    if (!r.ok) return fail('Google에서 작업을 완료하지 못했어요. 프로젝트와 할당량을 확인해 주세요.');
    const result: unknown = await r.json().catch(() => null);
    if (!plain(result)) return fail('Google 작업 결과를 확인하지 못했어요.');
    return result;
  }
  async function content(scriptId: string, version?: number, expected?: string): Promise<string> {
    const result = await api(`projects/${checkedId(scriptId)}/content${version ? `?versionNumber=${version}` : ''}`, 'GET', undefined, expected);
    if (!Array.isArray(result.files) || result.files.some(f => !plain(f) || typeof f.name !== 'string' || typeof f.source !== 'string' || !['JSON','SERVER_JS'].includes(String(f.type)))) return fail('Google에 저장된 코드를 확인하지 못했어요.');
    return appsScriptContentDigest(result.files as AppsScriptFile[]);
  }
  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    allowed(); if (busy) return fail('진행 중인 Google 작업이 끝난 뒤 다시 시도해 주세요.');
    busy = true; try { return await action(); } finally { busy = false; }
  }
  async function run(deployment: AppsScriptDeployment, fn: 'hpsPreview' | 'hpsSendApproved' | 'hpsGetSendStatus', input: unknown) {
    checkedId(deployment.deploymentId); checkedId(deployment.scriptId);
    if (!Number.isSafeInteger(deployment.versionNumber) || deployment.versionNumber < 1) return fail('배포 버전을 확인해 주세요.');
    if (!/^[a-f0-9]{64}$/.test(deployment.digest) || deployment.connectionIdentity !== await getConnectionIdentity()) return fail('Google 연결 또는 스킬이 변경됐어요. 다시 배포해 주세요.');
    if (shared) {
      if (deployment.scriptId !== shared.scriptId || deployment.deploymentId !== shared.deploymentId || deployment.versionNumber !== shared.versionNumber ||
          deployment.sharedReleaseId !== shared.releaseId || !deployment.recipe || deployment.recipeDigest !== sharedRecipeDigest(deployment.recipe) || deployment.digest !== deployment.recipeDigest ||
          !Number.isSafeInteger(deployment.maxRecipients) || Number(deployment.maxRecipients) < 1 || Number(deployment.maxRecipients) > 20) return fail('공통 실행기 또는 스킬이 변경됐어요. 실행 준비부터 다시 진행해 주세요.');
      const accountId = deployment.connectionIdentity.split(':')[0]!;
      if (!/^[a-f0-9]{64}$/.test(accountId)) return fail('Google 계정을 다시 연결해 주세요.');
      const envelope = { protocol: shared.protocol, releaseId: shared.releaseId, accountId, recipe: canonicalSharedRecipe(deployment.recipe), recipeDigest: deployment.recipeDigest, payload: input };
      const functions = { hpsPreview: 'hpsSharedPreview', hpsSendApproved: 'hpsSharedSendApproved', hpsGetSendStatus: 'hpsSharedGetSendStatus' };
      const result = await api(`scripts/${shared.deploymentId}:run`, 'POST', { function: functions[fn], parameters: [envelope], devMode: false }, deployment.connectionIdentity);
      if (result.done !== true || result.error || !plain(result.response) || !plain(result.response.result)) throw new AppsScriptRecoveryError('operator', '공통 Google 실행 결과를 확인하지 못했어요. 운영자가 시험 계정 허용과 실행기 설정을 확인해야 해요.');
      const response = result.response.result;
      if (response.protocol !== shared.protocol || response.releaseId !== shared.releaseId || response.accountId !== accountId || response.recipeDigest !== deployment.recipeDigest || !plain(response.result)) return fail('Google 실행 결과의 계정 또는 스킬이 일치하지 않아요. 다시 확인해 주세요.');
      return response.result;
    }
    if (deployment.sharedReleaseId || deployment.recipeDigest || deployment.recipe) return fail('공통 실행기 설정이 필요해요. 운영자에게 확인해 주세요.');
    // Verify immutable version content, never execute editable HEAD or arbitrary functions.
    if (await content(deployment.scriptId, deployment.versionNumber, deployment.connectionIdentity) !== deployment.digest) return fail('배포된 코드가 승인한 코드와 달라요. 다시 확인해 주세요.');
    const d = await api(`projects/${deployment.scriptId}/deployments/${deployment.deploymentId}`, 'GET', undefined, deployment.connectionIdentity);
    if (!plain(d.deploymentConfig) || d.deploymentConfig.versionNumber !== deployment.versionNumber) return fail('배포 버전이 변경됐어요. 다시 확인해 주세요.');
    const result = await api(`scripts/${deployment.deploymentId}:run`, 'POST', { function: fn, parameters: [input], devMode: false }, deployment.connectionIdentity);
    if (result.done !== true || result.error || !plain(result.response) || !plain(result.response.result)) return fail('Apps Script 실행 결과를 확인하지 못했어요. Google의 실행 기록과 권한을 확인해 주세요.');
    return result.response.result;
  }
  return {
    sharedRunnerEnabled: !!shared,
    async sharedDeployment(recipe: EmailRecipe, maxRecipients = 20): Promise<AppsScriptDeployment> {
      allowed();
      if (!shared) throw new AppsScriptRecoveryError('operator', 'Studio 공통 Google 실행기를 운영자가 먼저 설정해야 해요.');
      if (!Number.isSafeInteger(maxRecipients) || maxRecipients < 1 || maxRecipients > 20) return fail('수신자 한도를 확인해 주세요.');
      const connectionIdentity = await getConnectionIdentity();
      if (!connectionIdentity) throw new AppsScriptRecoveryError('reconnect', 'Google 계정을 먼저 연결해 주세요.');
      const canonical = canonicalSharedRecipe(recipe), recipeDigest = sharedRecipeDigest(canonical);
      Object.freeze(canonical.columns); Object.freeze(canonical);
      return Object.freeze({ scriptId: shared.scriptId, deploymentId: shared.deploymentId, versionNumber: shared.versionNumber, digest: recipeDigest, connectionIdentity,
        recipe: canonical, recipeDigest, sharedReleaseId: shared.releaseId, maxRecipients });
    },
    getConnectionIdentity,
    async status() { return { connected: !!await stored(), configured: !!deps.clientId.trim(), revocationPending: !!await deps.secrets.get(APPS_SCRIPT_REVOCATION_KEY) }; },
    async isConnected() { return !!await getConnectionIdentity(); },
    getPreview(id: string) { return current?.preview.id === id ? current.preview : undefined; },
    cancelConnect() {
      if (!pendingConnect) return false;
      pendingConnect.cancelled = true; pendingConnect.listener?.close(); return true;
    },
    async connect() { return exclusive(async () => {
      if (disconnecting || await deps.secrets.get(APPS_SCRIPT_REVOCATION_KEY)) throw new AppsScriptRecoveryError('retry', 'Google 권한 해제가 아직 확인되지 않았어요. 권한 해제 다시 시도를 먼저 눌러 주세요.');
      if (!deps.clientId.trim()) throw new AppsScriptRecoveryError('operator', '운영자가 Studio의 Google 로그인 설정을 먼저 완료해야 해요. 설정 후 이 단계에서 다시 연결할 수 있어요.');
      const state = epoch, attempt = { cancelled: false, listener: undefined as OAuthListener | undefined };
      pendingConnect = attempt;
      let listener: OAuthListener | undefined;
      try {
        listener = await (deps.listenOAuth ?? listenGoogleOAuth)(); attempt.listener = listener;
        if (attempt.cancelled) return fail('Google 연결을 취소했어요. 다시 연결할 수 있어요.');
        const verifier = nonce(), csrf = nonce(), url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: deps.clientId, redirect_uri: listener.redirectUri, response_type: 'code', scope: [...oauthScopes, 'openid'].join(' '), include_granted_scopes: 'true', state: csrf, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString();
        await deps.openBrowser(url.toString());
        let callback: URL;
        try { callback = await listener.wait; }
        catch { throw new AppsScriptRecoveryError('reconnect', 'Google 로그인 완료 응답을 받지 못했어요. 준비되면 새 로그인 요청으로 다시 연결해 주세요.', 'oauth_callback_incomplete'); }
        if (attempt.cancelled) return fail('Google 연결을 취소했어요. 다시 연결할 수 있어요.');
        if (pendingConnect === attempt) pendingConnect = undefined;
        if (callback.origin + callback.pathname === listener.redirectUri && callback.searchParams.getAll('state').length === 1 && callback.searchParams.get('state') === csrf && callback.searchParams.getAll('error').length === 1 && !callback.searchParams.has('code')) throw oauthError(callback.searchParams.get('error'));
        if (callback.origin + callback.pathname !== listener.redirectUri || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== csrf || callback.searchParams.has('error') || callback.searchParams.getAll('code').length !== 1 || !callback.searchParams.get('code')) return fail('Google 로그인 확인에 실패했어요.');
        const t = await exchange({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: verifier, redirect_uri: listener.redirectUri });
        const r = await rawRequest('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.accessToken}` } });
        const user: unknown = r.ok ? await r.json().catch(() => null) : null;
        if (!plain(user) || typeof user.sub !== 'string' || !user.sub) return fail('Google 계정을 확인하지 못했어요.');
        allowed(); if (state !== epoch) return fail('Google 연결이 변경됐어요.');
        t.accountId = hash(user.sub); t.connectionId = nonce();
        await deps.secrets.store(APPS_SCRIPT_TOKEN_KEY, JSON.stringify(t));
        if (state !== epoch) { await deps.secrets.delete(APPS_SCRIPT_TOKEN_KEY); return fail('Google 연결이 변경됐어요.'); }
        locallyDisconnected = false; epoch++; current = undefined;
      } finally { if (pendingConnect === attempt) pendingConnect = undefined; listener?.close(); }
    }); },
    async disconnect() {
      // Invalidate approval and any in-flight login before waiting for storage or Google.
      epoch++; current = undefined; locallyDisconnected = true;
      if (pendingConnect) { pendingConnect.cancelled = true; pendingConnect.listener?.close(); }
      if (disconnecting) return disconnecting;
      const revoke = async () => {
        try {
          let pending = await deps.secrets.get(APPS_SCRIPT_REVOCATION_KEY);
          if (!pending) {
            const raw = await deps.secrets.get(APPS_SCRIPT_TOKEN_KEY);
            const value: unknown = raw ? JSON.parse(raw) : null;
            if (plain(value)) pending = typeof value.refreshToken === 'string' && value.refreshToken
              ? value.refreshToken : typeof value.accessToken === 'string' ? value.accessToken : undefined;
            // The pending marker survives restart and makes the old connection unusable.
            if (pending) await deps.secrets.store(APPS_SCRIPT_REVOCATION_KEY, pending);
          }
          await deps.secrets.delete(APPS_SCRIPT_TOKEN_KEY);
          if (!pending) return;
          const response = await rawRequest('https://oauth2.googleapis.com/revoke', {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: pending }),
          });
          // Neither an error body nor an uncertain network result proves revocation.
          if (response.status !== 200) throw new Error('revocation_unconfirmed');
          await deps.secrets.delete(APPS_SCRIPT_REVOCATION_KEY);
        } catch {
          throw new AppsScriptRecoveryError('retry', 'Studio 연결은 중지했지만 Google 권한 해제는 확인하지 못했어요. 권한 해제 다시 시도를 눌러 주세요. 계속 실패하면 Google 계정의 앱 액세스에서 권한을 제거하고 운영자에게 알려 주세요.');
        }
      };
      disconnecting = revoke();
      try { await disconnecting; } finally { disconnecting = undefined; }
    },
    async createProject(title: string) { return exclusive(async () => {
      ownerOnly();
      if (typeof title !== 'string' || !title.trim() || title.length > 120 || /[\x00-\x1f]/.test(title)) return fail('프로젝트 이름을 확인해 주세요.');
      const result = await api('projects', 'POST', { title });
      if (typeof result.scriptId !== 'string') return fail('Google 프로젝트 결과를 확인하지 못했어요.');
      return { scriptId: checkedId(result.scriptId), editorUrl: `https://script.google.com/home/projects/${checkedId(result.scriptId)}/edit` };
    }); },
    async uploadProject(scriptId: string, project: AppsScriptEmailProject, approvedDigest: string) { return exclusive(async () => {
      ownerOnly();
      assertGeneratedAppsScriptProject(project);
      if (approvedDigest !== project.digest) return fail('작성된 코드를 확인하고 업로드를 승인해 주세요.');
      current = undefined;
      await api(`projects/${checkedId(scriptId)}/content`, 'PUT', { files: project.files });
      if (await content(scriptId) !== project.digest) return fail('Google에 저장한 코드가 일치하지 않아요.');
      return { digest: project.digest };
    }); },
    async deployProject(scriptId: string, project: AppsScriptEmailProject, approvedDigest: string): Promise<AppsScriptDeployment> { return exclusive(async () => {
      ownerOnly();
      assertGeneratedAppsScriptProject(project);
      if (approvedDigest !== project.digest) return fail('작성된 코드와 본인 전용 배포를 승인해 주세요.');
      const connectionIdentity = await getConnectionIdentity(); if (!connectionIdentity) return fail('Google을 먼저 연결해 주세요.');
      if (await content(scriptId, undefined, connectionIdentity) !== project.digest) return fail('업로드한 코드가 변경됐어요. 다시 확인해 주세요.');
      const version = await api(`projects/${checkedId(scriptId)}/versions`, 'POST', { description: 'Studio approved email workflow' }, connectionIdentity);
      if (!Number.isSafeInteger(version.versionNumber) || Number(version.versionNumber) < 1) return fail('코드 버전을 확인하지 못했어요.');
      const versionNumber = Number(version.versionNumber);
      if (await content(scriptId, versionNumber, connectionIdentity) !== project.digest) return fail('코드가 버전 생성 중 변경됐어요. 배포하지 않았어요.');
      const result = await api(`projects/${scriptId}/deployments`, 'POST', { versionNumber, manifestFileName: 'appsscript', description: 'Studio private email workflow' }, connectionIdentity);
      if (typeof result.deploymentId !== 'string') return fail('배포 결과를 확인하지 못했어요.');
      current = undefined;
      return { scriptId, deploymentId: checkedId(result.deploymentId), versionNumber, digest: project.digest, connectionIdentity };
    }); },
    async preview(deployment: AppsScriptDeployment, input: { spreadsheetId: string; range: string }): Promise<EmailPreview> { return exclusive(async () => {
      current = undefined;
      checkedId(input.spreadsheetId);
      if (typeof input.range !== 'string' || !input.range.trim() || input.range.length > 200 || /[\x00-\x1f]/.test(input.range)) return fail('시트 범위를 확인해 주세요.');
      const result = await run(deployment, 'hpsPreview', { spreadsheetId: input.spreadsheetId, range: input.range });
      if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(result.id) || typeof result.createdAt !== 'number' || Math.abs(now() - result.createdAt) > 300000 || !Array.isArray(result.messages) || !result.messages.length || result.messages.length > (shared ? deployment.maxRecipients! : 20)) return fail('미리보기 결과를 확인하지 못했어요.');
      const seen = new Set<string>();
      const messages = result.messages.map(m => {
        if (!plain(m) || typeof m.id !== 'string' || typeof m.to !== 'string' || typeof m.subject !== 'string' || typeof m.body !== 'string' || m.subject.length > 998 || m.body.length > 100000 || /\x00/.test(m.body) || m.id !== hash(JSON.stringify([m.to.toLowerCase(), m.subject, m.body])) || seen.has(m.to.toLowerCase())) return fail('미리보기 결과를 확인하지 못했어요.');
        seen.add(m.to.toLowerCase()); const message = { id: m.id, to: m.to, subject: m.subject, body: m.body }; gmailMime(message); return Object.freeze(message);
      });
      const preview = Object.freeze({ id: result.id, createdAt: result.createdAt, messages: Object.freeze(messages) });
      current = { deployment: structuredClone(deployment), preview }; return preview;
    }); },
    async getSendStatus(deployment: AppsScriptDeployment, ids: readonly string[]): Promise<{ records: { id: string; status: 'sent' | 'unknown' | 'not_attempted' }[] }> { return exclusive(async () => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) return fail('확인할 전송 기록이 올바르지 않아요.');
      const result = await run(deployment, 'hpsGetSendStatus', { ids });
      if (!Array.isArray(result.records) || result.records.length !== ids.length) return fail('Google 전송 기록을 확인하지 못했어요. 자동 재발송은 하지 않아요.');
      return { records: result.records.map((record, i) => {
        if (!plain(record) || record.id !== ids[i] || !['sent','unknown','not_attempted'].includes(String(record.status))) return fail('Google 전송 기록을 확인하지 못했어요. 자동 재발송은 하지 않아요.');
        return { id: ids[i]!, status: record.status as 'sent' | 'unknown' | 'not_attempted' };
      }) };
    }); },
    async sendApproved(deployment: AppsScriptDeployment, previewId: string, approved: boolean): Promise<{ records: SendRecord[] }> { return exclusive(async () => {
      const saved = current;
      if (approved !== true) return fail('수신자와 내용을 확인하고 발송을 승인해 주세요.');
      if (!saved || saved.preview.id !== previewId || JSON.stringify(saved.deployment) !== JSON.stringify(deployment) || now() - saved.preview.createdAt > 1800000) return fail('미리보기를 다시 확인해 주세요.');
      // Consume approval even if outcome is unknown. The script also persists per-message uncertainty.
      current = undefined;
      const unknown = () => ({ records: saved.preview.messages.map(m => ({ id: m.id, status: 'unknown' as const })) });
      let result: Record<string, unknown>;
      try { result = await run(deployment, 'hpsSendApproved', { previewId, approved: true, messages: saved.preview.messages }); }
      catch (error) { if (error instanceof AppsScriptBlockedError) throw error; return unknown(); }
      if (!Array.isArray(result.records) || result.records.length > saved.preview.messages.length) return unknown();
      const records: SendRecord[] = [];
      for (let i = 0; i < result.records.length; i++) {
        const r = result.records[i];
        if (!plain(r) || r.id !== saved.preview.messages[i]!.id || !['sent','unknown'].includes(String(r.status))) return unknown();
        records.push({ id: String(r.id), status: r.status as 'sent' | 'unknown' });
      }
      return records.length ? { records } : unknown();
    }); },
  };
}
export type AppsScriptRuntime = ReturnType<typeof createAppsScriptRuntime>;
