// REQ-KNOW-33 / CGP-KNOW-R-018: the receiver-AI storage line is SEEN before content leaves, not only present in the DOM.
//   FOCUS_REQUIRE_BROWSER=1 node test/recipient-ai-memory-visible.smoke.mjs
//
// The real OutboundDialog (two recipient sections), PublicAudienceDialog (the in-panel public step) and HelpRequest
// (classroom help preview) are bundled with the webview stylesheets in main.tsx order and mounted in headless Chromium.
// Every [data-recipient-ai-memory] line must pass the shared visibility probe (test/lib/visible-text.mjs): no hidden
// attribute or display:none on it or an ancestor, visibility visible, opacity, a real box with no clip, not cut by an
// overflow container, on screen and not painted over, >= 14px, 4.5:1 contrast. Personal and classroom, dark and light,
// 1420 and 800 px, plus forced colours. Negative controls then hide each line six ways and the probe must report it.
// Keys and clicks are never sent; nothing touches the desktop. Without a headless Chromium this prints NOT RUN;
// FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { visibleTextProbe } from './lib/visible-text.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = resolve(root, 'extensions/hypeproof-chat/webview-ui/src');
const bin = findChromium();
if (!bin || process.env.FOCUS_STATIC_ONLY) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('recipient-ai-memory-visible: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('recipient-ai-memory-visible: NOT RUN (no headless Chromium; set HEADLESS_CHROMIUM or FOCUS_REQUIRE_BROWSER=1)');
  process.exit(0);
}
const LINE = '받는 사람의 AI 기억: 확인 안 됨';

