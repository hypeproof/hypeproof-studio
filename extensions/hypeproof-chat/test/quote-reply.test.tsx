import { staticTokens } from "./lib/expand-design-tokens.mjs";
// CGP-CHAT-R-007 (REQ-STUDIO-QUOTE-REPLY) — quote part of one answer into the next message.
// Bundled with esbuild and run with plain Node, like code-block-tools.test.tsx. The pure part
// (quoteReply.ts) is checked directly; the interactive part mounts ChatPanel with react-dom/client
// on the minimal DOM (fixtures/mini-dom.mjs, loaded first), stubs document.getSelection with a
// range over the real rendered nodes, fires selectionchange and presses the real button. The stub's
// toString() serialises every text node in the range, buttons included, the way Chromium does, so
// a quote built from toString() would carry UI labels.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { mergeQuoteIntoDraft, quoteFromSelection, toQuoteBlock, QUOTE_CUT_NOTE, QUOTE_LABEL, QUOTE_MAX, QUOTE_SCOPE_ATTR } from "../webview-ui/src/quoteReply";
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

// ---------- Selection fixture: a range over real mini-dom nodes ----------

type El = { localName: string; nodeName: string; data?: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; value: string; selectionStart: number; childNodes: El[]; nodeType: number; parentNode: El | null; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean; appendChild(c: El): El; setAttribute(n: string, v: string): void };
type Pt = { node: El; offset: number };
const pathOf = (p: Pt) => { const out = [p.offset]; for (let n = p.node; n.parentNode; n = n.parentNode) out.unshift(n.parentNode.childNodes.indexOf(n)); return out; };
const cmp = (a: Pt, b: Pt) => { const x = pathOf(a), y = pathOf(b); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; };
const allText = (n: El, out: El[] = []) => { for (const c of n.childNodes) { if (c.nodeType === 3) out.push(c); else if (c.nodeType === 1) allText(c, out); } return out; };
/** What Chromium's Selection.toString() gives, near enough: every text node in the range, controls included. */
const naiveText = (s: Pt, e: Pt) => allText(doc as unknown as El).map((t) => {
  const len = (t.data ?? "").length;
  const a = cmp({ node: t, offset: 0 }, s) >= 0 ? 0 : t === s.node ? s.offset : len;
  const b = cmp({ node: t, offset: len }, e) <= 0 ? len : t === e.node ? e.offset : 0;
  return b > a ? (t.data ?? "").slice(a, b) : "";
}).join("");
const sel = (s: Pt, e: Pt, collapsed = false) => {
  const range = { startContainer: s.node, startOffset: s.offset, endContainer: e.node, endOffset: e.offset };
  return { isCollapsed: collapsed, rangeCount: 1, anchorNode: s.node, anchorOffset: s.offset, focusNode: e.node, focusOffset: e.offset, getRangeAt: () => range, toString: () => naiveText(s, e) };
};
/** The point at the start of `needle` (or just after it) in the first text node under `root` holding it. */
const at = (root: El, needle: string, side: "start" | "end" = "start"): Pt => {
  const node = allText(root).find((t) => (t.data ?? "").includes(needle));
  ok(node, `no text node with ${JSON.stringify(needle)}`);
  const i = node!.data!.indexOf(needle);
  return { node: node!, offset: side === "start" ? i : i + needle.length };
};
const textStart = (root: El): Pt => ({ node: allText(root).find((t) => (t.data ?? "").trim())!, offset: 0 });
const h = (tagName: string, attrs: Record<string, string> = {}, ...kids: (El | string)[]) => {
  const e = doc.createElement(tagName) as unknown as El;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.appendChild(typeof k === "string" ? doc.createTextNode(k) as unknown as El : k);
  return e;
};
const pure = (...rows: El[]) => { const root = h("div", {}, ...rows); doc.body.appendChild(root as never); return root; };

// ---------- Pure: selection → quote text, merge with the draft ----------

t("toQuoteBlock: every line gets `> `, a blank line stays inside the quote as `>`, CRLF normalised", () => {
  eq(toQuoteBlock("첫 줄\r\n\r\n\r\n둘째 줄  \n셋째")?.block, "> 첫 줄\n>\n> 둘째 줄\n> 셋째", "block");
  eq(toQuoteBlock("\n\n  한 줄  \n\n")?.block, ">   한 줄", "outer blank lines trimmed, inner indent kept");
  eq(toQuoteBlock("한 줄")?.truncated, false, "short is not cut");
});

