// CGP-CHAT-R-022 (REQ-STUDIO-ANSWER-MATH): streaming cost in the live DOM. Every streamed chunk
// renders the answer text again; a finished formula must not be typeset or rendered by React
// again, so a long math answer costs about as much per chunk as the same answer without math.
import { mountPoint } from './fixtures/mini-dom.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownText } from '../webview-ui/src/MarkdownText';
import { clearTypesetCache, loadMath, mathElementCallCount, typesetCallCount } from '../webview-ui/src/mathRender';

for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let fail = 0;
const ok = (v: unknown, m: string) => { if (!v) { console.error(`  FAIL ${m}`); fail++; } };

const FORMULA = "\\int_0^1 \\frac{x^2+1}{\\sqrt{1-x^2}}\\,dx = \\sum_{k=0}^{\\infty} \\binom{2k}{k} \\frac{(-1)^k}{4^k}";
let answer = "";
for (let i = 0; i < 50; i++) answer += `단계 ${i} 설명이에요.\n\n$$\n${FORMULA}\n$$\n\n그리고 $x_{${i}}^2$ 이에요.\n\n`;
const chunksOf = (text: string) => { const c: string[] = []; for (let n = 300; n < text.length; n += 300) c.push(text.slice(0, n)); c.push(text); return c; };

async function stream(host: any, text: string) {
  const root = createRoot(host);
  const chunks = chunksOf(text);
  const t0 = performance.now();
  for (const c of chunks) await act(async () => root.render(<MarkdownText text={c} />));
  const ms = performance.now() - t0;
  const displays = host.findAll((e: any) => (e.getAttribute('class') ?? '').split(' ').includes('katex-display')).length;
  await act(async () => root.unmount());
  return { ms, chunks: chunks.length, displays };
}

async function main() {
  await loadMath();
  clearTypesetCache();
  const calls0 = typesetCallCount(), renders0 = mathElementCallCount();
  const math = await stream(mountPoint(), answer);
  const calls = typesetCallCount() - calls0, renders = mathElementCallCount() - renders0;
  console.log(`  100 formulas, ${math.chunks} chunks: ${math.ms.toFixed(0)} ms, ${calls} KaTeX runs, ${renders} formula renders`);
  ok(math.displays === 50, 'final DOM does not hold 50 display formulas');
  // Each finished formula is typeset once; at most one unfinished formula per chunk on top.
  ok(calls <= 100 + math.chunks, `${calls} KaTeX runs for ${math.chunks} chunks`);
  // React renders a formula when it first appears (and the unfinished tail formula per chunk);
  // without the memo this was every formula on every chunk (~100 x chunks / 2).
  ok(renders <= 100 + 2 * math.chunks, `${renders} formula renders for ${math.chunks} chunks`);

  const plain = await stream(mountPoint(), answer.replace(/\$/g, ''));
  console.log(`  same answer without math: ${plain.ms.toFixed(0)} ms`);
  // Measured on a dev Mac: 240-290 ms with math vs 70-90 ms plain (~3.5x, first typesetting included).
  // 6x + 500 ms leaves CI room.
  ok(math.ms < plain.ms * 6 + 500, `math stream ${math.ms.toFixed(0)} ms vs plain ${plain.ms.toFixed(0)} ms`);

  if (fail) { console.error(`answer-math-stream: ${fail} failed`); process.exit(1); }
  console.log('answer-math-stream OK');
}
// Exit explicitly: React's scheduler keeps a MessageChannel open.
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
