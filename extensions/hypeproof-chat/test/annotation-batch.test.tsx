import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { AnnotationBatch, annotationEnvelope } from '../src/annotationBatch';
import { AnnotationTray } from '../webview-ui/src/AnnotationTray';
import { intersects, rectangleValid, marker, dragRectangle } from '../src/annotationCapture';
import type { ElementContext } from '../src/elementPick';
const ctx = (ref='e1'): ElementContext => ({ref,backendNodeId:1,tag:'button',text:'시작',snippet:'<button>시작</button>',snippetTruncated:false,style:{color:'red'},crop:{mimeType:'image/png',data:'UE5H',clip:{x:10,y:20,width:40,height:30}},source:'unmapped',url:'http://localhost/index.html',route:'/index.html',documentGeneration:'gen-1',artifact:{id:'v1',entry:'index.html',files:[]},captureMs:1});
async function main() {
const batch = new AnnotationBatch(); batch.bind('activity:task');
const first = batch.add('element',[ctx()],ctx().crop);
const rect = batch.add('rectangle',[ctx('e2'),ctx('e3')],{...ctx().crop!,data:'RECT'});
batch.edit(first.number,'고쳐 주세요'); batch.edit(rect.number,'두 곳을 함께');
assert.deepEqual(batch.preview().map(a=>a.number),[1,2]);
assert.match(batch.preview()[1].sentText,/ref: e2/); assert.match(batch.preview()[1].sentText,/ref: e3/);
assert.match(batch.preview()[0].sentText,/<button>시작<\/button>/);
assert.match(batch.preview()[0].sentText,/unmapped/); assert.match(batch.preview()[0].sentText,/v1/);
assert.equal(batch.preview()[1].imageDataUrl,'data:image/png;base64,RECT');
const html = renderToStaticMarkup(<AnnotationTray annotations={batch.preview()} onAction={()=>{}}/>);
assert.match(html,/표시 #1 · 요소/); assert.match(html,/표시 #2 · 영역/); assert.match(html,/고쳐 주세요/);
assert.doesNotMatch(html,/<pre>/, 'payload opens from its numbered chip');
const root = createRoot(mountPoint());
const act = (React as any).act;
let actions: unknown[][]=[];
await act(()=>root.render(<AnnotationTray annotations={batch.preview()} onAction={(...args)=>{actions.push(args); if(args[0]==='remove') batch.remove(args[1]!);}}/>));
const buttons = Array.from(doc.querySelectorAll('button')) as any[];
await act(()=>click(buttons.find(b=>b.getAttribute('aria-label')==='표시 1 빼기')));
assert.deepEqual(actions,[['remove',1]]);
const sent = annotationEnvelope(batch.take());
assert.doesNotMatch(sent.text,/표시 #1/); assert.match(sent.text,/표시 #2/); assert.match(sent.text,/두 곳을 함께/);
assert.deepEqual(sent.images,['data:image/png;base64,RECT']); assert.equal(batch.take().length,0,'a double send cannot reuse annotations');
await act(()=>root.unmount());
for(let i=0;i<10;i++) batch.add('element',[ctx()],ctx().crop);
assert.throws(()=>batch.add('element',[ctx()],ctx().crop),/10개/);
assert.equal(batch.size,10);
batch.bind('other-task'); assert.equal(batch.size,0);
batch.add('element',[ctx()],ctx().crop);
assert.equal(batch.validate('gen-2','v1'),false); assert.equal(batch.preview()[0].stale,true);
assert.throws(()=>batch.take(),/이전 화면/);
batch.bind('another'); batch.add('element',[ctx()],ctx().crop);
assert.equal(batch.validate('gen-1','v2'),false); assert.throws(()=>batch.take());
batch.bind('fresh'); batch.add('element',[ctx()],ctx().crop);
const revision=batch.revision; batch.edit(1,'new'); assert.throws(()=>batch.take(revision),/표시가 바뀌/);
batch.edit(1,'Ａ\u202e\u0000\u2028'+ 'a'.repeat(400));
assert.equal(batch.preview()[0].comment.length,300); assert.ok(batch.preview()[0].comment.startsWith('A')); assert.doesNotMatch(batch.preview()[0].comment,/[\u202e\u0000\u2028]/);
assert.throws(()=>batch.add('element',[{...ctx(),documentGeneration:''}],ctx().crop));
assert.throws(()=>batch.add('element',[ctx()],null));
assert.throws(()=>batch.add('rectangle',[ctx(),{...ctx(),documentGeneration:'other'}],ctx().crop));
assert.throws(()=>batch.add('rectangle',[ctx(),{...ctx(),artifact:{...ctx().artifact,id:'v2'}}],ctx().crop));
assert.equal(intersects({x:0,y:0,width:10,height:10},{x:9,y:9,width:10,height:10}),true);
assert.equal(intersects({x:0,y:0,width:10,height:10},{x:10,y:0,width:10,height:10}),false);
assert.equal(rectangleValid({x:0,y:0,width:2,height:2}),false);
for(const bad of [{x:Infinity,y:0,width:10,height:10},{x:0,y:Infinity,width:10,height:10},{x:-1,y:0,width:10,height:10},{x:0,y:0,width:1,height:10},{x:0,y:0,width:NaN,height:10},{x:0,y:0,width:100000,height:100000}]) assert.equal(rectangleValid(bad),false);
// Marker rendering and removal are exercised against live CDP in annotation-marker-layout.smoke.mjs.
await assert.rejects(dragRectangle({send:async(m:string)=>m==='Page.getFrameTree'?{frameTree:{frame:{id:'f'}}}:m==='Page.createIsolatedWorld'?{executionContextId:1}:{result:{value:{x:0,y:0,width:1,height:1}}}} as any),/취소/);
// Run the drag listener code: synthetic page events cannot complete a selection.
let selectedLayer: any, removed = false, cleared = false;
const dragDoc: any = { createElement: () => ({style:{},setAttribute(){},append(){},setPointerCapture(){},remove(){removed=true;}}), documentElement:{append(layer:any){selectedLayer=layer;}}, addEventListener(){},removeEventListener(){} };
let completed=false;
const dragCdp:any={send:async(method:string,p:any)=>{
  if(method==='Page.getFrameTree') return {frameTree:{frame:{id:'f'}}};
  if(method==='Page.createIsolatedWorld') return {executionContextId:9};
  if(method==='Runtime.evaluate') {
    assert.equal(p.contextId,9);
    const promise = new Function('document','scrollX','scrollY','setTimeout','clearTimeout','return '+p.expression)(dragDoc,5,8,()=>1,()=>{cleared=true;});
    promise.then(()=>{completed=true;});
    const event=(trusted:boolean,x:number,y:number)=>({isTrusted:trusted,button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){}});
    selectedLayer.onpointerdown(event(false,10,10)); selectedLayer.onpointerup(event(true,30,40));
    await Promise.resolve(); assert.equal(completed,false,'page-generated events must not select');
    selectedLayer.onpointerdown(event(true,30,40)); selectedLayer.onpointerup(event(false,10,10));
    await Promise.resolve(); assert.equal(completed,false,'synthetic release cannot finish a trusted drag');
    selectedLayer.onpointermove(event(true,10,10)); selectedLayer.onpointerup(event(true,10,10));
    return {result:{value:await promise}};
  }
}};
assert.deepEqual(await dragRectangle(dragCdp),{x:15,y:18,width:20,height:30}); assert.equal(removed,true); assert.equal(cleared,true);
console.log('PASS annotation batch: numbering, preview, removal, single consumption, version/generation, guards, markers');

}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
