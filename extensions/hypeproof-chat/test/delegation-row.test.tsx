// REQ-STUDIO-DELEGATION-ROW (CGP-AGENT-R-009) — the real ChatPanel draws a coach delegation as one
// collapsed row with its helper's tool calls inside, and "모두 멈추기" stops the turn through the same
// cancel path as the Stop button. Bundled with esbuild and run with plain Node; clicks go through
// fixtures/mini-dom.mjs (loaded first).

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { delegationChildId, delegationHeader, delegationResultLabel, delegationRowId, DELEGATION_ICON, STOP_ALL_LABEL } from "../src/delegationRow";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const count = (html: string, needle: string) => html.split(needle).length - 1;

const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

const ROOT = "/tmp/p";
const HEADER = delegationHeader({ subagent_type: "코드리뷰어", description: "index.html 코드 리뷰" }, ROOT);
const tool = (id: string, label: string, state: "running" | "done" | "error", icon = "🔧"): ChatMessage => ({ id, role: "tool", content: "", createdAt: 3, tool: { icon, label, state } });
const turn = (rowState: "running" | "done" | "error"): ChatMessage[] => [
  { id: "u1", role: "user", content: "리뷰 부탁해", createdAt: 1 },
  { id: "a1", role: "assistant", content: "코드리뷰어에게 맡겨 볼게요.", createdAt: 2 },
  tool(delegationRowId("toolu_T", "s1"), rowState === "running" ? HEADER : delegationResultLabel(HEADER, rowState === "done" ? [{ type: "text", text: "잘한 점: 제목이 분명해요." }] : undefined, { isError: rowState === "error", reason: "subagent crashed", workspaceRoot: ROOT }), rowState, DELEGATION_ICON),
  tool(delegationChildId("toolu_T", "toolu_c1"), "Read(index.html)", "done"),
  tool(delegationChildId("toolu_T", "toolu_c2"), "Grep(button)", rowState === "running" ? "running" : "done"),
  tool("toolu_R", "Read(style.css)", "done"),
  tool(delegationChildId("toolu_gone", "toolu_c9"), "Read(orphan.md)", "done"),
];
const render = (config: ChatConfig, messages: ChatMessage[], streaming = false, onCancel = noop, runningStreamId: string | null = streaming ? "s1" : null) =>
  renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} messages={messages} streaming={streaming} streamingId={streaming ? "a1" : null} runningStreamId={runningStreamId} onCancel={onCancel} />);
