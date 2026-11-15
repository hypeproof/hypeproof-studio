// CGP-CHAT-D-007 (REQ-STUDIO-QUOTE-REPLY) — the selection action popover and the quote chip on the real App in
// headless Chromium, with real mouse and key input over CDP:
//   - a mouse drag shows nothing until the release; the popover is in the page within 150ms of the release
//     (and within 150ms of a selection made without the mouse), with no fade;
//   - anchored above the selection (its bottom edge within 2px of the first selected line, overlapping it
//     horizontally), and below the last line when the selection's top is under 48px from the conversation's top;
//   - one 44px action button; Escape from the page dismisses it and focus returns to the composer;
//   - none on the answer that is still streaming;
//   - pressing it puts a quote chip inside the composer card: at most two lines with an ellipsis, a 44px ×
//     that removes it; no horizontal scroll.
// Personal and classroom seats, dark and light, 320 and 1420 px. Not run without Chromium
// (FOCUS_REQUIRE_BROWSER=1 makes that a failure).
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN quote popover layout: no Chromium'); process.exit(0); }
const dir = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const app = await build({ entryPoints: [dir + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'quote-popover-assets', write: false, loader: { '.svg': 'dataurl', '.png': 'dataurl' }, logLevel: 'silent' });
const css = app.outputFiles.find(f => f.path.endsWith('.css')).text, script = app.outputFiles.find(f => f.path.endsWith('.js')).text;
const b = await launch(bin);
const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));
const send = async (data) => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await settle(); };
const shim = `window.__posts=[];if(!crypto.randomUUID){let n=0;crypto.randomUUID=()=>'00000000-0000-4000-8000-'+String(++n).padStart(12,'0');}window.acquireVsCodeApi=()=>({postMessage:m=>window.__posts.push(m),getState:()=>undefined,setState:()=>{}});`
  // Timing probes: the release of the mouse button and the moment the popover enters the page.
  + `window.__t={};document.addEventListener('pointerup',()=>{window.__t.up=performance.now();},true);`
  + `new MutationObserver(()=>{if(window.__t.shown===undefined&&document.querySelector('.hps-quote-action'))window.__t.shown=performance.now();}).observe(document,{childList:true,subtree:true});`;
const vars = theme => Object.entries(THEMES[theme]).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
const page = (dark) => `<html style="${vars(dark ? 'Dark+' : 'Light+')}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${shim}</script><script>${script.replaceAll('</script', '<\\/script')}</script></body></html>`;
const workspace = { scope: 'quote-popover', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '물 끓이기', createdAt: 1, updatedAt: 1, messageCount: 12 }], sourceSelection: null };
const configFor = seat => chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? workspace : undefined });
const PARA = '물은 바다에서 높은 산까지 어디에서나 끓지만, 끓는 온도는 그곳의 공기 압력에 따라 달라져요. 압력이 낮으면 더 낮은 온도에서 끓어요.';
// The long quote (step 5) is the whole target answer: about 1,000 characters, so it needs well over two lines
// in a 1420px composer with any font; the smoke also measures that (an unclamped copy) instead of assuming it.
const LONG = `${PARA} ${PARA} ${PARA}`;
const history = [];
for (let i = 1; i <= 6; i++) {
  history.push({ id: `u${i}`, role: 'user', content: `질문 ${i}: 물은 왜 끓어요?`, createdAt: i * 2 });
  history.push({ id: `a${i}`, role: 'assistant', content: `${i}번째 설명이에요. ${PARA}\n\n두 번째 문단이에요. ${LONG}\n\n세 번째 문단이에요. ${LONG}`, createdAt: i * 2 + 1 });
}
const TARGET = 'a4';

