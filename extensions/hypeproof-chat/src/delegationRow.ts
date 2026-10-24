// REQ-STUDIO-DELEGATION-ROW (CGP-AGENT-R-009 / REQ-CGP-AGENT-12) — a coach delegation to a helper
// (an agent SDK Task/Agent tool call) is drawn as one collapsible row, and the helper's own tool
// calls (SDK events with parent_tool_use_id) group under it instead of the main flow.
//
// Pure, shared by the host and the webview, like chatTimeline.ts and contextTrim.ts.
//
// Nothing new is stored. The row and its children are ordinary tool lines (id, icon, label,
// state, the fields the timeline already persists); the grouping is read back from the id:
//   row    `delegate-<task tool_use id>@<stream id>`   (the turn that made it)
//   child  `delegate-<task tool_use id>~<child tool_use id>`
// The row's label is "<helper> · <task>", and once the helper answers, a blank line and its
// final response. A row is live only while ITS stream is the running one (a retry of a failed
// turn runs under a new stream id and adds no user line). The host closes every row its turn
// left open: as 실패 when the turn errored or ended without the helper's answer; a stopped turn
// (learner or instructor) leaves it open, and an open row of a stream that no longer runs reads
// 멈춤. Summary (D-027) cohorts get no rows at all (DelegationTracker `rows: false`).

import type { ChatMessage } from "./protocol";
import { scrubSecrets } from "./shellPolicy.ts";

/** The SDK's subagent invoker under both spellings (sdkCoachHelpers SDK_AGENT_TOOL_NAMES). */
export const DELEGATION_TOOL_NAMES: readonly string[] = ["Task", "Agent"];
export const DELEGATION_ICON = "🤝";
export const DEFAULT_HELPER = "도우미";
export const STOP_ALL_LABEL = "모두 멈추기";
export const RESULT_HEADING = "도우미의 답";
export const CHILDREN_HEADING = "도우미가 한 일";
export const NO_RESULT_YET = "아직 답이 없어요.";
export const FAILED_FALLBACK = "도우미가 일을 끝내지 못했어요.";
/** The turn ended in an error while the helper was still working. */
export const TURN_FAILED_REASON = "이번 답이 끝나지 못해서 도우미도 함께 멈췄어요.";
/** The turn ended normally but the helper's answer never came (e.g. a backgrounded helper). */
export const NO_ANSWER_REASON = "도우미의 답을 받지 못했어요.";
/** The task is clipped like a tool line's input summary (summarizeToolInput's default 60). */
export const DELEGATION_TASK_MAX = 60;
/** The final response is clipped; the coach's own answer carries the full story. */
export const DELEGATION_RESULT_MAX = 1200;

export type DelegationStatus = "running" | "done" | "stopped" | "failed";
export const DELEGATION_STATUS_LABEL: Readonly<Record<DelegationStatus, string>> = {
  running: "진행 중",
  done: "끝남",
  stopped: "멈춤",
  failed: "실패",
};

const PREFIX = "delegate-";
const SEP = "~";
const STREAM_SEP = "@";
const RESULT_SEP = "\n\n";
const HEAD_SEP = " · ";

export const isDelegationTool = (name: string): boolean => DELEGATION_TOOL_NAMES.includes(name);
export const delegationRowId = (toolUseId: string, streamId?: string): string =>
  streamId ? `${PREFIX}${toolUseId}${STREAM_SEP}${streamId}` : `${PREFIX}${toolUseId}`;
export const delegationChildId = (parentToolUseId: string, childToolUseId: string): string =>
  `${PREFIX}${parentToolUseId}${SEP}${childToolUseId}`;

/** `{ parent, stream }` for a row id, `{ parent, child }` for a child id, null for any other line. */
export function parseDelegationId(id: string): { parent: string; child?: string; stream?: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const at = rest.indexOf(SEP);
  if (at < 0) {
    const s = rest.indexOf(STREAM_SEP);
    if (s < 0) return rest ? { parent: rest } : null;
    const parent = rest.slice(0, s);
    const stream = rest.slice(s + 1);
    return parent && stream ? { parent, stream } : null;
  }
  const parent = rest.slice(0, at);
  const child = rest.slice(at + 1);
  return parent && child ? { parent, child } : null;
}

/** Workspace paths shown relative to the root, the way a tool line shows them (displayPath). */
function relativize(text: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return text;
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  if (!root) return text;
  return text.split(`${root}/`).join("").split(`${root}\\`).join("");
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** "<helper> · <task>" from the Task/Agent input: one line, no keys, workspace paths relative. */
export function delegationHeader(input: unknown, workspaceRoot?: string): string {
  const rec = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const str = (k: string): string => (typeof rec[k] === "string" ? (rec[k] as string) : "");
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const helper = oneLine(str("subagent_type")).replace(/·/g, "") || DEFAULT_HELPER;
  const raw = oneLine(str("description")) || oneLine(str("prompt"));
  const task = clip(oneLine(scrubSecrets(relativize(raw, workspaceRoot))), DELEGATION_TASK_MAX);
  return `${clip(helper, 30)}${HEAD_SEP}${task}`;
}

/** First text block of a tool_result content (the helper's answer; later blocks are SDK trailers). */
function firstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string" && t.trim()) return t;
      }
    }
  }
  return "";
}

/**
 * The row's label once the helper's tool_result arrives: the header plus its final response
 * (or, on a failure, the same short reason a failed tool line shows today).
 */
