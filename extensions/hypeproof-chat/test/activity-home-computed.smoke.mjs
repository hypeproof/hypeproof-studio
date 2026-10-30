// CGP-KNOW-R-002 (REQ-STUDIO-ACTIVITY-HOME): the activity home's 작업/자료 tabs measured on the CASCADE in
// headless Chromium.
//   node --experimental-strip-types test/activity-home-computed.smoke.mjs
//   ACTIVITY_HOME_PNG=<dir> also saves one PNG per combination.
//
// The real webview entry (main.tsx: the real stylesheet order, App, TaskWorkspace and ChatPanel) is bundled
// and given a personal task-workspace config with the `materials` flag. Dark and light, 1420, 800 and 320 px
// (at 320 the rail is the drawer, opened by its own button), forced colours off and on:
//   - both tabs are 44px targets with at least 14px text, inside the rail, and of equal width;
//   - the chosen tab differs by weight (>= 600 against < 600) and by a 2px solid underline in its own text
//     colour, so the state never rests on colour alone; the other tab has no visible underline;
//   - the tab text has at least 4.5:1 against what is behind it, forced colours included;
//   - the shared 2px focus ring (CGP-DS-D-014) on a tab;
//   - 작업 shows the task list with a real height; 자료 hides it and shows the 자료 list; the composer
//     keeps a typed draft through both switches.
// CGP-KNOW-D-002: the tabs sit under the activity title. The title is shown on one line at >= 14px with 4.5:1,
// inside the rail and above the tablist; a long name ellipsizes (and the page still does not scroll sideways);
// the two segments together fill the tablist, and the tablist fills the rail's row, at every width (320 included).
// A classroom seat (no task workspace) draws no tabs. Self-test: four injected later stylesheets must each
// be caught (seven, three of them for D-002). Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 makes that a failure.
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('activity-home-computed: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('activity-home-computed NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}
const { build } = await import('esbuild');
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(extension, 'webview-ui');
const src = path.join(webview, 'src');
const pngDir = process.env.ACTIVITY_HOME_PNG;
if (pngDir) mkdirSync(pngDir, { recursive: true });

