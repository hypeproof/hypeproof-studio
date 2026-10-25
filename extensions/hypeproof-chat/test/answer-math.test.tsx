// CGP-CHAT-R-022 (REQ-STUDIO-ANSWER-MATH): `$…$` and `$$…$$` in an answer render as math; invalid
// or refused TeX, and dollar signs that read as money, stay the exact raw source.
// Static markup through the real MarkdownText and ChatPanel (both seats). The browser half
// (fonts, computed layout, copy) is test/answer-math.smoke.mjs.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "../webview-ui/src/MarkdownText";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MAX_FORMULAS_PER_TEXT, MAX_TEX_CHARS_PER_TEXT, MAX_TEX_LENGTH, MATH_BLOCK_LABEL, clearTypesetCache, loadMath, looksLikeInlineMath, typesetCallCount, typesetTex } from "../webview-ui/src/mathRender";
import type { ChatConfig, ChatMessage } from "../src/protocol";

let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const md = (text: string) => renderToStaticMarkup(<MarkdownText text={text} />);
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** The TeX sources KaTeX recorded for every typeset formula (its MathML annotation). */
const annotations = (html: string) => [...html.matchAll(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/g)].map(m => decode(m[1]));
const raws = (html: string) => [...html.matchAll(/<span class="hps-math-raw">([\s\S]*?)<\/span>/g)].map(m => decode(m[1]));
const count = (html: string, needle: string) => html.split(needle).length - 1;
/** Visible text with tags removed. */
const text = (html: string) => decode(html.replace(/<annotation[\s\S]*?<\/annotation>/g, "").replace(/<[^>]+>/g, ""));

