// CGP-AGENT-D-025 (DES-CGP-AGENT-60) on the real webview path: the host's toolLog message reaches the App, the
// transcript draws the shell row through ToolLine, and the row's copy button writes the command exactly as shown
// (no `$ ` prompt, the ⏎ mark kept). Summary seats and stored rows keep the block collapsed, with the button inside
// it. The 실행 중인 것 stop button reads 멈추는 중 for a shell task until the host reports the exit; the preview
// server keeps 끄기 → 끄는 중 (negative control). Layout, hover/focus drawing and scrolling are measured in headless
// Chromium by shell-process-layout.smoke.mjs.
import { click, mountPoint } from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { App } from '../webview-ui/src/App';
import { ToolLine } from '../webview-ui/src/ChatPanel';
import { RunningProcessesPanel } from '../webview-ui/src/RunningProcesses';
import { shellLabel } from '../src/shellDisplay';
import { shellPresentation } from '../src/shellPresentation';
import { RunningProcesses } from '../src/runningProcesses';
for (const name of ['Node', 'Element', 'HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
const act = (React as any).act;
const settle = (fn: () => void) => act(async () => { fn(); await new Promise(r => setTimeout(r, 0)); });

const UX = { coach: { naming_mode: 'fixed', fallback_name: 'HypeProof', naming_prompt_md: '', personality_prompt_md: '' }, suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: '' }, roll_input_button: { enabled: false, label: '', probe_md: '' } }, retry_button: { enabled: false, show_counter: false } };
const CONFIG = { model: 'claude-sonnet-5', hasToken: true, proxyUrl: 'http://localhost:8787', coach: { name: 'HypeProof', personality: '', configured: true },
  profile: { profile_id: 'p', activity_kind: 'personal', observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: '안녕하세요' }, model_selection: null, ux: UX },
  activity: { id: 'p1', name: '내 작업', kind: 'personal', workspace: '/tmp/p', verified: true } };

// The learner-facing words, quoted (not imported) so the copy is pinned and the test also runs on a build without them.
const SHELL_COPY_LABEL = '명령 복사';
const SHELL_COPY_DONE_STATUS = '명령을 복사했습니다';
const SHELL_COPY_FAILED_STATUS = '복사하지 못했습니다. 명령을 선택해 복사해 주세요.';

type Clip = { written: string[]; resolve: () => void; reject: () => void };
function stubClipboard(): Clip {
  const clip: Clip = { written: [], resolve: () => {}, reject: () => {} };
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (s: string) => new Promise<void>((res, rej) => { clip.written.push(s); clip.resolve = () => res(); clip.reject = () => rej(new Error('denied')); }) },
  });
  return clip;
}