t("toQuoteBlock: whitespace-only selection gives no quote (negative control)", () => {
  eq(toQuoteBlock(""), null, "empty");
  eq(toQuoteBlock(" \n\t \n"), null, "whitespace");
});

t(`toQuoteBlock: longer than ${QUOTE_MAX} characters is cut on a character boundary and ends with …`, () => {
  const long = toQuoteBlock("가".repeat(QUOTE_MAX + 500))!;
  ok(long.truncated, "not marked truncated");
  eq(long.block, `> ${"가".repeat(QUOTE_MAX)}…`, "cut block");
  const emoji = toQuoteBlock("😀".repeat(QUOTE_MAX + 1))!;
  eq(Array.from(emoji.block.slice(2)).length, QUOTE_MAX + 1, "characters kept (incl. …)");
  ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji.block), "lone high surrogate");
  const exact = toQuoteBlock("나".repeat(QUOTE_MAX))!;
  ok(!exact.truncated && !exact.block.endsWith("…"), "exactly the cap is not cut");
});

t("toQuoteBlock: the cut never splits a composed emoji or an NFD Hangul syllable (grapheme clusters)", () => {
  const family = "👨‍👩‍👧";
  const f = toQuoteBlock("가".repeat(QUOTE_MAX - 1) + family + "끝")!;
  eq(f.block, `> ${"가".repeat(QUOTE_MAX - 1)}${family}…`, "ZWJ family emoji split");
  const nfd = "한".normalize("NFD");
  ok(nfd.length === 3, "fixture is not NFD");
  const k = toQuoteBlock("가".repeat(QUOTE_MAX - 1) + nfd + "끝")!;
  eq(k.block, `> ${"가".repeat(QUOTE_MAX - 1)}${nfd}…`, "NFD syllable split");
  ok(!toQuoteBlock(family.repeat(QUOTE_MAX))!.truncated, "1,000 composed emoji counted as more than 1,000");
});

t("quoteFromSelection: inside one answer → quote; spans messages, outside, collapsed → none", () => {
  const body1 = h("div", { [QUOTE_SCOPE_ATTR]: "a1" }, h("p", {}, "물은 ", h("strong", {}, "100도"), "에서 끓어요."));
  const row1 = h("div", { "data-quote-row": "a1" }, body1);
  const body2 = h("div", { [QUOTE_SCOPE_ATTR]: "a2" }, h("p", {}, "높은 산"));
  const row2 = h("div", { "data-quote-row": "a2" }, h("span", {}, "HypeProof"), body2);
  const composer = h("div", {}, h("span", {}, "입력"));
  pure(row1, row2, composer);
  const one = quoteFromSelection(sel(textStart(body1), at(body1, "100도", "end")));
  eq(one?.messageId, "a1", "message id"); eq(one?.block, "> 물은 100도", "block");
  eq(quoteFromSelection(sel(textStart(body1), at(body2, "높은", "end"))), null, "across two answers");
  eq(quoteFromSelection(sel(textStart(body1), at(composer, "입력", "end"))), null, "answer into composer");
  eq(quoteFromSelection(sel(textStart(composer), at(composer, "입력", "end"))), null, "composer only");
  eq(quoteFromSelection(sel(at(body2, "높은", "end"), at(body2, "산", "end")) && sel(textStart(row2), at(body2, "산", "end"))), null, "starts in another row's label");
  eq(quoteFromSelection(sel(textStart(body1), textStart(body1), true)), null, "collapsed");
  eq(quoteFromSelection(null), null, "no selection");
});

