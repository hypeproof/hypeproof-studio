import type { SdkMcpFactory, ZodLike, McpToolResult } from './browserMcp.ts';
import { GoogleSheetReadError, validateEmailRecipe, type EmailPreview, type GoogleAutomationRuntime } from './googleAutomation.ts';
import { AppsScriptRecoveryError } from './appsScriptRuntime.ts';
import { AutomationPublicationWithdrawnError } from './automationStoreClient.ts';

export const GOOGLE_AUTOMATION_MCP_SERVER = 'hypeproof_email';
export const GOOGLE_AUTOMATION_MCP_TOOLS = ['mcp__hypeproof_email__sheet_read','mcp__hypeproof_email__email_preview','mcp__hypeproof_email__email_send','mcp__hypeproof_email__ask_user','mcp__hypeproof_email__skill_save','mcp__hypeproof_email__google_connect','mcp__hypeproof_email__sheet_configure','mcp__hypeproof_email__skill_publish','mcp__hypeproof_email__skill_list','mcp__hypeproof_email__skill_install','mcp__hypeproof_email__workflow_plan','mcp__hypeproof_email__skill_unpublish'] as const;
export const APPS_SCRIPT_MCP_TOOLS = ['mcp__hypeproof_email__apps_script_prepare','mcp__hypeproof_email__apps_script_upload','mcp__hypeproof_email__apps_script_setup','mcp__hypeproof_email__apps_script_deploy','mcp__hypeproof_email__apps_script_run'] as const;
export const ALL_AUTOMATION_MCP_TOOLS = [...GOOGLE_AUTOMATION_MCP_TOOLS, ...APPS_SCRIPT_MCP_TOOLS] as const;

const storeReplyGuidance = ' 공유 범위는 같은 수업 참가자뿐이다. visibility=cohort는 우리 반 공유이며 인터넷 전체 공개·공개 스토어·공개 게시라고 설명하지 않는다. 사용자에게는 스킬 이름과 실제 결과를 자연스러운 한국어로 설명한다. mine·id·approvalConfirmed·published·unpublished 같은 내부 필드명, 불리언 값이나 게시물 식별번호를 답변에 옮기지 않는다. contentsCompared=false인 목록은 버전 본문을 비교한 결과가 아니므로 같은 내용이라고 단정하지 않는다. cancelled=true는 작업이 확정되지 않았다는 결과다. 카드가 열리지 않았다거나 연결 오류라고 추측하지 말고, 완료되지 않았음을 짧게 알린 뒤 새 요청을 기다린다. 자동 재시도하지 않는다.';

const skillRecipeContract = 'recipe는 다음 필드만 가진 JSON 문자열이다: {"schema":"hps-email-automation/1","category":"email","title":"스킬 제목","description":"업무 설명","subjectTemplate":"{{name}}님 서류 제출 요청","bodyTemplate":"{{document}}를 {{dueDate}}까지 보내 주세요.","columns":{"email":"이메일","name":"이름","document":"서류","dueDate":"마감일"}}. title·description·subjectTemplate·bodyTemplate과 열 이름은 사용자 업무에 맞게 바꾼다. 템플릿 변수는 {{name}}, {{document}}, {{dueDate}}만 허용한다.';

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
  publishSkill?(parentId?: string): Promise<unknown>;
  unpublishSkill?(id: string): Promise<unknown>;
  listSkills?(id?: string): Promise<unknown>;
  installSkill?(id: string): Promise<unknown>;
}

