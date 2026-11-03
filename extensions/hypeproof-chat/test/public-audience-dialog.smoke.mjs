// CGP-KNOW-R-007 / REQ-KNOW-10: the in-panel public-audience step, driven in headless Chromium.
//   FOCUS_REQUIRE_BROWSER=1 node test/public-audience-dialog.smoke.mjs
//
// The real OutboundDialog and PublicAudienceDialog are bundled with the webview stylesheets in main.tsx order and
// mounted the way App.tsx mounts them: the checklist first, the public step only after the checklist's answer. Keys
// and clicks go to the headless page over the DevTools protocol (Input.dispatch*), never to the desktop. Checked:
// initial focus on 취소; Enter (also auto-repeat) never publishes; Escape cancels; the Enter or click that approved
// the checklist, pressed again, does not publish; only tick + click/Space on 공개하기 publishes; the destination is
// monospace and selectable; the card fits the chat column (personal and classroom, dark and light, 1420/800/320);
// targets are 44px; the focus ring shows. Without a headless Chromium this prints NOT RUN;
// FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = resolve(root, 'extensions/hypeproof-chat/webview-ui/src');
const bin = findChromium();
if (!bin || process.env.FOCUS_STATIC_ONLY) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('public-audience-dialog: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('public-audience-dialog: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM or FOCUS_REQUIRE_BROWSER=1)');
  process.exit(0);
}

