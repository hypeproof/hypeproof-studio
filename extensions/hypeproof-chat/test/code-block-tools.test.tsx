import { staticTokens } from "./lib/expand-design-tokens.mjs";
// CGP-CHAT-R-008 (REQ-STUDIO-CODE-BLOCK-TOOLS) — copy and word-wrap controls on every code block.
// Bundled with esbuild and run with plain Node, like edit-resend.test.tsx. Static markup covers
// where the tools render; the interactive part mounts with react-dom/client on a minimal DOM
// (fixtures/mini-dom.mjs, loaded first), clicks the real buttons with a stubbed clipboard and
// reads the resulting DOM.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MarkdownText } from "../webview-ui/src/MarkdownText";
import { CodeBlock, CodeBlockScope, CODE_COPY_LABEL, COPY_DONE_STATUS, COPY_FAILED_STATUS, WRAP_LABEL, rememberWrap, rememberedWrap, resetWrapMemory } from "../webview-ui/src/CodeBlock";
import { CopyAnswer, writeClipboard } from "../webview-ui/src/ChatDetails";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

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
const personalIn = (taskId: string) => ({
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: taskId, tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }, { id: "t2", title: "다른 작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
}) as unknown as ChatConfig;
const personal = personalIn("t1");

const COPY = `aria-label="${CODE_COPY_LABEL}"`;
const count = (html: string, needle: string) => html.split(needle).length - 1;
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const pres = (html: string) => [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")));
// Markdown ends a block's <code> with one newline; the copied text is the block without it.
const blockText = (html: string) => pres(html).map((p) => p.replace(/\n$/, ""));
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const render = (config: ChatConfig, messages: ChatMessage[]) => renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} messages={messages} />);

const PILL_CODE = 'const x = "<a & b>";\nconsole.log(x);';
const fenced = `여기 코드예요.\n\n\`\`\`js\n${PILL_CODE}\n\`\`\`\n\n끝.`;
const PROSE_CODE = "for (let i = 0; i < 3; i++) {\n  console.log(i);\n}";
const tilde = `설명이에요.\n\n~~~js\n${PROSE_CODE}\n~~~\n\n그리고 \`inline\` 코드.`;

// ---------- Static markup: where the tools render ----------

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: a \`\`\` fence stays a collapsed pill with no tools and no code body (#159 default unchanged)`, () => {
    const html = render(config, [a("a1", fenced)]);
    ok(html.includes("hps-codepill-toggle"), "pill toggle missing");
    ok(mode === "personal" ? html.includes("코드 보기 · 2줄") : html.includes("코드 보기 (2줄)"), "collapsed label changed");
    ok(!html.includes("hps-codepill-body") && !html.includes("console.log"), "pill rendered open");
    ok(count(html, COPY) === 0 && !html.includes(WRAP_LABEL), "tools on a collapsed pill");
  });
  t(`${mode}: a fenced block in prose gets one 복사 and one 줄 바꿈 (positive control)`, () => {
    const html = render(config, [a("a1", tilde)]);
    ok(count(html, COPY) === 1, `copy count ${count(html, COPY)}`);
    ok(count(html, `aria-label="${WRAP_LABEL}" aria-pressed="true"`) === 1, "wrap toggle missing or not on by default");
    ok(blockText(html).includes(PROSE_CODE), `pre text ${JSON.stringify(pres(html))}`);
  });
  t(`${mode}: no tools outside code blocks — prose and inline code (negative control)`, () => {
    const html = render(config, [a("a1", "그냥 글이에요. `npm test` 를 실행해 보세요.\n\n- 목록\n- 항목")]);
    ok(html.includes("<code>npm test</code>"), "inline code not rendered");
    ok(count(html, COPY) === 0 && !html.includes("hps-codeblock"), "tools outside a block");
  });
}

