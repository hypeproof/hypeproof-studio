import { randomUUID } from 'node:crypto';
import { defaultAutomationRecipe, type AutomationAction, type AutomationView, type AutomationRecipe, type AutomationPreview, type AutomationSendRecord } from './automationProtocol.ts';
import { AutomationPublicationWithdrawnError, type AutomationStoreClient } from './automationStoreClient.ts';
export interface AutomationRuntime {
  connect(): Promise<unknown>; disconnect(): Promise<unknown>;
  status(): Promise<{ connected: boolean; configured: boolean; revocationPending?: boolean }>;
  readSheet(input: { spreadsheetId: string; range: string }): Promise<string[][]>;
  preview(input: { recipe: AutomationRecipe; rows: string[][] }): AutomationPreview | Promise<AutomationPreview>;
  send(input: { previewId: string; approved: boolean }): Promise<{ records: AutomationSendRecord[] }>;
}
export function spreadsheetIdFromInput(input: string): string {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === 'docs.google.com') { const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(url.pathname)?.[1]; if (id) return id; } } catch { /* User input, never echo URLs. */ }
  throw new Error('Google Sheets 주소를 넣어 주세요.');
}
export function createAutomationPanelController(deps: { runtime: AutomationRuntime; store: AutomationStoreClient; confirmSend(preview: AutomationPreview): Promise<boolean>; emit(view: AutomationView): void }) {
  let state: AutomationView = { recipe: defaultAutomationRecipe(), sheetUrl: '', range: 'A1:D21', connected: false, configured: false, busy: false, notice: '', error: null, preview: null, records: [], items: [], selected: null };
  let publication: { content: string; requestId: string } | undefined;
  const snapshot = () => structuredClone(state);
  const emit = () => deps.emit(snapshot());
  const invalidate = () => { state.preview = null; state.records = []; };
  async function handle(action: AutomationAction) {
    if (!action || typeof action.kind !== 'string' || state.busy) return;
    if (action.kind === 'edit' && (!action.recipe || action.recipe.schema !== 'hps-email-automation/1' || action.recipe.category !== 'email' || !action.recipe.columns || ['title', 'description', 'subjectTemplate', 'bodyTemplate'].some(key => typeof (action.recipe as unknown as Record<string, unknown>)[key] !== 'string') || ['email', 'name', 'document', 'dueDate'].some(key => typeof (action.recipe.columns as Record<string, unknown>)[key] !== 'string') || typeof action.sheetUrl !== 'string' || typeof action.range !== 'string' || JSON.stringify(action.recipe).length > 32768 || action.sheetUrl.length > 4096 || action.range.length > 200)) { state.error = '자동화 입력 형식을 확인해 주세요.'; emit(); return; }
    if (action.kind === 'edit') { state.recipe = structuredClone(action.recipe); state.sheetUrl = action.sheetUrl; state.range = action.range; invalidate(); state.notice = ''; state.error = null; emit(); return; }
    state.busy = true; state.error = null; state.notice = ''; emit();
    try {
      switch (action.kind) {
        case 'refresh': Object.assign(state, await deps.runtime.status()); break;
        case 'connect': await deps.runtime.connect(); Object.assign(state, await deps.runtime.status()); invalidate(); break;
        case 'disconnect':
          invalidate(); emit();
          try { await deps.runtime.disconnect(); state.notice = 'Google 연결을 해제했어요.'; }
          finally { Object.assign(state, await deps.runtime.status()); }
          break;
        case 'preview': {
          invalidate();
          const rows = await deps.runtime.readSheet({ spreadsheetId: spreadsheetIdFromInput(state.sheetUrl), range: state.range });
          state.preview = await deps.runtime.preview({ recipe: state.recipe, rows });
          state.notice = '아직 보내지 않았어요. 받는 사람과 내용을 모두 확인해 주세요.'; break;
        }
        case 'send': {
          const preview = state.preview;
          if (!preview || preview.id !== action.previewId || action.reviewed !== true) throw new Error('현재 미리보기의 받는 사람과 내용을 먼저 확인해 주세요.');
          if (state.records.length) throw new Error('이미 전송을 요청한 미리보기예요. 결과를 확인해 주세요.');
          if (!await deps.confirmSend(structuredClone(preview))) { state.notice = '전송하지 않았어요.'; break; }
          // Reserve every row before network I/O. An uncertain result must never enable blind retry.
          state.records = preview.messages.map(message => ({ id: message.id, status: 'unknown' as const }));
          emit();
          state.records = (await deps.runtime.send({ previewId: preview.id, approved: true })).records;
          state.notice = '전송 결과를 확인해 주세요. 확인 중인 메일은 Gmail 보낸편지함에서 먼저 확인해 주세요.'; break;
        }
        case 'list': state.items = (await deps.store.list()).items; break;
        case 'detail': state.selected = await deps.store.detail(action.id); break;
        case 'import': {
          const entry = await deps.store.detail(action.id);
          state.recipe = entry.recipe; state.sheetUrl = ''; state.range = 'A1:D21'; invalidate();
          state.notice = '템플릿을 가져왔어요. 내 명단을 연결해 미리보기를 만들어 주세요.'; break;
        }
        case 'publish': {
          if (action.reviewed !== true) throw new Error('공유할 내용을 먼저 확인해 주세요.');
          const content = JSON.stringify(state.recipe);
          if (publication?.content !== content) publication = { content, requestId: randomUUID() };
          try { await deps.store.publish(state.recipe, publication.requestId); }
          catch (error) { if (error instanceof AutomationPublicationWithdrawnError) publication = undefined; throw error; }
          state.items = (await deps.store.list()).items; state.notice = '우리 반 스토어에 올렸어요.'; break;
        }
        case 'unpublish': await deps.store.unpublish(action.id); state.items = (await deps.store.list()).items; state.selected = null; state.notice = '스토어에서 내렸어요.'; break;
        default: throw new Error('지원하지 않는 작업이에요.');
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : '작업을 완료하지 못했어요.';
    } finally { state.busy = false; emit(); }
  }
  return { handle, view: snapshot, importRecipe(recipe: AutomationRecipe) { if (state.busy) return; state.recipe = structuredClone(recipe); state.sheetUrl = ''; invalidate(); state.notice = '템플릿을 가져왔어요. 내 명단을 연결해 주세요.'; state.error = null; emit(); } };
}
