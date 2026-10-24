// CDP selection uses an isolated world; only trusted user pointer events complete it.
import { neutralizeComment } from './annotationLimits.ts';
import type { CdpLike } from './experimentBrowser';
export interface Rectangle { x: number; y: number; width: number; height: number }
export function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
export function rectangleValid(r: Rectangle): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width >= 2 && r.height >= 2 && Math.hypot(r.width, r.height) >= 8 && r.width * r.height <= 16000000;
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
    Object.assign(box.style, {position:'absolute',border:'2px dashed Highlight',background:'rgba(0,100,200,.15)',pointerEvents:'none'});
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
export interface MarkerOptions {
  comment?: string;
  version?: number;
  backendNodeId?: number;
  documentGeneration?: string;
  kind?: 'element' | 'rectangle';
}


/** Owned overlay nodes must never become a picked page element or rectangle payload. */
export async function isAnnotationOverlayNode(cdp: CdpLike, backendNodeId: number): Promise<boolean> {
  const contextId = await annotationWorld(cdp);
  const resolved = await cdp.send('DOM.resolveNode', { backendNodeId, executionContextId: contextId });
  const objectId = resolved?.object?.objectId;
  if (!objectId) return false;
  try {
    const r = await cdp.send('Runtime.callFunctionOn', { objectId, returnByValue: true, functionDeclaration: `function(){
      const state=globalThis.__hpsAnnotationMarkers;
      if(!state)return false;
      for(const m of state.items.values())if(this===m.host||this.getRootNode()===m.root)return true;
      return false;
    }` });
    return r?.result?.value === true;
  } finally { await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {}); }
}

export async function markerComment(cdp: CdpLike, number: number, comment: string, version?: number, revision = 0): Promise<void> {
  const contextId = await annotationWorld(cdp);
  await cdp.send('Runtime.evaluate', { contextId, expression: `(() => {
    const m=globalThis.__hpsAnnotationMarkers?.items.get(${JSON.stringify(number)});
    if(m && (${JSON.stringify(version ?? null)}===null || m.version===${JSON.stringify(version ?? null)}) && m.commentRevision<=${revision}){m.commentRevision=${revision};m.button.setAttribute('aria-label',${JSON.stringify(`표시 ${number}: ${neutralizeComment(comment)}`)});}
  })()` });
}

export async function marker(cdp: CdpLike, number: number, rect: Rectangle | null, options: MarkerOptions = {}): Promise<void> {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('잘못된 표시 번호예요.');
  const tree = await cdp.send('Page.getFrameTree', {});
  if (rect && options.documentGeneration && tree.frameTree.frame.loaderId !== options.documentGeneration) throw new Error('화면이 바뀌었어요. 다시 골라 주세요.');
  const contextId = await annotationWorld(cdp);
  let objectId: string | undefined;
  if (rect && options.backendNodeId) {
    const resolved = await cdp.send('DOM.resolveNode', { backendNodeId: options.backendNodeId, executionContextId: contextId });
    objectId = resolved?.object?.objectId;
    if (!objectId) throw new Error('고른 요소를 찾을 수 없어요.');
  }
  // The registry is in the isolated world; page script cannot forge ownership. Shadow DOM
  // isolates page CSS while keeping marker names in the accessibility tree.
  const body = `
    const number=${JSON.stringify(number)},rect=${JSON.stringify(rect)},label=${JSON.stringify(`표시 ${number}: ${neutralizeComment(options.comment ?? '')}`)};
    let state=globalThis.__hpsAnnotationMarkers;
    if(!state)globalThis.__hpsAnnotationMarkers=state={items:new Map(),frame:0};
    const old=state.items.get(number);
    if(!rect && ${JSON.stringify(options.version ?? null)}!==null && old?.version!==${JSON.stringify(options.version ?? null)})return;
    if(old){old.host.remove();state.items.delete(number);}
    if(!rect){if(!state.items.size){cancelAnimationFrame(state.frame);state.frame=0;}return;}
    const anchor=${objectId ? 'this' : 'null'};
    const host=document.createElement('div');host.setAttribute('data-hps-annotation-marker',String(number));
    host.style.cssText='all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483646!important;pointer-events:none!important';
    const root=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent='button{all:initial;box-sizing:border-box;position:absolute;width:44px;height:44px;display:grid;place-items:center;pointer-events:auto;cursor:default}button:focus-visible{outline:2px solid Highlight;outline-offset:-2px}span{box-sizing:border-box;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:2px solid CanvasText;background:Highlight;color:HighlightText;font:bold 14px sans-serif}.region{box-sizing:border-box;position:absolute;border:2px dashed Highlight;pointer-events:none}';
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);
    const badge=document.createElement('span');badge.textContent=String(number);badge.setAttribute('aria-hidden','true');button.append(badge);
    const region=document.createElement('div');region.className='region';region.hidden=${options.kind !== 'rectangle'};
    root.append(style,region,button);state.items.set(number,{host,root,button,region,rect,anchor,version:${JSON.stringify(options.version ?? null)},commentRevision:0});
    // Append in numeric order without replacing the controls or stealing their focus.
    const next=[...state.items.entries()].filter(([n])=>n>number).sort((a,b)=>a[0]-b[0])[0]?.[1].host;
    document.documentElement.insertBefore(host,next||null);
    const paint=()=>{
      for(const m of state.items.values()){
        if(m.anchor&&!m.anchor.isConnected){m.host.style.setProperty('visibility','hidden','important');continue;}
        m.host.style.setProperty('visibility','visible','important');
        const r=m.anchor?m.anchor.getBoundingClientRect():{left:m.rect.x-scrollX,top:m.rect.y-scrollY,width:m.rect.width,height:m.rect.height};
        Object.assign(m.button.style,{left:(r.left-10)+'px',top:(r.top-10)+'px'});
        Object.assign(m.region.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
      }
      state.frame=state.items.size?requestAnimationFrame(paint):0;
    };
    if(!state.frame)paint();
  `;
  try {
    const result = objectId
      ? await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: `function(){${body}}` })
      : await cdp.send('Runtime.evaluate', { contextId, expression: `(()=>{${body}})()` });
    if(result?.exceptionDetails) throw new Error('화면 표시를 만들지 못했어요.');
  } finally { if(objectId) await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {}); }
}
