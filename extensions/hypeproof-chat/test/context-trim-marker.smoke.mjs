// REQ-STUDIO-CONTEXT-TRIM-MARKER (CGP-CHAT-R-010 / CGP-CHAT-D-010): when older turns stop going to the
// model, the transcript says so with one quiet line at that point. Two real sources exist:
//   - the history clamp before every model call (chatPanelProvider: modelHistory(clampTimeline(…, HISTORY_MAX)));
//   - an agent SDK `system/compact_boundary` event inside a coach turn.
// The clamp marker is derived from the transcript on every render (no stored data). The compaction line
// rides the existing tool-line timeline, which modelHistory already keeps away from the model.
//
// 1–3 are pure (contextTrim.ts). 4 is the SDK event extraction. 5 locks the host wiring. 6 renders the
// real ChatPanel (personal and classroom).
//
// Run: node --experimental-strip-types test/context-trim-marker.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chatPanelProps } from "./sx-screen-fixtures.mjs";

const CT = await import("../src/contextTrim.ts");
const { HISTORY_MAX, clampTimeline, modelHistory } = await import("../src/chatTimeline.ts");
const { modelConversation } = await import("../src/editResend.ts");
const { extractSdkActivity } = await import("../src/sdkCoachHelpers.ts");

let passed = 0;
const ok = (name) => { passed++; console.log(`✓ ${name}`); };

const pad = (i) => String(i).padStart(3, "0");
/** n spoken messages, alternating user/assistant, content "말-000" … */
const spoken = (n, from = 0) => Array.from({ length: n }, (_, k) => {
  const i = from + k;
  return { id: `m${pad(i)}`, role: i % 2 === 0 ? "user" : "assistant", content: `말-${pad(i)}`, createdAt: i };
});
const tool = (id) => ({ id, role: "tool", content: "", createdAt: 0, tool: { icon: "🔧", label: "Write(index.html)", state: "done" } });
const compactLine = (streamId) => ({ id: CT.compactionLineId(streamId), role: "tool", content: "", createdAt: 0, tool: { icon: "", label: CT.CONTEXT_COMPACT_NOTE, state: "done" } });
const noteTexts = () => [CT.CONTEXT_TRIM_NOTE, CT.CONTEXT_COMPACT_NOTE];

// ── 1. Boundary: only a real clamp gives one ──
{
  assert.equal(HISTORY_MAX, 200, "the clamp this marker follows is the host's HISTORY_MAX");
  // Negative controls: an empty, short and exactly-full history drop nothing.
  for (const msgs of [[], spoken(3), spoken(HISTORY_MAX), [...spoken(HISTORY_MAX), tool("t1"), tool("t2")]]) {
    assert.equal(CT.trimBoundaryId(msgs), null, `no boundary for ${msgs.length} items`);
    assert.equal(CT.trimMarkerIndex(msgs, msgs), -1);
  }
  // Tool lines never count toward the cap (they are not sent): 200 spoken among 50 tool lines is not a clamp.
  const mixed = spoken(HISTORY_MAX).flatMap((m, i) => (i % 4 === 0 ? [tool(`t${i}`), m] : [m]));
  assert.equal(CT.trimBoundaryId(mixed), null, "tool lines are not counted");
  // Superseded versions of an edited prompt are not sent either, so they do not count.
  const versions = [
    { id: "old-u", role: "user", content: "처음 질문", createdAt: 0 },
    { id: "old-a", role: "assistant", content: "처음 답", createdAt: 0 },
    { id: "new-u", role: "user", content: "고친 질문", createdAt: 0, editOf: "old-u" },
    { id: "new-a", role: "assistant", content: "고친 답", createdAt: 0 },
    ...spoken(HISTORY_MAX - 2, 10),
  ];
  assert.equal(CT.trimBoundaryId(versions), null, "a hidden version is not a dropped turn");
  ok("short, exactly-full, tool-heavy and versioned histories give no boundary");

  // One spoken message over the cap: the first one is left out; the boundary is the second.
  const over = spoken(HISTORY_MAX + 1);
  assert.equal(CT.trimBoundaryId(over), "m001");
  assert.equal(CT.trimMarkerIndex(over, over), 1, "the marker sits right before the first message still sent");
  // Tool lines of the dropped turn stay above the marker.
  const withTools = [over[0], tool("t-old"), ...over.slice(1)];
  assert.equal(CT.trimMarkerIndex(withTools, withTools), 2);
  ok("a clamp gives exactly one boundary at the first message still sent");
}

// ── 2. The boundary moves; markers never stack ──
{
  const a = spoken(HISTORY_MAX + 1);
  const b = spoken(HISTORY_MAX + 5);
  assert.equal(CT.trimBoundaryId(a), "m001");
  assert.equal(CT.trimBoundaryId(b), "m005", "four more messages move the boundary four places");
  assert.equal(CT.trimMarkerIndex(b, b), 5);
  assert.equal(typeof CT.trimMarkerIndex(b, b), "number", "one index: there is never a second clamp marker");
  // The drawn list can show an older version of a prompt; the marker still lands at a real position.
  const drawn = b.filter((m) => m.id !== "m002");
  assert.equal(CT.trimMarkerIndex(drawn, b), 4, "positions are taken from the full list");
  ok("the boundary moves with the conversation and is one index");
}

