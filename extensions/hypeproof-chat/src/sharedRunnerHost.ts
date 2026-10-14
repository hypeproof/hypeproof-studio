import { createHash } from 'node:crypto';
import { AppsScriptBlockedError, AppsScriptRecoveryError, type AppsScriptRuntime, type AppsScriptDeployment } from './appsScriptRuntime';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';
import type { EmailRecipe, EmailPreview, SendRecord } from './googleAutomation';
import type { AutomationQuestion, AutomationAnswer } from './automationProtocol';

interface Deps {
  runtime: AppsScriptRuntime;
  maxRecipients: number;
  allowed(): Promise<boolean>;
  recipe(): EmailRecipe;
  ask(question: Omit<AutomationQuestion, 'id'>): Promise<AutomationAnswer>;
  sheet(): Promise<{ spreadsheetId: string; range: string; connection: string } | null>;
  lock<T>(work: () => Promise<T>): Promise<T>;
  ledger: { load(): Promise<Record<string, SendRecord>>; save(value: Record<string, SendRecord>): Promise<void> };
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Shared recipes are data. Learners never create projects or receive operator permissions. */
export function createSharedRunnerHost(deps: Deps): Pick<GoogleAutomationMcpHost, 'appsScriptPrepare' | 'appsScriptUpload' | 'appsScriptSetup' | 'appsScriptDeploy' | 'appsScriptRun'> {
  let current: { preview: EmailPreview; deployment: AppsScriptDeployment } | undefined;
  let recovery: { kind: 'reconnect' | 'retry' | 'operator'; reason: string } | undefined;
  const allowed = async () => { if (!await deps.allowed()) throw new Error('현재 활동에서 Google 자동화를 사용할 수 없어요.'); };
  const deployment = () => deps.runtime.sharedDeployment(deps.recipe(), deps.maxRecipients);
  const same = (a: AppsScriptDeployment, b: AppsScriptDeployment) => JSON.stringify(a) === JSON.stringify(b);
  const blocked = (error: unknown) => {
    current = undefined;
    if (error instanceof AppsScriptRecoveryError) recovery = { kind: error.recovery, reason: error.message };
    else if (error instanceof AppsScriptBlockedError) recovery = { kind: 'operator', reason: 'Studio의 공통 Google 실행 설정을 운영자가 확인해야 해요. 수강생의 프로젝트 권한은 필요하지 않아요.' };
    else throw error;
    return { recoveryRequired: true, recovery: recovery.kind, reason: recovery.reason, nextTool: 'apps_script_setup', executionVerified: false, mailSent: false };
  };
  const prepare = async () => {
    await allowed(); current = undefined;
    try {
      await deployment();
      return { prepared: true, sharedRunner: true, runtime: 'Google shared runner', uploaded: false, deployed: false, executionVerified: false, nextTool: 'apps_script_run', mode: 'preview' };
    } catch (error) { return blocked(error); }
  };
  const compatibility = async () => {
    const result = await prepare();
    return { ...result, ready: 'prepared' in result && result.prepared === true, uploaded: false, deployed: false };
  };
  return {
    appsScriptPrepare: prepare,
    appsScriptUpload: compatibility,
    appsScriptDeploy: compatibility,
    appsScriptSetup: async () => {
      await allowed(); current = undefined;
      const kind = recovery?.kind ?? (await deps.runtime.isConnected() ? 'retry' : 'reconnect');
      const choices = [{ id: kind === 'reconnect' ? 'connect' : 'retry', label: kind === 'reconnect' ? 'Google 계정 연결하기' : kind === 'operator' ? '운영자가 수정했어요 · 다시 확인' : '다시 미리보기 확인' }, { id: 'pause', label: '저장한 작업을 두고 나중에 이어가기' }];
      const answer = await deps.ask({ kind: 'choice', private: true, title: kind === 'operator' ? '운영자의 Google 설정 확인이 필요해요' : 'Google 연결을 이어갈까요?', description: recovery?.reason ?? '본인 Google 계정과 명단으로 실행해요. 프로젝트 생성이나 회사 관리 권한 없이 연결할 수 있어요. 메일은 따로 승인해야 보내요.', choices, allowFreeText: false });
      if (answer.cancelled || !choices.some(c => c.id === answer.choiceId)) return { cancelled: true };
      await allowed();
      if (answer.choiceId === 'pause') return { paused: true, operatorRequired: kind === 'operator', executionVerified: false, mailSent: false };
      if (answer.choiceId === 'connect') {
        try { await deps.lock(() => deps.runtime.connect()); recovery = undefined; return { connected: true, nextTool: 'google_configure_sheet', executionVerified: false, mailSent: false }; }
        catch (error) { return blocked(error); }
      }
      return { retryRequired: true, nextTool: 'apps_script_run', mode: 'preview', executionVerified: false, mailSent: false };
    },
    appsScriptRun: async mode => {
      await allowed();
      try {
        const pinned = await deployment();
        if (mode === 'preview') {
          current = undefined;
          const sheet = await deps.sheet();
          if (!sheet) return { sheetConfigurationRequired: true };
          if (sheet.connection !== pinned.connectionIdentity) return { sameGoogleAccountRequired: true };
          const preview = await deps.lock(() => deps.runtime.preview(pinned, sheet));
          await allowed();
          if (!same(pinned, await deployment())) return { previewRequired: true };
          current = { preview, deployment: pinned }; recovery = undefined;
          const answer = await deps.ask({ kind: 'preview_review', private: true, title: 'Google에서 만든 메일을 확인해 주세요', description: '본인 계정의 명단으로 만든 결과예요. 확인하거나 닫아도 메일은 보내지 않아요.', preview });
          await allowed();
          if (!same(pinned, await deployment())) { current = undefined; return { previewRequired: true }; }
          return { previewed: true, count: preview.messages.length, reviewed: answer.approved === true && !answer.cancelled, dismissed: answer.cancelled === true, sharedRunner: true, nextAction: 'wait_for_user', confirmationRequired: true, mailSent: false };
        }
        const saved = current;
        if (!saved || !same(saved.deployment, pinned) || !deps.runtime.getPreview(saved.preview.id)) { current = undefined; return { previewRequired: true }; }
        const { preview } = saved;
        const account = pinned.connectionIdentity.split(':')[0];
        // The key is deliberately unchanged from personal-script and Gmail execution.
        // Unknown legacy attempts can never become a fresh send after migration.
        const keys = preview.messages.map(message => hash(`${account}:${message.id}`));
        const hasPrior = async () => { const records = await deps.ledger.load(); return keys.some(key => !!records[key]); };
        if (await deps.lock(hasPrior)) return { sent: false, previousAttempt: true, automaticResendBlocked: true };
        const answer = await deps.ask({ kind: 'preview', private: true, title: `${preview.messages.length}명에게 Google에서 발송할까요?`, description: '받는 사람과 제목·본문을 모두 확인해 주세요. 승인하면 본인 Google 계정에서 이 내용 그대로 발송해요.', preview });
        if (!answer.approved || answer.cancelled) return { cancelled: true };
        await allowed(); current = undefined;
        return await deps.lock(async () => {
          if (!same(pinned, await deployment()) || !deps.runtime.getPreview(preview.id)) return { previewRequired: true };
          const records = await deps.ledger.load();
          if (keys.some(key => !!records[key])) return { sent: false, previousAttempt: true, automaticResendBlocked: true };
          preview.messages.forEach((message, i) => { records[keys[i]!] = { id: message.id, status: 'sending' }; });
          await deps.ledger.save(records);
          let result: { records: SendRecord[] };
          try { result = await deps.runtime.sendApproved(pinned, preview.id, true); }
          catch { result = { records: preview.messages.map(message => ({ id: message.id, status: 'unknown' })) }; }
          preview.messages.forEach((message, i) => { records[keys[i]!] = result.records.find(record => record.id === message.id) ?? { id: message.id, status: 'unknown' }; });
          await deps.ledger.save(records);
          const count = result.records.filter(record => record.status === 'sent').length;
          return { sent: count === preview.messages.length, sentCount: count, unknownCount: preview.messages.length - count, automaticResendBlocked: true };
        });
      } catch (error) { return { ...blocked(error), ...(mode === 'send' ? { automaticResendBlocked: true } : {}) }; }
    },
  };
}
