import type { ResolvedProfile } from "../protocol";
import { isAbsolute } from "node:path";
import type { CoachToolAction, SdkActivity } from "../sdkCoachHelpers.ts";
import { workspaceTools } from "./tools.ts";
import { localEmailTools, localTurnBudget } from "./emailTools.ts";
import type { GoogleAutomationMcpHost } from "../googleAutomationMcp.ts";
import {
  CHALK_TOOL_DEFINITIONS,
  callChalkTool,
  type ChalkToolContext,
} from "../chalk/tools.ts";
import { CodexLocalClient } from "./codexClient.mjs";
import { runClaude } from "./claudeClient.mjs";
import { startToolServer } from "./toolServer.mjs";

export interface LocalRuntimeConfig {
  provider: "claude" | "codex";
  executable: string;
  model: string;
  label: string;
}
export function localRuntimeConfig(
  appName: string,
  proxyUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalRuntimeConfig | null {
  if (appName !== "HypeProof Studio Dev" || env.HPS_DEV_RUNTIME !== "1")
    return null;
  const provider = env.HPS_DEV_PROVIDER;
  if (provider !== "claude" && provider !== "codex") return null;
  const u = new URL(proxyUrl);
  if (
    u.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password
  )
    throw Error("로컬 구독 개발 모드는 로컬 수업 서버에서만 사용합니다.");
  const executable = env.HPS_DEV_EXECUTABLE;
  const model = env.HPS_DEV_MODEL;
  if (!executable || !isAbsolute(executable) || !model ||
      (process.platform === "win32" && !/\.exe$/i.test(executable)))
    throw Error("개발 실행기로 CLI 설치·로그인을 먼저 확인하세요.");
  return {
    provider,
    executable,
    model,
    label:
      (provider === "claude" ? "Claude Code" : "Codex") +
      " · 로컬 구독 · " +
      model,
  };
}
export function localModelSelection(
  config: LocalRuntimeConfig,
): NonNullable<ResolvedProfile["model_selection"]> {
  return {
    revision: "hps-model-selection/1",
    runtime: "proxy",
    provider: config.provider,
    default: config.model,
    source: "profile",
    choices: [{ alias: config.model, id: config.model, label: config.label }],
  };
}
/**
 * 워크스페이스 도구에 Chalk 도구를 붙인다(강사 모드만). 순수 함수 — 테스트 가능.
 * definitions 배열에 chalk_* 가 추가되면 Claude(toolServer)·Codex(dynamicTools) 모두
 * 같은 목록을 받는다.
 */
export function mergeChalkTools(
  workTools: {
    definitions: { name: string; description: string; inputSchema: unknown }[];
    call: (n: string, i: unknown) => Promise<string>;
  },
  chalkCtx?: ChalkToolContext,
): {
  definitions: { name: string; description: string; inputSchema: unknown }[];
  call: (n: string, i: unknown) => Promise<string>;
} {
  const chalkDefs: { name: string; description: string; inputSchema: unknown }[] =
    chalkCtx ? CHALK_TOOL_DEFINITIONS : [];
  return {
    definitions: [...workTools.definitions, ...chalkDefs],
    call: async (name: string, input: unknown) => {
      if (chalkCtx && CHALK_TOOL_DEFINITIONS.some((d) => d.name === name)) {
        return callChalkTool(chalkCtx, name, input as Record<string, unknown>);
      }
      return workTools.call(name, input);
    },
  };
}

/**
 * Browser tools for the local (non-SDK) runtime — live_preview_start + browser_open.
 * The host (chatPanelProvider) provides the implementations; this module only wires
 * them into the tool list so they appear in every instructor turn uniformly.
 */
export interface BrowserToolsForLocal {
  definitions: { name: string; description: string; inputSchema: unknown }[];
  call(name: string, input: unknown): Promise<unknown>;
}

/** Append browser tools when provided (instructor mode only). */
export function mergeBrowserTools(
  tools: {
    definitions: { name: string; description: string; inputSchema: unknown }[];
    call: (n: string, i: unknown) => Promise<string>;
  },
  browserTools?: BrowserToolsForLocal,
): {
  definitions: { name: string; description: string; inputSchema: unknown }[];
  call: (n: string, i: unknown) => Promise<string>;
} {
  if (!browserTools) return tools;
  const browserNames = new Set(browserTools.definitions.map((d) => d.name));
  return {
    definitions: [...tools.definitions, ...browserTools.definitions],
    call: async (name: string, input: unknown) => {
      if (browserNames.has(name)) {
        const result = await browserTools.call(name, input);
        return typeof result === "string" ? result : JSON.stringify(result);
      }
      return tools.call(name, input);
    },
  };
}

export async function runLocalCoach(args: {
  config: LocalRuntimeConfig;
  profile: ResolvedProfile;
  cwd: string;
  history: Array<{ role: string; content: string }>;
  userText: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onActivity?: (a: SdkActivity) => void;
  requestApproval: (
    a: CoachToolAction,
  ) => Promise<boolean | { approved: boolean; actor: "user" | "policy" }>;
  // #1298 — when set, overrides the default student-coach system prompt.
  // Used by instructor mode to inject the versioned instructor-brief.
  systemPrompt?: string;
  /** 강사 모드일 때만 넘긴다. 없으면 Chalk 도구를 AI 에 붙이지 않는다(SUB-06). */
  chalkCtx?: ChalkToolContext;
  /** 강사 모드 browser tools (live_preview_start + browser_open). 없으면 붙이지 않는다. */
  browserTools?: BrowserToolsForLocal;
  emailAutomationHost?: GoogleAutomationMcpHost;
}) {
  const lifetime = new AbortController();
  let isWaiting = () => false;
  const budget = localTurnBudget(() => isWaiting());
  const signal = AbortSignal.any([args.signal, lifetime.signal, budget.signal]);
  const cancelQuestion = () => args.emailAutomationHost?.cancelPendingQuestion?.();
  signal.addEventListener("abort", cancelQuestion, { once: true });
  const workTools = workspaceTools({
    cwd: args.cwd,
    profile: args.profile,
    signal,
    approve: args.requestApproval,
    activity: args.onActivity,
  });

  // Chalk 도구는 강사 모드(chalkCtx 있음)에서만 붙는다(SUB-06).
  const withChalk = mergeChalkTools(workTools, args.chalkCtx);
  // Browser tools (live_preview_start + browser_open)은 강사 모드에서만 붙는다.
  const withBrowser = mergeBrowserTools(withChalk, args.browserTools);
  const email = localEmailTools({ profile: args.profile, host: args.emailAutomationHost, signal, activity: args.onActivity });
  isWaiting = email.isWaiting;
  const tools = mergeBrowserTools(withBrowser, email);
  const system = args.systemPrompt ??
    ("You are the coach in a LOCAL DEVELOPMENT rehearsal of HypeProof Studio. Reply in Korean. Follow the supplied course. Use only the provided Studio host tools; do not claim unsupported shell, browser or deployment actions. Read existing files before changing them; preserve unrelated work. Never treat sample results as real customers.\n" +
    JSON.stringify({
      lesson: args.profile.lesson?.content ?? null,
      welcome: args.profile.welcome,
      assets: args.profile.assets_focus ?? [],
    }));
  const emailGuide = email.definitions.length ? [
    'Email automation is available through these exact local tool names: ' + email.definitions.map(tool => tool.name).join(', ') + '.',
    'First understand the actual work in natural Korean conversation. Ask one necessary question at a time with email_ask_user (question, choices as JSON array of {id,label}, allowFreeText as "true" or "false"). Do not repeat known answers or impose a fixed form.',
    'Generate a reusable skill matching that intent and save it with email_skill_save. Its recipe is JSON internally, never something the learner must type or import. Exact schema: {schema:"hps-email-automation/1",category:"email",title,description,subjectTemplate,bodyTemplate,columns:{email,name,document,dueDate}}. Templates allow only {{name}}, {{document}}, {{dueDate}}; columns contain sheet header names. Do not put actual people, addresses, data or secrets in the recipe.',
    'A recipe edit is not persisted by describing it or repeating JSON. Call email_skill_save with the intended complete recipe and require its saved:true result before claiming a save or opening publication review. Change only requested fields; recipe title/description are distinct from the email subject/body. A cancelled:true tool result is not evidence of a connection failure or a card failing to open. Briefly report that the action was not completed and wait for a new request, without automatic retry or invented diagnosis.',
    'Use email_google_connect and email_sheet_configure with mode:"reuse" by default. Existing valid connections are reused. Only an explicit account/sheet change uses mode:"change". These host questions privately collect consent and Sheet URLs; never ask for those values in ordinary chat.',
    'email_sheet_read takes {} and reads only the configured sheet. email_email_preview renders the currently saved skill; recipe JSON is a legacy argument and cannot override that skill. Save intentional template changes with email_skill_save first. It returns only previewId/count. email_email_send takes previewId and requires the person to approve every exact recipient, subject and body privately; calling the tool cannot manufacture approval.',
    'Explain store results in natural Korean using the skill title. Never copy internal receipt/property names, boolean values or publication identifiers into the learner reply. State only what the tool confirmed and avoid implying installed copies were deleted.',
    'Only on an explicit withdrawal request, use email_skill_list to identify the owner publication and email_skill_unpublish with its exact id. The private host card confirms removal from future discovery/download; installed copies, Google consent and send records remain. Never claim cached copies were erased or retry an uncertain withdrawal automatically.',
    'Offer email_skill_publish only when sharing is wanted; its separate human confirmation is mandatory. email_skill_list and email_skill_install support reuse from the cohort store. A cancelled question stops that action. Never send real email or publish without the corresponding host approval.',
    ...(args.profile.automations?.appsScript === true ? [
      'For this opted-in activity, use email_workflow_plan to show the workflow in the graphics area. plan is JSON {title,nodes:[{id,label,dependsOn:[]}]}; use goal,skill,connect,sheet,prepare,preview,send,publish as IDs. Do not add personal upload/deploy stages. Dependencies form a connected DAG. The host alone marks completion from real tool outcomes. Never put account data or code in the graph.',
      'Keep semantic node IDs stable when refining the plan. Start with goal → skill and goal → connect → sheet. prepare depends on skill and connect; preview depends on prepare and sheet. Send and publish are optional independent branches after preview; never require sending to share. Ask only missing details, suggest a sensible default with free text, and keep setup IDs and developer instructions in private host cards. On recoveryRequired explain only the safe reason and offer nextTool. Respect cancellation until the learner resumes. A changed skill or account requires a fresh preview. A preview review card is read-only and cannot approve sending. If nextAction is wait_for_user, stop after reporting the safe preview result and wait for a new request; neither reviewed:true nor dismissing the card authorizes sending or sharing.',
      'After skill_save and google_connect, email_apps_script_prepare validates the saved recipe and caller-bound shared runner. Then email_apps_script_run mode=preview executes on Google. Studio manages the common execution code; learners never create projects, upload code, deploy, configure Cloud IAM or enable Apps Script API access. email_apps_script_upload/deploy are compatibility tools only; do not call them in a new flow or claim their uploaded:false/deployed:false results are completed stages. A recoveryRequired result routes to email_apps_script_setup for private reconnection, retry or an operator issue. mode=send is only for a new explicit user request after preview; it still requires exact recipient/content approval in the host card. Prefer these over direct email_preview/send. Never fall back to arbitrary tools, grant Cloud IAM, make public web apps or auto-retry uncertain sends. Recipes alone are shared. AI authoring still costs tokens; Google quotas apply.',
    ] : []),
    'For Claude these tools appear under the studio MCP server. Never invent an unavailable tool name. Google and recipient details remain on the host; do not request them as tool arguments.',
  ].join('\n') : '';
  const providerEmailGuide = args.config.provider === 'claude'
    ? emailGuide.replace(/\bemail_[a-z_]+\b/g, name => 'mcp__studio__' + name)
    : emailGuide;
  const messages = [
    { role: "system", content: system + (providerEmailGuide ? '\n\n' + providerEmailGuide : '') },
    ...args.history.filter((m) => m.role === "user" || m.role === "assistant"),
    { role: "user", content: args.userText },
  ];
  try {
    if (args.config.provider === "claude") {
      const server = await startToolServer(
        tools.definitions,
        tools.call,
        signal,
      );
      try {
        return await runClaude({
          executable: args.config.executable,
          model: args.config.model,
          cwd: args.cwd,
          messages,
          signal,
          onDelta: args.onDelta,
          toolServer: server,
          timeout: 0, // The shared active-time budget owns cancellation while questions wait.
        });
      } finally {
        server.close();
      }
    }
    const client = new CodexLocalClient({ executable: args.config.executable });
    try {
      await client.connect();
      return await client.complete({
        model: args.config.model,
        messages,
        signal,
        onDelta: args.onDelta,
        maxOutputBytes: 200000,
        tools: tools.definitions,
        onToolCall: tools.call,
      });
    } finally {
      client.close();
    }
  } finally {
    if (email.isWaiting()) cancelQuestion();
    signal.removeEventListener("abort", cancelQuestion);
    budget.dispose();
    lifetime.abort();
  }
}
