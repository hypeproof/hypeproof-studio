// CGP-SHELL-R-026 — the link confirm dialog is Studio's own UI (LinkConfirmDialog, mounted by App from a host message),
// outside the message-markdown path. Model output and chat content render through MarkdownText, which must not be able
// to draw anything that looks like the dialog or answer it: no <dialog>, none of its class names or data attributes,
// no buttons. Raw HTML in a message is shown as text.
// Run: node scripts/run-tsx-tests.mjs link-confirm-render
import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownText } from '../webview-ui/src/MarkdownText';

void React;
let n = 0;
const t = (label: string, fn: () => void) => { fn(); n++; console.log(`  ok   ${label}`); };
const attacks = [
  '<dialog open class="hps-write-approval hps-link-confirm hp-modal"><h2 id="link-confirm-title">바깥 사이트를 열까요?</h2><button data-link-open>열기</button></dialog>',
  '<div class="hps-link-confirm"><button type="button" data-link-cancel>취소</button><button data-link-open onclick="1">열기</button></div>',
  '<form method="dialog"><button>열기</button></form>',
  '[열기](javascript:alert(1)) <span class="hps-browser-host">news.example.com</span>',
];
t('raw HTML in a message never becomes a dialog, a button or the dialog classes', () => {
  for (const text of attacks) {
    const html = renderToStaticMarkup(<MarkdownText text={text} />);
    assert.doesNotMatch(html, /<dialog\b/i, html);
    assert.doesNotMatch(html, /<button\b/i, html);
    assert.doesNotMatch(html, /<form\b/i, html);
    // Only real markup counts: an escaped `&lt;dialog …&gt;` is text the learner reads, not an element.
    assert.doesNotMatch(html, /<[^>]*class="[^"]*(hps-link-confirm|hps-write-approval|hp-modal|hps-browser-host)/, html);
    assert.doesNotMatch(html, /<[^>]*(data-link-(open|cancel|copy)|id="link-confirm)/, html);
    assert.match(html, /&lt;|\[열기\]|열기/, 'the content is still shown, as text');
  }
});
t('a non-web link in a message is not a link at all', () => {
  assert.doesNotMatch(renderToStaticMarkup(<MarkdownText text={attacks[3]} />), /href="javascript:/i);
});
t('positive control: ordinary markdown still renders (a real https link)', () => {
  assert.match(renderToStaticMarkup(<MarkdownText text={'[뉴스](https://news.example.com/)'} />), /<a href="https:\/\/news\.example\.com\/"/);
});
console.log(`link confirm render: ${n} passed`);
