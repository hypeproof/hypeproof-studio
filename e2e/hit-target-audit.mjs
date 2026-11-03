// CGP-DS-R-010 (REQ-CGP-DS-11, DES-06) — hit-target audit of the learner surfaces in the real webview CSS.
// The actual ChatPanel (personal: inside TaskWorkspaceFrame, as App renders it; classroom lesson) and StartPage,
// with the stylesheets in main.tsx's import order, in headless Chromium, dark and light, at
// 1420 and 800 px. Each surface is driven into the states that show the most controls: a conversation
// with a user turn and a cited answer (code block, copy, edit, quote), the composer tools menu open, a
// staged photo, a picked page element, a failed, streaming or allowance-ended turn, the sources panel and
// task rename, and on
// the start page the entry choices and the code form. Every interactive element that is shown is
// measured with getBoundingClientRect; its hit target is the element itself, or the <label> that wraps a
// native radio/checkbox. A target smaller than 44×44 fails.
// Exempt, as WCAG 2.5.8 does: a link inside a sentence of prose (its size is set by the line it sits in).
// CGP-DS-D-007 (DES-CGP-DS-11): a primary call to action (.studio-primary, .hp-cta-primary,
// .hps-trial-end-card-primary, .hps-verify-primary) must be at least 48px tall, the ladder's lg step, and each of them must
// have been measured at least once. On every page the spacing ladder is read back from the DOM (a probe's
// computed padding for each --hp-space-n) and must be 4 / 8 / 12 / 16 / 20 / 24 / 32px.
// The audit report (every measured target with its size and floor, the ladder, and the findings) is
// written as Markdown and JSON to HPS_AUDIT_REPORT (default: <tmpdir>/hps-hit-target-audit/report.md),
// also when the audit fails.
// A state that a seat or width does not have is declared, not swallowed: run(name, act, { seats, why })
// names the surfaces it applies to. On those, a failing act() throws (a finding). On the others the state
// is skipped and listed under "Skipped states" in the console and the report, with its reason.
// HPS_SHOT_DIR=<dir> also saves one screenshot per surface/state/theme/width.
// Run: node e2e/hit-target-audit.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatPanelProps } from '../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';

