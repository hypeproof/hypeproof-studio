// REQ-STUDIO-DELEGATION-ROW (CGP-AGENT-R-009 / REQ-CGP-AGENT-12): when the coach delegates to a
// helper (an agent SDK Task/Agent tool call), the timeline draws one collapsible row instead of a raw
// tool line, and the helper's own tool calls (events with parent_tool_use_id) group under it.
//
// 1. extractSdkActivity carries parent_tool_use_id; a top-level event carries none.
// 2. DelegationTracker gives the host's line ids: a delegation row, a child, or the plain SDK id.
// 3. groupDelegations over the real timeline reducer: one row, children grouped, statuses.
// 4. Negative controls: a non-Task tool, an orphan child, a child of a plain tool line.
// 5. Privacy: the row shows no raw key and no more of a workspace path than a tool line does.
// 6. Host wiring lock: the provider draws lines through the tracker.
// 7. Turn binding (verify F1/F2): a retry of a failed turn adds no user line, yet the old row
//    never reads 진행 중; the host closes an errored turn's rows as 실패; a summary cohort gets no
//    row (F3); a backgrounded helper's placeholder never becomes the answer and a seat that may
//    delegate keeps helpers in the foreground (F4).
//
// Run: node --experimental-strip-types test/delegation-row.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";

