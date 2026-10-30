// #3294: real encrypted temporary files, synthetic keychain and local test clock.
// No user's files, OS clock or installed App is changed.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { ActivityTrash } from '../src/activityTrash.ts';
import { trashDeletedTime } from '../src/activityTrashView.ts';
const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trash-invalid-time-')));
const root = path.join(top, 'work'), base = path.join(top, 'storage');
fs.mkdirSync(root); fs.mkdirSync(base);
const secrets = new Map();
const keyring = { get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async key => { secrets.delete(key); } };
const originalNow = Date.now;
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  for (const at of [8640000000000001, -8640000000000001]) {
    const bytes = Buffer.from('recoverable text\n\u0000\ufffd' + at);
    const name = `recover-${at > 0 ? 'future' : 'past'}.txt`;
    const filename = path.join(root, name);
    fs.writeFileSync(filename, bytes);
    let removed;
    try {
      Date.now = () => at;
      removed = await new ActivityTrash(root, base, keyring).delete(name);
    } finally { Date.now = originalNow; }
    assert.equal(fs.existsSync(filename), false, 'file moved into encrypted trash');
    const reopened = new ActivityTrash(root, base, keyring);
    const listed = await reopened.list();
    assert.equal(listed.damaged, 0, 'recoverable data is not discarded for a bad clock');
    const entry = listed.entries.find(item => item.id === removed.id);
    assert.ok(entry);
    assert.equal(entry.deletedAt, at, 'bad time persisted through real encryption/reopen');
    assert.throws(() => new Date(entry.deletedAt).toISOString(), RangeError, 'old renderer would throw');
    assert.equal(trashDeletedTime(entry.deletedAt), null, 'new renderer uses explicit unknown time');
    assert.equal(entry.sha256, hash(bytes));
    const result = await reopened.restore(entry.id);
    assert.equal(result.path, name);
    assert.equal(result.renamed, false);
    assert.equal(hash(fs.readFileSync(filename)), hash(bytes), 'restored bytes identical');
    assert.equal((await reopened.list()).entries.length, 0);
  }
  for (const at of [0, Date.UTC(2026, 9, 30), -8640000000000000, 8640000000000000]) {
    assert.equal(trashDeletedTime(at)?.iso, new Date(at).toISOString(), 'representable dates preserved');
  }
  for (const at of [NaN, Infinity, -Infinity]) assert.equal(trashDeletedTime(at), null);
  console.log('PASS trash invalid time: real encrypted delete/reopen/restore, identical bytes, old-renderer RangeError controls and valid Date limits');
} finally {
  Date.now = originalNow;
  fs.rmSync(top, { recursive: true, force: true });
}
