import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { packCompanionPreviewPayload, CompanionPreviewPayloadReceiver,
  COMPANION_PREVIEW_PACKET_BYTES, COMPANION_PREVIEW_ENVELOPE_BYTES, COMPANION_PREVIEW_MAX_PARTS } from '../src/companionPreviewPayload.ts';
import { verifyCompanionPreviewResult } from '../src/companionPreviewResult.ts';
const size = text => new TextEncoder().encode(text).length;
const requestId = 'preview-한국'; // Request IDs remain the existing ASCII contract.
const id = 'preview-1';
const html = repeats => '<!doctype html><html lang="ko"><meta charset="utf-8"><button onclick="this.textContent=\'정답이에요! 🎉\'">문제를 풀어 봐요</button><main>'
  + '<p>내가 만든 퀴즈예요. 무엇을 바꿔 볼까요? 🌈</p>'.repeat(repeats) + '</main></html>';
const result = text => JSON.stringify({ schema: 'hps-companion-host-result/1', requestId: id,
  outcome: { state: 'completed', code: 'preview_read', requestId: id,
    artifact: { id: 'quiz', version: createHash('sha256').update(text).digest('hex'), text } } });

test('useful Korean interactive HTML at 8–24KiB survives reversed parts and duplicate delivery exactly', async () => {
  for (const repeats of [120, 300]) {
    const text = html(repeats), raw = result(text);
    assert.ok(size(text) >= 8 * 1024 && size(text) <= 24 * 1024);
    const packets = await packCompanionPreviewPayload(raw, id);
    assert.ok(packets.length > 1 && packets.length <= COMPANION_PREVIEW_MAX_PARTS);
    assert.ok(packets.every(p => size(p) <= COMPANION_PREVIEW_PACKET_BYTES));
    const receiver = new CompanionPreviewPayloadReceiver(id);
    const reversed = [...packets].reverse();
    for (const packet of reversed.slice(0, -1)) {
      assert.equal(await receiver.accept(packet), null);
      assert.equal(await receiver.accept(packet), null);
      assert.equal(receiver.progress.complete, false);
    }
    assert.equal(receiver.progress.received, packets.length - 1);
    assert.equal(await receiver.accept(reversed.at(-1)), raw);
    assert.deepEqual(receiver.progress, { received: packets.length, total: packets.length, bytes: size(raw), complete: true, discarded: false });
    assert.equal(await receiver.accept(reversed.at(-1)), null);
    assert.equal(JSON.parse(raw).outcome.artifact.text, text);
  }
});

test('legacy single packet stays byte-identical and compatible with the existing verifier', async () => {
  const raw = result(html(1));
  assert.deepEqual(await packCompanionPreviewPayload(raw, id), [raw]);
  const receiver = new CompanionPreviewPayloadReceiver(id);
  const emitted = await receiver.accept(raw);
  const artifact = JSON.parse(raw).outcome.artifact;
  assert.deepEqual(await verifyCompanionPreviewResult(emitted, { requestId: id, artifactId: artifact.id, artifactVersion: artifact.version }), JSON.parse(raw).outcome);
  assert.equal(await receiver.accept(raw), null);
});

test('exact envelope ceiling and maximum request ID keep every packet within relay bounds', async () => {
  const longId = 'r'.repeat(128);
  const prefix = JSON.stringify({ schema: 'hps-companion-host-result/1', requestId: longId, outcome: { text: '' } });
  const raw = prefix.replace('"text":""', '"text":"' + 'x'.repeat(COMPANION_PREVIEW_ENVELOPE_BYTES - size(prefix)) + '"');
  assert.equal(size(raw), COMPANION_PREVIEW_ENVELOPE_BYTES);
  const packets = await packCompanionPreviewPayload(raw, longId);
  assert.equal(packets.length, 32);
  assert.ok(packets.every(p => size(p) <= 2032));
  const receiver = new CompanionPreviewPayloadReceiver(longId);
  const emitted = await Promise.all(packets.map(p => receiver.accept(p)));
  assert.deepEqual(emitted.filter(p => p !== null), [raw]);
  await assert.rejects(packCompanionPreviewPayload(raw + ' ', longId));
  await assert.rejects(packCompanionPreviewPayload(result(html(1)), requestId));
});

test('conflicting parts or metadata, wrong requests, and full digest mismatches never emit a result', async () => {
  const packets = await packCompanionPreviewPayload(result(html(100)), id);
  for (const change of [p => { p.data = 'AAAA' + p.data.slice(4); }, p => { p.sha256 = '0'.repeat(64); }, p => { p.requestId = 'another-request'; }, p => { p.count = 49; }]) {
    const receiver = new CompanionPreviewPayloadReceiver(id);
    assert.equal(await receiver.accept(packets[0]), null);
    const changed = JSON.parse(packets[0]); change(changed);
    await assert.rejects(receiver.accept(JSON.stringify(changed)));
    assert.equal(receiver.progress.discarded, true);
    await assert.rejects(receiver.accept(packets[1]));
    receiver.reset();
    assert.deepEqual(receiver.progress, { received: 0, total: 0, bytes: 0, complete: false, discarded: false });
  }
  const receiver = new CompanionPreviewPayloadReceiver(id);
  for (const packet of packets.slice(0, -1)) {
    const changed = JSON.parse(packet); changed.sha256 = '0'.repeat(64);
    assert.equal(await receiver.accept(JSON.stringify(changed)), null);
  }
  const last = JSON.parse(packets.at(-1)); last.sha256 = '0'.repeat(64);
  await assert.rejects(receiver.accept(JSON.stringify(last)));
  assert.equal(receiver.progress.complete, false);
});

test('explicit discard clears partial bytes and reset cancels already queued accepts', async () => {
  const packets = await packCompanionPreviewPayload(result(html(100)), id);
  const receiver = new CompanionPreviewPayloadReceiver(id);
  await receiver.accept(packets[0]); receiver.discard();
  assert.equal(receiver.progress.bytes, 0);
  await assert.rejects(receiver.accept(packets[1]));
  receiver.reset();
  const pending = receiver.accept(packets[0]); receiver.reset();
  await assert.rejects(pending);
  assert.equal(receiver.progress.received, 0);
  await assert.rejects(receiver.accept('x'.repeat(2033)));
});


test('pending accepts are bounded and reset isolates old queue accounting', async () => {
  const packets = await packCompanionPreviewPayload(result(html(120)), id);
  const receiver = new CompanionPreviewPayloadReceiver(id);
  const pending = Array.from({ length: COMPANION_PREVIEW_MAX_PARTS }, () => receiver.accept(packets[0]));
  const overflow = receiver.accept(packets[0]);
  receiver.reset();
  const fresh = packets.map(packet => receiver.accept(packet));
  const settled = await Promise.allSettled([...pending, overflow]);
  assert.ok(settled.every(item => item.status === 'rejected'));
  assert.deepEqual((await Promise.all(fresh)).filter(value => value !== null), [result(html(120))]);
  assert.equal(receiver.progress.complete, true);
});
