// REQ-E1 / CGP-AGENT-R-005 — when `writeFile` is in requireApprovalFor, the write approval lists every path the
// call will write, relative to the work folder (`작업 폴더/src/app.js`), up to 5 then "외 N개" with a full-list
// button that names the real total. Outside paths (absolute, `..`, a symlink that resolves outside) read
// 작업 폴더 밖 and are refused before any modal. 새 파일 / 바꿈 only when the tool input says so. Names cannot fake
// a line. The approval covers exactly the listed paths: a path that changes while the modal is open is refused.
//
// Pure module first, then the real chatPanelProvider bundled with a scripted `vscode` (as
// browser-target-host.test.mjs does), then the real runSdkCoach with a scripted CLI (as
// orchestrator-switch.smoke.mjs does), then the local runtime. .claude/rules/verification.md §2: every
// "inside" case is a positive control for every "outside" case.
// Run: node --experimental-strip-types --test test/write-approval-paths.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';

// sdkCoach.ts imports its siblings without extensions (esbuild resolves them); resolve them the same way and
// `vscode` to the shared stub, as orchestrator-switch.smoke.mjs does.
const stub = new URL('./fixtures/vscode-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'vscode') return { url: stub, shortCircuit: true };
    if (specifier.startsWith('.') && !/\.[a-z0-9]+$/i.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { return nextResolve(specifier, context); }
    }
    return nextResolve(specifier, context);
  },
});

