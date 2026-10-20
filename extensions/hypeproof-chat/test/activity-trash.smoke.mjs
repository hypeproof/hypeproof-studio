import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ActivityTrash, activityTrashStoreDir, activityTrashKeyName, acquireTrashLock, folderIdentity, sweepActivityTrash, LOCK_STALE_MS, PENDING_GC_MS, ORPHAN_GRACE_MS, TRASH_LIMITS } from '../src/activityTrash.ts';
import { randomFillSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
// Stand-in for VS Code SecretStorage (the OS keychain): keys live only in this map, never on disk.
const keyring = () => { const map = new Map(); return { map, get: async k => map.get(k), store: async (k, v) => { map.set(k, v); }, delete: async k => { map.delete(k); } }; };
const keys = keyring();
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity-trash-')));
const root = path.join(top, 'activity'), base = path.join(top, 'globalStorage');
fs.mkdirSync(root); fs.mkdirSync(base);
const hash = data => createHash('sha256').update(data).digest('hex');
const listed = async t => (await t.list()).entries;
const ids = async t => (await listed(t)).map(e => e.id);
try {
  fs.mkdirSync(path.join(root, '작품'));
  const bytes = Buffer.from([0, 255, 37, 12, 128]);
  const file = path.join(root, '작품', '내 파일.bin');
  fs.writeFileSync(file, bytes); fs.chmodSync(file, 0o755);
  const trash = new ActivityTrash(root, base, keys);
  assert.throws(() => new ActivityTrash(root, '', keys), /no_storage/);
  assert.throws(() => new ActivityTrash(root, base), /no_keyring/);
  const entry = await trash.delete('작품/내 파일.bin');
  assert.equal(fs.existsSync(file), false);
  assert.equal(entry.sha256, hash(bytes));
  assert.equal(entry.originalPath, '작품/내 파일.bin');
  assert.ok(entry.deletedAt > 0);
  // The bytes live in the extension storage, keyed by the activity folder, never in the folder.
  const store = activityTrashStoreDir(base, root, folderIdentity(root));
  assert.equal(trash.store, store);
  assert.ok(fs.existsSync(path.join(store, 'items', `${entry.id}.blob`)));
  // Sealed metadata: the test reads and rewrites it only through the store's key, as the store does.
  const storeKey = () => Buffer.from(keys.map.get(activityTrashKeyName(store)), 'base64');
  const metaFile = id => path.join(store, 'items', `${id}.meta`);
  const aad = id => Buffer.from(`${path.basename(store)}/${id}/meta`);
  const readMeta = id => { const b = fs.readFileSync(metaFile(id)); const d = createDecipheriv('aes-256-gcm', storeKey(), b.subarray(4, 16)); d.setAAD(aad(id)); d.setAuthTag(b.subarray(b.length - 16)); return JSON.parse(Buffer.concat([d.update(b.subarray(16, b.length - 16)), d.final()]).toString()); };
  const writeMeta = (id, e) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', storeKey(), iv); c.setAAD(aad(id)); const body = Buffer.concat([c.update(JSON.stringify(e)), c.final()]); fs.writeFileSync(metaFile(id), Buffer.concat([Buffer.from('HPT1'), iv, body, c.getAuthTag()])); };
  assert.equal(readMeta(entry.id).originalPath, '작품/내 파일.bin');
  assert.equal(fs.existsSync(path.join(root, '.hypeproof')), false);
  assert.deepEqual(await listed(new ActivityTrash(root, base, keys)), [entry]);
  fs.writeFileSync(file, 'occupied');
  const result = await trash.restore(entry.id);
  assert.equal(result.renamed, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'occupied');
  assert.equal(hash(fs.readFileSync(path.join(root, result.path))), hash(bytes));
  assert.equal(fs.statSync(path.join(root, result.path)).mode & 0o777, 0o755);
  assert.deepEqual(await listed(trash), []);
  const again = await trash.delete(result.path);
  assert.equal((await trash.restore(again.id)).path, result.path);
  const permanent = await trash.delete(result.path);
  await trash.purge(permanent.id);
  assert.deepEqual(await listed(trash), []);
  await assert.rejects(trash.restore(permanent.id));

  // Refusals use files that exist, so only the guard can make them throw.
  fs.writeFileSync(path.join(top, 'sibling.txt'), 'outside');
  fs.mkdirSync(path.join(root, 'a')); fs.writeFileSync(path.join(root, 'b'), 'b');
  const bidi = ['\u202eevil.txt', '\u200elrm.txt', '\u200frlm.txt', '\u061calm.txt', '\u2067isolate.txt', '\u0085nel.txt', '\u2028ls.txt', '\u2029ps.txt'];
  for (const name of bidi) fs.writeFileSync(path.join(root, name), 'bidi');
  for (const name of ['../sibling.txt', 'a/../b', ...bidi]) {
    await assert.rejects(trash.delete(name), /invalid_path/, name);
    await assert.rejects(trash.prepareNativeDelete([name]), /invalid_path/, name);
  }
  assert.equal(fs.readFileSync(path.join(top, 'sibling.txt'), 'utf8'), 'outside');
  assert.equal(fs.readFileSync(path.join(root, 'b'), 'utf8'), 'b');
  for (const name of bidi) assert.ok(fs.existsSync(path.join(root, name)), name);
  for (const name of ['.hypeproof/config', 'a\\b', '．hidden/x']) await assert.rejects(trash.delete(name));
  // Internal store names are refused in any case (V10), with real files so only the guard can refuse.
  for (const dir of ['.HYPEPROOF', '.Git']) { fs.mkdirSync(path.join(root, dir)); fs.writeFileSync(path.join(root, dir, 'x'), 'internal'); }
  for (const name of ['.HYPEPROOF/x', '.Git/x']) {
    await assert.rejects(trash.delete(name), /invalid_path/, name);
    assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), 'internal');
  }
  for (const dir of ['.HYPEPROOF', '.Git']) fs.rmSync(path.join(root, dir), { recursive: true });
  // A hard-linked file has another name the trash would neither remove nor restore.
  fs.writeFileSync(path.join(root, 'linked.txt'), 'shared'); fs.linkSync(path.join(root, 'linked.txt'), path.join(top, 'other-name.txt'));
  await assert.rejects(trash.delete('linked.txt'), /not_regular_file/);
  assert.deepEqual((await trash.prepareNativeDelete(['linked.txt'])), { ids: [], failed: 1 });
  assert.equal(fs.readFileSync(path.join(root, 'linked.txt'), 'utf8'), 'shared');
  assert.deepEqual((await trash.expand('linked.txt')).files, []);
  assert.equal((await trash.expand('linked.txt')).skipped, 1);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  await assert.rejects(trash.delete('link/outside'));
  fs.symlinkSync('/missing-target', path.join(root, 'dangling'));
  await assert.rejects(trash.delete('dangling'));
  fs.mkdirSync(path.join(root, '작품'), { recursive: true });
  fs.writeFileSync(file, 'saved');
  const saved = await trash.delete('작품/내 파일.bin');
  fs.rmdirSync(path.join(root, '작품'));
  fs.symlinkSync(os.tmpdir(), path.join(root, '작품'));
  await assert.rejects(trash.restore(saved.id));
  assert.equal((await listed(trash)).length, 1);

  // Explorer preparation is copy-only; an intact original keeps the copy hidden.
  fs.writeFileSync(path.join(root, 'native.bin'), bytes);
  const prepared = await trash.prepareNativeDelete(['native.bin']);
  assert.equal(prepared.ids.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, 'native.bin')), bytes);
  assert.equal((await ids(trash)).includes(prepared.ids[0]), false);
  // Cancellation does not stop VS Code's delete, so the copy is kept, and appears once the source goes.
  fs.unlinkSync(path.join(root, 'native.bin'));
  assert.equal((await ids(new ActivityTrash(root, base, keys))).includes(prepared.ids[0]), true);
  await trash.restore(prepared.ids[0]);
  assert.equal(hash(fs.readFileSync(path.join(root, 'native.bin'))), hash(bytes));
  // did-delete finalizes; a source changed instead of deleted keeps the earlier bytes.
  const finished = await trash.prepareNativeDelete(['native.bin']);
  fs.unlinkSync(path.join(root, 'native.bin'));
  await trash.finishNativeDelete(finished.ids);
  assert.equal(readMeta(finished.ids[0]).pending, undefined);
  fs.writeFileSync(path.join(root, 'native.bin'), bytes);
  assert.ok((await ids(trash)).includes(finished.ids[0]), 'a finished entry is visible even if the same bytes come back');
  fs.unlinkSync(path.join(root, 'native.bin'));
  await trash.restore(finished.ids[0]);
  const changedPending = await trash.prepareNativeDelete(['native.bin']);
  fs.writeFileSync(path.join(root, 'native.bin'), 'new bytes');
  assert.ok((await ids(trash)).includes(changedPending.ids[0]));
  const changedRestored = await trash.restore(changedPending.ids[0]);
  assert.equal(hash(fs.readFileSync(path.join(root, changedRestored.path))), hash(bytes));
  // A pending copy of an intact original is collected only after PENDING_GC_MS.
  fs.writeFileSync(path.join(root, 'kept.bin'), 'kept');
  const old = (await trash.prepareNativeDelete(['kept.bin'])).ids[0];
  const ageEntry = id => { const e = readMeta(id); e.deletedAt = Date.now() - PENDING_GC_MS - 1000; writeMeta(id, e); };
  await listed(trash);
  assert.ok(fs.existsSync(path.join(store, 'items', `${old}.blob`)), 'a fresh pending copy is never collected');
  ageEntry(old); await listed(trash);
  assert.equal(fs.existsSync(path.join(store, 'items', `${old}.blob`)), false);
  assert.equal(fs.readFileSync(path.join(root, 'kept.bin'), 'utf8'), 'kept');
  const oldChanged = (await trash.prepareNativeDelete(['kept.bin'])).ids[0];
  ageEntry(oldChanged); fs.writeFileSync(path.join(root, 'kept.bin'), 'edited');
  assert.ok((await ids(trash)).includes(oldChanged), 'an old copy of a changed original stays');
  await trash.purge(oldChanged);
  // Source fingerprint is bound before modal confirmation.
  const expected = await trash.inspect('native.bin');
  fs.writeFileSync(path.join(root, 'native.bin'), 'changed');
  await assert.rejects(trash.delete('native.bin', expected));
  assert.equal(fs.readFileSync(path.join(root, 'native.bin'), 'utf8'), 'changed');
  // Files beyond the former 32 MiB bound are hashed in fixed-size chunks.
  const large = path.join(root, 'large.bin');
  const largeFd = fs.openSync(large, 'w'); fs.ftruncateSync(largeFd, 33 * 1024 * 1024); fs.closeSync(largeFd);
  const big = await trash.delete('large.bin'); await trash.restore(big.id);
  assert.equal(fs.statSync(large).size, 33 * 1024 * 1024);

  // The copy and the hashing are asynchronous: the extension host keeps turning during a large snapshot.
  const huge = path.join(root, 'huge.bin');
  // Real (non-sparse) bytes, so the copy and the hashing cost what a learner's file costs.
  const hugeFd = fs.openSync(huge, 'w'), chunk = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < 40; i++) fs.writeSync(hugeFd, randomFillSync(chunk)); fs.closeSync(hugeFd);
  // Measured in process CPU time, not wall time, so a loaded machine that deschedules the test
  // does not look like a blocked loop. Control: the CPU a synchronous hash of the same file takes in one go.
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const syncStart = cpu(); { const h = createHash('sha256'), fd = fs.openSync(huge, 'r'), buf = Buffer.alloc(256 * 1024); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); fs.closeSync(fd); }
  const syncStall = cpu() - syncStart;
  let last = cpu(), worst = 0;
  const ticker = setInterval(() => { const now = cpu(); worst = Math.max(worst, now - last); last = now; }, 1);
  const hugeCopy = await trash.prepareNativeDelete(['huge.bin']);
  clearInterval(ticker);
  assert.equal(hugeCopy.ids.length, 1);
  assert.ok(worst < syncStall / 4, `event loop ran ${Math.round(worst)} ms CPU between ticks (a synchronous hash takes ${Math.round(syncStall)} ms)`);
  fs.unlinkSync(huge); await trash.purge((await trash.list(), hugeCopy.ids[0]));
  // Locks: a live fresh owner is respected; a dead owner, an old lock or an ownerless old lock is free.
  const lock = path.join(store, 'lock');
  const owner = (pid, at) => { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid, at })); };
  owner(process.ppid, Date.now());
  await assert.rejects(new ActivityTrash(root, base, keys).purge(saved.id), /trash_busy/);
  fs.rmSync(lock, { recursive: true });
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  owner(dead, Date.now());
  assert.equal((await listed(trash)).length, 1, 'a dead owner frees the lock');
  owner(process.ppid, Date.now() - LOCK_STALE_MS - 1000);
  assert.equal((await listed(trash)).length, 1, 'an old lock is free');
  fs.mkdirSync(lock); const past = new Date(Date.now() - LOCK_STALE_MS - 1000); fs.utimesSync(lock, past, past);
  assert.equal((await listed(trash)).length, 1, 'an ownerless old lock is free');
  fs.mkdirSync(lock);
  await assert.rejects(trash.list(), /trash_busy/, 'an ownerless fresh lock may be a writer mid-start');
  fs.rmSync(lock, { recursive: true });
  // Two calls in one process are ordered, not rejected.
  fs.writeFileSync(path.join(root, 'p1.txt'), '1'); fs.writeFileSync(path.join(root, 'p2.txt'), '2');
  const [p1, p2] = await Promise.all([trash.delete('p1.txt'), trash.delete('p2.txt')]);
  await Promise.all([trash.restore(p1.id), trash.restore(p2.id)]);
  assert.equal(fs.existsSync(lock), false);

  // Directory gestures include descendants but not links, hard links or internal store folders.
  fs.mkdirSync(path.join(root, 'group', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'group', 'one.txt'), 'one');
  fs.writeFileSync(path.join(root, 'group', 'nested', 'two.txt'), 'two');
  fs.mkdirSync(path.join(root, 'group', '.hypeproof'));
  fs.writeFileSync(path.join(root, 'group', '.hypeproof', 'private.txt'), 'private');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'group', 'outside'));
  const plan = await trash.expand('group');
  assert.deepEqual(plan.files.sort(), ['group/nested/two.txt', 'group/one.txt']);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.over, false);
  // The cap counts installed packages too and stops early.
  fs.mkdirSync(path.join(root, 'proj', 'node_modules', 'pkg'), { recursive: true });
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(root, 'proj', 'node_modules', 'pkg', `${i}.js`), 'x'.repeat(10));
  assert.equal((await trash.expand('proj', { files: 5, bytes: 1e9, entries: 1e6 })).over, true);
  assert.equal((await trash.expand('proj', { files: 100, bytes: 50, entries: 1e6 })).over, true);
  assert.equal((await trash.expand('proj', { files: 100, bytes: 1e9, entries: 4 })).over, true);
  assert.equal((await trash.expand('proj', { files: 100, bytes: 1e9, entries: 1e6 })).over, false);
  assert.equal((await trash.expand('proj')).files.length, 6);
  await trash.deleteMany((await trash.expand('proj')).files.map(f => ({ path: f })));
  assert.equal(await trash.removeEmptyDirectories('proj'), true);
  assert.equal(fs.existsSync(path.join(root, 'proj')), false);

  // Encryption at rest: a missing or wrong key is refused and logged, never a plaintext fallback.
  fs.writeFileSync(path.join(root, 'secret.txt'), 'keyed bytes');
  const keyed = await trash.delete('secret.txt');
  const noKey = new ActivityTrash(root, base, keyring());
  const missing = await noKey.list();
  assert.equal(missing.entries.length, 0);
  assert.ok(missing.damaged >= 1, 'entries without their key are counted damaged');
  await assert.rejects(noKey.restore(keyed.id), /trash_key_missing/);
  fs.writeFileSync(path.join(root, 'later.txt'), 'later');
  await assert.rejects(noKey.delete('later.txt'), /trash_key_missing/, 'a store with entries never gets a fresh key');
  assert.equal(fs.readFileSync(path.join(root, 'later.txt'), 'utf8'), 'later');
  const wrong = keyring(); await wrong.store(activityTrashKeyName(store), randomBytes(32).toString('base64'));
  const wrongKey = new ActivityTrash(root, base, wrong);
  assert.equal((await wrongKey.list()).entries.length, 0);
  await assert.rejects(wrongKey.restore(keyed.id), /invalid_metadata/);
  const malformed = keyring(); await malformed.store(activityTrashKeyName(store), 'short');
  await assert.rejects(new ActivityTrash(root, base, malformed).list(), /trash_key_invalid/);
  assert.equal(fs.existsSync(path.join(root, 'secret.txt')), false, 'a refused restore writes nothing');
  // Tamper: one flipped byte in the sealed copy or in the sealed metadata is refused; restore writes nothing.
  const blobOf = id => path.join(store, 'items', `${id}.blob`);
  const flip = (f, at) => { const b = fs.readFileSync(f); b[at] ^= 1; fs.writeFileSync(f, b); };
  flip(blobOf(keyed.id), 20);
  await assert.rejects(trash.restore(keyed.id), /invalid_content/);
  assert.equal(fs.existsSync(path.join(root, 'secret.txt')), false);
  flip(blobOf(keyed.id), 20);
  flip(metaFile(keyed.id), 20);
  await assert.rejects(trash.restore(keyed.id), /invalid_metadata/);
  flip(metaFile(keyed.id), 20);
  // A flipped tag byte leaves the plaintext (and its hash) intact: only the GCM tag can refuse it.
  const tagAt = fs.statSync(blobOf(keyed.id)).size - 1;
  flip(blobOf(keyed.id), tagAt);
  await assert.rejects(trash.restore(keyed.id), /invalid_content/);
  assert.equal(fs.existsSync(path.join(root, 'secret.txt')), false);
  flip(blobOf(keyed.id), tagAt);
  // A copy changed after restore verified it (inside the lock) is refused and the half-written file removed.
  const swapping = new ActivityTrash(root, base, keys, { restoreVerified: f => flip(f, fs.statSync(f).size - 1) });
  await assert.rejects(swapping.restore(keyed.id), /invalid_content/);
  assert.equal(fs.existsSync(path.join(root, 'secret.txt')), false, 'no unauthenticated plaintext is left behind');
  flip(blobOf(keyed.id), tagAt);
  // Sealed files are bound to their entry: another entry's copy under this id is refused.
  fs.writeFileSync(path.join(root, 'other.txt'), 'other bytes'); const other = await trash.delete('other.txt');
  const keptBlob = fs.readFileSync(blobOf(keyed.id));
  fs.copyFileSync(blobOf(other.id), blobOf(keyed.id));
  await assert.rejects(trash.restore(keyed.id), /invalid_content/);
  fs.writeFileSync(blobOf(keyed.id), keptBlob);
  await trash.restore(keyed.id); await trash.restore(other.id);
  assert.equal(fs.readFileSync(path.join(root, 'secret.txt'), 'utf8'), 'keyed bytes');

  // Release removes only its own lock: after a stale takeover the old owner's release leaves the new lock (V3).
  const lockDir = path.join(top, 'lock-test'), ownerFile = path.join(lockDir, 'owner.json');
  const releaseOld = await acquireTrashLock(lockDir);
  const aged = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); aged.at = Date.now() - LOCK_STALE_MS - 1000; fs.writeFileSync(ownerFile, JSON.stringify(aged));
  const releaseNew = await acquireTrashLock(lockDir);
  await releaseOld();
  assert.equal(fs.existsSync(ownerFile), true, 'the old owner did not remove the new lock');
  await releaseNew();
  assert.equal(fs.existsSync(lockDir), false);

  // Default caps at their boundaries (V4, V5): exactly 5,000 files and exactly 200 MB fit; one more does not.
  fs.mkdirSync(path.join(root, 'capfiles'));
  for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(root, 'capfiles', `${i}`), '');
  assert.equal((await trash.expand('capfiles')).over, false);
  fs.writeFileSync(path.join(root, 'capfiles', 'one-more'), '');
  assert.equal((await trash.expand('capfiles')).over, true);
  fs.rmSync(path.join(root, 'capfiles'), { recursive: true });
  const sparse = (f, n) => { const fd = fs.openSync(f, 'w'); fs.ftruncateSync(fd, n); fs.closeSync(fd); };
  fs.mkdirSync(path.join(root, 'capbytes'));
  sparse(path.join(root, 'capbytes', 'a'), 200 * 1024 * 1024);
  assert.equal((await trash.expand('capbytes')).over, false);
  sparse(path.join(root, 'capbytes', 'b'), 1);
  assert.equal((await trash.expand('capbytes')).over, true);
  fs.rmSync(path.join(root, 'capbytes'), { recursive: true });
  // One budget for a whole gesture (verify R3): three folders that each fit pass the cap together.
  for (const d of ['g1', 'g2', 'g3']) { fs.mkdirSync(path.join(root, d)); for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(root, d, `${i}`), ''); }
  const gesture = { visited: 0, files: 0, bytes: 0 };
  const plans = [];
  for (const d of ['g1', 'g2', 'g3']) plans.push(await trash.expand(d, TRASH_LIMITS, gesture));
  assert.deepEqual(plans.map(p => p.over), [false, false, true]);
  assert.equal((await trash.expand('g3')).over, false, 'control: each folder alone fits');
  for (const d of ['g1', 'g2', 'g3']) fs.rmSync(path.join(root, d), { recursive: true });

  // The sealed copy is verified before the original goes (V6): a copy damaged on the way is refused and the original stays.
  const blobCount = () => fs.readdirSync(path.join(store, 'items')).filter(n => n.endsWith('.blob')).length;
  fs.writeFileSync(path.join(root, 'v6.txt'), 'v6 bytes');
  const blobsBefore = blobCount();
  const damaging = new ActivityTrash(root, base, keys, { blobWritten: f => { const b = fs.readFileSync(f); b[b.length - 20] ^= 1; fs.writeFileSync(f, b); } });
  await assert.rejects(damaging.delete('v6.txt'));
  assert.equal(fs.readFileSync(path.join(root, 'v6.txt'), 'utf8'), 'v6 bytes');
  assert.equal(blobCount(), blobsBefore);
  // A copy in progress when VS Code deletes the original is completed and kept (verify R5).
  fs.writeFileSync(path.join(root, 'midcopy.txt'), 'deleted while copying');
  const racing = new ActivityTrash(root, base, keys, { sourceRead: source => fs.unlinkSync(source) });
  // A pending entry (Explorer has not deleted yet) can be neither restored nor purged.
  fs.writeFileSync(path.join(root, 'still.txt'), 'still here');
  const stillPending = (await trash.prepareNativeDelete(['still.txt'])).ids[0];
  await assert.rejects(trash.restore(stillPending), /delete_pending/);
  await assert.rejects(trash.purge(stillPending), /delete_pending/);
  assert.equal(fs.readFileSync(path.join(root, 'still.txt'), 'utf8'), 'still here');
  const raced = await racing.prepareNativeDelete(['midcopy.txt']);
  assert.deepEqual([raced.ids.length, raced.failed], [1, 0]);
  assert.equal(fs.existsSync(path.join(root, 'midcopy.txt')), false);
  assert.ok((await ids(trash)).includes(raced.ids[0]));
  await trash.restore(raced.ids[0]);
  assert.equal(fs.readFileSync(path.join(root, 'midcopy.txt'), 'utf8'), 'deleted while copying');

  // Links never lead out (M5): expanding behind a linked parent lists nothing, and a linked folder is never removed.
  const outsideDir = path.join(top, 'outside-dir');
  fs.mkdirSync(path.join(outsideDir, 'sub'), { recursive: true }); fs.writeFileSync(path.join(outsideDir, 'sub', 'v2.txt'), 'outside');
  fs.symlinkSync(outsideDir, path.join(root, 'dirlink'));
  await assert.rejects(trash.expand('dirlink/sub'), /unsafe_path/);
  await assert.rejects(trash.removePermanently('dirlink'), /unsafe_path/);
  assert.ok(fs.lstatSync(path.join(root, 'dirlink')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(outsideDir, 'sub', 'v2.txt'), 'utf8'), 'outside');
  fs.unlinkSync(path.join(root, 'dirlink'));
  // Metadata with a second name is refused (V13).
  fs.writeFileSync(path.join(root, 'v13.txt'), 'v13'); const v13 = await trash.delete('v13.txt');
  fs.linkSync(metaFile(v13.id), path.join(top, 'meta-alias'));
  assert.equal((await ids(trash)).includes(v13.id), false);
  await assert.rejects(trash.restore(v13.id), /invalid_metadata/);
  fs.unlinkSync(path.join(top, 'meta-alias'));
  await trash.purge(v13.id);

  // One damaged or foreign entry is skipped and counted; the rest stay restorable and nothing is erased.
  const survivor = (await listed(trash))[0];
  const corrupt = await trash.delete('native.bin');
  const blob = path.join(store, 'items', `${corrupt.id}.blob`);
  fs.writeFileSync(blob, 'tampered');
  fs.writeFileSync(path.join(store, 'items', 'garbage.meta'), '{}');
  fs.writeFileSync(path.join(store, 'items', '00000000-0000-0000-0000-000000000000.meta'), 'not json');
  const damagedList = await trash.list();
  assert.equal(damagedList.damaged, 3);
  assert.deepEqual(damagedList.entries.map(e => e.id).includes(survivor.id), true);
  assert.equal(damagedList.entries.some(e => e.id === corrupt.id), false);
  await assert.rejects(trash.restore(corrupt.id));
  await assert.rejects(trash.purge(corrupt.id));
  assert.equal(fs.existsSync(blob), true);
  assert.equal(fs.existsSync(path.join(store, 'items', 'garbage.meta')), true);

  // A copied or forged marker never gets another store swept (V14): the main store's marker now names a missing folder.
  const marker = t => JSON.parse(fs.readFileSync(path.join(t, 'root.json'), 'utf8'));
  const realMarker = fs.readFileSync(path.join(store, 'root.json'));
  const ghost = path.join(top, 'ghost'); fs.mkdirSync(ghost); const ghostId = folderIdentity(ghost); fs.rmdirSync(ghost);
  fs.writeFileSync(path.join(store, 'root.json'), JSON.stringify({ path: ghost, identity: ghostId }));
  assert.equal(await sweepActivityTrash(base, keys), 0);
  assert.equal(await sweepActivityTrash(base, keys, Date.now() + ORPHAN_GRACE_MS + 1000), 0);
  assert.equal(fs.existsSync(store), true);
  assert.deepEqual(marker(store), { path: ghost, identity: ghostId }, 'not even marked missing');
  fs.writeFileSync(path.join(store, 'root.json'), realMarker);

  // Sweep: the store goes with its folder (path and identity), and stays while the folder (or its parent) is there.
  assert.equal(await sweepActivityTrash(base, keys), 0);
  const gone = path.join(top, 'gone'); fs.mkdirSync(gone); fs.writeFileSync(path.join(gone, 'x.txt'), 'old-learner-diary');
  const goneTrash = new ActivityTrash(gone, base, keys); const goneEntry = await goneTrash.delete('x.txt');
  const unmounted = path.join(top, 'volume', 'act'); fs.mkdirSync(unmounted, { recursive: true }); fs.writeFileSync(path.join(unmounted, 'y.txt'), 'y');
  const unmountedTrash = new ActivityTrash(unmounted, base, keys); await unmountedTrash.delete('y.txt');
  // Renamed away and back keeps the identity: the mark is cleared and nothing is lost.
  fs.renameSync(gone, `${gone}-away`);
  assert.equal(await sweepActivityTrash(base, keys), 0);
  assert.equal(typeof marker(goneTrash.store).missingSince, 'number');
  fs.renameSync(`${gone}-away`, gone);
  assert.equal(await sweepActivityTrash(base, keys, Date.now() + ORPHAN_GRACE_MS + 1000), 0);
  assert.equal(marker(goneTrash.store).missingSince, undefined);
  assert.deepEqual((await listed(new ActivityTrash(gone, base, keys))).map(e => e.id), [goneEntry.id]);
  // A new folder at the same path is a different activity (verify R2): it sees and restores nothing of the old trash.
  fs.rmSync(gone, { recursive: true }); fs.rmSync(path.join(top, 'volume'), { recursive: true });
  fs.mkdirSync(gone);
  const successor = new ActivityTrash(gone, base, keys);
  assert.notEqual(successor.store, goneTrash.store);
  assert.deepEqual(await successor.list(), { entries: [], damaged: 0 });
  await assert.rejects(successor.restore(goneEntry.id));
  assert.equal(fs.existsSync(path.join(gone, 'x.txt')), false);
  // The old store counts as missing although its path exists again, and goes (with its key) after the grace period.
  assert.equal(await sweepActivityTrash(base, keys), 0);
  assert.equal(typeof marker(goneTrash.store).missingSince, 'number', 'a different folder at the path does not clear the mark');
  assert.equal(await sweepActivityTrash(base, keys, Date.now() + ORPHAN_GRACE_MS / 2), 0, 'inside the grace period nothing goes');
  assert.equal(keys.map.has(activityTrashKeyName(goneTrash.store)), true);
  assert.equal(await sweepActivityTrash(base, keys, Date.now() + ORPHAN_GRACE_MS + 1000), 1);
  assert.equal(fs.existsSync(goneTrash.store), false);
  assert.equal(keys.map.has(activityTrashKeyName(goneTrash.store)), false, 'the removed store takes its key along');
  assert.equal(fs.existsSync(unmountedTrash.store), true);
  assert.equal(fs.existsSync(successor.store), true);
  assert.equal(fs.existsSync(store), true);
  console.log('activity trash: sealed storage outside the folder, key refusal, tamper, folder identity, gesture cap, in-flight copy, byte preservation, collision, mode, purge, unsafe paths, hard links, locks, damaged entries, cap and sweep PASS');
} finally { fs.rmSync(top, { recursive: true, force: true }); }