const entry = `
import "./tokens.css";
import "./focusGeometry.css";
import { App } from "./App";
import "./styles.css";
import "./chatDetails.css";
import { createRoot } from "react-dom/client";
import { OutboundDialog, PublicAudienceDialog } from "./OutboundDialog";
import { HelpRequest } from "./HelpRequest";
window.__keep = [App];
const content = { id: 'c1', public: false, notes: [], excluded: '포함하지 않는 것: AI 기억, 개인 메모', sections: [
  { recipient: '강사 김하나 · 이번 수업', items: [{ id: '0:0', label: '내가 쓴 질문', bytes: 120 }, { id: '0:1', label: 'index.html', bytes: 1200 }] },
  { recipient: '함께 보는 친구 · 이번 수업', items: [{ id: '1:0', label: '결과물 주소', bytes: 64 }] }] };
const publicStep = { id: 'p1', step: 'public', audience: '인터넷의 누구나', notAudience: '우리 반', recipient: 'GitHub · github.com/octo/neo · 사이트 octo.github.io' };
const question = '예약 버튼을 눌러도 아무 일도 안 일어나요';
const help = { generation: 1, draft_key: 'c|p|u|run', seat: 'A-07', availability: { state: 'ready', assignment: { recipient_id: '강사-김하나', seat_id: 'A-07' } },
  draft: { question, turnId: null, duration: 30, updated_at: 1 }, turns: [],
  envelope: { request_id: 'req-1', draft_key: 'c|p|u|run', send_key: 'k', recipient_id: '강사-김하나', class_run_id: 'run', grant_id: 'g', seat_id: 'A-07', duration_minutes: 30,
    content: { question, prompt: '버튼 고쳐 줘' }, prepared_at: 1, class_ends_at: '2099-01-01T00:00:00Z', consent_expires_at: 4000000000, consent_proof: 'p', state: 'prepared', truncated: [] },
  current: [], history: [], refresh: { state: 'ok', at: 1 }, note: null };
const scene = { content: <OutboundDialog prompt={content} onAnswer={() => {}} />, public: <PublicAudienceDialog prompt={publicStep} onAnswer={() => {}} />, help: <HelpRequest view={help} post={() => {}} /> }[window.__scene];
createRoot(document.getElementById('r')).render(scene);
`;
const built = await build({
  stdin: { contents: entry, resolveDir: SRC, sourcefile: 'recipient-ai-memory-entry.tsx', loader: 'tsx' },
  bundle: true, write: false, outdir: 'out', jsx: 'automatic', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
});
const js = built.outputFiles.find((o) => o.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script');
const css = built.outputFiles.find((o) => o.path.endsWith('.css')).text;
// The host sets editor-foreground in both themes; without it the light harness renders the card washed out.
const THEMES = {
  dark: { cls: 'vscode-dark', id: 'HypeProof Studio', v: { focusBorder: '#D5F279', 'editor-background': '#151D19', 'editor-foreground': '#F2F4E8', foreground: '#F2F4E8' } },
  light: { cls: 'vscode-light', id: 'Light Modern', v: { focusBorder: '#005fb8', 'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', foreground: '#3b3b3b' } },
};
const page = (theme, seat, sceneName) => `<!doctype html><html><head><meta charset="utf-8"><style>:root{${Object.entries(theme.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${css}</style></head>
<body class="${theme.cls}" data-vscode-theme-id="${theme.id}" style="margin:0;background:var(--hp-bg-app-default);color:var(--hp-text-primary-default)">${seat === 'personal' ? '<div class="hps-shell" data-chat-detail="personal"><div class="tw-workspace"><div id="r"></div></div></div>' : '<div class="hps-shell"><div id="r"></div></div>'}
<script>window.__scene=${JSON.stringify(sceneName)}</script><script>${js}</script></body></html>`;

const EXPECTED = { content: 2, public: 1, help: 1 };
const MUTATIONS = {
  'hidden attribute': `e.hidden = true`,
  'display:none': `e.style.display = 'none'`,
  'visibility:hidden': `e.style.visibility = 'hidden'`,
  'zero size + clip': `Object.assign(e.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' })`,
  'opacity 0': `e.style.opacity = '0'`,
  'off-screen': `Object.assign(e.style, { position: 'fixed', left: '-9999px' })`,
};
const SEL = '[data-recipient-ai-memory]';
const b = await launch(bin);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let checked = 0;
try {
  for (const sceneName of Object.keys(EXPECTED)) {
    for (const seat of ['personal', 'classroom']) {
      for (const mode of [{ theme: 'dark' }, { theme: 'light' }, { theme: 'dark', forcedColors: true }]) {
        for (const width of [1420, 800]) {
          await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
          await b.load(page(THEMES[mode.theme], seat, sceneName), { width, height: 800, dark: mode.theme === 'dark', forcedColors: !!mode.forcedColors });
          await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: mode.theme }, { name: 'forced-colors', value: mode.forcedColors ? 'active' : 'none' }] });
          // The help card is a <details> the learner opened to write the request; the preview only exists inside it.
          if (sceneName === 'help') { await b.evaluate(`document.querySelector('details.hp-help').open = true`); await wait(100); }
          await wait(200);
          const id = `${sceneName} ${seat} ${mode.forcedColors ? 'forced' : mode.theme} @${width}`;
          const found = await b.evaluate(visibleTextProbe(SEL, { minFont: 14 }));
          assert.equal(found.length, EXPECTED[sceneName], `${id}: one line per recipient (${found.length})`);
          for (const [i, f] of found.entries()) {
            assert.equal(f.text, LINE, `${id} #${i}: exact unknown-policy wording`);
            assert.deepEqual(f.problems, [], `${id} #${i}: the line must be visible — ${f.problems.join('; ')}`);
            checked++;
          }
          if (width === 800 && mode.theme === 'dark' && !mode.forcedColors && seat === 'personal') {
            for (const [label, mutate] of Object.entries(MUTATIONS)) {
              const problems = await b.evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(SEL)})[${EXPECTED[sceneName] - 1}], before = e.getAttribute('style'), wasHidden = e.hidden;
                ${mutate}; const r = (${visibleTextProbe(SEL, { minFont: 14 })})[${EXPECTED[sceneName] - 1}]?.problems ?? ['gone'];
                e.hidden = wasHidden; if (before === null) e.removeAttribute('style'); else e.setAttribute('style', before); return r; })()`);
              assert.ok(problems.length > 0, `${sceneName}: probe missed "${label}"`);
            }
          }
        }
      }
    }
  }
} finally { await b.close(); }
console.log(`recipient-ai-memory-visible: ${checked} visible lines (checklist ×2 recipients, public step, help preview; personal/classroom, dark/light/forced, 1420/800); 6 hiding controls per dialog — PASS`);
