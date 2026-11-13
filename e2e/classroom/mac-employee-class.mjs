import '@hypeproof/service-testkit/test/harness/loader.mjs';
// E5 (#3779) — the employee-class flow end to end on this Mac: the REAL Chalk page (visible Chromium) and a REAL Studio window.
//
//   HPS_DEVHOST_SOURCE="<official shell>.app" HPS_DEVHOST_DIR=e2e/test-results/classroom-devhost-e5 node e2e/classroom/mac-devhost.mjs prepare
//   HPS_DEVHOST_DIR=e2e/test-results/classroom-devhost-e5 node --experimental-strip-types --experimental-sqlite --no-warnings e2e/classroom/mac-employee-class.mjs
//
// Six rows, each with expected/observed in $HPS_DEVHOST_DIR/employee-class/result.json:
//  1. the assigned instructor opens the run in Chalk /manage (roster, lesson, 관측 · 학생에게 보내기 · 질문 카드 clicked on the page) and
//     imports handle,name CSV → names next to handles; every request the page, the Chalk worker and the app made is captured and
//     none carries a name;
//  2. "who is connected now": the real window's seat connected, the others not;
//  3. the instructor makes the class code in Chalk; the real window runs 수업 연결 with that 8-character code, reads the class
//     data notice modal, accepts → the board shows 동의함;
//  4. a question card to ALL seats from Chalk; the real window shows it in its inbox; a late joiner (synthetic, connects after the
//     send) receives it; the real learner answers in the inbox (choice), one synthetic seat skips; Chalk shows 전달 전/전달됨/답함
//     and the answers view with names; nothing says opened/read;
//  5. withdrawal from Chalk: the card leaves the real window's inbox; a new answer is refused;
//  6. a second instructor, not assigned to the run, gets not_run_instructor (403) in /manage and cannot operate.
// Real: shell copy + current extension build, the ops sync loop and inbox on disk, VS Code's own modal and input box, Chalk /manage
// and its worker, the Service router + SQLite from the testkit (strict run ownership). Synthetic: accounts, lesson, seats A2/A3
// (the real device client and InboxSession in this process; their consent and answers go through the same Service routes the app
// uses, with their own seat credentials). No step is done for the real window by an API call: a step the window cannot do is BLOCKED.
// Own ports, own user-data dir, own HOME. Says nothing about Windows, several PCs, staging or production.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { localOps, OPS_ALL } from './service-fixture.mjs';
import * as ops from '../../extensions/hypeproof-chat/src/classroomOps.ts';
import { InboxSession, InboxStore, inboxDir } from '../../extensions/hypeproof-chat/src/classroomInboxStore.ts';
import { signInChalk, withHeaderConnection } from '../../chalk/test/harness/connect.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), home = path.resolve(process.env.HPS_DEVHOST_DIR || path.join(repo, 'e2e/test-results/classroom-devhost-e5'));
const servicePort = Number(process.env.HPS_EMP_SERVICE_PORT || 19031), boardPort = Number(process.env.HPS_EMP_BOARD_PORT || 19032), debugPort = Number(process.env.HPS_EMP_DEBUG_PORT || 9631);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex'), json = (p) => JSON.parse(readFileSync(p, 'utf8')), out = path.join(home, 'employee-class'); mkdirSync(out, { recursive: true });
const manifest = json(path.join(home, 'manifest.json')), copy = path.join(home, 'HypeProof Studio (ops devhost).app'), ext = path.join(copy, 'Contents/Resources/app/extensions/hypeproof-chat');
assert.ok(!copy.startsWith('/Applications'), 'never the installed app');
for (const [f, h] of Object.entries(manifest.extension.bundles)) { assert.equal(sha(path.join(ext, f)), h, `${f} changed since prepare`); assert.equal(sha(path.join(repo, 'extensions/hypeproof-chat', f)), h, `${f}: the prepared copy is not the current build — prepare again`); }
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['diff', manifest.extension.source_sha, head, '--', 'extensions/hypeproof-chat/src', 'extensions/hypeproof-chat/webview-ui/src', 'chalk/src'], { cwd: repo, encoding: 'utf8' }), '', 'extension or Chalk sources changed since prepare');

// ── result rows ──
const rows = []; let current = null;
const row = (id, title, expected) => { current = { id, title, expected, observed: {}, status: 'RUNNING', started_at: new Date().toISOString() }; rows.push(current); console.log(`\n── ${id}. ${title}`); return current; };
const see = (k, v) => { current.observed[k] = v; console.log('  ' + k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v))); return v; };
const pass = () => { current.status = 'PASS'; console.log('  PASS'); };
const blocked = (why) => { current.status = 'BLOCKED'; current.blocked_reason = why; console.log('  BLOCKED — ' + why); };
const fail = (e) => { current.status = 'FAIL'; current.error = String(e?.message ?? e); console.log('  FAIL — ' + (e?.stack ?? e)); };
const NAMES = { 'student-a': '김민지', 'student-b': '이서준', 'student-c': '박하늘' }, NAME_VALUES = Object.values(NAMES);

// ── Service: real router + SQLite, strict run ownership (nobody is assigned until the instructor configures the run in Chalk) ──
const local = await localOps({ ownership: 'strict' }), { setRoster } = await import('@hypeproof/service-testkit/src/lib/kv.ts');
const seats = [['A1', 'student-a'], ['A2', 'student-b'], ['A3', 'student-c']];
await setRoster(local.env.HPS_KV, local.cohort, seats.map(([, s]) => s)); await local.freeze();
const { issueIssuer } = await import('@hypeproof/service-testkit/src/lib/tokens.ts'), { TEST_SECRET } = await import('@hypeproof/service-testkit/test/harness/index.mjs');
const owner = (await issueIssuer({ issuer: 'teacher-a', scopes: [{ cohort: local.cohort, profiles: [local.profile], ops: [...OPS_ALL, 'distribute'] }] }, 4, TEST_SECRET)).token;
const other = (await issueIssuer({ issuer: 'teacher-b', scopes: [{ cohort: local.cohort, profiles: [local.profile], ops: [...OPS_ALL, 'distribute'] }] }, 4, TEST_SECRET)).token;
const invite = await local.request(`/admin/cohorts/${local.cohort}/authoring/${local.lesson.course_id}/versions/${local.lesson.version}/participants`, 'POST', { user: 'student-a', hours: 3 }, owner);
assert.equal(invite.status, 200, invite.raw); const learnerToken = invite.json.token;
Object.assign(local.env, { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'synthetic-no-live-key', OPENAI_API_KEY: undefined, ANTHROPIC_PROXY_URL: undefined });

