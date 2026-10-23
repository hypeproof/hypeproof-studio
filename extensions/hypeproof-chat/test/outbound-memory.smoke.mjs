// REQ-KNOW-51 (CGP-KNOW-R-033): help, collect, gallery and publish payloads leave memory files out unless the
// learner selects one, and a selected one is named in the REQ-KNOW-09 confirmation. Synthetic request-boundary
// checks against temp folders and a fake Service; never a live publish.
//
// Run: node --experimental-strip-types test/outbound-memory.smoke.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outboundDetails, memoryOutboundPath, dotOutboundPath, privateOutboundPath, MEMORY_SELECTED_LABEL } from '../src/outboundConsent.ts';
import { buildPublishSet, publishSetRefusalText } from '../src/publishSet.ts';
import { PublishSession, MEMORY_VERSION_LINK } from '../src/publishSession.ts';
import { publishWorldConfirmed } from '../src/galleryPublish.ts';
import { uploadSnapshot } from '../src/evidenceSnapshot.ts';
import { readSessionSnapshot, snapshotItems } from '../src/spoolUploader.ts';
import { buildContent } from '../src/classroomHelp.ts';
import { memoryLeftOutNote } from '../src/publish/publishSite.ts';

const ok = (name) => console.log(`✓ ${name}`);
const SCAN = { projectId: 'prj-synthetic', testOrigin: null };

// ── what counts as a memory file ───────────────────────────────────────────
for (const p of ['wiki/index.md', 'wiki', 'WIKI/a.md', 'ｗｉｋｉ/a.md', 'notes/a.md', 'memory/a.json', 'memories/x', 'a/memory/b.md', '.hypeproof/memory/a.json', 'wiki\\a.md', '개인 메모/a.md', 'AI 기억/a.md'])
  assert.equal(memoryOutboundPath(p), true, `memory path: ${p}`);
for (const p of ['index.html', 'wikipedia.html', 'my-notes.md', 'data/menu.json', 'notes.html', 'memo/a.md'])
  assert.equal(memoryOutboundPath(p), false, `not a memory path: ${p}`);
assert.equal(memoryOutboundPath('journal/a.md'), false, 'a configured directory is only memory when configured');
assert.equal(memoryOutboundPath('journal/a.md', ['journal']), true, 'the profile-configured wiki directory is memory');
assert.equal(memoryOutboundPath('learning/journal/a.md', ['learning/journal']), true, 'a nested configured directory');
assert.equal(memoryOutboundPath('learning/other.md', ['learning/journal']), false);
assert.equal(memoryOutboundPath('site/journal/a.md', ['journal']), true, 'a configured directory name nested under another folder is memory too');
assert.equal(memoryOutboundPath('journal/a.md', ['./journal/']), true, 'a configured directory written as ./journal/');
assert.equal(memoryOutboundPath('./wiki/a.md'), true);
for (const p of ['wiki./a.md', 'wiki /a.md', 'notes../x']) assert.equal(memoryOutboundPath(p), true, `Windows trailing dot/space: ${p}`);
assert.equal(memoryOutboundPath('wiki.md'), false, 'only a trailing dot or space is dropped');
assert.equal(dotOutboundPath('.env'), true); assert.equal(dotOutboundPath('ａ/．env'), true, 'NFKC dot'); assert.equal(dotOutboundPath('wiki/a.md'), false);
assert.equal(privateOutboundPath('wiki/a.md'), true); assert.equal(privateOutboundPath('.git/config'), true); assert.equal(privateOutboundPath('index.html'), false);
ok('memory paths: team-brain wiki, notes, memory stores, configured directory; NFKC, case and backslash');