t("answer text only: buttons, [aria-hidden], role=status and data-quote-skip inside the range add nothing; code counts as its code", () => {
  const body = h("div", { [QUOTE_SCOPE_ATTR]: "a1" },
    h("p", {}, "첫 문단입니다."),
    h("div", { class: "hps-codepill" }, h("button", {}, h("span", {}, "코드 숨기기")),
      h("div", { class: "hps-codeblock" }, h("div", { "data-quote-skip": "" }, h("button", {}, h("span", {}, "복사")), h("button", {}, h("span", {}, "줄 바꿈")), h("span", { role: "status" }, "코드를 복사했습니다")),
        h("pre", {}, h("code", {}, "const x = 1;\nconsole.log(x);\n")))),
    h("p", {}, "번호 ", h("span", { "aria-hidden": "true" }, "1"), "있는 글", h("span", { role: "status" }, "복사했습니다")),
    h("p", {}, "마지막 문단입니다."));
  pure(h("div", { "data-quote-row": "a1" }, body));
  const s = sel(textStart(body), at(body, "마지막 문단입니다.", "end"));
  ok(/복사|줄 바꿈|코드 숨기기/.test(s.toString()), "fixture: toString() should carry the labels, as in Chromium");
  eq(quoteFromSelection(s)?.block, "> 첫 문단입니다.\n>\n> const x = 1;\n> console.log(x);\n>\n> 번호 있는 글\n>\n> 마지막 문단입니다.", "quote");
  // Starting inside the code keeps only code text.
  eq(quoteFromSelection(sel(at(body, "console"), at(body, "console.log(x);", "end")))?.block, "> console.log(x);", "code only");
});

t("triple-click: an end past the body in the same row, or at the start of the next block, is clamped to the body", () => {
  const body = h("div", { [QUOTE_SCOPE_ATTR]: "a1" }, h("p", {}, "앞 문단."), h("p", {}, "마지막 문단."));
  const rack = h("div", { class: "cp-citations" }, h("span", { class: "cp-citation-number", "aria-hidden": "true" }, "1"), h("span", {}, "출처 제목"));
  const actions = h("div", {}, h("button", {}, h("span", { class: "hps-copy-answer" }, "복사")));
  const row1 = h("div", { "data-quote-row": "a1" }, h("div", {}, "HypeProof"), body, rack, actions);
  const userBody = h("div", { class: "hps-msg-body" }, "더 알려줘");
  const row2 = h("div", { class: "hps-msg hps-msg-user" }, h("div", {}, "나"), userBody);
  pure(row1, row2);
  const lastPara = at(body, "마지막 문단.");
  eq(quoteFromSelection(sel(lastPara, { node: allText(rack)[0], offset: 0 }))?.block, "> 마지막 문단.", "end in citation number");
  eq(quoteFromSelection(sel(lastPara, at(rack, "출처", "end")))?.block, "> 마지막 문단.", "end inside citation title (same row)");
  eq(quoteFromSelection(sel(lastPara, { node: allText(actions)[0], offset: 0 }))?.block, "> 마지막 문단.", "end in copy action");
  eq(quoteFromSelection(sel(lastPara, at(userBody, "더", "end"))), null, "end inside the next message (negative control)");
  // The rack's own text is in the start row, which the same-row rule already leaves out of the quote.
  eq(quoteFromSelection(sel(lastPara, { node: row2, offset: 0 }))?.block, "> 마지막 문단.", "next row start after a rack");
  eq(quoteFromSelection(sel(lastPara, { node: userBody, offset: 0 })), null, "next row's body start, past its label (negative control)");
  // A row without citations or actions (classroom): the triple-click ends at the next row's start.
  const bare = h("div", { [QUOTE_SCOPE_ATTR]: "b1" }, h("p", {}, "하나뿐인 문단."));
  const nextRole = h("div", {}, "나");
  const next = h("div", { class: "hps-msg hps-msg-user" }, nextRole, h("div", {}, "다음 질문"));
  pure(h("div", { "data-quote-row": "b1" }, h("div", {}, "HypeProof"), bare), next);
  const only = textStart(bare);
  eq(quoteFromSelection(sel(only, { node: next, offset: 0 }))?.block, "> 하나뿐인 문단.", "end at the start of the next row");
  eq(quoteFromSelection(sel(only, { node: allText(next)[0], offset: 0 }))?.block, "> 하나뿐인 문단.", "end at offset 0 of the next row's first text");
  eq(quoteFromSelection(sel(only, at(next, "나", "end"))), null, "end after text of the next row (negative control)");
});

