import { createHash } from 'node:crypto';
import { AppsScriptBlockedError, generateAppsScriptEmailProject, type AppsScriptRuntime, type AppsScriptDeployment } from './appsScriptRuntime';
import type { GoogleAutomationMcpHost } from './googleAutomationMcp';
import type { EmailRecipe, EmailPreview, SendRecord } from './googleAutomation';
import type { AutomationQuestion, AutomationAnswer } from './automationProtocol';

interface ProjectReceipt { scriptId: string; connectionIdentity: string; uploadedDigest?: string; deployment?: AppsScriptDeployment }
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
  const bundle = () => generateAppsScriptEmailProject(deps.recipe(), deps.maxRecipients);
  const allowed = async () => { if (!await deps.allowed()) throw new Error('Apps Script capability unavailable'); };
  const blocked = (error: unknown) => {
    if (error instanceof AppsScriptBlockedError) return { setupRequired: true, reason: 'Google API 접근과 Studio OAuth와 같은 표준 Cloud 프로젝트 연결을 확인해 주세요.', nextTool: 'apps_script_setup' };
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
      if (!await confirm('upload', project)) return { cancelled: true };
      lastPreview = undefined;
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
          await deps.save({ scriptId: saved.scriptId, connectionIdentity: saved.connectionIdentity, uploadedDigest: result.digest });
          return { uploaded: true, digest: result.digest, deployed: false };
        });
      } catch (error) { return blocked(error); }
    },
    appsScriptSetup: async () => {
      await allowed();
      const saved = await receipt();
      const answer = await deps.ask({ kind: 'choice', private: true, title: 'Google 실행 설정을 확인할까요?', description: '계정의 Apps Script API 접근을 켜야 해요. 원격 실행에는 Studio 로그인 앱과 스크립트가 같은 표준 Cloud 프로젝트를 사용해야 하며 운영자의 프로젝트 권한 설정이 필요할 수 있어요. 화면을 연 것만으로 설정 완료로 처리하지 않아요.', choices: [{ id: 'settings', label: saved ? '내 스크립트 설정 열기' : 'Apps Script API 접근 설정 열기' }, { id: 'reconnect', label: 'Google 권한 다시 연결하기' }], allowFreeText: false });
      if (answer.cancelled) return { cancelled: true };
      await allowed();
      if (answer.choiceId === 'reconnect') { await deps.lock(() => deps.runtime.connect()); lastPreview = undefined; return { connected: true, executionVerified: false }; }
      await deps.openBrowser(saved ? `https://script.google.com/home/projects/${saved.scriptId}/settings` : 'https://script.google.com/home/usersettings');
      return { setupRequired: true, opened: true, executionVerified: false };
    },
    appsScriptDeploy: async () => {
      await allowed(); const project = bundle();
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
          return { deployed: true, versionNumber: deployment.versionNumber, access: 'MYSELF', executionVerified: false };
        });
      } catch (error) { return blocked(error); }
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
          return { previewed: true, count: preview.messages.length, confirmationRequired: true };
        }
        const preview = lastPreview;
        if (!preview || !deps.runtime.getPreview(preview.id)) return { previewRequired: true };
        const answer = await deps.ask({ kind: 'preview', private: true, title: `${preview.messages.length}명에게 Google에서 발송할까요?`, description: '받는 사람과 제목·본문을 모두 확인해 주세요. 승인하면 Google Apps Script가 이 내용 그대로 발송해요.', preview });
        if (!answer.approved || answer.cancelled) return { cancelled: true };
        await allowed(); checkDigest(project.digest);
        lastPreview = undefined;
        return await deps.lock(async () => {
          const fresh = await receipt();
          if (!fresh?.deployment || JSON.stringify(fresh.deployment) !== JSON.stringify(deployment)) throw new Error('배포가 변경됐어요.');
          const records = await deps.ledger.load(), account = saved.connectionIdentity.split(':')[0];
          const keys = preview.messages.map(message => hash(`${account}:${message.id}`));
          if (keys.some(key => records[key])) return { sent: false, previousAttempt: true, automaticResendBlocked: true };
          preview.messages.forEach((message, i) => { records[keys[i]!] = { id: message.id, status: 'sending' }; });
          await deps.ledger.save(records);
          const result = await deps.runtime.sendApproved(deployment, preview.id, true);
          preview.messages.forEach((message, i) => { records[keys[i]!] = result.records.find(record => record.id === message.id) ?? { id: message.id, status: 'unknown' }; });
          await deps.ledger.save(records);
          const count = result.records.filter(record => record.status === 'sent').length;
          return { sent: count === preview.messages.length, sentCount: count, unknownCount: preview.messages.length - count, automaticResendBlocked: true };
        });
      } catch (error) { return blocked(error); }
    },
  };
}
