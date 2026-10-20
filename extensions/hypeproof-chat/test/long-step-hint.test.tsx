// REQ-STUDIO-LONG-STEP-HINT (CGP-ART-R-019) — the real ChatPanel draws one calm hint under a tool
// step that has been running 20 s, offers 멈추기 at 60 s through the same cancel as Stop, updates it
// in place, and clears it when the step ends, when text streams, or when the stall (#403) message
// shows. Time is a fake clock (Date.now replaced). Bundled with esbuild and run with plain Node;
// clicks go through fixtures/mini-dom.mjs (loaded first).

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { workPhrase } from "../src/toolActivity";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const count = (html: string, needle: string) => html.split(needle).length - 1;

// Fake clock: every Date.now() in the panel reads `clock`.
const T0 = 1_700_000_000_000;
let clock = T0;
Date.now = () => clock;
const S = 1000;

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

const STEP = workPhrase("Bash", { command: "npm run build" }).label;
const user: ChatMessage = { id: "u1", role: "user", content: "빌드해 줘", createdAt: 1 };
const said: ChatMessage = { id: "a1", role: "assistant", content: "빌드해 볼게요.", createdAt: 2 };
// Detailed cohorts (#414) draw the raw call; summary cohorts (D-027) draw the learner phrase.
const detailedLine = (state: "running" | "done", withStep = true): ChatMessage => ({ id: "toolu_B", role: "tool", content: "", createdAt: 3, tool: { icon: "🔧", label: "Bash(npm run build)", state, ...(withStep && state === "running" ? { step: STEP, since: T0 } : {}) } });
const summaryLine = (state: "running" | "done"): ChatMessage => ({ id: "pending-s1-w0", role: "tool", content: "", createdAt: 3, tool: state === "running" ? { icon: "⌨️", label: STEP, state, step: STEP, since: T0 } : { icon: "✍️", label: "생각했어요", state } });
const turn = (line: ChatMessage, after: ChatMessage[] = []) => [user, said, line, ...after];

