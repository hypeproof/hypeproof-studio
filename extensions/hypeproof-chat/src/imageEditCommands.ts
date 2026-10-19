import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { activityConnections, activityService } from './activityConnections';
import { isFreeSeat } from './seatVocabulary';
import { ImageEditClient, imageEditFailureMessage, type ImageEditRequest, type ImageEditResult } from './imageEditClient';
import { prepareImageEditAsset, saveImageEditOutput, imageEditSelection, imageEditComparisonHtml, type ImageEditAsset } from './imageEditAssets';
import { imageBytesHash, inspectEditPng } from './imageEditPng';
import type { ResolvedProfile } from './protocol';

export interface ImageEditCommandOptions { profile: ResolvedProfile; cwd: string; token: string; proxyUrl: string; onSelected?: (relativePath: string) => Promise<void> }
interface Job {
  id: string; originalPath: string; originalSha256: string; activity: string | null; service: string;
  cancelRequested?: boolean; output?: { relativePath: string; sha256: string };
}
interface LocalState { version: 1; workspace: string; jobs: Job[]; selected?: { jobId: string; relativePath: string; sha256: string; activity: string | null; service: string } }
const KEY = 'hps.imageEdit.jobs.v1', TOKEN_KEY = 'hypeproofChat.workshopToken';
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const running = new WeakSet<vscode.ExtensionContext>();
const stopped = '작업 폴더·활동·연결이 바뀌어 결과를 적용하지 않았어요. 원래 폴더에서 작업 기록을 확인해 주세요.';
const friendly = (error: unknown) => error instanceof Error && /^[가-힣]/.test(error.message) && error.message.length < 300 ? error.message : imageEditFailureMessage('unknown');
async function boundedCancel(request: Promise<ImageEditResult>): Promise<ImageEditResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('취소 요청의 서버 접수를 확인하지 못했어요. 이전 작업 확인으로 같은 작업 ID를 조회해 주세요.')), 10_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function currentRoot(cwd: string): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file' || await fs.realpath(folder.uri.fsPath) !== await fs.realpath(cwd)) throw new Error(stopped);
  return fs.realpath(cwd);
}
function identity(context: vscode.ExtensionContext): string | null { return activityConnections(context)?.current?.serverId ?? null; }
function stateFor(context: vscode.ExtensionContext, root: string): LocalState {
  const value = context.workspaceState.get<LocalState>(KEY);
  if (!value) return { version: 1, workspace: root, jobs: [] };
  if (value.version !== 1 || value.workspace !== root || !Array.isArray(value.jobs) || value.jobs.length > 30 || value.jobs.some(job => !UUID.test(job.id) || !HASH.test(job.originalSha256) || typeof job.originalPath !== 'string' || typeof job.service !== 'string')) throw new Error('이 작업 폴더의 이미지 편집 기록을 확인하지 못했어요. 원본은 보존됩니다.');
  return structuredClone(value);
}
async function localFile(root: string, relativePath: string, expected: string): Promise<string> {
  if (!relativePath || path.isAbsolute(relativePath) || /[\\\x00]/.test(relativePath) || relativePath.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('작업 폴더 안의 이미지 파일만 사용할 수 있어요.');
  let file = root;
  for (const part of relativePath.split('/')) { file = path.join(file, part); if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('연결된 파일은 편집 결과로 선택하지 않았어요.'); }
  const handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat(), current = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino || await fs.realpath(file) !== file || await imageBytesHash(await handle.readFile()) !== expected) throw new Error('저장된 이미지의 hash가 바뀌었어요. 결과를 선택하지 않았습니다.');
  } finally { await handle.close(); }
  return file;
}
function costNotice(result: ImageEditResult): string {
  const cost = result.cost;
  if (!cost || cost.recording_state !== 'recorded') return '이미지 편집 비용은 미확인입니다. 비용이 없다는 뜻은 아닙니다.';
  const amount = typeof cost.amount_micro === 'number' && Number.isSafeInteger(cost.amount_micro) && cost.amount_micro >= 0 ? String(cost.amount_micro) : typeof cost.amount_micro === 'string' && /^\d{1,30}$/.test(cost.amount_micro) ? cost.amount_micro : undefined;
  const revision = typeof cost.price_revision === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(cost.price_revision) ? cost.price_revision : undefined;
  const issues = Array.isArray(cost.issues) ? cost.issues : [];
  if (amount !== undefined && cost.unit === 'micro_currency' && typeof cost.currency === 'string' && /^[A-Z]{3}$/.test(cost.currency)) {
    if (cost.pricing === 'partial' || cost.pricing === 'priced' && (issues.length > 0 || !revision)) {
      const details = issues.filter(issue => typeof issue === 'string' && /^[A-Za-z0-9:._-]{1,120}$/.test(issue)).slice(0, 4).join(', ');
      return `이미지 비용 부분 합계: ${amount} micro_currency (${cost.currency}). 누락·미산정 항목이 있어 전체 비용은 미확인입니다.${details ? ` 확인 항목: ${details}.` : ''} 가격 revision: ${revision ?? '미확인'}. 실제 청구 대조는 별도입니다.`;
    }
    if (cost.pricing === 'priced' && revision) return `기록된 이미지 비용: ${amount} micro_currency (${cost.currency}). 가격 revision: ${revision}. 실제 청구 대조는 별도입니다.`;
  }
  return '이미지 편집 비용은 미확인입니다. 비용이 없다는 뜻은 아닙니다.';
}
/** No image is dispatched here. Only an explicitly referenced, explicitly selected local path becomes user-turn context. */
export async function selectedImageEditContext(context: vscode.ExtensionContext, cwd: string, userText: string): Promise<string> {
  if (!/(?:선택(?:한|된)\s*(?:이미지|사진|원본)|편집(?:한|된)?\s*(?:이미지|사진|결과)|누끼\s*(?:이미지|결과)|(?:selected|edited)\s+(?:image|photo)|image\s+edit\s+result)/i.test(userText)) return '';
  const root = await currentRoot(cwd), state = stateFor(context, root), selected = state.selected;
  if (!selected) return '';
  const cfg = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl', 'https://api.hypeproof-ai.xyz/v1');
  if (selected.activity !== identity(context) || selected.service !== activityService(cfg)) throw new Error(stopped);
  const job = state.jobs.find(item => item.id === selected.jobId);
  if (!job || job.activity !== selected.activity || job.service !== selected.service) throw new Error('선택한 이미지의 작업 기록을 확인하지 못했어요.');
  const expected = selected.relativePath === job.originalPath ? job.originalSha256 : selected.relativePath === job.output?.relativePath ? job.output.sha256 : undefined;
  if (expected !== selected.sha256) throw new Error('선택한 이미지가 이 편집 작업의 원본·결과와 일치하지 않아요.');
  await localFile(root, selected.relativePath, selected.sha256);
  return `\n<selected-image-edit>\n사용자가 명시적으로 선택한 로컬 이미지: ${JSON.stringify(selected.relativePath).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\nSHA-256: ${selected.sha256}\n원본 파일은 보존되어 있습니다. 이 경로는 자동 전송이나 추가 실행 권한이 아닙니다. 대상 형태·가장자리 품질은 사람이 확인해야 합니다.\n</selected-image-edit>`;
}