// The full destination the host sends; the dialog must render it unchanged (host name and public site domain included).
const RECIPIENT = 'GitHub · github.com/octo-clinic-with-a-very-long-organisation-name/neo-dental-site-repository · 사이트 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.example.org';
const entry = `
import "./tokens.css";
import "./focusGeometry.css";
import { App } from "./App";
import "./styles.css";
import "./chatDetails.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { OutboundDialog, PublicAudienceDialog } from "./OutboundDialog";
window.__keep = [App];
window.__answers = [];
const content = { id: 'c1', public: true, notes: [], excluded: '포함하지 않는 것: AI 기억, 개인 메모', sections: [{ recipient: 'GitHub · github.com/octo/neo · 사이트 octo.github.io', items: [{ id: '0:0', label: 'index.html', bytes: 1200 }] }] };
const publicStep = { id: 'p1', step: 'public', audience: '인터넷의 누구나', notAudience: '우리 반', recipient: ${JSON.stringify(RECIPIENT)} };
function Page() {
  // window.__start: 'content' mounts the checklist first and the public step right after its answer (the host's next
  // prompt arrives with no gap); 'public' mounts the public step alone.
  const [step, setStep] = useState(window.__start);
  const answer = (id, selected) => { window.__answers.push([id, selected]); setStep(id === 'c1' && selected ? 'public' : 'done'); };
  if (step === 'content') return <OutboundDialog key="c1" prompt={content} onAnswer={answer} />;
  if (step === 'public') return <PublicAudienceDialog key="p1" prompt={publicStep} onAnswer={answer} />;
  return null;
}
createRoot(document.getElementById('r')).render(<Page />);
`;
const built = await build({
  stdin: { contents: entry, resolveDir: SRC, sourcefile: 'public-audience-entry.tsx', loader: 'tsx' },
  bundle: true, write: false, outdir: 'out', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
});
const js = built.outputFiles.find((o) => o.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script');
const css = built.outputFiles.find((o) => o.path.endsWith('.css')).text;
const THEMES = {
  dark: { cls: 'vscode-dark', id: 'HypeProof Studio', v: { focusBorder: '#D5F279', 'editor-background': '#151D19', 'editor-foreground': '#F2F4E8', foreground: '#F2F4E8' } },
  light: { cls: 'vscode-light', id: 'Light Modern', v: { focusBorder: '#005fb8', 'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', foreground: '#3b3b3b' } },
};
// No transition: the exit animation would delay the answer; reduced motion completes synchronously as in the product.
const page = (theme, seat, start) => `<!doctype html><html><head><meta charset="utf-8"><style>:root{${Object.entries(theme.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${css}</style></head>
<body class="${theme.cls}" data-vscode-theme-id="${theme.id}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)">${seat === 'personal' ? '<div class="hps-shell" data-chat-detail="personal"><div class="tw-workspace"><div id="r"></div></div></div>' : '<div class="hps-shell"><div id="r"></div></div>'}
<script>window.__start=${JSON.stringify(start)}</script><script>${js}</script></body></html>`;

const b = await launch(bin);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, { repeat = false } = {}) => {
  const spec = k === 'Enter' ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' } : k === 'Escape' ? { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 } : { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' };
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec, autoRepeat: repeat });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec });
  await wait(60);
};
const centre = (sel) => b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const click = async ([x, y]) => {
  for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await wait(60);
};
const answers = () => b.evaluate('window.__answers');
const active = () => b.evaluate(`(() => { const a = document.activeElement; return a ? (a.hasAttribute('data-public-cancel') ? 'cancel' : a.hasAttribute('data-public-confirm') ? 'confirm' : a.hasAttribute('data-public-ack') ? 'ack' : a.tagName) : null; })()`);
const published = (list) => list.some(([id, sel]) => id === 'p1' && sel);
const mount = async (start, { theme = 'dark', seat = 'personal', width = 800, motion = 'reduce', forcedColors = false } = {}) => {
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
  await b.load(page(THEMES[theme], seat, start), { width, height: 800, dark: theme === 'dark', forcedColors });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }, { name: 'prefers-color-scheme', value: theme }, { name: 'forced-colors', value: forcedColors ? 'active' : 'none' }] });
  await wait(200);
};
let pass = 0; const ok = (label) => { pass++; console.log('  ok   ' + label); };
try {
  // K1 initial focus, Enter and its auto-repeat, Escape.
  await mount('public');
  assert.equal(await active(), 'cancel', 'initial focus is on 취소');
  // CGP-KNOW-R-018 / REQ-KNOW-33: the public step states the receiver AI storage policy as unknown, before the tick.
  assert.deepEqual(await b.evaluate(`(() => { const d = document.querySelector('[data-testid=public-audience-dialog]'); const m = d.querySelector('[data-recipient-ai-memory]'); return [m?.textContent ?? null, !!(m && (m.compareDocumentPosition(d.querySelector('[data-public-ack]')) & Node.DOCUMENT_POSITION_FOLLOWING)), d.textContent.includes('받는 사람의 AI가 기억하지 않아요')]; })()`), ['받는 사람의 AI 기억: 확인 안 됨', true, false], 'unknown receiver AI storage policy shown before the acknowledgement; never the safe wording');
  await key('Enter'); await key('Enter', { repeat: true }); await key('Enter', { repeat: true });
  assert.deepEqual(await answers(), [], 'Enter on 취소 neither publishes nor closes');
  await b.evaluate(`document.querySelector('[data-public-ack]').click()`); await wait(40);
  await b.evaluate(`document.querySelector('[data-public-confirm]').focus()`); await wait(20);
  await key('Enter'); await key('Enter', { repeat: true });
  assert.deepEqual(await answers(), [], 'Enter on an enabled 공개하기 does not publish either');
  await key('Escape');
  assert.deepEqual(await answers(), [['p1', null]], 'Escape cancels');
  ok('K1 focus starts on 취소; Enter and key repeat never publish; Escape cancels');

  // K2 the Enter that approved the checklist, pressed again (and held), lands on the public step and does nothing.
  await mount('content');
  await b.evaluate(`document.querySelector('.hps-outbound-item input').click()`); await wait(40);
  await b.evaluate(`document.querySelector('.hps-outbound-send').focus()`); await wait(20);
  await key('Enter');
  assert.deepEqual(await answers(), [['c1', ['0:0']]], 'the checklist approves');
  assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=public-audience-dialog]')?.open`), true, 'the public step opens as its own dialog');
  assert.equal(await active(), 'cancel');
  await key('Enter'); await key('Enter', { repeat: true }); await key('Enter', { repeat: true });
  assert.equal(published(await answers()), false, 'double Enter does not publish');
  assert.equal(await b.evaluate(`!!document.querySelector('[data-testid=public-audience-dialog]')?.open`), true, 'and the step stays open');
  ok('K2 Enter, Enter (and auto-repeat) after the checklist does not publish');

  // K3 a double click on 보내기: the second click lands on the public step and does not publish.
  await mount('content');
  await b.evaluate(`document.querySelector('.hps-outbound-item input').click()`); await wait(40);
  const sendAt = await centre('.hps-outbound-send');
  await click(sendAt); await click(sendAt); await click(sendAt);
  assert.equal(published(await answers()), false, 'double click does not publish');
  assert.equal(await b.evaluate(`document.querySelector('[data-public-confirm]').disabled`), true, '공개하기 stays disabled until ticked');
  // Space on the focused 취소 (a carried-over press) cancels, never publishes.
  await b.evaluate(`document.querySelector('[data-public-cancel]').focus()`); await key(' ');
  assert.deepEqual((await answers()).at(-1), ['p1', null]);
  ok('K3 double click on 보내기 does not publish; Space on 취소 cancels');

  // K4 the deliberate path: tick, then click or Space on 공개하기.
  for (const how of ['click', 'space']) {
    await mount('public');
    await click(await centre('[data-public-ack]'));
    assert.equal(await b.evaluate(`document.querySelector('[data-public-ack]').checked`), true);
    if (how === 'click') await click(await centre('[data-public-confirm]'));
    else { await b.evaluate(`document.querySelector('[data-public-confirm]').focus()`); await key(' '); }
    assert.deepEqual(await answers(), [['p1', ['public-audience']]], `tick + ${how} publishes`);
  }
  ok('K4 only the acknowledgement tick plus a click or Space on 공개하기 publishes');

  // K5 copy, destination style and geometry.
  const findings = [];
  for (const seat of ['personal', 'classroom']) for (const theme of ['dark', 'light']) for (const width of [1420, 800, 320]) for (const forcedColors of [false, true]) {
    await mount('public', { theme, seat, width, forcedColors });
    const m = await b.evaluate(`(() => {
      const d = document.querySelector('[data-testid=public-audience-dialog]'), r = d.getBoundingClientRect(), cw = document.documentElement.clientWidth;
      const dest = d.querySelector('[data-public-destination]'), ds = getComputedStyle(dest);
      const range = document.createRange(); range.selectNodeContents(dest);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const selected = selection.toString(); const lines = new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; selection.removeAllRanges();
      const h2 = d.querySelector('h2'), hr = h2.getBoundingClientRect(), hs = getComputedStyle(h2), dr = dest.getBoundingClientRect(), bodyP = getComputedStyle(d.querySelector('#public-audience-who'));
      const leadProbe = document.createElement('span'); leadProbe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--hp-font-lead)'; d.appendChild(leadProbe); const lead = parseFloat(getComputedStyle(leadProbe).fontSize); leadProbe.remove();
      const rgba = (c) => { const x = c.match(/[\\d.]+/g).map(Number); return { r: x[0], g: x[1], b: x[2], a: x.length > 3 ? x[3] : 1 }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const fg = rgba(ds.color), bg = rgba(getComputedStyle(d).backgroundColor), l1 = lum(fg), l2 = lum(bg);
      const heading = { box: [hr.width, hr.height], inside: hr.left >= r.left && hr.right <= r.right && hr.top >= r.top && hr.bottom <= r.bottom, aboveDest: hr.bottom <= dr.top, shown: h2.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), display: hs.display, visibility: hs.visibility, opacity: hs.opacity, tag: h2.tagName, size: parseFloat(hs.fontSize), weight: parseInt(hs.fontWeight, 10), body: parseFloat(bodyP.fontSize), lead };
      const hfg = rgba(hs.color), hl = lum(hfg);
      heading.contrast = { fgA: hfg.a, ratio: (Math.max(hl, l2) + 0.05) / (Math.min(hl, l2) + 0.05) }; heading.clipPath = hs.clipPath; heading.clip = hs.clip;
      const destClip = { scrollH: dest.scrollHeight, clientH: dest.clientHeight, overflowY: ds.overflowY, maxHeight: ds.maxHeight };
      const contrast = { fgA: fg.a, bgA: bg.a, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), shown: dest.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), opacity: ds.opacity };
      const btn = [...d.querySelectorAll('.hps-outbound-actions button')].map(x => Math.round(x.getBoundingClientRect().height));
      const ack = d.querySelector('[data-public-ack]').closest('label').getBoundingClientRect(); // the whole label is the tick target
      return { open: d.open, left: r.left, right: cw - r.right, w: r.width, cw, scroll: document.documentElement.scrollWidth > innerWidth, inner: d.scrollWidth > d.clientWidth,
        title: h2.textContent, heading, contrast, destClip, who: d.querySelector('#public-audience-who').textContent, dest: dest.textContent,
        selected, lines, wrap: ds.overflowWrap, font: ds.fontFamily, select: ds.userSelect || ds.webkitUserSelect, destOverflow: dest.scrollWidth > dest.clientWidth, btn, ack: [Math.round(ack.width), Math.round(ack.height)],
        text: parseFloat(getComputedStyle(d).fontSize), radius: getComputedStyle(d).borderTopLeftRadius, pad: getComputedStyle(d).paddingTop };
    })()`);
    const at = `${seat}/${theme}@${width}/${forcedColors ? 'forced' : 'normal'}`;
    if (!m.open) findings.push(`${at}: not open`);
    if (m.left < 0 || m.right < 0 || m.w > m.cw) findings.push(`${at}: outside the chat column ${JSON.stringify([m.left, m.right, m.w, m.cw])}`);
    if (width > 390 && Math.abs(m.w - Math.min(480, m.cw - 24)) > 0.6) findings.push(`${at}: width ${m.w}, want the shared modal width`);
    if (m.radius !== '12px' || m.pad !== '20px') findings.push(`${at}: not the shared modal surface (${m.radius}, ${m.pad})`);
    if (m.scroll || m.inner || m.destOverflow) findings.push(`${at}: horizontal overflow`);
    if (m.title !== '누구나 볼 수 있어요') findings.push(`${at}: title ${m.title}`);
    if (!m.who.includes('인터넷의 누구나') || !m.who.includes('우리 반만 보는 게 아니에요')) findings.push(`${at}: audience copy ${m.who}`);
    if (m.dest !== RECIPIENT) findings.push(`${at}: destination is not the full host string unchanged: ${m.dest}`);
    const h = m.heading;
    if (h.tag !== 'H2') findings.push(`${at}: heading is a ${h.tag}`);
    if (!h.shown || h.display === 'none' || h.visibility !== 'visible' || Number(h.opacity) === 0) findings.push(`${at}: heading hidden ${JSON.stringify(h)}`);
    if (h.box[0] <= 0 || h.box[1] <= 0 || !h.inside || !h.aboveDest) findings.push(`${at}: heading not a visible box inside the dialog above the destination ${JSON.stringify(h)}`);
    if (h.size !== h.lead || h.size <= h.body || h.weight < 600) findings.push(`${at}: heading is not distinct from body text (lead step ${h.lead}px, heading ${h.size}px/${h.weight}, body ${h.body}px)`);
    if (h.contrast.fgA === 0 || h.contrast.ratio < 4.5) findings.push(`${at}: heading text not legible against the dialog ${JSON.stringify(h.contrast)}`);
    if ((h.clipPath && h.clipPath !== 'none') || (h.clip && h.clip !== 'auto')) findings.push(`${at}: heading is clipped (${h.clipPath} / ${h.clip})`);
    if (m.destClip.scrollH > m.destClip.clientH + 1) findings.push(`${at}: destination is cut off vertically ${JSON.stringify(m.destClip)}`);
    const c = m.contrast;
    if (!c.shown || Number(c.opacity) === 0 || c.fgA === 0 || c.bgA < 1 || c.ratio < 4.5) findings.push(`${at}: destination text not legible against its background ${JSON.stringify(c)}`);
    if (!/mono/i.test(m.font)) findings.push(`${at}: destination font ${m.font}`);
    if (m.selected !== m.dest) findings.push(`${at}: selection loses destination text`);
    if (width === 320 && (m.lines < 3 || m.wrap !== 'anywhere')) findings.push(`${at}: long host does not wrap by character (${m.lines} lines, ${m.wrap})`);
    if (m.select !== 'text') findings.push(`${at}: destination not selectable (${m.select})`);
    if (m.btn.some((h) => h < 44) || m.ack.some((s) => s < 44)) findings.push(`${at}: targets ${JSON.stringify([m.btn, m.ack])}`);
    if (m.text < 14) findings.push(`${at}: text ${m.text}px`);
    const ring = await b.focusVisibleStyle('[data-public-cancel]');
    if (ring['outline-style'] === 'none' || parseFloat(ring['outline-width']) < 2) findings.push(`${at}: focus ring ${JSON.stringify(ring)}`);
    if (process.env.PUBLIC_AUDIENCE_ARTIFACT_DIR) {
      mkdirSync(process.env.PUBLIC_AUDIENCE_ARTIFACT_DIR, { recursive: true });
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(process.env.PUBLIC_AUDIENCE_ARTIFACT_DIR, `${seat}-${theme}-${width}-${forcedColors ? 'forced' : 'normal'}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  assert.deepEqual(findings, [], findings.join('\n'));
  ok('K5 copy names 인터넷의 누구나 vs 우리 반; monospace selectable destination; long host wraps by character and selects completely; shared modal geometry at 1420/800/320, normal/forced colors; 44px targets; focus ring');
} finally { await b.close(); }
console.log(`PASS public-audience-dialog (${pass} groups)`);
