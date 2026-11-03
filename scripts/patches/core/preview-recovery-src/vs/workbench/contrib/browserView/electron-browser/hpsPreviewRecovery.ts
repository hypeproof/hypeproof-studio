/** Studio-owned preview error surface. Classification and authorization remain in the extension host. */
export interface HpsPreviewRecovery {
 readonly requestId: string;
 readonly url: string;
 readonly text: string;
 readonly action: 'restart_preview' | 'show_files' | 'retry';
 readonly actionLabel: string;
 readonly detail: string;
}

/** Reject malformed command results; never interpret page text as markup or a command. */
export function parseHpsPreviewRecovery(value: unknown, url: string): HpsPreviewRecovery | undefined {
 if (!value || typeof value !== 'object') { return undefined; }
 const v = value as Record<string, unknown>;
 if (v.url !== url || typeof v.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(v.requestId)) { return undefined; }
 if (typeof v.action !== 'string' || !['restart_preview', 'show_files', 'retry'].includes(v.action)) { return undefined; }
 for (const key of ['text', 'actionLabel', 'detail']) {
  if (typeof v[key] !== 'string' || !(v[key] as string).length || (v[key] as string).length > 512) { return undefined; }
 }
 return {requestId: v.requestId, url, text: v.text as string, action: v.action as HpsPreviewRecovery['action'], actionLabel: v.actionLabel as string, detail: v.detail as string};
}

/** Real DOM renderer, shared by the shell integration and isolated browser acceptance tests. */
export function renderHpsPreviewRecovery(container: HTMLElement, view: HpsPreviewRecovery,
 run: (requestId: string, url: string, action: HpsPreviewRecovery['action']) => Promise<boolean>, focus = true): () => void {
 container.classList.add('hps-preview-error-host');
 const doc = container.ownerDocument;
 const surface = doc.createElement('section'); surface.className = 'hps-preview-error';
 surface.setAttribute('aria-label', '미리보기 안내');
 const line = doc.createElement('p'); line.className = 'hps-preview-error-cause'; line.textContent = view.text;
 const button = doc.createElement('button'); button.type = 'button'; button.textContent = view.actionLabel;
 const note = doc.createElement('p'); note.className = 'hps-preview-error-note'; note.setAttribute('role', 'status');
 const details = doc.createElement('details'); const summary = doc.createElement('summary'); summary.textContent = '자세히';
 const code = doc.createElement('code'); code.textContent = view.detail; details.append(summary, code);
 surface.append(line, button, note, details); container.replaceChildren(surface);
 let disposed = false, busy = false;
 const click = async () => {
  if (disposed || busy) { return; }
  busy = true; button.disabled = true; note.textContent = '';
  try {
   const accepted = await run(view.requestId, view.url, view.action);
   if (!disposed && !accepted) { note.textContent = '미리보기 상태가 바뀌었어요. 다시 확인해 주세요.'; }
  } catch {
   if (!disposed) { note.textContent = '실행하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
  } finally {
   if (!disposed) { busy = false; button.disabled = false; }
  }
 };
 button.addEventListener('click', click); if (focus) { button.focus(); }
 return () => { disposed = true; button.removeEventListener('click', click); surface.remove(); container.classList.remove('hps-preview-error-host'); };
}