// Every request body that reaches the Service (from the app over HTTP, from the Chalk worker in process) is kept for the names check.
const serviceBodies = [], realFetch = globalThis.fetch;
const bodyText = async (input, init) => { try { if (init?.body !== undefined && init.body !== null) return typeof init.body === 'string' ? init.body : Buffer.from(init.body instanceof ArrayBuffer ? init.body : await new Response(init.body).arrayBuffer()).toString('utf8'); if (input instanceof Request) return await input.clone().text(); } catch {} return ''; };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.origin === 'https://service.test') { serviceBodies.push({ from: 'chalk-worker', url: url.pathname + url.search, body: await bodyText(input, init) }); return local.app.fetch(new Request(input, init), local.env, { waitUntil() {} }); }
  assert.equal(url.origin, 'https://api.anthropic.com', 'unexpected outbound request from the Service: ' + url.origin);
  return Response.json({ id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{ type: 'text', text: '[로컬 시험 응답]' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
};
const server = createServer(async (req, res) => { try { const parts = []; for await (const p of req) parts.push(p); const body = Buffer.concat(parts); serviceBodies.push({ from: 'studio-app', url: req.url, body: body.toString('utf8') });
  const r = await local.app.fetch(new Request('https://service.test' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), local.env, { waitUntil() {}, passThroughOnException() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers)); if (r.body) for await (const chunk of r.body) res.write(chunk); res.end(); } catch { if (!res.headersSent) res.writeHead(500); res.end(); } });
server.listen(servicePort, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port;
const chalk = withHeaderConnection((await import('../../chalk/src/index.ts')).default);
const board = createServer(async (req, res) => { try { const parts = []; for await (const b of req) parts.push(b); const body = Buffer.concat(parts);
  const rr = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), { ...local.env, HPS_SERVICE_ORIGIN: 'https://service.test' }, {}); res.writeHead(rr.status, Object.fromEntries(rr.headers)); res.end(Buffer.from(await rr.arrayBuffer())); } catch (e) { res.writeHead(500); res.end(String(e)); } });
board.listen(boardPort, '127.0.0.1'); await once(board, 'listening'); const boardUrl = 'http://127.0.0.1:' + boardPort + '/manage';

// ── the learner's machine: own profile, own HOME, own workspace; the learning token enters through the dev token seam (as mac-distribution) ──
const userDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'hps-e5-'))), ws = path.join(userDir, 'ws'), fakeHome = path.join(userDir, 'home'); for (const d of [path.join(userDir, 'User'), ws, fakeHome]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(ws, 'notes.md'), '# 내 메모\n');
writeFileSync(path.join(userDir, 'User/settings.json'), JSON.stringify({ 'hypeproofChat.proxyUrl': origin + '/v1', 'window.dialogStyle': 'custom', 'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off' }));
const tokenPath = path.join(home, 'synthetic-learner-token-e5.txt'); writeFileSync(tokenPath, learnerToken, { mode: 0o600 });
const appEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(API_KEY|AUTH_TOKEN|SIGNING_SECRET|ADMIN_PASSWORD|_SECRET$|HPS_TEST|ELECTRON_RUN_AS_NODE)/.test(k)));
let app = null; const launch = () => { app = spawn(path.join(copy, 'Contents/MacOS/HypeProof Studio'), ['--user-data-dir=' + userDir, '--extensions-dir=' + path.join(userDir, 'extensions'), '--use-inmemory-secretstorage', '--disable-workspace-trust', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--remote-debugging-port=' + debugPort, '--new-window', ws], { env: { ...appEnv, HOME: fakeHome, HPS_DEV_TOKEN_FILE: tokenPath, HPS_TEST_COACH_NAME: '연습 코치', ...(manifest.agent_sdk?.binary ? { HPS_SDK_BINARY: manifest.agent_sdk.binary.path } : {}) }, stdio: ['ignore', 'ignore', 'inherit'] }); app.on('exit', (code, signal) => console.log('APP_EXIT', code, signal)); };

// ── synthetic seats: the real device client + InboxSession in this process, connected with the class code like the app ──
const synthRoot = path.join(userDir, 'synthetic-seats'), synth = {}; const memory = () => { let s = null; return { async load() { return s && JSON.parse(s); }, async save(v) { s = JSON.stringify(v); } }; }; let eid = 0;
const CAPS = ['observe', 'distribution_inbox', 'inbox_question'];
async function synthJoin(seat, student, no, code) {
  const inst = local.instance(no, CAPS), r = await local.request('/v1/classroom/ops/join', 'POST', { code, ...inst }, await local.student(student)); assert.equal(r.status, 201, seat + ' join: ' + r.raw); const c = r.json;
  const store = new InboxStore(inboxDir(synthRoot, { cohort: c.student.c, run: c.class_run_id, seat: c.seat_id, student: c.student.u })), blocks = [];
  const loop = ops.startOpsSync({ outbox: await ops.OpsOutbox.open(memory(), c.grant_id, 'stream-' + seat, () => Date.now(), () => `event-e5-${String(++eid).padStart(6, '0')}`), appInstanceId: inst.app_instance_id, capabilities: CAPS, distribution: new InboxSession({ store, alive: () => true, clock: { mono: () => performance.now(), wall: () => Date.now() } }), sample: () => ({ idle_ms: 1 }), now: () => Date.now(), random: () => 0.5, setTimeout: () => 0, clearTimeout() {}, onDisconnected() {},
    post: async (body) => { const x = await local.request('/v1/classroom/ops/sync', 'POST', { ...body, boot_id: inst.boot_id }, c.credential); if (x.json?.distribution) blocks.push(x.json.distribution); return { status: x.status, body: x.json }; } });
  synth[seat] = { conn: c, loop, store, blocks }; for (let i = 0; i < 3; i++) await loop.tick().catch(() => {});
  return synth[seat];
}
const synthItem = (seat, objectId) => synth[seat].blocks.flatMap((b) => b.items ?? []).find((i) => i.object_id === objectId);
const synthCards = async (seat) => (await synth[seat].store.read()).cards;
const { CLASS_DATA_POLICY } = await import('@hypeproof/service-testkit/src/lib/class-data-policy.ts');
const synthConsent = (seat) => local.request('/v1/classroom/ops/participation/consent', 'POST', { consent: true, notice_version: CLASS_DATA_POLICY.notice_version }, synth[seat].conn.credential);
const synthAnswer = (seat, item, answer) => local.request('/v1/classroom/ops/participation/answers', 'POST', { idempotency_key: crypto.randomUUID(), distribution_id: item.distribution_id, object_id: item.object_id, revision: item.revision, content_hash: item.content_hash, answer }, synth[seat].conn.credential);
const timer = setInterval(() => { for (const s of Object.values(synth)) s.loop.tick().catch(() => {}); }, 3000);

// ── driving the real window over its debugging port (same technique as mac-distribution.mjs) ──
let cdp = null, win = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, label, ms = 60000) => { const until = Date.now() + ms; let last; while (Date.now() < until) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(300); } throw Error('timed out: ' + label + (last instanceof Error ? ' — ' + last.message : '')); };
async function attach() { for (let i = 0; i < 90 && !cdp; i++) { try { cdp = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort); } catch { await sleep(1000); } } assert.ok(cdp, 'the Studio copy did not open its debugging port');
  win = await wait(() => cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('workbench')), 'workbench window', 90000); await win.waitForTimeout(6000); }