const {
  writeTargetsOf, writeTargetsFromPayload, writePathEntries, writeApprovalCopy, writePathLine, writeScopeKeys, writeScopeCovered,
  WRITE_PATHS_SHOWN,
} = await import('../src/writeApprovalPaths.ts');
const { sdkToolToActionRequest } = await import('../src/sdkCoachHelpers.ts');

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hps-write-paths-')));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const WS = path.join(scratch, 'work');
const OUT = path.join(scratch, 'elsewhere');
fs.mkdirSync(path.join(WS, 'src'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(WS, 'src', 'app.js'), 'old');
fs.symlinkSync(OUT, path.join(WS, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
const LINES = /[\n\r\u0085\u2028\u2029]/;
const TITLE = '코치가 파일을 저장하려고 해요:';

test('single write: one path, relative to the work folder; change tag only when the input says so', () => {
  const w = writePathEntries(writeTargetsOf('Write', { file_path: path.join(WS, 'src/app.js'), content: 'x' }), WS);
  assert.deepEqual(w.map(writePathLine), ['작업 폴더/src/app.js'], 'Write says nothing: create or overwrite is not in the input');
  const rel = writePathEntries(writeTargetsOf('Write', { file_path: 'index.html', content: 'x' }), WS);
  assert.deepEqual(rel.map(writePathLine), ['작업 폴더/index.html'], 'a relative path resolves against the work folder');
  const edit = writePathEntries(writeTargetsOf('Edit', { file_path: path.join(WS, 'src/app.js'), old_string: 'old', new_string: 'new' }), WS);
  assert.deepEqual(edit.map(writePathLine), ['작업 폴더/src/app.js · 바꿈']);
  const create = writeTargetsOf('Edit', { file_path: path.join(WS, 'new.css'), old_string: '', new_string: 'a{}' });
  assert.deepEqual(writePathEntries(create, WS).map(writePathLine), ['작업 폴더/new.css · 새 파일']);
  const multi = writeTargetsOf('MultiEdit', { file_path: path.join(WS, 'src/app.js'), edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] });
  assert.equal(multi[0].change, 'changed');
  assert.equal(writeTargetsOf('MultiEdit', { file_path: 'x', edits: [{ old_string: 'a' }, { old_string: '' }] })[0].change, undefined, 'mixed: no guess');
  assert.equal(writeTargetsOf('MultiEdit', { file_path: 'x', edits: [{ new_string: 'a' }] })[0].change, undefined, 'malformed: no guess');
  assert.equal(writeTargetsOf('NotebookEdit', { notebook_path: path.join(WS, 'a.ipynb'), new_source: '' })[0].change, 'changed');
  assert.deepEqual(writeTargetsOf('Read', { file_path: 'a' }), [], 'not a write tool');
  const copy = writeApprovalCopy(TITLE, edit);
  assert.equal(copy.message, `${TITLE}\n\n작업 폴더/src/app.js · 바꿈`);
  assert.equal(copy.allLabel, undefined, 'nothing hidden → no full-list button');
});

test('multi-file write lists every path; over 5 shows 외 N개 and a full list with the real count', () => {
  const targets = Array.from({ length: 12 }, (_, i) => ({ path: path.join(WS, `p${String(i + 1).padStart(2, '0')}.html`) }));
  const entries = writePathEntries(targets, WS);
  assert.equal(entries.length, 12);
  const exact = writeApprovalCopy(TITLE, entries.slice(0, WRITE_PATHS_SHOWN));
  assert.equal(exact.message.split('\n').length, 2 + 5, 'exactly 5: all listed, no 외');
  assert.ok(!exact.message.includes('외'));
  const three = writeApprovalCopy(TITLE, entries.slice(0, 3));
  assert.equal(three.message, `${TITLE}\n\n작업 폴더/p01.html\n작업 폴더/p02.html\n작업 폴더/p03.html`);
  const over = writeApprovalCopy(TITLE, entries);
  assert.equal(WRITE_PATHS_SHOWN, 5);
  assert.equal(over.hidden, 7);
  assert.match(over.message, /\n작업 폴더\/p05\.html\n외 7개$/);
  assert.ok(!over.message.includes('p06'), 'the sixth is not in the short list');
  assert.equal(over.allLabel, '전체 목록 보기 (12개)');
  assert.equal(over.allMessage.split('\n').filter((l) => l.startsWith('작업 폴더/')).length, 12, 'the full list has every path');
  assert.match(over.allMessage, /모두 12개:/);
  // payload form (what sdkToolToActionRequest sends), strings and objects
  assert.deepEqual(writeTargetsFromPayload({ paths: ['a', { path: 'b', change: 'new' }, { path: '' }, 7] }), [{ path: 'a' }, { path: 'b', change: 'new' }]);
  assert.deepEqual(writeTargetsFromPayload({ path: 'only' }), [{ path: 'only' }]);
});

test('outside, a .. escape and a symlink are marked 작업 폴더 밖; inside is the positive control', () => {
  const lines = writePathEntries([
    { path: path.join(WS, 'src/app.js') },
    { path: path.join(OUT, 'secret.txt') },
    { path: path.join(WS, '..', 'elsewhere', 'escape.txt') },
    { path: path.join(WS, 'src', '..', '..', 'x.txt') },
    { path: path.join(WS, 'link', 'via-link.txt') },
    { path: path.join(WS, 'link', 'deeper', 'new.txt') },
    { path: '../rel-escape.txt' },
  ], WS);
  assert.deepEqual(lines.map((e) => [e.display, e.outside]), [
    ['작업 폴더/src/app.js', false],
    ['작업 폴더 밖 · secret.txt', true],
    ['작업 폴더 밖 · escape.txt', true],
    ['작업 폴더 밖 · x.txt', true],
    ['작업 폴더 밖 · via-link.txt', true],
    ['작업 폴더 밖 · new.txt', true],
    ['작업 폴더 밖 · rel-escape.txt', true],
  ]);
  assert.ok(!lines.some((e) => e.display.includes(scratch)), 'never the full path');
  // A symlinked WORK FOLDER (macOS /var → /private/var) is still inside: the root is canonical too.
  const alias = path.join(scratch, 'alias');
  fs.symlinkSync(WS, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(writePathEntries([{ path: path.join(WS, 'a.js') }], alias).map((e) => [e.display, e.outside]), [['작업 폴더/a.js', false]]);
  assert.deepEqual(writePathEntries([{ path: 'a.js' }], null).map((e) => e.outside), [true], 'no work folder → outside');
});

test('a control, bidi or line-separator character in a name cannot fake a line', () => {
  const forged = ['a\u2028작업 폴더/ok.js', 'b\n작업 폴더/ok2.js', 'c\r\u0085.js', '\u202esj.exe', 'd\u2029\u2066e\u2069.js'];
  const entries = writePathEntries(forged.map((n) => ({ path: path.join(WS, n) })), WS);
  const copy = writeApprovalCopy(TITLE, entries);
  assert.equal(copy.message.split(LINES).length, 2 + forged.length, JSON.stringify(copy.message));
  assert.deepEqual(entries.map((e) => e.display), ['작업 폴더/a작업 폴더/ok.js', '작업 폴더/b작업 폴더/ok2.js', '작업 폴더/c.js', '작업 폴더/sj.exe', '작업 폴더/de.js']);
  // a name that is nothing but controls still yields one line
  const blank = writePathEntries([{ path: path.join(OUT, '\u2028\u2029') }], WS);
  assert.equal(writeApprovalCopy(TITLE, blank).message.split(LINES).length, 3);
});

test('scope keys: the approval covers exactly the listed paths', () => {
  const approved = writeScopeKeys('Write', { file_path: path.join(WS, 'src/app.js') }, WS);
  assert.equal(approved.length, 1);
  assert.ok(writeScopeCovered(approved, writeScopeKeys('Write', { file_path: path.join(WS, 'src/app.js') }, WS)), 'positive control');
  assert.ok(!writeScopeCovered(approved, writeScopeKeys('Write', { file_path: path.join(WS, 'src/other.js') }, WS)), 'another path');
  assert.ok(!writeScopeCovered(approved, []), 'nothing named → not covered');
});

test('the request carries every path and its change tag (sdkToolToActionRequest)', () => {
  const req = sdkToolToActionRequest({ toolName: 'Edit', input: { file_path: path.join(WS, 'src/app.js'), old_string: 'a', new_string: 'b' } });
  assert.equal(req.kind, 'writeFile');
  assert.equal(req.payload.path, path.join(WS, 'src/app.js'), 'path kept for the Tier-2 check and older callers');
  assert.deepEqual(req.payload.paths, [{ path: path.join(WS, 'src/app.js'), change: 'changed' }]);
  const w = sdkToolToActionRequest({ toolName: 'Write', input: { file_path: 'index.html', content: 'x' } });
  assert.deepEqual(w.payload.paths, [{ path: 'index.html' }]);
});

// ── The real approval modal (chatPanelProvider + scripted vscode) ──
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL('../src/chatPanelProvider.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error' });
const source = bundle.outputFiles[0].text;
const modals = [];
let answer = () => undefined;
let required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType', 'writeFile'];
const vscode = {
  window: { showWarningMessage: async (message, options, ...buttons) => { const m = { message, options, buttons }; modals.push(m); return answer(m); } },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key === 'requireApprovalFor' ? required : fallback) }),
    workspaceFolders: [{ uri: { fsPath: WS } }],
  },
};
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, exports: mod.exports, require: (id) => (id === 'vscode' ? vscode : require(id)), console, Buffer, process, setTimeout, clearTimeout, AbortSignal, URL, TextEncoder, TextDecoder });
const P = mod.exports.ChatPanelProvider.prototype;
const host = { approvedCommandSignatures: new Set(), approvedBrowserOrigins: new Set(), coachDisplayName: () => '코치', sitePublisher: () => ({ allowed: () => false }), resolveCoachCwd: () => WS };
host.writeApprovalScope=()=>WS;
host.context={secrets:{get:async()=> 'token'}};
host.confirmWriteFiles=(...args)=>P.confirmWriteFiles.call(host,...args);
host.writeApprovalRequest={invalidate(){},confirm:async prompt=>{const m={message:prompt.title+'\n\n'+prompt.files.join('\n'),options:{modal:true},buttons:[prompt.verb],prompt};modals.push(m);return answer(m)===prompt.verb;}};
const captured = [];
const ask = async (label, req, pick) => {
  modals.length = 0;
  answer = pick ?? (() => undefined);
  const approved = await P.resolveActionApproval.call(host, { requestId: 'r', kind: 'writeFile', description: 'raw', ...req });
  captured.push({ label, approved, modals: modals.map((m) => ({ ...m })) });
  return { approved, modals: [...modals] };
};

