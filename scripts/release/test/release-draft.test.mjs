import test from 'node:test';
import assert from 'node:assert/strict';
import {pickRelease} from '../release-draft.mjs';

// Helper: make a minimal release object
const rel = (tag_name, draft, id) => ({id, tag_name, draft});

test('none → create', () => {
  assert.deepEqual(pickRelease([], 'v1.0.0'), {action: 'create'});
});

test('none matching (other tags present) → create', () => {
  assert.deepEqual(
    pickRelease([rel('v2.0.0', true, 5)], 'v1.0.0'),
    {action: 'create'}
  );
});

test('one draft → upload to its id', () => {
  assert.deepEqual(
    pickRelease([rel('v1.0.0', true, 42)], 'v1.0.0'),
    {action: 'upload', id: 42}
  );
});

test('one draft among others → upload to matching id', () => {
  assert.deepEqual(
    pickRelease([rel('v0.9.0', true, 1), rel('v1.0.0', true, 42), rel('v1.1.0', true, 99)], 'v1.0.0'),
    {action: 'upload', id: 42}
  );
});

test('published release → refuses with "published"', () => {
  assert.throws(
    () => pickRelease([rel('v1.0.0', false, 99)], 'v1.0.0'),
    /published/
  );
});

test('two drafts for same tag → throws naming both ids', () => {
  const err = assert.throws(
    () => pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 20)], 'v1.0.0'),
    /Multiple/
  );
  void err;
  // Both ids appear in the message
  try { pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 20)], 'v1.0.0'); }
  catch (e) {
    assert.ok(e.message.includes('10'), 'id 10 should appear in error');
    assert.ok(e.message.includes('20'), 'id 20 should appear in error');
  }
});

test('three releases for same tag → throws naming all ids', () => {
  try {
    pickRelease([rel('v1.0.0', true, 1), rel('v1.0.0', true, 2), rel('v1.0.0', true, 3)], 'v1.0.0');
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(e.message.includes('1'), 'id 1 should appear');
    assert.ok(e.message.includes('2'), 'id 2 should appear');
    assert.ok(e.message.includes('3'), 'id 3 should appear');
  }
});