const toasts = () => win.evaluate(() => [...document.querySelectorAll('.notifications-toasts .notification-list-item-message, .notifications-center .notification-list-item-message')].map((e) => e.textContent));
const runCommand = async (title) => { await win.bringToFront(); await win.keyboard.press('F1'); await win.waitForSelector('.quick-input-widget input', { state: 'visible' }); await win.keyboard.type(title, { delay: 15 }); await wait(() => win.evaluate((t) => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].some((r) => r.textContent.includes(t)), title), 'command ' + title); await win.keyboard.press('Enter'); };
/** VS Code's own modal (window.dialogStyle=custom draws it in the workbench DOM): its message, detail and buttons. */
const dialog = () => win.evaluate(() => { const d = document.querySelector('.monaco-dialog-box'); if (!d) return null; return { message: d.querySelector('.dialog-message-text')?.textContent ?? '', detail: d.querySelector('.dialog-message-detail')?.textContent ?? '', buttons: [...d.querySelectorAll('.dialog-buttons .monaco-button, .dialog-buttons a, .dialog-buttons button')].map((b) => b.textContent.trim()).filter(Boolean) }; });
const pressDialog = (label) => win.evaluate((l) => { const b = [...document.querySelectorAll('.monaco-dialog-box .dialog-buttons .monaco-button, .monaco-dialog-box .dialog-buttons a, .monaco-dialog-box .dialog-buttons button')].find((x) => x.textContent.trim() === l); if (!b) return false; b.click(); return true; }, label);
const frame = (selector, ms = 60000) => wait(async () => { for (const t of (await (await realFetch('http://127.0.0.1:' + debugPort + '/json/list')).json()).filter((x) => x.type === 'iframe' && x.url.includes('hypeproof-chat'))) { const sock = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; }); let id = 0; const pending = new Map();
    sock.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { const [r, j] = pending.get(m.id); pending.delete(m.id); m.error ? j(Error(m.error.message)) : r(m.result); } }; const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; pending.set(n, [r, j]); sock.send(JSON.stringify({ id: n, method, params })); });
    await send('Page.enable'); const { frameTree } = await send('Page.getFrameTree'); for (const f of [frameTree, ...(frameTree.childFrames || [])]) { const contextId = (await send('Page.createIsolatedWorld', { frameId: f.frame.id, worldName: 'e5-emp' })).executionContextId; const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true })).result?.value;
      if (await evaluate('document.visibilityState==="visible"&&!!document.querySelector(' + JSON.stringify(selector) + ')')) return { evaluate }; } sock.close(); } return null; }, 'webview ' + selector, ms);
/** The learner's inbox as drawn on the work screen. `open` opens the list and every card, as a learner would. */
const INBOX = (open) => `(async()=>{const d=document.querySelector('details.hp-inbox[data-inbox-generation]');if(!d)return null;if(${open}){if(!d.open)d.querySelector('summary').click();await new Promise(r=>setTimeout(r,200));for(const c of d.querySelectorAll('li.hp-inbox-card details'))if(!c.open)c.querySelector('summary').click();await new Promise(r=>setTimeout(r,300));}
 return {open:d.open,summary:d.querySelector('summary').textContent.trim(),text:d.textContent,cards:[...d.querySelectorAll('li.hp-inbox-card')].map(li=>({object:li.dataset.inboxObject,revision:li.dataset.inboxRevision,title:li.querySelector('.hp-inbox-title')?.textContent??'',meta:li.querySelector('.hp-inbox-meta')?.textContent??'',body:li.querySelector('.hp-inbox-body')?.textContent??'',question:li.querySelector('[data-inbox-question]')?.dataset.inboxQuestion??null,options:[...li.querySelectorAll('.hp-inbox-options input[type=radio]')].map(i=>i.parentElement.textContent.trim()),answered:li.querySelector('[data-inbox-answered]')?.textContent??null,note:li.querySelector('[data-inbox-answer-note]')?.textContent??null,withdrawn:li.textContent.includes('강사가 회수한 자료입니다'),text:li.textContent}))};})()`;
