import type { SdkMcpFactory, ZodLike, McpToolResult } from './browserMcp.ts';
import { validateEmailRecipe, type EmailPreview, type GoogleAutomationRuntime } from './googleAutomation.ts';

export const GOOGLE_AUTOMATION_MCP_SERVER = 'hypeproof_email';
export const GOOGLE_AUTOMATION_MCP_TOOLS = ['mcp__hypeproof_email__sheet_read','mcp__hypeproof_email__email_preview','mcp__hypeproof_email__email_send','mcp__hypeproof_email__ask_user','mcp__hypeproof_email__skill_save','mcp__hypeproof_email__google_connect','mcp__hypeproof_email__sheet_configure','mcp__hypeproof_email__skill_publish','mcp__hypeproof_email__skill_list','mcp__hypeproof_email__skill_install'] as const;
export interface GoogleAutomationMcpHost {
  runtime: GoogleAutomationRuntime;
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
  publishSkill?(): Promise<unknown>;
  listSkills?(): Promise<unknown>;
  installSkill?(id: string): Promise<unknown>;
}

/** Registration and every invocation require the Service-granted capability. */
export function buildGoogleAutomationMcpServer(factory: SdkMcpFactory, z: ZodLike, host: GoogleAutomationMcpHost): unknown | undefined {
  if (!host.isAllowed()) return undefined;
  const run = async (work: () => Promise<unknown>): Promise<McpToolResult> => {
    try {
      if (host.refreshAuthorization && !await host.refreshAuthorization()) throw new Error('Capability unavailable');
      if (!host.isAllowed()) throw new Error('Capability unavailable');
      return { content: [{ type: 'text', text: JSON.stringify(await work()) }] }; }
    catch { return { isError: true, content: [{ type: 'text', text: '자동화를 완료하지 못했어요. 입력과 수업 연결을 확인한 뒤 다시 시도해 주세요. 이미 보낸 메일은 다시 보내지 않아요.' }] }; }
  };
  return factory.createSdkMcpServer({ name: GOOGLE_AUTOMATION_MCP_SERVER, version: '1.0.0', tools: [
    factory.tool('ask_user', '사용자의 업무 의도나 선택 중 필요한 한 가지만 묻는다. 선택지와 직접 입력을 지원한다. 계정·이메일·명단·시트 주소는 묻지 말고 전용 비공개 설정 도구를 쓴다.', { question: z.string(), choices: z.string(), allowFreeText: z.string() }, async args => run(async () => {
      if (!host.askUser || typeof args.question !== 'string' || !args.question.trim() || args.question.length > 500 || typeof args.choices !== 'string' || args.choices.length > 2000 || !['true','false'].includes(String(args.allowFreeText))) throw new Error('Invalid question');
      const choices = JSON.parse(args.choices);
      if (!Array.isArray(choices) || choices.length > 4 || choices.some(choice => !choice || typeof choice.id !== 'string' || !choice.id || choice.id.length > 40 || typeof choice.label !== 'string' || !choice.label || choice.label.length > 120) || new Set(choices.map(choice => choice.id)).size !== choices.length) throw new Error('Invalid choices');
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
    factory.tool('email_preview', '레시피 JSON과 마지막으로 읽은 로컬 시트로 미리보기를 만든다. 시트 행을 입력하지 않는다. 수신자와 내용은 사용자 확인 화면에서만 표시한다.', { recipe: z.string() }, async args => run(async () => {
      if (typeof args.recipe !== 'string' || args.recipe.length > 32768 || 'rows' in args) throw new Error('Invalid payload');
      const preview = await host.runtime.previewLatestSheet({ recipe: validateEmailRecipe(JSON.parse(args.recipe)) });
      return { previewId: preview.id, count: preview.messages.length, confirmationRequired: true };
    })),
    factory.tool('email_send', '해당 미리보기 전체를 사용자에게 표시하고 사람이 직접 승인했을 때만 발송한다. AI는 승인을 대신할 수 없다.', { previewId: z.string() }, async args => run(async () => {
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
