import { createHash } from 'node:crypto';
import { AppsScriptBlockedError, AppsScriptRecoveryError, generateAppsScriptEmailProject, type AppsScriptRuntime, type AppsScriptDeployment } from './appsScriptRuntime';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';
import type { EmailRecipe, EmailPreview, SendRecord } from './googleAutomation';
import type { AutomationQuestion, AutomationAnswer } from './automationProtocol';

interface ProjectReceipt { scriptId: string; connectionIdentity: string; uploadedDigest?: string; deployment?: AppsScriptDeployment; sendOrigins?: Record<string, string> }
interface Deps {
  runtime: AppsScriptRuntime;
  maxRecipients: number;
  allowed(): Promise<boolean>;
  recipe(): EmailRecipe;
  ask(question: Omit<AutomationQuestion, 'id'>): Promise<AutomationAnswer>;
  load(): Promise<ProjectReceipt | undefined>;
  save(value: ProjectReceipt): Promise<void>;
  sheet(): Promise<{ spreadsheetId: string; range: string; connection: string } | null>;
  lock<T>(work: () => Promise<T>): Promise<T>;
  ledger: { load(): Promise<Record<string, SendRecord>>; save(value: Record<string, SendRecord>): Promise<void> };
  openBrowser(url: string): PromiseLike<unknown>;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Private project IDs and actual mail data never leave these host callbacks. */
export function createAppsScriptHost(deps: Deps): Pick<GoogleAutomationMcpHost, 'appsScriptPrepare' | 'appsScriptUpload' | 'appsScriptSetup' | 'appsScriptDeploy' | 'appsScriptRun'> {
  let lastPreview: EmailPreview | undefined;
  let resumeTool = 'apps_script_upload';
  let recoveryReason: string | undefined;
  const bundle = () => generateAppsScriptEmailProject(deps.recipe(), deps.maxRecipients);
  const allowed = async () => { if (!await deps.allowed()) throw new Error('Apps Script capability unavailable'); };
  const blocked = (error: unknown, nextTool: string) => {
    lastPreview = undefined;
    resumeTool = nextTool;
    if (error instanceof AppsScriptBlockedError) {
      recoveryReason = 'Google에서 실행 권한을 확인하지 못했어요. 계정의 API 접근과 스크립트의 Cloud 프로젝트 설정을 확인해 주세요.';
      return { setupRequired: true, reason: recoveryReason, nextTool: 'apps_script_setup', executionVerified: false };
    }
    if (error instanceof AppsScriptRecoveryError) {
      recoveryReason = error.message;
      return { recoveryRequired: true, recovery: error.recovery, reason: recoveryReason,
        nextTool: 'apps_script_setup', executionVerified: false };
    }
    throw error;
  };
  const receipt = async () => {
    const value = await deps.load();
    if (!value || !/^[A-Za-z0-9_-]{10,200}$/.test(value.scriptId) || value.connectionIdentity !== await deps.runtime.getConnectionIdentity()) return undefined;
    return value;
  };
  const checkDigest = (digest: string) => { if (bundle().digest !== digest) throw new Error('스킬이 변경됐어요. 다시 확인해 주세요.'); };
  async function confirm(action: 'upload' | 'deploy', project: ReturnType<typeof bundle>) {
    const answer = await deps.ask({ kind: 'script', private: true,
      title: action === 'upload' ? '이 코드를 내 Google Apps Script에 저장할까요?' : '나만 실행할 수 있는 Google 버전을 만들까요?',
      description: action === 'upload' ? 'Studio가 만든 내 프로젝트에 코드만 저장해요. 기존 스크립트는 수정하지 않아요. 아직 메일은 보내지 않아요.' : '확인한 코드의 고정 버전을 만들어요. 공개 웹앱과 예약 발송은 만들지 않으며, 메일은 미리보기 후 별도로 승인해요.',
      script: { action, digest: project.digest, files: project.files, scopes: [...project.scopes] },
    });
    if (!answer.approved || answer.cancelled) return false;
    await allowed(); checkDigest(project.digest); return true;
  }
  return {
    appsScriptPrepare: async () => { await allowed(); const project = bundle(); lastPreview = undefined; return { prepared: true, digest: project.digest, files: project.files.map(file => file.name), runtime: 'Google Apps Script', uploaded: false }; },
    appsScriptUpload: async () => {
      await allowed(); const project = bundle();
      lastPreview = undefined;
      if (!await confirm('upload', project)) return { cancelled: true };
      try {
        if (!await deps.runtime.isConnected()) {
          const answer = await deps.ask({ kind: 'connect', private: true, title: 'Apps Script용 Google 권한을 추가할까요?', description: '내 스크립트 생성·수정·배포, 시트 읽기, 메일 발송과 Google API 호출 권한이 필요해요. Google 창에서 계정과 권한을 확인하며 이후에는 연결을 재사용해요.' });
          if (!answer.approved || answer.cancelled) return { cancelled: true };
          await deps.lock(() => deps.runtime.connect());
        }
        return await deps.lock(async () => {
          await allowed(); checkDigest(project.digest);
          let saved = await receipt();
          if (!saved) {
            const connectionIdentity = await deps.runtime.getConnectionIdentity();
            if (!connectionIdentity) throw new Error('Google 연결이 필요해요.');
            const created = await deps.runtime.createProject(deps.recipe().title);
            saved = { scriptId: created.scriptId, connectionIdentity };
            await deps.save(saved);
          }
          const result = await deps.runtime.uploadProject(saved.scriptId, project, project.digest);
          await deps.save({ ...saved, deployment: undefined, uploadedDigest: result.digest });
          recoveryReason = undefined; resumeTool = 'apps_script_deploy';
          return { uploaded: true, digest: result.digest, deployed: false };
        });
      } catch (error) { return blocked(error, 'apps_script_upload'); }
    },
    appsScriptSetup: async () => {
      await allowed();
      const recoveryPreview = lastPreview;
      lastPreview = undefined;
      const saved = await receipt();
      const legacyCandidates = async () => {
        if (!saved?.deployment || !recoveryPreview || !deps.runtime.getPreview(recoveryPreview.id) || saved.deployment.digest !== bundle().digest) return [];
        const records = await deps.ledger.load(), account = saved.connectionIdentity.split(':')[0];
        return recoveryPreview.messages.map(message => ({ id: message.id, key: hash(`${account}:${message.id}`) }))
          .filter(({id,key}) => records[key]?.id === id && ['sending','unknown'].includes(records[key]!.status) && !saved.sendOrigins?.[key]);
      };
      const legacy = await deps.lock(legacyCandidates);
      const choices = [
        { id: 'retry', label: '설정을 확인했어요 · 이어서 진행' },
        { id: 'account', label: 'Google 계정의 API 접근 설정' },
        ...(saved ? [{ id: 'settings', label: '내 스크립트의 Cloud 프로젝트 설정' }] : []),
        { id: 'reconnect', label: 'Google 권한 다시 연결하기' },
        ...(legacy.length ? [{ id: 'reconcile', label: '이전 발송 기록 확인' }] : []),
      ];
      const answer = await deps.ask({ kind: 'choice', private: true, title: 'Google 연결을 어디서 이어갈까요?',
        description: [recoveryReason, '계정 설정에서 Apps Script API 접근을 켜 주세요. 스크립트는 Studio와 같은 표준 Cloud 프로젝트가 필요해요. 프로젝트 번호나 권한이 없다면 운영자에게 확인해 주세요. 설정 후 여기로 돌아오면 이어갈 수 있어요.'].filter(Boolean).join('\n\n'),
        choices, allowFreeText: false });
      if (answer.cancelled) return { cancelled: true };
      await allowed();
      if (!choices.some(choice => choice.id === answer.choiceId)) return { cancelled: true };
      if (answer.choiceId === 'reconcile' && saved?.deployment && recoveryPreview) {
        const proof = await deps.ask({ kind: 'text', private: true, title: '이전 발송을 시도한 스크립트 ID를 입력해 주세요',
          description: 'Google Apps Script의 이전 실행 기록을 열어, 그 프로젝트의 스크립트 ID를 복사해 주세요. 현재 프로젝트와 일치하고 Google에 발송 시도 기록이 없을 때만 연결 정보를 복구해요. 메일은 보내지 않으며 다시 미리보기와 발송 승인이 필요해요.' });
        if (proof.cancelled) return { cancelled: true };
        const historicalId = proof.text?.trim();
        if (!historicalId || !/^[A-Za-z0-9_-]{10,200}$/.test(historicalId) || historicalId !== saved.scriptId || historicalId !== saved.deployment.scriptId) return { reconciled: false, originalProjectRequired: true, automaticResendBlocked: true };
        return deps.lock(async () => {
          await allowed();
          const fresh = await receipt(), records = await deps.ledger.load();
          if (!fresh?.deployment || JSON.stringify(fresh.deployment) !== JSON.stringify(saved.deployment) || fresh.scriptId !== historicalId || fresh.connectionIdentity !== saved.connectionIdentity || !deps.runtime.getPreview(recoveryPreview.id) || bundle().digest !== fresh.deployment.digest || legacy.some(({id,key}) => records[key]?.id !== id || !['sending','unknown'].includes(records[key]!.status) || fresh.sendOrigins?.[key])) return { reconciled: false, previousAttempt: true, automaticResendBlocked: true };
          let remote;
          try { remote = await deps.runtime.getSendStatus(fresh.deployment, legacy.map(item => item.id)); }
          catch { return { reconciled: false, remoteStatusUnavailable: true, automaticResendBlocked: true }; }
          if (remote.records.length !== legacy.length || remote.records.some((record,i) => record.id !== legacy[i]!.id || record.status !== 'not_attempted')) return { reconciled: false, previousAttempt: true, automaticResendBlocked: true };
          const sendOrigins = { ...fresh.sendOrigins };
          legacy.forEach(({key}) => { sendOrigins[key] = historicalId; });
          await deps.save({ ...fresh, sendOrigins });
          return { reconciled: true, count: legacy.length, previewRequired: true, nextTool: 'apps_script_run', mode: 'preview', mailSent: false, automaticResendBlocked: true };
        });
      }
      if (answer.choiceId === 'retry') return { retryRequired: true, nextTool: resumeTool, ...(resumeTool === 'apps_script_run' ? { mode: 'preview' } : {}), executionVerified: false };
      if (answer.choiceId === 'reconnect') {
        try {
          await deps.lock(() => deps.runtime.connect()); recoveryReason = undefined;
          return { connected: true, uploadRequired: true, nextTool: 'apps_script_upload', executionVerified: false };
        } catch (error) { return blocked(error, 'apps_script_upload'); }
      }
      const url = answer.choiceId === 'settings' && saved ? `https://script.google.com/home/projects/${saved.scriptId}/settings` : 'https://script.google.com/home/usersettings';
      const opened = await deps.openBrowser(url);
      return { setupRequired: true, opened: opened !== false, nextTool: 'apps_script_setup', executionVerified: false };
    },
    appsScriptDeploy: async () => {
      await allowed(); const project = bundle();
      lastPreview = undefined;
      const saved = await receipt();
      if (!saved || saved.uploadedDigest !== project.digest) return { uploadRequired: true };
      if (!await confirm('deploy', project)) return { cancelled: true };
      try {
        return await deps.lock(async () => {
          await allowed(); checkDigest(project.digest);
          const fresh = await receipt();
          if (!fresh || fresh.scriptId !== saved.scriptId || fresh.uploadedDigest !== project.digest) throw new Error('Google 프로젝트가 변경됐어요.');
          const deployment = await deps.runtime.deployProject(saved.scriptId, project, project.digest);
          await deps.save({ ...fresh, deployment }); lastPreview = undefined;
          recoveryReason = undefined; resumeTool = 'apps_script_run';
          return { deployed: true, versionNumber: deployment.versionNumber, access: 'MYSELF', executionVerified: false };
        });
      } catch (error) { return blocked(error, 'apps_script_deploy'); }
    },
    appsScriptRun: async mode => {
      await allowed(); const project = bundle(), saved = await receipt();
      if (!saved?.deployment || saved.deployment.digest !== project.digest) return { deploymentRequired: true };
      const deployment = saved.deployment;
      try {
        if (mode === 'preview') {
          lastPreview = undefined;
          const sheet = await deps.sheet();
          if (!sheet) return { sheetConfigurationRequired: true };
          if (sheet.connection !== saved.connectionIdentity) return { sameGoogleAccountRequired: true };
          const preview = await deps.lock(() => deps.runtime.preview(deployment, sheet));
          await allowed(); checkDigest(project.digest); lastPreview = preview;
          recoveryReason = undefined;
          const answer = await deps.ask({ kind: 'preview_review', private: true, title: 'Google에서 만든 메일을 확인해 주세요',
            description: '받는 사람과 제목·본문을 미리 확인해요. 확인하거나 닫아도 메일은 보내지 않아요.', preview });
          await allowed(); checkDigest(project.digest);
          if (saved.connectionIdentity !== await deps.runtime.getConnectionIdentity()) { lastPreview = undefined; return { sameGoogleAccountRequired: true }; }
          return { previewed: true, count: preview.messages.length, reviewed: answer.approved === true && !answer.cancelled,
            dismissed: answer.cancelled === true, nextAction: 'wait_for_user', confirmationRequired: true, mailSent: false };
        }
        const preview = lastPreview;
        if (!preview || !deps.runtime.getPreview(preview.id)) return { previewRequired: true };
        const account = saved.connectionIdentity.split(':')[0];
        const keys = preview.messages.map(message => hash(`${account}:${message.id}`));
        // A missing remote record proves nothing for another script or legacy
        // Gmail attempt. Require durable original-project provenance first.
        const recoverable = await deps.lock(async () => {
          const records = await deps.ledger.load(), fresh = await receipt();
          const prior = keys.filter(key => records[key]);
          if (!prior.length) return new Map<string, string>();
          if (!fresh?.deployment || JSON.stringify(fresh.deployment) !== JSON.stringify(deployment) || prior.some(key => !['sending','unknown'].includes(records[key]!.status) || fresh.sendOrigins?.[key] !== deployment.scriptId)) return null;
          let remote;
          try { remote = await deps.runtime.getSendStatus(deployment, prior.map(key => records[key]!.id)); }
          catch { return null; }
          if (remote.records.some(record => record.status !== 'not_attempted')) return null;
          return new Map(prior.map(key => [key, JSON.stringify(records[key])]));
        });
        if (!recoverable) return { sent: false, previousAttempt: true, automaticResendBlocked: true, nextTool: 'apps_script_setup' };
        const answer = await deps.ask({ kind: 'preview', private: true, title: `${preview.messages.length}명에게 Google에서 발송할까요?`, description: '받는 사람과 제목·본문을 모두 확인해 주세요. 승인하면 Google Apps Script가 이 내용 그대로 발송해요.', preview });
        if (!answer.approved || answer.cancelled) return { cancelled: true };
        await allowed(); checkDigest(project.digest);
        lastPreview = undefined;
        return await deps.lock(async () => {
          const fresh = await receipt();
          if (!fresh?.deployment || JSON.stringify(fresh.deployment) !== JSON.stringify(deployment)) throw new Error('배포가 변경됐어요.');
          const records = await deps.ledger.load();
          if (keys.some(key => records[key] && (recoverable.get(key) !== JSON.stringify(records[key]) || fresh.sendOrigins?.[key] !== deployment.scriptId))) return { sent: false, previousAttempt: true, automaticResendBlocked: true };
          const sendOrigins = { ...fresh.sendOrigins };
          keys.forEach(key => { sendOrigins[key] = deployment.scriptId; });
          await deps.save({ ...fresh, sendOrigins });
          preview.messages.forEach((message, i) => { records[keys[i]!] = { id: message.id, status: 'sending' }; });
          await deps.ledger.save(records);
          const result = await deps.runtime.sendApproved(deployment, preview.id, true);
          preview.messages.forEach((message, i) => { records[keys[i]!] = result.records.find(record => record.id === message.id) ?? { id: message.id, status: 'unknown' }; });
          await deps.ledger.save(records);
          const count = result.records.filter(record => record.status === 'sent').length;
          return { sent: count === preview.messages.length, sentCount: count, unknownCount: preview.messages.length - count, automaticResendBlocked: true };
        });
      } catch (error) {
        const recovery = blocked(error, 'apps_script_run');
        return mode === 'send' ? { ...recovery, automaticResendBlocked: true } : recovery;
      }
    },
  };
}