t("tables: cells are joined with ` | `, rows with a line break; lists: one line per item; a soft break is a space", () => {
  const body = h("div", { [QUOTE_SCOPE_ATTR]: "t1" },
    h("table", {}, "\n", h("thead", {}, "\n", h("tr", {}, "\n", h("th", {}, "이름"), "\n", h("th", {}, "나이"), "\n"), "\n"),
      h("tbody", {}, "\n", h("tr", {}, "\n", h("td", {}, "철수"), "\n", h("td", {}, "10"), "\n"), "\n")),
    "\n",
    h("ul", {}, "\n", h("li", {}, "하나"), "\n", h("li", {}, "둘"), "\n"),
    "\n",
    h("p", {}, "줄1\n줄2"),
    h("pre", {}, h("code", {}, "a\n  b\n")));
  pure(h("div", { "data-quote-row": "t1" }, body));
  eq(quoteFromSelection(sel(textStart(body), at(body, "  b", "end")))?.block, "> 이름 | 나이\n> 철수 | 10\n>\n> 하나\n> 둘\n>\n> 줄1 줄2\n>\n> a\n>   b", "quote");
});

/** Counts every childNodes/getAttribute/nextSibling read on the nodes of `roots`' subtrees. */
function instrument(roots: El[]) {
  let reads = 0;
  const wrap = (e: El) => {
    const kids = e.childNodes; const getAttr = e.getAttribute.bind(e);
    Object.defineProperty(e, "childNodes", { configurable: true, get: () => { reads++; return kids; } });
    (e as unknown as { getAttribute(n: string): string | null }).getAttribute = (n: string) => { reads++; return getAttr(n); };
    for (const c of kids) if (c.nodeType === 1) wrap(c); else Object.defineProperty(c, "nextSibling", { configurable: true, get: () => { reads++; return null; } });
  };
  for (const r of roots) wrap(r);
  return () => reads;
}

t("long chats: a selection reads only the start answer (and the end's own ancestors), never the other answers", () => {
  const conversation = (n: number) => {
    const rows: El[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(h("div", { class: "hps-msg hps-msg-user" }, h("div", {}, "나"), h("div", { class: "hps-msg-body" }, `질문 ${i}`)));
      rows.push(h("div", { class: "hps-msg hps-msg-assistant", "data-quote-row": `a${i}` }, h("div", {}, "HypeProof"),
        h("div", { class: "hps-msg-body", [QUOTE_SCOPE_ATTR]: `a${i}` }, h("p", {}, `답 ${i} 첫 문단.`), h("p", {}, `답 ${i} 끝.`))));
    }
    const composer = h("div", { class: "hps-input" }, h("span", {}, "메시지를 입력하세요"));
    const list = h("div", { class: "hps-messages" }, ...rows);
    pure(list, composer);
    return { rows, list, composer, body: (i: number) => rows[2 * i + 1].findAll((e) => e.getAttribute(QUOTE_SCOPE_ATTR) === `a${i}`)[0] };
  };
  for (const n of [30, 300]) {
    const c = conversation(n);
    const mid = Math.floor(n / 2);
    const startRow = c.rows[2 * mid + 1]; const nextRow = c.rows[2 * mid + 2]; const farRow = c.rows[2 * mid + 5];
    const body = c.body(mid);
    const start = at(body, `답 ${mid} 끝.`);
    const cases: [string, ReturnType<typeof sel>, string | null][] = [
      ["inside", sel(at(body, `답 ${mid} 첫`), at(body, `답 ${mid} 끝.`, "end")), `> 답 ${mid} 첫 문단.\n>\n> 답 ${mid} 끝.`],
      ["next row start", sel(start, { node: nextRow, offset: 0 }), `> 답 ${mid} 끝.`],
      ["into next message", sel(start, at(nextRow, `질문 ${mid + 1}`, "end")), null],
      ["into a far answer", sel(start, at(farRow, "끝.", "end")), null],
      ["into the composer", sel(start, at(c.composer, "입력", "end")), null],
      ["starts outside", sel(at(nextRow, "질문"), at(farRow, "끝.", "end")), null],
    ];
    // Everything except the start row and each case's end row is a trap; they must stay unread.
    for (const [name, s, want] of cases) {
      const endRow = c.rows.find((r) => r === s.focusNode || r.findAll(() => true).includes(s.focusNode as never) || allText(r).includes(s.focusNode as never));
      const traps = c.rows.filter((r) => r !== startRow && r !== endRow && !(name === "starts outside" && r === nextRow));
      const count = instrument(traps);
      // The message list itself: a browser's nextSibling is a pointer; one mini-dom nextSibling reads the list twice.
      let listReads = 0; const kids = c.list.childNodes;
      Object.defineProperty(c.list, "childNodes", { configurable: true, get: () => { listReads++; return kids; } });
      eq(quoteFromSelection(s)?.block ?? null, want, `${n} answers, ${name}`);
      ok(count() === 0, `${n} answers, ${name}: ${count()} reads in other answers`);
      ok(listReads <= 2, `${n} answers, ${name}: the message list was read ${listReads} times`);
    }
    (c.list as unknown as { remove(): void }).remove(); (c.composer as unknown as { remove(): void }).remove();
  }
});

