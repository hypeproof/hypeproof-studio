// #2832: real main.tsx -> StartPage -> PersonalSpace/PersonalRecords in Chromium.
// Host-state fixture only: DOM/intents/escaping/geometry, not Service or native VS Code.
// Service/controller HTTP and actual UI->Service seam are separate revision-bound artifacts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findChromium, launch } from './lib/headless-chromium.mjs';
import { THEMES } from './lib/vscode-default-themes.mjs';
import { syntheticRecord, canonicalRecord, recordHash, fixtureText } from '../src/personalRecordFixture.ts';

const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER) throw Error('personal-records: Chromium required'); console.log('NOT RUN personal-records browser: no Chromium'); process.exit(0); }
const webview = fileURLToPath(new URL('../webview-ui/', import.meta.url));
const bundle = await build({ entryPoints: [webview + 'src/main.tsx'], bundle: true, platform: 'browser', format: 'iife', outdir: 'assets', write: false,
  loader: { '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl' }, logLevel: 'error' });
const script = bundle.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script'), css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
const fixture = syntheticRecord(true), digest = recordHash(canonicalRecord(fixture.manifest));
const workspace = { id: 'w1', kind: 'personal', name: '개인 공간', owner_account_id: 'alice', created_at: 1 }, project = { id: 'p1', workspace_id: 'w1', title: '선택한 개인 프로젝트', revision: 1, created_at: 1, updated_at: 1 };
const base = { checking: false, version: 'synthetic', account: { status: 'signedIn', account: { id: 'alice', email: 'alice@synthetic.invalid', display_name: '합성 계정' }, passes: [] }, personalSpace: { opened: true, loaded: true, workspace, projects: [project], selected: project } };
const view = { enabled: true, projectId: 'p1', records: [] };
const preview = { nonce: 'review-browser', digest, account: 'alice@synthetic.invalid', service: 'http://localhost:8793/v1', destination: project.title, manifest: fixture.manifest, files: fixture.manifest.artifacts.map(f => ({ ...f, text: fixtureText })) };
const evidence = process.env.PERSONAL_RECORD_EVIDENCE; if (evidence) mkdirSync(evidence, { recursive: true });
const b = await launch(bin), pause = () => new Promise(r => setTimeout(r, 80));
const send = async state => { await b.evaluate(`window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify({ type: 'startState', state })}}))`); await pause(); };
const posts = () => b.evaluate('window.__posted.splice(0)');
const press = async text => { await b.evaluate(`(()=>{const b=[...document.querySelectorAll('.studio-records button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('missing record button');b.click()})()`); await pause(); };
let cases = 0;
try {
  for (const dark of [true, false]) for (const width of [360, 900]) {
    const vars = Object.entries(THEMES[dark ? 'Dark+' : 'Light+']).filter(([k, v]) => typeof v === 'string' && !['kind', 'file'].includes(k)).map(([k, v]) => `--vscode-${k.replaceAll('.', '-')}:${v}`).join(';');
    await b.load(`<html data-surface="start" style="${vars}"><style>${css}</style><body class="${dark ? 'vscode-dark' : 'vscode-light'}"><div id="root"></div><script>window.__posted=[];window.acquireVsCodeApi=()=>({postMessage:m=>__posted.push(m),getState:()=>undefined,setState:()=>{}});</script><script>${script}</script></body></html>`, { width, height: 1000, dark });
    await pause(); assert.ok((await posts()).some(m => m.type === 'startReady'));
    await send(base); assert.equal(await b.evaluate(`!!document.querySelector('.studio-records')`), false, 'no prototype without host admission');
    await send({ ...base, personalRecords: view });
    await b.evaluate(`document.querySelector('.studio-record-file input').click()`); await pause();
    await press('합성 기록 검토'); assert.deepEqual(await posts(), [{ type: 'personalRecordPrepare', accountId: 'alice', projectId: 'p1', includeFile: true }]);
    await send({ ...base, personalRecords: { ...view, preview } });
    const geometry = await b.evaluate(`(()=>{const s=document.querySelector('.studio-records');s.scrollIntoView({block:'start'});return {overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:[...s.querySelectorAll('button,summary,.studio-record-file')].map(e=>({text:e.textContent,h:e.getBoundingClientRect().height})),content:s.textContent,script:s.querySelectorAll('script,iframe').length}})()`);
    assert.equal(geometry.overflow, false, `page overflow ${width}/${dark}`); assert.ok(geometry.buttons.every(b => b.h >= 44), JSON.stringify(geometry.buttons));
    assert.ok(geometry.content.includes(preview.service)); assert.ok(geometry.content.includes(fixtureText)); assert.equal(geometry.script, 0); assert.deepEqual(await posts(), []);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/preview-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
    await press('검토한 합성 기록 저장'); assert.deepEqual(await posts(), [{ type: 'personalRecordSave', accountId: 'alice', projectId: 'p1', nonce: preview.nonce, digest }]);
    await send({ ...base, personalRecords: { ...view, preview, busy: true } }); await press('검토한 합성 기록 저장'); assert.deepEqual(await posts(), [], 'busy intent cannot duplicate confirmation');
    await send({ ...base, personalRecords: { ...view, pending: { mutation_id: 'same-key', digest, title: fixture.manifest.title } } }); await press('같은 기록 저장 다시 시도'); assert.deepEqual(await posts(), [{ type: 'personalRecordRetry', accountId: 'alice', projectId: 'p1' }]);
    await send({ ...base, personalRecords: { ...view, loaded: true } }); assert.match(await b.evaluate(`document.querySelector('.studio-records').textContent`), /저장된 합성 기록이 없어요/);
    const normal = { id: 'rec1', workspace_id: 'w1', project_id: 'p1', revision: 1, state: 'complete', created_at: 1, completed_at: 2, manifest: fixture.manifest, manifest_sha256: digest, artifacts: fixture.manifest.artifacts.map(f => ({ ...f, id: 'file1' })) };
    await send({ ...base, personalRecords: { ...view, records: [normal], selected: normal } });
    await b.evaluate(`document.querySelector('[aria-label="저장된 합성 기록 읽기"]').scrollIntoView({block:'start'})`);
    if (evidence) { const shot = await b.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${evidence}/reader-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data, 'base64')); }
    const stored = structuredClone(fixture.manifest); stored.messages[1].content = '<script>window.__recordExecuted=true</script><img src=x onerror="window.__recordExecuted=true">';
    const record = { id: 'rec1', workspace_id: 'w1', project_id: 'p1', revision: 1, state: 'complete', created_at: 1, completed_at: 2, manifest: stored, manifest_sha256: recordHash(canonicalRecord(stored)), artifacts: stored.artifacts.map(f => ({ ...f, id: 'file1' })) };
    await send({ ...base, personalRecords: { ...view, records: [record], selected: record } });
    assert.equal(await b.evaluate(`!!window.__recordExecuted || !!document.querySelector('.studio-records script,.studio-records img,.studio-records iframe')`), false, 'stored markup cannot execute');
    await press('확인 후 파일 사본 저장'); assert.deepEqual(await posts(), [{ type: 'personalRecordDownload', accountId: 'alice', projectId: 'p1', artifactId: 'file1' }]);
    await send({ ...base, personalRecords: { ...view, authenticationRequired: true, failed: true, message: '로그인을 확인해 주세요.' } });
    assert.equal(await b.evaluate(`document.querySelector('[aria-label="저장된 합성 기록 읽기"]') !== null`), false);
    await send({ ...base, account: { status: 'signedOut' } }); assert.equal(await b.evaluate(`!!document.querySelector('.studio-records')`), false);
    cases++; console.log(`PASS actual StartPage DOM fixture ${width}/${dark ? 'dark' : 'light'}: explicit file/preview/save/retry/download,44px,nooverflow,HTMLescaped,privateviewcleared`);
  }
  console.log(`PASS personal records browser ${cases} presentation fixtures; actualcontroller/API and nativeVSCode evidence separate`);
} finally { await b.close(); }