const temp = mkdtempSync(path.join(tmpdir(), 'hps-activity-home-'));
await build({
  entryPoints: [path.join(src, 'main.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
  nodePaths: [path.join(webview, 'node_modules')], alias: { react: path.join(webview, 'node_modules/react'), 'react-dom': path.join(webview, 'node_modules/react-dom') },
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' },
});
const server = createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { try { const body = readFileSync(path.join(temp, u)); res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(body); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const THEMES = {
  dark: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-panel-border:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-font-size:13px;--vscode-font-family:-apple-system, "Apple SD Gothic Neo", sans-serif;--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-panel-border:#e5e5e5;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
const UX = { coach: { naming_mode: 'fixed', fallback_name: '코치', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const config = (surface) => ({
  proxyUrl: 'http://controlled.invalid/v1', model: 'sonnet', hasToken: true, coach: { name: '코치', personality: '', configured: true }, fileAttach: true, materials: true,
  profile: { profile_id: 'synthetic', display_name: '확인', activity_kind: surface, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'a-' + surface, name: surface === 'classroom' ? '3반 웹페이지 만들기' : TITLE, kind: surface, workspace: '/synthetic', verified: true },
  ...(surface === 'classroom' ? {} : { taskWorkspace: { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '반 소개 페이지', createdAt: 1, updatedAt: 1, messageCount: 0 }, { id: 't2', title: '과학 발표 자료 정리', createdAt: 1, updatedAt: 2, messageCount: 3 }], sourceSelection: null } }),
});
const LIST = { scope: '["a1","t1"]', maxSelected: 3, items: [
  { id: 'me:aaaaaaaaaaaa', kind: 'file', title: '발표 계획.md', detail: '자료/발표 계획.md', selected: false, removable: true, origin: 'learner', originLabel: '나' },
  { id: 'inbox:obj-12345678:1', kind: 'note', title: '강사 읽기 자료', detail: '강사가 보낸 글', selected: false, removable: false, origin: 'instructor', originLabel: '강사' },
] };
const TITLE = '2학기 과학 발표 준비와 우리 반 소개 웹페이지 만들기';
const DRAFT = '발표 자료를 같이 정리해 줘 각 👩‍💻';

const measure = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const behind = (e) => { for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const shows = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const rail = document.querySelector('.tw-rail'), rb = rail?.getBoundingClientRect();
  const tabs = [...document.querySelectorAll('.tw-home-tabs [role="tab"]')].map((e) => {
    const s = getComputedStyle(e), b = e.getBoundingClientRect(), fg = parse(s.color), bg = behind(e);
    const ratio = fg ? (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) : 0;
    const under = parse(s.borderBottomColor);
    return { name: e.textContent, selected: e.getAttribute('aria-selected') === 'true', w: b.width, h: b.height, left: b.left, right: b.right, font: parseFloat(s.fontSize), weight: Number(s.fontWeight),
      underlineWidth: parseFloat(s.borderBottomWidth), underlineStyle: s.borderBottomStyle, underlineVisible: !!under && under.a > 0 && s.borderBottomStyle !== 'none' && parseFloat(s.borderBottomWidth) > 0,
      underlineIsText: s.borderBottomColor === s.color, ratio, shown: shows(e) };
  });
  const tl = document.querySelector('.tw-home-tabs'), tlb = tl?.getBoundingClientRect(), rs = rail ? getComputedStyle(rail) : null;
  const tablist = tlb ? { left: tlb.left, right: tlb.right, top: tlb.top, rowLeft: rb.left + parseFloat(rs.paddingLeft), rowRight: rb.right - parseFloat(rs.paddingRight) - parseFloat(rs.borderRightWidth) } : null;
  const te = document.querySelector('.tw-activity-title');
  const title = te ? (() => { const s = getComputedStyle(te), b = te.getBoundingClientRect(), fg = parse(s.color), bg = behind(te);
    const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.6;
    return { text: te.textContent, tag: te.localName, tooltip: te.getAttribute('data-hp-tooltip'), left: b.left, right: b.right, bottom: b.bottom, h: b.height, lh, font: parseFloat(s.fontSize),
      clipped: te.scrollWidth > te.clientWidth + 0.5, ellipsis: s.textOverflow === 'ellipsis', shown: shows(te),
      ratio: fg ? (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) : 0 }; })() : null;
  const list = document.querySelector('.tw-task-list'), materials = document.querySelector('.tw-home-materials .hp-materials');
  return { vw: document.documentElement.clientWidth, docScroll: document.documentElement.scrollWidth, rail: rb ? { left: rb.left, right: rb.right, shown: shows(rail) } : null, tabs, tablist, title,
    taskListShown: shows(list), taskListHeight: list ? list.getBoundingClientRect().height : 0, materialsShown: shows(materials),
    noteDraft: document.querySelector('textarea[name="material-note-text"]')?.value ?? null,
    draft: document.querySelector('.hps-input textarea')?.value ?? null, ringColor: (() => { const p = document.createElement('span'); p.style.color = 'var(--hp-ring-focus-default)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })() };
})()`;

const wait = async (b, expr, tries = 60) => { for (let i = 0; i < tries && !(await b.evaluate(expr).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100)); };

async function open(b, surface, theme, width, forced, extraCss) {
  await b.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: theme }] });
  const { identifier } = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.sent = []; window.state = undefined;
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.sent.push(m), getState: () => window.state, setState: (s) => { window.state = s; } });
    document.addEventListener('DOMContentLoaded', () => { const v = ${JSON.stringify(THEMES[theme])};
      document.documentElement.setAttribute('style', v); document.body.setAttribute('style', v + 'margin:0;height:800px;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-${theme}');
      ${extraCss ? `const s = document.createElement('style'); s.textContent = ${JSON.stringify(extraCss)}; document.head.append(s);` : ''} });` });
  await b.send('Page.navigate', { url: base });
  await wait(b, `!!window.sent && window.sent.some((m) => m.type === 'ready')`, 100);
  await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'config', config: ${JSON.stringify(config(surface))} } }))`);
  await wait(b, `!!document.querySelector('.hps-input textarea')`);
  await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
}

async function runMatrix(b, extraCss) {
  const results = [];
  for (const theme of ['dark', 'light']) for (const width of [1420, 800, 320]) for (const forced of [false, true]) {
    const where = `personal/${theme}/${width}${forced ? '/forced' : ''}`;
    await open(b, 'personal', theme, width, forced, extraCss);
    if (width <= 700) { await b.evaluate(`document.querySelector('.tw-rail-toggle').click()`); await wait(b, `!!document.querySelector('.tw-rail') && document.querySelector('.tw-rail').getClientRects().length > 0`); }
    await wait(b, `!!document.querySelector('#tw-home-tab-tasks')`);
    // A typed draft, through React's own input path.
    await b.evaluate(`(() => { const t = document.querySelector('.hps-input textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(DRAFT)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 50));
    const tasks = await b.evaluate(measure);
    let ring;
    try { ring = await b.focusVisibleStyle('#tw-home-tab-tasks', ['outline-width', 'outline-style', 'outline-color', 'outline-offset', '--hp-focus-offset', '--ds-c-focus-offset']); } catch (e) { ring = { missing: String(e.message) }; }
    await b.evaluate(`document.querySelector('#tw-home-tab-materials').click()`);
    await wait(b, `window.sent.some((m) => m.type === 'materialsRequest')`);
    await b.evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { type: 'materialsState', view: ${JSON.stringify(LIST)} } }))`);
    await wait(b, `!!document.querySelector('.tw-home-materials .hp-materials')`);
    // The materials view has its own textarea. A separate note draft must not be mistaken
    // for (or overwrite) the conversation composer when checking retained input.
    await b.evaluate(`(() => { const t = document.querySelector('textarea[name="material-note-text"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '독립된 자료 메모'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 50));
    const materials = await b.evaluate(measure);
    if (pngDir && !extraCss) {
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path.join(pngDir, `activity-home-${theme}-${width}${forced ? '-forced' : ''}.png`), Buffer.from(shot.data, 'base64'));
    }
    results.push({ where, forced, tasks, materials, ring });
  }
  // Classroom: no task workspace, no tabs.
  await open(b, 'classroom', 'dark', 1420, false, extraCss);
  results.push({ where: 'classroom/dark/1420', classroom: true, tabs: await b.evaluate(`document.querySelectorAll('[role="tablist"]').length`) });
  return results;
}

function check(results) {
  const failures = [];
  const expect = (ok, msg) => { if (!ok) failures.push(msg); };
  for (const r of results) {
    if (r.classroom) { expect(r.tabs === 0, `${r.where}: ${r.tabs} tablists on a classroom seat`); continue; }
    for (const [phase, m, chosen] of [['작업', r.tasks, '작업'], ['자료', r.materials, '자료']]) {
      const at = `${r.where} (${phase})`;
      expect(m.tabs.length === 2, `${at}: ${m.tabs.length} tabs`);
      expect(m.docScroll <= m.vw + 0.5, `${at}: the page scrolls horizontally (${m.docScroll} > ${m.vw})`);
      expect(m.draft === DRAFT, `${at}: the composer draft changed: ${JSON.stringify(m.draft)}`);
      if (m.materialsShown) expect(m.noteDraft === "독립된 자료 메모", `${at}: the materials note draft changed: ${JSON.stringify(m.noteDraft)}`);
      for (const t of m.tabs) {
        expect(t.shown, `${at}: ${t.name} is not shown`);
        expect(t.w >= 43.5 && t.h >= 43.5, `${at}: ${t.name} target is ${Math.round(t.w)}x${Math.round(t.h)}px, under 44`);
        expect(t.font >= 14, `${at}: ${t.name} text is ${t.font}px, under 14`);
        if (m.rail) expect(t.left >= m.rail.left - 0.5 && t.right <= m.rail.right + 0.5, `${at}: ${t.name} ${Math.round(t.left)}..${Math.round(t.right)} outside the rail ${Math.round(m.rail.left)}..${Math.round(m.rail.right)}`);
        // Forced colours too: a label drawn in the colour of its own fill (the system selection pair under Chrome's text backplate) is invisible.
        expect(t.ratio >= 4.5, `${at}: ${t.name} contrast ${t.ratio.toFixed(2)}:1, under 4.5`);
        if (t.selected) {
          expect(t.name === chosen, `${at}: ${t.name} is selected, expected ${chosen}`);
          expect(t.weight >= 600, `${at}: the chosen tab weight is ${t.weight}`);
          expect(t.underlineVisible && t.underlineStyle === 'solid' && t.underlineWidth >= 2, `${at}: the chosen tab has no 2px solid underline (${t.underlineStyle} ${t.underlineWidth})`);
          if (!r.forced) expect(t.underlineIsText, `${at}: the chosen tab's underline is not its text colour`);
        } else {
          expect(t.weight < 600, `${at}: the other tab weight is ${t.weight}`);
          if (!r.forced) expect(!t.underlineVisible, `${at}: the other tab also shows an underline`);
        }
      }
      if (m.tabs.length === 2) expect(Math.abs(m.tabs[0].w - m.tabs[1].w) <= 1, `${at}: unequal tabs ${Math.round(m.tabs[0].w)} and ${Math.round(m.tabs[1].w)}`);
      // CGP-KNOW-D-002: full-width segments — the two tabs span the tablist edge to edge, and the tablist spans the rail's row.
      const tl = m.tablist;
      expect(!!tl, `${at}: no tablist box`);
      if (tl && m.tabs.length === 2) {
        expect(Math.abs(m.tabs[0].left - tl.left) <= 1 && Math.abs(m.tabs[1].right - tl.right) <= 1, `${at}: the segments ${Math.round(m.tabs[0].left)}..${Math.round(m.tabs[1].right)} do not fill the tablist ${Math.round(tl.left)}..${Math.round(tl.right)}`);
        expect(Math.abs(tl.left - tl.rowLeft) <= 1 && Math.abs(tl.right - tl.rowRight) <= 1, `${at}: the tablist ${Math.round(tl.left)}..${Math.round(tl.right)} does not fill the rail row ${Math.round(tl.rowLeft)}..${Math.round(tl.rowRight)}`);
      }
      // CGP-KNOW-D-002: the activity title above the tabs.
      const ti = m.title;
      expect(!!ti && ti.shown, `${at}: no activity title shown above the tabs`);
      if (ti && tl) {
        expect(ti.tag === 'h2' && ti.text === TITLE && ti.tooltip === TITLE, `${at}: the title is <${ti.tag}> ${JSON.stringify(ti.text)} (tooltip ${JSON.stringify(ti.tooltip)}), expected the full activity name`);
        expect(ti.bottom <= tl.top + 0.5, `${at}: the title (bottom ${Math.round(ti.bottom)}) is not above the tabs (top ${Math.round(tl.top)})`);
        if (m.rail) expect(ti.left >= m.rail.left - 0.5 && ti.right <= m.rail.right + 0.5, `${at}: the title ${Math.round(ti.left)}..${Math.round(ti.right)} is outside the rail`);
        expect(ti.font >= 14, `${at}: the title text is ${ti.font}px, under 14`);
        expect(ti.ratio >= 4.5, `${at}: the title contrast ${ti.ratio.toFixed(2)}:1, under 4.5`);
        expect(ti.h <= ti.lh * 1.5, `${at}: the title wraps (${Math.round(ti.h)}px for a ${Math.round(ti.lh)}px line)`);
        if (ti.clipped) expect(ti.ellipsis, `${at}: the title is cut without an ellipsis`);
      }
    }
    expect(r.tasks.taskListShown && r.tasks.taskListHeight >= 44, `${r.where}: 작업 shows no task list (height ${Math.round(r.tasks.taskListHeight)})`);
    expect(!r.tasks.materialsShown, `${r.where}: 작업 also shows the 자료 list`);
    expect(!r.materials.taskListShown && r.materials.materialsShown, `${r.where}: 자료 shows tasks ${r.materials.taskListShown} / list ${r.materials.materialsShown}`);
    const ring = r.ring;
    if (ring.missing) expect(false, `${r.where}: tab ring: ${ring.missing}`);
    else {
      const want = parseFloat((ring['--hp-focus-offset'] || '').trim() || ring['--ds-c-focus-offset']);
      expect(ring['outline-style'] === 'solid' && ring['outline-width'] === '2px', `${r.where}: tab focus ring is ${ring['outline-style']} ${ring['outline-width']}`);
      if (!r.forced) expect(ring['outline-color'] === r.tasks.ringColor, `${r.where}: tab ring colour ${ring['outline-color']} is not ${r.tasks.ringColor}`);
      expect(parseFloat(ring['outline-offset']) === want, `${r.where}: tab ring offset ${ring['outline-offset']} is not the shared ${want}px`);
    }
  }
  const narrow = results.filter((r) => !r.classroom && r.where.includes('/320'));
  expect(narrow.length > 0 && narrow.every((r) => r.tasks.title?.clipped && r.tasks.title?.ellipsis), 'at 320px the long activity name should ellipsize on one line');
  expect(results.length === 13, `ran ${results.length} of 13 combinations`);
  return failures;
}

const MUTANTS = {
  'a later rule shrinks the tabs and their text': '.tw-workspace .tw-home-tabs .tw-home-tab { min-height: 24px !important; height: 24px !important; font-size: 11px !important; }',
  'the chosen tab loses its weight and underline (colour only)': '.tw-workspace .tw-home-tab[aria-selected="true"] { font-weight: 400 !important; border-bottom-color: transparent !important; color: #0078d4 !important; }',
  'an @media rule hides the task list under 작업': '@media (min-width: 1px) { .tw-home-panel .tw-task-list { display: none !important; } }',
  'outline: none !important removes the ring': 'html body .tw-home-tab:focus-visible { outline: none !important; }',
  'D-002: the title wraps onto several lines': 'html body .tw-workspace .tw-activity-title { white-space: normal !important; }',
  'D-002: the title moves below the tabs': 'html body .tw-rail .tw-activity-title { order: 9 !important; }',
  'D-002: the segments shrink to their labels': '.tw-workspace .tw-home-tabs .tw-home-tab { flex: 0 0 auto !important; }',
};

const b = await launch(bin);
let failures = [];
try {
  const results = await runMatrix(b, '');
  for (const r of results) if (!r.classroom) console.log(r.where, JSON.stringify({ tabs: r.tasks.tabs.map((t) => `${t.name}${t.selected ? '*' : ''} ${Math.round(t.w)}x${Math.round(t.h)} ${t.font}px w${t.weight} ${t.ratio.toFixed(1)}:1`), list: Math.round(r.tasks.taskListHeight), ring: `${r.ring['outline-style']} ${r.ring['outline-width']} ${r.ring['outline-offset']}` }));
  failures = check(results);
  for (const [label, css] of Object.entries(MUTANTS)) {
    const caught = check(await runMatrix(b, css));
    if (caught.length === 0) failures.push(`self-test: "${label}" was not caught`);
    else console.log(`  self-test caught: ${label} (${caught.length}: ${caught[0]})`);
  }
} finally { await b.close(); server.close(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.map((f) => '  FAIL ' + f).join('\n')); console.error(`activity-home-computed: ${failures.length} failed`); process.exit(1); }
console.log('PASS activity home computed: 작업/자료 tabs are 44px, >=14px, weight + 2px underline (not colour only), 4.5:1, the shared focus ring, full-width segments under a one-line activity title; 작업 shows tasks, 자료 the list, the draft kept; dark/light x 1420/800/320 x forced colours; classroom has no tabs; seven overrides caught');
