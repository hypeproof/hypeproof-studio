// CGP-CHAT-R-007 (REQ-STUDIO-QUOTE-REPLY) — quote part of one answer into the next message.
// Bundled with esbuild and run with plain Node, like code-block-tools.test.tsx. The pure part
// (quoteReply.ts) is checked directly; the interactive part mounts ChatPanel with react-dom/client
// on the minimal DOM (fixtures/mini-dom.mjs, loaded first), stubs document.getSelection with real
// text nodes from the rendered answers, fires selectionchange and presses the real button.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { mergeQuoteIntoDraft, quoteFromSelection, toQuoteBlock, QUOTE_CUT_NOTE, QUOTE_LABEL, QUOTE_MAX, QUOTE_SCOPE_ATTR, type QuoteNode } from "../webview-ui/src/quoteReply";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(a === b, `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

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
const withDraft = (config: ChatConfig, text: string) => ({ ...config, activityDraft: { text, images: [], queued: null } }) as unknown as ChatConfig;
const unverified = (config: ChatConfig) => ({ ...config, activity: { ...(config as unknown as { activity: object }).activity, verified: false } }) as unknown as ChatConfig;

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const CONVO = [u("u1", "물이 왜 끓어요?"), a("a1", "물은 100도에서 끓어요."), u("u2", "더 알려줘"), a("a2", "높은 산에서는 더 낮은 온도에서 끓어요.")];

// ---------- Pure: selection → quote text, merge with the draft ----------

const el = (id: string | null, parent: QuoteNode | null = null): QuoteNode => ({ nodeType: 1, parentNode: parent, getAttribute: (n) => (n === QUOTE_SCOPE_ATTR ? id : null) });
const text = (parent: QuoteNode): QuoteNode => ({ nodeType: 3, parentNode: parent });
const sel = (anchor: QuoteNode | null, focus: QuoteNode | null, s: string, collapsed = false) => ({ isCollapsed: collapsed, rangeCount: 1, anchorNode: anchor, focusNode: focus, toString: () => s });

t("toQuoteBlock: every line gets `> `, a blank line stays inside the quote as `>`, CRLF normalised", () => {
  eq(toQuoteBlock("첫 줄\r\n\r\n\r\n둘째 줄  \n셋째")?.block, "> 첫 줄\n>\n> 둘째 줄\n> 셋째", "block");
  eq(toQuoteBlock("\n\n  한 줄  \n\n")?.block, ">   한 줄", "outer blank lines trimmed, inner indent kept");
  eq(toQuoteBlock("한 줄")?.truncated, false, "short is not cut");
});

t("toQuoteBlock: whitespace-only selection gives no quote (negative control)", () => {
  eq(toQuoteBlock(""), null, "empty");
  eq(toQuoteBlock(" \n\t \n"), null, "whitespace");
});

t(`toQuoteBlock: longer than ${QUOTE_MAX} characters is cut and ends with …; a surrogate pair is never split`, () => {
  const long = toQuoteBlock("가".repeat(QUOTE_MAX + 500))!;
  ok(long.truncated, "not marked truncated");
  eq(long.block, `> ${"가".repeat(QUOTE_MAX)}…`, "cut block");
  const emoji = toQuoteBlock("😀".repeat(QUOTE_MAX + 1))!;
  eq(Array.from(emoji.block.slice(2)).length, QUOTE_MAX + 1, "code points kept (incl. …)");
  ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji.block), "lone high surrogate");
  const exact = toQuoteBlock("나".repeat(QUOTE_MAX))!;
  ok(!exact.truncated && !exact.block.endsWith("…"), "exactly the cap is not cut");
});

