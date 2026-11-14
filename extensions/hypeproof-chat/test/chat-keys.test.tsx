// CGP-CHAT-R-030 — Esc stops an answer and Alt+Shift+K focuses the composer (webview-ui/src/chatKeys.ts), on a real DOM
// (jsdom). Positive: Esc from the composer or a non-text place while an answer streams; Alt+Shift+K anywhere outside a
// dialog. Negative controls, one per Escape owner: no stream, a modifier, a repeat, an IME composition, another text
// field, a dialog, a menu, a listbox, the find bar, the voice panel, dictation recording, the microphone card, and an
// Escape another listener handles after ours (the stop waits for the whole dispatch).
// Run: node scripts/run-tsx-tests.mjs chat-keys
import React from 'react';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.cwd() + '/package.json')('jsdom');
import { renderToStaticMarkup } from 'react-dom/server';
import { focusesComposer, mayStopAnswer, watchTooltipEscape } from '../webview-ui/src/chatKeys';
import { installTooltips } from '../webview-ui/src/tooltips';
import { DictationNoticeView, type DictationController, type DictationView } from '../webview-ui/src/DictationControl';

void React;
const dom = new JSDOM(`<body><div class="hps-shell"><div class="hps-messages" tabindex="-1"><p id="msg">답</p></div>
  <footer class="hps-input-area"><div class="hps-input"><textarea id="box"></textarea></div></footer>
  <input id="rename"><div class="hps-find"><input id="find"></div><div class="hps-voice-panel"><button id="voice">x</button></div>
  <div role="menu" hidden><button id="menuitem">m</button></div></div></body>`);
const doc = dom.window.document;
(globalThis as unknown as { Element: unknown }).Element = dom.window.Element;
const el = (id: string) => doc.getElementById(id)!;
const esc = (target: Element, extra: Record<string, unknown> = {}) => ({ key: 'Escape', code: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, isComposing: false, keyCode: 27, target, ...extra }) as unknown as KeyboardEvent;
const altK = (target: Element, extra: Record<string, unknown> = {}) => ({ ...esc(target), key: 'K', code: 'KeyK', altKey: true, shiftKey: true, keyCode: 75, ...extra }) as unknown as KeyboardEvent;

let n = 0;
const t = (label: string, fn: () => void) => { fn(); n++; console.log(`  ok   ${label}`); };

t('Esc stops from the composer or the message list while an answer streams', () => {
  assert.equal(mayStopAnswer(esc(el('box')), doc, true), true);
  assert.equal(mayStopAnswer(esc(el('msg')), doc, true), true);
  assert.equal(mayStopAnswer(esc(doc.body), doc, true), true);
});

t('negative controls: no stream, modifiers, repeat, IME, already handled', () => {
  assert.equal(mayStopAnswer(esc(el('box')), doc, false), false, 'no answer streaming');
  for (const extra of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { repeat: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }])
    assert.equal(mayStopAnswer(esc(el('box'), extra), doc, true), false, JSON.stringify(extra));
});

t('negative controls: every other Escape owner keeps it', () => {
  for (const id of ['rename', 'find', 'voice', 'menuitem']) assert.equal(mayStopAnswer(esc(el(id)), doc, true), false, id);
  // A closed menu left in the page (hidden) does not block; an open one does.
  assert.equal(mayStopAnswer(esc(el('box')), doc, true), true, 'a hidden menu is not open');
  for (const html of ['<dialog open></dialog>', '<div aria-modal="true"></div>', '<div role="listbox"></div>', '<div role="menu"></div>', ]) {
    const holder = doc.createElement('div'); holder.innerHTML = html; doc.body.append(holder);
    assert.equal(mayStopAnswer(esc(el('box')), doc, true), false, html);
    holder.remove();
  }
  assert.equal(mayStopAnswer(esc(el('box')), doc, true), true, 'and stops again once they are gone');
});

// The microphone cards and the recording line, from the real component's markup (verify-3956: the guard once named a
// class no element had, and this test had built that element itself).
const noop = () => {};
const controller = (view: DictationView) => ({ view, toggle: noop, cancel: noop, retry: noop, dismiss: noop, insertRecovered: noop, copyRecovered: noop, openSettings: noop, busy: false, disabled: false }) as DictationController;
const drawn = (view: DictationView) => renderToStaticMarkup(<DictationNoticeView view={view} controller={controller(view)} />);
t('the drawn microphone cards and the recording line keep Escape; other dictation notes do not', () => {
  for (const view of [{ kind: 'denied', settingsFailed: false }, { kind: 'recovered', text: '받아 적은 말', copied: false }, { kind: 'recording', seconds: 3 }] as DictationView[]) {
    const html = drawn(view);
    assert.ok(html.length > 0, `${view.kind} draws something`);
    const holder = doc.createElement('div'); holder.innerHTML = html; doc.body.append(holder);
    assert.equal(mayStopAnswer(esc(el('box')), doc, true), false, `${view.kind}: ${html.slice(0, 80)}`);
    holder.remove();
  }
  for (const view of [{ kind: 'done' }, { kind: 'working' }, { kind: 'notice', text: '다시 해 볼까요', retry: true }] as DictationView[]) {
    const holder = doc.createElement('div'); holder.innerHTML = drawn(view); doc.body.append(holder);
    assert.equal(mayStopAnswer(esc(el('box')), doc, true), true, `${view.kind} is a status line, not a card`);
    holder.remove();
  }
});

t('Alt+Shift+K by physical key; not with other modifiers, in IME, or under a dialog', () => {
  assert.equal(focusesComposer(altK(el('msg')), doc), true);
  assert.equal(focusesComposer(altK(el('rename'), { key: '' }), doc), true, 'macOS Option layout: the key text differs, the code does not');
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: false }, { altKey: false }, { repeat: true }, { isComposing: true }, { code: 'KeyJ' }])
    assert.equal(focusesComposer(altK(el('msg'), extra), doc), false, JSON.stringify(extra));
  const d = doc.createElement('dialog'); d.setAttribute('open', ''); doc.body.append(d);
  assert.equal(focusesComposer(altK(el('msg')), doc), false, 'a dialog keeps the keyboard');
  d.remove();
});

// A visible tooltip: tooltips.ts (document capture) hides it before the chat's window listener runs, so the chat notes
// the press in window capture, which comes first. The tooltip's own listener is the real one, and it is not changed:
// the event is not default-prevented, so every other Escape owner still sees a fresh Escape.
t('an Escape that met a visible tooltip is noted (it closes the tooltip; the answer keeps running)', () => {
  const win = dom.window as unknown as Window;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['MutationObserver', 'HTMLElement', 'KeyboardEvent']) g[k] ??= (dom.window as unknown as Record<string, unknown>)[k];
  const removeTips = installTooltips(doc);
  const probe = watchTooltipEscape(win);
  const tip = doc.querySelector('.hp-tooltip') as HTMLElement;
  assert.ok(tip, 'the real tooltip element');
  const press = () => { const e = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); el('box').dispatchEvent(e); return e; };
  tip.hidden = false;
  const closing = press();
  assert.equal(tip.hidden, true, 'the tooltip listener closed it during the same press');
  assert.equal(probe.metTooltip(closing), true, 'the chat saw it open before it closed');
  assert.equal(closing.defaultPrevented, false, 'the event is not consumed: other Escape owners are unchanged');
  const plain = press();
  assert.equal(probe.metTooltip(plain), false, 'negative control: no tooltip on screen, the press can stop the answer');
  probe.dispose(); removeTips();
  tip.remove();
});

console.log(`chat keys: ${n} passed`);
