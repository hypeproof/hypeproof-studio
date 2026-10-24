import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { BrowserViewStorageScope, IBrowserViewService, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { capturePageThumbnail } from './capture.js';
let busy=false;
CommandsRegistry.registerCommand('_hps.pageThumbnail.capture',async(accessor,url:unknown)=>{
 if(busy)return null;busy=true;
 try {
 const service=ProxyChannel.toService<IBrowserViewService>(accessor.get(IMainProcessService).getChannel(ipcBrowserViewChannelName));
 return await capturePageThumbnail(url,'hps-thumbnail-'+generateUuid(),{
  create:async id=>{await service.getOrCreateBrowserView(id,BrowserViewStorageScope.Ephemeral)},
  hide:id=>service.setVisible(id,false),
  // No real window owns this view: layout sets its viewport without attaching it to the desktop.
  layout:(id,width,height)=>service.layout(id,{windowId:0,x:0,y:0,width,height,zoomFactor:1,cornerRadius:0}),
  load:(id,target)=>service.loadURL(id,target),
  state:async id=>{const s=await service.getState(id);return {url:s.url,title:s.title,error:s.lastError}},
  screenshot:async id=>'data:image/jpeg;base64,'+encodeBase64(await service.captureScreenshot(id,{quality:70})),
  destroy:id=>service.destroyBrowserView(id),
 })
 }finally{busy=false}
});