// KaTeX is a lazily loaded chunk: before it has loaded, math shows as its exact raw source and
// the first math span starts the load. An answer without math never starts it.
t("before KaTeX loads, math stays raw text and the load starts on the first math span", () => {
  ok(md("수식 없는 답변이에요. 가격은 $5예요.").indexOf("katex") === -1, "no-math text rendered math");
  const html = md("넓이는 $\\pi r^2$이에요.");
  ok(!html.includes("katex") && JSON.stringify(raws(html)) === JSON.stringify(["$\\pi r^2$"]), `pre-load ${html}`);
});
// Everything below runs once the KaTeX chunk has loaded.
void loadMath().then(() => {

t("inline $…$ renders as math, with its TeX kept for assistive tech and copy (positive control)", () => {
  const html = md("넓이는 $\\pi r^2$이에요.");
  ok(count(html, 'class="hps-math-inline"') === 1, "no inline math span");
  ok(html.includes('class="katex"'), "KaTeX did not typeset");
  ok(html.includes("<math"), "no MathML for screen readers");
  ok(JSON.stringify(annotations(html)) === JSON.stringify(["\\pi r^2"]), `annotation ${JSON.stringify(annotations(html))}`);
  ok(!text(html).includes("$"), "dollar delimiters still visible");
  ok(text(html).startsWith("넓이는 ") && text(html).endsWith("이에요."), "surrounding Korean text changed");
});

t("$$ … $$ on its own lines is a labelled, keyboard-scrollable display block", () => {
  const html = md("근의 공식:\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n\n끝.");
  ok(count(html, `<div class="hps-math-block" role="region" aria-label="${MATH_BLOCK_LABEL}" tabindex="0">`) === 1, `block markup ${html.slice(0, 400)}`);
  ok(html.includes('class="katex-display"'), "not display mode");
  ok(JSON.stringify(annotations(html)) === JSON.stringify(["x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}"]), `annotation ${JSON.stringify(annotations(html))}`);
  ok(!html.includes("<pre") && !html.includes("hps-codeblock"), "display math rendered as a code block");
});

t("$$x$$ alone on one line is a display block; $$x$$ inside a sentence stays inline", () => {
  const alone = md("$$E = mc^2$$");
  ok(count(alone, 'class="hps-math-block"') === 1 && alone.includes("katex-display"), "one-line display not a block");
  ok(!alone.includes("<p>"), "block left inside a paragraph");
  const inline = md("공식 $$E = mc^2$$ 를 봐요");
  ok(count(inline, 'class="hps-math-inline"') === 1 && !inline.includes("katex-display") && !inline.includes("hps-math-block"), "inline $$ became a block");
});

t("invalid TeX falls back to the exact raw source, never a KaTeX error", () => {
  const inline = md("틀린 식 $\\frac{1}{$ 이에요");
  ok(!inline.includes("katex"), "KaTeX output for invalid TeX");
  ok(JSON.stringify(raws(inline)) === JSON.stringify(["$\\frac{1}{$"]), `raw ${JSON.stringify(raws(inline))}`);
  const display = md("$$\n\\notacommand{x}\n$$");
  ok(!display.includes("katex"), "KaTeX output for unknown command");
  ok(display.includes('class="hps-math-block hps-math-block-raw"') && !display.includes('role="region"'), "raw display block markup");
  ok(JSON.stringify(raws(display)) === JSON.stringify(["$$\n\\notacommand{x}\n$$"]), `raw ${JSON.stringify(raws(display))}`);
  ok(typesetTex("\\frac{1}{", false) === null, "typesetTex accepted invalid TeX");
});

t("dollar amounts stay text (Pandoc's single-dollar rule)", () => {
  for (const s of ["가격은 $5이고 $10이에요", "between $5-$6 range", "$ 3 $"]) {
    const html = md(s);
    ok(!html.includes("katex"), `typeset money: ${s}`);
    ok(text(html) === s, `text changed: ${JSON.stringify(text(html))} vs ${JSON.stringify(s)}`);
  }
  ok(looksLikeInlineMath("$x$", "를"), "valid inline rejected");
  ok(!looksLikeInlineMath("$5 and $", "1"), "money accepted");
  ok(!looksLikeInlineMath("$ 3 $", ""), "padded dollars accepted");
  ok(!looksLikeInlineMath("$5-$", "6"), "digit after closing accepted");
  ok(looksLikeInlineMath("$$ x $$", "1"), "$$ must always count as math");
});

t("escaped dollars and code spans are not math", () => {
  ok(!md("가격 \\$5 와 \\$6").includes("katex"), "escaped dollars typeset");
  const code = md("코드 `$x^2$` 예요");
  ok(!code.includes("katex") && code.includes("<code>$x^2$</code>"), `code span changed ${code}`);
});

t("model TeX cannot link, load or inject: a command that asks for trust shows its exact raw source", () => {
  for (const s of ["$\\href{https://evil.example}{x}$", "$\\url{javascript:alert(1)}$", "$\\includegraphics{https://evil.example/a.png}$", "$\\htmlClass{hps-shell}{x}$", "$\\htmlStyle{position:fixed}{x}$", "$\\htmlData{x=1}{x}$", "$\\htmlId{hps-root}{x}$", "$a + \\href{https://evil.example}{click} + b$"]) {
    const html = md(s);
    // Tags only: the raw source itself is visible text, so "javascript:" may appear as text.
    const tags = (html.match(/<[^>]+>/g) ?? []).join("");
    ok(!/<a\b|href=|<img\b|src=|javascript:|evil\.example|style=|id="hps-root"|hps-shell/.test(tags), `unsafe output for ${s}: ${html.slice(0, 300)}`);
    ok(!html.includes("katex") && !html.toLowerCase().includes("#cc0000"), `KaTeX error glyph for ${s}: ${html.slice(0, 300)}`);
    ok(JSON.stringify(raws(html)) === JSON.stringify([s]), `raw ${JSON.stringify(raws(html))} for ${s}`);
    ok(text(html) === s, `visible text ${JSON.stringify(text(html))} for ${s}`);
  }
  const display = md("$$\n\\href{https://evil.example}{click}\n$$");
  ok(!display.includes("katex") && JSON.stringify(raws(display)) === JSON.stringify(["$$\n\\href{https://evil.example}{click}\n$$"]), `display raw ${display}`);
  ok(typesetTex("\\href{https://evil.example}{x}", false) === null, "typesetTex accepted a trust command");
  ok(!md("$<script>alert(1)</script>$").includes("<script"), "raw HTML from TeX");
});

t("oversized TeX is shown raw, not typeset", () => {
  const big = "x+".repeat(MAX_TEX_LENGTH / 2 + 1) + "x";
  const html = md(`$${big}$`);
  ok(!html.includes("katex") && raws(html)[0] === `$${big}$`, "oversized TeX typeset");
});

// Streaming re-renders the whole text on every chunk. Finished formulas come from the cache, and
// one text never typesets more than the per-text budget, whatever the model writes.
const FORMULA = "\\int_0^1 \\frac{x^2+1}{\\sqrt{1-x^2}}\\,dx = \\sum_{k=0}^{\\infty} \\binom{2k}{k} \\frac{(-1)^k}{4^k}";
let longAnswer = "";
for (let i = 0; i < 50; i++) longAnswer += `단계 ${i} 설명이에요.\n\n$$\n${FORMULA}\n$$\n\n그리고 $x_{${i}}^2$ 이에요.\n\n`;
t("streaming 100 formulas typesets each finished formula once (cache)", () => {
  clearTypesetCache();
  const chunks: string[] = [];
  for (let n = 400; n < longAnswer.length; n += 400) chunks.push(longAnswer.slice(0, n));
  chunks.push(longAnswer);
  const before = typesetCallCount();
  let last = "";
  for (const c of chunks) last = md(c);
  const calls = typesetCallCount() - before;
  ok(count(last, "katex-display") === 50 && count(last, 'class="hps-math-inline"') === 50, `final render ${count(last, "katex-display")} display / ${count(last, 'class="hps-math-inline"')} inline`);
  // 100 distinct formulas plus at most one partial (unfinished) formula per chunk.
  ok(calls <= 100 + chunks.length, `${calls} KaTeX runs for ${chunks.length} chunks`);
  // A re-render of the finished answer typesets nothing new.
  const again = typesetCallCount();
  md(longAnswer);
  ok(typesetCallCount() === again, "finished answer re-typeset");
  // The live-DOM half (finished formulas are not re-rendered by React) is answer-math-stream.test.tsx.
});

t("hostile input: one text never typesets more than the per-text budget; the rest stays raw", () => {
  clearTypesetCache();
  // The verifier's probe: 40 display blocks of ~3.6k chars each (4.6 s per render before the budget).
  // Each block differs (its last term), so the cache cannot hide the cost.
  const blocks = Array.from({ length: 40 }, (_, i) => "\\frac{1}{x}+".repeat(300) + i);
  const hostile = blocks.map(b => "$$\n" + b + "\n$$\n\n").join("");
  const block = blocks[0];
  const before = typesetCallCount();
  const t0 = performance.now();
  const html = md(hostile);
  const ms = performance.now() - t0;
  const typeset = count(html, "katex-display");
  ok(typeset === Math.floor(MAX_TEX_CHARS_PER_TEXT / block.length), `${typeset} blocks typeset`);
  ok(raws(html).length === 40 - typeset && JSON.stringify(raws(html)) === JSON.stringify(blocks.slice(typeset).map(b => "$$\n" + b + "\n$$")), "over-budget blocks not exact raw");
  ok(typesetCallCount() - before === typeset, "KaTeX ran for over-budget blocks");
  // Measured ~180 ms on a dev Mac for the two typeset blocks (was 4.6 s). 2 s leaves CI room.
  ok(ms < 2000, `hostile render took ${ms.toFixed(0)} ms`);
  // Many small formulas: the count cap.
  const many = Array.from({ length: MAX_FORMULAS_PER_TEXT + 20 }, (_, i) => `$x_{${i}}$`).join(" ");
  const manyHtml = md(many);
  ok(count(manyHtml, 'class="hps-math-inline"') === MAX_FORMULAS_PER_TEXT && raws(manyHtml).length === 20, `count cap: ${count(manyHtml, 'class="hps-math-inline"')} typeset`);
  ok(raws(manyHtml)[0] === `$x_{${MAX_FORMULAS_PER_TEXT}}$`, "first over-cap formula not raw");
});

t("an unclosed $$ while streaming shows raw text, and closes into math", () => {
  const partial = md("식:\n\n$$\n\\frac{1}{");
  ok(!partial.includes("katex") && raws(partial).length === 1, "partial display typeset or lost");
  const done = md("식:\n\n$$\n\\frac{1}{2}\n$$");
  ok(done.includes("katex-display"), "closed display not typeset");
});

// ---------- Through the chat panel, both seats ----------
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
const ANSWER = "넓이는 $\\pi r^2$이고\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\n가격은 $5이고 $10이에요.";
for (const [seat, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${seat}: an answer renders its math; the user's own message is not typeset`, () => {
    const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={config} instructor={false} messages={[
      { id: "u1", role: "user", content: "합 공식 $x$", createdAt: 1 },
      { id: "a1", role: "assistant", content: ANSWER, createdAt: 2 },
    ]} />);
    ok(count(html, 'class="hps-math-inline"') === 1 && count(html, 'class="hps-math-block"') === 1, `math count in ${seat}`);
    ok(JSON.stringify(annotations(html)) === JSON.stringify(["\\pi r^2", "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"]), `annotations ${JSON.stringify(annotations(html))}`);
    ok(text(html).includes("가격은 $5이고 $10이에요."), "money text changed");
    ok(text(html).includes("합 공식 $x$") && count(html, "katex-display") === 1, "user message altered");
  });
}

if (fail) { console.error(`answer-math: ${fail} failed`); process.exit(1); }
console.log("answer-math OK");
});
