// CGP-ART-R-005: the pure rules of an instructor comment anchored to an approved page version.
// Designed behavior: the device accepts exactly the Service's anchor (an approved version plus a permille rectangle or a
// plain element reference) and hashes it the same way; a comment carries no links and at most 500 characters; the
// learner's approvals are read with the last word winning; a comment belongs only to a version the learner approved.
import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorCanonical, approvedVersions, commentVersion, pinPlace, placeWords, validateAnchor, validateCommentAnswer } from '../src/artifactComment.ts';
import { contentCanonical, validateItem } from '../src/classroomInbox.ts';

const SHA = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const item = (o = {}) => ({ offer_key: 'c'.repeat(32), distribution_id: 'dddddddd-dddd-4ddd-8ddd-000000000001', seq: 1, object_id: '77777777-7777-4777-8777-777777777777', revision: 1, kind: 'comment', schema: 'hps-classroom-content/1', title: '강사 의견', body: '좋아요', links: [], anchor: { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 10, h: 10 } }, content_hash: 'e'.repeat(64), apply_within_ms: 30_000, ...o });

test('anchor: exactly the Service contract, refused rather than repaired', () => {
  assert.deepEqual(validateAnchor({ artifact_sha256: SHA, rect: { x: 0, y: 0, w: 333, h: 333 } }), { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 333, h: 333 } });
  assert.deepEqual(validateAnchor({ artifact_sha256: SHA, element: '첫 번째 제목' }), { artifact_sha256: SHA, element: '첫 번째 제목' });
  for (const bad of [null, { artifact_sha256: SHA }, { artifact_sha256: 'A'.repeat(64), element: 'h1' }, { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 0, h: 1 } },
    { artifact_sha256: SHA, rect: { x: 999, y: 0, w: 2, h: 1 } }, { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 1, h: 1, z: 1 } }, { artifact_sha256: SHA, rect: { x: 0, y: 0, w: 1, h: 1 }, element: 'h1' },
    { artifact_sha256: SHA, element: ' h1' }, { artifact_sha256: SHA, element: 'a\nb' }, { artifact_sha256: SHA, element: 'x'.repeat(121) }, { artifact_sha256: SHA, line: 3 }])
    assert.equal(validateAnchor(bad), null, JSON.stringify(bad));
});

test('the content hash covers the anchor, byte for byte as the Service writes it', () => {
  const c = { kind: 'comment', title: '강사 의견', body: '본문', links: [], anchor: { artifact_sha256: SHA, rect: { x: 1, y: 2, w: 3, h: 4 } } };
  assert.equal(contentCanonical(c), JSON.stringify(['hps-classroom-content/1', 'comment', '강사 의견', '본문', [], ['rect', SHA, 1, 2, 3, 4]]));
  assert.equal(contentCanonical({ ...c, anchor: { artifact_sha256: SHA, element: 'h1' } }), JSON.stringify(['hps-classroom-content/1', 'comment', '강사 의견', '본문', [], ['element', SHA, 'h1']]));
  assert.deepEqual(anchorCanonical({ artifact_sha256: OTHER, element: 'x' }), ['element', OTHER, 'x']);
  assert.equal(contentCanonical({ kind: 'notice', title: '제목', body: '본문', links: [] }), JSON.stringify(['hps-classroom-content/1', 'notice', '제목', '본문', []]), 'a notice hashes as before');
});

test('validateItem: a comment carries its anchor, no links, at most 500 characters; nothing else carries an anchor', () => {
  const ok = validateItem(item());
  assert.equal(ok.ok, true); assert.deepEqual(ok.value.anchor, item().anchor);
  assert.equal(validateItem(item({ anchor: undefined })).ok, false);
  assert.equal(validateItem(item({ body: '가'.repeat(501) })).ok, false);
  assert.equal(validateItem(item({ links: [{ label: 'x', url: 'https://example.com' }] })).ok, false);
  assert.equal(validateItem(item({ kind: 'notice' })).ok, false, 'a notice with an anchor is refused');
});

test('the learner answer is {handled, reply?} only', () => {
  assert.deepEqual(validateCommentAnswer({ handled: true }), { handled: true });
  assert.deepEqual(validateCommentAnswer({ handled: false, reply: ' 고쳐 볼게요\r\n' }), { handled: false, reply: '고쳐 볼게요' });
  for (const bad of [{ reply: 'x' }, { handled: 1 }, { handled: true, reply: '   ' }, { handled: true, reply: 'x'.repeat(501) }, { handled: true, text: 'x' }, { choice: 0 }])
    assert.equal(validateCommentAnswer(bad), null, JSON.stringify(bad));
});

test('approvals: the last word wins in time order across sessions; damaged lines are skipped', () => {
  const line = (s, approved, ts, seq = 1) => JSON.stringify({ ts, type: 'artifact_approval', artifact_sha256: s, approved, seq });
  const enc = (lines) => new TextEncoder().encode(lines.join('\n') + '\n');
  const src = { current: { files: [{ name: 'events.jsonl', data: enc([line(SHA, false, '2026-11-13T02:00:00.000Z'), '{torn', line(OTHER, true, '2026-11-13T02:00:00.000Z')]) }], sequence: { session_id: 's', last_seq: 3 } },
    others: [{ session_id: 'o', meta: new Uint8Array(), events: enc([line(SHA, true, '2026-11-13T01:00:00.000Z'), line('c'.repeat(64), true, '2026-11-13T01:00:00.000Z'), JSON.stringify({ type: 'prompt', text: '…' })]), started_at: '' }], omitted: { unreadable: 0, over_limit: 0 } };
  assert.deepEqual([...approvedVersions(src)].sort(), [OTHER, 'c'.repeat(64)]);
  assert.deepEqual([...approvedVersions(null)], []);
});

test('placement: only on a version this learner approved; current vs previous', () => {
  const approved = new Set([SHA]);
  assert.equal(commentVersion(SHA, approved, SHA), 'current');
  assert.equal(commentVersion(SHA, approved, OTHER), 'previous');
  assert.equal(commentVersion(SHA, approved, null), 'previous', 'an unreadable page is not known to be the same version');
  assert.equal(commentVersion(OTHER, approved, OTHER), null, 'never on a version the learner did not approve');
  assert.deepEqual(pinPlace({ artifact_sha256: SHA, rect: { x: 0, y: 0, w: 333, h: 333 } }), { inline: 17, block: 17 });
  assert.equal(pinPlace({ artifact_sha256: SHA, element: 'h1' }), null);
  assert.equal(placeWords({ artifact_sha256: SHA, rect: { x: 0, y: 0, w: 333, h: 333 } }), '페이지 위쪽 왼쪽');
  assert.equal(placeWords({ artifact_sha256: SHA, rect: { x: 333, y: 333, w: 334, h: 334 } }), '페이지 가운데');
  assert.equal(placeWords({ artifact_sha256: SHA, element: '첫 번째 제목' }), '‘첫 번째 제목’ 부분');
});
