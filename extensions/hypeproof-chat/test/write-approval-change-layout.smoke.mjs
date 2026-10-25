// REQ-STUDIO-WRITE-APPROVAL-CHANGE (CGP-ART-R-021): the change summary in the write approval, measured on the
// actual App (main.tsx with every stylesheet) in headless Chromium. Personal and classroom seats, Dark+ and Light+,
// 320 / 800 / 1420 px: the summary stays inside the dialog (no horizontal scroll at 320), every word in it is at
// least 14px, the rewrite and unknown warnings carry a visible icon beside words with >= 4.5:1 contrast, a partial
// edit has no warning, buttons stay 44px, and forced colours draw the edge and warning in CanvasText.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
// Set WRITE_CHANGE_SCREENSHOTS=<dir> to save one PNG per case.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES, KIND_CLASS } from './lib/vscode-default-themes.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER === '1') { console.error('write-approval-change-layout: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('write-approval-change-layout: NOT RUN (no headless Chromium)');
  process.exit(0);
}
const built = await build({ entryPoints: ['webview-ui/src/main.tsx'], bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', loader: { '.svg': 'dataurl', '.png': 'dataurl' } });
const css = built.outputFiles.find((f) => f.path.endsWith('.css')).text, js = built.outputFiles.find((f) => f.path.endsWith('.js')).text;
const prompt = {
  id: 'request', title: '코치가 파일을 저장하려고 해요', verb: '저장',
  files: ['작업 폴더/index.html · 바꿈', '작업 폴더/style.css · 바꿈', '작업 폴더/' + '아주긴파일이름'.repeat(8) + '.json', '작업 폴더/new.html'],
  changes: [
    { kind: 'measured', percent: '82%', ratio: 0.82, changedLines: 9, addedLines: 4, rewrite: true, almostAll: true, spacingOnly: false },
    { kind: 'measured', percent: '12%', ratio: 0.12, changedLines: 1, addedLines: 0, rewrite: false, almostAll: false, spacingOnly: false },
    { kind: 'unknown', reason: 'no-match' },
    null,
  ],
};
const luminance = (color) => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; };
const contrast = (a, b) => { const l = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l[0] + 0.05) / (l[1] + 0.05); };
const MEASURE = `(() => {
  const d = document.querySelector('.hps-write-approval'); if (!d) return null;
  const r = d.getBoundingClientRect();
  const texts = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c.textContent.trim()) texts.push({ t: c.textContent.trim(), size: parseFloat(getComputedStyle(c.parentElement).fontSize) }); else if (c.nodeType === 1) walk(c); } };
  const sections = [...d.querySelectorAll('.hps-write-change')].map((s) => { walk(s); const q = s.getBoundingClientRect(); const w = s.querySelector('.hps-write-change-warning'); const g = w?.querySelector('svg'); const gr = g?.getBoundingClientRect();
    return { kind: s.dataset.change, left: q.left, right: q.right, text: s.textContent, warning: w ? { color: getComputedStyle(w).color, text: w.textContent, icon: g && gr.width >= 12 && gr.height >= 12 && g.checkVisibility() } : null, border: getComputedStyle(s).borderTopColor, borderW: parseFloat(getComputedStyle(s).borderTopWidth) }; });
  let bg = d; let background = getComputedStyle(bg).backgroundColor;
  return { open: d.open, left: r.left, right: r.right, sections, texts, background, pageOverflow: document.documentElement.scrollWidth > innerWidth, innerOverflow: d.scrollWidth > d.clientWidth,
    buttons: [...d.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return { h: q.height, w: q.width }; }) };
})()`;
const browser = await launch(bin);
let cases = 0;
try {
  for (const seat of ['personal', 'classroom']) for (const themeName of ['Dark+', 'Light+']) for (const width of [320, 800, 1420]) {
    const theme = THEMES[themeName], dark = theme.kind === 'dark';
    const vars = Object.entries(theme).filter(([k, v]) => !['kind', 'file'].includes(k) && v !== null).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await browser.send('Page.navigate', { url: 'about:blank' });
    await browser.load(`<!doctype html><html class="${KIND_CLASS[theme.kind]}" style="${vars};--vscode-editor-foreground:${theme.foreground}"><head><style>${css}</style></head><body class="${KIND_CLASS[theme.kind]}"><div id="root"></div><script>window.errors=[];window.addEventListener("error",e=>errors.push(e.message));window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m),getState(){},setState(){}});${js.replaceAll('</script', '<\\/script')}</script></body></html>`, { width, height: 900, dark });
    const config = { proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true }, activity: { id: 'activity', name: '작업', kind: seat, workspace: '/synthetic', verified: true }, taskWorkspace: seat === 'personal' ? { scope: 's', revision: 1, tasks: [{ id: 'task', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 0 }], activeTaskId: 'task', sourceSelection: null } : undefined, profile: { profile_id: 'synthetic', activity_kind: seat, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } } }, textSize: 'base' };
    await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'config',config:${JSON.stringify(config)}}}))`);
    await browser.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{type:'writeApprovalPrompt',prompt:${JSON.stringify(prompt)}}}))`);
    await new Promise((r) => setTimeout(r, 250));
    const label = `${seat}/${themeName}/${width}`;
    const m = await browser.evaluate(MEASURE);
    assert.ok(m?.open, `${label}: the actual App opens the write approval`);
    assert.deepEqual(m.sections.map((s) => s.kind), ['rewrite', 'partial', 'unknown'], `${label}: one summary per existing file, none for the new file`);
    for (const s of m.sections) assert.ok(s.left >= m.left - 0.5 && s.right <= m.right + 0.5, `${label}: ${s.kind} summary inside the dialog`);
    assert.equal(m.pageOverflow, false, `${label}: no page scroll`); assert.equal(m.innerOverflow, false, `${label}: no horizontal scroll in the dialog`);
    for (const t of m.texts) assert.ok(t.size >= 14, `${label}: "${t.t}" is ${t.size}px`);
    const [rewrite, partial, unknown] = m.sections;
    assert.match(rewrite.text, /바뀌는 정도: 82%/); assert.equal(rewrite.warning?.text, '거의 전부 바뀌어요'); assert.ok(rewrite.warning.icon, `${label}: rewrite icon visible`);
    assert.equal(partial.warning, null, `${label}: a partial edit has no warning`);
    assert.equal(unknown.warning?.text, '얼마나 바뀌는지 미리 알 수 없어요 · 바꿀 부분을 파일에서 찾지 못했어요'); assert.ok(unknown.warning.icon);
    for (const w of [rewrite.warning, unknown.warning]) assert.ok(contrast(w.color, m.background) >= 4.5, `${label}: warning contrast ${contrast(w.color, m.background).toFixed(2)} (${w.color} on ${m.background})`);
    for (const s of m.sections) assert.ok(s.borderW >= 1, `${label}: ${s.kind} has an edge`);
    for (const b of m.buttons) assert.ok(b.h >= 44 && b.w >= 44, `${label}: button ${JSON.stringify(b)}`);
    assert.deepEqual(await browser.evaluate('errors'), [], `${label}: no page errors`);
    if (process.env.WRITE_CHANGE_SCREENSHOTS) { mkdirSync(process.env.WRITE_CHANGE_SCREENSHOTS, { recursive: true }); const png = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${process.env.WRITE_CHANGE_SCREENSHOTS}/${seat}-${theme.kind}-${width}.png`, Buffer.from(png.data, 'base64')); }
    if (width === 800) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      const fc = await browser.evaluate(`(() => { const e = document.createElement('i'); e.style.color = 'CanvasText'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); const s = [...document.querySelectorAll('.hps-write-change')]; return { c, borders: s.map((x) => getComputedStyle(x).borderTopColor), warn: [...document.querySelectorAll('.hps-write-change-warning')].map((x) => getComputedStyle(x).color) }; })()`);
      for (const b of fc.borders) assert.equal(b, fc.c, `${label}: forced-colours edge is CanvasText`);
      for (const w of fc.warn) assert.equal(w, fc.c, `${label}: forced-colours warning is CanvasText`);
      if (process.env.WRITE_CHANGE_SCREENSHOTS) { const png = await browser.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${process.env.WRITE_CHANGE_SCREENSHOTS}/${seat}-${theme.kind}-${width}-forced.png`, Buffer.from(png.data, 'base64')); }
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    }
    cases++;
  }
  console.log(`PASS write approval change summary layout: ${cases} seat/theme/width cases; inside the dialog at 320, >=14px, warning icon + words with 4.5:1 contrast, no warning on a partial edit, 44px buttons, forced colours`);
} finally { await browser.close(); }