t("each prose block gets its own tools", () => {
  const html = renderToStaticMarkup(<MarkdownText text={"~~~\none\n~~~\n\n사이 글\n\n    indented\n    two"} />);
  ok(count(html, COPY) === 2, `copy count ${count(html, COPY)}`);
  ok(JSON.stringify(blockText(html)) === JSON.stringify(["one", "indented\ntwo"]), `blocks ${JSON.stringify(pres(html))}`);
});

t("the open pill body: tools above the exact code, wrap off by default (current white-space: pre)", () => {
  resetWrapMemory();
  const html = renderToStaticMarkup(<CodeBlock code={PILL_CODE} defaultWrap={false} preClassName="hps-codepill-body" />);
  ok(html.includes('data-wrap="off"'), "wrap not off");
  ok(html.includes(`aria-label="${WRAP_LABEL}" aria-pressed="false"`), "wrap toggle state");
  ok(count(html, COPY) === 1 && html.includes("<span>복사</span>") && !/<button[^>]*disabled/.test(html), "copy button");
  ok(html.indexOf(COPY) < html.indexOf("<pre"), "tools not above the code");
  ok(/<pre class="hps-codepill-body">/.test(html) && pres(html)[0] === PILL_CODE, `pre ${JSON.stringify(pres(html))}`);
  ok(html.includes('role="status"') && /hps-codeblock-status"><\/span>/.test(html), "status not empty at rest");
});

t("wrap memory is bounded and never written to storage", () => {
  resetWrapMemory();
  for (let i = 0; i < 250; i++) rememberWrap(`b${i}`, true);
  ok(rememberedWrap("b0", false) === false && rememberedWrap("b249", false) === true, "cap does not evict oldest");
  const src = readFileSync("webview-ui/src/CodeBlock.tsx", "utf8");
  ok(!/localStorage|sessionStorage|postToHost|vscode/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "wrap choice persisted beyond the session");
  resetWrapMemory();
});

t("writeClipboard: a failed or missing clipboard is failed, never copied (negative control)", async () => {
  ok((await writeClipboard("x", { writeText: () => Promise.reject(new Error("denied")) })) === "failed", "rejection");
  ok((await writeClipboard("x", { writeText: () => { throw new Error("sync"); } })) === "failed", "sync throw");
  ok((await writeClipboard("x", undefined)) === "failed", "missing clipboard");
});

t("44px targets and wrap rules that beat the existing white-space rules", () => {
  const css = designValues(readFileSync("webview-ui/src/codeBlock.css", "utf8"));
  const tool = /\.hps-codeblock-tool \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height: 44px/.test(tool) && /min-width: 44px/.test(tool), "44px");
  ok(/\.hps-codeblock\[data-wrap="on"\] > pre \{[^}]*white-space: pre-wrap/.test(css), "wrap on");
  ok(/\.hps-codeblock\[data-wrap="off"\] > pre \{[^}]*white-space: pre;/.test(css), "wrap off");
  ok(!/outline: none|border: 1px solid var\(--hp-border-divider-default/.test(css), "focus ring removed or decorative border on a control");
});

// ---------- Interactive: real clicks, stubbed clipboard ----------

type Clip = { written: string[]; resolve: () => void; reject: () => void };
/** A clipboard whose writes stay pending until the test settles them. */
function stubClipboard(): Clip {
  const clip: Clip = { written: [], resolve: noop, reject: noop };
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (s: string) => new Promise<void>((res, rej) => { clip.written.push(s); clip.resolve = () => res(); clip.reject = () => rej(new Error("denied")); }) },
  });
  return clip;
}
function removeClipboard() { Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: undefined }); }

