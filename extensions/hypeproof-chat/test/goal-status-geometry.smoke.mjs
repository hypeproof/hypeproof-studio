// CGP-AGENT-R-010: the learner goal-status strip, measured on the CASCADE in headless Chromium.
//   node --experimental-strip-types test/goal-status-geometry.smoke.mjs
//
// The real ChatPanel markup (lesson seat) is rendered into the shipped stylesheet order, in dark and light, at
// 1420/800/320, and in forced colours. Computed styles and layout rects are read, never rule text, so a later or
// higher-specificity override and an @media override both fail. Checked on the real strip: every status button is
// at least 44x44, every text element is at least 14px, the strip sits above the composer inside the footer, it is
// visible (not display:none, not clipped, hit-testable, inside clientWidth), the four status buttons carry
// aria-pressed (exactly one true), the status line is a live status region, the budget line shows its time and the
// disclaimer is present, and the chosen status is drawn by more than colour.
// Seats: lesson (classroom) with budget; trial and free activity show no budget line; personal without a lesson
// draws no strip.
// Self-test: the matrix is run again with injected CSS overrides and with source mutants of GoalStatusBar.tsx
// and ChatPanel's DOM order; each must be caught.
// Without a headless Chromium this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (set by CI) makes that a failure.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChromium, launch } from './lib/headless-chromium.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = resolve(root, 'webview-ui/src');

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('goal-status-geometry: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('goal-status-geometry NOT RUN: no headless Chromium (set HEADLESS_CHROMIUM, or FOCUS_REQUIRE_BROWSER=1 to fail)');
  process.exit(0);
}

// ---------- the stylesheets as shipped (tokens, component css, styles, chatDetails) ----------
const others = readdirSync(SRC).filter((f) => f.endsWith('.css') && !['tokens.css', 'designTokens.css', 'styles.css', 'chatDetails.css'].includes(f)).sort();
const bundled = await build({
  stdin: { contents: ['tokens.css', ...others, 'styles.css', 'chatDetails.css'].map((f) => `@import "./${f}";`).join('\n'), resolveDir: SRC, loader: 'css' },
  bundle: true, write: false, outdir: 'out', logLevel: 'silent',
  plugins: [{ name: 'external', setup(b) { b.onResolve({ filter: /\.(svg|png|jpe?g|gif|webp|woff2?)$/ }, (a) => ({ path: a.path, external: true })); } }],
});
const css = bundled.outputFiles.find((o) => o.path.endsWith('.css')).text;

// Real React ChatPanel: mount closed, then exercise its disclosure in Chromium.
const lessonContent = JSON.parse(readFileSync(join(root, 'test/fixtures/session-design/week-3.json'), 'utf8'));
const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' }, suggestions: { initial: [], follow_up: [] }, hints: { short_input: { enabled: false }, roll_input_button: { enabled: false } }, retry_button: { enabled: false } };
const lesson = { course_id: 'globalbuddy', version: 'm1', sha256: 'f'.repeat(64), content: lessonContent };
const goal = (status, text = '예약 버튼을 만들고 직접 눌러 확인하기') => ({ lesson: { course_id: 'globalbuddy', version: 'm1', sha256: 'f'.repeat(64) }, activity: 'a1', ...(status ? { status } : {}), goal: text, criteria: ['직접 확인'], revision: 2, updated: 1 });
const access = (remaining) => ({ status: 'ready', selected: 'class', view: { configured: true, as_of: '2026-10-22T00:00:00Z', schema: 'hps-access-view/1', choices: [{ id: 'class', label: '수업 지원', mode: 'included', ends_at: 0, can_request: false, allowed: { models: [], efforts: [], features: [], runtimes: [] }, active: true, available: true, source_kind: 'cohort', state: 'ready', resources: [{ meter: 'requests:count', limit: 50, remaining, spent: 50 - remaining, held: 0, overrun: 0, unresolved: 0, shared: true }] }] } });
const mk = (over = {}, profOver = {}, sg = goal('active')) => ({ hasToken: true, activity: { id: 'a1', name: 'G', kind: 'classroom', verified: true, workspace: '/tmp/s' }, coach: { name: '코치', configured: true }, profile: { ux, welcome: { greeting_md: '' }, profile_id: 'sx', lesson, ...profOver }, studentGoal: sg, access: access(12), ...over });
// kind: budget = lesson seat with a confirmed budget line; nobudget = strip without a budget line; none = no strip.
const CASES = {
  'lesson-active': { kind: 'budget', pressed: '진행 중', config: mk() },
  'lesson-complete-zero': { kind: 'budget', pressed: '이룸', config: mk({ access: access(0) }, {}, goal('complete')) },
  'lesson-paused-unknown': { kind: 'budget', pressed: '멈춤', unknownBudget: true, config: mk({ access: undefined }, {}, goal('paused')) },
  'lesson-budget-limit-long-goal': { kind: 'budget', pressed: '예산 한도', config: mk({}, {}, goal('budget_limit', '매우 긴 목표 '.repeat(25))) },
  'lesson-legacy-no-status': { kind: 'budget', pressed: '진행 중', config: mk({}, {}, goal(undefined)) },
  'trial-lesson': { kind: 'nobudget', pressed: '진행 중', config: mk({}, { profile_id: 'studio-open-trial' }) },
  'free-activity-lesson': { kind: 'nobudget', pressed: '진행 중', config: mk({ activity: { id: 'a1', free: true, verified: true, workspace: '/tmp/s' } }) },
  'personal-no-lesson': { kind: 'none', config: mk({ taskWorkspace: { tasks: [], sources: [] } }, { lesson: null }, null) },
};

