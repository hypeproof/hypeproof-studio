import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CompanionPreviewResultReceiver, verifyCompanionPreviewResult } from '../src/companionPreviewResult.ts';

import { packCompanionPreviewPayload } from '../src/companionPreviewPayload.ts';

const text = '<html><button>내 퀴즈</button></html>';
const version = createHash('sha256').update(text).digest('hex');
const request = { requestId: 'preview-1', artifactId: 'selected-quiz', artifactVersion: version };
const completed = () => ({ schema: 'hps-companion-host-result/1', requestId: request.requestId,
  outcome: { state: 'completed', code: 'preview_ready', requestId: request.requestId,
    artifact: { id: request.artifactId, version, text } } });

test('mobile result consumer returns the exact requested saved artifact version', async () => {
  const packet = completed();
  assert.deepEqual(await verifyCompanionPreviewResult(JSON.stringify(packet), request), packet.outcome);
});

test('another request or changed saved version does not replace the requested preview', async () => {
  for (const change of [
    packet => { packet.requestId = 'earlier-request'; },
    packet => { packet.outcome.artifact.id = 'another-file'; },
    packet => { packet.outcome.artifact.version = '0'.repeat(64); },
    packet => { packet.outcome.artifact.text = '<html>later version</html>'; },
  ]) {
    const packet = completed(); change(packet);
    await assert.rejects(() => verifyCompanionPreviewResult(JSON.stringify(packet), request), /companion_result_/);
  }
});

test('waiting and denied responses carry no stale artifact and oversized packets are refused', async () => {
  for (const state of ['wait_for_host', 'denied', 'outcome_unknown']) {
    const packet = { schema: 'hps-companion-host-result/1', requestId: request.requestId,
      outcome: { state, code: 'host_unavailable' } };
    assert.deepEqual(await verifyCompanionPreviewResult(JSON.stringify(packet), request), packet.outcome);
    packet.outcome.artifact = completed().outcome.artifact;
    await assert.rejects(() => verifyCompanionPreviewResult(JSON.stringify(packet), request), /unexpected_artifact/);
  }
  await assert.rejects(() => verifyCompanionPreviewResult('가'.repeat(678), request), /oversize/);
});


const largeResult = repeats => {
  const packet = completed();
  packet.outcome.artifact.text = '<!doctype html><html lang="ko"><button onclick="this.textContent=\'잘했어요!\'">내 퀴즈</button>'
    + '<p>내가 만든 퀴즈예요. 무엇을 바꿔 볼까요? 🌈</p>'.repeat(repeats) + '</html>';
  packet.outcome.artifact.version = createHash('sha256').update(packet.outcome.artifact.text).digest('hex');
  return packet;
};

test('framed semantic receiver returns only the complete exact selected Korean artifact and snapshots context', async () => {
  for (const repeats of [125, 300]) {
    const packet = largeResult(repeats), raw = JSON.stringify(packet);
    const bytes = new TextEncoder().encode(packet.outcome.artifact.text).length;
    assert.ok(bytes >= 8192 && bytes <= 24576);
    const expected = { ...request, artifactVersion: packet.outcome.artifact.version };
    const receiver = new CompanionPreviewResultReceiver(expected);
    expected.artifactId = 'mutated-after-construction'; expected.artifactVersion = '0'.repeat(64);
    const parts = (await packCompanionPreviewPayload(raw, request.requestId)).reverse();
    for (const part of parts.slice(0, -1)) {
      assert.equal(await receiver.accept(part), null);
      assert.equal(receiver.progress.complete, false);
    }
    assert.deepEqual(await receiver.accept(parts.at(-1)), packet.outcome);
    assert.equal(receiver.progress.complete, true);
    assert.equal(await receiver.accept(parts[0]), null);
    await assert.rejects(verifyCompanionPreviewResult(raw, request), /oversize/);
  }
  const packet = completed();
  assert.deepEqual(await new CompanionPreviewResultReceiver(request).accept(JSON.stringify(packet)), packet.outcome);
});

test('framed transfer integrity does not substitute for artifact identity, version or content verification', async () => {
  for (const change of [
    packet => { packet.outcome.artifact.id = 'wrong-artifact'; },
    packet => { packet.outcome.artifact.version = '0'.repeat(64); },
    packet => { packet.outcome.artifact.text += '<p>changed</p>'; },
  ]) {
    const packet = largeResult(125);
    const expected = { ...request, artifactVersion: packet.outcome.artifact.version };
    change(packet);
    const parts = await packCompanionPreviewPayload(JSON.stringify(packet), request.requestId);
    const receiver = new CompanionPreviewResultReceiver(expected);
    for (const part of parts.slice(0, -1)) assert.equal(await receiver.accept(part), null);
    await assert.rejects(receiver.accept(parts.at(-1)), /artifact_mismatch/);
    assert.equal(receiver.progress.complete, false);
    assert.equal(receiver.progress.discarded, true);
  }
});

test('new framing/2 remains request-bound and a remounted semantic receiver accepts historical /1 bytes', async () => {
  const packet = largeResult(125), raw = JSON.stringify(packet), bytes = Buffer.from(raw);
  const expected = { ...request, artifactVersion: packet.outcome.artifact.version };
  const count = Math.ceil(bytes.length / 1024);
  const legacy = Array.from({ length: count }, (_, index) => JSON.stringify({ schema: 'hps-companion-result-part/1',
    requestId: request.requestId, sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length,
    count, index, data: bytes.subarray(index * 1024, (index + 1) * 1024).toString('base64') }));
  const receiver = new CompanionPreviewResultReceiver(expected);
  for (const part of legacy.slice(0, -1)) assert.equal(await receiver.accept(part), null);
  assert.deepEqual(await receiver.accept(legacy.at(-1)), packet.outcome);
  const wrong = new CompanionPreviewResultReceiver({ ...expected, requestId: 'another-request' });
  await assert.rejects(wrong.accept((await packCompanionPreviewPayload(raw, request.requestId))[0]));
  assert.equal(wrong.progress.discarded, true);
});

test('discard and reset prevent an in-flight semantic digest from emitting or changing new progress', async () => {
  for (const action of ['discard', 'reset']) {
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const delayed = { subtle: { digest: (...args) => new Promise(resolve => {
      release = () => resolve(globalThis.crypto.subtle.digest(...args)); started();
    }) } };
    const receiver = new CompanionPreviewResultReceiver(request, delayed);
    const pending = receiver.accept(JSON.stringify(completed()));
    await ready;
    assert.equal(receiver.progress.complete, false);
    receiver[action]();
    release();
    await assert.rejects(pending, /discarded/);
    assert.equal(receiver.progress.complete, false);
    assert.equal(receiver.progress.received, 0);
    assert.equal(receiver.progress.discarded, action === 'discard');
  }
});
