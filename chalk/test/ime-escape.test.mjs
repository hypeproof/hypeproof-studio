// CGP-DS-D-024 / REQ-CGP-DS-30 (CGP-DS-R-027) — Chalk side. manage.html's document Escape
// handler closes the navigation drawer, the "pick by" menu and the seat detail. Composing "안녕" in
// the seat search or a note field and pressing Escape cancels the syllable; it must close nothing.
// Runs the shipped handler (extracted from the page) against stubs and checks the effect, with a
// positive control for a plain Escape on each surface.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/ui/manage.html', import.meta.url), 'utf8');
const lines = html.split('\n').filter((l) => l.startsWith("document.addEventListener('keydown'") && l.includes("e.key!=='Escape'"));
assert.equal(lines.length, 1, 'manage.html has one document Escape handler');

function page({ sideOpen = false, menuOpen = false, detailShown = false } = {}) {
  const calls = [];
  const state = { sideOpen, menuOpen, detailShown };
  const menu = { get open() { return state.menuOpen; }, set open(v) { state.menuOpen = v; calls.push('menu:' + v); }, querySelector: () => ({ focus() {} }) };
  const els = { 'ops-pick-by': menu, 'ops-detail': { get hidden() { return !state.detailShown; } } };
  let listener;
  const document = {
    body: { classList: { contains: (c) => c === 'side-open' && state.sideOpen } },
    addEventListener: (type, fn) => { assert.equal(type, 'keydown'); listener = fn; },
  };
  const run = new Function('document', '$', 'sideOpen', 'closeSeat', lines[0]);
  run(document, (id) => els[id], (on) => { state.sideOpen = on; calls.push('side:' + on); }, () => { state.detailShown = false; calls.push('closeSeat'); });
  const press = (extra = {}) => {
    const e = { key: 'Escape', keyCode: 27, isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    listener(e);
    return e;
  };
  return { calls, press };
}

const SURFACES = [
  ['navigation drawer', { sideOpen: true }, 'side:false'],
  ['pick-by menu', { menuOpen: true }, 'menu:false'],
  ['seat detail', { detailShown: true }, 'closeSeat'],
];
const COMPOSING = [['isComposing', { isComposing: true, keyCode: 229 }], ['legacy 229', { keyCode: 229 }]];

for (const [name, open, effect] of SURFACES) {
  for (const [signal, flags] of COMPOSING) {
    const p = page(open);
    const e = p.press(flags);
    assert.deepEqual(p.calls, [], `${name}: a composing Escape (${signal}) closed it`);
    assert.equal(e.defaultPrevented, false, `${name}: a composing Escape (${signal}) was taken from the IME`);
  }
  const p = page(open);
  p.press();
  assert.deepEqual(p.calls, [effect], `positive control: a plain Escape did not close the ${name}`);
}
console.log('chalk ime-escape OK');