// ── the REQ-KNOW-09 dialog fails closed on an unselected memory item ─────────
assert.equal(outboundDetails({ recipient: 'x', items: [{ name: 'index.html', bytes: 1 }, { name: 'wiki/a.md', bytes: 2 }] }), null, 'an unselected memory file refuses the dialog');
assert.equal(outboundDetails({ recipient: 'x', items: [{ name: 'index.html', bytes: 1 }], also: [{ recipient: 'y', items: [{ name: 'memory/a.json', bytes: 2 }] }] }), null, 'also in a second block');
assert.equal(MEMORY_SELECTED_LABEL, 'AI 기억 파일 · 내가 직접 고름');
assert.equal(outboundDetails({ recipient: '사용자 테스트 · s', public: true, items: [{ name: 'index.html', bytes: 3 }, { name: 'wiki/a.md', bytes: 1234, memory: true }] }),
  ['받는 곳: 사용자 테스트 · s', '누구나 볼 수 있어요', '보낼 항목:', '• index.html (3 바이트)', '• wiki/a.md (1,234 바이트) · AI 기억 파일 · 내가 직접 고름', '받는 사람의 AI 기억: 확인 안 됨', '', '포함하지 않는 것: AI 기억, 개인 메모'].join('\n'),
  'a selected memory file is listed with its size and the selection label');
ok('confirmation: unselected memory item → no dialog; selected one → labelled line');

