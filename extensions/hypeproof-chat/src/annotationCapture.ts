// CDP selection uses an isolated world; only trusted user pointer events complete it.
import type { CdpLike } from './experimentBrowser';
export interface Rectangle { x: number; y: number; width: number; height: number }
export function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
export function rectangleValid(r: Rectangle): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width >= 2 && r.height >= 2 && r.width * r.height <= 16000000;
}
export async function annotationWorld(cdp: CdpLike): Promise<number> {
  const tree = await cdp.send('Page.getFrameTree', {});
  const world = await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'hps-annotation' });
  return world.executionContextId;
}
export async function dragRectangle(cdp: CdpLike): Promise<Rectangle> {
  const contextId = await annotationWorld(cdp);
  const result = await cdp.send('Runtime.evaluate', { contextId, awaitPromise: true, returnByValue: true, expression: `new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.setAttribute('aria-label', '영역을 끌어서 골라 주세요. Escape로 취소');
    Object.assign(layer.style, {position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',touchAction:'none'});
    const box = document.createElement('div');
    Object.assign(box.style, {position:'absolute',border:'2px solid Highlight',background:'rgba(0,100,200,.15)',pointerEvents:'none'});
    layer.append(box); document.documentElement.append(layer);
    let start;
    const done = (value) => { clearTimeout(timer); document.removeEventListener('keydown', cancel, true); layer.remove(); resolve(value); };
    const cancel = e => { if(e.isTrusted && e.key==='Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', cancel, true);
    const timer = setTimeout(()=>done(null),60000);
    layer.onpointerdown = e => { if(!e.isTrusted || e.button!==0) return; e.preventDefault(); start={x:e.clientX,y:e.clientY}; layer.setPointerCapture(e.pointerId); };
    layer.onpointermove = e => { if(!e.isTrusted || !start) return; Object.assign(box.style,{left:Math.min(start.x,e.clientX)+'px',top:Math.min(start.y,e.clientY)+'px',width:Math.abs(e.clientX-start.x)+'px',height:Math.abs(e.clientY-start.y)+'px'}); };
    layer.onpointerup = e => { if(!e.isTrusted || !start) return; done({x:Math.min(start.x,e.clientX)+scrollX,y:Math.min(start.y,e.clientY)+scrollY,width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)}); };
  })` });
  const rect = result?.result?.value;
  if (!rect || !rectangleValid(rect)) throw new Error('영역 선택을 취소했어요.');
  return rect;
}
export async function marker(cdp: CdpLike, number: number, rect: Rectangle | null): Promise<void> {
  const contextId = await annotationWorld(cdp);
  await cdp.send('Runtime.evaluate', { contextId, expression: `(() => {
    const key = 'hps-annotation-' + ${JSON.stringify(number)};
    document.getElementById(key)?.remove();
    const rect = ${JSON.stringify(rect)}; if (!rect) return;
    const mark = document.createElement('span'); mark.id=key; mark.setAttribute('aria-hidden','true'); mark.textContent=${JSON.stringify(String(number))};
    Object.assign(mark.style,{position:'absolute',left:rect.x+'px',top:rect.y+'px',zIndex:'2147483646',background:'Highlight',color:'HighlightText',font:'bold 16px sans-serif',padding:'4px',border:'2px solid CanvasText',pointerEvents:'none'});
    document.documentElement.append(mark);
  })()` });
}
