// REQ-STUDIO-LONG-STEP-HINT (CGP-ART-R-019, design CGP-ART-D-019; extends REQ-M26/M27 and #403):
// when one tool step has been running 20 s, the chat adds one calm Korean hint that names the step
// in learner words ("명령을 실행하는 중이에요 · 20초째"); at 60 s the hint says the learner may keep
// waiting or stop. The step's words come from the SDK tool name (extractSdkActivity → workPhrase),
// never the raw `Bash(...)` text.
//
// 1. The pure hint over a fake clock: 19 s none, 20 s wait, 60 s offer, minute wording.
// 2. The active step: a running tool line with a step; done, thinking, spoken text after it → none.
// 3. The stall (#403) wins, a finished turn has none.
// 4. Raw tool text never reaches the hint (D-027): a raw-looking step falls back.
// 5. Host side: WorkLine and the timeline reducer carry step + since and drop them on update.
// 6. Wiring locks: the provider posts step + since for tool calls; App passes them to the reducer.
//
// Run: node --experimental-strip-types test/long-step-hint.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";

const H = await import("../src/longStepHint.ts");
const { workPhrase, WorkLine, NEXT_STEP_PHRASE, THINKING_PHRASE } = await import("../src/toolActivity.ts");
const { emptyTimeline, timelineStart, timelineDelta, timelineTool } = await import("../src/chatTimeline.ts");
const { extractSdkActivity } = await import("../src/sdkCoachHelpers.ts");

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ok   ${label}`); };
const S = 1000;
const T0 = 1_700_000_000_000;
const BASH = workPhrase("Bash", { command: "npm run build" }).label;

// ── 1. The hint over a fake clock ────────────────────────────────────────────
{
  assert.equal(H.LONG_STEP_HINT_MS, 20 * S);
  assert.equal(H.LONG_STEP_OFFER_MS, 60 * S);
  const at = (ms) => H.longStepHint({ step: BASH, since: T0, now: T0 + ms, streaming: true, stalled: false });
  assert.equal(at(0), null, "no hint at the start");
  assert.equal(at(19 * S), null, "no hint at 19 s");
  assert.equal(at(19_999), null, "no hint 1 ms before 20 s");
  const h20 = at(20 * S);
  assert.ok(h20, "a hint at 20 s");
  assert.equal(h20.phase, "wait");
  assert.equal(h20.text, "명령을 실행하는 중이에요 · 20초째");
  assert.equal(h20.offerStop, false, "no stop offer before 60 s");
  assert.equal(at(37 * S).text, "명령을 실행하는 중이에요 · 37초째", "the counter follows the clock");
  assert.equal(at(37 * S).announce, h20.announce, "the announcement does not change each tick");
  assert.equal(at(59_999).phase, "wait", "still waiting just before 60 s");
  const h60 = at(60 * S);
  assert.equal(h60.phase, "offer");
  assert.equal(h60.offerStop, true, "60 s offers stop");
  assert.equal(h60.text, "명령을 실행하는 중이에요 · 1분째");
  assert.match(h60.choice, /기다려도/, "the offer names waiting");
  assert.match(h60.choice, /멈춰도/, "the offer names stopping");
  assert.notEqual(h60.announce, h20.announce, "the offer is announced once, separately");
  assert.equal(at(125 * S).text, "명령을 실행하는 중이에요 · 2분째", "minutes, not a second-by-second tick, past one minute");
  assert.equal(at(125 * S).announce, h60.announce, "minutes do not re-announce");
  ok("longStepHint: 19 s none, 20 s wait, 60 s offer, calm counter");
}

// ── 2. Which step the hint may speak about ───────────────────────────────────
const user = { id: "u1", role: "user", content: "만들어 줘", createdAt: 1 };
const said = { id: "a1", role: "assistant", content: "빌드해 볼게요.", createdAt: 2 };
const line = (id, state, extra = {}) => ({ id, role: "tool", content: "", createdAt: 3, tool: { icon: "🔧", label: "Bash(npm run build)", state, ...extra } });
{
  const running = line("toolu_B", "running", { step: BASH, since: T0 });
  assert.deepEqual(H.activeLongStep([user, said, running]), { id: "toolu_B", step: BASH, since: T0 });
  assert.equal(H.activeLongStep([user, said, line("toolu_B", "done")]), null, "a finished step has no hint");
  assert.equal(H.activeLongStep([user, said, line("toolu_B", "running")]), null, "a running line without a step (thinking, old history) has none");
  assert.equal(H.activeLongStep([user, said, running, { id: "a1#2", role: "assistant", content: "빌드가", createdAt: 4 }]), null, "streaming text after the step: none");
  assert.deepEqual(H.activeLongStep([user, said, running, { id: "a1#2", role: "assistant", content: "", createdAt: 4 }]), { id: "toolu_B", step: BASH, since: T0 }, "an empty bubble is not text");
  assert.equal(H.activeLongStep([running, user]), null, "a line from before the last user message is not this turn's");
  const parallel = [user, line("toolu_A", "running", { step: "파일을 살펴보는 중…", since: T0 }), line("toolu_B", "done", {})];
  assert.equal(H.activeLongStep(parallel)?.id, "toolu_A", "a parallel call still running is found past a finished one");
  ok("activeLongStep: running with a step only, never past spoken text");
}

// ── 3. The stall wins; a finished turn has none ──────────────────────────────
{
  const base = { step: BASH, since: T0, now: T0 + 90 * S };
  assert.ok(H.longStepHint({ ...base, streaming: true, stalled: false }), "positive control");
  assert.equal(H.longStepHint({ ...base, streaming: true, stalled: true }), null, "the stall message wins");
  assert.equal(H.longStepHint({ ...base, streaming: false, stalled: false }), null, "no hint after the turn");
  assert.equal(H.longStepHint({ ...base, since: Number.NaN, streaming: true, stalled: false }), null, "no clock, no hint");
  assert.equal(H.longStepHint({ ...base, since: T0 + 200 * S, streaming: true, stalled: false }), null, "a future start (clock skew) gives no hint");
  ok("stall and turn end clear the hint");
}

// ── 4. Raw tool text never reaches the hint (D-027) ──────────────────────────
{
  for (const name of ["Bash", "Read", "Edit", "WebSearch", "mcp__hypeproof__browser_read", "Task", "SomeNewTool"]) {
    const step = workPhrase(name, { file_path: "/w/index.html", command: "rm -rf x" }).label;
    const h = H.longStepHint({ step, since: T0, now: T0 + 61 * S, streaming: true, stalled: false });
    for (const piece of [name, "(", "rm -rf", "mcp__", "/w/"]) assert.ok(!`${h.text} ${h.choice} ${h.announce}`.includes(piece), `${name}: hint shows "${piece}"`);
    assert.match(h.text, /중이에요 · 1분째$/, `${name}: learner wording`);
  }
  for (const raw of ["Bash(npm run build)", "mcp__hypeproof__browser_read({})", "Bash", "", "   "]) {
    assert.equal(H.learnerDoing(raw), "작업하는 중이에요", `raw step "${raw}" falls back`);
  }
  assert.equal(H.learnerDoing("홈페이지를 고치는 중…"), "홈페이지를 고치는 중이에요");
  ok("the hint speaks only in learner words");
}

// ── 5. Host side carries step + since and drops them on update ───────────────
{
  const posted = [];
  const work = new WorkLine("pending-s1", (e) => posted.push(e));
  work.show(THINKING_PHRASE);
  work.show(workPhrase("Bash", { command: "npm run build" }), T0);
  work.show(NEXT_STEP_PHRASE);
  assert.equal(posted[0].step, undefined, "thinking is not a tool step");
  assert.deepEqual([posted[1].label, posted[1].step, posted[1].since], [BASH, BASH, T0], "a tool phrase carries its step and start");
  assert.ok(!posted[1].label.includes("Bash"), "summary line never carries the raw name");
  assert.equal(posted[2].step, undefined, "the next-step phrase ends the step");
  assert.equal(posted[1].id, posted[2].id, "same line, changed in place");

  let s = timelineStart({ ...emptyTimeline(), items: [user] }, "a1", 1);
  s = timelineDelta(s, "빌드해 볼게요.", 2);
  s = timelineTool(s, { id: "toolu_B", icon: "🔧", label: "Bash(npm run build)", state: "running", step: BASH, since: T0 }, 3);
  const live = s.items.find((m) => m.id === "toolu_B");
  assert.deepEqual([live.tool.step, live.tool.since], [BASH, T0], "the reducer keeps step + since");
  s = timelineTool(s, { id: "toolu_B", icon: "🔧", label: "Bash(npm run build)", state: "done" }, 4);
  const done = s.items.find((m) => m.id === "toolu_B");
  assert.equal(done.tool.step, undefined, "an update without a step clears it");
  assert.equal(H.activeLongStep(s.items), null);
  const plain = timelineTool(emptyTimeline(), { id: "x", icon: "🔧", label: "Read(a)", state: "done" }, 1).items[0];
  assert.deepEqual(Object.keys(plain.tool).sort(), ["icon", "label", "state"], "a line without a step stores exactly what it stored before");
  // The tool name the step is made from is extractSdkActivity's.
  const [use] = extractSdkActivity({ type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_B", name: "Bash", input: { command: "npm run build" } }] } });
  assert.equal(workPhrase(use.name, use.input).label, BASH);
  ok("WorkLine and timelineTool carry step + since, and drop them when the step ends");
}

// ── 6. Wiring locks ──────────────────────────────────────────────────────────
{
  const provider = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(provider, /work\.show\(workPhrase\(a\.name, a\.input\), stepSince\)/, "summary tool call passes its start");
  assert.match(provider, /step: workPhrase\(a\.name, a\.input\)\.label, since: stepSince/, "detailed tool line carries its learner step");
  const app = fs.readFileSync(new URL("../webview-ui/src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /case "toolLog": dispatch\(\{ type: "toolLog", [^\n]*step: msg\.step, since: msg\.since/, "App passes step + since to the reducer");
  const panel = fs.readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /stalled: !!error/, "the panel hands the stall/error state to the hint");
  ok("provider, App and ChatPanel wiring");
}

console.log(`long-step-hint: ${passed} groups OK`);
