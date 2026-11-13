// E5 (#3776) — question cards in the learner inbox: pure rules and the on-disk store.
// Designed behavior: a question is taken only in the exact form the Service sends and hashes byte-for-byte as the Service
// does (a sixth element for question only; every other kind's bytes unchanged); the device's own answer is bound to one
// revision, reuses its key only for the same answer, and disappears with a new revision or a withdrawal.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as inbox from '../src/classroomInbox.ts';
import { InboxSession, InboxStore } from '../src/classroomInboxStore.ts';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const OBJ = '44444444-4444-4444-8444-444444444444';
const CHOICE = { type: 'choice', options: ['예', '아니요', '잘 모르겠어요'] };
const item = (o = {}) => {
  const c = { kind: 'question', title: '확인 질문', body: '오늘 배운 내용을 써 봤나요?', links: [], question: CHOICE, ...o.content };
  return { offer_key: sha('offer' + (o.rev ?? 1)).slice(0, 32), distribution_id: 'dddddddd-dddd-4ddd-8ddd-000000000001', seq: o.seq ?? 1, object_id: OBJ, revision: o.rev ?? 1, schema: inbox.CONTENT_SCHEMA, ...c, content_hash: o.hash ?? sha(o.canonical ?? inbox.contentCanonical(c)), issued_at: 1, expires_at: 2, apply_within_ms: 30000 };
};

test('hash: a question adds its form as the sixth element; every other kind hashes exactly as before', () => {
  // Expected bytes are written out from the Service contract, not computed by the code under test.
  const head = '"hps-classroom-content/1","question","확인 질문","오늘 배운 내용을 써 봤나요?",[]';
  const c = { kind: 'question', title: '확인 질문', body: '오늘 배운 내용을 써 봤나요?', links: [] };
  assert.equal(inbox.contentCanonical({ ...c, question: CHOICE }), `[${head},["choice",["예","아니요","잘 모르겠어요"]]]`);
  assert.equal(inbox.contentCanonical({ ...c, question: { type: 'text' } }), `[${head},["text"]]`);
  assert.notEqual(inbox.contentCanonical({ ...c, question: { type: 'choice', options: ['아니요', '예', '잘 모르겠어요'] } }), inbox.contentCanonical({ ...c, question: CHOICE }), 'option order is part of what was sent');
  assert.notEqual(inbox.contentCanonical(c), `[${head}]`, 'a question without its form never hashes like a five-element item');
  assert.equal(inbox.contentCanonical({ kind: 'notice', title: 'T', body: 'B', links: [] }), '["hps-classroom-content/1","notice","T","B",[]]');
  assert.equal(inbox.contentCanonical({ kind: 'notice', title: 'T', body: 'B', links: [], question: CHOICE }), '["hps-classroom-content/1","notice","T","B",[]]', 'a form on another kind adds nothing to its bytes');
  assert.equal(inbox.contentCanonical({ kind: 'setting', title: 'T', body: 'B', links: [], lesson: 'base' }), '["hps-classroom-content/1","setting","T","B",[],["base"]]');
});

test('validation: the two forms are taken exactly; anything else is refused, never repaired', () => {
  const ok = inbox.validateItem(item());
  assert.equal(ok.ok, true); assert.deepEqual(ok.value.question, CHOICE);
  assert.deepEqual(inbox.validateItem(item({ content: { question: { type: 'text' } } })).value.question, { type: 'text' });
  const refused = [
    ['no form', { question: undefined }], ['text with options', { question: { type: 'text', options: ['a', 'b'] } }],
    ['one option', { question: { type: 'choice', options: ['a'] } }], ['seven options', { question: { type: 'choice', options: ['1', '2', '3', '4', '5', '6', '7'] } }],
    ['duplicate options', { question: { type: 'choice', options: ['a', 'a'] } }], ['padded option', { question: { type: 'choice', options: [' a', 'b'] } }],
    ['two-line option', { question: { type: 'choice', options: ['a\nb', 'c'] } }], ['81-char option', { question: { type: 'choice', options: ['가'.repeat(81), 'b'] } }],
    ['non-string option', { question: { type: 'choice', options: [1, 2] } }], ['extra key', { question: { type: 'choice', options: ['a', 'b'], multi: true } }],
    ['unknown type', { question: { type: 'scale' } }], ['links on a question', { links: [{ label: 'a', url: 'https://docs.example.org/' }] }],
    ['lesson on a question', { lesson: 'base' }],
  ];
  for (const [name, content] of refused) {
    const raw = item({ content }); if (content.question === undefined && 'question' in content) delete raw.question;
    if (content.lesson) raw.lesson = content.lesson;
    assert.equal(inbox.validateItem(raw).ok, false, name);
  }
  assert.equal(inbox.validateItem({ ...item(), kind: 'notice' }).ok, false, 'a form on a notice is refused');
  assert.equal(inbox.validateItem({ ...item(), question: { type: 'text' } }).ok, true, 'validation accepts the form; the store then checks the hash');
});

