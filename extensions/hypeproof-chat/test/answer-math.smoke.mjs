// CGP-CHAT-R-022 (REQ-STUDIO-ANSWER-MATH) in headless Chromium, on the real Vite build.
// The webview is built with its own vite.config.ts into a temp folder and served from one local
// origin under the chat panel's real CSP (buildChatPanelCsp with that origin as cspSource), so a
// font that came from the network, or a data: font the CSP would refuse, fails here. Measured on
// the real ChatPanel in personal and classroom, dark and light, 800 and 1420 px, plus forced
// colours: KaTeX fonts load, display math is centred and scrolls inside its own focusable block,
// invalid TeX shows raw, math takes the prose colour and size, and copy returns the TeX source.
// KaTeX is a lazy chunk: the test app is built with code splitting, so the chunk is a real separate
// request under the CSP, and a page without math must never request it. A command that asks for
// trust (\href) shows its exact source. A wide block's scrollbar never covers its subscripts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN answer math: no Chromium'); process.exit(0); }

const ui = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'hp-answer-math-'));
const vite = await import(pathToFileURL(createRequire(ui + 'package.json').resolve('vite')).href);
await vite.build({ root: ui, configFile: ui + 'vite.config.ts', logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
const builtCss = readFileSync(join(out, 'assets/index.css'), 'utf8');
assert.ok(/KaTeX_Main-Regular\.woff2/.test(builtCss), 'KaTeX fonts are part of the built CSS');
assert.ok(!/url\(\s*["']?data:font/.test(builtCss), 'no font is inlined as data: (the chat CSP has no data: in font-src)');
assert.ok(!/url\(\s*["']?(https?:)?\/\//.test(builtCss), 'no CSS url points at another host');
assert.ok(existsSync(join(out, 'assets/KaTeX_Main-Regular.woff2')), 'font files are emitted next to the CSS');
// Only woff2 ships: Chromium always takes it, and the woff/ttf copies were ~850 KB of dead weight.
assert.ok(!/format\(["']?(woff|truetype)["']?\)/.test(builtCss), 'the built CSS lists woff2 only');
assert.deepEqual(readdirSync(join(out, 'assets')).filter(f => /\.(woff|ttf)$/.test(f)), [], 'no woff/ttf font file is emitted');
// KaTeX is not in the main chunk: index.js imports the mathTypeset chunk on demand.
const mainJs = readFileSync(join(out, 'assets/index.js'), 'utf8');
assert.ok(!mainJs.includes('KaTeX parse error'), 'KaTeX is not bundled into index.js');
assert.ok(/import\(\s*[`"']\.\/mathTypeset\.js[`"']\s*\)/.test(mainJs), 'index.js imports the mathTypeset chunk dynamically');
assert.ok(readFileSync(join(out, 'assets/mathTypeset.js'), 'utf8').includes('KaTeX parse error'), 'KaTeX lives in the mathTypeset chunk');

const csp = await esbuild({ entryPoints: [fileURLToPath(new URL('../src/cspBuilder.ts', import.meta.url))], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
const { buildChatPanelCsp } = await import('data:text/javascript;base64,' + Buffer.from(csp.outputFiles[0].text).toString('base64'));
// ESM with splitting, so `import('./mathTypeset')` stays a separate chunk, as in the Vite build.
const appDir = mkdtempSync(join(ui, '.answer-math-app-'));
writeFileSync(join(appDir, 'app.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {ChatPanel} from '../src/ChatPanel';createRoot(document.getElementById('root')).render(<ChatPanel {...window.fixture}/>);`);
let app;
try {
  app = await esbuild({ entryPoints: { app: join(appDir, 'app.tsx') }, bundle: true, write: false, splitting: true, outdir: '/app', platform: 'browser', format: 'esm', loader: { '.css': 'empty', '.svg': 'dataurl' }, logLevel: 'silent' });
} finally { rmSync(appDir, { recursive: true, force: true }); }
const appFiles = new Map(app.outputFiles.map(f => [f.path, f.text]));
const isMathChunk = path => /^\/app\/mathTypeset-[^/]+\.js$/.test(path);
assert.ok([...appFiles.keys()].some(isMathChunk), `the test app keeps KaTeX in its own chunk (${[...appFiles.keys()]})`);

const ANSWER = [
  '넓이는 $\\pi r^2$이에요.',
  '',
  '$$',
  '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
  '$$',
  '',
  '$$',
  `${Array.from({ length: 40 }, (_, i) => `a_{${i}}x^{${i}}`).join(' + ')}`,
  '$$',
  '',
  '틀린 식 $\\frac{1}{$ 은 그대로 보여요. 가격은 $5이고 $10이에요.',
  '',
  '링크 시도 $\\href{https://evil.example}{click}$ 도 그대로예요.',
].join('\n');
const NO_MATH = '수식이 없는 답변이에요. 가격은 $5이고 $10이에요.';
const requests = [];
const pages = new Map();
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.html': 'text/html; charset=utf-8' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requests.push(path);
  if (pages.has(path)) { res.writeHead(200, { 'content-type': types['.html'] }); return res.end(pages.get(path)); }
  if (appFiles.has(path)) { res.writeHead(200, { 'content-type': types['.js'] }); return res.end(appFiles.get(path)); }
  const file = normalize(join(out, path));
  if (!file.startsWith(out) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const evidence = process.env.ANSWER_MATH_EVIDENCE ?? join(homedir(), '.hypeproof/loop/cgp-chatr022-math-in-answers-renders');
if (process.env.ANSWER_MATH_EVIDENCE !== '') mkdirSync(evidence, { recursive: true });
const pause = (ms = 80) => new Promise(r => setTimeout(r, ms));
const b = await launch(bin);
let page = 0;
const pageFor = (vars, dark, seat, config, messages) => {
  const nonce = `n${++page}`;
  const name = `/page${page}.html`;
  pages.set(name, `<!doctype html><html style="${vars}"><head><meta http-equiv="Content-Security-Policy" content="${buildChatPanelCsp({ cspSource: origin, nonce })}"><link rel="stylesheet" href="/assets/index.css"></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div class="${seat === 'personal' ? 'tw-workspace' : ''}" style="display:block;height:900px"><div id="root"></div></div><script nonce="${nonce}">window.violations=[];document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective+' '+e.blockedURI));window.fixture=${JSON.stringify(chatPanelProps({ config, messages })).replace(/</g, '\\u003c')};window.written=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{window.written.push(t);return Promise.resolve()}}});</script><script type="module" nonce="${nonce}" src="/app/app.js"></script></body></html>`);
  return name;
};
try {

  // A page whose answer has no math never requests the KaTeX chunk or a KaTeX font.
  {
    const vars = Object.entries(THEMES['Dark+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const name = pageFor(vars, true, 'classroom', chatConfig(3, { profile: { ...chatConfig().profile, lesson: null } }), [{ id: 'a0', role: 'assistant', content: NO_MATH, createdAt: 1 }]);
    await b.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
    requests.length = 0;
    await b.send('Page.navigate', { url: origin + name });
    for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-prose')`).catch(() => false)); i++) await pause(100);
    await pause(400);
    assert.ok(requests.includes('/app/app.js'), 'control: the app loaded');
    assert.deepEqual(requests.filter(p => isMathChunk(p) || /KaTeX/.test(p)), [], 'an answer without math loads no KaTeX chunk or font');
    assert.ok((await b.evaluate(`document.querySelector('.hps-prose').innerText`)).includes(NO_MATH), 'no-math answer text is exact');
    requests.length = 0;
    console.log('PASS no math: KaTeX chunk and fonts not requested');
  }

  for (const seat of ['personal', 'classroom']) for (const dark of [true, false]) for (const width of [800, 1420]) for (const forcedColors of [false, true]) {
    if (forcedColors && (width !== 800 || !dark)) continue;
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    const config = chatConfig(3, { activity: { ...chatConfig().activity, kind: seat }, profile: { ...chatConfig().profile, lesson: null }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined });
    const messages = [{ id: 'u1', role: 'user', content: '공식 알려줘', createdAt: 1 }, { id: 'a1', role: 'assistant', content: ANSWER, createdAt: 2 }];
    const name = pageFor(vars, dark, seat, config, messages);
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await b.send('Page.navigate', { url: origin + name });
    // Raw text first; typeset blocks (role=region) once the KaTeX chunk has loaded.
    for (let i = 0; i < 50 && !(await b.evaluate(`!!document.querySelector('.hps-math-block[role="region"]')`).catch(() => false)); i++) await pause(100);
    for (let i = 0; i < 50 && (await b.evaluate(`document.fonts.status`)) !== 'loaded'; i++) await pause(100);
    await pause(150);
    const tag = `${seat} ${width} ${dark ? 'dark' : 'light'}${forcedColors ? ' forced' : ''}`;

    const r = await b.evaluate(`(()=>{
      const prose=document.querySelector('.hps-prose'), p=prose.querySelector('p');
      const inline=prose.querySelector('.hps-math-inline .katex'), blocks=[...prose.querySelectorAll('.hps-math-block[role="region"]')];
      const katexFaces=[...document.fonts].filter(f=>f.family.replace(/"/g,'').startsWith('KaTeX_'));
      const col=(prose.closest('.hps-bubble,.hps-message,.hps-chat-column,.hps-messages,main')||document.body).getBoundingClientRect();
      const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};
      return {
        violations:window.violations,
        mainLoaded:document.fonts.check('20px KaTeX_Main') && katexFaces.some(f=>f.family.replace(/"/g,'')==='KaTeX_Main'&&f.status==='loaded'),
        mathFont:getComputedStyle(inline).fontFamily,
        inlineSize:parseFloat(getComputedStyle(inline).fontSize), proseSize:parseFloat(getComputedStyle(p).fontSize),
        inlineColor:getComputedStyle(inline.querySelector('.katex-html')).color, proseColor:getComputedStyle(p).color,
        inlineBox:box(inline), lineBox:box(p),
        blocks:blocks.map(b=>{const k=b.querySelector('.katex-display > .katex');b.scrollLeft=60;const scrolled=b.scrollLeft;b.scrollLeft=0;const rb=b.getBoundingClientRect();let glyphBottom=0;const w=document.createTreeWalker(b.querySelector('.katex-html'),NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){if(!n.textContent.trim())continue;const g=document.createRange();g.selectNodeContents(n);for(const q of g.getClientRects())if(q.height)glyphBottom=Math.max(glyphBottom,q.bottom);}return {glyphBottom,clientBottom:rb.top+b.clientTop+b.clientHeight,bar:b.offsetHeight-b.clientHeight-b.clientTop*2,scrolled,overflowX:getComputedStyle(b).overflowX,tab:b.tabIndex,label:b.getAttribute('aria-label'),client:b.clientWidth,scroll:b.scrollWidth,box:box(b),k:box(k),color:getComputedStyle(b.querySelector('.katex-html')).color}}),
        column:{right:Math.min(col.right,document.documentElement.clientWidth)},
        page:{scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth},
        raw:[...prose.querySelectorAll('.hps-math-raw')].map(e=>e.textContent),
        links:prose.querySelectorAll('a').length,
        mathChunkLoaded:performance.getEntriesByType('resource').some(e=>e.name.includes('/app/mathTypeset-')),
        visible:prose.innerText,
      };
    })()`);
    assert.deepEqual(r.violations, [], `${tag}: no CSP violations`);
    assert.ok(r.mainLoaded, `${tag}: KaTeX_Main loaded from the bundle`);
    assert.ok(/KaTeX_/.test(r.mathFont), `${tag}: math uses KaTeX fonts (${r.mathFont})`);
    assert.ok(r.inlineSize >= r.proseSize && r.inlineSize >= 14, `${tag}: inline math is at least prose size (${r.inlineSize} vs ${r.proseSize})`);
    assert.equal(r.inlineColor, r.proseColor, `${tag}: inline math takes the prose text colour`);
    assert.ok(r.inlineBox.top >= r.lineBox.top - 4 && r.inlineBox.bottom <= r.lineBox.bottom + 4, `${tag}: inline math sits in its line`);
    assert.equal(r.blocks.length, 2, `${tag}: two display blocks`);
    for (const blk of r.blocks) {
      assert.equal(blk.tab, 0, `${tag}: display block is keyboard focusable`);
      assert.equal(blk.label, '수식', `${tag}: display block is labelled`);
      assert.equal(blk.color, r.proseColor, `${tag}: display math takes the prose text colour`);
      assert.ok(blk.box.right <= r.column.right + 1, `${tag}: display block stays inside the answer column`);
    }
    const [small, wide] = r.blocks;
    const centre = small.k.left + small.k.width / 2, blockCentre = small.box.left + small.box.width / 2;
    assert.ok(Math.abs(centre - blockCentre) <= 2, `${tag}: short display formula is centred (${centre} vs ${blockCentre})`);
    assert.ok(wide.scroll > wide.client + 20, `${tag}: a wide formula scrolls inside its block`);
    assert.equal(wide.overflowX, 'auto', `${tag}: the block is its own horizontal scroller`);
    assert.ok(wide.scrolled > 0, `${tag}: the wide formula can be scrolled`);
    assert.equal(small.scrolled, 0, `${tag}: a short formula does not scroll`);
    assert.ok(r.page.scroll <= r.page.width + 1, `${tag}: page has no horizontal scroll`);
    assert.deepEqual(r.raw, ['$\\frac{1}{$', '$5이고 $', '$\\href{https://evil.example}{click}$'], `${tag}: invalid TeX, money and a trust command stay raw`);
    assert.ok(r.visible.includes('링크 시도 $\\href{https://evil.example}{click}$ 도 그대로예요.'), `${tag}: the refused command reads exactly as written`);
    assert.equal(r.links, 0, `${tag}: no link inside the answer prose`);
    assert.ok(r.mathChunkLoaded, `${tag}: the KaTeX chunk was fetched for a page with math`);
    // The wide block's horizontal scrollbar must not cover the subscripts. A classic bar sits below
    // the client area (clientHeight excludes it); an overlay bar (bar = 0, as in headless Chromium)
    // is drawn over the client area's bottom ~6px, so the glyphs must end at least that far above it.
    const reserve = wide.bar > 0 ? 0 : 6;
    assert.ok(wide.glyphBottom <= wide.clientBottom - reserve + 0.5, `${tag}: the scrollbar does not cover the subscripts (glyphs end ${wide.glyphBottom.toFixed(1)}, client area ends ${wide.clientBottom.toFixed(1)}, bar ${wide.bar}px)`);
    assert.ok(r.visible.includes('틀린 식 $\\frac{1}{$ 은 그대로 보여요. 가격은 $5이고 $10이에요.'), `${tag}: raw text reads exactly as written`);

    const focus = await b.focusVisibleStyle('.hps-math-block[role="region"]');
    assert.ok(parseFloat(focus['outline-width']) >= 2 && focus['outline-style'] === 'solid', `${tag}: focus ring on the display block`);
    assert.ok(parseFloat(focus['outline-offset']) < 0, `${tag}: ring sits inside the scrolling block (${focus['outline-offset']})`);

    // Copy: a selection from the sentence into the middle of the inline formula, and one over a display block.
    const copied = await b.evaluate(`(()=>{
      const copy=()=>{const dt=new DataTransfer();const e=new ClipboardEvent('copy',{clipboardData:dt,bubbles:true,cancelable:true});document.dispatchEvent(e);return {plain:dt.getData('text/plain'),prevented:e.defaultPrevented}};
      const sel=getSelection(), p=document.querySelector('.hps-prose p'), k=p.querySelector('.katex-html');
      const range=document.createRange(); range.setStart(p.firstChild,0);
      const glyph=document.createTreeWalker(k,NodeFilter.SHOW_TEXT).nextNode(); range.setEnd(glyph,1);
      sel.removeAllRanges(); sel.addRange(range); const inline=copy();
      const back=document.createRange(); back.setStart(glyph,1); back.setEnd(p.lastChild,p.lastChild.textContent.length);
      sel.removeAllRanges(); sel.addRange(back); const fromInside=copy();
      const block=document.querySelector('.hps-math-block'); const r2=document.createRange(); r2.selectNode(block);
      sel.removeAllRanges(); sel.addRange(r2); const display=copy();
      const r3=document.createRange(); r3.selectNodeContents(document.querySelectorAll('.hps-prose p')[1]);
      sel.removeAllRanges(); sel.addRange(r3); const plain=copy();
      sel.removeAllRanges(); return {inline,fromInside,display,plain};
    })()`);
    assert.equal(copied.inline.plain, '넓이는 $\\pi r^2$', `${tag}: a half-selected formula copies as its whole TeX source`);
    assert.equal(copied.fromInside.plain, '$\\pi r^2$이에요.', `${tag}: a selection starting inside a formula copies the whole TeX source`);
    assert.equal(copied.display.plain.trim(), '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$', `${tag}: display math copies as $$TeX$$`);
    assert.equal(copied.plain.prevented, false, `${tag}: a selection without math copies as usual`);
    if (seat === 'personal') {
      await b.evaluate(`document.querySelector('.hps-copy-answer').click()`); await pause();
      assert.deepEqual(await b.evaluate('window.written'), [ANSWER], `${tag}: 답변 복사 returns the TeX source`);
    }
    if (evidence && process.env.ANSWER_MATH_EVIDENCE !== '') {
      await b.evaluate(`document.querySelector('.hps-math-block').scrollIntoView({block:'center'})`); await pause();
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(evidence, `math-${seat}-${width}-${dark ? 'dark' : 'light'}${forcedColors ? '-forced' : ''}.png`), Buffer.from(shot.data, 'base64'));
    }
    console.log('PASS', tag);
  }
} finally {
  await b.close(); server.close(); rmSync(out, { recursive: true, force: true });
}
console.log('PASS answer math: bundled fonts under the chat CSP, layout, raw fallback and TeX copy');