async function render(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'goal-status-geometry-'));
  try {
    const mutantPlugin = {
      name: 'goal-status-mutant',
      setup(b) {
        if (!mutate) return;
        b.onLoad({ filter: /webview-ui\/src\/GoalStatusBar\.tsx$/ }, (args) => {
          const src = readFileSync(args.path, 'utf8');
          const next = src.replace(mutate[0], mutate[1]);
          assert.notEqual(next, src, `mutant did not apply: ${String(mutate[0])}`);
          return { contents: next, loader: 'tsx' };
        });
      },
    };
    const result = await build({ stdin: { contents: `import {ChatPanel} from './ChatPanel'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import React from 'react'; window.mountGoal=(config)=>{const noop=()=>{};flushSync(()=>createRoot(document.getElementById('root')).render(<ChatPanel messages={[]} streaming={false} config={config} onSend={noop} onCancel={noop} onSettings={noop} onSetToken={noop}/>));}; window.openGoal=()=>flushSync(()=>document.querySelector('.hps-goal-strip')?.click());`, resolveDir: SRC, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', write:false, jsx: 'automatic', loader: { '.css': 'empty', '.svg': 'empty' }, plugins: [mutantPlugin], logLevel: 'error' });
    return Object.fromEntries(Object.entries(CASES).map(([key,c])=>[key,`<div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}<\/script><script>window.mountGoal(${JSON.stringify(c.config)})<\/script>`]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- measurement ----------
const THEMES = {
  dark: { cls: 'vscode-dark', dark: true, v: { 'editor-background': '#1f1f1f', 'input-background': '#313131', foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'input-foreground': '#cccccc' } },
  light: { cls: 'vscode-light', dark: false, v: { 'editor-background': '#ffffff', 'input-background': '#ffffff', foreground: '#3b3b3b', descriptionForeground: '#717171', 'input-foreground': '#3b3b3b' } },
};
const WIDTHS = [1420, 800, 320];
const probe = (moveBelow) => {
  const bar = document.querySelector('.hps-goal-status');
  const comp = document.querySelector('.hps-input');
  if (moveBelow && bar && comp) comp.parentElement.insertBefore(bar, comp.nextSibling);
  const doc = document.documentElement;
  const out = { present: !!bar, clientWidth: doc.clientWidth, overflowX: doc.scrollWidth - doc.clientWidth, innerHeight };
  if (!bar) return out;
  const rect = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const cs = getComputedStyle(bar);
  const br = rect(bar);
  const foot = document.querySelector('footer.hps-input-area');
  out.inFooter = !!foot && foot.contains(bar);
  out.display = cs.display; out.visibility = cs.visibility; out.opacity = cs.opacity;
  out.bar = br;
  out.compTop = comp ? comp.getBoundingClientRect().top : null;
  out.aboveComposer = !!comp && br.b <= comp.getBoundingClientRect().top + 0.5;
  out.precedes = !!comp && !!(bar.compareDocumentPosition(comp) & Node.DOCUMENT_POSITION_FOLLOWING);
  out.text = bar.textContent;
  out.status = bar.querySelector('[role="status"]')?.textContent ?? null;
  out.fonts = [bar, ...bar.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => ({ tag: e.tagName, fs: parseFloat(getComputedStyle(e).fontSize) }));
  out.buttons = [...bar.querySelectorAll('button[aria-pressed]')].map((b) => {
    const r = rect(b); const s = getComputedStyle(b);
    const hit = document.elementFromPoint(Math.min(Math.max(r.l + r.w / 2, 0), doc.clientWidth - 1), Math.min(Math.max(r.t + r.h / 2, 0), innerHeight - 1));
    const before = getComputedStyle(b, '::before');
    return { label: b.textContent, pressed: b.getAttribute('aria-pressed'), w: r.w, h: r.h, l: r.l, r: r.r, fw: s.fontWeight, boxShadow: s.boxShadow, before: before.content, beforeDisplay: before.display, beforeW: parseFloat(before.width), display: s.display, hit: hit === b || b.contains(hit),
      borderW: s.borderTopWidth, borderStyle: s.borderTopStyle, borderColor: s.borderTopColor, outlineW: null };
  });
  const ref = document.createElement('span'); ref.style.color = 'ButtonText'; bar.appendChild(ref);
  out.buttonTextRef = getComputedStyle(ref).color; ref.remove();
  return out;
};

const hasText = (m, t) => typeof m.text === 'string' && m.text.includes(t);
function check(at, c, m, bad, forced) {
  if (c.kind === 'none') { if (m.present) bad.push(`${at}: strip drawn without a lesson`); return; }
  if (!m.present) { bad.push(`${at}: strip missing`); return; }
  if (m.display === 'none' || m.visibility !== 'visible' || Number(m.opacity) === 0 || m.bar.w <= 0 || m.bar.h <= 0) bad.push(`${at}: strip not visible (display ${m.display}, visibility ${m.visibility}, opacity ${m.opacity}, ${m.bar.w}x${m.bar.h})`);
  if (!m.inFooter) bad.push(`${at}: strip is not inside the composer footer`);
  if (!m.precedes) bad.push(`${at}: strip does not precede the composer in document order`);
  if (!m.aboveComposer) bad.push(`${at}: strip bottom ${m.bar.b} is below the composer top ${m.compTop}`);
  if (m.bar.b > m.innerHeight + 0.5 || m.bar.t < -0.5) bad.push(`${at}: strip outside the viewport (${m.bar.t}..${m.bar.b} of ${m.innerHeight})`);
  if (m.bar.r > m.clientWidth + 0.5 || m.bar.l < -0.5) bad.push(`${at}: strip wider than clientWidth ${m.clientWidth} (${m.bar.l}..${m.bar.r})`);
  if (m.overflowX > 0) bad.push(`${at}: horizontal overflow ${m.overflowX}px`);
  for (const f of m.fonts) if (!(f.fs >= 14)) bad.push(`${at}: ${f.tag} text ${f.fs}px under 14px`);
  if (m.fonts.length < 4) bad.push(`${at}: only ${m.fonts.length} text elements found`);
  if (m.buttons.length !== 4) bad.push(`${at}: ${m.buttons.length} status buttons, expected 4`);
  for (const b of m.buttons) {
    if (!(b.w >= 44 && b.h >= 44)) bad.push(`${at}: button "${b.label}" ${b.w}x${b.h} under 44x44`);
    if (b.display === 'none' || !b.hit) bad.push(`${at}: button "${b.label}" hidden or clipped (hit-test)`);
    if (b.r > m.clientWidth + 0.5 || b.l < -0.5) bad.push(`${at}: button "${b.label}" outside clientWidth (${b.l}..${b.r} of ${m.clientWidth})`);
    if (b.pressed !== 'true' && b.pressed !== 'false') bad.push(`${at}: button "${b.label}" has no aria-pressed`);
  }
  const pressed = m.buttons.filter((b) => b.pressed === 'true');
  if (pressed.length !== 1) bad.push(`${at}: ${pressed.length} buttons pressed, expected exactly one`);
  else {
    if (c.pressed && !pressed[0].label.includes(c.pressed)) bad.push(`${at}: pressed button is "${pressed[0].label}", expected ${c.pressed}`);
    const idle = m.buttons.find((b) => b.pressed === 'false');
    if (pressed[0].before === 'none' || pressed[0].beforeDisplay !== 'inline-block' || !(pressed[0].beforeW > 0)) bad.push(`${at}: the chosen status has no filled marker (content ${pressed[0].before}, ${pressed[0].beforeDisplay}, ${pressed[0].beforeW}px)`);
    if (!(Number(pressed[0].fw) > Number(idle?.fw ?? 0))) bad.push(`${at}: the chosen status is not heavier than the others (${pressed[0].fw} vs ${idle?.fw})`);
    if (!forced && (pressed[0].boxShadow === 'none')) bad.push(`${at}: the chosen status has no ring`);
  }
  if (m.status === null || !m.status.includes('내가 표시한 상태') && !m.status.includes('직접 표시')) bad.push(`${at}: no role="status" line with the self-report label (${m.status})`);
  if (!hasText(m, '내 목표')) bad.push(`${at}: goal line missing`);
  if (!hasText(m, 'AI를 시작하거나 멈추지 않아요')) bad.push(`${at}: the "does not start or stop the AI" disclaimer is missing`);
  if (c.kind === 'budget') {
    if (!hasText(m, '남은 수업 예산')) bad.push(`${at}: budget line missing`);
    if (c.unknownBudget ? !hasText(m, '확인 안 됨') : !/회 · .+ 확인/.test(m.text)) bad.push(`${at}: budget ${c.unknownBudget ? 'should read 확인 안 됨' : 'lost its count or its time'}`);
  } else if (hasText(m, '남은 수업 예산')) bad.push(`${at}: budget line shown on a seat that has no class budget`);
  if (forced) {
    for (const b of m.buttons) {
      if (b.borderStyle === 'none' || parseFloat(b.borderW) === 0) bad.push(`${at}: forced colours: button "${b.label}" lost its border`);
    }
  }
}

const measure = async ({ extraCss = '', markup, cases = Object.keys(CASES), widths = WIDTHS, themes = Object.keys(THEMES), forced = true, moveBelow = false }) => {
  const bad = [];
  const b = await launch(bin);
  try {
    for (const tname of themes) for (const width of widths) for (const key of cases) {
      const t = THEMES[tname];
      const vars = Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';');
      await b.load(`<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars}}${css}${extraCss}</style></head><body class="${t.cls}" style="margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground)">${markup[key]}</body></html>`, { width, height: 800, dark: t.dark });
      if (!extraCss && !moveBelow && cases.length===Object.keys(CASES).length) {
        const compact=await b.evaluate(`(()=>{const e=document.querySelector('.hps-goal-strip');if(!e)return null;const t=e.querySelector('.hps-goal-strip-text'),r=e.getBoundingClientRect();return {expanded:e.getAttribute('aria-expanded'),h:r.height,w:r.width,nowrap:getComputedStyle(t).whiteSpace,meter:e.querySelector('meter')?.value,text:e.textContent,editor:!!document.querySelector('.hps-goal-expanded')};})()`);
        if (CASES[key].kind!=='none') {
          assert.equal(compact?.expanded,'false');assert.equal(compact.editor,false);assert.equal(compact.nowrap,'nowrap');
          assert.ok(compact.h>=44, 'interactive summary target');
          if(CASES[key].kind==='budget'&&!CASES[key].unknownBudget)assert.ok(compact.text.includes('남은 사용량')&&Number.isFinite(compact.meter));
        }
      }
      await b.evaluate('window.openGoal()');
      const m = await b.evaluate(`(${probe})(${moveBelow})`);
      check(`${key} ${tname} ${width}px`, CASES[key], m, bad, false);
    }
    if (forced) for (const width of WIDTHS) for (const key of ['lesson-active', 'lesson-budget-limit-long-goal', 'trial-lesson']) {
      await b.load(`<!doctype html><html><head><meta charset="utf-8"><style>${css}${extraCss}</style></head><body style="margin:0">${markup[key]}</body></html>`, { width, height: 800, dark: true, forcedColors: true });
      if (!extraCss && !moveBelow && cases.length===Object.keys(CASES).length) {
        const compact=await b.evaluate(`(()=>{const e=document.querySelector('.hps-goal-strip');if(!e)return null;const t=e.querySelector('.hps-goal-strip-text'),r=e.getBoundingClientRect();return {expanded:e.getAttribute('aria-expanded'),h:r.height,w:r.width,nowrap:getComputedStyle(t).whiteSpace,meter:e.querySelector('meter')?.value,text:e.textContent,editor:!!document.querySelector('.hps-goal-expanded')};})()`);
        if (CASES[key].kind!=='none') {
          assert.equal(compact?.expanded,'false');assert.equal(compact.editor,false);assert.equal(compact.nowrap,'nowrap');
          assert.ok(compact.h>=44, 'interactive summary target');
          if(CASES[key].kind==='budget'&&!CASES[key].unknownBudget)assert.ok(compact.text.includes('남은 사용량')&&Number.isFinite(compact.meter));
        }
      }
      await b.evaluate('window.openGoal()');
      const m = await b.evaluate(`(${probe})(${moveBelow})`);
      check(`${key} forced-colors ${width}px`, CASES[key], m, bad, true);
    }
    // The focus ring hugs the button: 2px solid, 2px offset, read through a forced :focus-visible.
    if (cases.includes('lesson-active')) {
      const t = THEMES.dark;
      await b.load(`<!doctype html><html><head><meta charset="utf-8"><style>:root{${Object.entries(t.v).map(([k, v]) => `--vscode-${k}:${v}`).join(';')}}${css}${extraCss}</style></head><body class="${t.cls}" style="margin:0">${markup['lesson-active']}</body></html>`, { width: 800, height: 800, dark: true });
      const f = await b.focusVisibleStyle('.hps-goal-status button', ['outline-width', 'outline-style', 'outline-offset']);
      if (f['outline-width'] !== '2px' || f['outline-style'] !== 'solid' || !['2px', '-2px'].includes(f['outline-offset'])) bad.push(`focus ring on a status button is ${f['outline-width']} ${f['outline-style']} offset ${f['outline-offset']}, expected the shared 2px solid ring at +/-2px`);
    }
  } finally { await b.close(); }
  return bad;
};

const baseMarkup = await render(null);
const baseline = await measure({ markup: baseMarkup });
assert.deepEqual(baseline, [], `goal status geometry:\n${baseline.slice(0, 15).join('\n')}`);
console.log(`  ok   ${Object.keys(CASES).length} seats x ${Object.keys(THEMES).length} themes x ${WIDTHS.length} widths + forced colours: targets >= 44, text >= 14, above the composer, visible, aria-pressed, status, budget, disclaimer, chosen-status style`);

// ---------- the guard must fail on the mutants declaration-only checks missed ----------
const QUICK = { cases: ['lesson-active', 'trial-lesson', 'personal-no-lesson'], widths: [1420, 320], themes: ['dark'], forced: false };
const CSS_MUTANTS = [
  ['M1 later higher-specificity override in styles.css', '.hps-input-area .hps-goal-status button{min-height:24px;min-width:24px}'],
  ['M2 @media (max-width) smaller targets', '@media (max-width:400px){.hps-goal-status button{min-height:20px}}'],
  ['M3 smaller font on a paragraph', '.hps-goal-status p{font-size:11px}'],
  ['M10 display:none from a later rule', '.hps-goal-status{display:none}'],
  ['M11 visibility hidden', '.hps-input-area .hps-goal-status{visibility:hidden}'],
  ['M12 clipped to zero height', '.hps-input-area .hps-goal-status{height:0;overflow:hidden}'],
  ['M13 chosen-status style removed', '.hps-goal-status button[aria-pressed="true"]{font-weight:400;box-shadow:none}.hps-goal-status button[aria-pressed="true"]::before{content:none}'],
  ['M14 wider than the column', '.hps-input-area .hps-goal-status{width:900px;max-width:none}'],
];
for (const [name, extraCss] of CSS_MUTANTS) {
  const caught = await measure({ ...QUICK, markup: baseMarkup, extraCss });
  assert.ok(caught.length > 0, `mutant not caught: ${name}`);
  console.log(`  ok   caught: ${name} (${caught.length} findings, e.g. ${caught[0]})`);
}
const strip = async (name, mutate) => {
  const caught = await measure({ ...QUICK, markup: await render(mutate) });
  assert.ok(caught.length > 0, `mutant not caught: ${name}`);
  console.log(`  ok   caught: ${name} (${caught.length} findings, e.g. ${caught[0]})`);
};
await strip('M5 aria-pressed removed', ["aria-pressed={(view.status??'active')===status} ", '']);
await strip('M8 role="status" removed', [' role="status"', '']);
await strip('M6 budget timestamp dropped', [/ · \$\{new Date\(view\.as_of\)\.toLocaleString\('ko-KR'\)\} 확인/, '']);
await strip('M7 disclaimer deleted', [/\n   <p>상태 표시는 AI를 시작하거나 멈추지 않아요\. AI에게 부탁하려면 메시지를 보내 주세요\.<\/p>/, '']);
await strip('M15 budget shown on the trial seat', ["&&config.profile?.profile_id!=='studio-open-trial'", '']);
{
  const caught = await measure({ ...QUICK, markup: baseMarkup, moveBelow: true });
  assert.ok(caught.length > 0, 'mutant not caught: M4 strip moved below the composer');
  console.log(`  ok   caught: M4 strip moved below the composer (${caught.length} findings, e.g. ${caught[0]})`);
}
console.log('goal-status-geometry PASS');