test('the native modal lists the paths in Korean; 저장 approves; dismiss does not', async () => {
  const one = await ask('single Edit', sdkToolToActionRequest({ toolName: 'Edit', input: { file_path: path.join(WS, 'src/app.js'), old_string: 'old', new_string: 'new' } }));
  assert.equal(one.approved, false);
  assert.equal(one.modals.length, 1);
  assert.equal(one.modals[0].message, `${TITLE}\n\n작업 폴더/src/app.js · 바꿈`);
  assert.deepEqual(one.modals[0].buttons, ['저장']);
  assert.equal(one.modals[0].options.modal, true);
  assert.ok(!one.modals[0].message.includes(scratch), 'no absolute path in the modal');
  const yes = await ask('single Write, approved', sdkToolToActionRequest({ toolName: 'Write', input: { file_path: path.join(WS, 'index.html'), content: 'x' } }), () => '저장');
  assert.equal(yes.approved, true);
  assert.notEqual(yes.modals[0].prompt.id,one.modals[0].prompt.id,'repeated caller request id gets a fresh presentation id');
  assert.equal(yes.modals[0].message, `${TITLE}\n\n작업 폴더/index.html`);
});

test('the host sends every safe file to one chip dialog; dismissal is not approval', async () => {
  const paths=Array.from({length:11},(_,i)=>({path:path.join(WS,`pages/p${i+1}.html`)}));
  const r=await ask('11 paths',{payload:{paths}},()=> '저장');
  assert.equal(r.modals.length,1);assert.equal(r.modals[0].prompt.files.length,11);
  assert.equal(r.modals[0].prompt.files.at(-1),'작업 폴더/pages/p11.html');assert.equal(r.approved,true);
  assert.equal((await ask('dismiss 11 paths',{payload:{paths}})).approved,false);
});

test('an outside, .. or symlinked path is refused before any modal, and the notice is marked, not the full path', async () => {
  for (const [label, p] of [['outside', path.join(OUT, 'secret.txt')], ['.. escape', path.join(WS, '..', 'elsewhere', 'e.txt')], ['symlink', path.join(WS, 'link', 'via.txt')]]) {
    const r = await ask(`refused: ${label}`, { payload: { path: path.join(WS, 'ok.txt'), paths: [{ path: path.join(WS, 'ok.txt') }, { path: p }] } }, () => '저장');
    assert.equal(r.approved, false, label);
    assert.equal(r.modals.length, 1, `${label}: one notice`);
    assert.equal(r.modals[0].options, undefined, `${label}: a notice, not a modal`);
    assert.match(r.modals[0].message, /작업 폴더 밖 · /, label);
    assert.ok(!r.modals[0].message.includes(scratch), `${label}: no full path in the notice`);
  }
});

test('writeFile not in requireApprovalFor (the default): no modal, as before', async () => {
  required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType'];
  const r = await ask('default list: no modal', sdkToolToActionRequest({ toolName: 'Write', input: { file_path: path.join(WS, 'a.html'), content: 'x' } }));
  assert.equal(r.approved, true);
  assert.equal(r.modals.length, 0);
  required = ['executeShell', 'openBrowser', 'delegateAgent', 'browserType', 'writeFile'];
  const out = process.env.WRITE_PATHS_CAPTURE;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const norm = (s) => String(s).split(scratch).join('<SCRATCH>');
    fs.writeFileSync(out, captured.map((c) => [`=== ${c.label} → approved=${c.approved}`, ...c.modals.map((m) => `--- ${m.options?.modal ? 'modal' : 'notice'} (buttons: ${m.buttons.join(' | ') || '-'})\n${norm(m.message)}`)].join('\n')).join('\n\n') + '\n');
  }
});

