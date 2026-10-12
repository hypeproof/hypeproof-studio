import type { SdkMcpFactory, ZodLike, McpToolResult } from './browserMcp.ts';
import { validateEmailRecipe, type EmailPreview, type GoogleAutomationRuntime } from './googleAutomation.ts';

export const GOOGLE_AUTOMATION_MCP_SERVER = 'hypeproof_email';
export const GOOGLE_AUTOMATION_MCP_TOOLS = ['mcp__hypeproof_email__sheet_read','mcp__hypeproof_email__email_preview','mcp__hypeproof_email__email_send'] as const;
export interface GoogleAutomationMcpHost {
  runtime: GoogleAutomationRuntime;
  isAllowed(): boolean;
  refreshAuthorization?(): Promise<boolean>;
  confirmSend(preview: EmailPreview): Promise<boolean>;
}

/** Registration and every invocation require the Service-granted capability. */
export function buildGoogleAutomationMcpServer(factory: SdkMcpFactory, z: ZodLike, host: GoogleAutomationMcpHost): unknown | undefined {
  if (!host.isAllowed()) return undefined;
  const run = async (work: () => Promise<unknown>): Promise<McpToolResult> => {
    try {
      if (host.refreshAuthorization && !await host.refreshAuthorization()) throw new Error('Capability unavailable');
      if (!host.isAllowed()) throw new Error('Capability unavailable');
      return { content: [{ type: 'text', text: JSON.stringify(await work()) }] }; }
    catch { return { isError: true, content: [{ type: 'text', text: '자동화를 완료하지 못했어요. 자동화 화면에서 입력·연결·발송 결과를 확인해 주세요.' }] }; }
  };
  return factory.createSdkMcpServer({ name: GOOGLE_AUTOMATION_MCP_SERVER, version: '1.0.0', tools: [
    factory.tool('sheet_read', '사용자가 지정한 Google 시트를 로컬에 보관하고 행 수와 열 이름만 반환한다. 수신자와 업무 데이터는 AI에 제공하지 않는다.', { spreadsheetId: z.string(), range: z.string() }, async args => run(async () => {
      const rows = await host.runtime.readSheet({ spreadsheetId: String(args.spreadsheetId ?? ''), range: String(args.range ?? '') });
      return { rowCount: Math.max(0, rows.length - 1), columns: rows[0] ?? [] };
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