const clickIn = (chat, cardObject, selector) => chat.evaluate(`(()=>{const li=document.querySelector('li.hp-inbox-card[data-inbox-object=${JSON.stringify(cardObject)}]');const el=li&&li.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;el.click();return true;})()`);
const shot = async (name) => { try { await win.screenshot({ path: path.join(out, name) }); return name; } catch (e) { console.log('screenshot skipped: ' + e.message); return null; } };
const enterWork = async () => { const e = await frame('.studio-primary, .hps-input textarea', 120000); if (await e.evaluate("!!document.querySelector('.studio-primary')")) await e.evaluate("document.querySelector('.studio-primary').click()"); const w = await frame('.hps-input textarea');
  // The first-use "what AI may do in this class" card covers the work screen; the learner closes it with 알겠어요.
  try { await wait(() => w.evaluate("(()=>{const b=document.querySelector('.hp-capability-next');if(b){b.click();return false;}return true;})()"), 'capability card closed', 8000); } catch {}
  return w; };
/** Scrolls the inbox into view so that the window screenshot shows it. */
const showInbox = (chat) => chat.evaluate(`(()=>{const d=document.querySelector('details.hp-inbox[data-inbox-generation]');if(!d)return null;const c=[...d.querySelectorAll('li.hp-inbox-card')].pop()||d;
  let p=c.parentElement;while(p&&!(/(auto|scroll)/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight))p=p.parentElement;p=p||document.scrollingElement;
  const pinned=(el)=>{for(let e=el;e&&e!==p;e=e.parentElement){const ps=getComputedStyle(e).position;if(ps==='sticky'||ps==='fixed')return true;}return false;};
  const x=Math.round(c.getBoundingClientRect().left+24),open=(y)=>{const el=document.elementFromPoint(x,y);return !!el&&p.contains(el)&&!pinned(el);};
  let top=0;while(top<innerHeight&&!open(top))top+=4;let bottom=innerHeight-1;while(bottom>top&&!open(bottom))bottom-=4;
  p.scrollTop+=c.getBoundingClientRect().top-(top+8);const r=c.getBoundingClientRect();return {visible:[top,bottom],card:[Math.round(r.top),Math.round(r.bottom)]};})()`);