type El = { getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
async function mount(node: React.ReactElement) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(node); });
  const byLabel = (label: string) => host.findAll((e) => e.getAttribute("aria-label") === label);
  const one = (label: string) => { const all = byLabel(label); ok(all.length === 1, `${all.length} × ${label}`); return all[0]; };
  const status = () => host.findAll((e) => e.getAttribute("role") === "status" && /hps-codeblock-status|hps-copy-status/.test(e.getAttribute("class") ?? "")).map((e) => e.textContent);
  const wrapAttr = () => host.findAll((e) => e.getAttribute("class") === "hps-codeblock").map((e) => e.getAttribute("data-wrap"));
  return { host, root, byLabel, one, status, wrapAttr, unmount: () => act(async () => root.unmount()) };
}
const press = (el: El) => act(async () => { click(el); });
const settle = (fn: () => void) => act(async () => { fn(); await new Promise((r) => setTimeout(r, 0)); });

t("click 복사: writes exactly the block text; 복사됨 only after the write resolves", async () => {
  const clip = stubClipboard();
  const v = await mount(<CodeBlock code={PILL_CODE} defaultWrap={false} />);
  const btn = v.one(CODE_COPY_LABEL);
  await press(btn);
  ok(clip.written.length === 1 && clip.written[0] === PILL_CODE, `wrote ${JSON.stringify(clip.written)}`);
  ok(btn.textContent === "복사" && v.status()[0] === "", `confirmed before the write finished: "${btn.textContent}" / "${v.status()[0]}"`);
  await settle(() => clip.resolve());
  ok(btn.textContent === "복사됨", `button "${btn.textContent}"`);
  ok(v.status()[0] === COPY_DONE_STATUS, `status "${v.status()[0]}"`);
  await v.unmount();
});

t("click 복사 with a rejecting clipboard: says it failed, never 복사됨", async () => {
  const clip = stubClipboard();
  const v = await mount(<CodeBlock code={PILL_CODE} defaultWrap={false} />);
  const btn = v.one(CODE_COPY_LABEL);
  await press(btn);
  await settle(() => clip.reject());
  ok(btn.textContent === "복사", `button "${btn.textContent}"`);
  ok(v.status()[0] === COPY_FAILED_STATUS, `status "${v.status()[0]}"`);
  await v.unmount();
});

t("click 복사 with no clipboard at all: says it failed", async () => {
  removeClipboard();
  const v = await mount(<CodeBlock code={PILL_CODE} defaultWrap={false} />);
  await press(v.one(CODE_COPY_LABEL));
  await settle(noop);
  ok(v.one(CODE_COPY_LABEL).textContent === "복사" && v.status()[0] === COPY_FAILED_STATUS, `"${v.status()[0]}"`);
  await v.unmount();
});

t("an empty block: 복사 is disabled, a click writes nothing and claims nothing", async () => {
  const clip = stubClipboard();
  for (const code of ["", "  \n "]) {
    const v = await mount(<CodeBlock code={code} defaultWrap={false} />);
    const btn = v.one(CODE_COPY_LABEL);
    ok(btn.hasAttribute("disabled"), `not disabled for ${JSON.stringify(code)}`);
    await press(btn);
    await settle(() => clip.resolve());
    ok(clip.written.length === 0, `wrote ${JSON.stringify(clip.written)}`);
    ok(btn.textContent === "복사" && v.status()[0] === "", "claimed a copy");
    await v.unmount();
  }
});

t("click 줄 바꿈: flips data-wrap and aria-pressed; the name stays 줄 바꿈", async () => {
  resetWrapMemory();
  const v = await mount(<CodeBlock code={PILL_CODE} defaultWrap={false} />);
  const btn = v.one(WRAP_LABEL);
  ok(v.wrapAttr()[0] === "off" && btn.getAttribute("aria-pressed") === "false", "default");
  await press(btn);
  ok(v.wrapAttr()[0] === "on" && btn.getAttribute("aria-pressed") === "true", `after one click: ${v.wrapAttr()[0]} / ${btn.getAttribute("aria-pressed")}`);
  ok(btn.getAttribute("aria-label") === WRAP_LABEL && btn.textContent === WRAP_LABEL, "label changed with state");
  await press(btn);
  ok(v.wrapAttr()[0] === "off" && btn.getAttribute("aria-pressed") === "false", "second click");
  await v.unmount();
});

