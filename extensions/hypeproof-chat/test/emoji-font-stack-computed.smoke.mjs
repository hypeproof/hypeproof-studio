// CGP-DS-R-033 / REQ-CGP-DS-41: emoji in learner text (answers, the learner's own messages, timeline
// and status line labels, task marks, Chalk pages) draw from the OS colour emoji face.
// Measured in headless Chromium on the real built CSS and the real ChatPanel / Chalk markup:
// - every non-code element's computed font-family ends with the colour emoji faces, after the text
//   faces, with and without the host font variable (macOS and Windows VS Code values);
// - CDP CSS.getPlatformFontsForNode: an emoji run is drawn by a colour emoji face, and digits are
//   never drawn by one (an emoji face put before the text faces would take 0-9, # and *);
// - code keeps the code role without the emoji faces.
// FOCUS_REQUIRE_BROWSER=1 fails without Chromium. EMOJI_EVIDENCE=<dir> saves PNGs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { renderComponent } from './sx-render.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const COLOUR_FACE = /^(Apple Color Emoji|Segoe UI Emoji|Noto Color Emoji)$/;
const HOSTS = { default: null, mac: '-apple-system, BlinkMacSystemFont, sans-serif', windows: '"Segoe WPC", "Segoe UI", sans-serif' };
// Fixed-width technical text keeps its own face (code role, editor font, URLs, request ids).
const TECHNICAL = 'pre, code, pre *, code *, .hps-codepill-body, .hps-codepill-body *, .hp-inbox-link-url, .hp-materials-detail, .hps-page-context-origin, .hps-outbound-destination, .hps-fatal-detail, .hps-error-banner-rid code';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN emoji font stack: no Chromium'); process.exit(0); }
const src = new URL('../webview-ui/src/', import.meta.url);
const appBundle = await build({ entryPoints: [fileURLToPath(new URL('main.tsx', src))], bundle: true, platform: 'browser', format: 'esm', outdir: 'emoji-test-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
const css = appBundle.outputFiles.find(f => f.path.endsWith('.css'))?.text; assert.ok(css, 'built webview CSS');
const browser = await launch(bin);
const evidence = process.env.EMOJI_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });

// The platform faces Chromium actually used for the text of the first element matching `selector`.
async function facesFor(selector) {
  const { root } = await browser.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  assert.ok(nodeId, `no element for ${selector}`);
  const { fonts } = await browser.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts.map(f => f.familyName);
}
// Every element that draws text and is not technical text must end with the emoji faces after a text face.
const stackFindings = (scope) => browser.evaluate(`(() => {
  const out = [];
  for (const e of document.querySelectorAll(${JSON.stringify(scope)})) {
    if (e.matches(${JSON.stringify(TECHNICAL)})) continue;
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const f = getComputedStyle(e).fontFamily;
    if (!f.endsWith(${JSON.stringify(EMOJI)}) || f.trim() === ${JSON.stringify(EMOJI)}) out.push((e.className || e.tagName) + ': ' + f);
  }
  return out;
})()`);
const textCount = (scope) => browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(scope)})].filter(e => !e.matches(${JSON.stringify(TECHNICAL)}) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).length`);

try {
  for (const seat of ['personal', 'classroom']) {
    const taskWorkspace = seat === 'personal' ? { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '고양이 페이지', createdAt: 1, updatedAt: 1, messageCount: 2, appearance: { emoji: 'cat' } }], sourceSelection: null } : undefined;
    const config = chatConfig(3, { profile: { ...chatConfig().profile, lesson: null }, activity: { id: 'emoji-test', name: '이모지 확인', kind: seat, workspace: '/w', verified: true }, ...(taskWorkspace ? { taskWorkspace } : {}) });
    const messages = [
      { id: 'q', role: 'user', createdAt: 1, content: '고양이 그림 넣어 줘 🐱' },
      { id: 'tool', role: 'tool', content: '', createdAt: 2, tool: { icon: '🖼️', label: '미리보기 🎨 여는 중', state: 'done' } },
      { id: 'a', role: 'assistant', createdAt: 3, content: '<span>다 됐어요 🎉</span>\n\n숫자 2026 #1 *\n\n`inline`' },
    ];
    const markup = await renderComponent('ChatPanel', chatPanelProps({ config, messages }));
    assert.equal(markup.includes('data-chat-detail="personal"'), seat === 'personal', `ChatPanel must render the ${seat} branch`);
    for (const dark of [false, true]) for (const width of [800, 1420]) for (const [host, family] of Object.entries(HOSTS)) {
      const theme = THEMES[dark ? 'Dark+' : 'Light+'];
      const vars = Object.entries(theme).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';') + (family ? `;--vscode-font-family:${family.replaceAll('"', '&quot;')}` : '');
      // Probes: digits alone and an emoji alone inside the answer prose, so the platform faces are read per run.
      await browser.load(`<html style="${vars}"><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div class="hps-shell" data-chat-detail="${seat}">${markup}</div></body></html>`, { width, dark });
      await browser.evaluate(`(() => { const p = document.querySelector('.hps-prose p'); for (const [id, t] of [['digits','0123456789#*'],['emoji','🎉🐱']]) { const s = document.createElement('span'); s.id = 'probe-' + id; s.textContent = t; p.appendChild(s); } })()`);
      const tag = `${seat}/${dark ? 'dark' : 'light'}/${width}/${host}`;
      if (family) assert.equal(await browser.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--vscode-font-family').trim()`), family, `host font set: ${tag}`);
      assert.ok(await textCount('.hps-shell *') >= 5, `text elements measured: ${tag}`);
      assert.deepEqual(await stackFindings('.hps-shell *'), [], `every text element ends with the colour emoji faces: ${tag}`);
      const text = await browser.evaluate(`(() => { const f = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily : null; }; return { prose: f('.hps-prose p'), user: f('.hps-msg-user, [data-role="user"]'), tool: f('.hps-tool-label, .hps-tool'), root: getComputedStyle(document.documentElement).fontFamily, code: f('.hps-prose code'), mark: f('.tw-task-emoji') }; })()`);
      // Chromium serializes aliases (BlinkMacSystemFont -> "system-ui"): compare with its own serialization of the host value.
      const ui = family ? await browser.evaluate(`(() => { const e = document.createElement('i'); e.style.fontFamily = ${JSON.stringify(family)}; document.body.appendChild(e); const f = getComputedStyle(e).fontFamily; e.remove(); return f; })()`) : '-apple-system, system-ui, sans-serif';
      assert.equal(text.root, `${ui}, ${EMOJI}`, `root: host or UI face first, then emoji: ${tag}`);
      assert.equal(text.prose, `-apple-system, system-ui, sans-serif, ${EMOJI}`, `answer prose: content role, then emoji: ${tag}`);
      assert.ok(text.code && !/Emoji/.test(text.code), `inline code keeps the code role only: ${tag} ${text.code}`);
      const emojiFaces = await facesFor('#probe-emoji'), digitFaces = await facesFor('#probe-digits');
      assert.ok(!digitFaces.some(f => COLOUR_FACE.test(f)), `digits never drawn by an emoji face: ${tag} ${digitFaces}`);
      if (platform() === 'darwin') assert.deepEqual(emojiFaces, ['Apple Color Emoji'], `macOS draws emoji with Apple Color Emoji: ${tag}`);
      else if (platform() === 'win32') assert.deepEqual(emojiFaces, ['Segoe UI Emoji'], `Windows draws emoji with Segoe UI Emoji: ${tag}`);
      else assert.ok(emojiFaces.length > 0, `emoji drawn: ${tag}`);
      if (evidence && host !== 'windows') { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/${seat}-${width}-${dark ? 'dark' : 'light'}-${host}.png`, Buffer.from(shot.data, 'base64')); }
    }
  }
  console.log(`PASS ChatPanel emoji font stack: personal/classroom, dark/light, 800/1420, default/mac/windows host font (${platform()})`);

  // The learner-chosen task mark (CGP-KNOW-R-008) lives in the App's task rail, so mount the real App bundle.
  const app = await build({ entryPoints: [fileURLToPath(new URL('main.tsx', src))], bundle: true, platform: 'browser', format: 'iife', outdir: 'emoji-app-assets', write: false, loader: { '.svg': 'dataurl' }, logLevel: 'silent' });
  const appCss = app.outputFiles.find(f => f.path.endsWith('.css')).text, appJs = app.outputFiles.find(f => f.path.endsWith('.js')).text;
  const stub = `window.acquireVsCodeApi=()=>({postMessage:()=>{},getState:()=>undefined,setState:()=>{}});`;
  for (const dark of [true, false]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';') + `;--vscode-font-family:${HOSTS.mac}`;
    await browser.load(`<html style="${vars}"><style>${appCss}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>${stub}</script><script>${appJs}</script></body></html>`, { width: 1420, height: 900, dark });
    const workspace = { scope: 'emoji-test', revision: 1, activeTaskId: 'task', tasks: [{ id: 'task', title: '고양이 페이지', createdAt: 1, updatedAt: 9, messageCount: 1, appearance: { emoji: 'cat' } }], sourceSelection: null };
    const config = chatConfig(3, { activity: { ...chatConfig().activity, kind: 'personal' }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: workspace });
    for (const data of [{ type: 'config', config }, { type: 'history', messages: [] }]) { await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(data)}}))`); await new Promise(r => setTimeout(r, 80)); }
    const mark = await browser.evaluate(`(() => { const e = document.querySelector('.tw-task-emoji'); return e ? { text: e.textContent, font: getComputedStyle(e).fontFamily } : null; })()`);
    assert.ok(mark && mark.text === '🐱', `task mark drawn: ${JSON.stringify(mark)}`);
    assert.ok(mark.font.endsWith(EMOJI) && !mark.font.startsWith('"Apple Color Emoji"'), `task mark ends with the colour emoji faces: ${mark.font}`);
    assert.deepEqual(await stackFindings('.tw-rail *'), [], `every task rail text ends with the colour emoji faces (${dark ? 'dark' : 'light'})`);
    if (platform() === 'darwin') assert.deepEqual(await facesFor('.tw-task-emoji'), ['Apple Color Emoji'], 'macOS draws the task mark with Apple Color Emoji');
    if (evidence) { const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/app-task-rail-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
  }
  console.log('PASS App task rail: the learner-chosen task mark uses the colour emoji faces (dark/light)');

  const { withDesignTokens } = await import('../../../chalk/src/lib/design-tokens.ts');
  const ui = new URL('../../../chalk/src/ui/', import.meta.url);
  let pages = 0;
  for (const file of readdirSync(ui).filter(f => f.endsWith('.html'))) {
    const html = withDesignTokens(readFileSync(new URL(file, ui), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await browser.load(html, { width: 1280 });
    await browser.evaluate(`(() => { for (const [id, t] of [['digits','0123456789#*'],['emoji','🎉🐱']]) { const s = document.createElement('p'); s.id = 'probe-' + id; s.textContent = t; document.body.appendChild(s); } const b = document.createElement('button'); b.textContent = '확인 ✅'; document.body.appendChild(b); })()`);
    const findings = (await stackFindings('body, body *')).filter(f => !/^(STYLE|SCRIPT|TITLE)/.test(f));
    // Chalk pages keep their own fixed-width selectors for handles and tokens; only the shared roles are pinned here.
    const roles = await browser.evaluate(`(() => { const f = s => getComputedStyle(document.querySelector(s)).fontFamily; return { body: f('body'), p: f('#probe-emoji'), button: f('body > button:last-of-type'), code: document.querySelector('pre,code') ? f('pre,code') : null }; })()`);
    assert.equal(roles.body, `-apple-system, system-ui, sans-serif, ${EMOJI}`, `${file}: body UI role then emoji`);
    assert.equal(roles.p, `-apple-system, system-ui, sans-serif, ${EMOJI}`, `${file}: content role then emoji`);
    assert.equal(roles.button, `-apple-system, system-ui, sans-serif, ${EMOJI}`, `${file}: controls UI role then emoji`);
    if (roles.code !== null) assert.ok(!/Emoji/.test(roles.code), `${file}: code keeps the code role only (${roles.code})`);
    assert.ok(!(await facesFor('#probe-digits')).some(f => COLOUR_FACE.test(f)), `${file}: digits never drawn by an emoji face`);
    if (platform() === 'darwin') assert.deepEqual(await facesFor('#probe-emoji'), ['Apple Color Emoji'], `${file}: macOS colour emoji`);
    if (findings.length) console.log(`  note ${file}: ${findings.length} element(s) with a page-local face (not a shared role)`, process.env.EMOJI_DEBUG ? findings : "");
    pages++;
  }
  assert.ok(pages >= 9, `Chalk pages measured: ${pages}`);
  console.log(`PASS Chalk shared roles end with the colour emoji faces (${pages} pages)`);
} finally { await browser.close(); }