const open = async (seat, dark, width) => {
  await b.send('Page.navigate', { url: 'about:blank' });
  await b.load(page(dark), { width, height: 800, dark, appReady: true });
  await send({ type: 'config', config: configFor(seat) });
  await send({ type: 'history', messages: history });
};
const awaitEval = async (expression) => { const r = await b.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result.value; };
const frames = (n = 2) => awaitEval(`new Promise(r=>{let k=${n};const f=()=>(--k?requestAnimationFrame(f):r(true));requestAnimationFrame(f);})`);
const body = id => `document.querySelector('[data-quote-answer=${JSON.stringify(id)}]')`;
/** Scroll the conversation so the target answer's first paragraph sits `offset` px below its top. */
const scrollTarget = async (offset) => {
  await b.evaluate(`(()=>{const sc=document.querySelector('.hps-messages'),p=${body(TARGET)}.querySelector('p');sc.scrollTop+=p.getBoundingClientRect().top-(sc.getBoundingClientRect().top+sc.clientTop)-${offset};})()`);
  await settle(); await frames();
};
/** Viewport points at the start of the first paragraph's first line and a few characters on. */
const linePoints = () => b.evaluate(`(()=>{const t=${body(TARGET)}.querySelector('p').firstChild;const r=(a,z)=>{const g=document.createRange();g.setStart(t,a);g.setEnd(t,z);return g.getBoundingClientRect();};const s=r(0,1),e=r(9,10);return {x0:s.left+1,x1:e.right-1,y:(s.top+s.bottom)/2};})()`);
const mouse = (type, x, y, extra = {}) => b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const key = async (k, code, vk) => { await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await settle(); };
const popover = () => b.evaluate(`(()=>{
  const row=document.querySelector('.hps-quote-row'),btn=row&&row.querySelector('.hps-quote-action');if(!row)return null;
  const sel=getSelection(),r=sel.rangeCount?sel.getRangeAt(0):null,lines=r?[...r.getClientRects()].filter(x=>x.width>0&&x.height>0):[];
  const box=e=>{const q=e.getBoundingClientRect();return {top:q.top,bottom:q.bottom,left:q.left,right:q.right,w:q.width,h:q.height};};
  const sc=document.querySelector('.hps-messages'),f=sc.getBoundingClientRect();
  return {pop:box(row),btn:box(btn),side:row.getAttribute('data-side'),anim:getComputedStyle(row).animationName,inRow:row.closest('[data-quote-row]')?.getAttribute('data-quote-row'),
    first:lines.length?lines.reduce((a,x)=>x.top<a.top?x:a).toJSON():null,last:lines.length?lines.reduce((a,x)=>x.bottom>a.bottom?x:a).toJSON():null,
    viewTop:f.top+sc.clientTop,scrollW:document.documentElement.scrollWidth,innerW:innerWidth,scW:sc.scrollWidth,scCW:sc.clientWidth,
    wide:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5).slice(0,6).map(e=>e.tagName+'.'+String(e.className).split(' ')[0]+':'+Math.round(e.getBoundingClientRect().right)),
    hit:(()=>{const q=btn.getBoundingClientRect();return document.elementFromPoint((q.left+q.right)/2,(q.top+q.bottom)/2)===btn;})()};})()`);
const drag = async () => {
  const p = await linePoints();
  await b.evaluate(`window.__t={}`);
  await mouse('mousePressed', p.x0, p.y);
  await mouse('mouseMoved', (p.x0 + p.x1) / 2, p.y);
  await mouse('mouseMoved', p.x1, p.y);
  await settle(100); await frames();
  const mid = await b.evaluate(`!!document.querySelector('.hps-quote-action')`);
  await mouse('mouseReleased', p.x1, p.y);
  await settle(200);
  const why = await b.evaluate(`(()=>{const e=document.elementFromPoint(${p.x0},${p.y});return {sel:String(getSelection()),at:e&&(e.tagName+'.'+e.className),p:${JSON.stringify(p)}};})()`);
  return { mid, t: await b.evaluate('window.__t'), why };
};
// The page's own width before the popover exists: a narrow window may already scroll for reasons that are not the
// popover (the task header row at 320px). The popover must not add to it, and the conversation never scrolls sideways.
let baseScrollW = 0;
const checkPopover = (g, label) => {
  assert.ok(g, `${label}: no popover`);
  assert.equal(g.inRow, TARGET, `${label}: popover is not on the selected answer`);
  assert.equal(g.anim, 'none', `${label}: the popover fades in (D-007 wants it there within 150ms)`);
  assert.ok(g.btn.h >= 44 - .5 && g.btn.w >= 44 - .5, `${label}: action is ${g.btn.w}x${g.btn.h}, not a 44px target`);
  assert.ok(g.hit, `${label}: the action is covered (elementFromPoint)`);
  assert.ok(g.scrollW <= Math.max(g.innerW, baseScrollW) && g.scW <= g.scCW + .5, `${label}: horizontal scroll (${g.scrollW}/${g.innerW}, before ${baseScrollW}; conversation ${g.scW}/${g.scCW}) ${g.wide.join(' ')}`);
  assert.ok(g.pop.left >= -.5 && g.pop.right <= g.innerW + .5, `${label}: popover outside the window`);
};