// ── 3. Never in the payload sent to the model ──
{
  const conv = [...spoken(HISTORY_MAX + 3), compactLine("s1"), ...spoken(2, 500)];
  const payload = modelHistory(clampTimeline(modelConversation(conv), HISTORY_MAX));
  assert.ok(payload.every((m) => m.role === "user" || m.role === "assistant"), "only spoken lines go out");
  for (const t of noteTexts()) assert.ok(!payload.some((m) => m.content.includes(t)), `note text not sent: ${t}`);
  assert.ok(!payload.some((m) => CT.isCompactionLine(m)), "the compaction line is not sent");
  // The clamp marker is not a message at all: the module returns an index, never an item to append.
  assert.ok(!Object.values(CT).some((v) => typeof v === "function" && /push\(|concat\(/.test(String(v))), "no function builds a message list");
  assert.equal(CT.isCompactionLine(compactLine("s9")), true);
  assert.equal(CT.isCompactionLine({ ...compactLine("s9"), role: "assistant" }), false, "only a tool line is a compaction line");
  assert.equal(CT.isCompactionLine(tool("toolu_1")), false);
  ok("neither marker reaches the model payload");
}

// ── 4. The SDK compaction event ──
{
  const ev = { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 190000 }, uuid: "u", session_id: "s" };
  assert.deepEqual(extractSdkActivity(ev).map((a) => a.kind), ["compaction"]);
  // Negative controls: other system events, and the "compacting" status tick, are not a boundary.
  assert.deepEqual(extractSdkActivity({ type: "system", subtype: "init" }), []);
  assert.deepEqual(extractSdkActivity({ type: "system", subtype: "status", status: "compacting" }), []);
  assert.equal(CT.compactionLineId("abc"), CT.compactionLineId("abc"), "one id per turn: a second compaction replaces the line");
  assert.notEqual(CT.compactionLineId("abc"), CT.compactionLineId("abd"));
  ok("compact_boundary becomes one compaction activity; other system events do not");
}

// ── 5. Host wiring ──
{
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(src, /const history = modelHistory\(clampTimeline\(modelConversation\(conversation, versionOf\), HISTORY_MAX\)\);/, "the clamp the marker mirrors is still the one model path");
  const at = src.indexOf('case "compaction"');
  assert.ok(at > 0, "the turn's activity switch handles compaction");
  const branch = src.slice(at, at + 700);
  assert.match(branch, /this\.postToolLog\(streamId, \{ id: compactionLineId\(streamId\)/, "posted through postToolLog, so it is kept in the turn timeline");
  assert.match(branch, /CONTEXT_COMPACT_NOTE/);
  const panel = fs.readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /trimMarkerIndex\(shown\.items, messages\)/, "the panel derives the marker from what it draws");
  ok("host and panel wiring");
}

// ── 6. Rendered ChatPanel, personal and classroom ──
{
  const webviewDir = new URL("../webview-ui/", import.meta.url);
  const nodeRequire = createRequire(import.meta.url);
  const entry = [
    `import { createElement } from "react";`,
    `import { renderToStaticMarkup } from "react-dom/server";`,
    `import { ChatPanel } from "./src/ChatPanel.tsx";`,
    `export function render(props) { return renderToStaticMarkup(createElement(ChatPanel, props)); }`,
  ].join("\n");
  const bundle = await build({
    stdin: { contents: entry, resolveDir: webviewDir.pathname, loader: "tsx", sourcefile: "context-trim-entry.tsx" },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic",
    loader: { ".css": "text", ".svg": "text", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' }, write: false, logLevel: "silent",
  });
  const windowStub = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: nodeRequire, console, process, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    TextEncoder, TextDecoder, URL, window: windowStub, self: windowStub,
  });
  const render = module.exports.render;
  const base = chatPanelProps();
  const personal = { ...base.config, taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null } };
  const classroom = base.config;
  const count = (html, s) => html.split(s).length - 1;
  const notes = (html) => count(html, 'class="hps-context-note"');
  for (const [seat, config] of [["personal", personal], ["classroom", classroom]]) {
    const short = render(chatPanelProps({ config, messages: spoken(4) }));
    assert.equal(notes(short), 0, `${seat}: a short history draws no marker`);
    assert.ok(!short.includes(CT.CONTEXT_TRIM_NOTE));
    const full = render(chatPanelProps({ config, messages: spoken(HISTORY_MAX) }));
    assert.equal(notes(full), 0, `${seat}: exactly at the cap draws no marker`);

    const html = render(chatPanelProps({ config, messages: spoken(HISTORY_MAX + 3) }));
    assert.equal(notes(html), 1, `${seat}: one marker`);
    assert.equal(count(html, CT.CONTEXT_TRIM_NOTE), 1);
    const note = html.indexOf(CT.CONTEXT_TRIM_NOTE);
    assert.ok(html.indexOf("말-002") < note && note < html.indexOf("말-003"), `${seat}: between the last dropped and the first sent message`);
    assert.match(html, /<div class="hps-context-note" role="note">/, `${seat}: a note, not a bubble or a toast`);
    assert.ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|ADAPT|OWNERSHIP/.test(html.slice(note - 80, note + 200)), `${seat}: no capability labels`);

    const compacted = render(chatPanelProps({ config, messages: [...spoken(4), compactLine("s1"), ...spoken(2, 4)] }));
    assert.equal(notes(compacted), 1, `${seat}: the compaction line draws as the same quiet note`);
    assert.ok(compacted.includes(CT.CONTEXT_COMPACT_NOTE));
    assert.equal(count(compacted, "hps-tool-log-line"), 0, `${seat}: not drawn as a tool row`);
    const c = compacted.indexOf(CT.CONTEXT_COMPACT_NOTE);
    assert.ok(compacted.indexOf("말-003") < c && c < compacted.indexOf("말-004"), `${seat}: at the point of compaction`);
  }
  ok("ChatPanel draws one note at the boundary in personal and classroom chat, none without a clamp");
}

console.log(`\ncontext-trim-marker: ${passed} checks passed`);