t("selectionchange is read at most once per animation frame (a drag fires it on every mouse move)", async () => {
  const v = await mount(personal);
  const target = at(v.body("a1"), "물은");
  let reads = 0;
  const real = (doc as unknown as { getSelection: () => unknown }).getSelection;
  (doc as unknown as { getSelection: () => unknown }).getSelection = () => { reads++; return real(); };
  current = sel(target, at(v.body("a1"), "물은", "end"));
  await act(async () => { for (let i = 0; i < 20; i++) fire(doc as unknown as El, "selectionchange", { bubbles: false }); await new Promise((r) => setTimeout(r, 5)); });
  (doc as unknown as { getSelection: () => unknown }).getSelection = real;
  eq(reads, 1, "selection reads for 20 events in one frame");
  eq(v.buttons().length, 1, "button after the frame");
  await v.unmount();
});

t("mergeQuoteIntoDraft: keeps the draft as the exact prefix, one blank line before and after the quote", () => {
  eq(mergeQuoteIntoDraft("", "> q"), "> q\n\n", "empty draft");
  eq(mergeQuoteIntoDraft("안녕", "> q"), "안녕\n\n> q\n\n", "draft without newline");
  eq(mergeQuoteIntoDraft("안녕\n", "> q"), "안녕\n\n> q\n\n", "draft with one newline");
  eq(mergeQuoteIntoDraft("안녕\n\n", "> q"), "안녕\n\n> q\n\n", "draft with a blank line");
  ok(mergeQuoteIntoDraft("  첫 생각  ", "> q").startsWith("  첫 생각  "), "draft text changed");
});

t("CSS: 44px target, tokens only for motion, no score or capability wording in the slice", () => {
  const css = designValues(readFileSync("webview-ui/src/quoteAction.css", "utf8"));
  const btn = /\.hps-quote-action \{([^}]*)\}/.exec(css)?.[1] ?? "";
  ok(/min-height: 44px/.test(btn) && /min-width: 44px/.test(btn), "44px");
  ok(/var\(--hp-dur-/.test(css) && !/\d+m?s\b/.test(css.replace(/var\([^)]*\)/g, "")), "literal duration");
  const src = readFileSync("webview-ui/src/quoteReply.ts", "utf8") + readFileSync("webview-ui/src/QuoteAction.tsx", "utf8");
  ok(!/FRAMING|JUDGMENT|ORCHESTRATE|VERIFY|OWNERSHIP|점수|역량/.test(src), "capability/score label");
  eq(QUOTE_LABEL, "인용하기", "label");
});

// ---------- Interactive: ChatPanel, a stubbed selection, real button presses ----------