test('answers: one option index, a short text, or a skip — nothing else', () => {
  const v = (a, spec = CHOICE) => inbox.validateAnswer(a, spec);
  assert.deepEqual([v({ choice: 0 }), v({ choice: 2 }), v({ skipped: true }), v({ text: '줄1\n줄2' }, { type: 'text' }), v({ text: '가'.repeat(500) }, { type: 'text' })].map(Boolean), [true, true, true, true, true]);
  for (const bad of [[{ choice: 3 }], [{ choice: -1 }], [{ choice: 1.5 }], [{ choice: '1' }], [{ text: 'x' }], [{ skipped: false }], [{ choice: 0, skipped: true }], [{ text: '   ' }, { type: 'text' }], [{ text: '가'.repeat(501) }, { type: 'text' }], [{ text: 'a‮b' }, { type: 'text' }], [{ choice: 0 }, { type: 'text' }], [null]]) assert.equal(v(...bad), null, JSON.stringify(bad));
});

test('answer record: a retry of the same answer reuses its key, a different answer gets a fresh one, a new revision or withdrawal forgets it', () => {
  let n = 0; const fresh = () => `key-${++n}-000000`;
  const it1 = inbox.validateItem(item()).value, t1 = { object_id: OBJ, revision: 1, content_hash: it1.content_hash };
  let ix = inbox.applyOffer(inbox.emptyIndex(), it1, 'f1', 100, 5);
  const k1 = inbox.answerKey(ix.objects[OBJ].answer, t1, { choice: 0 }, fresh);
  ix = inbox.markAnswerPending(ix, t1, k1, { choice: 0 });
  assert.equal(inbox.answerKey(ix.objects[OBJ].answer, t1, { choice: 0 }, fresh), k1, 'the same answer after a failure: same key');
  ix = inbox.markAnswerSent(ix, t1, k1, { choice: 0 }, 9, 1);
  assert.deepEqual(ix.objects[OBJ].answer.sent.value, { choice: 0 }); assert.equal(ix.objects[OBJ].answer.pending, undefined);
  const k2 = inbox.answerKey(ix.objects[OBJ].answer, t1, { choice: 1 }, fresh);
  assert.notEqual(k2, k1, 'a changed answer is a new answer');
  ix = inbox.markAnswerPending(ix, t1, k2, { choice: 1 });
  assert.deepEqual(ix.objects[OBJ].answer.sent.value, { choice: 0 }, 'until confirmed, the sent answer is still the one the Service has');
  assert.equal(inbox.markAnswerSent(ix, { ...t1, content_hash: 'f'.repeat(64) }, k2, { choice: 1 }, 10, 2), ix, 'a different hash changes nothing');
  ix = inbox.applyOffer(ix, it1, 'f1', 100, 6);
  assert.ok(ix.objects[OBJ].answer, 'a re-offer of the same revision keeps the answer');
  const it2 = inbox.validateItem(item({ rev: 2, seq: 2, content: { body: '고친 질문' } })).value;
  assert.equal(inbox.applyOffer(ix, it2, 'f2', 100, 7).objects[OBJ].answer, undefined, 'a new revision starts unanswered');
  assert.equal(inbox.applyWithdraw(ix, { withdraw_key: 'a'.repeat(32), object_id: OBJ, seq: 3, revision: 1, reason: 'revoked' }, 8).objects[OBJ].answer, undefined, 'a withdrawal drops the answer with the card');
  assert.equal(inbox.markAnswerPending(inbox.applyWithdraw(ix, { withdraw_key: 'a'.repeat(32), object_id: OBJ, seq: 3, revision: 1, reason: 'revoked' }, 8), t1, 'k', { choice: 0 }).objects[OBJ].answer, undefined, 'a withdrawn card cannot be answered');
});

test('store: a question arrives with its form, unanswered; a form edited on disk reads as unreadable; a wrong hash is never taken', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hps-question-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { mono: () => 0, wall: () => 1_000_000 }, store = new InboxStore(dir);
  const s = new InboxSession({ store, alive: () => true, clock });
  await s.onBlock({ items: [item({ hash: sha('["something else"]') })] }, { monoStart: 0, wallStart: 1_000_000 }, 5);
  assert.equal((await store.read()).cards.length, 0, 'a question whose hash does not match its form is not taken');
  await s.onBlock({ items: [item()] }, { monoStart: 0, wallStart: 1_000_000 }, 5);
  const [card] = (await store.read()).cards;
  assert.deepEqual([card.kind, card.question, card.answer, card.unreadable], ['question', CHOICE, { sent: null }, false]);
  const revDir = path.join(dir, 'rev'), [file] = readdirSync(revDir), held = JSON.parse(readFileSync(path.join(revDir, file), 'utf8'));
  writeFileSync(path.join(revDir, file), JSON.stringify({ ...held, question: { type: 'choice', options: ['예', '아니요', '네'] } }));
  assert.equal((await store.read()).cards[0].unreadable, true, 'options changed on disk are not shown as the instructor\'s');
});