export async function runImageEdit(context: vscode.ExtensionContext, options: ImageEditCommandOptions): Promise<void> {
  if (running.has(context)) return;
  if ((options.profile as ResolvedProfile & { image_edit?: { enabled?: boolean } }).image_edit?.enabled !== true) { void vscode.window.showWarningMessage(imageEditFailureMessage('image_edit_off')); return; }
  running.add(context);
  try {
    const root = await currentRoot(options.cwd), activity = identity(context), service = activityService(options.proxyUrl);
    const profileActivity = options.profile.activity_id ?? null;
    if (activity !== null && profileActivity !== activity) throw new Error(stopped);
    const guard = async () => {
      await currentRoot(root);
      const configured = vscode.workspace.getConfiguration('hypeproofChat').get<string>('proxyUrl', options.proxyUrl);
      if (identity(context) !== activity || activityService(configured) !== service || await context.secrets.get(TOKEN_KEY) !== options.token) throw new Error(stopped);
    };
    await guard();
    const client = new ImageEditClient({ token: options.token, proxyUrl: options.proxyUrl, free: isFreeSeat(options.profile) });
    const read = () => stateFor(context, root);
    const update = async (job: Job) => { await guard(); const state = read(), at = state.jobs.findIndex(item => item.id === job.id); if (at >= 0) state.jobs[at] = job; else { if (state.jobs.length >= 30) throw new Error('저장된 이미지 작업이 많아요. 기존 작업을 먼저 확인해 주세요.'); state.jobs.push(job); } await context.workspaceState.update(KEY, state); };
    const matching = read().jobs.filter(job => job.activity === activity && job.service === service);
    const pending = matching.filter(job => !job.output && !job.cancelRequested);
    const action = await vscode.window.showQuickPick(['새 PNG 편집', ...(matching.length ? ['이전 작업 확인'] : []), ...(pending.length ? ['대기 작업 취소'] : [])], { title: '이미지 편집', placeHolder: '원본은 유지하고 별도 PNG를 만듭니다. 결과 품질은 직접 확인해 주세요.' });
    if (!action) return;
    await guard();
    let job: Job, original: ImageEditAsset, result: ImageEditResult | undefined; let costShown = false;
    if (action !== '새 PNG 편집') {
      const chosen = await vscode.window.showQuickPick((action === '대기 작업 취소' ? pending : matching).map(item => ({ label: item.originalPath, description: `${item.id}${item.cancelRequested ? ' · 취소 요청됨' : ''}`, job: item })), { title: action === '대기 작업 취소' ? '취소할 작업 선택' : '확인할 이전 작업 선택' });
      if (!chosen) return;
      job = chosen.job; await guard();
      if (action === '대기 작업 취소') {
        job.cancelRequested = true; await update(job);
        const cancelled = await boundedCancel(client.cancel(job.id)); await guard();
        if (cancelled.id !== job.id || cancelled.original_sha256 !== job.originalSha256) throw new Error('취소 응답의 작업 기록이 일치하지 않아 서버 접수를 확인하지 못했어요.');
        void vscode.window.showInformationMessage(costNotice(cancelled));
        void vscode.window.showInformationMessage('취소를 요청했어요. 제공자 처리 중단이나 비용 취소는 확인되지 않았습니다. 늦게 완료되어도 자동 적용하지 않습니다.'); return;
      }
      result = await client.status(job.id); await guard();
      if (result.id !== job.id || result.original_sha256 !== job.originalSha256) throw new Error('편집 작업과 원본 기록이 일치하지 않아 결과를 적용하지 않았어요.');
      void vscode.window.showInformationMessage(costNotice(result)); costShown = true;
      original = await prepareImageEditAsset(root, job.originalPath);
      if (original.sha256 !== job.originalSha256) throw new Error('원본 파일이 작업 이후 바뀌었어요. 서버 상태는 조회했지만 이전 결과를 자동 저장하거나 적용하지 않았어요.');
    } else {
      const chosen = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: vscode.Uri.file(root), filters: { PNG: ['png'] }, openLabel: 'PNG 원본 선택' });
      if (!chosen?.[0]) return;
      await guard();
      const bases = [root, options.cwd, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath].filter((base): base is string => !!base);
      const relative = bases.map(base => path.relative(base, chosen[0]!.fsPath).split(path.sep).join('/')).find(rel => rel && !path.isAbsolute(rel) && !rel.split('/').includes('..'));
      if (!relative) throw new Error('작업 폴더 안의 PNG 원본을 선택해 주세요.');
      original = await prepareImageEditAsset(root, relative);
      const operation = await vscode.window.showQuickPick(['배경 제거 (투명 PNG)', '지시대로 편집'], { title: '편집 작업 선택' });
      if (!operation) return;
      const instruction = operation === '배경 제거 (투명 PNG)' ? 'Remove only the background. Preserve the main subject.' : await vscode.window.showInputBox({ title: '변경할 부분', prompt: '바꿀 대상과 원하는 결과를 구체적으로 적어 주세요.', ignoreFocusOut: true });
      if (instruction === undefined || !instruction.trim()) return;
      const preserve = await vscode.window.showInputBox({ title: '유지할 대상·세부 형태', prompt: '예: 키보드의 키 배열, 글자, 각도와 제품 형태', ignoreFocusOut: true });
      if (preserve === undefined || !preserve.trim()) return;
      const transparent = operation === '배경 제거 (투명 PNG)' ? '투명 배경' : await vscode.window.showQuickPick(['현재 배경 유지', '투명 배경'], { title: '결과 배경' });
      if (!transparent) return;
      const confirm = await vscode.window.showInformationMessage(`선택한 이미지 ${original.relativePath}와 편집·보존 지시를 이미지 제공자에게 보냅니다. 비용은 미확인이며 요청 뒤 취소해도 비용이 생길 수 있습니다. 원본은 보존됩니다.${matching.length ? ' 이전 작업이 남아 있습니다. 이 요청은 별도 새 작업입니다.' : ''}`, { modal: true }, '이미지를 보내 편집');
      if (confirm !== '이미지를 보내 편집') return;
      await guard();
      job = { id: randomUUID(), originalPath: original.relativePath, originalSha256: original.sha256, activity, service };
      // Persist identity BEFORE dispatch. Images, instructions, preservation text and credentials stay out of workspace state.
      await update(job);
      const input: ImageEditRequest = { schema: 'hps-image-edit/1', original: { data_url: original.dataUrl, sha256: original.sha256 }, operation: operation === '배경 제거 (투명 PNG)' ? 'remove_background' : 'edit', instruction: instruction.trim(), preserve: preserve.trim(), transparent: transparent === '투명 배경' };
      result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '이미지 편집 중 · 원본 유지', cancellable: true }, async (_progress, token) => {
        const controller = new AbortController(); let cancelTask: Promise<unknown> | undefined; let cancelAccepted = false;
        const cancel = () => { controller.abort(); job.cancelRequested = true; cancelTask ??= update(job).then(() => boundedCancel(client.cancel(job.id))).then(async cancelled => { await guard(); if (cancelled.id !== job.id || cancelled.original_sha256 !== job.originalSha256) throw new Error('cancel_identity_mismatch'); cancelAccepted = true; void vscode.window.showInformationMessage(costNotice(cancelled)); }).catch(() => {}); };
        const subscription = token.onCancellationRequested(cancel);
        if (token.isCancellationRequested) cancel();
        try {
          if (job.cancelRequested) { await cancelTask; return undefined; }
          await guard();
          let status = await client.start(job.id, input, controller.signal);
          for (let poll = 0; ['queued', 'dispatched'].includes(status.state) && poll < 15 && !job.cancelRequested; poll++) {
            await new Promise(resolve => setTimeout(resolve, 1000)); await guard();
            if (!job.cancelRequested) status = await client.status(job.id);
          }
          return status;
        } catch (error) { if (!job.cancelRequested) throw error; return undefined; }
        finally { subscription.dispose(); await cancelTask; if (job.cancelRequested && !cancelAccepted) void vscode.window.showWarningMessage('취소 요청의 서버 접수를 확인하지 못했어요. 제공자 처리·비용은 미확인입니다. 이전 작업 확인으로 상태를 조회해 주세요.'); }
      });
      if (job.cancelRequested) { void vscode.window.showInformationMessage('취소를 요청했어요. 제공자 처리 중단·비용 취소는 미확인입니다. 늦은 완료는 자동 저장·적용하지 않습니다. 이전 작업 확인으로 상태를 조회할 수 있어요.'); return; }
    }
    await guard();
    if (result && (result.id !== job.id || result.original_sha256 !== job.originalSha256)) throw new Error('편집 작업과 원본 기록이 일치하지 않아 결과를 적용하지 않았어요.');
    if (result && !costShown) void vscode.window.showInformationMessage(costNotice(result));
    if (job.cancelRequested || result?.cancel_requested || result?.state === 'completed_after_cancel') { void vscode.window.showInformationMessage('취소 요청이 있는 작업입니다. 늦게 완료된 결과는 자동 저장하거나 적용하지 않았어요.'); return; }
    if (!job.output) {
      if (!result || result.id !== job.id || result.original_sha256 !== job.originalSha256) throw new Error('편집 작업과 원본 기록이 일치하지 않아 결과를 저장하지 않았어요.');
      if (result.state !== 'succeeded') { void vscode.window.showInformationMessage(result.state === 'failed' ? imageEditFailureMessage(result.error_code ?? 'unknown', isFreeSeat(options.profile)) : '완료를 아직 확인하지 못했어요. 새 요청을 보내기 전에 이전 작업 확인으로 같은 작업 ID를 조회해 주세요.'); return; }
      const bytes = await client.output(job.id); await guard();
      const saved = await saveImageEditOutput(root, original, result, bytes); job.output = { relativePath: saved.relativePath, sha256: saved.sha256 }; await update(job);
    }
    if (result?.output && result.output.sha256 !== job.output.sha256) throw new Error('저장된 결과와 서버 작업 기록의 hash가 달라 적용하지 않았어요.');
    const edited = await localFile(root, job.output.relativePath, job.output.sha256);
    await inspectEditPng(await fs.readFile(edited));
    await guard();
    const panel = vscode.window.createWebviewPanel('hypeproof.imageEditComparison', '이미지 편집 전후 비교', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [vscode.Uri.file(root)] });
    panel.webview.html = imageEditComparisonHtml({ originalUri: panel.webview.asWebviewUri(vscode.Uri.file(path.join(root, original.relativePath))).toString(), editedUri: panel.webview.asWebviewUri(vscode.Uri.file(edited)).toString(), originalPath: original.relativePath, editedPath: job.output.relativePath, nonce: randomBytes(24).toString('base64url'), source: panel.webview.cspSource });
    let selecting = false;
    const receive = panel.webview.onDidReceiveMessage(async message => {
      if (message?.type !== 'imageEditSelection' || selecting) return;
      selecting = true;
      try {
        if (message.action !== 'adopt' && message.action !== 'restore') throw new Error('이미지 선택 동작이 올바르지 않아요.');
        await guard();
        if ((await prepareImageEditAsset(root, original.relativePath)).sha256 !== job.originalSha256) throw new Error('원본 파일이 바뀌어 이전 결과를 적용하지 않았어요.');
        const relativePath = imageEditSelection(original, job.output!.relativePath, message.action), sha256 = message.action === 'restore' ? original.sha256 : job.output!.sha256;
        await localFile(root, relativePath, sha256); await guard();
        const state = read(); state.selected = { jobId: job.id, relativePath, sha256, activity, service }; await context.workspaceState.update(KEY, state);
        if (options.onSelected) await options.onSelected(relativePath);
        await panel.webview.postMessage({ type: 'imageEditSelected', relativePath });
        void vscode.window.showInformationMessage(`선택한 이미지: ${relativePath}. 원본은 보존됩니다. 대상 형태·가장자리 품질은 자동 검증되지 않았습니다.`);
      } catch (error) { void vscode.window.showWarningMessage(friendly(error)); }
      finally { selecting = false; }
    });
    const disposed = panel.onDidDispose(() => receive.dispose());
    context.subscriptions.push(panel, receive, disposed);
    void vscode.window.showInformationMessage('편집 결과를 별도 파일로 저장했어요. 아직 사용하도록 선택하지 않았습니다. 전후 비교에서 대상 형태·가장자리를 확인해 주세요.');
  } catch (error) { void vscode.window.showWarningMessage(friendly(error)); }
  finally { running.delete(context); }
}