type Extra = { error?: string | null; streaming?: boolean; onCancel?: () => void };
const panel = (config: ChatConfig, messages: ChatMessage[], extra: Extra = {}) => {
  const streaming = extra.streaming ?? true;
  return <ChatPanel {...PROPS} config={config} instructor={false} messages={messages} streaming={streaming} streamingId={streaming ? "a1" : null} runningStreamId={streaming ? "s1" : null} error={extra.error ?? null} onCancel={extra.onCancel ?? noop} />;
};
const render = (config: ChatConfig, messages: ChatMessage[], extra: Extra = {}) => renderToStaticMarkup(panel(config, messages, extra));
const at = (ms: number) => { clock = T0 + ms; };
const hintOf = (html: string) => { const i = html.indexOf('class="hps-long-step"'); return i < 0 ? "" : html.slice(i, html.indexOf("</section>", i)); };

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: no hint at 19 s, one hint with learner words at 20 s`, () => {
    at(19 * S);
    ok(count(render(config, turn(detailedLine("running"))), "hps-long-step\"") === 0, "a hint at 19 s");
    at(20 * S);
    const html = render(config, turn(detailedLine("running")));
    ok(count(html, 'class="hps-long-step"') === 1, `${count(html, 'class="hps-long-step"')} hints at 20 s`);
    ok(hintOf(html).includes("명령을 실행하는 중이에요 · 20초째"), "learner wording missing");
    ok(!hintOf(html).includes("Bash"), "the hint shows the raw tool name");
    ok(!hintOf(html).includes("멈추기"), "stop offered before 60 s");
  });
  t(`${mode}: at 60 s the hint offers keep waiting or stop, 44px target`, () => {
    at(60 * S);
    const hint = hintOf(render(config, turn(detailedLine("running"))));
    ok(hint.includes("명령을 실행하는 중이에요 · 1분째"), "minute wording missing");
    ok(hint.includes("기다려도") && hint.includes("멈춰도"), "the two choices are not named");
    ok(/<button[^>]*class="hps-long-step-stop"[^>]*>멈추기<\/button>/.test(hint), "no 멈추기 button");
    ok(/hps-long-step-stop"[^>]*min-height:44px/.test(hint) || /min-height:44px[^>]*hps-long-step-stop/.test(hint), "멈추기 below 44px");
    for (const word of ["FRAMING", "JUDGMENT", "ORCHESTRATE", "VERIFY", "ADAPT", "OWNERSHIP", "역량", "점수"]) ok(!hint.includes(word), `hint says ${word}`);
  });
  t(`${mode}: the hint clears when the step ends`, () => {
    at(90 * S);
    ok(hintOf(render(config, turn(detailedLine("running")))) !== "", "positive control: running at 90 s has a hint");
    ok(hintOf(render(config, turn(detailedLine("done")))) === "", "a finished step keeps its hint");
    ok(hintOf(render(config, turn(detailedLine("running")), { streaming: false })) === "", "a finished turn keeps its hint");
  });
  t(`${mode}: streaming text gives no hint`, () => {
    at(90 * S);
    ok(hintOf(render(config, turn(detailedLine("running"), [{ id: "a1#2", role: "assistant", content: "빌드가 끝나면", createdAt: 4 }]))) === "", "a hint while text streams");
    ok(hintOf(render(config, [user, { ...said, content: "" }])) === "", "a hint for a text-only turn");
    ok(hintOf(render(config, turn(detailedLine("running", false)))) === "", "a hint for a running line with no step (thinking)");
  });
  t(`${mode}: the stall message wins`, () => {
    at(240 * S);
    const stall = "응답이 너무 오래 걸려서 멈췄어요";
    const html = render(config, turn(detailedLine("running")), { error: stall });
    ok(hintOf(html) === "", "the hint shows next to the stall message");
    ok(html.includes(stall), "positive control: the stall message is drawn");
  });
}

t("summary cohort (D-027): the hint and the screen never show the raw tool name", () => {
  for (const ms of [20 * S, 61 * S]) {
    at(ms);
    for (const config of [personal, classroom]) {
      const html = render(config, turn(summaryLine("running")));
      ok(hintOf(html).includes("명령을 실행하는 중이에요"), "summary hint missing");
      for (const raw of ["Bash", "npm run build", "toolu_"]) ok(!html.includes(raw), `summary screen shows ${raw}`);
    }
  }
  at(61 * S);
  ok(hintOf(render(personal, turn(summaryLine("done")))) === "", "summary: a closed work line keeps a hint");
});

// ---------- Interactive: one element updated in place; the real Stop path ----------
type El = { getAttribute(n: string): string | null; textContent: string; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
const hints = (host: El) => host.findAll((e) => e.getAttribute("class") === "hps-long-step");
t("one hint, updated in place, then gone when the step ends", async () => {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  at(20 * S);
  await act(async () => { root.render(panel(personal, turn(detailedLine("running")))); });
  const first = hints(host);
  ok(first.length === 1, `${first.length} hints at 20 s`);
  at(45 * S);
  await act(async () => { root.render(panel(personal, turn(detailedLine("running")))); });
  const second = hints(host);
  ok(second.length === 1 && second[0] === first[0], "the hint is a new element, not updated in place");
  ok(second[0].textContent.includes("45초째"), `counter not updated: ${second[0].textContent}`);
  ok(!second[0].textContent.includes("멈추기"), "stop offered at 45 s");
  await act(async () => { root.render(panel(personal, turn(detailedLine("done")))); });
  ok(hints(host).length === 0, "the hint stayed after the step ended");
});
t("멈추기 calls the same onCancel as Stop, once", async () => {
  let cancels = 0;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  at(61 * S);
  await act(async () => { root.render(panel(classroom, turn(detailedLine("running")), { onCancel: () => { cancels += 1; } })); });
  const buttons = host.findAll((e) => e.getAttribute("class") === "hps-long-step-stop");
  ok(buttons.length === 1, `${buttons.length} × 멈추기`);
  await act(async () => { click(buttons[0]); });
  ok(cancels === 1, `onCancel called ${cancels} times`);
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`long-step-hint: ${fail} failed`); process.exit(1); }
  console.log("long-step-hint OK");
  process.exit(0);
})();
