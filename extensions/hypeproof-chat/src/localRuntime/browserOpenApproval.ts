// browser_open on the instructor local runner, judged as the student path judges it (#3464).
// The verdict is evaluateSdkToolUse (the same function sdkCoach.ts canUseTool uses). An address already
// open, and the Chalk-free CR refusal, follow the student path too. An outside address asks the learner
// once through the turn's approval gate (#3582), so the wait does not spend the turn budget, and a turn
// that ends while the learner is answering denies the late answer.
import { evaluateSdkToolUse } from "../sdkCoachHelpers.ts";
import { crBrowserOpenRefusal, MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START, resolveAlreadyOpen, type BrowserMcpHost } from "../browserMcp.ts";
import type { BrowserToolsForLocal } from "./index.ts";

/** The instructor's browser grant: the same two tools the local runner registers (instructorBrowserTools.ts). */
export const INSTRUCTOR_BROWSER_PERMITTED: readonly string[] = [MCP_BROWSER_OPEN, MCP_LIVE_PREVIEW_START];

/** Learner copy for a refusal by the learner, the same sentence the student path returns to the coach. */
export const USER_DECLINED_OPEN = "사용자가 이 작업을 허용하지 않았어요.";
/** #3586 — tagged so the learner gets the 시간 초과 card, not the unknown card. */
// #3594 — the learner refused the browser window: tagged so the chat panel shows the 거절함 card.
export const BROWSER_DECLINED_TEXT = "[거절함] 허용하지 않아서 열지 않았어요. 하고 싶으면 다시 말해 주세요.";
export const BROWSER_TIMEOUT_TEXT = "[시간 초과] 확인 창이 시간 안에 선택되지 않아 열지 않았어요. 사용자가 원하면 다시 요청할 수 있어요.";

type Ask = (action: { toolName: string; input: unknown }) => Promise<boolean | { approved: boolean; denialSource?: string }>;

export function withBrowserOpenApproval(
  base: BrowserToolsForLocal | undefined,
  opts: { host: BrowserMcpHost; workspaceRoot: string | null },
): BrowserToolsForLocal | undefined {
  if (!base) return undefined;
  return {
    definitions: base.definitions,
    call: async (name: string, input: unknown, ask?: Ask) => {
      if (name !== "browser_open") return base.call(name, input);
      const verdict = evaluateSdkToolUse({
        toolName: MCP_BROWSER_OPEN,
        input,
        permittedTools: INSTRUCTOR_BROWSER_PERMITTED,
        workspaceRoot: opts.workspaceRoot ?? undefined,
        // The instructor seat is a classroom seat (profileAudience default); no minor, no access or folder
        // removal, no approval preset: the instructor profile has none of these.
        audience: "classroom",
        minor: false,
        approvalPreset: null,
        autoInFolder: false,
      });
      if (verdict.decision === "deny") throw new Error(verdict.friendly);
      // Loopback (the live preview) is allowed before the CR check, as on the student path (sdkCoach.ts).
      if (verdict.decision === "allow") return base.call(name, input);
      const { url, alreadyOpen } = await resolveAlreadyOpen(opts.host, (input as { url?: unknown } | null)?.url);
      const crRefused = url ? await crBrowserOpenRefusal(opts.host, url) : null;
      if (crRefused) throw new Error(crRefused);
      // A page that is already open is not opened again, so there is nothing to ask (REQ-M28).
      if (alreadyOpen) return base.call(name, input);
      const answer = ask ? await ask({ toolName: MCP_BROWSER_OPEN, input }) : false;
      const approved = typeof answer === "boolean" ? answer : answer.approved;
      const denialSource = typeof answer === "boolean" ? undefined : answer.denialSource;
      if (!approved) throw new Error(denialSource === "timeout" ? BROWSER_TIMEOUT_TEXT : denialSource === "declined" ? BROWSER_DECLINED_TEXT : USER_DECLINED_OPEN);
      return base.call(name, input);
    },
  };
}
