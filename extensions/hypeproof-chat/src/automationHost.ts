import { automationOpsProgress, type AutomationOpsObservation } from './automationOps';
import { tokenIdentityUnverified } from './classroomOps';
import * as vscode from 'vscode';
import { createAppsScriptRuntime, APPS_SCRIPT_TOKEN_KEY, type AppsScriptRuntime } from './appsScriptRuntime';
import { createAppsScriptHost } from './appsScriptHost';
import { createAutomationQuestSession, withAutomationQuest } from './automationQuestSession';
import type { PreviewProvider } from './previewProvider';
import { createHash, randomUUID } from 'node:crypto';
import { loadPackagedGoogleDesktopClient } from './googleDesktopClient';
import { activityConnections, ACTIVITY_TOKEN_KEY } from './activityConnections';
import { fetchProfileResult } from './proxyClient';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';
import type { ChatPanelProvider } from './chatPanelProvider';
import { createGoogleAutomationRuntime, validateEmailRecipe, type GoogleAutomationRuntime } from './googleAutomation';
import { createAutomationPanelController, spreadsheetIdFromInput } from './automationPanel';
import { createAutomationStoreClient } from './automationStoreClient';
import { automationNamespace, createAutomationLedger } from './automationLedger';
import { validateAutomationAnswer, type AutomationAction, type AutomationView, type AutomationQuestion, type AutomationAnswer } from './automationProtocol';

