import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { activityConnections, ACTIVITY_TOKEN_KEY } from './activityConnections';
import { fetchProfileResult } from './proxyClient';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';
import type { ChatPanelProvider } from './chatPanelProvider';
import { createGoogleAutomationRuntime, validateEmailRecipe, type GoogleAutomationRuntime } from './googleAutomation';
import { createAutomationPanelController } from './automationPanel';
import { createAutomationStoreClient } from './automationStoreClient';
import { automationNamespace, createAutomationLedger } from './automationLedger';
import type { AutomationAction, AutomationView } from './automationProtocol';

interface Binding { token: string; service: string; activityId: string; namespace: string; clientId: string; maxRecipients: number; signature: string }
export function registerAutomationHost(context: vscode.ExtensionContext, provider: ChatPanelProvider) {
  let panel: vscode.WebviewPanel | undefined;
  let binding: Binding | undefined;
  let permittedUntil = 0;
  let runtime: GoogleAutomationRuntime | undefined;
  let controller: ReturnType<typeof createAutomationPanelController> | undefined;
  type Message = { type?: string; action?: AutomationAction };
  type Queued = { message: Message; source: vscode.WebviewPanel; owner: Binding };
  const messages: Queued[] = [];
  let draining = false, opening = false;
  const service = () => vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1').replace(/\/+$/, '');
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const matches = () => {
    const current = activityConnections(context)?.current;
    return !!binding && !!current && current.serverId === binding.activityId && current.token === binding.token && service() === binding.service && current.service.replace(/\/+$/, '') === binding.service && vscode.workspace.isTrusted;
  };
  const allowed = () => matches() && Date.now() < permittedUntil;
  const emit = (view: AutomationView) => { if (matches()) void panel?.webview.postMessage({ type: 'automationView', view }); };
  async function authorize(opening = false): Promise<Binding> {
    permittedUntil = 0;
    if (!vscode.workspace.isTrusted) throw new Error('작업 폴더를 신뢰한 뒤 자동화를 열어 주세요.');
    const token = await context.secrets.get(ACTIVITY_TOKEN_KEY);
    const current = activityConnections(context)?.current;
    const base = service();
    if (!token || !current || current.token !== token || current.service.replace(/\/+$/, '') !== base) throw new Error('수업 활동을 연결한 뒤 자동화를 열어 주세요.');
    if (!opening && !matches()) { panel?.dispose(); throw new Error('활동이 변경됐어요. 자동화를 다시 열어 주세요.'); }
    const result = await fetchProfileResult({ token, proxyUrl: base });
    if (!result.ok) throw new Error(result.failure.friendly);
    const p = result.profile, grant = p.automations;
    if (p.activity_id !== current.serverId || activityConnections(context)?.current?.token !== token || service() !== base) { panel?.dispose(); throw new Error('활동이 변경됐어요. 자동화를 다시 열어 주세요.'); }
    if (grant?.enabled !== true || grant.provider !== 'gmail') throw new Error('이 수업에서는 이메일 자동화를 사용할 수 없어요.');
    const clientId = grant.oauthClientId ?? vscode.workspace.getConfiguration('hypeproofChat').get<string>('automationGoogleClientId', '');
    const maxRecipients = Math.max(1, Math.min(20, Number.isSafeInteger(grant.maxRecipients) ? grant.maxRecipients! : 20));
    const next: Binding = { token, service: base, activityId: p.activity_id!, namespace: automationNamespace(base, p.activity_id!), clientId, maxRecipients, signature: digest(JSON.stringify([base, token, p.activity_id, clientId, maxRecipients])) };
    if (!opening && binding?.signature !== next.signature) { panel?.dispose(); throw new Error('자동화 설정이 변경됐어요. 다시 열어 주세요.'); }
    permittedUntil = Date.now() + 60000;
    return next;
  }
  async function confirmMcpSend(preview: import('./googleAutomation').EmailPreview): Promise<boolean> {
    const pinned = binding;
    await authorize();
    if (binding !== pinned) return false;
    const detail = preview.messages.map((message, index) => `${index + 1}. 받는 사람: ${message.to}\n제목: ${message.subject}\n\n${message.body}`).join('\n\n────────────────────\n\n');
    const answer = await vscode.window.showWarningMessage(`${preview.messages.length}명에게 보낼 내용을 모두 확인해 주세요.`, { modal: true, detail }, '확인한 메일 보내기');
    if (answer !== '확인한 메일 보내기') return false;
    await authorize();
    return pinned === binding && allowed();
  }
  async function prepare(): Promise<void> {
    const next = await authorize(true);
    if (binding?.signature === next.signature && runtime && controller) return;
    if (binding) panel?.dispose();
    binding = next;
    const pinned = next;
    const ledger = createAutomationLedger(context.globalStorageUri.fsPath, pinned.namespace);
    const prefix = `hps.email-automation.${pinned.namespace}.`;
    const baseRuntime = createGoogleAutomationRuntime({ clientId: pinned.clientId, maxRecipients: pinned.maxRecipients,
      isAllowed: () => binding === pinned && allowed(),
      secrets: { get: key => context.secrets.get(prefix + key), store: async (key, value) => { await authorize(); if (binding !== pinned || !matches()) throw new Error('활동이 변경돼 연결을 저장하지 않았어요.'); await context.secrets.store(prefix + key, value); }, delete: key => context.secrets.delete(prefix + key) },
      openBrowser: url => vscode.env.openExternal(vscode.Uri.parse(url)), ledger,
    });
    runtime = { ...baseRuntime,
      // OAuth mutation and refresh share the send lock across windows so an old
      // refresh cannot overwrite a newly connected account while authorization awaits.
      connect: () => ledger.withLock(async () => { await authorize(); return baseRuntime.connect(); }),
      disconnect: () => ledger.withLock(async () => { await authorize(); return baseRuntime.disconnect(); }),
      readSheet: args => ledger.withLock(async () => { await authorize(); return baseRuntime.readSheet(args); }),
      previewLatestSheet: async args => { await authorize(); return baseRuntime.previewLatestSheet(args); },
      send: args => ledger.withLock(async () => { await authorize(); if (binding !== pinned) throw new Error('활동이 변경됐어요.'); return baseRuntime.send(args); }),
    };
    controller = createAutomationPanelController({ runtime,
      store: createAutomationStoreClient({ baseUrl: pinned.service, getToken: async () => { await authorize(); if (binding !== pinned) throw new Error('활동이 변경됐어요.'); return pinned.token; } }), emit: view => { if (binding === pinned) emit(view); },
      confirmSend: async preview => {
        const choice = await vscode.window.showWarningMessage(`${preview.messages.length}명에게 이 메일을 보낼까요?`, { modal: true, detail: `${preview.messages.map(m => `${m.to} — ${m.subject}`).join('\n')}\n\n자동화 화면에서 확인한 본문 그대로 전송해요.` }, '확인한 메일 보내기');
        if (choice !== '확인한 메일 보내기') return false;
        await authorize();
        return binding === pinned && allowed();
      },
    });
    const saved = context.globalState.get<unknown>(`hps.automation.recipe.${pinned.namespace}`);
    if (saved) { try { controller.importRecipe(validateEmailRecipe(saved)); } catch { /* A malformed draft never prevents a fresh template. */ } }
  }
  async function handle(entry: Queued): Promise<void> {
    const { message, source, owner } = entry;
    const valid = () => panel === source && binding === owner && matches();
    if (!valid()) return;
    const activeController = controller;
    if (message.type === 'automationClose') { panel?.dispose(); return; }
    if (message.type !== 'automationAction' || !message.action || !activeController) return;
    try {
      await authorize();
      if (!valid()) return;
      const action = message.action;
      if (action.kind === 'authorWithAi') {
        const goal = await vscode.window.showInputBox({ title: 'AI와 이메일 템플릿 만들기', prompt: '어떤 안내 메일을 만들까요? 실제 이름·이메일·회사 정보는 넣지 마세요.', ignoreFocusOut: true });
        if (!goal?.trim()) return;
        await authorize();
        if (!valid()) return;
        await provider.authorAutomationRecipe(validateEmailRecipe(activeController.view().recipe), goal.slice(0, 2000));
      } else if (action.kind === 'importFile') {
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, filters: { '자동화 JSON': ['json'] }, title: 'AI와 만든 자동화 템플릿 가져오기' });
        if (!files?.[0]) return;
        const info = await vscode.workspace.fs.stat(files[0]);
        if (info.size > 32768) throw new Error('32KB 이하의 자동화 템플릿을 선택해 주세요.');
        const bytes = await vscode.workspace.fs.readFile(files[0]);
        if (bytes.length > 32768) throw new Error('자동화 템플릿이 너무 커요.');
        const recipe = validateEmailRecipe(JSON.parse(new TextDecoder().decode(bytes)));
        await authorize(); if (!valid()) return; activeController.importRecipe(recipe);
      } else { await activeController.handle(action); }
      if (!valid()) return;
      try { const recipe = validateEmailRecipe(activeController.view().recipe); await context.globalState.update(`hps.automation.recipe.${binding!.namespace}`, recipe); } catch { /* Incomplete edits remain in memory; no credentials or rows are persisted. */ }
    } catch (error) {
      if (!valid()) return;
      const view = activeController?.view();
      if (view) emit({ ...view, busy: false, error: error instanceof Error ? error.message : '자동화를 열지 못했어요.' });
    }
  }
  function enqueue(message: Message, source: vscode.WebviewPanel, owner: Binding) {
    if (panel !== source || binding !== owner) return;
    const entry = { message, source, owner };
    if (message.action?.kind === 'edit' && messages.at(-1)?.message.action?.kind === 'edit') messages[messages.length - 1] = entry;
    else messages.push(entry);
    if (draining) return;
    draining = true;
    void (async () => { try { while (messages.length) await handle(messages.shift()!); } finally { draining = false; } })().catch(() => undefined);
  }
  async function show(): Promise<void> {
    if (opening) return;
    opening = true;
    try {
      await prepare();
      if (panel) { panel.reveal(); enqueue({ type: 'automationAction', action: { kind: 'refresh' } }, panel, binding!); return; }
      const dist = vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist');
      panel = vscode.window.createWebviewPanel('hypeproof.automation', '업무 자동화', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] });
      panel.webview.html = provider.renderHtml(panel.webview, dist).replace(/<html\b/, '<html data-surface="automation"');
      const source = panel, owner = binding!;
      panel.webview.onDidReceiveMessage(message => enqueue(message, source, owner), undefined, context.subscriptions);
      panel.onDidDispose(() => {
        if (panel === source) panel = undefined;
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].source === source) messages.splice(i, 1);
      });
      context.subscriptions.push(panel);
    } catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : '자동화를 열지 못했어요.'); } finally { opening = false; }
  }
  const timer = setInterval(() => { if (panel && !matches()) { permittedUntil = 0; panel.dispose(); } }, 1000);
  context.subscriptions.push(vscode.commands.registerCommand('hypeproof-chat.emailAutomation', show), { dispose: () => { clearInterval(timer); permittedUntil = 0; panel?.dispose(); } });
  return {
    show, getRuntime: () => allowed() ? runtime : undefined,
    async refreshRuntime() { if (!runtime) await prepare(); else await authorize(); return allowed() ? runtime : undefined; },
    async getMcpHost(): Promise<GoogleAutomationMcpHost | undefined> {
      if (!activityConnections(context)?.current) return undefined;
      try { await prepare(); } catch { return undefined; }
      if (!runtime || !allowed()) return undefined;
      const pinned = binding;
      const refreshAuthorization = async () => {
        if (binding !== pinned || !matches()) return false;
        try { await authorize(); return binding === pinned && allowed(); } catch { return false; }
      };
      return {
        runtime,
        isAllowed: () => binding === pinned && allowed(),
        refreshAuthorization,
        confirmSend: async preview => {
          if (!await refreshAuthorization()) return false;
          return binding === pinned && await confirmMcpSend(preview) && binding === pinned;
        },
      };
    },
  };
}