test('approval stays bound across both secret reads and lifecycle cancellation',async()=>{
 const {WriteApprovalRequest}=await import('../src/writeApprovalPrompt.ts');
 const original=host.writeApprovalRequest, originalGet=host.context.secrets.get;
 let scope='one', phase=0, mutate=()=>{}, seen=0;
 host.writeApprovalScope=()=>scope;
 host.context.secrets.get=async()=>{phase++;mutate(phase);return 'same-token'};
 host.writeApprovalRequest=new WriteApprovalRequest({scope:()=>scope,present:async prompt=>{
   if(prompt){seen++;await P.handleMessage.call(host,{type:'writeApprovalAnswer',id:prompt.id,approved:true});}
   return true;
 }},30);
 const run=()=>P.confirmWriteFiles.call(host,'async','title','save',[{display:'a',outside:false,key:'a'}]);
 assert.equal(await run(),true);assert.equal(seen,1);
 phase=0;mutate=n=>{if(n===1)scope='changed-before-dialog'};
 assert.equal(await run(),false);assert.equal(seen,1,'no old request bound to new scope');
 phase=0;mutate=n=>{if(n===2)scope='changed-after-answer'};
 assert.equal(await run(),false,'same token cannot approve a changed task after answer');
 phase=0;mutate=n=>{if(n===1){const old=scope;scope='other';host.writeApprovalRequest.invalidate();scope=old;host.writeApprovalRequest.invalidate();}};
 assert.equal(await run(),false,'switch away and back never revives stale approval');
 phase=0;mutate=n=>{if(n===1)host.writeApprovalRequest.cancel()};
 assert.equal(await run(),false,'terminal/dispose during token read invalidates request');
 phase=0;mutate=n=>{if(n===2)host.writeApprovalRequest.cancel()};
 assert.equal(await run(),false,'terminal/dispose during final token read invalidates approval');
 phase=0;mutate=()=>{};let tokenReads=0;host.context.secrets.get=async()=>++tokenReads===1?'old':'new';
 assert.equal(await run(),false,'account token changed');
 host.writeApprovalRequest=original;host.writeApprovalScope=()=>WS;host.context.secrets.get=originalGet;
});

test('real host presentation requires a visible surface and terminal posts cancel pending approval',async()=>{
 const posted=[];
 const presentation={post:async msg=>{posted.push(msg);return true}};
 const prompt={id:'p',title:'title',verb:'save',files:['a']};
 assert.equal(await P.presentWriteApproval.call(presentation,prompt),false);assert.equal(posted.length,0);
 presentation.view={visible:false};assert.equal(await P.presentWriteApproval.call(presentation,prompt),false);
 presentation.view.visible=true;assert.equal(await P.presentWriteApproval.call(presentation,prompt),true);assert.equal(posted[0].prompt.id,'p');
 presentation.view.visible=false;presentation.editorChat={visible:true};assert.equal(await P.presentWriteApproval.call(presentation,prompt),true);
 presentation.editorChat.visible=false;
 assert.equal(await P.presentWriteApproval.call(presentation,null),true,'closing is delivered even if hidden');
 const {WriteApprovalRequest}=await import('../src/writeApprovalPrompt.ts');
 const request=new WriteApprovalRequest({scope:()=> 'scope',present:async()=>true},30);
 for(const type of ['streamStart','inputRejected','streamEnd','streamStopped','streamError']){
  let ended=false;const pending=request.confirm(prompt).then(value=>{ended=true;return value});
  await P.post.call({context:{},writeApprovalRequest:request},{type});
  assert.equal(ended,true,type+' cancels promptly, without the timeout');
  assert.equal(await pending,false,type+' invalidates approval');
 }
 for(const operation of ['opsRequestStop','invalidateProfile']){
  let ended=false;const pending=request.confirm(prompt).then(value=>{ended=true;return value});
  const lifecycle={writeApprovalRequest:request,activeStreams:new Map(),pendingApprovals:new Map(),profileGeneration:0,endTaskCommandAllows(){},refreshCrBytesContext:async()=>{},refreshSitePublishContext(){},_instructorMode:{reset(){}}};
  P[operation].call(lifecycle);await Promise.resolve();assert.equal(ended,true,operation+' cancels even without a running stream');assert.equal(await pending,false);
 }

});

// ── The SDK gate: the approval covers exactly the listed path ──
const HOME = path.join(scratch, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR', 'HPS_SDK_BINARY']) delete process.env[k];
const { runSdkCoach } = await import('../src/sdkCoach.ts');

async function sdkTurn(probes, onApproval) {
  const approvals = [], decisions = [];
  const sdk = {
    query({ options }) {
      return (async function* () {
        for (const [i, [name, input]] of probes.entries()) {
          decisions.push(await options.canUseTool(name, structuredClone(input), { toolUseID: `w${i}`, signal: new AbortController().signal }));
        }
        yield { type: 'result', subtype: 'success', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
      })();
    },
  };
  const quiet = console.warn; console.warn = () => {};
  try {
    await runSdkCoach({
      gatewayUrl: 'https://api.hypeproof-ai.xyz/v1', token: 'hps-t', model: 'claude-sonnet-5-5', effort: 'medium', turnId: 'turn_w',
      profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } },
      systemPrompt: '', history: [], userText: '저장해 주세요', signal: new AbortController().signal, cwd: WS, stallTimeoutMs: 0,
      binaryResolution: { available: true, source: 'setting', path: '/opt/claude', reasons: [] }, sdk,
      onDelta: () => {}, onActivity: () => {}, onUsage: () => {}, onCitations: () => {}, onAssetScore: () => {},
      requestApproval: async (action) => { approvals.push(structuredClone(action)); await onApproval?.(action, approvals.length); return { approved: true, actor: 'user' }; },
    });
  } finally { console.warn = quiet; }
  return { approvals, decisions };
}

