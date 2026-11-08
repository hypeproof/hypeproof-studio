// REQ-STUDIO-MEMORY-WRITE-LINE (CGP-KNOW-R-027 / REQ-KNOW-45, CGP-KNOW-D-027) — a memory write a turn makes leaves a
// receipt, and undo reverts exactly that write on real files:
//   1. an added item is removed by undo; a second press is a refusal;
//   2. a changed item gets its prior file back byte for byte, and the new one goes;
//   3. a file changed after the write is never touched: undo refuses and the learner's edit stays;
//   4. a prior name taken again blocks the restore and leaves both files alone;
//   5. other files in the store are never touched, and the label words match the design.
//   node --experimental-strip-types test/memory-write-line.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ActivityMemory, personalMemoryActivity } from '../src/activityMemory.ts';
import { MemoryWriteLedger } from '../src/memoryWrite.ts';
import { MEMORY_WRITE_COPY, isMemoryWriteId, memoryWriteLabel, memoryWriteLineView } from '../src/memoryWriteLine.ts';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-write-line-')));
let passed = 0;
let n = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const fresh = () => { const dir = path.join(top, `a${++n}`); fs.mkdirSync(dir); return dir; };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => (fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : []);
const put = (root, name, text) => { fs.mkdirSync(memDir(root), { recursive: true }); fs.writeFileSync(path.join(memDir(root), name), text); };
const ledgerFor = root => { let i = 0; return new MemoryWriteLedger(new ActivityMemory(root), () => `t${++i}`); };

await t('an added item makes a receipt and undo removes exactly that file', async () => {
  const root = fresh();
  put(root, 'keep.md', '남겨 둘 기억\n');
  const ledger = ledgerFor(root);
  const receipt = await ledger.write('좋아하는 색은 초록이에요.', { task: 'task-1' });
  assert.ok(isMemoryWriteId(receipt.id));
  assert.equal(receipt.item, '좋아하는 색은 초록이에요.');
  assert.deepEqual(files(root), ['keep.md', receipt.name].sort());
  const undone = await ledger.undo(receipt.id);
  assert.deepEqual(undone, { ok: true, kind: 'undone', item: receipt.item });
  assert.deepEqual(files(root), ['keep.md']);
  assert.equal(fs.readFileSync(path.join(memDir(root), 'keep.md'), 'utf8'), '남겨 둘 기억\n');
  assert.deepEqual(await ledger.undo(receipt.id), { ok: false, reason: 'unknown' });
});

await t('a changed item: undo puts the prior file back byte for byte and removes the new one', async () => {
  const root = fresh();
  const original = '<!-- hypeproof-task: task-9 -->\n이전 기억 그대로\n';
  put(root, 'old-item.md', original);
  const ledger = ledgerFor(root);
  const receipt = await ledger.write('바뀐 기억', { task: 'task-9', replacing: 'old-item.md' });
  assert.equal(receipt.replaced, 'old-item.md');
  assert.ok(!files(root).includes('old-item.md'));
  assert.equal(files(root).length, 1);
  const undone = await ledger.undo(receipt.id);
  assert.equal(undone.ok && undone.kind, 'restored');
  assert.deepEqual(files(root), ['old-item.md']);
  assert.equal(fs.readFileSync(path.join(memDir(root), 'old-item.md'), 'utf8'), original);
});

await t('a file changed after the write is refused and left as the learner has it', async () => {
  const root = fresh();
  const ledger = ledgerFor(root);
  const receipt = await ledger.write('원래 쓴 기억');
  const file = path.join(memDir(root), receipt.name);
  fs.writeFileSync(file, '학생이 직접 고친 기억\n');
  assert.deepEqual(await ledger.undo(receipt.id), { ok: false, reason: 'changed' });
  assert.equal(fs.readFileSync(file, 'utf8'), '학생이 직접 고친 기억\n');
  // The learner deleted it already: also a calm refusal, nothing else is touched.
  fs.unlinkSync(file);
  put(root, 'other.md', '다른 기억\n');
  assert.deepEqual(await ledger.undo(receipt.id), { ok: false, reason: 'changed' });
  assert.deepEqual(files(root), ['other.md']);
});

await t('a prior name taken again blocks the restore and leaves both files alone', async () => {
  const root = fresh();
  put(root, 'old-item.md', '이전\n');
  const ledger = ledgerFor(root);
  const receipt = await ledger.write('바뀐 기억', { replacing: 'old-item.md' });
  put(root, 'old-item.md', '그 사이 새로 생긴 파일\n');
  assert.deepEqual(await ledger.undo(receipt.id), { ok: false, reason: 'changed' });
  assert.equal(fs.readFileSync(path.join(memDir(root), 'old-item.md'), 'utf8'), '그 사이 새로 생긴 파일\n');
  assert.ok(files(root).includes(receipt.name));
});

await t('an id the ledger did not issue is unknown and touches nothing', async () => {
  const root = fresh();
  put(root, 'a.md', '기억\n');
  const ledger = ledgerFor(root);
  assert.deepEqual(await ledger.undo('memwrite-nope'), { ok: false, reason: 'unknown' });
  assert.deepEqual(files(root), ['a.md']);
});

await t('refused writes (empty, over the limit) leave no file and no receipt', async () => {
  const root = fresh();
  const ledger = ledgerFor(root);
  await assert.rejects(ledger.write('   '), error => error.code === 'empty');
  await assert.rejects(ledger.write('가'.repeat(2001)), error => error.code === 'invalid');
  assert.deepEqual(files(root), []);
});

await t('the line: one quoted run of text, bookmark copy, parsed back from its label only', () => {
  const label = memoryWriteLabel('written', '첫째 줄\n둘째 줄‮숨김');
  assert.equal(label, '기억에 남겼어요: 첫째 줄 둘째 줄숨김');
  assert.deepEqual(memoryWriteLineView(label), { kind: 'written', item: '첫째 줄 둘째 줄숨김' });
  assert.equal(memoryWriteLineView(memoryWriteLabel('undone', 'x'))?.kind, 'undone');
  assert.equal(memoryWriteLineView('다운로드 완료: downloads/a.txt (1B)'), null);
  assert.equal(MEMORY_WRITE_COPY.undo, '되돌리기');
  assert.ok([...memoryWriteLabel('written', '가'.repeat(900))].length <= 480);
  assert.equal(isMemoryWriteId('download-1'), false);
});

await t('a class or lesson activity has no personal memory scope, so no write path exists for it', () => {
  const profile = { activity_kind: 'classroom' };
  assert.equal(personalMemoryActivity({ kind: 'class' }, profile), false);
  assert.equal(personalMemoryActivity({ kind: 'personal' }, { activity_kind: 'personal' }), true);
});

fs.rmSync(top, { recursive: true, force: true });
console.log(`memory-write-line smoke: ${passed} passed`);