let current: ReturnType<typeof sel> | null = null;
(doc as unknown as { getSelection: () => unknown }).getSelection = () => current && { ...current, removeAllRanges: () => { current = null; } };
const fire = (target: { dispatchEvent(e: object): boolean }, type: string, extra: object = {}) => target.dispatchEvent({
  type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), ...extra,
  preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() { (this as { _stopped: boolean })._stopped = true; },
});
// The hook reads the selection on the next animation frame (mini-dom: a 0ms timer), so wait for it.
const selectionChange = () => act(async () => { fire(doc as unknown as El, "selectionchange", { bubbles: false }); await new Promise((r) => setTimeout(r, 5)); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = (el: El) => act(async () => { click(el); });
const cls = (e: El) => (e.getAttribute("class") ?? "").split(" ");

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
  const select = async (s: Pt, e: Pt) => { current = sel(s, e); await selectionChange(); };
  const quote = async () => { eq(buttons().length, 1, "quote buttons"); await press(buttons()[0]); await settle(); return textarea().value; };
  return { host, body, buttons, textarea, select, quote, unmount: () => act(async () => root.unmount()) };
}
/** The answer text (not the speaker label) of the last or first assistant row, whatever its marking. */
const answerBody = (host: El, which: "first" | "last") => {
  const rows = host.findAll((e) => cls(e).includes("hps-msg-assistant"));
  const row = which === "first" ? rows[0] : rows[rows.length - 1];
  return row.findAll((e) => (e.getAttribute("class") ?? "") === "hps-msg-body")[0];
};
const rowOf = (e: El) => { let n: El | null = e.nodeType === 1 ? e : e.parentNode; while (n && !cls(n).includes("hps-msg")) n = n.parentNode; return n!; };

const RICH = "첫 문단입니다.\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\n중간 문단.\n\n~~~\nnpm test\n~~~\n\n마지막 문단입니다.";

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: select inside an answer → 인용하기 under that answer → press → draft is the > block, focus at its end, nothing sent`, async () => {
    let sent = 0;
    const v = await mount(config, CONVO, { onSend: () => { sent++; } });
    ok(v.body("a1") && v.body("a2"), "answers not marked quotable");
    ok(!v.host.findAll((e) => e.getAttribute(QUOTE_SCOPE_ATTR) === "u1").length, "a user line is quotable");
    eq(v.buttons().length, 0, "button before any selection");
    await v.select(at(v.body("a1"), "100도"), at(v.body("a1"), "끓어요", "end"));
    eq(v.buttons().length, 1, "button count after selecting");
    ok(rowOf(v.buttons()[0]) === rowOf(v.body("a1")), "button is not under the selected answer");
    eq(rowOf(v.body("a1")).getAttribute("data-quote-row"), "a1", "row not marked for the same-message clamp");
    eq(await v.quote(), "> 100도에서 끓어요\n\n", "draft");
    ok(doc.activeElement === (v.textarea() as unknown), "composer not focused");
    eq(v.textarea().selectionStart, v.textarea().value.length, "caret not at the end");
    eq(v.buttons().length, 0, "button still shown after quoting");
    eq(current, null, "selection not cleared");
    eq(sent, 0, "quoting sent a message");
    await v.unmount();
  });

  t(`${mode}: button and pill labels never enter the quote (closed pill, open pill with 복사 / 줄 바꿈, prose code block)`, async () => {
    const v = await mount(config, [u("u1", "코드 보여줘"), a("a1", RICH)]);
    const b = () => v.body("a1");
    const label = mode === "personal" ? "코드 보기 · 2줄" : "코드 보기 (2줄)";
    ok(b().textContent.includes(label) && b().textContent.includes("줄 바꿈"), `fixture: labels not rendered inside the body: ${b().textContent}`);
    await v.select(textStart(b()), at(b(), "마지막 문단입니다.", "end"));
    ok(current!.toString().includes("복사"), "fixture: toString() should carry the labels");
    eq(await v.quote(), "> 첫 문단입니다.\n>\n> 중간 문단.\n>\n> npm test\n>\n> 마지막 문단입니다.\n\n", "closed pill");
    const toggle = v.host.findAll((e) => cls(e).includes("hps-codepill-toggle"))[0];
    await press(toggle);
    await v.select(textStart(b()), at(b(), "마지막 문단입니다.", "end"));
    const tools = v.host.findAll((e) => cls(e).includes("hps-codeblock-tools"));
    ok(tools.length === 2 && tools.every((e) => e.getAttribute("data-quote-skip") === ""), "code-block tool rows not marked data-quote-skip");
    const draft = await v.quote();
    eq(draft.slice(draft.indexOf("> 첫 문단입니다.", 2)), "> 첫 문단입니다.\n>\n> const x = 1;\n> console.log(x);\n>\n> 중간 문단.\n>\n> npm test\n>\n> 마지막 문단입니다.\n\n", "open pill");
    ok(!/복사|줄 바꿈|코드 숨기기|코드 보기/.test(draft), `labels leaked: ${JSON.stringify(draft)}`);
    await v.unmount();
  });

  t(`${mode}: a selection across two messages, or from an answer into a user line, gives no button (negative control)`, async () => {
    const v = await mount(config);
    await v.select(textStart(v.body("a1")), at(v.body("a2"), "높은 산", "end"));
    eq(v.buttons().length, 0, "across answers");
    const userLine = v.host.findAll((e) => cls(e).includes("hps-msg-user"))[1];
    await v.select(textStart(v.body("a1")), at(userLine, "더 알려줘", "end"));
    eq(v.buttons().length, 0, "answer into user line");
    await v.select(at(userLine, "더"), at(userLine, "더 알려줘", "end"));
    eq(v.buttons().length, 0, "user line alone");
    await v.unmount();
  });

  t(`${mode}: triple-click on a one-paragraph answer (end at the next row's start) shows the button and quotes the paragraph`, async () => {
    const v = await mount(config);
    const next = rowOf(at(v.host, "더 알려줘").node);
    await v.select(textStart(v.body("a1")), { node: next, offset: 0 });
    eq(await v.quote(), "> 물은 100도에서 끓어요.\n\n", "quote");
    await v.unmount();
  });

  t(`${mode}: an existing draft is kept and the quote follows it`, async () => {
    const v = await mount(withDraft(config, "내 생각은"));
    eq(v.textarea().value, "내 생각은", "draft restored");
    await v.select(at(v.body("a2"), "높은 산에서는"), at(v.body("a2"), "낮은 온도", "end"));
    eq(await v.quote(), "내 생각은\n\n> 높은 산에서는 더 낮은 온도\n\n", "merged draft");
    // A second quote also keeps everything that is there.
    await v.select(at(v.body("a1"), "100도"), at(v.body("a1"), "100도", "end"));
    eq(await v.quote(), "내 생각은\n\n> 높은 산에서는 더 낮은 온도\n\n> 100도\n\n", "second quote");
    await v.unmount();
  });
}

