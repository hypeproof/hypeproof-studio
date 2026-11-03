/** Studio notice presentation. Fixed copy only; no answer or approval payload enters the DOM. */
export const HPS_NOTICE_COPY = {
 done: 'AI 답이 준비됐어요.',
 error: 'AI가 이번 답을 끝내지 못했어요. 채팅에서 확인해 주세요.',
 approval: '코치가 기다려요: 작업 허락',
 browserApproval: '코치가 기다려요: 미리보기 열기 허락',
} as const;
export type HpsNoticeKind = keyof typeof HPS_NOTICE_COPY;
export const HPS_NOTICE_DURATION = 5_000;
export const HPS_NOTICE_COOLDOWN = 10_000;
export function hpsNoticeRequest(value: unknown): { id: string; task: string; kind: HpsNoticeKind } | null {
 if (!value || typeof value !== 'object') { return null; }
 const v = value as Record<string, unknown>;
 if (typeof v.id !== 'string' || !/^[a-f0-9-]{36}$/.test(v.id) || typeof v.task !== 'string' || !/^[a-f0-9]{64}$/.test(v.task) || typeof v.kind !== 'string' || !Object.hasOwn(HPS_NOTICE_COPY, v.kind)) { return null; }
 return { id: v.id, task: v.task, kind: v.kind as HpsNoticeKind };
}
/** No auto-focus, no animation, and no HTML parser. A focused action is retained until blur. */
export function hpsMountNotice(container: HTMLElement, kind: HpsNoticeKind, choose: (open: boolean) => void, schedule: typeof setTimeout = setTimeout, cancel: typeof clearTimeout = clearTimeout): { dispose(): void } {
 const doc = container.ownerDocument;
 const host = doc.createElement('section');
 host.className = 'hps-task-notice';
 host.setAttribute('aria-label', '코치 알림');
 Object.assign(host.style, { position: 'absolute', right: '16px', bottom: '32px', zIndex: '10000', display: 'flex', alignItems: 'center', gap: '12px', maxWidth: 'min(420px, calc(100% - 32px))', boxSizing: 'border-box', padding: '12px', border: '1px solid var(--vscode-notifications-border, CanvasText)', borderRadius: '8px', background: 'var(--vscode-notifications-background, Canvas)', color: 'var(--vscode-notifications-foreground, CanvasText)', fontFamily: 'var(--vscode-font-family, system-ui, sans-serif)', fontSize: '14px', lineHeight: '1.5', overflowWrap: 'anywhere' });
 const text = doc.createElement('span');
 text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite'); text.setAttribute('aria-atomic', 'true');
 text.style.minWidth = '0';
 const button = doc.createElement('button'); button.type = 'button'; button.textContent = '열기';
 Object.assign(button.style, { minWidth: '44px', minHeight: '44px', flexShrink: '0', font: 'inherit', color: 'var(--vscode-button-foreground, ButtonText)', background: 'var(--vscode-button-background, ButtonFace)', border: '1px solid var(--vscode-contrastBorder, transparent)', borderRadius: '4px', cursor: 'pointer' });
 button.addEventListener('focus', () => { button.style.outline = '2px solid var(--vscode-focusBorder, Highlight)'; button.style.outlineOffset = '2px'; });
 button.addEventListener('blur', () => { button.style.outline = ''; if (expired) { finish(false); } });
 host.append(text, button); container.append(host);
 let closed = false, expired = false;
 const finish = (open: boolean) => { if (closed) { return; } closed = true; cancel(timer); host.remove(); choose(open); };
 button.addEventListener('click', () => finish(true));
 const timer = schedule(() => { expired = true; if (!host.contains(doc.activeElement)) { finish(false); } }, HPS_NOTICE_DURATION);
 // Populate the live region after mounting it without moving focus or touching the composer.
 text.textContent = HPS_NOTICE_COPY[kind];
 return { dispose: () => finish(false) };
}
