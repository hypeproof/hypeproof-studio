/** Shell-owned foreground toast and opt-in native transport for Studio task notices. */
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { HPS_NOTICE_COPY, HPS_NOTICE_COOLDOWN, hpsMountNotice, hpsNoticeRequest } from './hpsNoticeToast.js';

const recent = new Map<string, number>();
const active = new Map<string, { dispose(): void }>();
CommandsRegistry.registerCommand('_hypeproof.notice.show', async (accessor, raw: unknown) => {
 const request = hpsNoticeRequest(raw);
 if (!request) { return { supported: true, clicked: false }; }
 const now = Date.now();
 for (const [key, at] of recent) { if (now - at >= HPS_NOTICE_COOLDOWN) { recent.delete(key); } }
 if (recent.has(request.task) || active.has(request.id)) { return { supported: true, clicked: false }; }
 recent.set(request.task, now);
 const layout = accessor.get(IWorkbenchLayoutService), native = accessor.get(INativeHostService), host = accessor.get(IHostService);
 const os = accessor.get(IConfigurationService).getValue<boolean>('hypeproofChat.osTaskNotices') === true && !host.hasFocus;
 // A hidden chat cannot host a visible toast. The containing workbench is the fallback anchor.
 const container = layout.activeContainer;
 return new Promise<{ supported: boolean; clicked: boolean }>(resolve => {
  let settled = false;
  const complete = (clicked: boolean) => {
   if (settled) { return; } settled = true;
   active.delete(request.id); toast.dispose();
   void native.clearToast(request.id).catch(() => {});
   if (clicked && container.ownerDocument.defaultView) {
    void host.focus(container.ownerDocument.defaultView).then(() => resolve({ supported: true, clicked }), () => resolve({ supported: true, clicked }));
   } else { resolve({ supported: true, clicked }); }
  };
  const toast = hpsMountNotice(container, request.kind, complete);
  active.set(request.id, { dispose: () => complete(false) });
  if (os) {
   void native.showToast({ id: request.id, title: 'HypeProof Studio', body: HPS_NOTICE_COPY[request.kind], silent: true }).then(result => { if (result.clicked) { complete(true); } }, () => {});
  }
 });
});
CommandsRegistry.registerCommand('_hypeproof.notice.hide', (_accessor, id: unknown) => {
 if (typeof id === 'string') { active.get(id)?.dispose(); }
});
