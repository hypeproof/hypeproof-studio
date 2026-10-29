// Jay 2026-10-29 (18:16 screenshot): "실행 중인 것 · 라이브 서버 · 폴더: . · 실행 중 [멈추기]" after the answer ended read
// as work still running ("작업이 멈춘거같은데 왜 아직도 실행중이야?") and the lines ran together. Each running thing is one
// card: status dot + plain title, what it serves (never "."), its address, a note why it stays on, and one 끄기 button
// only while it runs.
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { RunningProcessesPanel } from '../webview-ui/src/RunningProcesses';
import { previewAddress, previewServedPlace, RunningProcesses } from '../src/runningProcesses';

async function main() {
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  // Host helpers: words, never ".".
  assert.equal(previewServedPlace('.', 'HypeProofTrial'), '작업 폴더 전체 (HypeProofTrial)');
  assert.equal(previewServedPlace('.', undefined), '작업 폴더 전체');
  assert.equal(previewServedPlace('site', 'w'), '작업 폴더/site');
  assert.equal(previewServedPlace('작업 폴더 밖', 'w'), '작업 폴더 밖');
  assert.equal(previewAddress('http://127.0.0.1:43299/'), '127.0.0.1:43299');
  assert.equal(previewAddress('https://example.com/'), undefined, 'only a loopback preview address is shown');
  assert.equal(previewAddress('not a url'), undefined);
  assert.equal(previewAddress(undefined), undefined);

  const registry = new RunningProcesses(() => {}, () => {});
  registry.add('live:1', '미리보기 서버', previewServedPlace('.', 'HypeProofTrial'), async () => {}, { address: '127.0.0.1:43299' });
  registry.add('sdk:1', '테스트 감시', undefined, async () => {});
  const running = render(<RunningProcessesPanel entries={registry.list()} onStop={() => {}} />);

  // Structure: a titled section, one card per entry with its state, a dot, a title and actions.
  assert.match(running, /<section class="hps-running-processes" aria-labelledby="hps-running-processes-title"><h2 id="hps-running-processes-title">실행 중인 것<\/h2>/);
  assert.equal(count(running, 'class="hps-process-card"'), 2, 'one card per running thing');
  assert.equal(count(running, 'class="hps-process-dot"'), 2);
  assert.ok(running.includes('data-kind="preview"') && running.includes('data-kind="shell"'));
  assert.ok(running.includes('미리보기 서버 실행 중'), 'plain title for the preview server');
  assert.ok(running.includes('보여 주는 곳: 작업 폴더 전체 (HypeProofTrial)'));
  assert.ok(running.includes('주소: 127.0.0.1:43299'));
  assert.ok(running.includes('미리보기 창을 보는 동안 켜 두어요. 다 봤으면 꺼도 돼요.'), 'says why it is still on');
  assert.ok(!running.includes('폴더: .') && !running.includes('라이브 서버'), 'no "폴더: ." and no jargon title');
  assert.ok(running.includes('>끄기</button>') && running.includes('>멈추기</button>'), 'one button per running card');
  assert.equal(count(running, '<button'), 2);

  // A host that still sends "." (older registry or a direct add) never shows it.
  const dot = render(<RunningProcessesPanel entries={[{ id: 'x', purpose: '미리보기 서버', kind: 'preview', folder: '.', state: 'running' }]} onStop={() => {}} />);
  assert.ok(dot.includes('보여 주는 곳: 작업 폴더 전체') && !dot.includes(': .<'), dot);

  // Stopping: the button stays but is disabled and says 끄는 중; settled: no button at all, no 켜 두어요 note.
  await registry.stop('live:1');
  const stopping = render(<RunningProcessesPanel entries={registry.list().filter(e => e.id === 'live:1')} onStop={() => {}} />);
  assert.ok(stopping.includes('미리보기 서버 끄는 중') && /<button[^>]*disabled=""[^>]*>끄는 중<\/button>/.test(stopping), stopping);
  registry.finish('live:1', 'stopped');
  const stopped = render(<RunningProcessesPanel entries={registry.list().filter(e => e.id === 'live:1')} onStop={() => {}} />);
  assert.ok(stopped.includes('미리보기 서버를 껐어요'));
  assert.ok(!stopped.includes('<button'), 'no button once it is not running');
  assert.ok(!stopped.includes('켜 두어요'));

  // Negative control: nothing running draws nothing.
  assert.equal(render(<RunningProcessesPanel entries={[]} onStop={() => {}} />), '');
  console.log('running-process-card: ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