const cleanup = () => { clearInterval(timer); try { app?.kill(); } catch {} server.close(); board.close(); local.close(); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ── the instructor pages ──
const browser = await chromium.launch({ headless: process.env.HPS_BOARD_HEADLESS === '1' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }), browserRequests = [], pageErrors = [];
context.on('request', (r) => browserRequests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
async function instructorPage(token) {
  const page = await context.newPage(); page.on('pageerror', (e) => pageErrors.push(e.message)); const refusals = [];
  page.on('response', async (r) => { if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1:' + boardPort)) { let reason = null; try { reason = (await r.json())?.reason ?? null; } catch {} refusals.push({ status: r.status(), path: new URL(r.url()).pathname, reason }); } });
  await page.goto(boardUrl); await signInChalk(page, token); await page.locator('#cohort').fill(local.cohort); await page.locator('#prefix').fill('student-');
  await page.locator('#connect button').first().click(); await page.locator('#status').filter({ hasText: '연결됨' }).waitFor(); await page.locator('#refresh').click(); await page.locator('#ops-state').waitFor();
  return { page, refusals };
}
const T = (page, id) => page.locator('#' + id).innerText();
const until = async (page, fn, what, tries = 60) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await page.locator('#refresh').click(); await page.waitForTimeout(500); } throw new Error('timed out: ' + what); };
const flags = () => JSON.parse(local.db.prepare('SELECT flags_json FROM class_run_ops WHERE class_run_id=?').get(local.run)?.flags_json ?? '{}');

let A = null, chat = null, joinCode = null, choiceCard = null, i3 = null;
try {
  // ── 1. run opened in Chalk by its owner; names imported ──
  row(1, 'instructor opens the run in Chalk /manage, turns on 관측·학생에게 보내기·질문 카드 there, imports names', 'run configured from the page with the three toggles stored; teacher-a is the owner; the board shows names next to handles; no request body or URL carries a name');
  try {
    A = await instructorPage(owner); const a = A.page;
    see('state_before', (await T(a, 'ops-state')).trim());
    if (!(await a.locator('#ops-setup').evaluate((d) => d.open))) await a.locator('#ops-setup > summary').click();
    await a.locator('#ops-roster').fill(seats.map((s) => s.join(',')).join('\n')); await a.locator('#ops-course').fill(local.lesson.course_id); await a.locator('#ops-version').fill(local.lesson.version);
    await a.locator('#ops-observe').check(); await a.locator('#ops-distribute').check(); await a.locator('#ops-questions').check();
    await a.getByRole('button', { name: '명단·설정 저장' }).click(); await a.locator('#ops-seats .ops-seat[data-seat="A3"]').waitFor();
    const f = flags(); see('stored_flags', { ops_observe: f.ops_observe, ops_distribute: f.ops_distribute, ops_questions: f.ops_questions });
    const team = local.db.prepare('SELECT instructor_id,role FROM class_run_instructors WHERE class_run_id=? AND removed_at IS NULL').all(local.run).map((r) => [r.instructor_id, r.role]); see('run_instructors', team);
    assert.deepEqual([f.ops_observe, f.ops_distribute, f.ops_questions], [true, true, true]); assert.deepEqual(team, [['teacher-a', 'owner']]);
    if (!(await a.locator('#ops-names').evaluate((d) => d.open))) await a.locator('#ops-names-sum').click();
    await a.locator('#ops-names-text').fill('handle,name\n' + Object.entries(NAMES).map(([h, n]) => h + ',' + n).join('\n'));
    await a.getByRole('button', { name: '이 기기에 이름 저장' }).click(); await a.locator('#ops-names-state').filter({ hasText: '이 기기에 저장했습니다' }).waitFor();
    const seatText = async (id) => (await a.locator(`#ops-seats .ops-seat[data-seat="${id}"] .c-seat`).innerText()).replace(/\s+/g, ' ').trim();
    const shown = see('board_seat_cells', { A1: await seatText('A1'), A2: await seatText('A2'), A3: await seatText('A3') });
    for (const [seat, h] of seats) assert.match(shown[seat], new RegExp(`^${seat} ${NAMES[h]} ${h}`), 'the name next to the handle');
    await a.screenshot({ path: path.join(out, '01-chalk-board-names.png'), fullPage: true }); see('screenshot', '01-chalk-board-names.png');
    current.observed.names_in_requests = 'checked at the end of the run, over every request (see names_check)'; pass();
  } catch (e) { fail(e); }

  // Learner: the real window opens, the class is entered with the learning token; NOT connected to the class yet.
  launch(); await attach(); chat = await enterWork();

  // ── 3. class code → real window 수업 연결 → notice modal → accept → consent ──
  row(3, 'class code from Chalk; the real window connects with it, reads the class data notice, accepts', 'Chalk shows an XXXX-XXXX code; 수업 연결 in the real window shows the notice modal before the code; accepting connects seat A1 with the code and the board shows 동의함 for A1 only');
  try {
    const a = A.page; await a.locator('#join-code-open').click(); await a.locator('#ops-join-make').waitFor(); await a.locator('#ops-join-make').click();
    await a.locator('#ops-join-state').filter({ hasText: '수업 코드를 만들었습니다' }).waitFor(); joinCode = see('class_code_shape', (await T(a, 'ops-join-code')).trim()); assert.match(joinCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    current.observed.class_code_shape = joinCode.replace(/[A-Z0-9]/g, 'X'); see('join_meta', (await T(a, 'ops-join-meta')).trim());
    await a.screenshot({ path: path.join(out, '02-chalk-class-code.png'), fullPage: false });
    await runCommand('HypeProof: 수업 연결 (강사가 준 코드 입력)');
    let notice = null; try { notice = await wait(dialog, 'the class data notice modal', 20000); } catch {}
    if (!notice) { blocked('no VS Code modal appeared in the workbench DOM after 수업 연결 (window.dialogStyle=custom); the native modal cannot be driven over the debugging port'); }
    else {
      see('notice_modal', notice); assert.equal(notice.message, '수업 참여 데이터 안내'); assert.ok(notice.buttons.includes('동의하고 수업에 연결'), 'accept button');
      assert.equal(local.db.prepare("SELECT uses FROM class_run_join_codes WHERE state='active'").get().uses, 0, 'the code is not used before the notice is answered');
      await shot('03-learner-class-data-notice.png'); assert.ok(await pressDialog('동의하고 수업에 연결'), 'accept pressed');
      await wait(() => win.evaluate(() => { const w = document.querySelector('.quick-input-widget'); return !!w && getComputedStyle(w).display !== 'none' && w.textContent.includes('수업 코드(8자리)') && !document.querySelector('.monaco-dialog-box'); }), 'the code input box');
      const input = win.locator('.quick-input-widget input.input, .quick-input-widget .quick-input-box input').first(); await input.click(); await input.fill(joinCode); await win.waitForTimeout(300); see('code_input_validation', await win.evaluate(() => document.querySelector('.quick-input-widget .quick-input-message')?.textContent ?? ''));
      await input.press('Enter');
      const confirm = await wait(async () => { const d = await dialog(); return d && /handle/.test(d.message + d.detail) ? d : null; }, 'the handle confirmation', 20000).catch(async (e) => { see('diagnosis', { toasts: await toasts(), dialog: await dialog(), quick_input: await win.evaluate(() => document.querySelector('.quick-input-widget')?.textContent ?? null) }); await shot('03x-learner-after-code.png'); throw e; }); see('handle_confirmation', confirm.message + confirm.detail); assert.match(confirm.message + confirm.detail, /handle student-a\(으\)로 이번 수업에 연결합니다/);
      assert.ok(await pressDialog('연결')); const toast = await wait(async () => (await toasts()).find((t) => t.includes('수업에 연결했습니다')), 'connected toast', 30000); see('connected_toast', toast); assert.match(toast, /좌석 A1/);
      const via = local.db.prepare("SELECT seat_id,detail_json FROM ops_audit WHERE action='device_connected' ORDER BY rowid DESC LIMIT 1").get(); see('service_audit_device_connected', { seat: via?.seat_id, via: via ? JSON.parse(via.detail_json ?? '{}').via ?? null : null });
      see('join_code_uses', local.db.prepare("SELECT uses FROM class_run_join_codes WHERE state='active'").get().uses);
      const consent = async (seat) => (await a.locator(`#ops-seats .ops-seat[data-seat="${seat}"] .consent`).textContent().catch(() => ''))?.trim();
      await until(a, async () => (await consent('A1')) === '동의함', 'A1 동의함 on the board');
      const c = see('board_consent', { A1: await consent('A1'), A2: await consent('A2'), A3: await consent('A3') }); assert.deepEqual(Object.values(c), ['동의함', '동의 전', '동의 전']);
      await a.screenshot({ path: path.join(out, '04-chalk-board-consent.png'), fullPage: true }); pass();
    }
  } catch (e) { fail(e); }

  // ── 2. who is connected now ──
  row(2, 'who is connected now', 'the board shows A1 (the real window) connected and A2/A3 not connected');
  try {
    const a = A.page; await until(a, async () => !/기기 연결 안 됨/.test(await a.locator('#ops-seats .ops-seat[data-seat="A1"]').innerText()), 'A1 connected on the board');
    const rowText = async (id) => (await a.locator(`#ops-seats .ops-seat[data-seat="${id}"]`).innerText()).replace(/\s+/g, ' ').trim();
    const r = see('board_rows', { A1: await rowText('A1'), A2: await rowText('A2'), A3: await rowText('A3') });
    assert.doesNotMatch(r.A1, /기기 연결 안 됨/); assert.match(r.A2, /기기 연결 안 됨/); assert.match(r.A3, /기기 연결 안 됨/);
    if (!(await a.locator('#ops-q').evaluate((d) => d.open ?? true))) await a.locator('#ops-q-summary').click();
    await a.locator('#ops-q-body').fill('x'); const toAll = see('composer_to_all', (await T(a, 'ops-q-to-all')).trim()); await a.locator('#ops-q-body').fill('');
    assert.match(toAll, /명단 3석 \(지금 연결 1석/);
    await a.screenshot({ path: path.join(out, '05-chalk-board-connected-now.png'), fullPage: true }); pass();
  } catch (e) { fail(e); }

  // ── 4. question card to all seats ──
  row(4, 'question card to ALL seats; real inbox; late joiner; answer and skip; per-learner status and answers with names', 'A2 connected before the send, A3 after; Chalk 전달 전 → 전달됨 → 답함; the real window shows the card and its answer form; the learner chooses and presses 제출 there; A2 skips; the answers view shows names; no opened/read wording');
  try {
    const a = A.page; if (!joinCode) throw Error('no class code (row 3 did not complete)');
    await synthJoin('A2', 'student-b', 2, joinCode); see('A2', 'connected with the class code before the send (synthetic device client)');
    await until(a, async () => !/기기 연결 안 됨/.test(await a.locator('#ops-seats .ops-seat[data-seat="A2"]').innerText()), 'A2 connected on the board before composing');
    if (!(await a.locator('#ops-q').evaluate((d) => d.open ?? true))) await a.locator('#ops-q-summary').click();
    await a.locator('#ops-q-body').fill('오늘 실습에서 가장 어려웠던 단계는?'); await a.locator('#ops-q-options').fill('자료 정리\n프롬프트 작성\n결과 검토');
    const allRadio = a.locator('input[name="ops-q-to"][value="all"]'); if (await allRadio.count()) await allRadio.check();
    await a.locator('#ops-q-send').click(); see('impact', (await T(a, 'ops-q-impact')).trim()); await a.locator('#ops-q-go').click(); await a.locator('#ops-q-state').filter({ hasText: '보냈습니다 · 3석' }).waitFor();
    choiceCard = local.db.prepare("SELECT d.id,d.object_id FROM classroom_distributions d JOIN classroom_content_objects o ON o.object_id=d.object_id WHERE o.kind='question' ORDER BY d.created_at DESC LIMIT 1").get();
    const cell = async (seat) => (await a.locator(`#ops-qc-view tr[data-seat="${seat}"] td`).allInnerTexts()).map((x) => x.trim());
    await a.locator('#ops-qc-view tr[data-seat="A3"]').waitFor(); see('A3_right_after_send', await cell('A3')); assert.equal((await cell('A3'))[3], '전달 전');
    // the real window
    const card = await wait(async () => { const v = await chat.evaluate(INBOX(true)); return v?.cards.find((c) => c.object === choiceCard.object_id && c.options.length === 3) ? v : null; }, 'the question card in the real window inbox', 90000);
    const real = card.cards.find((c) => c.object === choiceCard.object_id); see('real_window_card', { summary: card.summary, body: real.body, options: real.options, question: real.question, meta: real.meta });
    assert.equal(real.body, '오늘 실습에서 가장 어려웠던 단계는?'); assert.deepEqual(real.options, ['자료 정리', '프롬프트 작성', '결과 검토']); await showInbox(chat); await win.waitForTimeout(600); see('inbox_in_view_06', await showInbox(chat)); await win.waitForTimeout(200); await shot('06-learner-inbox-question.png');
    // the late joiner
    await synthJoin('A3', 'student-c', 3, joinCode); await wait(async () => { await synth.A3.loop.tick(); return (await synthCards('A3')).some((c) => c.object_id === choiceCard.object_id && c.kind === 'question'); }, 'the late joiner holds the card', 60000);
    i3 = synthItem('A3', choiceCard.object_id); see('A3_late_joiner', 'connected after the send; its inbox on disk holds the question card');
    await until(a, async () => (await cell('A1'))[3] === '전달됨' && (await cell('A2'))[3] === '전달됨' && (await cell('A3'))[3] === '전달됨', 'all three 전달됨');
    see('chalk_delivered', { A1: await cell('A1'), A2: await cell('A2'), A3: await cell('A3') });
    // the real learner answers in the inbox UI: choose 프롬프트 작성, press 제출
    assert.ok(await chat.evaluate(`(()=>{const li=document.querySelector('li.hp-inbox-card[data-inbox-object=${JSON.stringify(choiceCard.object_id)}]');const r=li.querySelectorAll('.hp-inbox-options input[type=radio]')[1];r.click();return r.checked;})()`), 'option chosen');
    assert.ok(await clickIn(chat, choiceCard.object_id, '[data-inbox-submit]'), '제출 pressed');
    const answered = await wait(async () => (await chat.evaluate(INBOX(false))).cards.find((c) => c.object === choiceCard.object_id && c.answered), 'answered in the real window', 30000); see('real_window_after_submit', answered.answered); assert.match(answered.answered, /답변을 보냈습니다\. 내 답: 프롬프트 작성/);
    await showInbox(chat); await win.waitForTimeout(600); see('inbox_in_view_07', await showInbox(chat)); await win.waitForTimeout(200); await shot('07-learner-inbox-answered.png');
    // A2 skips (synthetic seat, its own consent then skip)
    const i2 = synthItem('A2', choiceCard.object_id); assert.ok(i2, 'A2 was offered the card'); see('A2_consent', (await synthConsent('A2')).status); const sk = await synthAnswer('A2', i2, { skipped: true }); see('A2_skip', sk.status); assert.equal(sk.status, 201);
    await until(a, async () => (await cell('A1'))[3] === '답함' && (await cell('A2'))[3] === '답함', 'A1 and A2 답함');
    const final = see('chalk_answers_view', { A1: await cell('A1'), A2: await cell('A2'), A3: await cell('A3'), state: (await T(a, 'ops-qc-state')).trim() });
    assert.deepEqual(final.A1, ['A1', '김민지 (student-a)', '연결됨', '답함', '2번 · 프롬프트 작성']); assert.deepEqual(final.A2.slice(1, 5), ['이서준 (student-b)', '연결됨', '답함', '건너뜀']); assert.deepEqual(final.A3.slice(1, 4), ['박하늘 (student-c)', '연결됨', '전달됨']);
    const words = (await T(a, 'ops-q')) + (await T(a, 'ops-qc')), inboxWords = (await chat.evaluate(INBOX(true))).text;
    see('opened_read_wording', { chalk: /열람|읽음|읽었|opened|read\b/i.test(words), real_window: /열람|읽음|읽었/.test(inboxWords) }); assert.doesNotMatch(words, /열람|읽음|읽었|opened/); assert.doesNotMatch(inboxWords, /열람|읽음|읽었/);
    await a.locator('#ops-qc').screenshot({ path: path.join(out, '08-chalk-answers-view.png') }); await a.screenshot({ path: path.join(out, '09-chalk-board-answered.png'), fullPage: true }); pass();
  } catch (e) { fail(e); }

  // ── 5. withdrawal ──
  row(5, 'withdraw the card from Chalk', 'the card leaves the real window inbox (withdrawn notice, no form, no body); a new answer is refused; the answer given before stays');
  try {
    const a = A.page; if (!choiceCard) throw Error('no question card (row 4 did not complete)');
    // The learner opens 답 바꾸기 and picks another option, but has not pressed 제출 when the instructor withdraws.
    assert.ok(await clickIn(chat, choiceCard.object_id, '[data-inbox-change]'), '답 바꾸기 opened');
    await wait(() => chat.evaluate(`(()=>{const li=document.querySelector('li.hp-inbox-card[data-inbox-object=${JSON.stringify(choiceCard.object_id)}]');const r=li&&li.querySelectorAll('.hp-inbox-options input[type=radio]')[2];if(!r)return false;r.click();return r.checked;})()`), 'another option chosen', 10000);
    await a.locator('#ops-qc-withdraw').click(); await a.locator('#ops-qc-withdraw-impact').filter({ hasText: '회수합니다' }).waitFor(); see('withdraw_impact', (await T(a, 'ops-qc-withdraw-impact')).trim()); await a.locator('#ops-qc-withdraw-go').click(); await a.locator('#ops-qc-note').filter({ hasText: '회수했습니다' }).waitFor();
    const pressed = await clickIn(chat, choiceCard.object_id, '[data-inbox-submit]'); see('real_window_submit_after_withdrawal', pressed ? 'pressed (the device had not applied the withdrawal yet)' : 'no form left to press (the device had already applied the withdrawal)');
    if (pressed) { const note = await wait(async () => (await chat.evaluate(INBOX(false))).cards.find((c) => c.object === choiceCard.object_id && (c.note || c.withdrawn)), 'refusal note or withdrawal', 30000); see('real_window_refusal', note.note ?? 'card already withdrawn before the answer returned'); if (note.note) assert.match(note.note, /강사가 이 질문을 회수해 답을 보내지 않았습니다|이 질문에는 더 답할 수 없습니다/); }
    const gone = await wait(async () => { const v = await chat.evaluate(INBOX(true)); const c = v?.cards.find((x) => x.object === choiceCard.object_id); return c && c.withdrawn ? c : null; }, 'the card withdrawn in the real window', 90000);
    see('real_window_after_withdrawal', { withdrawn: gone.withdrawn, body: gone.body, options: gone.options, title: gone.title }); assert.deepEqual([gone.body, gone.options.length, gone.title], ['', 0, '']);
    await showInbox(chat); await win.waitForTimeout(600); see('inbox_in_view_10', await showInbox(chat)); await win.waitForTimeout(200); await shot('10-learner-inbox-withdrawn.png');
    see('A3_consent', (await synthConsent('A3')).status); const late = await synthAnswer('A3', i3, { choice: 0 }); see('new_answer_after_withdrawal_A3', { status: late.status, reason: late.json?.reason }); assert.equal(late.json?.reason, 'withdrawn');
    const a1 = (await a.locator('#ops-qc-view tr[data-seat="A1"] td').allInnerTexts()).map((x) => x.trim()); see('chalk_A1_after_withdrawal', a1); assert.equal(a1[4], '2번 · 프롬프트 작성', 'the answer given before the withdrawal stays and was not changed');
    assert.notEqual(local.db.prepare('SELECT revoked_at FROM classroom_distributions WHERE id=?').get(choiceCard.id).revoked_at, null);
    await a.screenshot({ path: path.join(out, '11-chalk-withdrawn.png'), fullPage: true }); pass();
  } catch (e) { fail(e); }

  // ── 6. an instructor who is not assigned ──
  row(6, 'a second instructor not assigned to the run', '/manage shows the not-assigned copy; the Service answered 403 not_run_instructor; no seat, no question composer, no class code tools');
  try {
    const B = await instructorPage(other), b = B.page; await b.locator('#ops-state').filter({ hasText: '배정된 강사만 운영합니다' }).waitFor();
    see('state', (await T(b, 'ops-state')).trim()); see('refusals', B.refusals);
    assert.ok(B.refusals.some((r) => r.status === 403 && r.reason === 'not_run_instructor'), '403 not_run_instructor observed on the page');
    const can = see('drawn', { seats: await b.locator('#ops-seats .ops-seat').count(), question_composer_visible: await b.locator('#ops-q').isVisible(), class_code_button_visible: await b.locator('#join-code-open').isVisible(), setup_visible: await b.locator('#ops-setup').isVisible() });
    assert.deepEqual([can.seats, can.question_composer_visible], [0, false], 'no learner and no question composer');
    // Controls that are still drawn are tried, as an instructor would: each must be refused by the Service and change nothing.
    const codesBefore = local.db.prepare('SELECT id,state FROM class_run_join_codes ORDER BY id').all(), flagsBefore = flags(), rosterBefore = local.db.prepare('SELECT roster_revision FROM class_run_ops WHERE class_run_id=?').get(local.run);
    const tried = {}; const n0 = B.refusals.length;
    if (can.class_code_button_visible) { await b.locator('#join-code-open').click(); await b.waitForTimeout(800); if (await b.locator('#ops-join-make').isVisible()) { await b.locator('#ops-join-make').click(); await b.waitForTimeout(500); if (await b.locator('#ops-join-go').isVisible()) await b.locator('#ops-join-go').click(); await b.waitForTimeout(1500); }
      tried.class_code = { join_area: (await b.locator('#ops-join').innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300), refusals: B.refusals.slice(n0) }; }
    const n1 = B.refusals.length;
    if (can.setup_visible) { if (!(await b.locator('#ops-setup').evaluate((d) => d.open))) await b.locator('#ops-setup > summary').click(); await b.locator('#ops-roster').fill('A1,student-a'); await b.locator('#ops-questions').uncheck().catch(() => {}); await b.getByRole('button', { name: '명단·설정 저장' }).click(); await b.waitForTimeout(1500);
      tried.save_run_config = { state: (await T(b, 'ops-state')).trim(), refusals: B.refusals.slice(n1) }; }
    see('tried', tried);
    const changed = see('service_unchanged', { join_codes: JSON.stringify(local.db.prepare('SELECT id,state FROM class_run_join_codes ORDER BY id').all()) === JSON.stringify(codesBefore), flags: JSON.stringify(flags()) === JSON.stringify(flagsBefore), roster: JSON.stringify(local.db.prepare('SELECT roster_revision FROM class_run_ops WHERE class_run_id=?').get(local.run)) === JSON.stringify(rosterBefore) });
    assert.deepEqual(changed, { join_codes: true, flags: true, roster: true }, 'nothing the unassigned instructor tried changed the run');
    for (const t of Object.values(tried)) assert.ok(t.refusals.some((r) => r.status === 403), 'each attempt was refused by the Service: ' + JSON.stringify(t.refusals));
    if (can.class_code_button_visible || can.setup_visible) current.observed.note = 'the class code button and the run setup form are still drawn for an unassigned instructor; using them is refused (403) and changes nothing';
    await b.screenshot({ path: path.join(out, '12-chalk-not-assigned.png'), fullPage: true }); pass();
  } catch (e) { fail(e); }

  // ── names: every request of the run ──
  const all = [...browserRequests.map((r) => ({ from: 'chalk-page', url: r.url, body: r.body })), ...serviceBodies];
  const leaked = all.filter((r) => NAME_VALUES.some((n) => r.body.includes(n) || r.body.includes(JSON.stringify(n).slice(1, -1)) || decodeURIComponent(r.url).includes(n)));
  const namesCheck = { requests_checked: all.length, by_source: Object.fromEntries(['chalk-page', 'chalk-worker', 'studio-app'].map((s) => [s, all.filter((r) => r.from === s).length])), leaked: leaked.map((r) => ({ from: r.from, url: r.url })) };
  const r1 = rows.find((r) => r.id === 1); r1.observed.names_check = namesCheck; console.log('\nnames check: ' + JSON.stringify(namesCheck));
  if (leaked.length || namesCheck.by_source['chalk-page'] < 20) { r1.status = 'FAIL'; r1.error = leaked.length ? 'a request carried a learner name' : 'too few requests captured to say anything'; }
} catch (e) { console.log('RUN ABORTED: ' + (e?.stack ?? e)); rows.push({ id: 'abort', status: 'FAIL', error: String(e?.message ?? e) }); }

rows.sort((x, y) => (typeof x.id === 'number' ? x.id : 99) - (typeof y.id === 'number' ? y.id : 99));
const result = { schema: 'hps-classroom-mac-employee-class/1', at: new Date().toISOString(), issue: 'hypeproof/hypeproof-studio#3779',
  host: 'isolated dev host on this Mac: a COPY of the official shell with the current extension + webview build injected (mac-devhost.mjs), its own user-data dir and HOME, a local Service (testkit router + SQLite, strict run ownership)',
  shell: { version: manifest.shell.version, commit: manifest.shell.commit, copied_from: manifest.shell.copied_from }, extension_source_sha: manifest.extension.source_sha, runner_head: head, extension_bundles: manifest.extension.bundles,
  real: ['Studio window (shell copy + current extension)', 'VS Code modal and input box (window.dialogStyle=custom, driven over the debugging port)', 'ops sync loop and inbox on disk', 'Chalk /manage in a visible Chromium window', 'Chalk worker', 'Service router + SQLite'],
  synthetic: ['accounts and tokens', 'lesson', 'seats A2 (connected before the send, skips) and A3 (late joiner): the real device client in this process; their consent/answers use the Service routes with their own seat credentials', 'model (none called)'],
  not_run: ['Windows', 'multi-PC (every seat on this one Mac; A2/A3 in process)', 'production', 'staging'],
  summary: Object.fromEntries(rows.map((r) => [r.id, r.status])), steps: rows, page_errors: pageErrors };
writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log('\n' + JSON.stringify(result.summary) + ' → ' + path.join(out, 'result.json'));
try { await browser.close(); } catch {} try { await cdp?.close(); } catch {} cleanup();
process.exit(rows.some((r) => r.status === 'FAIL') ? 1 : 0);