const D = await import("../src/delegationRow.ts");
const { emptyTimeline, timelineStart, timelineDelta, timelineTool, timelineEnd } = await import("../src/chatTimeline.ts");
const { extractSdkActivity, summarizeToolInput, buildSdkQueryOptions } = await import("../src/sdkCoachHelpers.ts");
const ROW = D.delegationRowId("toolu_T", "s1");

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ok   ${label}`); };

const ROOT = "/Users/learner/HypeProofClinic";
const user = (id) => ({ id, role: "user", content: "리뷰 부탁해", createdAt: 1 });

// ── 1. SDK events carry their parent ─────────────────────────────────────────
{
  const top = extractSdkActivity({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "toolu_T", name: "Task", input: { subagent_type: "코드리뷰어", description: "코드 리뷰" } }] } });
  assert.equal(top.length, 1);
  assert.equal(top[0].parent, undefined, "a top-level tool_use has no parent");
  const child = extractSdkActivity({ type: "assistant", parent_tool_use_id: "toolu_T", message: { content: [{ type: "tool_use", id: "toolu_c1", name: "Read", input: { file_path: `${ROOT}/index.html` } }] } });
  assert.equal(child[0].parent, "toolu_T", "a subagent tool_use carries parent_tool_use_id");
  const childResult = extractSdkActivity({ type: "user", parent_tool_use_id: "toolu_T", message: { content: [{ type: "tool_result", tool_use_id: "toolu_c1", content: "ok" }] } });
  assert.equal(childResult[0].parent, "toolu_T", "a subagent tool_result carries parent_tool_use_id");
  const taskResult = extractSdkActivity({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "toolu_T", content: [{ type: "text", text: "잘한 점: 제목이 분명해요." }, { type: "text", text: "agentId: a1 (for resuming)" }] }] } });
  assert.deepEqual(taskResult[0].content, [{ type: "text", text: "잘한 점: 제목이 분명해요." }, { type: "text", text: "agentId: a1 (for resuming)" }], "the result content reaches the host for the delegation row");
  assert.equal(taskResult[0].launched, undefined, "a foreground result is not a launch");
  const bg = extractSdkActivity({ type: "user", parent_tool_use_id: null, tool_use_result: { status: "async_launched", agentId: "a9" }, message: { content: [{ type: "tool_result", tool_use_id: "toolu_T", content: "Async agent launched successfully." }] } });
  assert.equal(bg[0].launched, true, "a backgrounded helper's result is marked as a launch");
  ok("extractSdkActivity: parent_tool_use_id and result content ride the activity");
}

// ── 2. The host's line ids ───────────────────────────────────────────────────
{
  const tr = new D.DelegationTracker("s1");
  assert.equal(ROW, "delegate-toolu_T@s1", "the row id names the stream that made it");
  assert.deepEqual(tr.lineFor({ kind: "tool_use", id: "toolu_T", name: "Task", input: {} }), { kind: "row", lineId: ROW });
  assert.deepEqual(tr.lineFor({ kind: "tool_use", id: "toolu_c1", name: "Read", input: {}, parent: "toolu_T" }), { kind: "child", lineId: D.delegationChildId("toolu_T", "toolu_c1") });
  assert.deepEqual(tr.lineFor({ kind: "tool_result", id: "toolu_c1", isError: false, parent: "toolu_T" }), { kind: "child", lineId: D.delegationChildId("toolu_T", "toolu_c1") });
  assert.deepEqual(tr.lineFor({ kind: "tool_result", id: "toolu_T", isError: false }), { kind: "row", lineId: ROW });
  // "Agent" is the other spelling of the same invoker (sdkCoachHelpers SDK_AGENT_TOOL_NAMES).
  assert.equal(tr.lineFor({ kind: "tool_use", id: "toolu_A", name: "Agent", input: {} }).kind, "row");
  // Negative controls: a plain tool, a near-miss name, a child whose parent is no delegation.
  assert.deepEqual(tr.lineFor({ kind: "tool_use", id: "toolu_R", name: "Read", input: {} }), { kind: "plain", lineId: "toolu_R" });
  assert.equal(tr.lineFor({ kind: "tool_use", id: "toolu_X", name: "Taskmaster", input: {} }).kind, "plain");
  assert.deepEqual(tr.lineFor({ kind: "tool_use", id: "toolu_o", name: "Read", input: {}, parent: "toolu_unknown" }), { kind: "plain", lineId: "toolu_o" });
  ok("DelegationTracker: Task/Agent → row, its children → grouped ids, everything else → the SDK id");
}

// ── 3. One row, children grouped, statuses ───────────────────────────────────
const header = D.delegationHeader({ subagent_type: "코드리뷰어", description: "index.html 코드 리뷰", prompt: "길고 자세한 지시…" }, ROOT);
const done = D.delegationResultLabel(header, [{ type: "text", text: "잘한 점: 제목이 분명해요.\n개선점: 버튼 대비가 낮아요." }], { isError: false, workspaceRoot: ROOT });
function turn({ end = "done", stream = true } = {}) {
  let s = timelineStart({ ...emptyTimeline(), items: [user("u1")] }, "a1", 1);
  s = timelineDelta(s, "코드리뷰어에게 맡겨 볼게요.", 2);
  s = timelineTool(s, { id: ROW, icon: D.DELEGATION_ICON, label: header, state: "running" }, 3);
  s = timelineTool(s, { id: D.delegationChildId("toolu_T", "toolu_c1"), icon: "🔧", label: "Read(index.html)", state: "running" }, 4);
  s = timelineTool(s, { id: D.delegationChildId("toolu_T", "toolu_c1"), icon: "🔧", label: "Read(index.html)", state: "done" }, 5);
  s = timelineTool(s, { id: D.delegationChildId("toolu_T", "toolu_c2"), icon: "🔧", label: "Grep(button)", state: "done" }, 6);
  if (end === "done") s = timelineTool(s, { id: ROW, icon: D.DELEGATION_ICON, label: done, state: "done" }, 7);
  if (end === "error") s = timelineTool(s, { id: ROW, icon: D.DELEGATION_ICON, label: D.delegationResultLabel(header, undefined, { isError: true, reason: "subagent crashed" }), state: "error" }, 7);
  s = timelineTool(s, { id: "toolu_R", icon: "🔧", label: "Read(style.css)", state: "done" }, 8);
  s = timelineDelta(s, "리뷰를 정리했어요.", 9);
  if (!stream) s = timelineEnd(s, 10);
  return s.items;
}
{
  const items = turn();
  const g = D.groupDelegations(items, null);
  assert.equal(g.rows.size, 1, "one row for one delegation");
  const row = g.rows.get(ROW);
  assert.ok(row, "the row is keyed by its own line id");
  assert.equal(row.helper, "코드리뷰어");
  assert.equal(row.task, "index.html 코드 리뷰");
  assert.equal(row.result, "잘한 점: 제목이 분명해요.\n개선점: 버튼 대비가 낮아요.");
  assert.deepEqual(row.children.map((m) => m.tool.label), ["Read(index.html)", "Grep(button)"], "children in arrival order, updated in place");
  assert.deepEqual([...g.grouped].sort(), [D.delegationChildId("toolu_T", "toolu_c1"), D.delegationChildId("toolu_T", "toolu_c2")].sort(), "children leave the main flow");
  assert.ok(!g.grouped.has("toolu_R") && !g.rows.has("toolu_R"), "a plain tool line stays in the main flow");
  ok("a Task call plus child events: one row, children grouped, plain lines untouched");
}
{
  // Status transitions, each from the stored state plus whether this turn is still running.
  const running = turn({ end: "none" });
  assert.equal(D.groupDelegations(running, "s1").rows.get(ROW).status, "running");
  assert.equal(D.DELEGATION_STATUS_LABEL.running, "진행 중");
  assert.equal(D.groupDelegations(running, null).rows.get(ROW).status, "stopped", "a row still running after the turn ended was stopped");
  assert.equal(D.DELEGATION_STATUS_LABEL.stopped, "멈춤");
  assert.equal(D.groupDelegations(turn(), "s1").rows.get(ROW).status, "done");
  assert.equal(D.DELEGATION_STATUS_LABEL.done, "끝남");
  const failed = D.groupDelegations(turn({ end: "error" }), null).rows.get(ROW);
  assert.equal(failed.status, "failed");
  assert.equal(D.DELEGATION_STATUS_LABEL.failed, "실패");
  assert.equal(failed.result, "subagent crashed", "a failure keeps the reason a tool line shows today");
  assert.equal(D.groupDelegations(running, "s1").rows.get(ROW).result, null, "no result while it runs");
  // A row from an earlier, stopped turn does not read 진행 중 while a later turn streams.
  const later = [...running, user("u2"), { id: "a2", role: "assistant", content: "", createdAt: 20 }];
  assert.equal(D.groupDelegations(later, "s2").rows.get(ROW).status, "stopped");
  ok("status: 진행 중 → 끝남 / 실패, and 멈춤 for a row the turn left running");
}

// ── 4. Negative controls ─────────────────────────────────────────────────────
{
  const plainOnly = [user("u1"), { id: "toolu_R", role: "tool", content: "", createdAt: 2, tool: { icon: "🔧", label: "Read(index.html)", state: "done" } }];
  const g = D.groupDelegations(plainOnly, null);
  assert.equal(g.rows.size, 0);
  assert.equal(g.grouped.size, 0);
  // An old history line `Task(...)` drawn before this slice keeps its plain id: never a row.
  const legacy = [user("u1"), { id: "toolu_old", role: "tool", content: "", createdAt: 2, tool: { icon: "🔧", label: "Task(리뷰해 줘)", state: "done" } }];
  assert.equal(D.groupDelegations(legacy, null).rows.size, 0, "a stored Task(...) line from before stays a line");
  // Orphan: the parent row is not in the list (cut by the history clamp, or never drawn).
  const orphanId = D.delegationChildId("toolu_gone", "toolu_c9");
  const orphan = [user("u1"), { id: orphanId, role: "tool", content: "", createdAt: 2, tool: { icon: "🔧", label: "Read(a.md)", state: "done" } }];
  const og = D.groupDelegations(orphan, null);
  assert.equal(og.grouped.size, 0, "an orphan child falls back to a normal line");
  assert.equal(og.rows.size, 0);
  // A row id whose message is not a tool line is not a row.
  const notTool = [{ id: ROW, role: "assistant", content: "x", createdAt: 1 }];
  assert.equal(D.groupDelegations(notTool, null).rows.size, 0);
  assert.equal(D.parseDelegationId("toolu_T"), null);
  assert.equal(D.parseDelegationId("pending-s1"), null);
  ok("negative controls: plain lines, legacy Task lines and orphans stay normal lines");
}

// ── 5. Privacy ───────────────────────────────────────────────────────────────
{
  const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  // Inside the 60-character cut, so only the scrub (not the clip) can hide it (verify F5).
  const shortKey = "ghp_ABCDEFGHIJKLMNOPQRSTUVWX";
  const near = D.delegationHeader({ subagent_type: "리서처", description: `토큰 ${shortKey} 확인` }, ROOT);
  assert.ok(!near.includes(shortKey) && near.includes("가려짐"), `a key inside the head line is masked: ${near}`);
  const h = D.delegationHeader({ subagent_type: "리서처", prompt: `${ROOT}/notes/plan.md 를 읽고 ${key} 는 무시하고 요약해 줘. 아주 길게 이어지는 지시문이 여기 계속 붙어 있습니다 끝까지` }, ROOT);
  assert.ok(!h.includes(key), "no raw key in the header");
  assert.ok(!h.includes(ROOT), "no workspace root in the header");
  const [, task] = h.split(" · ");
  const today = summarizeToolInput("Task", { prompt: "x".repeat(200) }, 60, ROOT);
  assert.ok(task.length <= today.length, `the task is no longer than today's Task(...) summary (${task.length} > ${today.length})`);
  const res = D.delegationResultLabel(h, [{ type: "text", text: `근거: ${ROOT}/notes/plan.md\n토큰 ${key}\n밖: /etc/hosts` }], { isError: false, workspaceRoot: ROOT });
  const view = D.readDelegationLabel(res);
  assert.ok(!view.result.includes(key), "no raw key in the final response");
  assert.ok(view.result.includes("notes/plan.md") && !view.result.includes(ROOT), "a workspace path is shown relative, like a tool line");
  assert.ok(view.result.includes("/etc/hosts"), "a path outside the workspace stays visible, like a tool line");
  assert.ok(view.result.length <= D.DELEGATION_RESULT_MAX + 1, "the final response is clipped");
  // Only the first text block: the SDK's resume trailer is not the helper's answer.
  const first = D.readDelegationLabel(D.delegationResultLabel(h, [{ type: "text", text: "답" }, { type: "text", text: "agentId: a1" }], { isError: false })).result;
  assert.equal(first, "답");
  // A plain tool line is not touched by any of this: the timeline stores the same three fields.
  const s = timelineTool(timelineStart(emptyTimeline(), "a1", 1), { id: "toolu_R", icon: "🔧", label: "Read(index.html)", state: "done" }, 2);
  assert.deepEqual(Object.keys(s.items.at(-1).tool).sort(), ["icon", "label", "state"], "no new stored field");
  ok("privacy: keys masked, workspace paths relative, output clipped, nothing new persisted");
}