const root = mkdtempSync(join(tmpdir(), 'hps-outbound-memory-'));
try {
  mkdirSync(join(root, 'wiki')); mkdirSync(join(root, 'journal')); mkdirSync(join(root, '.hypeproof/memory'), { recursive: true });
  writeFileSync(join(root, 'wiki/index.md'), '# 팀 브레인\n우리 팀 기억');
  writeFileSync(join(root, 'journal/today.md'), '오늘 메모');
  writeFileSync(join(root, '.hypeproof/memory/a.json'), '{}');
  writeFileSync(join(root, 'style.css'), 'p{}');
  writeFileSync(join(root, 'index.html'), '<link rel="stylesheet" href="style.css"><p>page</p>');

  // ── publish set: default has no memory path; a selection adds exactly that path ──
  const base = await buildPublishSet(root, '/index.html', [], SCAN, ['journal']);
  assert.equal(base.ok, true);
  assert.deepEqual(base.set.files.map(f => f.path), ['index.html', 'style.css']);
  assert.deepEqual(base.set.memory, []);
  const picked = await buildPublishSet(root, '/index.html', ['wiki/index.md'], SCAN, ['journal']);
  assert.equal(picked.ok, true, 'a memory file the learner typed in is allowed');
  const diff = picked.set.files.map(f => f.path).filter(p => !base.set.files.some(b => b.path === p));
  assert.deepEqual(diff, ['wiki/index.md'], 'manifest diff: exactly the selected memory path');
  assert.deepEqual(picked.set.memory, ['wiki/index.md']); assert.deepEqual(picked.set.manifest_added, ['wiki/index.md']);
  const configured = await buildPublishSet(root, '/index.html', ['journal/today.md'], SCAN, ['journal']);
  assert.equal(configured.ok, true); assert.deepEqual(configured.set.memory, ['journal/today.md'], 'the configured wiki directory is labelled too');
  const dot = await buildPublishSet(root, '/index.html', ['.hypeproof/memory/a.json'], SCAN, []);
  assert.equal(dot.ok, false); assert.equal(dot.refusal.code, 'excluded_path', 'a dot-path memory store can never be selected');
  ok('publish set: no memory path by default; a typed-in selection adds exactly it');

  // A page that reaches a memory file is refused unless the learner also selected that file.
  writeFileSync(join(root, 'index.html'), '<link rel="stylesheet" href="style.css"><a href="wiki/index.md">기억</a><p>page</p>');
  const reached = await buildPublishSet(root, '/index.html', [], SCAN, []);
  assert.equal(reached.ok, false); assert.deepEqual(reached.refusal, { code: 'memory_not_selected', file: 'wiki/index.md' });
  assert.equal(publishSetRefusalText(reached.refusal), "wiki/index.md: AI 기억 파일이라 기본으로 빼 두었어요. 공개하려면 '파일 추가'에 이 경로를 직접 넣거나, 페이지에서 이 파일 연결을 지워 주세요.");
  const reachedPicked = await buildPublishSet(root, '/index.html', ['wiki/index.md'], SCAN, []);
  assert.equal(reachedPicked.ok, true); assert.deepEqual(reachedPicked.set.memory, ['wiki/index.md']);
  assert.deepEqual(reachedPicked.set.manifest_added, [], 'a reached file is not sent to the Service as a manifest addition');
  writeFileSync(join(root, 'index.html'), '<a href="journal/today.md">메모</a>');
  const reachedConfigured = await buildPublishSet(root, '/index.html', [], SCAN, ['journal']);
  assert.deepEqual(reachedConfigured.ok ? null : reachedConfigured.refusal, { code: 'memory_not_selected', file: 'journal/today.md' }, 'a link into the configured wiki directory refuses too');
  writeFileSync(join(root, 'index.html'), '<script src=".hypeproof/memory/a.json"></script>');
  const reachedDot = await buildPublishSet(root, '/index.html', [], SCAN, []);
  assert.equal(reachedDot.ok, true); assert.ok(!reachedDot.set.files.some(f => f.path.includes('hypeproof')), 'a link into a dot-directory store is never part of the set');
  // A full-width dot (U+FF0E) slips past the raw walk; NFKC makes it a dot path, refused whether linked or typed in.
  mkdirSync(join(root, '\uff0esecret')); writeFileSync(join(root, '\uff0esecret/a.json'), '{}');
  writeFileSync(join(root, 'index.html'), '<script src="\uff0esecret/a.json"></script>');
  const wide = await buildPublishSet(root, '/index.html', [], SCAN, []);
  assert.equal(wide.ok, false); assert.deepEqual(wide.refusal, { code: 'excluded_path', file: '\uff0esecret/a.json' });
  writeFileSync(join(root, 'index.html'), '<p>page</p>');
  const wideTyped = await buildPublishSet(root, '/index.html', ['\uff0esecret/a.json'], SCAN, []);
  assert.equal(wideTyped.ok, false); assert.equal(wideTyped.refusal.code, 'excluded_path', 'a typed-in look-alike dot path is not a selection');
  writeFileSync(join(root, 'index.html'), '<link rel="stylesheet" href="style.css"><a href="wiki/index.md">기억</a><p>page</p>');
  const caseOnly = await buildPublishSet(root, '/index.html', ['WIKI/index.md'], SCAN, []);
  assert.equal(caseOnly.ok, false, 'selection is the exact path, not a look-alike');
  ok('publish set: a page link to a memory file refuses until that exact path is selected');
  // A leading slash typed into 파일 추가 is the same selection as the bare path.
  const slashPicked = await buildPublishSet(root, '/index.html', ['/wiki/index.md'], SCAN, []);
  assert.equal(slashPicked.ok, true, 'a typed /wiki/index.md selects the reached wiki/index.md'); assert.deepEqual(slashPicked.set.memory, ['wiki/index.md']);
  ok('publish set: a typed leading slash selects the same memory file');

  // A symlinked directory aliases a memory store under an ordinary name (verify p2): refused, never sent unlabelled.
  const alias = mkdtempSync(join(tmpdir(), 'hps-outbound-alias-'));
  try {
    mkdirSync(join(alias, '.hypeproof/memory'), { recursive: true }); writeFileSync(join(alias, '.hypeproof/memory/a.json'), '{"secret":1}');
    mkdirSync(join(alias, 'journal')); writeFileSync(join(alias, 'journal/today.md'), 'diary');
    mkdirSync(join(alias, 'wiki')); writeFileSync(join(alias, 'wiki/index.md'), '# 기억');
    symlinkSync('.hypeproof/memory', join(alias, 'data')); symlinkSync('journal', join(alias, 'docs')); symlinkSync(join(alias, 'wiki'), join(alias, 'assets'));
    writeFileSync(join(alias, 'index.html'), '<script src="data/a.json"></script><a href="docs/today.md">d</a>');
    const both = await buildPublishSet(alias, '/index.html', [], SCAN, ['journal']);
    assert.deepEqual(both.ok ? both.set.files.map(f => f.path) : both.refusal, { code: 'symlinked_directory', file: 'data/a.json' }, 'data -> .hypeproof/memory: refused');
    assert.equal(publishSetRefusalText(both.refusal), 'data/a.json: 바로가기(심볼릭 링크) 폴더를 거쳐 닿는 파일이라 공개하지 않았어요. 진짜 폴더 안의 파일을 연결해 주세요.');
    for (const [html, file] of [['<a href="docs/today.md">d</a>', 'docs/today.md'], ['<a href="assets/index.md">w</a>', 'assets/index.md']]) {
      writeFileSync(join(alias, 'index.html'), html);
      const r = await buildPublishSet(alias, '/index.html', [], SCAN, ['journal']);
      assert.deepEqual(r.ok ? r.set.files.map(f => f.path) : r.refusal, { code: 'symlinked_directory', file }, `${file}: a link through a symlinked directory is refused`);
      const typed = await buildPublishSet(alias, '/index.html', [file], SCAN, ['journal']);
      assert.deepEqual(typed.ok ? typed.set.files.map(f => f.path) : typed.refusal, { code: 'symlinked_directory', file }, `${file}: typing the alias is not a selection`);
    }
    mkdirSync(join(alias, 'journal/day')); writeFileSync(join(alias, 'journal/day/x.md'), 'deep diary'); symlinkSync('journal', join(alias, 'kb'));
    writeFileSync(join(alias, 'index.html'), '<a href="kb/day/x.md">x</a>');
    const deep = await buildPublishSet(alias, '/index.html', [], SCAN, ['journal']);
    assert.deepEqual(deep.ok ? deep.set.files.map(f => f.path) : deep.refusal, { code: 'symlinked_directory', file: 'kb/day/x.md' }, 'a symlink two folders up is refused too');
    writeFileSync(join(alias, 'index.html'), '<p>page</p>');
    const typedOnly = await buildPublishSet(alias, '/index.html', ['data/a.json'], SCAN, []);
    assert.deepEqual(typedOnly.ok ? typedOnly.set.files.map(f => f.path) : typedOnly.refusal, { code: 'symlinked_directory', file: 'data/a.json' }, 'a typed alias path is refused');
    const real = await buildPublishSet(alias, '/index.html', ['journal/today.md'], SCAN, ['journal']);
    assert.equal(real.ok, true, 'the real path is still selectable'); assert.deepEqual(real.set.memory, ['journal/today.md']);
  } finally { rmSync(alias, { recursive: true, force: true }); }
  ok('publish set: a file reached through a symlinked directory is refused, linked or typed');

  // ── PublishSession: the confirmation names the selected memory file; the PUT carries it only then ──
  writeFileSync(join(root, 'index.html'), '<link rel="stylesheet" href="style.css"><p>page</p>');
  const project = { id: 'prj-synthetic', title: 'project', members: ['synthetic'] };
  const state = { project, test_origin: null, versions: [], hypotheses: [], experiments: [], links: [] };
  let shown = [], calls = [], answer = true;
  const ports = { previewVisitor:async()=>true, switchOn: () => true, scopeKey: () => 'one', confirmOutbound: async m => { shown.push(m); return answer; }, token: async () => 't', base: () => 'https://service.invalid/v1/curriculum', root: () => root, entry: () => '/index.html', events: async () => [], projectId: () => project.id, setProjectId: async () => {}, week: () => 1, defaultTitle: () => 'title', qr: u => u, privateDirectories: () => ['journal'],
    fetchImpl: async (u, i) => { calls.push([u, i]); if ((i?.method ?? 'GET') !== 'GET') return Response.json(new URL(u).pathname.endsWith('/experiments') ? { experiment: { id: 'exp-synthetic' } } : new URL(u).pathname.includes('/versions/') ? { version: { id: 'v' }, created: true } : { share_url: 'https://test.invalid/l/1' }); return Response.json(new URL(u).pathname.endsWith('/projects') ? { projects: [project] } : state); } };
  const form = { question: 'q', method: 'task_test', success_criteria: ['c'], hypothesis: 'h', expires_in_days: 1 };
  const putFiles = () => JSON.parse(calls.find(([u, i]) => i?.method === 'PUT' && u.includes('/versions/'))[1].body).files.map(f => f.path);
  const pub = new PublishSession(ports);
  assert.equal((await pub.submit({ ...form })).ok, true);
  assert.ok(shown[0].items.every(i => !memoryOutboundPath(i.name, ['journal']) && i.memory === undefined), 'default confirmation lists no memory file');
  assert.ok(outboundDetails(shown[0]), 'default dialog renders');
  assert.deepEqual(putFiles(), ['index.html', 'style.css'], 'default upload: no memory path');
  shown = []; calls = [];
  assert.equal((await pub.submit({ ...form, manifest: ['wiki/index.md'] })).ok, true);
  assert.deepEqual(shown[0].items.find(i => i.name === 'wiki/index.md'), { name: 'wiki/index.md', bytes: Buffer.byteLength('# 팀 브레인\n우리 팀 기억'), memory: true }, 'selected memory file: flagged item with its bytes');
  assert.ok(outboundDetails(shown[0]).includes(`• wiki/index.md (${Buffer.byteLength('# 팀 브레인\n우리 팀 기억')} 바이트) · AI 기억 파일 · 내가 직접 고름`));
  assert.ok(shown[0].items.filter(i => i.name !== 'wiki/index.md').every(i => i.memory === undefined), 'only the selected file carries the label');
  assert.deepEqual(putFiles(), ['index.html', 'style.css', 'wiki/index.md'], 'selected: the upload adds exactly that path');
  shown = []; calls = []; answer = false;
  assert.equal((await pub.submit({ ...form, manifest: ['wiki/index.md'] })).ok, false);
  assert.ok(!calls.some(([, i]) => /^(POST|PUT|PATCH|DELETE)$/.test(i?.method ?? 'GET')), 'Cancel: nothing sent');
  answer = true;
  // A page link to the memory file with no selection: refused before the dialog, nothing sent.
  writeFileSync(join(root, 'index.html'), '<a href="wiki/index.md">기억</a>');
  shown = []; calls = [];
  const refused = await pub.submit({ ...form, manifest: [] });
  assert.equal(refused.ok, false); assert.ok(refused.message.includes('AI 기억 파일이라 기본으로 빼 두었어요'));
  assert.equal(shown.length, 0); assert.ok(!calls.some(([, i]) => /^(POST|PUT|PATCH|DELETE)$/.test(i?.method ?? 'GET')));
  // The session passes the profile's configured wiki directory: a page link into journal/ refuses, a selection is labelled.
  writeFileSync(join(root, 'index.html'), '<a href="journal/today.md">메모</a>');
  shown = []; calls = [];
  const journalRefused = await pub.submit({ ...form, manifest: [] });
  assert.equal(journalRefused.ok, false, 'configured wiki directory reached, not selected: refused'); assert.ok(journalRefused.message.startsWith('journal/today.md: AI 기억 파일이라'));
  assert.equal(shown.length, 0); assert.ok(!calls.some(([, i]) => /^(POST|PUT|PATCH|DELETE)$/.test(i?.method ?? 'GET')));
  shown = []; calls = [];
  assert.equal((await pub.submit({ ...form, manifest: ['journal/today.md'] })).ok, true);
  assert.deepEqual(shown[0].items.find(i => i.name === 'journal/today.md'), { name: 'journal/today.md', bytes: Buffer.byteLength('오늘 메모'), memory: true }, 'configured-directory selection is labelled');
  writeFileSync(join(root, 'index.html'), '<a href="wiki/index.md">기억</a>');
  // The panel re-posts the view's manifest on submit: a reached-and-selected memory file must survive that round trip.
  pub.setManifest(['wiki/index.md']);
  const view = await pub.view();
  assert.equal(view.version.refusal, null); assert.deepEqual(view.version.manifest_added, ['wiki/index.md'], 'the panel keeps showing the selection');
  shown = []; calls = [];
  assert.equal((await pub.submit({ ...form, manifest: view.version.manifest_added })).ok, true);
  assert.ok(shown[0].items.some(i => i.name === 'wiki/index.md' && i.memory === true));
  // D1: a selection typed in one activity is not a selection in another.
  let activity = 'one'; ports.scopeKey = () => activity;
  pub.setManifest(['wiki/index.md']); activity = 'two';
  shown = []; calls = [];
  const other = await pub.submit({ ...form });
  assert.equal(other.ok, false, 'another activity: the old selection is gone, so the link to the memory file refuses');
  assert.equal(shown.length, 0); assert.ok(!calls.some(([, i]) => /^(POST|PUT|PATCH|DELETE)$/.test(i?.method ?? 'GET')));
  assert.deepEqual((await pub.view()).version.manifest_added, [], 'the panel shows no carried-over selection');
  activity = 'one';
  // D2: a stored version holding a memory file gets no new share link, and the learner is told why.
  state.versions = [{ id: 'vm', files: [{ path: 'index.html', bytes: 1, sha256: 'a' }, { path: 'journal/today.md', bytes: 1, sha256: 'b' }] }]; state.experiments = [{ id: 'exp-m', product_version_id: 'vm' }];
  shown = []; calls = [];
  const linked = await pub.link('exp-m', { expires_in_days: 1 });
  assert.deepEqual(linked, { ok: false, message: MEMORY_VERSION_LINK }); assert.equal(shown.length, 0);
  assert.ok(!calls.some(([, i]) => /^(POST|PUT|PATCH|DELETE)$/.test(i?.method ?? 'GET')));
  assert.equal(MEMORY_VERSION_LINK, 'AI 기억 파일이 들어 있는 버전이라 새 링크를 만들지 않아요. 다시 공개하면 보낼 파일을 확인한 뒤 링크를 받을 수 있어요.');
  ok('test-version publish: confirmation and upload carry a memory file only when selected');

  // ── gallery, collect, help: fixed payloads, never a memory path ─────────────
  let galleryShown;
  await publishWorldConfirmed({ previewVisitor:async()=>true, siteBase: 'https://gallery.invalid', token: 't', worldId: 'w', title: '작품', html: '<p>x</p>', fetchImpl: async () => Response.json({ ok: true, url: '/w/1' }) }, async m => (galleryShown = m, false), async () => true,
    { recipient: '수업 기록 운영자 · api.invalid', items: [{ name: '이번 활동 기록 events.jsonl', bytes: 1 }], send: async () => {} });
  for (const i of [...galleryShown.items, ...galleryShown.also.flatMap(s => s.items)]) assert.equal(memoryOutboundPath(i.name), false, `gallery item ${i.name}`);
  assert.ok(outboundDetails(galleryShown));
  const spool = join(root, 'spool'); mkdirSync(spool); writeFileSync(join(spool, 'events.jsonl'), '{}\n'); writeFileSync(join(spool, 'session.meta.json'), '{}');
  writeFileSync(join(spool, 'memory.json'), 'not a spool file'); mkdirSync(join(spool, 'wiki')); writeFileSync(join(spool, 'wiki/a.md'), 'x');
  const snap = readSessionSnapshot({ dir: spool, day: '2026-10-21', sessionId: 's' });
  assert.deepEqual(snapshotItems(snap.entries).map(i => i.name).sort(), ['events.jsonl', 'session.meta.json'], 'session record: allowlisted spool files only');
  let collectShown; const scope = { grant_id: 'g', class_run_id: 'r', seat_id: 's', student: { u: 'u', c: 'c', p: 'p' }, activity: null, run: { starts_at: 0, ends_at: 999999 } };
  await uploadSnapshot('batch', { scope: () => scope, copy: async () => ({ binding: {}, files: [{ name: 'session.meta.json', data: new Uint8Array([1]) }, { name: 'events.jsonl', data: new Uint8Array([2]) }, { name: 'wiki/a.md', data: new Uint8Array([3]) }] }), loadState: async () => null, saveState: async () => {}, put: async () => ({ status: 200 }), seal: async () => ({ status: 200 }), confirm: async m => (collectShown = m, false) });
  assert.deepEqual(collectShown.map(i => i.name), ['session.meta.json', 'events.jsonl', 'manifest.json'], 'collect: the binding\'s files only, a stray memory file is not listed');
  const help = buildContent('도와주세요', { prompt: '질문', response: '답' });
  assert.deepEqual(Object.keys(help.content).sort(), ['prompt', 'question', 'response'], 'help sends typed text and a picked turn only, no file field');
  ok('gallery, collect and help payloads carry no memory path');

  // ── site publish: the confirmation names what stayed behind ────────────────
  assert.equal(memoryLeftOutNote(['wiki']), 'AI 기억 파일은 올리지 않아요: wiki');
  assert.equal(memoryLeftOutNote(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'AI 기억 파일은 올리지 않아요: a, b, c, d, e 외 2개');
  ok('site publish note text');
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('\n✓ outbound-memory smoke 통과');