t("quoteFromSelection: inside one answer → quote; spans messages, outside, collapsed → none", () => {
  const body1 = el("a1"); const inner = el(null, body1); const body2 = el("a2"); const composer = el(null);
  const one = quoteFromSelection(sel(text(inner), text(body1), "물은 100도"));
  eq(one?.messageId, "a1", "message id"); eq(one?.block, "> 물은 100도", "block");
  eq(quoteFromSelection(sel(text(body1), text(body2), "x")), null, "across two answers");
  eq(quoteFromSelection(sel(text(body1), text(composer), "x")), null, "answer into composer");
  eq(quoteFromSelection(sel(text(composer), text(composer), "x")), null, "composer only");
  eq(quoteFromSelection(sel(text(body1), text(body1), "x", true)), null, "collapsed");
  eq(quoteFromSelection(null), null, "no selection");
});

t("mergeQuoteIntoDraft: keeps the draft as the exact prefix, one blank line before and after the quote", () => {
  eq(mergeQuoteIntoDraft("", "> q"), "> q\n\n", "empty draft");
  eq(mergeQuoteIntoDraft("안녕", "> q"), "안녕\n\n> q\n\n", "draft without newline");
  eq(mergeQuoteIntoDraft("안녕\n", "> q"), "안녕\n\n> q\n\n", "draft with one newline");
  eq(mergeQuoteIntoDraft("안녕\n\n", "> q"), "안녕\n\n> q\n\n", "draft with a blank line");
  ok(mergeQuoteIntoDraft("  첫 생각  ", "> q").startsWith("  첫 생각  "), "draft text changed");
});

t("CSS: 44px target, tokens only for motion, no score or capability wording in the slice", () => {
  const css = readFileSync("webview-ui/src/quoteAction.css", "utf8");
  const btn = /\.hps-quote-action \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height: 44px/.test(btn) && /min-width: 44px/.test(btn), "44px");
  ok(/var\(--hp-dur-/.test(css) && !/\d+m?s\b/.test(css.replace(/var\([^)]*\)/g, "")), "literal duration");
  const src = readFileSync("webview-ui/src/quoteReply.ts", "utf8") + readFileSync("webview-ui/src/QuoteAction.tsx", "utf8");
  ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|OWNERSHIP|점수|역량/.test(src), "capability/score label");
  eq(QUOTE_LABEL, "인용하기", "label");
});

// ---------- Interactive: ChatPanel, a stubbed selection, real button presses ----------