test('SDK: each write asks with its own path; a later write of another path is asked again, never covered', async () => {
  const a = path.join(WS, 'src/app.js'), b = path.join(WS, 'src/other.js');
  const r = await sdkTurn([['Write', { file_path: a, content: '1' }], ['Write', { file_path: b, content: '2' }]]);
  assert.equal(r.approvals.length, 2, 'no remembered write approval');
  assert.deepEqual(r.approvals.map((x) => x.input.file_path), [a, b]);
  assert.deepEqual(r.decisions.map((d) => [d.behavior, d.updatedInput?.file_path]), [['allow', a], ['allow', b]], 'positive control: what was listed is written');
});

test('SDK: a path that changes while the modal is open (a symlink swapped in) is refused, not written', async () => {
  const dir = path.join(WS, 'swap');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'page.html');
  const r = await sdkTurn([['Write', { file_path: target, content: 'x' }]], async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.symlinkSync(OUT, dir, process.platform === 'win32' ? 'junction' : 'dir');
  });
  assert.equal(r.approvals.length, 1);
  assert.equal(r.decisions[0].behavior, 'deny', JSON.stringify(r.decisions[0]));
  assert.match(r.decisions[0].message, /승인한 파일 목록/);
  fs.rmSync(dir, { force: true });
});

test('SDK: the input the approval saw cannot be changed into an unlisted path', async () => {
  const a = path.join(WS, 'listed.html');
  const r = await sdkTurn([['Write', { file_path: a, content: 'x' }]], async (action) => { try { action.input.file_path = path.join(WS, 'unlisted.html'); } catch { /* frozen */ } });
  const d = r.decisions[0];
  assert.ok(d.behavior === 'deny' || d.updatedInput.file_path === a, `the written path is the listed one or nothing: ${JSON.stringify(d)}`);
});

// ── Local runtime: the gate re-resolves the path after the answer ──
test('local runtime: a symlink swapped in during the approval is refused, not written', async () => {
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const dir = path.join(WS, 'lswap');
  fs.mkdirSync(dir, { recursive: true });
  const tools = workspaceTools({
    cwd: WS, profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } }, signal: new AbortController().signal,
    approve: async () => { fs.rmSync(dir, { recursive: true, force: true }); fs.symlinkSync(OUT, dir, process.platform === 'win32' ? 'junction' : 'dir'); return true; },
  });
  await assert.rejects(tools.call('Write', { file_path: 'lswap/x.txt', content: 'x' }), /경로가 바뀌었습니다|작업 폴더 밖/, 'refused either by the post-answer path check or by the re-run containment');
  assert.ok(!fs.existsSync(path.join(OUT, 'x.txt')), 'nothing written outside');
  fs.rmSync(dir, { force: true });
});

// ── Verify round 1: dangling links, the ln policy, `..name`, dedupe, refusal copy ──
const { canonicalWriteTarget } = await import('../src/writeApprovalPaths.ts');
const { canonicalizeExistingPath, resolvePathThroughLinks } = await import('../src/workspaceRouting.ts');
const { evaluateSdkToolUse, isPathContained } = await import('../src/sdkCoachHelpers.ts');
const { linkCommandVerdict } = await import('../src/shellLinkPolicy.ts');
const LINK = process.platform === 'win32' ? 'junction' : 'file';
const freshOut = (name) => { const p = path.join(OUT, name); fs.rmSync(p, { force: true }); return p; };

test('F1: a dangling leaf link is judged by its target in all three normalisers (and a live one stays a control)', async () => {
  const planted = freshOut('planted.txt');
  const link = path.join(WS, 'dangling.txt');
  fs.rmSync(link, { force: true });
  fs.symlinkSync(planted, link, LINK);
  assert.ok(!fs.existsSync(planted), 'the target does not exist: the link dangles');
  // 1. the approval list
  assert.equal(canonicalWriteTarget(link), planted);
  assert.deepEqual(writePathEntries([{ path: link }], WS).map((e) => [e.display, e.outside]), [['작업 폴더 밖 · planted.txt', true]]);
  // 2. the SDK gate's canonicalizer (evaluateSdkToolUse)
  assert.equal(canonicalizeExistingPath(link), planted);
  const v = evaluateSdkToolUse({ toolName: 'Write', input: { file_path: link, content: 'x' }, permittedTools: ['Write'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath });
  assert.equal(v.decision, 'deny', JSON.stringify(v));
  // 3. the local runtime
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const tools = workspaceTools({ cwd: WS, profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } }, signal: new AbortController().signal, approve: async () => true });
  await assert.rejects(tools.call('Write', { file_path: 'dangling.txt', content: 'x' }), /작업 폴더 밖/);
  assert.ok(!fs.existsSync(planted), 'nothing planted outside');
  // positive control: a dangling link to an inside target is inside
  const inLink = path.join(WS, 'inlink.txt');
  fs.rmSync(inLink, { force: true });
  fs.symlinkSync(path.join(WS, 'not-yet.txt'), inLink, LINK);
  assert.deepEqual(writePathEntries([{ path: inLink }], WS).map((e) => [e.display, e.outside]), [['작업 폴더/not-yet.txt', false]]);
  assert.equal(evaluateSdkToolUse({ toolName: 'Write', input: { file_path: inLink, content: 'x' }, permittedTools: ['Write'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath }).decision, 'ask');
  fs.rmSync(link, { force: true }); fs.rmSync(inLink, { force: true });
});

