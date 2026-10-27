import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { verifyCompanionPreviewResult } from '../src/companionPreviewResult.ts';

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