type El = { localName: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; value: string; selectionStart: number; childNodes: El[]; nodeType: number; parentNode: El | null; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean };
let current: ReturnType<typeof sel> | null = null;
(doc as unknown as { getSelection: () => unknown }).getSelection = () => current && { ...current, removeAllRanges: () => { current = null; } };
const fire = (target: { dispatchEvent(e: object): boolean }, type: string, extra: object = {}) => target.dispatchEvent({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), ...extra,
  preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() { (this as { _stopped: boolean })._stopped = true; },
});
const selectionChange = () => act(async () => { fire(doc as unknown as El, "selectionchange", { bubbles: false }); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const firstText = (root: El): El => { for (const c of root.childNodes) { if (c.nodeType === 3 && c.textContent.trim()) return c; if (c.nodeType === 1) { const f = firstText(c); if (f) return f; } } return null as unknown as El; };

const mounted: Root[] = [];
async function mount(config: ChatConfig, messages: ChatMessage[] = CONVO, extra: object = {}) {
  current = null;
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(<ChatPanel {...PROPS} {...extra} config={config} instructor={false} messages={messages} />); });
  const body = (id: string) => host.findAll((e) => e.getAttribute(QUOTE_SCOPE_ATTR) === id)[0];
  const buttons = () => host.findAll((e) => e.localName === "button" && e.textContent === QUOTE_LABEL);
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  const select = async (anchor: El, focus: El, s: string) => { current = sel(anchor as unknown as QuoteNode, focus as unknown as QuoteNode, s); await selectionChange(); };
  return { host, body, buttons, textarea, select, unmount: () => act(async () => root.unmount()) };
}
/** The answer text (not the speaker label) of the last or first assistant row, whatever its marking. */
const answerBody = (host: El, which: "first" | "last") => {
  const rows = host.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-msg-assistant"));
  const row = which === "first" ? rows[0] : rows[rows.length - 1];
  return row.findAll((e) => (e.getAttribute("class") ?? "") === "hps-msg-body")[0];
};
const rowOf = (e: El) => { let n: El | null = e; while (n && !(n.getAttribute?.("class") ?? "").split(" ").includes("hps-msg")) n = n.parentNode; return n; };

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: select inside an answer → 인용하기 under that answer → press → draft is the > block, focus at its end, nothing sent`, async () => {
    let sent = 0;
    const v = await mount(config, CONVO, { onSend: () => { sent++; } });
    ok(v.body("a1") && v.body("a2"), "answers not marked quotable");
    ok(!v.host.findAll((e) => e.getAttribute(QUOTE_SCOPE_ATTR) === "u1").length, "a user line is quotable");
    eq(v.buttons().length, 0, "button before any selection");
    const node = firstText(v.body("a1"));
    await v.select(node, node, "100도에서 끓어요");
    eq(v.buttons().length, 1, "button count after selecting");
    ok(rowOf(v.buttons()[0]) === rowOf(v.body("a1")), "button is not under the selected answer");
    await act(async () => { click(v.buttons()[0]); });
    await settle();
    eq(v.textarea().value, "> 100도에서 끓어요\n\n", "draft");
    ok(doc.activeElement === (v.textarea() as unknown), "composer not focused");
    eq(v.textarea().selectionStart, v.textarea().value.length, "caret not at the end");
    eq(v.buttons().length, 0, "button still shown after quoting");
    eq(current, null, "selection not cleared");
    eq(sent, 0, "quoting sent a message");
    await v.unmount();
  });

  t(`${mode}: a selection across two messages, or from an answer into a user line, gives no button (negative control)`, async () => {
    const v = await mount(config);
    await v.select(firstText(v.body("a1")), firstText(v.body("a2")), "끓어요. 더 알려줘 높은 산");
    eq(v.buttons().length, 0, "across answers");
    const userLine = v.host.findAll((e) => (e.getAttribute("class") ?? "").includes("hps-msg-user"))[0];
    await v.select(firstText(v.body("a1")), firstText(userLine), "끓어요. 더 알려줘");
    eq(v.buttons().length, 0, "answer into user line");
    await v.select(firstText(userLine), firstText(userLine), "더 알려줘");
    eq(v.buttons().length, 0, "user line alone");
    await v.unmount();
  });

  t(`${mode}: an existing draft is kept and the quote follows it`, async () => {
    const v = await mount(withDraft(config, "내 생각은"));
    eq(v.textarea().value, "내 생각은", "draft restored");
    const node = firstText(v.body("a2"));
    await v.select(node, node, "높은 산에서는\n더 낮은 온도");
    await act(async () => { click(v.buttons()[0]); });
    await settle();
    eq(v.textarea().value, "내 생각은\n\n> 높은 산에서는\n> 더 낮은 온도\n\n", "merged draft");
    // A second quote also keeps everything that is there.
    const again = firstText(v.body("a1"));
    await v.select(again, again, "100도");
    await act(async () => { click(v.buttons()[0]); });
    await settle();
    eq(v.textarea().value, "내 생각은\n\n> 높은 산에서는\n> 더 낮은 온도\n\n> 100도\n\n", "second quote");
    await v.unmount();
  });
}

t("a selection in the composer or other UI gives no button (negative control)", async () => {
  const v = await mount(withDraft(personal, "입력 중인 글"));
  await v.select(v.textarea(), v.textarea(), "입력 중인 글");
  eq(v.buttons().length, 0, "composer");
  const parent = v.textarea().parentNode!;
  await v.select(parent, parent, "메시지를 입력하세요");
  eq(v.buttons().length, 0, "composer chrome");
  await v.unmount();
});

t("collapsing the selection hides the button; Escape on the button dismisses it without touching the draft", async () => {
  const v = await mount(withDraft(personal, "초안"));
  const node = firstText(v.body("a1"));
  await v.select(node, node, "물은");
  eq(v.buttons().length, 1, "shown");
  current = null; await selectionChange();
  eq(v.buttons().length, 0, "still shown after the selection went away");
  await v.select(node, node, "물은");
  await act(async () => { fire(v.buttons()[0], "keydown", { key: "Escape", keyCode: 27 }); });
  eq(v.buttons().length, 0, "Escape did not dismiss");
  eq(v.textarea().value, "초안", "Escape changed the draft");
  await v.unmount();
});

t("keyboard: the button stays while it has focus even if the selection collapses (Tab to it)", async () => {
  const v = await mount(personal);
  const node = firstText(v.body("a1"));
  await v.select(node, node, "물은");
  const btn = v.buttons()[0] as unknown as { focus(): void };
  btn.focus();
  current = null; await selectionChange();
  eq(v.buttons().length, 1, "button vanished when focus moved to it");
  await act(async () => { click(v.buttons()[0]); });
  await settle();
  eq(v.textarea().value, "> 물은\n\n", "draft from the stored quote");
  await v.unmount();
});

t(`longer than ${QUOTE_MAX} characters: the button says so and the draft ends with …`, async () => {
  const v = await mount(personal);
  const node = firstText(v.body("a1"));
  await v.select(node, node, "가".repeat(QUOTE_MAX + 10));
  ok(v.host.findAll((e) => e.textContent === QUOTE_CUT_NOTE).length === 1, "cut note missing");
  await act(async () => { click(v.buttons()[0]); });
  await settle();
  eq(v.textarea().value, `> ${"가".repeat(QUOTE_MAX)}…\n\n`, "cut draft");
  await v.unmount();
  const short = await mount(personal);
  const n2 = firstText(short.body("a1"));
  await short.select(n2, n2, "가");
  eq(short.host.findAll((e) => e.textContent === QUOTE_CUT_NOTE).length, 0, "cut note on a short quote");
  await short.unmount();
});

t("the answer that is still streaming is not quotable; finished ones are", async () => {
  const v = await mount(personal, CONVO, { streaming: true, streamingId: "a2" });
  ok(!v.body("a2"), "streaming answer is marked quotable");
  const live = answerBody(v.host, "last");
  ok(firstText(live).textContent.includes("높은 산"), `not the streaming answer's text: ${firstText(live).textContent}`);
  await v.select(firstText(live), firstText(live), "높은 산");
  eq(v.buttons().length, 0, "button on the streaming answer");
  const node = firstText(v.body("a1"));
  await v.select(node, node, "물은");
  eq(v.buttons().length, 1, "finished answer during a stream");
  await v.unmount();
});