t("personal: triple-click on the last paragraph ends in the citation rack or the copy action; still quotes the paragraph", async () => {
  const cited = { ...a("a1", "앞 문단.\n\n마지막 문단."), citations: [{ url: "https://example.org/a", title: "출처 제목", domain: "example.org", tier: 1 as const }] };
  const v = await mount(personal, [u("u1", "알려줘"), cited]);
  const row = rowOf(v.body("a1"));
  const rack = row.findAll((e) => cls(e).includes("cp-citation-number"))[0];
  ok(rack, "citation rack not rendered");
  await v.select(at(v.body("a1"), "마지막 문단."), { node: allText(rack)[0], offset: 0 });
  eq(v.buttons().length, 1, "no button when the end is in the citation number");
  const copy = row.findAll((e) => e.getAttribute("aria-label") === "답변 복사")[0];
  ok(copy, "copy action not rendered");
  await v.select(at(v.body("a1"), "마지막 문단."), { node: allText(copy)[0], offset: 0 });
  eq(await v.quote(), "> 마지막 문단.\n\n", "quote");
  await v.unmount();
});

t("reply-choice answers: the choice buttons and help line never enter the quote", async () => {
  const q = "설명 글이에요.\n\n어느 쪽이 가까웠나요?\n1. 설치가 먼저\n2. 실행이 먼저\n\n뒤의 설명.";
  const v = await mount(personal, [u("u1", "골라줘"), a("a1", q)]);
  const b = v.body("a1");
  ok(v.host.findAll((e) => e.getAttribute("class") === "hps-reply-question").length === 1, "not drawn as a choice question");
  ok(b.textContent.includes("직접 입력"), "fixture: help not inside the body");
  ok(["hps-reply-choices", "hps-choice-help"].every((c) => v.host.findAll((e) => cls(e).includes(c))[0]?.getAttribute("data-quote-skip") === ""), "choice controls not marked data-quote-skip");
  await v.select(textStart(b), at(b, "뒤의 설명.", "end"));
  const draft = await v.quote();
  ok(!/설치가 먼저|실행이 먼저|직접 입력|선택하면/.test(draft), `controls leaked: ${JSON.stringify(draft)}`);
  ok(draft.startsWith("> 설명 글이에요.") && draft.endsWith("> 뒤의 설명.\n\n"), `draft ${JSON.stringify(draft)}`);
  await v.unmount();
});