export function delegationResultLabel(
  header: string,
  content: unknown,
  opts: { isError: boolean; reason?: string; workspaceRoot?: string },
): string {
  const raw = opts.isError ? (opts.reason ?? "") : firstText(content);
  const text = clip(scrubSecrets(relativize(raw, opts.workspaceRoot)).trim(), DELEGATION_RESULT_MAX);
  const body = text || (opts.isError ? FAILED_FALLBACK : "");
  return body ? `${header}${RESULT_SEP}${body}` : header;
}

/** Read a row label back into its parts. */
export function readDelegationLabel(label: string): { helper: string; task: string; result: string | null } {
  const at = label.indexOf(RESULT_SEP);
  const head = at < 0 ? label : label.slice(0, at);
  const result = at < 0 ? null : label.slice(at + RESULT_SEP.length);
  const h = head.indexOf(HEAD_SEP);
  return h < 0
    ? { helper: DEFAULT_HELPER, task: head, result }
    : { helper: head.slice(0, h), task: head.slice(h + HEAD_SEP.length), result };
}

type LineActivity =
  | { kind: "tool_use"; id: string; name: string; input?: unknown; parent?: string }
  | { kind: "tool_result"; id: string; isError: boolean; parent?: string };

/**
 * The host's side: which line id an SDK tool event draws on. One per stream. A Task/Agent call
 * at the top level opens a row; a call or result whose parent is a known row becomes its child;
 * everything else (including a child of an unknown parent) keeps the SDK's own id. With
 * `rows: false` (a summary cohort, D-027) nothing is ever a row, so every event stays plain.
 */
export class DelegationTracker {
  private readonly rows = new Map<string, { header: string; settled: boolean }>();
  private readonly streamId: string;
  private readonly enabled: boolean;

  constructor(streamId: string, opts: { rows?: boolean } = {}) {
    this.streamId = streamId;
    this.enabled = opts.rows !== false;
  }

  lineFor(a: LineActivity): { kind: "row" | "child" | "plain"; lineId: string } {
    if (a.parent && this.rows.has(a.parent)) return { kind: "child", lineId: delegationChildId(a.parent, a.id) };
    if (this.enabled && a.kind === "tool_use" && !a.parent && isDelegationTool(a.name) && !this.rows.has(a.id)) {
      this.rows.set(a.id, { header: "", settled: false });
    }
    if (!a.parent && this.rows.has(a.id)) return { kind: "row", lineId: delegationRowId(a.id, this.streamId) };
    return { kind: "plain", lineId: a.id };
  }

  setHeader(id: string, header: string): void {
    const r = this.rows.get(id);
    if (r) r.header = header;
  }

  header(id: string): string {
    return this.rows.get(id)?.header ?? "";
  }

  /** The row got its helper's answer (or error); the turn's end leaves it alone. */
  settle(id: string): void {
    const r = this.rows.get(id);
    if (r) r.settled = true;
  }

  /** Rows still open, marked settled as they are returned (the host closes each once). */
  takeOpen(): { lineId: string; header: string }[] {
    const out: { lineId: string; header: string }[] = [];
    for (const [id, r] of this.rows) {
      if (r.settled) continue;
      r.settled = true;
      out.push({ lineId: delegationRowId(id, this.streamId), header: r.header });
    }
    return out;
  }
}

export interface DelegationView {
  id: string;
  helper: string;
  task: string;
  result: string | null;
  status: DelegationStatus;
  children: ChatMessage[];
}

/**
 * The webview's side: rows keyed by their line id, and the ids of child lines drawn inside a row
 * (left out of the main flow). A child whose row is not in the list (cut by the history clamp, or
 * never drawn) is not grouped: it stays a normal line. `runningStreamId` is the stream the panel
 * is running now (null when idle); a row is live only when it was made by that stream.
 */
export function groupDelegations(
  items: readonly ChatMessage[],
  runningStreamId: string | null,
): { rows: Map<string, DelegationView>; grouped: Set<string> } {
  const rows = new Map<string, DelegationView>();
  const byTask = new Map<string, DelegationView>();
  const grouped = new Set<string>();
  items.forEach((m) => {
    if (m.role !== "tool" || !m.tool) return;
    const id = parseDelegationId(m.id);
    if (!id || id.child) return;
    const { helper, task, result } = readDelegationLabel(m.tool.label);
    const live = runningStreamId !== null && id.stream === runningStreamId;
    const status: DelegationStatus =
      m.tool.state === "done" ? "done" : m.tool.state === "error" ? "failed" : live ? "running" : "stopped";
    const view: DelegationView = { id: m.id, helper, task, result, status, children: [] };
    rows.set(m.id, view);
    byTask.set(id.parent, view);
  });
  for (const m of items) {
    if (m.role !== "tool" || !m.tool) continue;
    const id = parseDelegationId(m.id);
    if (!id?.child) continue;
    const row = byTask.get(id.parent);
    if (!row) continue;
    row.children.push(m);
    grouped.add(m.id);
  }
  return { rows, grouped };
}


/** One summary per originating stream; unbound legacy rows never borrow another turn. */
export function delegationGroups(rows: ReadonlyMap<string, DelegationView>): Map<string, DelegationView[]> {
  const groups = new Map<string, DelegationView[]>();
  const first = new Map<string, string>();
  for (const view of rows.values()) {
    const scope = parseDelegationId(view.id)?.stream ?? view.id;
    const key = first.get(scope) ?? view.id;
    first.set(scope, key);
    const group = groups.get(key) ?? [];
    group.push(view); groups.set(key, group);
  }
  return groups;
}