test('F1: a relative dangling link and a link loop are outside / undecidable, never inside', () => {
  const rel = path.join(WS, 'rel.txt');
  fs.rmSync(rel, { force: true });
  fs.symlinkSync('../elsewhere/rel-target.txt', rel, LINK);
  assert.equal(writePathEntries([{ path: rel }], WS)[0].outside, true);
  const a = path.join(WS, 'loopA'), b = path.join(WS, 'loopB');
  for (const p of [a, b]) fs.rmSync(p, { force: true });
  fs.symlinkSync(b, a, LINK); fs.symlinkSync(a, b, LINK);
  assert.equal(resolvePathThroughLinks(a), null, 'a loop cannot be decided');
  assert.equal(writePathEntries([{ path: a }], WS)[0].outside, true, 'undecidable → refused as outside');
  assert.equal(isPathContained(WS, canonicalizeExistingPath(a)), false);
  for (const p of [rel, a, b]) fs.rmSync(p, { force: true });
});

test('F1-C: a dangling link swapped in while the modal is open is refused (SDK and local runtime)', async () => {
  const target = path.join(WS, 'page.html');
  fs.rmSync(target, { force: true });
  const stolen = freshOut('stolen.html');
  const r = await sdkTurn([['Write', { file_path: target, content: 'x' }]], async () => { fs.symlinkSync(stolen, target, LINK); });
  assert.equal(r.decisions[0].behavior, 'deny', JSON.stringify(r.decisions[0]));
  fs.rmSync(target, { force: true });
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const tools = workspaceTools({
    cwd: WS, profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } }, signal: new AbortController().signal,
    approve: async () => { fs.symlinkSync(stolen, target, LINK); return true; },
  });
  await assert.rejects(tools.call('Write', { file_path: 'page.html', content: 'x' }), /경로가 바뀌었습니다|작업 폴더 밖/);
  assert.ok(!fs.existsSync(stolen), 'nothing landed outside');
  fs.rmSync(target, { force: true });
});

