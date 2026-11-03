import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TurnReviewBar} from '../webview-ui/src/TurnReviewBar';
import type {TurnReviewView} from '../src/turnReviewView';
for(const name of ['Node','Element','HTMLElement']) (globalThis as any)[name]=(window as any)[name]??(window as any).Element;
const act=(React as any).act;
const check=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const root=mountPoint(),react=createRoot(root), calls:(string|undefined)[]=[];
const path='a\u202e<img>.txt';
const view:TurnReviewView={turnId:'one',state:'open',added:[],changed:[path,'b.txt'],deleted:[],notCovered:[],files:[{path,added:2,removed:1,lines:[{kind:'removed',text:'old\n'},{kind:'added',text:'new\n'},{kind:'added',text:'extra\n'}]}]};
const render=async(v:TurnReviewView)=>act(()=>react.render(<TurnReviewBar view={v} onRevert={p=>calls.push(p)} onKeep={()=>{}} onClose={()=>{}}/>));
const buttons=()=>root.querySelectorAll('button');
const button=(text:string)=>buttons().find((b:any)=>b.textContent===text)!;
async function main() {
await render(view);
check(root.textContent.includes('+2줄 추가 · −1줄 삭제'),'exact textual counts');check(root.textContent.includes('\\u202e'),'bidi shown explicitly');check(!root.querySelector('img'),'path never HTML');
const expand=button('전후 비교 보기');await act(()=>click(expand));check(expand.getAttribute('aria-expanded')==='true','expanded');check(root.querySelectorAll('.hps-turn-diff-line').some((e:any)=>e.textContent.includes('−old')),'minus glyph');check(root.querySelectorAll('.hps-turn-diff-line').some((e:any)=>e.textContent.includes('+new')),'plus glyph');
const perfile=button('이 파일 되돌리기');perfile.focus();await act(()=>click(perfile));check(calls[0]===path,'original exact path callback');
await render({...view,state:'restoring'});check(button('이 파일 되돌리기').hasAttribute('disabled'),'file busy');check(button('되돌리는 중…').hasAttribute('disabled'),'all busy');
await render({...view,changed:['b.txt'],files:[]});check(doc.activeElement===button('모두 되돌리기'),'focus after removed file');await act(()=>click(button('모두 되돌리기')));check(calls.length===2&&calls[1]===undefined,'all callback');
await render(view);await act(()=>click(button('전후 비교 보기')));check(!!root.querySelector('.hps-turn-diff'),'old turn expanded before switch');
await render({...view,turnId:'other'});check(!root.querySelector('.hps-turn-diff'),'new turn cannot retain prior expanded diff');
await act(()=>react.unmount());console.log('turn file review interaction PASS');

}
void main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
