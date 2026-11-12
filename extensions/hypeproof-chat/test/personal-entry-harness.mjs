// Real entry, account client, activity transaction, workspace router and disk task store.
// VS Code presentation/configuration seams and HTTP are fixtures; no token/activity/task is seeded.
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
let bundle;
const state = (beforeUpdate = () => {}) => { const map = new Map(); return { map, keys: () => [...map.keys()], get: (key, fallback) => map.has(key) ? map.get(key) : fallback, update: async (key, value) => { beforeUpdate(key, value); if (value === undefined) map.delete(key); else map.set(key, value); } }; };
export const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
export async function personalEntryFixture({ reload = false, passes, publish = () => {}, realPanel = false } = {}) {
  bundle ??= await build({ stdin: { contents: "export {StartPage} from './src/startPage';export {AccountSession} from './src/accountSession';export {ActivityConnections} from './src/activityConnections';export {ChatPanelProvider} from './src/chatPanelProvider';export {TaskWorkspaceStore} from './src/taskWorkspaceStore';export {ensureWorkspace} from './src/extension';export {consumeActivityResume,resumeKey} from './src/studioNavigation';export {fetchProfileResult} from './src/proxyClient';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-personal-entry-'))), work = path.join(root, 'my-work'); fs.mkdirSync(work);
  const service = 'http://127.0.0.1:31999/v1', site = 'http://127.0.0.1:31999';
  const requests = [], posts = [], commands = [], vault = new Map(), globalState = state((key, value) => {
    if (control.failMarker && value && key.startsWith('hypeproofChat.pendingActivityResume.')) throw Error('Synthetic resume storage failure');
  });
  const control = { consent: '내 이야기 시작하기', accountId: 'account-a', sessionId: 'session-a', activationDenied: false, beforeActivate: undefined, beforeReflection: undefined, beforeOpen: undefined, beforeStore: undefined, failMarker: false };
  const grant = { id: 'super', product_name: 'Synthetic existing allowance', status: 'active', requests_remaining: 100, requests_limit: 100, requests_used: 0, amount: 0, duration_seconds: 0 };
  const grants = passes ?? [grant];
  const profile = { activity_id: 'a'.repeat(64), activity_kind: 'personal', profile_id: 'personal', display_name: '내 작업', ux: { coach: { naming_mode: 'fixed', fallback_name: 'Coach' } }, welcome: {}, workspace_root: work, workspace_start: 'empty', pass: { status: 'active', requests_remaining: 100 } };
  const snapshot = { state: { id: 'personal-reflection', revision: 2, messages: [{ id: 'phone-user', role: 'user', content: '요즘 사람을 가르쳐요.', created_at: 1 }, { id: 'phone-answer', role: 'assistant', content: '어떤 순간이 마음에 남았나요?', created_at: 2 }], has_earlier: false, turn: null }, opening: '요즘 어떤 일에 시간을 쓰세요?', hint: '정리되지 않아도 괜찮아요.' };
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = async (url, options = {}) => {
    const route = new URL(url).pathname; requests.push({ route, method: options.method ?? 'GET' });
    if (route.endsWith('/auth/device/start')) return response({ device_code: 'synthetic-device-secret', user_code: 'ABCD1234', verification_uri_complete: site + '/studio/connect?code=ABCD1234', expires_in: 600, interval: 600 });
    if (route.endsWith('/auth/device/poll')) return response({ access_token: 'synthetic-account-token', refresh_token: 'synthetic-refresh', session_id: control.sessionId, expires_in: 7200 });
    if (route.endsWith('/auth/logout')) return response({ ok: true });
    if (route.endsWith('/me')) return response({ account: { id: control.accountId, email: 'synthetic@invalid.example', display_name: 'Synthetic person' } });
    if (route.endsWith('/me/passes')) return response({ passes: grants });
    if (route.endsWith('/activate')) { await control.beforeActivate?.(); return control.activationDenied ? response({ error: 'access_denied' }, 403) : response({ access_token: 'synthetic-personal-pass', expires_in: 7200 }); }
    if (route.endsWith('/profile')) return response(profile);
    if (route.endsWith('/activity')) return response({ activity_id: profile.activity_id });
    if (route.endsWith('/me/reflection')) { await control.beforeReflection?.(); return response(snapshot); }
    if (route.includes('/reflection/') || route.includes('/chat/') || route.includes('/turns')) throw Error('Entry must never dispatch a paid AI/tool turn');
    return response({ error: 'not_available' }, 404);
  };
  const vscode = { ViewColumn: { One: 1 }, Uri: { file: fsPath => ({ fsPath }), joinPath: (...parts) => ({ fsPath: parts.map(p => p.fsPath ?? p).join('/') }) }, env: { clipboard: { writeText: async () => {} } },
    workspace: { workspaceFolders: reload ? [] : [{ uri: { fsPath: work }, name: 'my-work' }], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? service : key === 'siteBase' ? site : fallback }) },
    window: { showInformationMessage: async () => { await control.beforeConsent?.(); return control.consent; }, showWarningMessage: async () => undefined },
    commands: { executeCommand: async (name, ...args) => { commands.push({ name, args }); if (name === 'vscode.openFolder') await control.beforeOpen?.(); if (name === 'hypeproof-chat.personalReflection') await current.page.openPersonalReflectionEntry(); } } };
  const mod = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), console, Buffer, process, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: webcrypto, fetch });
  const { StartPage, AccountSession, ActivityConnections, ChatPanelProvider, ensureWorkspace, consumeActivityResume, resumeKey, fetchProfileResult } = mod.exports;
  const initialize = mod.exports.TaskWorkspaceStore.prototype.initialize;
  mod.exports.TaskWorkspaceStore.prototype.initialize = async function(...args) { await control.beforeStore?.(); return initialize.apply(this, args); };
  const sessions = [];
  const make = async () => {
    const raw = { globalStorageUri: { fsPath: path.join(root, 'data') }, globalState, workspaceState: state(), extensionUri: { fsPath: root }, extension: { packageJSON: { version: 'fixture' } }, subscriptions: [], secrets: { keys: async () => [...vault.keys()], get: async key => vault.get(key), store: async (key, value) => { vault.set(key, value); }, delete: async key => { vault.delete(key); }, onDidChange: () => ({ dispose() {} }) } };
    const connections = new ActivityConnections(raw, () => service, () => vscode.workspace.workspaceFolders[0]?.uri.fsPath, async () => profile);
    await connections.initialize(); const context = connections.wrap();
    const h = Object.create(ChatPanelProvider.prototype);
    Object.assign(h, { context, _instructorMode: { isInstructor: false }, taskChanging: false, connectionChanging: false, draftWrites: Promise.resolve(), activeStreams: new Map(), reflectionStreams: new Map(), reflectionRefreshing: false, delegationControls: new Map(), pendingSends: 0, elementQueue: { queued: null }, queuedSources: new Set(), aiDisclosure: { noticeForReady: () => null }, postInbox: async () => {}, postLearningState: async () => {}, writeApprovalRequest: { cancel() {}, invalidate() {}, respond() {} } });
    h.ensureProfile = async () => { const token = await connections.token(); return token ? (await fetchProfileResult({ proxyUrl: service, token })).profile ?? null : null; };
    h.onAvailableUpdateChanged = () => ({ dispose() {} }); h.profileFailure = () => null; h.invalidateProfile = () => {}; h.coachDisplayName = () => 'Coach'; h.coachNameIsChosen = () => true;
    h.setConnectionChanging = async value => { h.connectionChanging = value; };
    h.postConfig = async () => { await h.prepareTaskWorkspace(false); };
    h.refreshConfig = async () => { await h.postConfig(); };
    h.focusDiagnostic = () => {};
    h.openInEditor = async entry => { h.editorChat = entry; await control.beforeHandoff?.(); await h.postConfig(); };
    let page;
    const accounts = new AccountSession({ service, site, secrets: raw.secrets, label: 'Synthetic desktop', fetch, openBrowser: async () => true, changed: () => page?.accountChanged(), signedIn: async () => page.finishAccountSignIn() }); sessions.push(accounts);
    connections.accountToken = binding => accounts.resolvePass(binding); h.setReflectionAccount(accounts);
    const listeners = new Set();
    const source = {
      postMessage: async message => { const copy = JSON.parse(JSON.stringify(message)); posts.push(copy); publish(copy); return true; },
      onDidReceiveMessage: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
      emit: message => { for (const listener of listeners) listener(message); },
    };
    const panel = { webview: source, reveal() {}, dispose() {}, onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }) };
    vscode.window.createWebviewPanel = () => panel;
    h.renderHtml = () => '<html></html>';
    page = new StartPage(context, h, (p, commit, selected, reflection, validate) => ensureWorkspace(p, context, false, commit, selected, reflection, validate), undefined, accounts);
    // Presentation mounting is the VS Code seam; all action dispatch/admission/store methods remain real.
    if (!realPanel) page.show = async () => { page.panel ??= panel; await page.refresh(); };
    page.offerWaited = true; page.trialOffer = null; page.products = null;
    await page.show(); if (realPanel) await page.refresh();
    return { context, h, page, accounts, connections, panel, source };
  };
  let current = await make(), chatSurface = false;
  return { root, work, requests, posts, commands, control, grants, profile, globalState, vault, vscode, snapshot, get current() { return current; },
    async send(message) { if (chatSurface) await current.h.handleMessage(message, current.source); else await current.page.handle(message); },
    useChatSurface() { chatSurface = true; },
    async login() { await current.accounts.poll(); },
    async reload() {
      vscode.workspace.workspaceFolders = [{ uri: { fsPath: work }, name: 'my-work' }];
      current = await make(); let intent;
      const verdict = await consumeActivityResume(current.context, current.connections.current, service, work, value => { intent = value; });
      if (verdict === 'valid') { await current.page.openChat(); if (intent) await current.page.resumePersonalReflection(intent); }
      return { verdict, intent };
    },
    marker() { return globalState.get(resumeKey(work)); },
    close() { for (const account of sessions) account.cancel(false); fs.rmSync(root, { recursive: true, force: true }); },
  };
}