/** The markup of the delegation row, from its opening tag to the end of its <details>. */
const rowOf = (html: string) => { const at = html.indexOf('class="hps-delegation"'); ok(at >= 0, "no delegation row"); return html.slice(at, html.indexOf("</details>", at)); };

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: one row, collapsed, helper · task · status, children inside it`, () => {
    const html = render(config, turn("done"));
    ok(count(html, 'class="hps-delegation"') === 1, `${count(html, 'class="hps-delegation"')} rows`);
    const row = rowOf(html);
    ok(/<details class="hps-delegation"/.test(html) && !/<details class="hps-delegation"[^>]*\sopen/.test(html), "row is not a collapsed <details>");
    ok(row.includes("코드리뷰어") && row.includes("index.html 코드 리뷰") && row.includes("끝남"), "helper, task or status missing");
    ok(row.includes("잘한 점: 제목이 분명해요."), "final response missing from the row");
    ok(row.includes("Read(index.html)") && row.includes("Grep(button)"), "children not inside the row");
    ok(count(html, "Read(index.html)") === 1 && count(html, "Grep(button)") === 1, "children also drawn in the main flow");
    ok(!html.includes("Task("), "a raw Task(...) tool line was drawn");
  });
  t(`${mode}: a non-Task tool and an orphan child stay normal lines (negative controls)`, () => {
    const html = render(config, turn("done"));
    const row = rowOf(html);
    ok(!row.includes("Read(style.css)") && html.includes("Read(style.css)"), "plain tool line moved or lost");
    ok(!row.includes("Read(orphan.md)") && html.includes("Read(orphan.md)"), "orphan child moved or lost");
    ok(count(html, "hps-tool-log-line") >= 2, "plain lines lost their tool-line class");
  });
  t(`${mode}: status labels follow the stored state and the turn`, () => {
    ok(rowOf(render(config, turn("running"), true)).includes("진행 중"), "running");
    ok(rowOf(render(config, turn("running"), false)).includes("멈춤"), "stopped");
    const failed = rowOf(render(config, turn("error")));
    ok(failed.includes("실패") && failed.includes("subagent crashed"), "failed");
  });
  t(`${mode}: 44px targets, no capability or score words`, () => {
    const html = render(config, turn("running"), true);
    const row = html.slice(html.indexOf('class="hps-delegation"'));
    ok(/hps-delegation-summary[^>]*min-height:44px/.test(row), "summary below 44px");
    ok(/hps-delegation-stop[^>]*min-height:44px/.test(row), "stop below 44px");
    for (const word of ["FRAMING", "JUDGMENT", "ORCHESTRATE", "VERIFY", "ADAPT", "OWNERSHIP", "역량", "점수", "delegation_judgment"]) ok(!rowOf(html).includes(word), `row says ${word}`);
  });
  t(`${mode}: 다시 시도 after an error (new stream, no new user line) never revives the old row (verify F1)`, () => {
    const html = render(config, turn("running"), true, noop, "s-retry");
    const row = rowOf(html);
    ok(row.includes("멈춤") && !row.includes("진행 중"), "the old row reads 진행 중 during the retry");
    ok(!html.includes(STOP_ALL_LABEL), "모두 멈추기 offered for a row of another turn");
  });
  t(`${mode}: 모두 멈추기 only while this turn runs`, () => {
    ok(render(config, turn("running"), true).includes(STOP_ALL_LABEL), "missing while running");
    ok(!render(config, turn("running"), false).includes(STOP_ALL_LABEL), "shown after the turn ended");
    ok(!render(config, turn("done"), true).includes(STOP_ALL_LABEL), "shown for a finished helper");
  });
}

t("privacy: a plain tool line renders exactly as before", () => {
  const plain = [{ id: "u1", role: "user", content: "x", createdAt: 1 } as ChatMessage, tool("toolu_R", "Read(style.css)", "done")];
  const html = render(personal, plain);
  // REQ-STUDIO-STROKE-ICONS: the 🔧 key and the ✓ mark are stroke icons (the key stays in data-glyph).
  ok(/<div class="hps-tool-log-line hps-tool-done" role="status" aria-live="polite"><span class="hps-tool-icon" data-glyph="🔧"><svg [^>]*data-icon="tool"[^>]*aria-hidden="true">(?:(?!<\/svg>)[\s\S])*<\/svg><\/span><span class="hps-tool-label">Read\(style\.css\)<\/span><span class="hps-tool-mark"><svg [^>]*data-icon="check"[^>]*role="img" aria-label="완료">(?:(?!<\/svg>)[\s\S])*<\/svg><\/span><\/div>/.test(html), "plain line markup changed");
  ok(!html.includes("hps-delegation"), "a plain line became a row");
});

// ---------- Interactive: the real button, the real cancel prop ----------
type El = { getAttribute(n: string): string | null; textContent: string; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
t("clicking 모두 멈추기 calls the same onCancel as Stop, once", async () => {
  let cancels = 0;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(<ChatPanel {...PROPS} config={personal} instructor={false} messages={turn("running")} streaming={true} streamingId="a1" runningStreamId="s1" onCancel={() => { cancels += 1; }} />); });
  const buttons = host.findAll((e) => e.textContent === STOP_ALL_LABEL && e.getAttribute("type") === "button");
  ok(buttons.length === 1, `${buttons.length} × ${STOP_ALL_LABEL}`);
  await act(async () => { click(buttons[0]); });
  ok(cancels === 1, `onCancel called ${cancels} times`);
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`delegation-row: ${fail} failed`); process.exit(1); }
  console.log("delegation-row OK");
  process.exit(0);
})();
