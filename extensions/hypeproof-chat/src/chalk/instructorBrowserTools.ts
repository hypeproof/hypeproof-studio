// The instructor's browser tools for the local runner (live_preview_start + browser_open).
// Both instructor paths use this one function: the legacy instructor turn
// (chatPanelProvider runInstructorTurn) and the Chalk contract turn (runContractTurn).
// Keep it the only place that builds these tools, so the two paths cannot drift.
//
// Approval: none is requested here. browser_open runs as soon as the model calls it, on both
// paths. Gating outside URLs is tracked separately (studio#3464); this file does not change it.
import {
  BROWSER_OPEN_TOOL_DEF,
  LIVE_PREVIEW_START_TOOL_DEF,
  runBrowserOpen,
  runLivePreviewStart,
  type BrowserMcpHost,
  type McpToolResult,
} from "../browserMcp.ts";
import type { BrowserToolsForLocal } from "../localRuntime/index.ts";
import { INSTRUCTOR_TOOL_PROFILE } from "./instructorTurn.ts";

export const INSTRUCTOR_LOCAL_BROWSER_DEFS = [LIVE_PREVIEW_START_TOOL_DEF, BROWSER_OPEN_TOOL_DEF] as const;

export interface InstructorBrowserOps {
  runBrowserOpen: (host: BrowserMcpHost, raw?: unknown) => Promise<McpToolResult>;
  runLivePreviewStart: (host: BrowserMcpHost) => Promise<McpToolResult>;
}

const DEFAULT_OPS: InstructorBrowserOps = { runBrowserOpen, runLivePreviewStart };

/**
 * Returns the browser tools for an instructor local turn, or undefined when the
 * instructor tool profile does not grant the browser. `makeHost` builds the same
 * BrowserMcpHost the student SDK path uses.
 */
export function instructorLocalBrowserTools(
  makeHost: () => BrowserMcpHost,
  ops: InstructorBrowserOps = DEFAULT_OPS,
): BrowserToolsForLocal | undefined {
  if (!INSTRUCTOR_TOOL_PROFILE.sdk_tools?.browser) return undefined;
  const host = makeHost();
  return {
    definitions: [...INSTRUCTOR_LOCAL_BROWSER_DEFS],
    call: async (name: string, input: unknown) => {
      const r =
        name === LIVE_PREVIEW_START_TOOL_DEF.name
          ? await ops.runLivePreviewStart(host)
          : name === BROWSER_OPEN_TOOL_DEF.name
            ? await ops.runBrowserOpen(host, input && typeof input === "object" ? (input as Record<string, unknown>).url : null)
            : null;
      if (!r) throw new Error(`알 수 없는 브라우저 도구: ${name}`);
      // isError mirrors the workspace/chalk tool convention: throw so the
      // local runtime marks the tool result as a failure.
      const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
      if (r.isError) throw new Error(text);
      return text;
    },
  };
}
