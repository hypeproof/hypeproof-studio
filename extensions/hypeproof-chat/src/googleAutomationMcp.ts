import type { SdkMcpFactory, ZodLike, McpToolResult } from './browserMcp.ts';
import { validateEmailRecipe, type EmailPreview, type GoogleAutomationRuntime } from './googleAutomation.ts';

export const GOOGLE_AUTOMATION_MCP_SERVER = 'hypeproof_email';
export const GOOGLE_AUTOMATION_MCP_TOOLS = ['mcp__hypeproof_email__sheet_read','mcp__hypeproof_email__email_preview','mcp__hypeproof_email__email_send','mcp__hypeproof_email__ask_user','mcp__hypeproof_email__skill_save','mcp__hypeproof_email__google_connect','mcp__hypeproof_email__sheet_configure','mcp__hypeproof_email__skill_publish','mcp__hypeproof_email__skill_list','mcp__hypeproof_email__skill_install','mcp__hypeproof_email__workflow_plan'] as const;
export const APPS_SCRIPT_MCP_TOOLS = ['mcp__hypeproof_email__apps_script_prepare','mcp__hypeproof_email__apps_script_upload','mcp__hypeproof_email__apps_script_setup','mcp__hypeproof_email__apps_script_deploy','mcp__hypeproof_email__apps_script_run'] as const;
export const ALL_AUTOMATION_MCP_TOOLS = [...GOOGLE_AUTOMATION_MCP_TOOLS, ...APPS_SCRIPT_MCP_TOOLS] as const;

/** Reject explicit private-value collection, not business questions about email. */
function privateSetupTool(question: string): 'sheet_configure' | 'google_connect' | undefined {
  const text = question.normalize('NFKC').toLowerCase();
  // Asking how a template should read or which columns it uses remains a public
  // business question, even when its example copy mentions a link or address.
  if (/(?:제목|본문|문구|템플릿|열 이름|subject|body|wording|template|column).*(?:어떻게|어떤|무엇|할까요|넣을까요|쓸까요|바꿀까요|what|which|should|prefer)/u.test(text)) return undefined;
  const sheet = /(?:구글\s*)?시트\s*(?:주소|링크|url|id|아이디)|(?:스프레드시트|spreadsheet|google\s*sheet(?:s)?)\s*(?:주소|링크|url|link|id)/u;
  const account = /(?:구글|google)\s*계정(?:\s*(?:주소|이메일|email|id))?|(?:계정|로그인|발신자)\s*(?:주소|이메일|email|id)|(?:이메일|메일|email)\s*(?:주소|address)|google\s*account/u;
  const collect = /입력|붙여\s*넣|붙여넣|알려\s*주|보내\s*주|공유해|제공해|적어\s*주|어디인가요|무엇인가요|\b(?:enter|paste|provide|type|share|what\s+is)\b|비공개\s*입력/u;
  if (!collect.test(text)) return undefined;
  if (sheet.test(text)) return 'sheet_configure';
  if (account.test(text)) return /수신자|받는\s*사람|recipient/u.test(text) ? 'sheet_configure' : 'google_connect';
  return undefined;
}

export interface GoogleAutomationMcpHost {
  runtime: GoogleAutomationRuntime;
  workflowPlan?(plan: unknown): Promise<unknown>;
  isAppsScriptAllowed?(): boolean;
  isSharedRunner?(): boolean;
  appsScriptPrepare?(): Promise<unknown>;
  appsScriptUpload?(): Promise<unknown>;
  appsScriptSetup?(): Promise<unknown>;
  appsScriptDeploy?(): Promise<unknown>;
  appsScriptRun?(mode: 'preview' | 'send'): Promise<unknown>;
  isAllowed(): boolean;
  refreshAuthorization?(): Promise<boolean>;
  confirmSend(preview: EmailPreview): Promise<boolean>;
  isAwaitingUser?(): boolean;
  cancelPendingQuestion?(): void;
  askUser?(args: { question: string; choices: Array<{ id: string; label: string }>; allowFreeText: boolean }): Promise<unknown>;
  saveSkill?(recipe: import('./googleAutomation').EmailRecipe): Promise<unknown>;
  connectGoogle?(mode?: 'reuse' | 'change'): Promise<unknown>;
  configureSheet?(mode?: 'reuse' | 'change'): Promise<unknown>;
  readConfiguredSheet?(): Promise<unknown>;
  previewSavedSkill?(): Promise<EmailPreview>;
  publishSkill?(): Promise<unknown>;
  listSkills?(): Promise<unknown>;
  installSkill?(id: string): Promise<unknown>;
}