const scoped = (conversation: string, message: string, blocks: React.ReactNode) =>
  <CodeBlockScope root id={conversation}><CodeBlockScope id={message}>{blocks}</CodeBlockScope></CodeBlockScope>;

t("wrap memory is per block: survives a remount and a growing (streaming) block, never shared", async () => {
  resetWrapMemory();
  const twin = (code: string) => <><CodeBlock code={code} defaultWrap={false} blockKey="seg1" /><CodeBlock code={code} defaultWrap={false} blockKey="seg3" /></>;
  let v = await mount(scoped("p1/t1", "m1", twin("npm install")));
  await press(v.byLabel(WRAP_LABEL)[0]);
  ok(JSON.stringify(v.wrapAttr()) === '["on","off"]', `same message twins ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(scoped("p1/t1", "m1", twin("npm install\nnpm test")));
  ok(JSON.stringify(v.wrapAttr()) === '["on","off"]', `after remount with grown text ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(scoped("p1/t2", "m1", twin("npm install")));
  ok(JSON.stringify(v.wrapAttr()) === '["off","off"]', `leaked to another task ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(scoped("p1/t1", "m2", twin("npm install")));
  ok(JSON.stringify(v.wrapAttr()) === '["off","off"]', `leaked to another message ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(<CodeBlock code="npm install" defaultWrap={false} blockKey="seg1" />);
  ok(v.wrapAttr()[0] === "off", "an unscoped block read remembered state");
  await v.unmount();
  // A conversation scope without a message level is not enough for a key: mount-local only.
  const convOnly = <CodeBlockScope root id="p1/t1"><CodeBlock code="npm install" defaultWrap={false} blockKey="pre@4" /></CodeBlockScope>;
  v = await mount(convOnly);
  await press(v.one(WRAP_LABEL));
  ok(v.wrapAttr()[0] === "on", "toggle under a conversation-only scope");
  await v.unmount();
  v = await mount(convOnly);
  ok(v.wrapAttr()[0] === "off", "a conversation-only scope remembered a choice across mounts");
  await v.unmount();
});

t("in ChatPanel: the same snippet in another task starts at its default; the task's own choice comes back", async () => {
  resetWrapMemory();
  const panel = (taskId: string, msgId: string, content = tilde) => <ChatPanel {...PROPS} config={personalIn(taskId)} instructor={false} messages={[a(msgId, content)]} />;
  let v = await mount(panel("t1", "m1"));
  ok(JSON.stringify(v.wrapAttr()) === '["on"]', `default ${JSON.stringify(v.wrapAttr())}`);
  await press(v.one(WRAP_LABEL));
  ok(JSON.stringify(v.wrapAttr()) === '["off"]', "toggle in the panel");
  await v.unmount();
  v = await mount(panel("t2", "m1"));
  ok(JSON.stringify(v.wrapAttr()) === '["on"]', `task t2 inherited t1's choice ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(panel("t1", "m1", tilde + "\n\n더 이어지는 글."));
  ok(JSON.stringify(v.wrapAttr()) === '["off"]', `t1 lost its choice after the answer grew ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();

  // A block that is still streaming: an unclosed ~~~ fence grows line by line.
  v = await mount(panel("t1", "m9", "설명이에요.\n\n~~~\nnpm install"));
  await press(v.one(WRAP_LABEL));
  ok(JSON.stringify(v.wrapAttr()) === '["off"]', "toggle while streaming");
  await v.unmount();
  v = await mount(panel("t1", "m9", "설명이에요.\n\n~~~\nnpm install\nnpm test\n~~~\n\n끝."));
  ok(JSON.stringify(v.wrapAttr()) === '["off"]', `choice lost once the streaming block grew ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
});

t("in ChatPanel: reply-choice questions keep their own wrap choice per message and per before/after text", async () => {
  resetWrapMemory();
  // Each question has an indented block at the same offset (after "설명\n\n") in its own text.
  const q1 = "설명\n\n    npm install\n\n어느 쪽이 가까웠나요?\n1. 설치가 먼저\n2. 실행이 먼저\n\n설명\n\n    npm ci";
  const q2 = "설명\n\n    npm test\n\n어떤 쪽을 골라 볼까요?\n1. 테스트\n2. 빌드";
  const panel = (msg: ChatMessage) => <ChatPanel {...PROPS} config={personal} instructor={false} messages={[msg]} />;
  let v = await mount(panel(a("m1", q1)));
  ok(v.host.findAll((e) => e.getAttribute("class") === "hps-reply-question").length === 1, "m1 is not drawn as a choice question");
  ok(JSON.stringify(v.wrapAttr()) === '["on","on"]', `m1 default ${JSON.stringify(v.wrapAttr())}`);
  await press(v.byLabel(WRAP_LABEL)[0]);
  ok(JSON.stringify(v.wrapAttr()) === '["off","on"]', `toggle m1 before-block ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(panel(a("m1", q1)));
  ok(JSON.stringify(v.wrapAttr()) === '["off","on"]', `m1 after remount (before/after share a key?) ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
  v = await mount(panel(a("m2", q2)));
  ok(v.host.findAll((e) => e.getAttribute("class") === "hps-reply-question").length === 1, "m2 is not drawn as a choice question");
  ok(JSON.stringify(v.wrapAttr()) === '["on"]', `m2's block inherited m1's choice ${JSON.stringify(v.wrapAttr())}`);
  await v.unmount();
});

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode} ChatPanel: opening a pill shows the tools, and 복사 copies the pill's code`, async () => {
    resetWrapMemory();
    const clip = stubClipboard();
    const v = await mount(<ChatPanel {...PROPS} config={config} instructor={false} messages={[a("m1", fenced)]} />);
    ok(v.byLabel(CODE_COPY_LABEL).length === 0, "tools before opening");
    const toggle = v.host.findAll((e) => (e.getAttribute("class") ?? "").includes("hps-codepill-toggle"));
    ok(toggle.length === 1, `${toggle.length} pill toggles`);
    await press(toggle[0]);
    ok(JSON.stringify(v.wrapAttr()) === '["off"]', `open pill wrap ${JSON.stringify(v.wrapAttr())}`);
    await press(v.one(CODE_COPY_LABEL));
    await settle(() => clip.resolve());
    ok(clip.written.length === 1 && clip.written[0] === PILL_CODE, `wrote ${JSON.stringify(clip.written)}`);
    ok(v.one(CODE_COPY_LABEL).textContent === "복사됨", "no confirmation");
    await v.unmount();
  });
}

t("answer copy (CopyAnswer): 답변 복사 confirms only after success, states a failure", async () => {
  let clip = stubClipboard();
  let v = await mount(<CopyAnswer content="최종 답변" />);
  let btn = v.one("답변 복사");
  await press(btn);
  ok(btn.textContent === "복사" && v.status()[0] === "", "confirmed before the write finished");
  await settle(() => clip.resolve());
  ok(clip.written[0] === "최종 답변" && btn.textContent === "복사됨" && v.status()[0] === "답변을 복사했습니다", `success "${btn.textContent}" / "${v.status()[0]}"`);
  await v.unmount();
  clip = stubClipboard();
  v = await mount(<CopyAnswer content="최종 답변" />);
  btn = v.one("답변 복사");
  await press(btn);
  await settle(() => clip.reject());
  ok(btn.textContent === "복사" && v.status()[0] === "복사하지 못했습니다. 답변을 선택해 복사해 주세요.", `failure "${btn.textContent}" / "${v.status()[0]}"`);
  await v.unmount();
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`code-block-tools: ${fail} failed`); process.exit(1); }
  console.log("code-block-tools OK");
  // Pending 2.4s feedback-reset timers belong to unmounted components; do not wait for them.
  process.exit(0);
})();

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
