import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('lesson-capability-entry-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('lesson-capability-entry-layout NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the stylesheets as shipped (main.tsx order: tokens, component css, styles, chatDetails) ----------
const others = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const bundled = await build({
  stdin: { contents: ['tokens.css', ...others, 'styles.css', 'chatDetails.css'].map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = bundled.outputFiles.find((o) => o.path.endsWith('.css')).text;

// ---------- the real composer markup ----------
const dir = mkdtempSync(join(tmpdir(), 'lesson-capability-entry-layout-'));
const markup = {};
try {
  const out = join(dir, 'render.cjs');
  await build({ stdin: { contents: 'export { ChatPanel } from "./webview-ui/src/ChatPanel"; export { renderToStaticMarkup } from "react-dom/server"; export { createElement } from "react";', resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' }, alias: { react: join(root, 'webview-ui/node_modules/react'), 'react-dom': join(root, 'webview-ui/node_modules/react-dom') }, banner: { js: 'globalThis.window = { innerWidth: 1420, addEventListener() {}, removeEventListener() {} };' }, logLevel: 'error' });
  const { ChatPanel, renderToStaticMarkup, createElement } = createRequire(import.meta.url)(out);
  const originalError = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) originalError(...args); };
  const noop = () => {};
  const ux = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
  for (const seat of ['classroom', 'personal']) for (const streaming of [false, true]) {
    markup[`${seat}/${streaming ? 'stop' : 'send'}`] = renderToStaticMarkup(createElement(ChatPanel, { messages: [], streaming, config: { hasToken: true, lessonCapabilityEntry: {id:'entry',seen:false}, aiCapabilities: [{key:'read',label:'파일 읽기',on:true},{key:'write',label:'파일 고치기',on:false}], profile: { ux, welcome: { greeting_md: '' }, profile_id: 'studio-native-trial', activity_kind: 'trial', lesson: null }, activity: { id: 'a1', verified: true, workspace: '/tmp/synthetic' }, coach: { name: '코치', configured: true }, taskWorkspace: seat === 'personal' ? { tasks: [], sources: [] } : undefined }, onSend: noop, onCancel: noop, onSettings: noop, onSetToken: noop }));
  }
  console.error = originalError;
} finally { rmSync(dir, { recursive: true, force: true }); }

// Actual card/button layout and cascade, including the narrow header.
const b = await launch(bin);
try {
  for (const width of [1420,800,320]) for (const dark of [true,false]) for (const forcedColors of [false,true]) for (const html of Object.values(markup)) {
    await b.load(`<!doctype html><style>:root{--vscode-foreground:${dark?'#eee':'#222'};--vscode-editor-background:${dark?'#222':'#fff'}}${css}</style><body class="${dark?'vscode-dark':'vscode-light'}">${html}</body>`, {width,height:800,dark,forcedColors});
    const result = await b.evaluate(`(() => {
      const next = document.querySelector('.hp-capability-next');
      const reopen = document.querySelector('.hp-capability-reopen');
      const card = document.querySelector('.hp-ai-can-do[open]');
      return { buttons:[next,reopen].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})), open:!!card, next:next.textContent,
        overflow:document.documentElement.scrollWidth > innerWidth,
        title:[...document.querySelectorAll('.hps-coach-name:not(.hps-sr-only)')].every(e=>e.scrollWidth<=e.clientWidth) };
    })()`);
    assert.equal(result.open,true);
    assert.equal(result.next,'다음');
    assert.ok(result.buttons.every(e=>e.w>=44 && e.h>=44 && e.font>=14),JSON.stringify(result));
    assert.equal(result.overflow,false,`overflow at ${width}`);
    assert.equal(result.title,true,`short Korean title at ${width}`);
  }
} finally { await b.close(); }
console.log('lesson-capability-entry-layout OK');