/** Registration and every invocation require the Service-granted capability. */
export function buildGoogleAutomationMcpServer(factory: SdkMcpFactory, z: ZodLike, host: GoogleAutomationMcpHost): unknown | undefined {
  if (!host.isAllowed()) return undefined;
  // Keep the base tool contract for existing SDK clients, but an opted-in turn
  // must not silently switch execution engines if its Script grant is revoked.
  const appsScriptSession = host.isAppsScriptAllowed?.() === true;
  const legacyRouting = (mode: 'preview' | 'send') => ({
    recoveryRequired: true,
    nextTool: 'apps_script_run',
    arguments: { mode },
    previewCreated: false,
    sent: false,
    message: `No preview or email was produced. This activity runs on Google Apps Script. Call apps_script_run using its registered automation tool name with mode="${mode}". Follow its setup/recovery result; never claim completion or fall back to email_preview/email_send. Sending still requires the host's exact-recipient/content approval.`,
  });
  const run = async (work: () => Promise<unknown>): Promise<McpToolResult> => {
    try {
      if (host.refreshAuthorization && !await host.refreshAuthorization()) throw new Error('Capability unavailable');
      if (!host.isAllowed()) throw new Error('Capability unavailable');
      return { content: [{ type: 'text', text: JSON.stringify(await work()) }] }; }
    catch { return { isError: true, content: [{ type: 'text', text: '자동화를 완료하지 못했어요. 입력과 수업 연결을 확인한 뒤 다시 시도해 주세요. 이미 보낸 메일은 다시 보내지 않아요.' }] }; }
  };
  const scriptRun = (work: () => Promise<unknown>) => run(async () => {
    if (!host.isAppsScriptAllowed?.()) throw new Error('Apps Script capability unavailable');
    return work();
  });
  return factory.createSdkMcpServer({ name: GOOGLE_AUTOMATION_MCP_SERVER, version: '1.0.0', tools: [
    factory.tool('workflow_plan', '업무의 실행 흐름을 그래픽 영역에 표시한다. plan은 title,nodes 배열 JSON이고 각 node는 id,label,dependsOn으로 구성한다. 기본 ID는 goal,skill,connect,sheet,prepare,preview,send,publish다. prepare는 skill과 connect에, preview는 prepare와 sheet에 의존한다. send와 publish는 preview 뒤의 독립 선택 단계다. upload와 deploy는 이전 흐름 호환용이며 새 계획에 넣지 않는다. 완료 상태는 host가 실제 결과로 표시하며 AI는 설정하지 않는다.', { plan: z.string() }, async args => run(async () => {
      if (!host.workflowPlan || typeof args.plan !== 'string' || args.plan.length > 12000) throw new Error('Invalid plan');
      return host.workflowPlan(JSON.parse(args.plan));
    })),
    ...(appsScriptSession ? [
      factory.tool('apps_script_prepare', '저장한 이메일 스킬과 현재 Google 연결로 Studio 공통 실행기를 사용할 준비를 확인한다. 개인 프로젝트·코드 업로드·배포 설정은 필요 없다. 준비 성공은 메일 미리보기나 발송 성공이 아니다.', {}, async () => scriptRun(async () => { if (!host.appsScriptPrepare) throw new Error('Unavailable'); return host.appsScriptPrepare(); })),
      factory.tool('apps_script_upload', '이전 클라이언트 호환용이다. 공통 실행기에서는 개인 코드를 업로드하지 않는다. 새 흐름은 apps_script_prepare 다음 apps_script_run(mode=preview)으로 진행하고 반환된 nextTool을 따른다. uploaded=false를 코드 저장 성공으로 표현하지 않는다.', {}, async () => scriptRun(async () => { if (!host.appsScriptUpload) throw new Error('Unavailable'); return host.appsScriptUpload(); })),
      factory.tool('apps_script_setup', 'Google 연결 문제의 비공개 복구 카드를 연다. 필요하면 연결을 다시 허용하고 실제 실행을 재시도한다. 공통 실행기의 운영자 설정 문제는 안전한 안내만 표시한다. 수강생에게 Cloud 프로젝트·IAM 권한·Apps Script 편집·API 설정을 요구하지 않는다.', {}, async () => scriptRun(async () => { if (!host.appsScriptSetup) throw new Error('Unavailable'); return host.appsScriptSetup(); })),
      factory.tool('apps_script_deploy', '이전 클라이언트 호환용이다. 공통 실행기는 Studio가 관리하므로 수강생 개인 배포를 만들지 않는다. 반환된 nextTool을 따르며 deployed=false를 배포 성공으로 표현하지 않는다.', {}, async () => scriptRun(async () => { if (!host.appsScriptDeploy) throw new Error('Unavailable'); return host.appsScriptDeploy(); })),
      factory.tool('apps_script_run', 'mode=preview는 내 Google 권한으로 시트를 읽어 비공개 메일 미리보기를 만든다. nextAction=wait_for_user이면 결과를 짧게 알리고 턴을 종료한다. reviewed=true는 발송 승인이 아니다. 사용자가 발송을 요청했을 때만 mode=send를 호출하며 수신자·내용을 별도 카드에서 직접 승인해야 한다. 불명확한 결과는 재발송하지 않는다.', { mode: z.string() }, async args => scriptRun(async () => { if (!host.appsScriptRun || !['preview','send'].includes(String(args.mode))) throw new Error('Unavailable'); return host.appsScriptRun(args.mode as 'preview' | 'send'); })),
    ] : []),
    factory.tool('ask_user', '사용자의 업무 의도나 선택 중 필요한 한 가지만 묻는 공개 대화 카드다. 비공개 입력이라고 적어도 비공개가 되지 않는다. 시트 주소·명단은 sheet_configure(mode=reuse), Google 계정 연결은 google_connect(mode=reuse)를 호출한다. 이 도구가 recoveryRequired를 반환하면 질문을 다시 쓰지 말고 nextTool을 호출한다.', { question: z.string(), choices: z.string(), allowFreeText: z.string() }, async args => run(async () => {
      if (!host.askUser || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 500 || typeof args.choices !== 'string' || args.choices.length > 2000 || !['true','false'].includes(String(args.allowFreeText))) throw new Error('Invalid question');
      const choices = JSON.parse(args.choices);
      if (!Array.isArray(choices) || choices.length > 4 || choices.some(choice => !choice || typeof choice.id !== 'string' || !choice.id || choice.id.length > 40 || typeof choice.label !== 'string' || !choice.label || choice.label.length > 120) || new Set(choices.map(choice => choice.id)).size !== choices.length) throw new Error('Invalid choices');
      const nextTool = privateSetupTool(args.question);
      if (nextTool) return {
        recoveryRequired: true,
        nextTool,
        arguments: { mode: 'reuse' },
        questionDisplayed: false,
        message: `This public question was not shown. Call ${nextTool} using its registered automation tool name with mode="reuse". It privately collects missing setup and reuses existing settings. Do not ask for account values, recipient data or Sheet URLs in chat or ask_user, even if labelled private.`,
      };
      return host.askUser({ question: args.question, choices, allowFreeText: args.allowFreeText === 'true' || !choices.length });
    })),
    factory.tool('skill_save', '대화에서 이해한 업무에 맞춰 만든 재사용 이메일 스킬을 로컬에 저장한다. 사용자에게 JSON 작성이나 파일 가져오기를 요구하지 않는다. 실제 개인정보·계정·시트 주소를 포함하지 않는다.', { recipe: z.string() }, async args => run(async () => {
      if (!host.saveSkill || typeof args.recipe !== 'string' || args.recipe.length > 32768) throw new Error('Invalid skill');
      return host.saveSkill(validateEmailRecipe(JSON.parse(args.recipe)));
    })),
    factory.tool('google_connect', 'mode=reuse는 기존 Google 연결을 재사용하고 필요할 때만 동의를 묻는다. 다른 계정으로 바꾸려는 명시적 요청에만 mode=change를 쓴다. 계정 값은 반환하지 않는다.', { mode: z.string() }, async args => run(async () => { if (!host.connectGoogle || !['reuse','change'].includes(String(args.mode))) throw new Error('Unavailable'); return host.connectGoogle(args.mode as 'reuse' | 'change'); })),
    factory.tool('sheet_configure', 'mode=reuse는 기존 비공개 시트 설정을 재사용하며 없을 때만 주소를 묻는다. 시트를 바꾸려는 명시적 요청에만 mode=change를 쓴다. 행 수와 열 이름만 반환한다.', { mode: z.string() }, async args => run(async () => { if (!host.configureSheet || !['reuse','change'].includes(String(args.mode))) throw new Error('Unavailable'); return host.configureSheet(args.mode as 'reuse' | 'change'); })),
    factory.tool('skill_publish', '현재 저장한 스킬의 공유 내용을 별도 질문으로 확인받은 뒤 우리 반 스토어에 올린다. 단순 저장·실행 동의를 게시 동의로 취급하지 않는다.', {}, async () => run(async () => { if (!host.publishSkill) throw new Error('Unavailable'); return host.publishSkill(); })),
    factory.tool('skill_list', '우리 반 스토어의 스킬 목록을 보여준다. 설치는 skill_install로 별도 확인한다.', {}, async () => run(async () => { if (!host.listSkills) throw new Error('Unavailable'); return host.listSkills(); })),
    factory.tool('skill_install', '사용자가 고른 스킬의 내용과 설치를 확인받고 로컬에 저장한다. Google 계정·실제 명단·발송 권한은 가져오지 않는다.', { id: z.string() }, async args => run(async () => { if (!host.installSkill || typeof args.id !== 'string' || !args.id || args.id.length > 200) throw new Error('Invalid skill'); return host.installSkill(args.id); })),
    factory.tool('sheet_read', '비공개 설정에서 사용자가 연결한 시트만 다시 읽는다. 주소나 범위를 입력으로 받지 않는다. 행 수와 열 이름만 반환한다.', {}, async args => run(async () => {
      if (!host.readConfiguredSheet || Object.keys(args).length) throw new Error('Configure the sheet privately first');
      return host.readConfiguredSheet();
    })),
    factory.tool('email_preview', 'Apps Script 도구가 있는 수업에서는 사용하지 말고 apps_script_run(mode=preview)을 호출한다. 그 외 수업에서는 저장된 스킬과 로컬 시트로 미리보기를 만든다. 변경은 먼저 skill_save로 저장한다. recipe 인자는 이전 클라이언트 호환용이다.', { recipe: z.string() }, async args => run(async () => {
      if (appsScriptSession || host.isAppsScriptAllowed?.() === true) return legacyRouting('preview');
      if (typeof args.recipe !== 'string' || args.recipe.length > 32768 || 'rows' in args) throw new Error('Invalid payload');
      const preview = host.previewSavedSkill
        ? await host.previewSavedSkill()
        : await host.runtime.previewLatestSheet({ recipe: validateEmailRecipe(JSON.parse(args.recipe)) });
      return { previewId: preview.id, count: preview.messages.length, confirmationRequired: true };
    })),
    factory.tool('email_send', 'Apps Script 도구가 있는 수업에서는 사용하지 말고 apps_script_run(mode=send)을 호출한다. 그 외 수업에서는 해당 미리보기 전체를 사용자에게 표시하고 사람이 직접 승인했을 때만 발송한다. AI는 승인을 대신할 수 없다.', { previewId: z.string() }, async args => run(async () => {
      if (appsScriptSession || host.isAppsScriptAllowed?.() === true) return legacyRouting('send');
      const preview = host.runtime.getPreview(String(args.previewId ?? ''));
      if (!preview) throw new Error('Missing preview');
      const approved = await host.confirmSend(preview);
      if (!approved) return { cancelled: true };
      if (!host.isAllowed()) throw new Error('Capability revoked');
      const result = await host.runtime.send({ previewId: preview.id, approved: true });
      const counts = { sent: 0, sending: 0, unknown: 0, failed: 0 };
      for (const record of result.records) counts[record.status]++;
      return { counts, unattempted: Math.max(0, preview.messages.length - result.records.length) };
    })),
  ] });
}
