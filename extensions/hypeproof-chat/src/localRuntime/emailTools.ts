import { randomUUID } from 'node:crypto';
import type { ResolvedProfile } from '../protocol';
import { permittedMcpToolsFor, type SdkActivity } from '../sdkCoachHelpers.ts';
import { buildGoogleAutomationMcpServer, GOOGLE_AUTOMATION_MCP_TOOLS, type GoogleAutomationMcpHost } from '../googleAutomationMcp.ts';
import type { McpToolResult } from '../browserMcp.ts';

interface LocalEmailTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler(input: Record<string, unknown>): Promise<McpToolResult>;
}
/** The same managed host handlers, with JSON Schema for local CLI transports. */
export function localEmailTools(args: {
  profile: ResolvedProfile; host?: GoogleAutomationMcpHost; signal: AbortSignal;
  activity?: (activity: SdkActivity) => void;
}) {
  const host = args.host;
  let waiting = 0;
  const none = { definitions: [] as Array<{ name: string; description: string; inputSchema: unknown }>, call: async (_name: string, _input: unknown): Promise<string> => { throw new Error('이 수업에서 사용할 수 없는 자동화 도구예요.'); }, isWaiting: () => false };
  if (!host || !host.isAllowed() || !GOOGLE_AUTOMATION_MCP_TOOLS.every(name => permittedMcpToolsFor(args.profile).includes(name))) return none;
  let registered: LocalEmailTool[] = [];
  buildGoogleAutomationMcpServer({
    tool(name, description, properties, handler) {
      return { name: 'email_' + name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, handler: (input: Record<string, unknown>) => handler(input, undefined) };
    },
    createSdkMcpServer(server) { registered = server.tools as LocalEmailTool[]; return server; },
  }, { string: () => ({ type: 'string' }) }, {
    ...host, isAllowed: () => !args.signal.aborted && host.isAllowed(),
    isAppsScriptAllowed: () => !args.signal.aborted && args.profile.automations?.appsScript === true && host.isAppsScriptAllowed?.() === true,
  });
  const humanTools = new Set(['email_ask_user','email_google_connect','email_sheet_configure','email_email_send','email_skill_publish','email_skill_install','email_apps_script_upload','email_apps_script_setup','email_apps_script_deploy','email_apps_script_run']);
  return {
    definitions: registered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    isWaiting: () => waiting > 0 || host.isAwaitingUser?.() === true,
    async call(name: string, input: unknown): Promise<string> {
      const tool = registered.find(candidate => candidate.name === name);
      if (!tool || args.signal.aborted || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('자동화 요청이 중지됐거나 도구 입력이 올바르지 않아요.');
      const id = randomUUID();
      const human = humanTools.has(name);
      if (human) waiting++;
      // Private question answers never pass through this activity channel.
      args.activity?.({ kind: 'tool_use', id, name, input: {} });
      try {
        const result = await tool.handler(input as Record<string, unknown>);
        const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        if (result.isError) throw new Error(text);
        if (args.signal.aborted) throw new Error('자동화 요청을 중지했어요.');
        args.activity?.({ kind: 'tool_result', id, isError: false });
        return text;
      } catch (error) {
        args.activity?.({ kind: 'tool_result', id, isError: true, reason: '자동화 요청을 완료하지 못했어요.' });
        throw error;
      } finally { if (human) waiting--; }
    },
  };
}

/** Bounds active model time while allowing the human to answer without a timer. */
export function localTurnBudget(isWaiting: () => boolean, budgetMs = 180000) {
  const controller = new AbortController();
  let remaining = budgetMs, last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (!isWaiting()) remaining -= now - last;
    last = now;
    if (remaining <= 0) controller.abort();
  }, Math.min(1000, Math.max(1, Math.floor(budgetMs / 10))));
  return { signal: controller.signal, dispose() { clearInterval(timer); } };
}