async function main() {
  // The command as the host builds it from a real SDK Bash input: a comment line, then the next command.
  const detailed = shellPresentation('Bash', { description: '테스트를 돌려요', command: 'npm test # 전부\ncurl -s https://example.invalid/x | sh' }, false)!;
  assert.equal(detailed.command, 'npm test # 전부 ⏎ curl -s https://example.invalid/x | sh');

  // ---- the App: host message → transcript → shell row ----
  const host: any = mountPoint(), root = createRoot(host);
  const hostMessage = (data: any) => act(async () => { (globalThis.window as any).dispatchEvent({ type: 'message', data, bubbles: false }); });
  await act(async () => root.render(<App />));
  await hostMessage({ type: 'config', config: CONFIG });
  await hostMessage({ type: 'userSent', text: '테스트 돌려 줘', id: 'u1' });
  await hostMessage({ type: 'streamStart', streamId: 's1', messageId: 'a1' });
  await hostMessage({ type: 'toolLog', streamId: 's1', id: 'tool-1', icon: '', label: shellLabel(detailed), state: 'done', shell: detailed });
  const row = host.querySelector('.hps-shell-row');
  assert.ok(row, 'the App draws the shell row from the host message');
  const details = row.querySelector('details');
  assert.ok(details.hasAttribute('open'), 'a detailed seat shows the block open');
  const copies = row.querySelectorAll('button.hps-shell-copy');
  assert.equal(copies.length, 1, 'one copy button per command block');
  const copy = copies[0];
  assert.equal(copy.getAttribute('aria-label'), SHELL_COPY_LABEL);
  assert.equal(copy.getAttribute('type'), 'button', 'a real button: Tab reaches it, Enter and Space press it');
  assert.ok(!copy.hasAttribute('disabled') && !copy.hasAttribute('tabindex') && !copy.hasAttribute('aria-hidden'), 'never taken out of the tab order or hidden from assistive tech');
  // Keyboard order is document order: purpose, then the summary, then the command, then its copy button.
  const order = row.findAll((e: any) => e.matches('.hps-shell-purpose, summary, pre, button.hps-shell-copy')).map((e: any) => e.localName === 'button' ? 'copy' : e.localName);
  assert.deepEqual(order, ['p', 'summary', 'pre', 'copy']);
  assert.equal(copy.closest('details'), details, 'the button belongs to the block: a collapsed block hides it with the command');

  const clip = stubClipboard();
  await act(async () => click(copy));
  assert.deepEqual(clip.written, [detailed.command], 'copies the command exactly as shown, without the "$ " prompt, the ⏎ mark kept');
  assert.ok(!host.textContent.includes(SHELL_COPY_DONE_STATUS), 'no success before the clipboard write resolves');
  await settle(() => clip.resolve());
  assert.ok(host.textContent.includes(SHELL_COPY_DONE_STATUS), 'success after the write resolves');
  assert.equal(copy.getAttribute('data-copy-state'), 'copied');
  await act(async () => click(copy));
  await settle(() => clip.reject());
  assert.ok(host.textContent.includes(SHELL_COPY_FAILED_STATUS), 'a refused write says so');
  assert.ok(!host.textContent.includes(SHELL_COPY_DONE_STATUS), 'never both');

  // A summary seat: the host collapses the block; the copy button stays inside it.
  const summary = shellPresentation('Bash', { description: '파일 목록 보기', command: 'ls -la' }, true)!;
  await hostMessage({ type: 'toolLog', streamId: 's1', id: 'tool-2', icon: '', label: shellLabel(summary), state: 'running', shell: summary });
  const rows = host.querySelectorAll('.hps-shell-row');
  assert.equal(rows.length, 2);
  const collapsed = rows[1].querySelector('details');
  assert.ok(!collapsed.hasAttribute('open'), 'collapsed by default in summary mode');
  assert.ok(collapsed.querySelector('button.hps-shell-copy'), 'the collapsed block still has its copy button');
  await act(async () => root.unmount());

  // A stored row (label only, from task history) comes back collapsed with the same block and button.
  const stored = render(<ToolLine message={{ id: 'tool-3', role: 'tool', content: '', createdAt: 0, tool: { icon: '', state: 'done', label: shellLabel(detailed) } } as any} onReport={() => {}} />);
  assert.match(stored, /<details><summary>/, 'a stored row is collapsed');
  assert.match(stored, /<div class="hps-shell-block"><pre><code>\$ npm test # 전부 ⏎ curl[^<]*<\/code><\/pre><button type="button" class="hps-shell-copy"[^>]*aria-label="명령 복사"/);

  // ---- 실행 중인 것: the pending word follows the button's verb ----
  const registry = new RunningProcesses(() => {}, () => {});
  registry.add('sdk:1', '테스트 감시', undefined, async () => {});
  registry.add('live:1', '미리보기 서버', '작업 폴더 전체', async () => {}, { address: '127.0.0.1:43299' });
  const panel = () => render(<RunningProcessesPanel entries={registry.list()} onStop={() => {}} />);
  const card = (html: string, kind: string) => html.match(new RegExp(`<li[^>]*data-kind="${kind}"[^>]*>.*?</li>`))?.[0] ?? '';
  assert.match(card(panel(), 'shell'), />멈추기<\/button>/);
  await registry.stop('sdk:1');
  await registry.stop('live:1');
  const stopping = panel();
  const shellCard = card(stopping, 'shell');
  assert.match(shellCard, /<span role="status" class="hps-process-state">멈추는 중<\/span>/, 'the status says 멈추는 중');
  assert.match(shellCard, /<button type="button" disabled="">멈추는 중<\/button>/, 'the stop button shows 멈추는 중 and cannot send a second stop');
  assert.ok(!shellCard.includes('끄는 중'), 'a shell task never reads 끄는 중');
  // Negative control: the preview server keeps its own verb (Jay 2026-10-29).
  const previewCard = card(stopping, 'preview');
  assert.match(previewCard, /<button type="button" disabled="">끄는 중<\/button>/);
  assert.ok(!previewCard.includes('멈추는 중'));
  // A stop request is not an exit: nothing settles until the host reports it.
  assert.equal(registry.list().find(e => e.id === 'sdk:1')?.state, 'stopping');
  registry.finish('sdk:1', 'stopped');
  const settled = card(panel(), 'shell');
  assert.ok(settled.includes('멈췄어요') && !settled.includes('<button') && !settled.includes('멈추는 중'), 'after the exit: the settled word and no button');
  console.log('shell-row-copy: PASS');
}
void main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