/** Registration and every invocation require the Service-granted capability. */
export function buildGoogleAutomationMcpServer(factory: SdkMcpFactory, z: ZodLike, host: GoogleAutomationMcpHost): unknown | undefined {
  if (!host.isAllowed()) return undefined;
  // Keep the base tool contract for existing SDK clients, but an opted-in turn
  // must not silently switch execution engines if its Script grant is revoked.
  const optionalId = () => {
    const schema = z.string() as { optional?: () => unknown };
    return typeof schema.optional === 'function' ? schema.optional() : schema;
  };
  const readOptionalId = (value: unknown) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid skill');
    return value;
  };
  const appsScriptSession = host.isAppsScriptAllowed?.() === true;
  const legacyRouting = (mode: 'preview' | 'send') => ({
    recoveryRequired: true,
    nextTool: 'apps_script_run',
    arguments: { mode },
    previewCreated: false,
    sent: false,
    message: `No preview or email was produced. This activity runs on Google Apps Script. Call apps_script_run using its registered automation tool name with mode="${mode}". Follow its setup/recovery result; never claim completion or fall back to email_preview/email_send. Sending still requires the host's exact-recipient/content approval.`,
  });
  const run = async (work: () => Promise<unknown>, failureStage?: 'skill_save' | 'google_connect'): Promise<McpToolResult> => {
    try {
      if (host.refreshAuthorization && !await host.refreshAuthorization()) throw new Error('Capability unavailable');
      if (!host.isAllowed()) throw new Error('Capability unavailable');
      return { content: [{ type: 'text', text: JSON.stringify(await work()) }] }; }
    catch (error) {
      if (error instanceof AutomationPublicationWithdrawnError) return { isError: true, content: [{ type: 'text', text: JSON.stringify({
        failureStage: 'skill_publish', reason: 'publication_unpublished', published: false,
        nextAction: 'request_fresh_publication_approval',
        message: '이전에 회수한 공유 요청이에요. 다시 공유하려면 내용을 새로 확인하고 승인해 주세요.',
        guidance: '새 게시물은 아직 만들어지지 않았습니다. Google 연결이나 수업 연결 오류로 설명하지 마세요. 자동 재시도하지 말고 사용자의 새 공유 요청을 기다리세요. 새 요청에서도 비공개 공유 확인이 필요합니다.',
      }) }] };
      if (error instanceof GoogleSheetReadError) return { isError: true, content: [{ type: 'text', text: JSON.stringify({
        failureStage: 'sheet_read', reason: error.reason, nextAction: 'wait_for_user',
        message: error.reason === 'sheet_access_denied'
          ? 'Google에서 현재 계정의 시트 읽기를 거절했어요. 본인 계정으로 읽을 수 있는 시트인지 확인해 주세요.'
          : error.reason === 'sheet_not_found'
            ? '현재 계정으로 해당 시트를 찾을 수 없어요. 비공개 입력에서 주소와 접근 권한을 확인해 주세요.'
            : 'Google 시트 읽기 요청이 완료되지 않았어요. 연결 상태를 확인한 뒤 다시 요청해 주세요.',
        guidance: '시트 읽기 단계의 실패입니다. 입력 창이 열리지 않았다고 설명하거나 계정 권한·공유 설정을 자동 변경하지 마세요. 새 읽기 결과나 메일 미리보기가 만들어졌다고 주장하지 마세요.',
      }) }] };
      if (failureStage === 'skill_save') return { isError: true, content: [{ type: 'text', text: JSON.stringify({
        failureStage, reason: 'skill_save_unconfirmed', saved: false,
        nextAction: 'check_recipe_and_activity',
        message: '스킬 저장 성공을 확인하지 못했어요. 입력 형식과 현재 수업의 자동화 권한을 확인하세요.',
        recipeContract: skillRecipeContract,
        guidance: '이 단계는 Google 연결·시트 읽기·실행 준비·게시 승인이 필요하지 않습니다. 그 도구로 우회하지 마세요. 형식 오류는 위 계약으로 고쳐 skill_save를 다시 호출하고, 수업 권한 문제라면 멈추고 수업 연결을 확인하세요. 사용자에게 JSON 작성을 요구하거나 오류에 실제 입력·계정 값을 옮기지 마세요.',
      }) }] };
      if (failureStage === 'google_connect') {
        const recovery = error instanceof AppsScriptRecoveryError ? error.recovery : 'check_connection';
        const callbackIncomplete = error instanceof AppsScriptRecoveryError && error.reason === 'oauth_callback_incomplete';
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({
          failureStage, reason: callbackIncomplete ? 'oauth_callback_incomplete' : 'google_connection_unconfirmed',
          connectionConfirmed: false, nextAction: 'wait_for_user', recovery,
          message: callbackIncomplete
            ? '로그인 요청 이후 Google의 완료 응답을 받지 못했어요. 준비되면 새 요청으로 다시 연결해 주세요.'
            : recovery === 'operator'
              ? 'Google 연결 설정을 운영자가 확인해야 해요. 설정 확인 전에는 로그인을 반복하지 마세요.'
              : '이번 Google 연결 완료를 확인하지 못했어요. 연결 상태를 확인한 뒤 다시 요청해 주세요.',
          guidance: 'Google 연결 단계의 실패입니다. 확인된 결과만 설명하고, 로그인 창이 열리지 않았다거나 사용자가 창을 닫았다고 추정하지 마세요. 계정·권한·기존 연결 상태나 스킬 변경을 추정하지 마세요. 자동으로 로그인·시트 읽기·미리보기·발송을 재시도하지 말고 사용자의 다음 요청을 기다리세요.',
        }) }] };
      }
      return { isError: true, content: [{ type: 'text', text: '자동화를 완료하지 못했어요. 입력과 수업 연결을 확인한 뒤 다시 시도해 주세요. 이미 보낸 메일은 다시 보내지 않아요.' }] };
    }
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
    factory.tool('ask_user', '사용자의 업무 의도나 선택 중 필요한 한 가지만 묻는 공개 대화 카드다. 답변은 저장·게시·발송의 실행 결과나 승인이 아니다. 게시 요청은 skill_publish가 직접 여는 비공개 검토를 사용한다. 비공개 입력이라고 적어도 비공개가 되지 않는다. 시트 주소·명단은 sheet_configure(mode=reuse), Google 계정 연결은 google_connect(mode=reuse)를 호출한다. 이 도구가 recoveryRequired를 반환하면 질문을 다시 쓰지 말고 nextTool을 호출한다.', { question: z.string(), choices: z.string(), allowFreeText: z.string() }, async args => run(async () => {
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
    factory.tool('skill_save', '대화에서 이해한 업무에 맞춰 만든 재사용 이메일 스킬을 로컬에 저장한다. 수정할 때도 이 도구를 실제 호출하고 saved=true를 받은 뒤에만 저장 완료라고 말한다. 대화에 JSON이나 변경 내용을 적는 것만으로 저장되지 않는다. 사용자가 바꾸라고 한 필드만 수정하고 스킬 제목·설명과 메일 제목을 구분한다. Google 연결이나 게시 승인은 저장의 전제조건이 아니다. 사용자에게 JSON 작성이나 파일 가져오기를 요구하지 않는다. 실제 개인정보·계정·시트 주소를 포함하지 않는다. ' + skillRecipeContract, { recipe: z.string() }, async args => run(async () => {
      if (!host.saveSkill || typeof args.recipe !== 'string' || args.recipe.length > 32768) throw new Error('Invalid skill');
      return host.saveSkill(validateEmailRecipe(JSON.parse(args.recipe)));
    }, 'skill_save')),
    factory.tool('google_connect', 'mode=reuse는 기존 Google 연결을 재사용하고 필요할 때만 동의를 묻는다. 다른 계정으로 바꾸려는 명시적 요청에만 mode=change를 쓴다. 계정 값은 반환하지 않는다. 실패하면 반환된 단계와 복구 안내만 설명하고 사용자의 다음 요청을 기다린다.', { mode: z.string() }, async args => run(async () => { if (!host.connectGoogle || !['reuse','change'].includes(String(args.mode))) throw new Error('Unavailable'); return host.connectGoogle(args.mode as 'reuse' | 'change'); }, 'google_connect')),
    factory.tool('sheet_configure', 'mode=reuse는 기존 비공개 시트 설정을 재사용하며 없을 때만 주소를 묻는다. 시트를 바꾸려는 명시적 요청에만 mode=change를 쓴다. 행 수와 열 이름만 반환한다.', { mode: z.string() }, async args => run(async () => { if (!host.configureSheet || !['reuse','change'].includes(String(args.mode))) throw new Error('Unavailable'); return host.configureSheet(args.mode as 'reuse' | 'change'); })),
    factory.tool('skill_publish', '새 게시에는 parentId를 생략한다. 다른 사람에게 받은 스킬을 내 새 스킬로 공유할 때도 빈 인자 {}를 사용한다. 원본 출처는 호스트가 보존한 sourceId로 처리하므로 parentId에 넣지 않는다. 기존 본인 스킬의 새 버전은 목록에서 확인한 최신 id를 parentId로 지정한다. 과거 버전을 덮어쓰거나 다른 사람에게 자동 적용하지 않는다. 이 도구를 호출하면 호스트가 현재 저장한 스킬의 비공개 공유 검토 카드를 직접 열고 승인된 내용만 우리 반 스토어에 올린다. ask_user로 게시 검토를 대체하지 않는다. 이 도구의 published=true 결과 전에는 게시 완료라고 말하지 않는다. 단순 저장·실행 동의를 게시 동의로 취급하지 않는다. published=true와 approvalConfirmed=true는 비공개 카드에서 이번 게시 승인을 받고 저장까지 완료했다는 결과다. 이 경우 승인 여부를 다시 묻거나 확인하지 못했다고 말하지 않는다. 이후 게시나 메일 발송까지 승인된 것은 아니다.' + storeReplyGuidance, { parentId: optionalId() }, async args => run(async () => { if (!host.publishSkill) throw new Error('Unavailable'); return host.publishSkill(readOptionalId(args.parentId)); })),
    factory.tool('skill_unpublish', '사용자가 철회를 요청한 본인 게시물만 내린다. skill_list의 mine=true인 정확한 id를 사용하며, 호스트 카드에서 해당 게시물의 철회를 별도로 확인받는다. 이미 설치한 복사본·Google 연결·발송 기록은 삭제하거나 취소하지 않는다. unpublished=true일 때만 게시 철회 완료를 알린다. 실패하거나 결과가 불명확하면 목록을 다시 확인하고 자동으로 철회를 재시도하지 않는다.' + storeReplyGuidance, { id: z.string() }, async args => run(async () => { if (!host.unpublishSkill || typeof args.id !== 'string' || !args.id || args.id.length > 200) throw new Error('Invalid skill'); return host.unpublishSkill(args.id); })),
    factory.tool('skill_list', 'id를 생략하면 우리 반 스토어의 최신 스킬 목록을 보여준다. 제목만 알면 먼저 id 없이 조회한다. id에는 실제 목록 결과의 식별자만 쓰며 제목을 넣거나 사용자에게 내부 식별자를 요구하지 않는다. id를 넣으면 해당 스킬의 버전 목록을 조회한다. 목록은 요약 정보이므로 제목·설명이 같다는 이유로 버전 내용이 같다고 판단하지 않는다. 업데이트나 이전 버전 복원을 원하면 먼저 버전 목록을 보여주고 사용자가 선택한 정확한 id를 skill_install에 전달한다. 설치는 skill_install로 별도 확인한다.' + storeReplyGuidance, { id: optionalId() }, async args => run(async () => {
      if (!host.listSkills) throw new Error('Unavailable');
      const id = readOptionalId(args.id);
      try { return await host.listSkills(id); }
      catch {
        // Only a failed authorized lookup reaches this recovery. Do not echo
        // provider errors or mistake an unknown cause for invalid identity.
        return {
          recoveryRequired: true, failureStage: id ? 'store_versions' : 'store_catalogue',
          listReturned: false,
          ...(id ? { nextTool: 'skill_list', arguments: {} } : { nextAction: 'wait_for_user' }),
          guidance: id
            ? '버전 조회 결과를 확인하지 못했습니다. 이 복구 흐름에서 id 없는 skill_list로 최신 목록을 한 번 확인하세요. 실제 결과에서 해당 스킬을 찾은 경우에만 그 id로 버전을 조회하세요. 다시 실패하거나 찾지 못하면 멈추세요. 사용자에게 내부 식별자를 요구하거나 원인·내용·설치 완료를 추측하지 마세요.'
            : '스토어 목록을 확인하지 못했습니다. 자동 재시도하지 말고 다음 요청을 기다리세요. 계정·시트 연결을 변경하거나 설치·게시·발송으로 우회하지 마세요.',
        };
      }
    })),
    factory.tool('skill_install', '사용자가 고른 스킬의 내용과 설치를 확인받고 로컬에 저장한다. Google 계정·실제 명단·발송 권한은 가져오지 않는다.' + storeReplyGuidance, { id: z.string() }, async args => run(async () => { if (!host.installSkill || typeof args.id !== 'string' || !args.id || args.id.length > 200) throw new Error('Invalid skill'); return host.installSkill(args.id); })),
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