// ── 6. Host wiring lock ──────────────────────────────────────────────────────
{
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /new DelegationTracker\(streamId, \{ rows: !work \}\)/, "one tracker per stream; summary cohorts get no rows");
  assert.match(src, /tracker\.lineFor\(a\)/, "tool lines take their id from the tracker");
  assert.match(src, /if \(!a\.launched\) \{\s*tracker\.settle\(a\.id\);/, "a launch placeholder never settles the row");
  assert.match(src, /clearPending\(\);\s*closeDelegations\(NO_ANSWER_REASON\);/, "a finished turn closes rows left without an answer");
  assert.match(src, /runtimeSettled = true;[\s\S]{0,160}if \(!ctrl\.signal\.aborted\) closeDelegations\(TURN_FAILED_REASON\);/, "an errored turn closes its rows as 실패, a stopped one does not");
  assert.match(src, /delegationResultLabel\(/, "the row's result goes through the privacy formatter");
  ok("host wiring: the provider draws tool lines through DelegationTracker");
}

// ── 7. Turn binding, closing, summary, background ─────────────────────────────
{
  // F1 — the learner presses 다시 시도 after an errored turn: a new stream, no new user line.
  const failedTurn = turn({ end: "none", stream: false });
  const retrying = timelineStart({ ...emptyTimeline(), items: failedTurn }, "a-retry", 30).items;
  assert.equal(D.groupDelegations(retrying, "s-retry").rows.get(ROW).status, "stopped", "the old row is not the retry's: it never reads 진행 중");
  // F2 — the host closes what the turn left open; a stop takes nothing.
  const tr = new D.DelegationTracker("s1");
  tr.lineFor({ kind: "tool_use", id: "toolu_T", name: "Task", input: {} });
  tr.setHeader("toolu_T", "코드리뷰어 · 리뷰");
  tr.lineFor({ kind: "tool_use", id: "toolu_U", name: "Agent", input: {} });
  tr.setHeader("toolu_U", "리서처 · 요약");
  tr.settle("toolu_U");
  assert.deepEqual(tr.takeOpen(), [{ lineId: ROW, header: "코드리뷰어 · 리뷰" }], "only the unanswered row is closed");
  assert.deepEqual(tr.takeOpen(), [], "closed once");
  const closed = timelineTool({ ...emptyTimeline(), items: failedTurn }, { id: ROW, icon: D.DELEGATION_ICON, label: D.delegationResultLabel("코드리뷰어 · 리뷰", undefined, { isError: true, reason: D.TURN_FAILED_REASON }), state: "error" }, 40).items;
  const v = D.groupDelegations(closed, null).rows.get(ROW);
  assert.equal(v.status, "failed", "an errored turn's row reads 실패, not 멈춤");
  assert.equal(v.result, D.TURN_FAILED_REASON);
  // F3 — summary cohorts: no row, every event keeps the SDK id (the work line handles it).
  const sum = new D.DelegationTracker("s1", { rows: false });
  assert.deepEqual(sum.lineFor({ kind: "tool_use", id: "toolu_T", name: "Task", input: {} }), { kind: "plain", lineId: "toolu_T" });
  assert.equal(sum.lineFor({ kind: "tool_use", id: "toolu_c1", name: "Read", input: {}, parent: "toolu_T" }).kind, "plain");
  assert.deepEqual(sum.takeOpen(), []);
  // F4 — a seat that may delegate keeps helpers in the foreground; one that may not is untouched.
  const base = { systemPrompt: "", model: "m", permittedMcpTools: [], permissionMode: "default", maxTurns: 5, permittedTools: ["Read"] };
  const args = { proxyUrl: "http://localhost:8787/v1", token: "t", baseEnv: {} };
  assert.equal(buildSdkQueryOptions({ ...base, permittedAgentTools: ["Task", "Agent"] }, args).env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, "1");
  assert.equal(buildSdkQueryOptions({ ...base, permittedAgentTools: [] }, args).env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, undefined, "no pin without a helper grant");
  ok("turn binding: a retry never revives an old row, errors close rows as 실패, summary has no row, helpers stay foreground");
}

console.log(`delegation-row: ${passed} passed`);
