// REQ-STUDIO-MEMORY-WRITE-LINE (CGP-KNOW-R-027 / D-027) — the real provider, on real files: a turn's memory write posts its
// timeline line, and pressing 되돌리기 (the webview's memoryWriteUndo message) reverts exactly that write, draws the
// undone line in the write's own turn, and refuses calmly when the file changed or the seat has no memory.
//   node --experimental-strip-types test/memory-write-line-host.smoke.mjs
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTaskHarness } from './task-workspace-harness.mjs';
import { MEMORY_WRITE_COPY } from '../src/memoryWriteLine.ts';

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-write-host-')));
let passed = 0;
const t = async (label, fn) => { await fn(); passed++; console.log(`  ok   ${label}`); };
const memDir = root => path.join(root, '.hypeproof', 'memory');
const files = root => (fs.existsSync(memDir(root)) ? fs.readdirSync(memDir(root)).sort() : []);

const ux = { coach: { naming_mode: 'fixed', fallback_name: '코치' } };
const PERSONAL = { profile_id: 'synthetic-personal', activity_kind: 'personal', activity_id: 'act-1', ux, game: { template_tier: 'website' } };
const CLASSROOM = { ...PERSONAL, profile_id: 'synthetic-class', activity_kind: 'classroom' };

try {
  const work = path.join(top, 'activity');
  fs.mkdirSync(work);
  const f = await createTaskHarness(path.join(top, 'tasks'));
  const h = f.h;
  // Object.create skips field initializers; production gets these from the constructor.
  h.memoryWriteLedgers = new Map();
  h.turnTimelines = new Map();
  h.cachedProfile = PERSONAL;
  h._instructorMode = { isInstructor: false };
  h.resolveCoachCwd = () => work;
  const logs = () => f.posts.filter(m => m.type === 'toolLog' && String(m.id).startsWith('memwrite-'));
  const results = () => f.posts.filter(m => m.type === 'memoryWriteResult');
  const press = id => f.handle(f.scoped({ type: 'memoryWriteUndo', id }));

  await t('a turn write posts one memory line in that turn and writes one file', async () => {
    const w = await h.recordTurnMemoryWrite('turn-1', '좋아하는 색은 초록이에요.');
    assert.ok(w && w.id.startsWith('memwrite-'));
    assert.equal(logs().length, 1);
    assert.equal(logs()[0].streamId, 'turn-1');
    assert.equal(logs()[0].label, '기억에 남겼어요: 좋아하는 색은 초록이에요.');
    assert.equal(files(work).length, 1);
  });

  await t('pressing 되돌리기 removes exactly that file and draws the undone line in the write\'s own turn', async () => {
    const first = logs()[0].id;
    const second = await h.recordTurnMemoryWrite('turn-2', '발표는 금요일이에요.');
    assert.equal(files(work).length, 2);
    await press(first);
    assert.equal(results().at(-1).state, 'undone');
    assert.deepEqual(files(work), [second.name], 'only the first write is gone');
    const undone = logs().at(-1);
    assert.equal(undone.id, first);
    assert.equal(undone.streamId, 'turn-1', 'the first turn, not the later one');
    assert.equal(undone.label, '되돌렸어요: 좋아하는 색은 초록이에요.');
    await press(first);
    assert.equal(results().at(-1).state, 'refused', 'a second press is refused');
    assert.equal(results().at(-1).notice, MEMORY_WRITE_COPY.unknown);
    assert.deepEqual(files(work), [second.name]);
  });

  await t('a file changed since the write is refused with the calm sentence and kept', async () => {
    const w = await h.recordTurnMemoryWrite('turn-3', '원래 쓴 기억');
    const file = path.join(memDir(work), w.name);
    fs.writeFileSync(file, '학생이 고친 기억\n');
    await press(w.id);
    assert.equal(results().at(-1).state, 'refused');
    assert.equal(results().at(-1).notice, MEMORY_WRITE_COPY.changed);
    assert.equal(fs.readFileSync(file, 'utf8'), '학생이 고친 기억\n');
  });

  await t('a class seat writes nothing and an undo press from it touches nothing', async () => {
    const before = files(work);
    const mine = logs().at(-1).id;
    h.cachedProfile = CLASSROOM;
    assert.equal(await h.recordTurnMemoryWrite('turn-4', '수업 기억'), null);
    await press(mine);
    assert.equal(results().at(-1).state, 'refused');
    assert.deepEqual(files(work), before);
    h.cachedProfile = PERSONAL;
  });
} finally { fs.rmSync(top, { recursive: true, force: true }); }
console.log(`memory-write-line-host smoke: ${passed} passed`);