let cases = 0;
const preexisting = new Set();
try {
  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [320, 1420]) {
    const label = `${seat}/${dark ? 'dark' : 'light'}/${width}`;
    await open(seat, dark, width);
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-shell[data-chat-detail=personal]')`), seat === 'personal', `${label}: seat branch`);
    // 1. Above: room over the selection. A drag shows nothing until the release, then within 150ms.
    await scrollTarget(200);
    baseScrollW = await b.evaluate(`document.querySelector('.hps-quote-row') ? -1 : document.documentElement.scrollWidth`);
    assert.ok(baseScrollW > 0, `${label}: fixture: a popover before any selection`);
    if (baseScrollW > width) preexisting.add(`${label}: page ${baseScrollW}px wide before any popover`);
    const d = await drag();
    assert.equal(d.mid, false, `${label}: popover shown mid-drag`);
    assert.ok(d.t.up !== undefined && d.t.shown !== undefined, `${label}: no popover after the release (${JSON.stringify(d.t)} ${JSON.stringify(d.why)})`);
    assert.ok(d.t.shown - d.t.up <= 150, `${label}: popover ${Math.round(d.t.shown - d.t.up)}ms after the release`);
    let g = await popover();
    checkPopover(g, `${label} above`);
    assert.equal(g.side, 'above', `${label}: side`);
    assert.ok(g.pop.bottom <= g.first.top + .5 && g.first.top - g.pop.bottom <= 2.5, `${label}: popover bottom ${g.pop.bottom} vs first line top ${g.first.top}`);
    assert.ok(g.pop.left < g.first.right && g.pop.right > g.first.left, `${label}: popover not over the first line horizontally`);
    // 2. Escape from the page (focus is not on the popover) dismisses it; focus goes to the composer.
    assert.notEqual(await b.evaluate(`document.activeElement?.className`), 'hps-quote-action', `${label}: fixture: focus should not be on the popover`);
    await key('Escape', 'Escape', 27);
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-quote-row')`), false, `${label}: Escape did not dismiss`);
    assert.equal(await b.evaluate(`document.activeElement?.tagName`), 'TEXTAREA', `${label}: focus after Escape`);
    // 3. Flip: the selection's top under 48px from the top of the conversation puts the popover below the last line.
    await scrollTarget(20);
    await drag();
    g = await popover();
    checkPopover(g, `${label} below`);
    assert.ok(g.first.top - g.viewTop < 48, `${label}: fixture: selection should be under 48px from the top (${g.first.top - g.viewTop})`);
    assert.equal(g.side, 'below', `${label}: side near the top`);
    assert.ok(g.pop.top >= g.last.bottom - .5 && g.pop.top - g.last.bottom <= 2.5, `${label}: popover top ${g.pop.top} vs last line bottom ${g.last.bottom}`);
    assert.ok(g.pop.top >= g.viewTop - .5, `${label}: popover under the conversation's top edge`);
    // 4. A selection made without the mouse (keyboard / script): within 150ms too.
    await key('Escape', 'Escape', 27);
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-quote-row')`), false, `${label}: fixture: popover left before the keyboard case`);
    await scrollTarget(200);
    const kbd = await awaitEval(`new Promise(res=>{const p=${body(TARGET)}.querySelectorAll('p')[1].firstChild;window.__t={};const r=document.createRange();r.setStart(p,0);r.setEnd(p,12);const s=getSelection();s.removeAllRanges();const t0=performance.now();s.addRange(r);setTimeout(()=>res({t0,shown:window.__t.shown}),250);})`);
    assert.ok(kbd.shown !== undefined && kbd.shown - kbd.t0 <= 150, `${label}: popover ${kbd.shown === undefined ? 'never' : Math.round(kbd.shown - kbd.t0) + 'ms'} after a selection without the mouse`);
    checkPopover(await popover(), `${label} keyboard`);
    // 5. The quote chip: a long quote shows two lines with an ellipsis; × (44px) removes it.
    await b.evaluate(`(()=>{const ps=${body(TARGET)}.querySelectorAll('p');const r=document.createRange();r.setStart(ps[0].firstChild,0);r.setEnd(ps[2].firstChild,ps[2].firstChild.length);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await settle(); await frames();
    await b.evaluate(`document.querySelector('.hps-quote-action').click()`); await settle(); await frames();
    const chip = await b.evaluate(`(()=>{
      const c=document.querySelector('.hps-quote-chip');if(!c)return null;const t=c.querySelector('.hps-quote-chip-text'),x=c.querySelector('.hps-quote-chip-remove'),card=document.querySelector('.hps-input');
      const s=getComputedStyle(t),q=e=>e.getBoundingClientRect();
      // How tall the same text is without the clamp, at the same width and font: scrollHeight of a clamped box is
      // engine-dependent (some Chromium builds report the clamped height), so the unclamped copy is the reference.
      const copy=t.cloneNode(true);copy.style.cssText='display:block;-webkit-line-clamp:none;line-clamp:none;overflow:visible;position:absolute;visibility:hidden;inset-block-start:0;inline-size:'+t.clientWidth+'px';
      t.parentNode.appendChild(copy);const full=copy.getBoundingClientRect().height;copy.remove();
      return {inCard:card.contains(c),card:q(card).toJSON(),chip:q(c).toJSON(),h:t.clientHeight,full,lh:parseFloat(s.lineHeight),px:parseFloat(s.fontSize),clamp:s.webkitLineClamp,ellipsis:s.textOverflow,
        x:q(x).toJSON(),xName:x.getAttribute('aria-label'),draft:document.querySelector('.hps-input textarea').value,scrollW:document.documentElement.scrollWidth,innerW:innerWidth};})()`);
    assert.ok(chip, `${label}: no quote chip after pressing 인용하기`);
    assert.ok(chip.inCard && chip.chip.left >= chip.card.left - .5 && chip.chip.right <= chip.card.right + .5, `${label}: chip outside the composer card`);
    assert.equal(chip.draft, '', `${label}: the quote went into the editor text`);
    assert.equal(chip.clamp, '2', `${label}: line clamp`); assert.equal(chip.ellipsis, 'ellipsis', `${label}: ellipsis`);
    assert.ok(chip.h <= 2 * chip.lh + 1 && chip.h >= 2 * chip.lh - 1, `${label}: chip text is ${chip.h}px, not two ${chip.lh}px lines`);
    assert.ok(chip.full >= 3 * chip.lh - 1, `${label}: fixture: the quote should need more than two lines unclamped (${chip.full}px at ${chip.lh}px lines)`);
    assert.ok(chip.px >= 14, `${label}: chip text ${chip.px}px`);
    assert.ok(chip.x.width >= 44 - .5 && chip.x.height >= 44 - .5, `${label}: × is ${chip.x.width}x${chip.x.height}`);
    assert.equal(chip.xName, '인용 빼기');
    assert.ok(chip.scrollW <= Math.max(chip.innerW, baseScrollW), `${label}: horizontal scroll with the chip (${chip.scrollW}, before ${baseScrollW})`);
    await b.evaluate(`document.querySelector('.hps-quote-chip-remove').click()`); await settle();
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-quote-chip')`), false, `${label}: × did not remove the chip`);
    cases++;
  }
  // 6. Not shown on the answer that is still streaming (that message), still shown on a finished one.
  for (const seat of ['personal', 'classroom']) {
    await open(seat, true, 1420);
    await send({ type: 'streamStart', streamId: 's1', messageId: 'live' });
    await send({ type: 'streamChunk', delta: `지금 쓰는 중인 답이에요. ${PARA}` });
    const live = await b.evaluate(`(()=>{const rows=[...document.querySelectorAll('.hps-msg-assistant')];const body=rows.at(-1).querySelector('.hps-msg-body');const t=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.data.includes('지금 쓰는')?1:3}).nextNode();if(!t)return 'no text';const r=document.createRange();r.setStart(t,0);r.setEnd(t,8);getSelection().removeAllRanges();getSelection().addRange(r);return 'ok';})()`);
    assert.equal(live, 'ok', `${seat}: fixture: streaming text`);
    await settle(); await frames();
    assert.equal(await b.evaluate(`!!document.querySelector('.hps-quote-row')`), false, `${seat}: popover on the answer that is streaming`);
    await b.evaluate(`(()=>{const t=${body(TARGET)}.querySelector('p').firstChild;const r=document.createRange();r.setStart(t,0);r.setEnd(t,8);getSelection().removeAllRanges();getSelection().addRange(r);})()`);
    await settle(); await frames();
    assert.equal(await b.evaluate(`document.querySelector('.hps-quote-row')?.closest('[data-quote-row]')?.getAttribute('data-quote-row')`), TARGET, `${seat}: no popover on a finished answer during a stream`);
    await send({ type: 'streamEnd' });
    cases++;
  }
  if (preexisting.size) console.log(`note (not the popover): ${[...preexisting].join('; ')}`);
  console.log(`PASS quote popover actual App: ${cases} cases (drag release <=150ms, above/flip below at 48px, 44px action, Escape, streaming, 2-line chip with 44px ×; both seats and themes, 320/1420)`);
} finally { await b.close(); }