test('ln policy: a link to outside is refused, a link created outside asks, an inside link asks too', () => {
  const v = (cmd) => evaluateSdkToolUse({ toolName: 'Bash', input: { command: cmd }, permittedTools: ['Bash'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath });
  for (const cmd of [
    'ln -s ~/Library/LaunchAgents/x.plist page.html', 'ln -sf /etc/hosts a', 'ln -s ../out link', 'ln -s ../elsewhere/x',
    `ln -s ${OUT}/a.txt b.txt`, 'ln /etc/passwd p', 'ln -s "$HOME/x" y', 'ln -s $(pwd)/../x y', 'cd src && ln -s ../../x y',
    'ls && ln -s /etc/hosts h', '/bin/ln -s /etc/hosts h', 'ln -s -- /etc/hosts h', 'ln -t . -s /etc/hosts', 'ln -s link/via.txt v',
  ]) assert.equal(v(cmd).decision, 'deny', cmd);
  assert.match(v('ln -s /etc/hosts h').friendly, /바로가기/);
  // a relative symlink target resolves against the LINK's folder, so `ln -s style.css <out>/a.css` points outside
  assert.equal(v(`ln -s style.css ${OUT}/alias.css`).decision, 'deny');
  for (const cmd of [`ln -s ${WS}/style.css ${OUT}/alias.css`, "sh -c 'ln -s /etc/hosts h'", "bash -c \"ln -s x y\""]) {
    const r = v(cmd);
    assert.deepEqual([r.decision, r.destructive], ['ask', true], cmd);
  }
  // verify 2 F2: an inside link is still a link-making command, so it asks (fail closed); look-alikes run as before
  for (const cmd of ['ln -s style.css alias.css', 'ln -s src/app.js app.js', 'ln -s ../app.js src/alias.js']) {
    assert.deepEqual([v(cmd).decision, v(cmd).destructive], ['ask', true], cmd);
  }
  for (const cmd of ['ls -ln', 'echo kiln', 'ls']) assert.equal(v(cmd).decision, 'allow', cmd);
  assert.equal(linkCommandVerdict('ln -s a b', undefined, (p) => p).decision, 'ask', 'no work folder → strong confirm, never auto');
});

test('F3: a name that starts with .. is inside; a real .. segment is not', () => {
  const inside = writePathEntries([{ path: path.join(WS, '..notes.txt') }, { path: '..notes.txt' }, { path: path.join(WS, 'src', '...x') }], WS);
  assert.deepEqual(inside.map((e) => [e.display, e.outside]), [['작업 폴더/..notes.txt', false], ['작업 폴더/src/...x', false]]);
  assert.equal(isPathContained(WS, path.join(WS, '..notes.txt')), true);
  assert.equal(isPathContained(WS, path.join(WS, '..', 'x')), false, 'negative control');
  assert.equal(evaluateSdkToolUse({ toolName: 'Write', input: { file_path: path.join(WS, '..notes.txt'), content: 'x' }, permittedTools: ['Write'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath }).decision, 'ask');
});

test('F5: two spellings of one file are one line, and the count is of files', () => {
  const alias = path.join(WS, 'app-alias.js');
  fs.rmSync(alias, { force: true });
  fs.symlinkSync(path.join(WS, 'src', 'app.js'), alias, LINK);
  const e = writePathEntries(writeTargetsFromPayload({ paths: ['src/app.js', './src/app.js', path.join(WS, 'src/app.js'), alias, 'b.js'] }), WS);
  assert.deepEqual(e.map((x) => x.display), ['작업 폴더/src/app.js', '작업 폴더/b.js']);
  assert.deepEqual(writeTargetsOf('Write', { file_path: 'a', path: './a' }).length, 2, 'raw targets keep both spellings');
  assert.equal(writePathEntries(writeTargetsOf('Write', { file_path: 'a', path: './a' }), WS).length, 1);
  fs.rmSync(alias, { force: true });
});

test('F4: the refusal names the place once; a solo seat is not told to ask a teacher', async () => {
  const req = { payload: { paths: [{ path: path.join(OUT, 'secret.txt') }] } };
  const classroom = await ask('refusal copy: classroom', req);
  assert.equal(classroom.modals[0].message, '안전을 위해 Studio가 막았어요 — 저장하려는 곳: 작업 폴더 밖 · secret.txt. 궁금하면 선생님께 물어봐 주세요.');
  for (const kind of ['personal', 'trial']) {
    host.cachedProfile = { activity_kind: kind };
    const solo = await ask(`refusal copy: ${kind}`, req);
    assert.match(solo.modals[0].message, /^안전을 위해 Studio가 막았어요 — 저장하려는 곳: 작업 폴더 밖 · secret\.txt\./);
    assert.ok(!solo.modals[0].message.includes('선생님'), solo.modals[0].message);
  }
  delete host.cachedProfile;
  const out = process.env.WRITE_PATHS_CAPTURE;
  if (out) {
    const norm = (s) => String(s).split(scratch).join('<SCRATCH>');
    fs.appendFileSync(out, '\n' + captured.slice(-3).map((c) => [`=== ${c.label} → approved=${c.approved}`, ...c.modals.map((m) => `--- notice\n${norm(m.message)}`)].join('\n')).join('\n\n') + '\n');
  }
});

// ── Verify round 2: `..` after a link, the fail-closed shell floor, folder-name case ──
const writeVia = (p) => { fs.writeFileSync(p, 'kernel'); };
/** Where the kernel actually put a write to `p`: the resolver must say the same. */
function kernelLanding(p, candidates) {
  for (const c of candidates) fs.rmSync(c, { force: true });
  writeVia(p);
  const hit = candidates.filter((c) => fs.existsSync(c) && !fs.lstatSync(c).isSymbolicLink());
  for (const c of hit) fs.rmSync(c, { force: true });
  return hit;
}

test('verify 2 F1: `ln -s . here` + `ln -s here/../out/x page.html` is judged where the kernel writes (outside)', async () => {
  const base = path.dirname(WS);
  const here = path.join(WS, 'here'), page = path.join(WS, 'page2.html');
  for (const p of [here, page]) fs.rmSync(p, { force: true });
  fs.symlinkSync('.', here, LINK);
  fs.symlinkSync('here/../elsewhere/exploit.html', page, LINK);
  const inside = path.join(WS, 'elsewhere', 'exploit.html'), outside = path.join(OUT, 'exploit.html');
  assert.deepEqual(kernelLanding(page, [inside, outside]), [outside], 'ground truth: the kernel writes outside');
  assert.equal(resolvePathThroughLinks(page), outside, 'the resolver agrees with the kernel');
  assert.deepEqual(writePathEntries([{ path: page }], WS).map((e) => [e.display, e.outside]), [['작업 폴더 밖 · exploit.html', true]]);
  assert.equal(evaluateSdkToolUse({ toolName: 'Write', input: { file_path: page, content: 'x' }, permittedTools: ['Write'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath }).decision, 'deny');
  const { workspaceTools } = await import('../src/localRuntime/tools.ts');
  const tools = workspaceTools({ cwd: WS, profile: { profile_id: 'homepage-practice-s1', game: { template_tier: 'website' }, sdk_tools: { read: true, write: true } }, signal: new AbortController().signal, approve: async () => true });
  await assert.rejects(tools.call('Write', { file_path: 'page2.html', content: 'x' }), /작업 폴더 밖/);
  assert.ok(!fs.existsSync(outside));
  // the shell pair that planted them is not auto-allowed
  const v = evaluateSdkToolUse({ toolName: 'Bash', input: { command: 'ln -s . here && ln -s here/../elsewhere/exploit.html page2.html' }, permittedTools: ['Bash'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath });
  assert.notEqual(v.decision, 'allow', JSON.stringify(v));
  for (const p of [here, page]) fs.rmSync(p, { force: true });
});

test('verify 2 F1: an up-link deeper in the tree, absolute and relative targets, and a direct path through it', () => {
  const deep = path.join(WS, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  const up = path.join(deep, 'up');
  fs.rmSync(up, { force: true });
  fs.symlinkSync('../..', up, LINK); // <ws>/a/b/c/up -> <ws>/a
  const cases = [
    ['relative target through the up-link', 'a/b/c/up/../../lex.txt'],
    ['absolute target through the up-link', path.join(WS, 'a/b/c/up/../../lex2.txt')],
  ];
  for (const [label, target] of cases) {
    const link = path.join(WS, `lex-${label.length}`);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(target, link, LINK);
    const name = path.basename(target);
    const where = [path.join(WS, 'a', 'b', name), path.join(WS, name), path.join(path.dirname(WS), name)];
    const landed = kernelLanding(link, where);
    assert.equal(landed.length, 1, label);
    assert.equal(resolvePathThroughLinks(link), landed[0], `${label}: resolver = kernel`);
    fs.rmSync(link, { force: true });
  }
  // a direct write spelled through the up-link: the kernel applies `..` after following `up`
  const direct = path.join(WS, 'a/b/c/up/../../direct.txt');
  const landed = kernelLanding(direct, [path.join(WS, 'a', 'b', 'direct.txt'), path.join(path.dirname(WS), 'direct.txt'), path.join(WS, 'direct.txt')]);
  assert.equal(resolvePathThroughLinks(direct), landed[0]);
  assert.equal(writePathEntries([{ path: direct }], WS)[0].outside, !landed[0].startsWith(WS + path.sep));
  // positive control: a plain `..` with no link before it stays where the text says
  assert.equal(resolvePathThroughLinks(path.join(WS, 'a/b/../x.txt')), path.join(WS, 'a', 'x.txt'));
  fs.rmSync(up, { force: true });
});

test('verify 2 F1: the SDK hands the CLI the resolved path it judged', async () => {
  const sub = path.join(WS, 'inner');
  fs.mkdirSync(sub, { recursive: true });
  const alias = path.join(WS, 'alias-dir');
  fs.rmSync(alias, { force: true });
  fs.symlinkSync(sub, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const r = await sdkTurn([['Write', { file_path: path.join(alias, 'p.html'), content: 'x' }]]);
  assert.equal(r.decisions[0].behavior, 'allow');
  assert.equal(r.decisions[0].updatedInput.file_path, path.join(sub, 'p.html'), 'the CLI writes the resolved spelling');
  const plain = await sdkTurn([['Write', { file_path: path.join(WS, 'plain.html'), content: 'x' }]]);
  assert.equal(plain.decisions[0].updatedInput.file_path, path.join(WS, 'plain.html'), 'unchanged when nothing resolves differently');
  fs.rmSync(alias, { force: true });
});

test('verify 2 F2: ln bypass spellings never auto-run; other link makers and unreadable commands get the strong confirm', () => {
  const v = (cmd) => evaluateSdkToolUse({ toolName: 'Bash', input: { command: cmd }, permittedTools: ['Bash'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath });
  const bypasses = [
    '\\ln -s /etc/hosts a1', "l''n -s /etc/hosts a2", 'l""n -s /etc/hosts a3', '$(which ln) -s /etc/hosts a4', 'ln -s \\/etc/hosts a5',
    "ln -s .''./out/secret a6", 'ln -s .\\./out/secret a7', 'ln -s f.txt ok; if true; then ln -s /etc/hosts a8; fi',
    'ln -s f.txt ok && ! ln -s /etc/hosts a9', 'ln -s f.txt ok; for i in 1; do ln -s /etc/hosts a10; done', 'ln -s f.txt ok; { ln -s /etc/hosts a11; }',
    '`which ln` -s /etc/hosts a12', 'X=1 ln -s /etc/hosts a13', 'nice ln -s /etc/hosts a14',
  ];
  for (const cmd of bypasses) {
    const r = v(cmd);
    assert.ok(r.decision === 'deny' || (r.decision === 'ask' && r.destructive === true), `${cmd}: ${JSON.stringify(r)}`);
  }
  for (const cmd of ['\\ln -s /etc/hosts a1', "l''n -s /etc/hosts a2", 'ln -s \\/etc/hosts a5', "ln -s .''./out/secret a6", 'ln -s f.txt ok; if true; then ln -s /etc/hosts a8; fi']) {
    assert.equal(v(cmd).decision, 'deny', cmd);
  }
  const makers = [
    'link /etc/hosts hl', 'cp -s /etc/hosts x', 'cp -R ../tpl .', 'cp -a src dst', 'rsync -a ../tpl/ .', 'rsync --links a b', 'tar xf t.tar', 'tar -xzf t.tgz',
    'bsdtar -xf t.tar', 'unzip t.zip', 'git clone https://example.com/r.git', 'git checkout main', 'python3 -c "import os; os.symlink(1,2)"',
    'node -e "require(\'fs\').symlinkSync(1,2)"', 'perl -e "symlink 1,2"', "echo 'unterminated",
  ];
  for (const cmd of makers) {
    const r = v(cmd);
    assert.deepEqual([r.decision, r.destructive], ['ask', true], cmd);
  }
  // positive controls: everyday commands without a link maker still auto-run
  for (const cmd of ['ls -ln', 'cp a.txt b.txt', 'cp -i a b', 'git status', 'git log --oneline', 'node app.js', 'python3 app.py', 'curl -sL "https://x.com" | python3 -c "import sys; print(sys.stdin.read())"', 'node -e "console.log(1)"', 'tar -czf out.tgz site', 'echo "it is fine"', 'cat index.html | grep -n title']) {
    assert.equal(v(cmd).decision, 'allow', cmd);
  }
});

test('verify 2 F5: the modal and the SDK gate agree on the work folder name case', () => {
  const upper = path.join(path.dirname(WS), path.basename(WS).toUpperCase());
  if (!fs.existsSync(upper)) return; // case-sensitive volume: the two spellings are different folders
  const file = path.join(upper, 'case.txt');
  const modal = writePathEntries([{ path: file }], WS)[0];
  const sdk = evaluateSdkToolUse({ toolName: 'Write', input: { file_path: file, content: 'x' }, permittedTools: ['Write'], workspaceRoot: WS, canonicalize: canonicalizeExistingPath });
  assert.deepEqual([modal.outside, sdk.decision], [false, 'ask']);
});
