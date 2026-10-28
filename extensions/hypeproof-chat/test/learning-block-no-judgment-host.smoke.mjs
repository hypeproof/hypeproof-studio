// CGP-LEARN-R-002 (REQ-STUDIO-LEARNING-BLOCK-NO-JUDGMENT) — the host half. A block's interaction (a save from its form, a step
// focus) records no observation or evidence: the real ChatPanelProvider.handleMessage is driven through a stand-in host whose
// every recorder is captured, and the only record is the workflow line `lesson_work_saved` with no evidence_type. The learner's
// own "이 단계를 마쳤어요" (outside the block) is the control that the recorders are wired. Then the work canvas: the editor-area
// surfaces (start page, change record, preview, take-away, slide studio, visitor preview, artifact history, image edit) are bundled
// and none pulls in the block component or carries the block identity; the chat panel bundle is the control that does.
// The screen half is test/learning-block-no-judgment.test.tsx.
// Run: node --experimental-strip-types test/learning-block-no-judgment-host.smoke.mjs

import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url), extension = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok ${name}`); }

// ─── 1. A block's interaction records no evidence ────────────────────────────

const vscode = { workspace: { getConfiguration: () => ({ get: (_k, f) => f }) }, env: { appName: "HypeProof Studio" } };
const bundle = await build({
  stdin: { contents: "export {ChatPanelProvider} from './src/chatPanelProvider';", resolveDir: extension, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "silent",
});
const mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module: mod, exports: mod.exports, require: (id) => (id === "vscode" ? vscode : require(id)),
  process, console, URL, Buffer, crypto: globalThis.crypto, AbortSignal, TextEncoder, TextDecoder, setTimeout, clearTimeout,
});
const proto = mod.exports.ChatPanelProvider.prototype;

const step = (id, ui) => ({ id, title: `${id} 단계`, instructions: "해 보기", hint: "", acceptance: "직접 확인", ...(ui ? { ui } : {}) });
const LESSON = {
  course_id: "c1", version: "m2026.10.28-1", sha256: "a".repeat(64),
  content: { schema: "hps-session-design/1", title: "자료 수업", audience: "초등", duration_minutes: 40, objective: "", prerequisites: "", starter: "",
    steps: [step("s1", "criterion_form"), step("s2", "decision_form"), step("s3", "metric_board"), step("s4")] },
};

/** Records every call on an object, whatever the method: a recorder this test did not know about is still seen. */
const recorder = (name, effects) => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? (...args) => { effects.push([`${name}.${k}`, JSON.parse(JSON.stringify(args))]); } : undefined) });
function makeHost() {
  const effects = [], posts = [], state = new Map();
  // The provider's own methods over these fields (Object.create), so every helper the handler calls is the real one.
  const host = Object.assign(Object.create(proto), {
    context: { workspaceState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => { state.set(k, v); } } },
    cachedProfile: { profile_id: "p", activity_kind: "classroom", lesson: LESSON },
    post: async (m) => { posts.push(m); return true; },
    spool: recorder("spool", effects),
    opsObserver: recorder("ops", effects),
    learningRecorder: recorder("learning", effects),
    persistObservation: (...a) => effects.push(["observation", a]),
    postLearningState: async (...a) => effects.push(["learning-state", a]),
    recordStepStart: async (...a) => effects.push(["task-flow.step", a]),
  });
  return { host, effects, posts, state };
}

await test("a save from each form block is kept, and records only a workflow line with no evidence_type", async () => {
  const { host, effects, posts, state } = makeHost();
  await proto.handleMessage.call(host, { type: "lessonFocus", stepId: "s1", helpMode: null });
  await proto.handleMessage.call(host, { type: "lessonWork", stepId: "s1", kind: "criterion", text: "버튼이 보인다" });
  await proto.handleMessage.call(host, { type: "lessonWork", stepId: "s2", kind: "decision", text: "색을 바꾼다", reason: "잘 안 보여서" });
  const saved = state.get("hps.lessonWork")?.[LESSON.sha256] ?? {};
  assert.deepEqual(Object.keys(saved).sort(), ["s1", "s2"], "both saves are kept on this device");
  assert.ok(posts.some((m) => m.type === "lessonWorkState"), "the screen is told what was saved");
  assert.deepEqual(effects.map(([what, args]) => [what, args[0]?.event]), [["spool.recordWorkflow", "lesson_work_saved"], ["spool.recordWorkflow", "lesson_work_saved"]]);
  for (const [, args] of effects) {
    assert.deepEqual(Object.keys(args[0].payload).sort(), ["kind", "lesson_version", "step_id"], "the workflow line names the block, nothing more");
    assert.equal(JSON.stringify(args).includes("evidence_type"), false, "a block save never carries an evidence_type");
  }
});

await test("a save the step's block does not ask for (wrong kind, a kind this Studio cannot draw, no block) records nothing", async () => {
  const { host, effects, state } = makeHost();
  for (const msg of [{ stepId: "s1", kind: "decision", text: "x", reason: "y" }, { stepId: "s3", kind: "criterion", text: "x" }, { stepId: "s4", kind: "criterion", text: "x" }]) {
    await proto.handleMessage.call(host, { type: "lessonWork", ...msg });
  }
  assert.deepEqual(effects, []);
  assert.equal(state.has("hps.lessonWork"), false);
});

await test("control: the learner's own step report, outside the block, does reach the recorders this test watches", async () => {
  const { host, effects } = makeHost();
  await proto.handleMessage.call(host, { type: "lessonStep", stepId: "s1", status: "submitted" });
  assert.ok(effects.some(([what]) => what === "ops.lessonStep"), JSON.stringify(effects));
});

// ─── 2. No work-canvas surface can draw a block ──────────────────────────────

const BLOCK = path.join(extension, "webview-ui/src/LessonStepPanel.tsx");
/** The editor-area surfaces: what the learner works on and looks at, outside the chat surface's coach rail. */
const CANVAS = [
  "webview-ui/src/StartPage.tsx", "webview-ui/src/LocalReview.tsx",
  "src/previewProvider.ts", "src/previewHtml.ts", "src/workTakeawayPanel.ts", "src/slideStudioHost.ts", "src/visitorPreviewHost.ts",
  "src/artifactHistoryPanel.ts", "src/imageEditCommands.ts", "src/localReviewPanel.ts", "src/startPage.ts", "src/personalContinuationHost.ts",
];
async function graph(entry) {
  const r = await build({
    entryPoints: [path.join(extension, entry)], bundle: true, write: false, metafile: true, logLevel: "silent", format: "esm",
    platform: entry.startsWith("webview-ui/") ? "browser" : "node", external: ["vscode"], jsx: "automatic",
    loader: { ".css": "empty", ".svg": "empty", ".woff2": "empty", ".ttf": "empty" },
    alias: { react: path.join(extension, "webview-ui/node_modules/react"), "react-dom": path.join(extension, "webview-ui/node_modules/react-dom") },
    nodePaths: [path.join(extension, "webview-ui/node_modules")],
  });
  return { inputs: Object.keys(r.metafile.inputs).map((p) => path.resolve(extension, p)), text: r.outputFiles.map((f) => f.text).join("\n") };
}

await test("control: the chat panel bundle does pull in the block component and its identity attribute", async () => {
  const g = await graph("webview-ui/src/ChatPanel.tsx");
  assert.ok(g.inputs.includes(BLOCK), "ChatPanel does not import LessonStepPanel — the graph check would be vacuous");
  assert.ok(g.text.includes("data-hps-material"), "the identity attribute is not in the chat bundle");
});

await test("the canvas list covers every editor-area panel this extension creates", () => {
  const makers = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name) && fs.readFileSync(p, "utf8").includes("createWebviewPanel(")) makers.push(path.relative(extension, p)); } };
  walk(path.join(extension, "src"));
  assert.ok(makers.length >= 5, `only ${makers.length} panel makers found`);
  assert.deepEqual(makers.filter((m) => !CANVAS.includes(m)), [], "a panel maker the canvas check does not bundle");
});

await test("no work-canvas surface imports the block component or carries the block identity", async () => {
  for (const entry of CANVAS) {
    const g = await graph(entry);
    assert.ok(g.inputs.includes(path.join(extension, entry)) && g.text.length > 0, `${entry}: nothing was bundled`);
    assert.equal(g.inputs.includes(BLOCK), false, `${entry} pulls in LessonStepPanel`);
    assert.equal(g.text.includes("data-hps-material"), false, `${entry} carries data-hps-material`);
  }
});

console.log(`\n${passed} learning-block-no-judgment host checks passed`);