interface Binding { token: string; service: string; activityId: string; namespace: string; clientId: string; maxRecipients: number; appsScript: boolean; signature: string }
export function registerAutomationHost(context: vscode.ExtensionContext, provider: ChatPanelProvider, preview?: PreviewProvider) {
  let progressListener: (() => void) | undefined;
  const notifyProgress = () => { try { progressListener?.(); } catch { /* Observation is independent of the automation. */ } };
  const quest = createAutomationQuestSession(async html => {
    if (!matches() || !preview) return;
    preview.setLabels({ title: '자동화 진행', placeholder: '대화에서 원하는 업무를 알려 주세요', emoji: '◇' });
    await preview.showAutomation(html);
  }, notifyProgress);
  let appsRuntime: AppsScriptRuntime | undefined;
  let appsLock: (<T>(work: () => Promise<T>) => Promise<T>) | undefined;
  let appsTools: { epoch: number; host: ReturnType<typeof createAppsScriptHost> } | undefined;
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
  const desktopClientKey = (clientId: string) => `hps.google.desktop-client.${digest(clientId)}`;
  const matches = () => {
    const current = activityConnections(context)?.current;
    return !!binding && !!current && current.serverId === binding.activityId && current.token === binding.token && service() === binding.service && current.service.replace(/\/+$/, '') === binding.service && vscode.workspace.isTrusted;
  };
  const allowed = () => matches() && Date.now() < permittedUntil;
  const emit = (view: AutomationView) => { if (matches()) void panel?.webview.postMessage({ type: 'automationView', view }); };
  let operationEpoch = 0;
  type PendingQuestion = { question: AutomationQuestion; owner: Binding; epoch: number; resolve(answer: AutomationAnswer): void };
  let pendingQuestion: PendingQuestion | undefined;
  let authorizingAnswer: PendingQuestion | undefined;
  function cancelQuestion() {
    operationEpoch++;
    const pending = pendingQuestion ?? authorizingAnswer; pendingQuestion = undefined; authorizingAnswer = undefined;
    if (!pending) return;
    notifyProgress();
    void provider.showAutomationQuestion(null);
    pending.resolve({ questionId: pending.question.id, cancelled: true });
  }
  async function answerQuestion(answer: AutomationAnswer) {
    const pending = pendingQuestion;
    if (!pending || pending.owner !== binding || !matches() || answer.questionId !== pending.question.id) return;
    if (answer.cancelled === true) { cancelQuestion(); return; }
    let error = '';
    if (!validateAutomationAnswer(pending.question, answer)) error = '질문에 맞는 답변 하나를 선택하거나 입력해 주세요.';
    if (!pending.question.private && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{12,}|docs\.google\.com\/spreadsheets/i.test(answer.text ?? '')) error = '실제 이메일·계정 정보·시트 주소는 다음 비공개 설정 질문에서 입력해 주세요.';
    if (!error && pending.question.kind === 'sheet') { try { spreadsheetIdFromInput(answer.text ?? ''); } catch { error = 'Google Sheets 주소를 확인해 주세요.'; } }
    if (error) { pending.question = { ...pending.question, error }; await provider.showAutomationQuestion(pending.question); return; }
    // Consume once before awaiting authorization; a second click cannot approve twice.
    pendingQuestion = undefined; authorizingAnswer = pending;
    notifyProgress();
    await provider.showAutomationQuestion(null);
    try { await authorize(); if (authorizingAnswer !== pending || operationEpoch !== pending.epoch || binding !== pending.owner || !matches()) throw new Error('Changed activity'); pending.resolve(answer); }
    catch { pending.resolve({ questionId: pending.question.id, cancelled: true }); }
    finally { if (authorizingAnswer === pending) authorizingAnswer = undefined; }
  }
  async function askQuestion(question: Omit<AutomationQuestion, 'id'>, owner: Binding, epoch: number): Promise<AutomationAnswer> {
    if (epoch !== operationEpoch || binding !== owner || !matches()) throw new Error('Changed activity');
    await authorize();
    if (epoch !== operationEpoch || binding !== owner || !matches()) throw new Error('Changed activity');
    if (pendingQuestion || authorizingAnswer) throw new Error('앞의 질문에 먼저 답해 주세요.');
    if (typeof provider.showAutomationQuestion !== 'function') throw new Error('대화 화면에서 자동화를 다시 시작해 주세요.');
    const value = { ...question, id: randomUUID() };
    const answer = new Promise<AutomationAnswer>(resolve => { pendingQuestion = { question: value, owner, epoch, resolve }; });
    if (epoch !== operationEpoch || binding !== owner || !matches()) { cancelQuestion(); return answer; }
    notifyProgress();
    await provider.showAutomationQuestion(value);
    if (epoch !== operationEpoch || binding !== owner || !matches()) cancelQuestion();
    return answer;
  }
  provider.setAutomationConversationHandlers?.({ answer: answerQuestion, cancel: cancelQuestion, isWaiting: () => !!pendingQuestion });
  const recipeKey = (owner: Binding) => `hps.automation.recipe.${owner.namespace}`;
  const reusable = (value: unknown) => {
    const recipe = validateEmailRecipe(value);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{12,}|docs\.google\.com\/spreadsheets/i.test(JSON.stringify(recipe))) throw new Error('재사용 스킬에는 실제 주소·시트·비밀값을 넣지 마세요.');
    return recipe;
  };
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
    const next: Binding = { token, service: base, activityId: p.activity_id!, namespace: automationNamespace(base, p.activity_id!), clientId, maxRecipients, appsScript: grant.appsScript === true, signature: digest(JSON.stringify([base, token, p.activity_id, clientId, maxRecipients, grant.appsScript === true])) };
    if (!opening && binding?.signature !== next.signature) { panel?.dispose(); throw new Error('자동화 설정이 변경됐어요. 다시 열어 주세요.'); }
    permittedUntil = Date.now() + 60000;
    return next;
  }
  async function confirmMcpSend(preview: import('./googleAutomation').EmailPreview, epoch: number): Promise<boolean> {
    const pinned = binding;
    if (!pinned) return false;
    await authorize();
    if (binding !== pinned || epoch !== operationEpoch) return false;
    if (typeof provider.showAutomationQuestion === 'function') {
      const answer = await askQuestion({ kind: 'preview', title: `${preview.messages.length}명에게 이 내용으로 보낼까요?`, description: '받는 사람과 제목, 본문을 모두 확인해 주세요. 보내기를 누르면 실제 메일이 발송돼요.', preview, private: true }, pinned, epoch);
      return answer.approved === true && answer.cancelled !== true && binding === pinned && allowed();
    }
    const detail = preview.messages.map((message, index) => `${index + 1}. 받는 사람: ${message.to}\n제목: ${message.subject}\n\n${message.body}`).join('\n\n────────────────────\n\n');
    const answer = await vscode.window.showWarningMessage(`${preview.messages.length}명에게 보낼 내용을 모두 확인해 주세요.`, { modal: true, detail }, '확인한 메일 보내기');
    if (answer !== '확인한 메일 보내기') return false;
    await authorize();
    return pinned === binding && allowed();
  }
  async function prepare(): Promise<void> {
    const next = await authorize(true);
    if (binding?.signature === next.signature && runtime && controller) return;
    if (binding) { cancelQuestion(); panel?.dispose(); }
    binding = next; runtime = undefined; controller = undefined; appsRuntime = undefined; appsTools = undefined; quest.clear();
    const pinned = next;
    const ledger = createAutomationLedger(context.globalStorageUri.fsPath, pinned.namespace);
    const prefix = `hps.email-automation.${pinned.namespace}.`;
    let lockedEpoch: number | undefined;
    const runLocked = <T>(work: () => Promise<T>): Promise<T> => {
      const epoch = operationEpoch;
      return ledger.withLock(async () => {
        await authorize();
        if (epoch !== operationEpoch || binding !== pinned || !matches()) throw new Error('취소되거나 활동이 변경됐어요.');
        lockedEpoch = epoch;
        try { return await work(); } finally { lockedEpoch = undefined; }
      });
    };
    const clientSecret = await context.secrets.get(desktopClientKey(pinned.clientId))
      ?? await loadPackagedGoogleDesktopClient(context.extensionUri.fsPath, pinned.clientId);
    if (binding !== pinned || !matches()) throw new Error('활동이 변경됐어요.');
    const baseRuntime = createGoogleAutomationRuntime({ clientId: pinned.clientId, clientSecret, maxRecipients: pinned.maxRecipients,
      isAllowed: () => binding === pinned && allowed() && (lockedEpoch === undefined || lockedEpoch === operationEpoch),
      secrets: { get: key => context.secrets.get(prefix + key), store: async (key, value) => { await authorize(); if (binding !== pinned || !matches() || (lockedEpoch !== undefined && lockedEpoch !== operationEpoch)) throw new Error('활동이 변경되거나 취소돼 연결을 저장하지 않았어요.'); await context.secrets.store(prefix + key, value); }, delete: key => context.secrets.delete(prefix + key) },
      openBrowser: url => { if (lockedEpoch !== undefined && lockedEpoch !== operationEpoch) throw new Error('로그인을 취소했어요.'); return vscode.env.openExternal(vscode.Uri.parse(url)); }, ledger,
    });
    if (pinned.appsScript) {
      appsLock = runLocked;
      const appSecrets = {
        get: (key: string) => context.secrets.get(prefix + key),
        store: async (key: string, value: string) => { await authorize(); if (binding !== pinned || !matches() || lockedEpoch !== operationEpoch) throw new Error('Changed activity'); await context.secrets.store(prefix + key, value); if (key === APPS_SCRIPT_TOKEN_KEY) await context.secrets.store(prefix + 'hps.google.email-automation.v1', value); },
        delete: (key: string) => context.secrets.delete(prefix + key),
      };
      appsRuntime = createAppsScriptRuntime({ clientId: pinned.clientId, clientSecret,
        secrets: appSecrets,
        isAllowed: () => binding === pinned && matches() && pinned.appsScript && (lockedEpoch === undefined ? allowed() : lockedEpoch === operationEpoch),
        openBrowser: url => { if (!matches() || lockedEpoch !== operationEpoch) throw new Error('Cancelled'); return vscode.env.openExternal(vscode.Uri.parse(url)); },
      });
    }
    runtime = { ...baseRuntime,
      // OAuth mutation and refresh share the send lock across windows so an old
      // refresh cannot overwrite a newly connected account while authorization awaits.
      connect: () => runLocked(() => pinned.appsScript && appsRuntime ? appsRuntime.connect() : baseRuntime.connect()),
      ensureConnected: () => runLocked(() => baseRuntime.ensureConnected()),
      disconnect: () => runLocked(async () => { await baseRuntime.disconnect(); await appsRuntime?.disconnect(); }),
      readSheet: args => runLocked(() => baseRuntime.readSheet(args)),
      previewLatestSheet: async args => { await authorize(); return baseRuntime.previewLatestSheet(args); },
      send: args => runLocked(() => baseRuntime.send(args)),
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
  const timer = setInterval(() => { if (binding && !matches()) { permittedUntil = 0; cancelQuestion(); panel?.dispose(); if (quest.snapshot()) { quest.clear(); void preview?.show('<!doctype html><html lang="ko"><body><p>활동이 바뀌었어요. 새 대화에서 자동화 흐름을 시작해 주세요.</p></body></html>'); } } }, 1000);
  async function ensureQuest() {
    if (!binding?.appsScript || !preview || quest.snapshot()) return;
    await quest.plan({ title: '나의 메일 자동화 만들기', nodes: [
      { id: 'goal', label: '내 업무 이야기하기', description: '대화에서 필요한 내용을 하나씩 확인해요.', dependsOn: [] },
      { id: 'skill', label: '메일 스킬 만들기', description: '반복해서 쓸 문구와 항목을 저장해요.', dependsOn: ['goal'] },
      { id: 'connect', label: '내 Google 계정 연결', description: '허용한 연결은 다음에도 다시 쓸 수 있어요.', dependsOn: ['goal'] },
      { id: 'sheet', label: '내 명단 연결', description: '시트 주소와 명단은 비공개로 확인해요.', dependsOn: ['connect'] },
      { id: 'prepare', label: '자동화 코드 준비', description: '저장한 스킬에 맞는 Apps Script 코드를 만들어요.', dependsOn: ['skill'] },
      { id: 'upload', label: 'Google에 코드 저장', description: '내용을 확인한 뒤 내 계정에 저장해요.', dependsOn: ['prepare', 'connect'] },
      { id: 'deploy', label: '나만 실행할 버전 준비', description: '확인한 코드로 비공개 실행 버전을 만들어요.', dependsOn: ['upload'] },
      { id: 'preview', label: '실제 메일 미리보기', description: 'Google에서 실행해 내용을 확인해요. 발송은 별도 승인이 필요해요.', dependsOn: ['deploy', 'sheet'] },
    ] });
  }
  async function startConversation() {
    try { await prepare(); await ensureQuest(); await provider.beginAutomationConversation(); }
    catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : '업무 자동화를 시작하지 못했어요.'); }
  }
  // Only the isolated Dev app exposes this operator setup command.
  void vscode.commands.executeCommand('setContext', 'hypeproofChat.devGoogleOperator', vscode.env.appName === 'HypeProof Studio Dev');
  if (vscode.env.appName === 'HypeProof Studio Dev') context.subscriptions.push(
    vscode.commands.registerCommand('hypeproof-chat.configureGoogleDesktopClient', async () => {
      try {
        const target = await authorize(true);
        if (!target.clientId.trim()) throw new Error('Google Desktop client ID를 먼저 설정해 주세요.');
        const value = await vscode.window.showInputBox({ title: '운영자 Google Desktop OAuth 설정', prompt: '현재 Desktop client의 client secret을 입력하세요. 이 기기의 보안 저장소에만 보관합니다.', password: true, ignoreFocusOut: true, validateInput: input => !input.trim() || input.length > 4096 || /[\r\n\x00]/.test(input) ? 'Desktop client secret 한 줄을 입력하세요.' : undefined });
        if (value === undefined) return { configured: false, cancelled: true };
        if (!value.trim() || value.length > 4096 || /[\r\n\x00]/.test(value)) throw new Error('Desktop client secret을 확인해 주세요.');
        const current = await authorize(true);
        if (current.signature !== target.signature) throw new Error('활동이나 Google client 설정이 변경됐어요. 다시 설정해 주세요.');
        await context.secrets.store(desktopClientKey(target.clientId), value.trim());
        cancelQuestion(); panel?.dispose(); runtime = undefined; controller = undefined; permittedUntil = 0;
        return { configured: true };
      } catch {
        await vscode.window.showWarningMessage('Google Desktop 설정을 저장하지 못했어요. 현재 활동과 client ID를 확인해 주세요.');
        return { configured: false };
      }
    }),
  );
  context.subscriptions.push(vscode.commands.registerCommand('hypeproof-chat.emailAutomation', startConversation), { dispose: () => { clearInterval(timer); permittedUntil = 0; cancelQuestion(); panel?.dispose(); } });
  return {
    setProgressListener(listener: () => void) { progressListener = listener; },
    observation(): AutomationOpsObservation | null {
      if (!matches() || !binding) return null;
      const owner = tokenIdentityUnverified(binding.token);
      return { owner: { u: owner.u, c: owner.c }, progress: automationOpsProgress(quest.snapshot(), pendingQuestion?.owner === binding ? pendingQuestion.question : undefined) };
    },
    show, startConversation, getRuntime: () => allowed() ? runtime : undefined,
    async refreshRuntime() { if (!runtime) await prepare(); else await authorize(); return allowed() ? runtime : undefined; },
    async getMcpHost(): Promise<GoogleAutomationMcpHost | undefined> {
      if (!activityConnections(context)?.current) return undefined;
      try { await prepare(); } catch { return undefined; }
      if (!runtime || !allowed()) return undefined;
      await ensureQuest();
      const pinned = binding;
      if (!pinned) return undefined;
      const activeRuntime = runtime;
      const epoch = operationEpoch;
      const live = () => epoch === operationEpoch && binding === pinned && matches();
      const guardedFetch: typeof fetch = (input, init) => { if (!live()) throw new Error('Cancelled or changed activity'); return fetch(input, init); };
      const sheetKey = `hps.email-automation.${pinned.namespace}.sheet`;
      const refreshAuthorization = async () => {
        if (!live()) return false;
        try { await authorize(); return live() && allowed(); } catch { return false; }
      };
      type SheetSetting = { spreadsheetId: string; range: string; connection: string };
      const currentSheet = async (): Promise<SheetSetting | null> => {
        const text = await context.secrets.get(sheetKey);
        if (!text) return null;
        try {
          const value = JSON.parse(text) as SheetSetting;
          if (typeof value.spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(value.spreadsheetId) || value.range !== `A1:D${pinned.maxRecipients + 1}` || typeof value.connection !== 'string' || value.connection !== await activeRuntime.getConnectionIdentity()) return null;
          return value;
        } catch { return null; }
      };
      const readConfiguredSheet = async () => {
        if (!await refreshAuthorization()) throw new Error('Changed activity');
        const setting = await currentSheet();
        if (!setting) return { needsSheetConfiguration: true };
        const rows = await activeRuntime.readSheet({ spreadsheetId: setting.spreadsheetId, range: setting.range });
        return { rowCount: Math.max(0, rows.length - 1), columns: rows[0] ?? [] };
      };
      if (pinned.appsScript && appsRuntime && appsLock && appsTools?.epoch !== epoch) {
        const projectKey = `hps.email-automation.${pinned.namespace}.apps-project`;
        const ledger = createAutomationLedger(context.globalStorageUri.fsPath, pinned.namespace);
        appsTools = { epoch, host: createAppsScriptHost({ runtime: appsRuntime, maxRecipients: pinned.maxRecipients,
          allowed: async () => await refreshAuthorization() && pinned.appsScript,
          recipe: () => reusable(context.globalState.get(recipeKey(pinned))),
          ask: question => askQuestion(question, pinned, epoch),
          load: async () => { const text = await context.secrets.get(projectKey); if (!text) return undefined; try { return JSON.parse(text); } catch { return undefined; } },
          save: async value => { if (!await refreshAuthorization()) throw new Error('Changed activity'); await context.secrets.store(projectKey, JSON.stringify(value)); },
          sheet: currentSheet, lock: appsLock, ledger,
          openBrowser: url => { if (!live()) throw new Error('Changed activity'); return vscode.env.openExternal(vscode.Uri.parse(url)); },
        }) };
      }
      return withAutomationQuest({
        ...(pinned.appsScript ? appsTools?.host : {}),
        isAppsScriptAllowed: () => live() && allowed() && pinned.appsScript,
        runtime,
        readConfiguredSheet,
        previewSavedSkill: async () => {
          if (!await refreshAuthorization()) throw new Error('Changed activity');
          const recipe = reusable(context.globalState.get(recipeKey(pinned)));
          const preview = await activeRuntime.previewLatestSheet({ recipe });
          if (!live()) throw new Error('Changed activity');
          return preview;
        },
        isAllowed: () => live() && allowed(),
        refreshAuthorization,
        confirmSend: async preview => {
          if (!await refreshAuthorization()) return false;
          return live() && await confirmMcpSend(preview, epoch) && live();
        },
        isAwaitingUser: () => !!pendingQuestion && pendingQuestion.owner === pinned,
        cancelPendingQuestion: () => { if (binding === pinned && epoch === operationEpoch) cancelQuestion(); },
        askUser: async args => {
          if (!await refreshAuthorization()) throw new Error('Changed activity');
          const answer = await askQuestion({ kind: args.choices.length ? 'choice' : 'text', title: args.question, choices: args.choices, allowFreeText: args.allowFreeText, private: false, description: '업무 방식만 알려 주세요. 실제 이름·이메일·계정·시트 주소는 비공개 설정에서 입력해요.' }, pinned, epoch);
          return answer.cancelled ? { cancelled: true } : { ...(answer.text ? { answer: answer.text.trim() } : {}), ...(answer.choiceId ? { choiceId: answer.choiceId } : {}) };
        },
        saveSkill: async value => {
          if (!await refreshAuthorization() || !pinned) throw new Error('Changed activity');
          const recipe = reusable(value);
          await context.globalState.update(recipeKey(pinned), recipe);
          if (!live()) throw new Error('Changed activity');
          controller?.importRecipe(recipe);
          return { saved: true, title: recipe.title };
        },
        connectGoogle: async (mode = 'reuse') => {
          if (!await refreshAuthorization()) throw new Error('Changed activity');
          if (mode === 'reuse' && (!pinned.appsScript || await appsRuntime?.isConnected()) && await activeRuntime.ensureConnected()) return { connected: true, reused: true };
          const answer = await askQuestion({ kind: 'connect', title: mode === 'change' ? '다른 Google 계정으로 연결을 바꿀까요?' : '보내는 Google 계정을 처음 연결할까요?', description: pinned.appsScript ? 'Apps Script 생성·수정·본인 전용 배포, 시트 읽기와 메일 발송에 동의하면 이 연결을 함께 재사용해요. 실제 발송은 별도로 확인해요. 토큰은 AI에게 전달하지 않아요.' : 'Google에서 한 번 동의하면 연결을 재사용해요. 비밀번호와 로그인 토큰은 AI에게 전달하지 않아요.', private: true }, pinned, epoch);
          if (!answer.approved || answer.cancelled || !live()) return { cancelled: true };
          if (pinned.appsScript && appsRuntime && appsLock) await appsLock(() => appsRuntime!.connect());
          else await activeRuntime.connect();
          return { connected: true, reused: false };
        },
        configureSheet: async (mode = 'reuse') => {
          if (!await refreshAuthorization()) throw new Error('Changed activity');
          if (!await activeRuntime.ensureConnected()) return { needsGoogleConnection: true };
          if (mode === 'reuse' && await currentSheet()) return { ...await readConfiguredSheet(), reused: true };
          const answer = await askQuestion({ kind: 'sheet', title: mode === 'change' ? '대신 사용할 Google Sheets 주소를 알려 주세요.' : '명단이 있는 Google Sheets 주소를 알려 주세요.', description: '첫 행에 열 이름, 그 아래에 명단을 준비해 주세요. 첫 시트의 A~D열에서 최대 20명을 읽어요. 주소는 이 기기에 저장해 재사용하고, 실제 명단은 AI에게 전달하지 않아요.', private: true }, pinned, epoch);
          if (answer.cancelled || !live()) return { cancelled: true };
          const connection = await activeRuntime.getConnectionIdentity();
          if (!connection) throw new Error('Google 계정을 먼저 연결해 주세요.');
          const setting = { spreadsheetId: spreadsheetIdFromInput(answer.text!), range: `A1:D${pinned.maxRecipients + 1}`, connection };
          const rows = await activeRuntime.readSheet({ spreadsheetId: setting.spreadsheetId, range: setting.range });
          if (!live() || connection !== await activeRuntime.getConnectionIdentity()) throw new Error('Google 연결이 변경됐어요. 시트를 다시 확인해 주세요.');
          await context.secrets.store(sheetKey, JSON.stringify(setting));
          return { rowCount: Math.max(0, rows.length - 1), columns: rows[0] ?? [], reused: false };
        },
        publishSkill: async () => {
          if (!await refreshAuthorization() || !pinned) throw new Error('Changed activity');
          const recipe = reusable(context.globalState.get(recipeKey(pinned)));
          const answer = await askQuestion({ kind: 'publish', title: '이 스킬을 우리 반 스토어에 공유할까요?', description: '아래 템플릿과 설명만 공유해요. Google 계정·시트 주소·명단·보낸 메일은 공유하지 않아요.', recipe, private: true }, pinned, epoch);
          if (!answer.approved || answer.cancelled || !live()) return { cancelled: true };
          const store = createAutomationStoreClient({ baseUrl: pinned.service, fetchImpl: guardedFetch, getToken: async () => { if (!await refreshAuthorization()) throw new Error('Changed activity'); return pinned.token; } });
          const result = await store.publish(recipe, 'skill-' + digest(JSON.stringify(recipe)));
          return { published: true, id: result.item.id, title: result.item.title };
        },
        listSkills: async () => {
          if (!await refreshAuthorization() || !pinned) throw new Error('Changed activity');
          const store = createAutomationStoreClient({ baseUrl: pinned.service, fetchImpl: guardedFetch, getToken: async () => { if (!await refreshAuthorization()) throw new Error('Changed activity'); return pinned.token; } });
          const result = await store.list();
          return { items: result.items.map(({ id, title, description, mine }) => ({ id, title, description, mine })) };
        },
        installSkill: async id => {
          if (!await refreshAuthorization() || !pinned) throw new Error('Changed activity');
          const store = createAutomationStoreClient({ baseUrl: pinned.service, fetchImpl: guardedFetch, getToken: async () => { if (!await refreshAuthorization()) throw new Error('Changed activity'); return pinned.token; } });
          const detail = await store.detail(id);
          const recipe = reusable(detail.recipe);
          const answer = await askQuestion({ kind: 'install', title: `${recipe.title} 스킬을 가져올까요?`, description: '이메일 템플릿만 가져와요. Google 계정과 명단은 직접 연결하고, 발송 전에 다시 확인해요.', recipe, private: true }, pinned, epoch);
          if (!answer.approved || answer.cancelled || !live()) return { cancelled: true };
          await context.globalState.update(recipeKey(pinned), recipe);
          if (!live()) throw new Error('Changed activity');
          controller?.importRecipe(recipe);
          return { installed: true, recipe };
        },
      }, quest);
    },
  };
}
