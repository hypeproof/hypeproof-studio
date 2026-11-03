import * as vscode from 'vscode';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PersonalContinuationSession, createClaudeCliTransport } from './personalContinuation/index.ts';
import { CONTINUATION_SYSTEM_PROMPT, reviewedPayload } from './personalContinuation/session.ts';
import { personalContinuationHtml } from './personalContinuationView.ts';

export interface PersonalContinuationHostPorts {
  projectLabel: string;
  draft: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  isCurrent(): boolean;
  commitReply(request: { id: string; prompt: string; text: string; source?: 'manual' | 'direct' }): Promise<void>;
  /** Dependency injection for host tests; never read from project settings. */
  transport?: ConstructorParameters<typeof PersonalContinuationSession>[0];
}

/** One explicit personal-client conversation. Does not change the Service connection. */
export function openPersonalContinuation(ports: PersonalContinuationHostPorts): vscode.Disposable {
  const nonce = randomBytes(24).toString('hex');
  // Subscription-backed third-party distribution is not confirmed. Production
  // offers a user-operated official-client handoff, never automatic inference.
  const direct = vscode.env.appName === 'HypeProof Studio Dev' && process.env.HPS_PERSONAL_CLAUDE_EXPERIMENT === '1';
  const session = new PersonalContinuationSession(ports.transport ?? createClaudeCliTransport());
  const panel = vscode.window.createWebviewPanel('hypeproofPersonalContinuation', '개인 Claude Code로 이어하기', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
  let disposed = false, busy = false, generation = 0;
  let reviewed: { digest: string; prompt: string; payload: string; expiresAt: number } | undefined;
  let manualReceipt: { id: string; prompt: string; generation: number } | undefined;
  const current = () => !disposed && ports.isCurrent();
  const post = (value: unknown) => { if (current()) void panel.webview.postMessage(value); };
  const reset = () => { generation++; reviewed = undefined; manualReceipt = undefined; session.invalidate(); busy = false; };
  const fail = (message: string) => post({ type: 'result', message });
  const inspect = async () => {
    reset(); const own = generation;
    if (!direct) { post({ type: 'inspection', ready: true, message: '보낼 내용을 복사해 공식 Claude Code에 직접 붙여 넣어 주세요.', account: 'Studio는 로그인하거나 AI를 호출하지 않아요. 실제 수신 계정·사용량·과금은 공식 Claude Code에서 확인한 뒤 보내 주세요.' }); return; }
    try {
      const result = await session.inspect();
      if (!current() || own !== generation) return;
      const d = result.disclosure;
      post({ type: 'inspection', ready: result.status === 'ready', message: result.status === 'ready' ? '연결한 계정을 확인했어요. 보낼 내용을 검토해 주세요.' : '이 설정에서는 Studio가 안전한 직접 연결을 확인하지 못했어요. 공식 Claude Code에서 확인해 주세요.', account: d ? `${d.account}\n${d.funding}\n${d.billingNotice}` : '' });
    } catch { if (own === generation) post({ type: 'inspection', ready: false, message: 'Claude Code 연결을 확인하지 못했어요. 작업은 그대로예요.' }); }
  };
  const listener = panel.webview.onDidReceiveMessage(async (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;
    if (m.nonce !== nonce || !current()) return;
    if (m.type === 'close') { panel.dispose(); return; }
    if (m.type === 'edit' || m.type === 'cancel') { reset(); fail('전송을 취소했어요. 원래 작업과 입력은 그대로예요.'); return; }
    if (busy) return;
    if (m.type === 'ready' || m.type === 'inspect') { await inspect(); return; }
    if (m.type === 'review') {
      reset();
      if (typeof m.draft !== 'string' || !m.draft.trim() || m.draft.length > 24000 || typeof m.material !== 'string' || m.material.length > 24000 || typeof m.history !== 'boolean') { fail('요청과 자료를 확인해 주세요. 한 칸에 24,000자까지 넣을 수 있어요.'); return; }
      try {
        const own = generation;
        const input = { projectLabel: ports.projectLabel, draft: m.draft, selectedText: m.material ? [{ label: '직접 선택한 자료', text: m.material }] : [], history: m.history ? ports.history : [] };
        if (!direct) {
          const { userPrompt } = reviewedPayload(input);
          const payload = `${CONTINUATION_SYSTEM_PROMPT}\n\n${userPrompt}`;
          const expiresAt = Date.now() + 5 * 60 * 1000;
          const digest = createHash('sha256').update(JSON.stringify({ payload, generation, expiresAt })).digest('hex');
          reviewed = { digest, prompt: m.draft, payload, expiresAt };
          post({ type: 'review', digest, payload }); return;
        }
        busy = true;
        const inspection = await session.inspect();
        if (!current() || own !== generation) return;
        busy = false;
        if (inspection.status !== 'ready' || !inspection.disclosure) { fail('연결한 계정을 다시 확인해 주세요. 아직 전송하지 않았어요.'); return; }
        const d = inspection.disclosure;
        post({ type: 'inspection', ready: true, message: '계정과 전송 내용을 확인한 뒤 동의해 주세요.', account: `${d.account}\n${d.funding}\n${d.billingNotice}` });
        const s = session.prepare(input);
        reviewed = { digest: s.digest, prompt: m.draft, payload: s.userPrompt, expiresAt: s.expiresAt };
        post({ type: 'review', digest: s.digest, payload: `모델: ${s.model}\n\n${s.systemPrompt}\n\n${s.userPrompt}` });
      } catch { busy = false; fail('전송 내용을 준비하지 못했어요. 연결을 다시 확인하고 내용을 줄여 주세요.'); }
      return;
    }
    if (!direct && m.type === 'saveManualReply') {
      const receipt = manualReceipt;
      if (!receipt || receipt.generation !== generation || m.consent !== true || typeof m.text !== 'string' || !m.text.trim() || Buffer.byteLength(m.text) > 64 * 1024) return;
      busy = true; manualReceipt = undefined;
      try {
        await ports.commitReply({ id: receipt.id, prompt: receipt.prompt, text: m.text, source: 'manual' });
        if (current() && receipt.generation === generation) post({ type: 'result', message: '직접 가져온 답변을 같은 작업에 저장했어요.', text: m.text });
      } catch { if (current() && receipt.generation === generation) { manualReceipt = receipt; fail('저장을 완료하지 못했어요. 붙여 넣은 답변은 그대로예요. 다시 저장할 수 있어요.'); } }
      finally { busy = false; }
      return;
    }
    if (m.type !== 'send' || m.consent !== true || !reviewed || m.digest !== reviewed.digest) return;
    const own = generation, draft = reviewed.prompt;
    if (Date.now() >= reviewed.expiresAt) { reset(); fail('검토 시간이 지났어요. 보낼 내용을 다시 확인해 주세요.'); return; }
    if (!direct) {
      const payload = reviewed.payload; reviewed = undefined; busy = true;
      try {
        await vscode.env.clipboard.writeText(payload);
        if (current() && own === generation) { manualReceipt = { id: randomUUID(), prompt: draft, generation }; post({ type: 'copied', message: '복사했어요. 공식 Claude Code에서 계정·과금을 확인하고 붙여 넣어 보내세요. 답변은 아래에 직접 가져올 수 있어요.' }); }
      } catch { if (current() && own === generation) fail('복사하지 못했어요. 내용을 다시 검토한 뒤 시도해 주세요.'); }
      finally { if (own === generation) busy = false; }
      return;
    }
    try {
      const approval = session.approve(reviewed.digest); reviewed = undefined; busy = true; post({ type: 'sending' });
      const result = await session.send(approval);
      if (!current() || own !== generation) return;
      if (result.status === 'success' && result.text && result.requestId) {
        await ports.commitReply({ id: result.requestId, prompt: draft, text: result.text, source: 'direct' });
        if (current() && own === generation) post({ type: 'result', message: '답변을 같은 작업의 대화에 저장했어요.', text: result.text });
      } else {
        const copy: Record<string, string> = { quota: '개인 Claude Code의 사용 한도에 도달했어요. 해당 계정에서 확인해 주세요.', auth: 'Claude Code에서 로그인 상태를 다시 확인해 주세요.', offline: '연결하지 못했어요. 인터넷을 확인한 뒤 직접 다시 시도해 주세요.', cancelled: '전송을 취소했어요.', stale: '계정이나 전송 내용이 바뀌었어요. 다시 검토해 주세요.' };
        fail(`${copy[result.status] ?? '요청을 완료하지 못했어요. 공식 Claude Code에서 연결 상태를 확인해 주세요.'} 작업은 그대로이고, Studio 이용권으로 자동 전환하지 않아요.`);
      }
    } catch { if (current() && own === generation) fail('답변 처리나 저장을 완료하지 못했어요. 원래 작업은 그대로예요. 자동으로 재전송하지 않아요.'); }
    finally { if (own === generation) busy = false; }
  });
  const close = panel.onDidDispose(() => { disposed = true; generation++; session.cancel(); listener.dispose(); close.dispose(); });
  panel.webview.html = personalContinuationHtml(nonce, { projectLabel: ports.projectLabel, draft: ports.draft.slice(0, 24000), historyCount: ports.history.length, direct });
  return { dispose() { session.cancel(); panel.dispose(); } };
}
