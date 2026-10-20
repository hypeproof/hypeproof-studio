// CGP-CHAT-R-008 (REQ-STUDIO-CODE-BLOCK-TOOLS) — copy and word-wrap controls on every code block.
// Bundled with esbuild and run with plain Node, like edit-resend.test.tsx.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MarkdownText } from "../webview-ui/src/MarkdownText";
import { CodeBlock, CODE_COPY_LABEL, rememberWrap, rememberedWrap, resetWrapMemory, wrapLabel } from "../webview-ui/src/CodeBlock";
import { writeClipboard } from "../webview-ui/src/ChatDetails";
import type { ChatConfig, ChatMessage } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const pending: Promise<void>[] = [];
const t = (label: string, fn: () => void | Promise<void>) => {
  const report = (e?: unknown) => { if (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; } else console.log(`  ok   ${label}`); };
  try { const r = fn(); if (r) pending.push(r.then(() => report(), report)); else report(); } catch (e) { report(e); }
};
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
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;

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

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: a \`\`\` fence stays a collapsed pill with no tools and no code body (#159 default unchanged)`, () => {
    const html = render(config, [a("a1", fenced)]);
    ok(html.includes("hps-codepill-toggle"), "pill toggle missing");
    ok(mode === "personal" ? html.includes("코드 보기 · 2줄") : html.includes("코드 보기 (2줄)"), "collapsed label changed");
    ok(!html.includes("hps-codepill-body") && !html.includes("console.log"), "pill rendered open");
    ok(count(html, COPY) === 0 && !html.includes("줄 바꿈"), "tools on a collapsed pill");
  });
  t(`${mode}: a fenced block in prose gets one 복사 and one 줄 바꿈 (positive control)`, () => {
    const html = render(config, [a("a1", tilde)]);
    ok(count(html, COPY) === 1, `copy count ${count(html, COPY)}`);
    ok(count(html, 'aria-label="줄 바꿈 끄기" aria-pressed="true"') === 1, "wrap toggle missing or not on by default");
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
  ok(html.includes(`aria-label="${wrapLabel(false)}" aria-pressed="false"`) && wrapLabel(false) === "줄 바꿈 켜기", "wrap toggle state");
  ok(count(html, COPY) === 1 && html.includes("<span>복사</span>"), "copy button");
  ok(html.indexOf(COPY) < html.indexOf("<pre"), "tools not above the code");
  ok(/<pre class="hps-codepill-body">/.test(html) && pres(html)[0] === PILL_CODE, `pre ${JSON.stringify(pres(html))}`);
  ok(html.includes('role="status"') && /hps-codeblock-status"><\/span>/.test(html), "status not empty at rest");
});

t("CodePill passes its own code to the block, only when open", () => {
  const src = readFileSync("webview-ui/src/ChatPanel.tsx", "utf8");
  ok(/\{open && <CodeBlock code=\{code\} defaultWrap=\{false\} preClassName="hps-codepill-body" \/>\}/.test(src), "pill wiring");
  ok(/const \[open, setOpen\] = useState\(false\);/.test(src), "pill default no longer collapsed");
});

t("wrap toggle flips the attribute, aria-pressed and label, and is remembered per block", () => {
  resetWrapMemory();
  rememberWrap(PILL_CODE, true);
  const on = renderToStaticMarkup(<CodeBlock code={PILL_CODE} defaultWrap={false} />);
  ok(on.includes('data-wrap="on"') && on.includes('aria-label="줄 바꿈 끄기" aria-pressed="true"'), "remembered on not applied");
  const other = renderToStaticMarkup(<CodeBlock code={"other"} defaultWrap={false} />);
  ok(other.includes('data-wrap="off"'), "choice leaked to another block");
  rememberWrap(PROSE_CODE, false);
  ok(renderToStaticMarkup(<MarkdownText text={`~~~\n${PROSE_CODE}\n~~~`} />).includes('data-wrap="off"'), "prose block ignored its remembered choice");
  resetWrapMemory();
  ok(rememberedWrap(PILL_CODE, false) === false && rememberedWrap(PILL_CODE, true) === true, "reset did not restore defaults");
});

t("wrap memory is bounded and never written to storage", () => {
  resetWrapMemory();
  for (let i = 0; i < 250; i++) rememberWrap(`b${i}`, true);
  ok(rememberedWrap("b0", false) === false && rememberedWrap("b249", false) === true, "cap does not evict oldest");
  const src = readFileSync("webview-ui/src/CodeBlock.tsx", "utf8");
  ok(!/localStorage|sessionStorage|postToHost|setState\(\{/.test(src), "wrap choice persisted beyond the session");
  resetWrapMemory();
});

t("copy writes exactly the block text; confirmed only after the write resolves", async () => {
  const written: string[] = [];
  let release!: () => void;
  const slow = { writeText: (s: string) => new Promise<void>((resolve) => { written.push(s); release = resolve; }) };
  let settled = false;
  const result = writeClipboard(PILL_CODE, slow).then((r) => { settled = true; return r; });
  await Promise.resolve();
  ok(!settled, "reported before the clipboard write finished");
  release();
  ok((await result) === "copied", "not copied");
  ok(written.length === 1 && written[0] === PILL_CODE, `wrote ${JSON.stringify(written)}`);
});

t("a failed or missing clipboard is reported as failed, never copied (negative control)", async () => {
  ok((await writeClipboard("x", { writeText: () => Promise.reject(new Error("denied")) })) === "failed", "rejection");
  ok((await writeClipboard("x", { writeText: () => { throw new Error("sync"); } })) === "failed", "sync throw");
  ok((await writeClipboard("x", undefined)) === "failed", "missing clipboard");
});

t("block copy uses the shared confirmed-copy hook; failure copy names the code", () => {
  const src = readFileSync("webview-ui/src/CodeBlock.tsx", "utf8");
  ok(/useConfirmedCopy\(code\)/.test(src), "block copy not bound to its own code");
  ok(src.includes("state === 'copied' ? '복사됨' : '복사'") && src.includes("복사하지 못했습니다. 코드를 선택해 복사해 주세요."), "feedback copy");
  const details = readFileSync("webview-ui/src/ChatDetails.tsx", "utf8");
  ok(/useConfirmedCopy\(content\)/.test(details), "answer copy no longer shares the hook");
});

t("44px targets and wrap rules that beat the existing white-space rules", () => {
  const css = readFileSync("webview-ui/src/codeBlock.css", "utf8");
  const tool = /\.hps-codeblock-tool \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height: 44px/.test(tool) && /min-width: 44px/.test(tool), "44px");
  ok(/\.hps-codeblock\[data-wrap="on"\] > pre \{[^}]*white-space: pre-wrap/.test(css), "wrap on");
  ok(/\.hps-codeblock\[data-wrap="off"\] > pre \{[^}]*white-space: pre;/.test(css), "wrap off");
  ok(!/outline: none|border: 1px solid var\(--hp-line/.test(css), "focus ring removed or decorative border on a control");
});

Promise.all(pending).then(() => {
  if (fail) { console.error(`code-block-tools: ${fail} failed`); process.exit(1); }
  console.log("code-block-tools OK");
});
