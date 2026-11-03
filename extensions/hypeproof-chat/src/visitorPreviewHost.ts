import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { startVisitorSnapshot, visitorPreviewHtml, type VisitorPreview } from './visitorPreview';
let active = false;
/** Closing, cancellation, timeout or unavailable preview never authorizes publication. */
export const showVisitorPreview: VisitorPreview = async snapshot => {
  if (active) return false;
  active = true;
  let server: Awaited<ReturnType<typeof startVisitorSnapshot>> | undefined;
  let panel: vscode.WebviewPanel | undefined;
  try {
    server = await startVisitorSnapshot(snapshot);
    panel = vscode.window.createWebviewPanel('hypeproof.visitorPreview', '공개 전 방문자 미리보기', vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
    const target = panel;
    const nonce = randomBytes(24).toString('hex');
    return await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (answer: boolean) => { if (finished) return; finished = true; clearTimeout(timer); listener.dispose(); closed.dispose(); resolve(answer); };
      const timer = setTimeout(() => finish(false), 5 * 60_000);
      const closed = target.onDidDispose(() => finish(false));
      const listener = target.webview.onDidReceiveMessage(message => { if (message?.nonce === nonce && ['next','cancel'].includes(message.action)) finish(message.action === 'next'); });
      target.webview.html = visitorPreviewHtml(snapshot, server!.url, nonce);
      // The frame reached the snapshot server: tell the panel, bound to this preview's nonce.
      void server!.served.then(() => { if (!finished) return target.webview.postMessage({ type: 'served', nonce }); }).then(undefined, () => undefined);
    });
  } catch { return false; }
  finally { panel?.dispose(); server?.close(); active = false; }
};
