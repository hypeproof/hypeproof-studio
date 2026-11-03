// REQ-STUDIO-TOOL-LINE-LABELS (#2788) — the learner-facing line for one SDK/local tool call.
//
// The detailed timeline used to draw every call as `${name}(${summary})`, so the learner read
// `mcp__hypeproof__browser_open(search.naver.com · 인터넷)` and `mcp__hypeproof__browser_read({})`
// (RC1, personal seat, agent-sdk). This is the one place that turns a call into plain Korean:
//   - the `mcp__hypeproof__` prefix is stripped and browser tools go through `browserToolLogLine`
//     (the proxy loop's mapping), so both runtimes say the same words;
//   - common SDK tools get a short Korean verb and, where useful, one cleaned detail;
//   - any other tool is the neutral "도구 사용 중", never its identifier, `({})` or JSON.
// The developer/observation record (`observation.toolRequest`) keeps the raw name and input.
// Pure: no vscode, so it is unit-tested under plain Node (test/tool-line-label.smoke.mjs).

import * as path from "node:path";
import { browserToolLogLine } from "./chatPanelHelpers.ts";
import { browserTarget, cleanName, OUTSIDE_WORK_FOLDER_TEXT, UNKNOWN_HOST_TEXT } from "./browserTargetHost.ts";

export interface ToolLineLabel { icon: string; label: string }

export const UNKNOWN_TOOL_LINE: ToolLineLabel = { icon: "🔧", label: "도구 사용 중" };
export const HYPEPROOF_TOOL_PREFIX = "mcp__hypeproof__";
const DETAIL_MAX = 40;

/** One line of model-supplied text: hidden/control/bidi characters removed, whitespace collapsed, clipped. */
function detail(value: unknown, max = DETAIL_MAX): string {
  if (typeof value !== "string") return "";
  const one = Array.from(cleanName(value.replace(/[\r\n\t\u0085\u2028\u2029]+/g, " ").replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "")).replace(/\s+/g, " ").trim());
  return one.length > max ? `${one.slice(0, max).join("")}…` : one.join("");
}

/** A file as the learner reads it: the path inside the work folder, or `작업 폴더 밖 · <name>`. */
function fileName(value: unknown, workspaceRoot?: string): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  if (path.isAbsolute(raw)) {
    if (workspaceRoot) {
      const rel = path.relative(workspaceRoot, raw);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return detail(rel.split(path.sep).join("/"));
    }
    return `${OUTSIDE_WORK_FOLDER_TEXT} · ${detail(path.basename(raw))}`;
  }
  return detail(raw.replace(/^\.\//, ""));
}

const withDetail = (icon: string, verb: string, text: string): ToolLineLabel =>
  ({ icon, label: text ? `${verb} ${text}` : verb });

/** The learner-facing icon + label for one tool call. Never echoes a tool identifier or raw input. */
export function learnerToolLine(name: string, input: unknown, workspaceRoot?: string): ToolLineLabel {
  const rec = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const bare = name.startsWith(HYPEPROOF_TOOL_PREFIX) ? name.slice(HYPEPROOF_TOOL_PREFIX.length) : name;
  switch (bare) {
    case "Read":
      return withDetail("📖", "파일 읽기", fileName(rec.file_path, workspaceRoot));
    case "Write":
    case "Edit":
    case "MultiEdit":
      return withDetail("✍️", "파일 고치기", fileName(rec.file_path, workspaceRoot));
    case "NotebookEdit":
      return withDetail("✍️", "파일 고치기", fileName(rec.notebook_path, workspaceRoot));
    case "Glob":
    case "Grep":
    case "LS":
      return { icon: "🔍", label: "파일 찾기" };
    // The shell row draws purpose + `$ command` from its own presentation (shellPresentation);
    // this label is only what a stored line without that presentation shows.
    case "Bash":
    case "PowerShell":
      return { icon: "⌨️", label: "명령 실행" };
    case "BashOutput":
      return { icon: "⌨️", label: "명령 결과 확인" };
    case "KillShell":
    case "KillBash":
      return { icon: "⌨️", label: "명령 멈추기" };
    case "WebSearch": {
      const q = detail(rec.query);
      return { icon: "🌐", label: q ? `웹 검색: ${q}` : "웹 검색" };
    }
    case "WebFetch": {
      const host = typeof rec.url === "string" ? browserTarget(rec.url).host : null;
      return { icon: "🌐", label: `${host ? detail(host, 60) : UNKNOWN_HOST_TEXT} 읽기` };
    }
    case "Task":
    case "Agent":
      return { icon: "🤝", label: "도우미에게 맡기기" };
    case "TodoWrite":
      return { icon: "📝", label: "할 일 정리" };
    default:
      break;
  }
  // Browser and preview tools (the hypeproof MCP server's, or the bare names the proxy loop uses).
  // browserToolLogLine names any tool it does not know neutrally, never by its identifier.
  if (/^(browser_|live_preview_|verify_)/.test(bare)) return browserToolLogLine(bare, rec, { workspaceRoot });
  return UNKNOWN_TOOL_LINE;
}