const MIN = 44;
const CTA = 48;
const PRIMARY = '.studio-primary, .hp-cta-primary, .hps-trial-end-card-primary, .hps-verify-primary';
const PRIMARY_LIST = PRIMARY.split(', ');
const LADDER = [[1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24], [8, 32]];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webview = path.join(root, 'extensions/hypeproof-chat/webview-ui');
const shots = process.env.HPS_SHOT_DIR;
const reportPath = process.env.HPS_AUDIT_REPORT || path.join(os.tmpdir(), 'hps-hit-target-audit', 'report.md');
if (shots) await mkdir(shots, { recursive: true });
const MESSAGES = [
  { id: 'u1', role: 'user', content: '내 소개 페이지를 만들고 싶어요', createdAt: 1 },
  { id: 'a1', role: 'assistant', content: '좋아요. 먼저 [예시 페이지](https://example.com)를 볼까요?\n\n```html\n<h1>안녕하세요</h1>\n```\n\n어떤 색을 쓰고 싶나요?', createdAt: 2, citations: [{ url: 'https://example.com/a', title: '예시 자료', domain: 'example.com', tier: 1 }] },
];
const fixtures = {};
for (const surface of ['personal', 'classroom']) {
  const f = chatPanelProps({ messages: MESSAGES }); f.config.profile.input = { image_files: true };
  if (surface === 'personal') {
    f.config.activity = { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/w', verified: true }; f.config.profile.lesson = null;
    f.config.taskWorkspace = { scope: 's', revision: 1, activeTaskId: 't1', tasks: [{ id: 't1', title: '작업', createdAt: 1, updatedAt: 1, messageCount: 2 }, { id: 't2', title: '두 번째', createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
  }
  fixtures[surface] = f;
  // The same seat with a failed turn (error banner, retry) and with a turn streaming (stop).
  fixtures[`${surface}-error`] = { ...f, error: '연결이 잠시 끊겼어요. 다시 시도해 주세요.', errorRequestId: 'req-1', canRetryLast: true };
  // The free allowance used up (the trial end card) and a picked page element waiting to be sent.
  fixtures[`${surface}-ended`] = { ...f, error: '무료 사용을 다 썼어요.', trialEndCard: { ending: 'exhausted', title: '오늘 무료 사용을 다 썼어요', facts: ['내일 다시 쓸 수 있어요'], primary: '이용권 살펴보기', escape: '나중에', text: '오늘 무료 사용을 다 썼어요' } };
  fixtures[`${surface}-element`] = { ...f, elementPreview: { ref: 'e1', tag: 'h1', text: '안녕하세요', source: 'index.html:1', sentText: '<h1>안녕하세요</h1>', imageDataUrl: null } };
  // The "test my product" panel (VerifyPanel) in the chat's panel slot, with its 테스트 시작 button.
  fixtures[`${surface}-verify`] = { ...f };
  fixtures[`${surface}-streaming`] = { ...f, messages: [...MESSAGES, { id: 'u2', role: 'user', content: '파란색이요', createdAt: 3 }, { id: 'a2', role: 'assistant', content: '파란색으로', createdAt: 4 }], streaming: true, streamingId: 'a2' };
}
const VERIFY_VIEW = { available: true, reason: null, version: 'v1', verification: { state: 'not_verified' }, report: null, held: [], run: null, proposals: [], running: false, notice: null };
const temp = await mkdtemp(path.join(os.tmpdir(), 'hps-hit-target-'));
await build({
  stdin: { contents: `import './src/tokens.css';import {StartPage} from './src/StartPage.tsx';import {TaskWorkspaceFrame} from './src/TaskWorkspace.tsx';import {ChatPanel} from './src/ChatPanel.tsx';import {VerifyPanel} from './src/VerifyPanel.tsx';import './src/styles.css';import './src/chatDetails.css';import React from 'react';import {createRoot} from 'react-dom/client';const all=${JSON.stringify(fixtures)};const s=new URLSearchParams(location.search).get('s');const props=all[s];if(props)for(const k of ['onSend','onEditResend','onRetry','onRetryLast','onDismissError','onCancel','onTrialEndCardPasses','onRemoveElement'])props[k]=()=>{};createRoot(document.getElementById('root')).render(s==='start'?<StartPage/>:<TaskWorkspaceFrame view={props.config.taskWorkspace} messages={props.messages} busy={false} error={null} onDismissError={()=>{}}><ChatPanel {...props} verifyPanel={s.endsWith('-verify')?<VerifyPanel view={${JSON.stringify(VERIFY_VIEW)}} error={null} busy={false} onStart={()=>{}} onRetest={()=>{}} onFix={()=>{}} onClose={()=>{}}/>:undefined}/></TaskWorkspaceFrame>);`, resolveDir: webview, loader: 'tsx' },
  bundle: true, loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'ui.js'), logLevel: 'error',
});
const server = createServer(async (req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/ui.js' || u === '/ui.css') { res.setHeader('content-type', u.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(await readFile(path.join(temp, u))); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const THEMES = {
  dark: '--vscode-sideBar-background:#181818;--vscode-foreground:#cccccc;--vscode-editor-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-focusBorder:#0078d4;--vscode-input-background:#313131;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;',
  light: '--vscode-sideBar-background:#f8f8f8;--vscode-foreground:#3b3b3b;--vscode-editor-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-focusBorder:#005fb8;--vscode-input-background:#ffffff;--vscode-button-background:#005fb8;--vscode-button-foreground:#fff;',
};
/** Every shown interactive element below `scope` whose hit target is under MIN in either dimension. */
function measure({ MIN, CTA, PRIMARY, label, composerForwards }) {
  const SEL = 'button, a[href], input:not([type=hidden]), textarea, select, summary, [role=button], [role=menuitem], [role=menuitemradio], [role=tab], [role=option], [tabindex]:not([tabindex="-1"])';
  const out = []; const names = []; const targets = []; let count = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || el.closest('[hidden], [aria-hidden=true], details:not([open]) > :not(summary)')) continue;
    // A natively styled radio/checkbox is hit through the label that wraps it.
    // The composer's textarea is hit through its card when a press on the card focuses it (checked
    // by a real click before measuring, composerForwards).
    const target = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') ?? el)
      : composerForwards && el.matches('.hps-input > textarea') ? el.parentElement : el;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // WCAG 2.5.8 inline exception: a link that is part of a sentence of prose.
    if (el.matches('a[href]') && el.closest('p, li') && el.closest('.hps-msg-body')) continue;
    count++; names.push(`${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    // The primary call to action takes the ladder's 48px step in height; its width keeps the 44px floor.
    const primary = el.matches(PRIMARY);
    const t = { where: label, el: `${el.parentElement?.className ? "." + String(el.parentElement.className).trim().split(/\s+/).join(".") + " > " : ""}${el.tagName.toLowerCase()}${[...el.classList].map(c => "." + c).join("")}`, name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), primary, floor: primary ? `${MIN}×${CTA}` : `${MIN}×${MIN}` };
    targets.push(t);
    if (r.width + 0.5 < MIN || r.height + 0.5 < (primary ? CTA : MIN)) out.push(t);
  }
  return { count, out, names, targets };
}
/** The spacing ladder as the page computes it: a probe's padding-top for each --hp-space-n. */
function ladder(LADDER) {
  const probe = document.createElement('div'); document.body.append(probe);
  const got = LADDER.map(([n]) => { probe.style.paddingTop = `var(--hp-space-${n})`; return parseFloat(getComputedStyle(probe).paddingTop); });
  probe.style.minHeight = 'var(--hp-control-cta)'; const cta = parseFloat(getComputedStyle(probe).minHeight);
  probe.remove();
  return { got, cta };
}
/** A real press on the composer card's own surface (its top padding, above the textarea) focuses the textarea. */
async function composerCardFocuses(page) {
  const at = await page.evaluate(() => {
    const ta = document.querySelector('.hps-input > textarea'); const card = ta?.parentElement;
    if (!ta || !card) return null;
    ta.blur(); const c = card.getBoundingClientRect(), t = ta.getBoundingClientRect();
    if (t.top - c.top < 2) return null; // no card surface above the textarea: it is measured itself
    return { x: t.left + t.width / 2, y: c.top + (t.top - c.top) / 2 };
  });
  if (!at) return false;
  const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return !!e && !e.matches('textarea') && !!e.closest('.hps-input'); }, at);
  if (!hit) return false;
  await page.mouse.click(at.x, at.y);
  const focused = await page.evaluate(() => document.activeElement?.matches('.hps-input > textarea') ?? false);
  await page.evaluate(() => document.activeElement?.blur());
  return focused;
}
const browser = await chromium.launch({ headless: true });
const findings = []; const targets = []; const ladderReads = []; const skipped = []; let measured = 0;
try {
  for (const surface of ['personal', 'classroom', 'personal-error', 'classroom-error', 'personal-streaming', 'classroom-streaming', 'personal-ended', 'personal-element', 'classroom-element', 'personal-verify', 'classroom-verify', 'start']) for (const theme of Object.keys(THEMES)) for (const width of [1420, 800]) {
    const vars = THEMES[theme];
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await ctx.newPage();
    await page.addInitScript(({ vars, theme }) => {
      window.acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.setAttribute('style', vars); document.body.setAttribute('style', vars + 'margin:0;background:var(--vscode-sideBar-background);color:var(--vscode-foreground)'); document.body.classList.add('vscode-' + theme); });
    }, { vars, theme });
    await page.goto(base + '?s=' + surface);
    const post = d => page.evaluate(d => window.dispatchEvent(new MessageEvent('message', { data: d })), d);
    const states = []; let composerForwards;
    // `seats`: the surfaces whose state this is (matched on the surface's first word and the full name); `why`
    // says why the other seats do not have it. Applicable states are never skipped: a failing act() throws.
    const run = async (name, act, { seats, why } = {}) => {
      if (seats && !seats.includes(surface)) {
        assert.ok(why, `${name}: a state limited to ${seats.join(', ')} must say why the other seats do not have it`);
        skipped.push({ where: `${surface}/${theme}/${width}`, state: name, why });
        return;
      }
      if (act) { await act(); await page.waitForTimeout(150); }
      states.push(name);
      if (shots) await page.screenshot({ path: path.join(shots, `hit-target-${surface}-${name.replace(/\W+/g, '-')}-${theme}-${width}.png`) });
      // Checked once, before any menu opens: the press itself would close an open menu.
      if (composerForwards === undefined) composerForwards = surface === 'start' ? false : await composerCardFocuses(page);
      const m = await page.evaluate(measure, { MIN, CTA, PRIMARY, label: `${surface}/${theme}/${width} [${name}]`, composerForwards });
      measured += m.count; findings.push(...m.out); targets.push(...m.targets);
      if (process.env.HPS_AUDIT_VERBOSE) console.log(`${surface}/${theme}/${width} [${name}]`, m.count, JSON.stringify(m.names));
    };
    const click = sel => async () => { const l = page.locator(sel).first(); if (!(await l.count())) throw new Error('absent'); await l.click(); };
    if (surface === 'start') {
      await page.waitForSelector('#root *');
      await post({ type: 'startState', state: { checking: false, version: '1.0.0' } });
      await page.waitForTimeout(150);
      await run('entry');
      await post({ type: 'startState', state: { checking: false, version: '1.0.0', account: { status: 'signedOut', busy: false } } });
      await page.locator('.studio-google').waitFor();
      await run('account entry');
      await run('code form', async () => { await page.getByRole('button', { name: /코드|수업/ }).first().click(); });
      await post({ type: 'startState', state: { checking: false, version: '1.0.0', coachName: '코치', profile: { kind: 'personal', id: 'p1', name: '내 작업', coach: '코치', series: '', workspace: '/w', free: true } } });
      await page.waitForTimeout(150);
      await run('connected');
    } else {
      await page.locator('.hps-input textarea').waitFor();
      assert.equal(await page.locator('.hps-shell').getAttribute('data-chat-detail') === 'personal', surface.startsWith('personal'), `${surface}: fixture reached the intended seat`);
      await run('conversation');
      if (surface.includes('-')) { /* the variant's own controls, in its first state */ }
      else {
      await run('edit', click('.hps-edit-prompt'));
      await run('edit closed', async () => { await page.keyboard.press('Escape'); });
      await run('code open', click('.hps-codepill-toggle'));
      // The classroom composer shows the tools menu only when file attach is on (ChatPanel: !personalWorkspace && fileAttachShown); this fixture has it off.
      await run('tools menu', click('.hps-tool-trigger'), { seats: ['personal'], why: 'classroom composer has no tools menu unless file attach is on' });
      await page.keyboard.press('Escape');
      await run('chat menu', click('.tw-chat-menu-toggle'), { seats: ['personal'], why: 'the chat menu is part of the personal task workspace frame' });
      await page.keyboard.press('Escape');
      await run('photo staged', async () => { await post({ type: 'imageStagedByHost', stageId: 'ph', name: '사진.png' }); await page.locator('.hps-attachment').first().waitFor(); });
      await run('sources open', click('.tw-sources-toggle'), { seats: ['personal'], why: 'the sources panel is part of the personal task workspace frame' });
      // At <=1050px the open sources panel is a modal dialog with a backdrop over the heading, so the title cannot be pressed until it is closed (the real flow).
      await run('sources closed', click('.tw-source-close'), { seats: ['personal'], why: 'the sources panel is part of the personal task workspace frame' });
      await run('rename', click('.tw-title-button'), { seats: ['personal'], why: 'rename is part of the personal task workspace frame' });
      }
    }
    ladderReads.push({ where: `${surface}/${theme}/${width}`, ...(await page.evaluate(ladder, LADDER)) });
    const where = `${surface}/${theme}/${width} [${states.join(' + ')}]`;
    await ctx.close();
    console.log(where);
  }
} finally { await browser.close(); server.close(); await rm(temp, { recursive: true, force: true }); }

const seen = new Set();
for (const f of findings) { const k = `${f.where.split('/')[0]} ${f.el} ${f.name}`; if (seen.has(k)) continue; seen.add(k); console.log(`  under ${f.floor}: ${f.where} ${f.el} "${f.name}" ${f.w}×${f.h}`); }
const skipCount = new Map(); for (const k of skipped) { const key = `${k.where.split('/')[0]}\t${k.state}\t${k.why}`; skipCount.set(key, (skipCount.get(key) ?? 0) + 1); }
for (const [key, n] of skipCount) { const [surface, state, why] = key.split('\t'); console.log(`  skipped: ${surface} [${state}] x${n} (${why})`); }
const ladderBad = ladderReads.filter(l => l.cta !== CTA || l.got.some((v, i) => v !== LADDER[i][1]));
const primarySeen = PRIMARY_LIST.map(c => [c, targets.filter(t => t.el.split(' > ').pop().includes(c)).length]);
// The report: one row per distinct control (surface, element, name), with its smallest-area measured sample.
const byControl = new Map();
for (const t of targets) {
  const k = `${t.where.split('/')[0]}\t${t.el}\t${t.name}`;
  const prev = byControl.get(k);
  if (!prev || t.w * t.h < prev.w * prev.h) byControl.set(k, { ...t, seen: (prev?.seen ?? 0) + 1 }); else prev.seen++;
}
const cell = s => String(s).replace(/[|\\]/g, ' ').replace(/[\u0000-\u001f\u2028\u2029]/g, ' ');
const rows = [...byControl.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.h - b.h || a.w - b.w);
const md = [
  '# Hit-target audit (CGP-DS-R-010, CGP-DS-D-007)', '',
  `Generated ${new Date().toISOString()} by e2e/hit-target-audit.mjs. Learner floor ${MIN}×${MIN}px; primary call to action ${CTA}px tall.`, '',
  `- Targets measured: ${measured} (${byControl.size} distinct controls across surfaces, states, themes and widths)`,
  `- Findings under the floor: ${findings.length}`,
  `- Primary CTAs measured: ${primarySeen.map(([c, n]) => `${c} ${n}`).join(', ')}`,
  `- Spacing ladder read from the DOM on ${ladderReads.length} pages: ${ladderBad.length ? `${ladderBad.length} page(s) off` : `${LADDER.map(([, v]) => v).join(' / ')}px everywhere, --hp-control-cta ${CTA}px`}`, '',
  `- Skipped states: ${skipCount.size ? skipCount.size + ' (listed below)' : 'none'}`, '',
  '## Skipped states (declared per seat; a state that applies to its seat and fails is a finding)', '', skipCount.size ? '| surface | state | skipped runs | why |\n|---|---|---|---|\n' + [...skipCount].map(([key, n]) => { const [s, st, w] = key.split('\t'); return `| ${cell(s)} | ${cell(st)} | ${n} | ${cell(w)} |`; }).join('\n') : 'None.', '',
  '## Findings', '', findings.length ? '| where | element | name | size | floor |\n|---|---|---|---|---|\n' + findings.map(f => `| ${cell(f.where)} | ${cell(f.el)} | ${cell(f.name)} | ${f.w}×${f.h} | ${f.floor} |`).join('\n') : 'None.', '',
  '## Every control (smallest-area measured sample)', '', '| surface | element | name | smallest | floor | measured |', '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${cell(r.where.split('/')[0])} | ${cell(r.el)} | ${cell(r.name)} | ${r.w}×${r.h} | ${r.floor} | ${r.seen} |`), '',
];
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, md.join('\n'));
await writeFile(reportPath.replace(/\.md$/, '') + '.json', JSON.stringify({ min: MIN, cta: CTA, ladder: LADDER.map(([n, v]) => ({ token: `--hp-space-${n}`, px: v })), measured, ladderReads, skipped, primarySeen: Object.fromEntries(primarySeen), findings, controls: rows }, null, 2));
console.log(`report: ${reportPath}`);
assert.ok(measured > 0, 'the audit measured at least one target');
assert.deepEqual(ladderBad, [], 'the spacing ladder computed on the page is 4 / 8 / 12 / 16 / 20 / 24 / 32px and the CTA step is 48px');
for (const [c, n] of primarySeen) assert.ok(n > 0, `the audit never measured a primary CTA ${c}`);
assert.deepEqual(findings, [], `${findings.length} hit target(s) under their floor (${MIN}×${MIN}, primary CTA ${CTA}px tall) on learner surfaces`);
console.log(`PASS hit-target audit: ${measured} targets, all ≥ ${MIN}×${MIN}, primary CTAs ≥ ${CTA}px tall (personal and classroom chat at rest, editing, with a failed, a streaming and an ended turn, a picked element, a staged photo, citations, sources and rename, menus open; start page entry, code form and connected × dark, light × 1420, 800)`);