t("a selection in the composer or other UI gives no button (negative control)", async () => {
  const v = await mount(withDraft(personal, "입력 중인 글"));
  await v.select({ node: v.textarea(), offset: 0 }, { node: v.textarea(), offset: 0 });
  eq(v.buttons().length, 0, "composer");
  const parent = v.textarea().parentNode!;
  await v.select({ node: parent, offset: 0 }, { node: parent, offset: parent.childNodes.length });
  eq(v.buttons().length, 0, "composer chrome");
  await v.unmount();
});

t("collapsing the selection hides the button; Escape dismisses it, keeps the draft and returns focus to the composer", async () => {
  const v = await mount(withDraft(personal, "초안"));
  const pick = () => v.select(at(v.body("a1"), "물은"), at(v.body("a1"), "물은", "end"));
  await pick();
  eq(v.buttons().length, 1, "shown");
  current = null; await selectionChange();
  eq(v.buttons().length, 0, "still shown after the selection went away");
  await pick();
  const btn = v.buttons()[0] as unknown as { focus(): void };
  btn.focus();
  await act(async () => { fire(v.buttons()[0], "keydown", { key: "Escape", keyCode: 27 }); });
  eq(v.buttons().length, 0, "Escape did not dismiss");
  eq(v.textarea().value, "초안", "Escape changed the draft");
  ok(doc.activeElement === (v.textarea() as unknown), `focus after Escape: ${(doc.activeElement as unknown as El)?.localName}`);
  await v.unmount();
});

t("keyboard: the button stays while it has focus even if the selection collapses (Tab to it)", async () => {
  const v = await mount(personal);
  await v.select(at(v.body("a1"), "물은"), at(v.body("a1"), "물은", "end"));
  const btn = v.buttons()[0] as unknown as { focus(): void };
  btn.focus();
  current = null; await selectionChange();
  eq(v.buttons().length, 1, "button vanished when focus moved to it");
  eq(await v.quote(), "> 물은\n\n", "draft from the stored quote");
  await v.unmount();
});

t(`longer than ${QUOTE_MAX} characters: the button says so and the draft ends with …`, async () => {
  const v = await mount(personal, [u("u1", "길게"), a("a1", "가".repeat(QUOTE_MAX + 10))]);
  await v.select(textStart(v.body("a1")), at(v.body("a1"), "가".repeat(QUOTE_MAX + 10), "end"));
  ok(v.host.findAll((e) => e.textContent === QUOTE_CUT_NOTE).length === 1, "cut note missing");
  eq(await v.quote(), `> ${"가".repeat(QUOTE_MAX)}…\n\n`, "cut draft");
  await v.unmount();
  const short = await mount(personal);
  await short.select(at(short.body("a1"), "물은"), at(short.body("a1"), "물은", "end"));
  eq(short.host.findAll((e) => e.textContent === QUOTE_CUT_NOTE).length, 0, "cut note on a short quote");
  await short.unmount();
});

t("the answer that is still streaming is not quotable; finished ones are", async () => {
  const v = await mount(personal, CONVO, { streaming: true, streamingId: "a2" });
  ok(!v.body("a2"), "streaming answer is marked quotable");
  const live = answerBody(v.host, "last");
  await v.select(at(live, "높은 산"), at(live, "높은 산", "end"));
  eq(v.buttons().length, 0, "button on the streaming answer");
  await v.select(at(v.body("a1"), "물은"), at(v.body("a1"), "물은", "end"));
  eq(v.buttons().length, 1, "finished answer during a stream");
  await v.unmount();
});

t("an unverified activity (composer read-only) offers no quote (negative control)", async () => {
  const v = await mount(unverified(personal));
  const b = answerBody(v.host, "first");
  ok(b.getAttribute(QUOTE_SCOPE_ATTR) === "a1", "fixture: the body is still marked, so only the gate can hide the button");
  await v.select(at(b, "물은"), at(b, "물은", "end"));
  eq(v.buttons().length, 0, "button while unavailable");
  await v.unmount();
});

t("IME guard: while a composition is open the button is disabled and pressing it changes nothing", async () => {
  const v = await mount(withDraft(personal, "한"));
  await act(async () => { fire(v.textarea(), "compositionstart", { data: "" }); });
  await v.select(at(v.body("a1"), "물은"), at(v.body("a1"), "물은", "end"));
  ok(v.buttons()[0].hasAttribute("disabled"), "not disabled while composing");
  await press(v.buttons()[0]);
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

function designValues(css: string): string { return staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(css); }