t("an unverified activity (composer read-only) offers no quote (negative control)", async () => {
  const v = await mount(unverified(personal));
  const node = firstText(answerBody(v.host, "first"));
  ok(node.textContent.includes("100도"), `not the answer's text: ${node.textContent}`);
  current = sel(node as unknown as QuoteNode, node as unknown as QuoteNode, "물은"); await selectionChange();
  eq(v.buttons().length, 0, "button while unavailable");
  await v.unmount();
});

t("IME guard: while a composition is open the button is disabled and pressing it changes nothing", async () => {
  const v = await mount(withDraft(personal, "한"));
  await act(async () => { fire(v.textarea(), "compositionstart", { data: "" }); });
  const node = firstText(v.body("a1"));
  await v.select(node, node, "물은");
  ok(v.buttons()[0].hasAttribute("disabled"), "not disabled while composing");
  await act(async () => { click(v.buttons()[0]); });
  await settle();
  eq(v.textarea().value, "한", "draft changed during composition");
  await act(async () => { fire(v.textarea(), "compositionend", { data: "한" }); });
  ok(!v.buttons()[0].hasAttribute("disabled"), "still disabled after composition ended");
  await v.unmount();
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`quote-reply: ${fail} failed`); process.exit(1); }
  console.log("quote-reply OK");
  process.exit(0);
})();
