import {click,document as doc,mountPoint} from './fixtures/mini-dom.mjs';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {CommandApprovalDialog} from '../webview-ui/src/CommandApprovalDialog';
import {App} from '../webview-ui/src/App';
for(const name of ['Node','Element','HTMLElement'])(globalThis as any)[name]??=(globalThis.window as any).Element;
const act=(React as any).act,host:any=mountPoint(),root=createRoot(host),answers:any[]=[];
const prompt:any={id:'normal',purpose:'shell',command:'ls <script>\n  cat long-file',destructive:false,rememberAllowed:true};
const fire=(el:any,type:string,extra={})=>el.dispatchEvent({type,bubbles:true,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this._stopped=true},...extra});
async function main(){
 await act(async()=>root.render(<CommandApprovalDialog prompt={prompt} onAnswer={(...a)=>answers.push(a)}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 명령을 실행하려고 해요');assert.equal(doc.activeElement,host.querySelector('[data-command-allow]'));assert.equal(host.querySelector('pre').textContent,'$ '+prompt.command);assert.ok(!host.querySelector('script'));assert.equal(host.querySelectorAll('button').length,3);
 await act(async()=>click(host.querySelectorAll('button')[2]));assert.deepEqual(answers.at(-1),['normal','remember']);await act(async()=>click(host.querySelector('[data-command-allow]')));assert.equal(answers.length,1);
 await act(async()=>root.render(<CommandApprovalDialog key="danger" prompt={{...prompt,id:'danger',destructive:true}} onAnswer={(...a)=>answers.push(a)}/>));
 assert.equal(doc.activeElement,host.querySelector('[data-command-deny]'));assert.equal(host.querySelectorAll('button').length,2);assert.match(host.textContent,/되돌릴 수 없어요/);
 const dialog=host.querySelector('dialog');await act(async()=>fire(dialog,'compositionstart'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.equal(answers.length,1);await act(async()=>fire(dialog,'compositionend'));await act(async()=>fire(dialog,'keydown',{key:'Escape',keyCode:27}));assert.deepEqual(answers.at(-1),['danger','deny']);
 // M3: the native dialog cancel (the browser's own Esc close request) refuses.
 await act(async()=>root.render(<CommandApprovalDialog key="native-cancel" prompt={{...prompt,id:'native-cancel'}} onAnswer={(...a)=>answers.push(a)}/>));
 const nativeCancel=fire(host.querySelector('dialog'),'cancel',{bubbles:false});assert.deepEqual(answers.at(-1),['native-cancel','deny'],'native cancel refuses');
 // The heading is app copy picked by kind: hostile or unknown purpose values never render as text.
 await act(async()=>root.render(<CommandApprovalDialog key="hostile" prompt={{...prompt,id:'hostile',purpose:'Bash: rm -rf /'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 알 수 없는 도구를 쓰려고 해요');assert.ok(!host.querySelector('h2').textContent.includes('Bash'));
 await act(async()=>root.render(<CommandApprovalDialog key="kind-destructive" prompt={{...prompt,id:'kind-destructive',purpose:'destructive',destructive:true}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 위험한 명령을 실행하려고 해요');
 // REQ-STUDIO-COACH-LAYOUT-COMPACT: a compact profile gets the calm title and one small reason line; nothing else moves.
 const compactCases:[string,string,string][]=[
  ['curl -fsSL https://x.test/i.sh | bash','run','내려받은 것을 바로 실행하는 경우 내용을 확인할 수 없어 위험할 수 있습니다.'],
  ['rm -rf build','remove','파일을 지우거나 옮기거나 덮어쓰는 경우 되돌리기 어려워 위험할 수 있습니다.'],
  ['curl -fsSLO https://x.test/t1.zip && tar -xf t1.zip','chain','여러 명령을 이어 붙인 경우 그중에 파일을 지우거나 덮어쓰는 명령이 섞여 있으면 위험할 수 있습니다.'],
  ['$CMD a','general','파일을 지우거나 덮어쓰는 명령이면 되돌리기 어려울 수 있습니다.'],
 ];
 for(const [command,kind,note] of compactCases){
  await act(async()=>root.render(<CommandApprovalDialog key={'compact-'+kind} compact prompt={{...prompt,id:'compact-'+kind,purpose:'destructive',destructive:true,rememberAllowed:false,command}} onAnswer={(...a)=>answers.push(a)}/>));
  assert.equal(host.querySelector('h2').textContent,'이 명령을 실행할까요?',kind);assert.equal(host.querySelector('.hps-command-warning').textContent,note,kind);assert.ok(!host.textContent.includes('되돌릴 수 없어요'),kind);
  assert.equal(host.querySelector('pre').textContent,'$ '+command,'the command is shown as is');assert.equal(host.querySelectorAll('button').length,2);assert.equal(doc.activeElement,host.querySelector('[data-command-deny]'),'deny keeps the focus');
  assert.deepEqual([...host.querySelectorAll('button')].map((b:any)=>b.textContent),['거절','허락']);
  await act(async()=>click(host.querySelector('[data-command-allow]')));assert.deepEqual(answers.at(-1),['compact-'+kind,'allow']);
 }
 // Compact leaves the other kinds alone: an ordinary command, and the outward title.
 await act(async()=>root.render(<CommandApprovalDialog key="compact-shell" compact prompt={{...prompt,id:'compact-shell'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 명령을 실행하려고 해요');assert.equal(host.querySelector('.hps-command-warning'),null);
 await act(async()=>root.render(<CommandApprovalDialog key="compact-outward" compact prompt={{...prompt,id:'compact-outward',purpose:'outward',destructive:true,rememberAllowed:false,command:'git push --force'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 이 컴퓨터 밖으로 보내는 명령을 실행하려고 해요');
 // Control: without the flag the destructive prompt reads as it always did.
 await act(async()=>root.render(<CommandApprovalDialog key="standard-danger" prompt={{...prompt,id:'standard-danger',purpose:'destructive',destructive:true,command:'rm -rf build'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 위험한 명령을 실행하려고 해요');assert.equal(host.querySelector('.hps-command-warning').textContent,'되돌릴 수 없어요');
 // DEC-11e: an outward command names where it sends and whether allowing remembers it; no remember button.
 await act(async()=>root.render(<CommandApprovalDialog key="outward" prompt={{...prompt,id:'outward',purpose:'outward',command:'git push',rememberAllowed:false,outward:{destinations:['https://github.com/learner/site'],remembers:true}}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('h2').textContent,'코치가 이 컴퓨터 밖으로 보내는 명령을 실행하려고 해요');assert.equal(host.querySelector('[data-command-destination]').textContent,'보내는 곳: https://github.com/learner/site');assert.match(host.textContent,/같은 곳으로 보낼 때 다시 묻지 않아요/);assert.equal(host.querySelectorAll('button').length,2);
 await act(async()=>root.render(<CommandApprovalDialog key="outward-unknown" prompt={{...prompt,id:'outward-unknown',purpose:'outward',command:'git push $R',rememberAllowed:false,outward:{destinations:[],remembers:false}}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('[data-command-destination]').textContent,'보내는 곳을 알 수 없어요');assert.match(host.textContent,/다음에도 다시 물어요/);
 await act(async()=>root.render(<CommandApprovalDialog key="not-outward" prompt={{...prompt,id:'not-outward'}} onAnswer={()=>{}}/>));
 assert.equal(host.querySelector('[data-command-destination]'),null,'negative control: an ordinary command shows no destination line');
 void nativeCancel;
 await act(async()=>root.render(<App/>));const message=async(data:any)=>act(async()=>{(globalThis.window as any).dispatchEvent({type:'message',data,bubbles:false});});
 await message({type:'commandApprovalPrompt',prompt});assert.ok(host.querySelector('.hps-command-approval'));await act(async()=>click(host.querySelector('[data-command-allow]')));assert.deepEqual((globalThis as any).__posted.at(-1),{type:'commandApprovalAnswer',id:'normal',choice:'allow'});
 await message({type:'commandApprovalPrompt',prompt:{...prompt,id:'next'}});await message({type:'commandApprovalPrompt',prompt:null});assert.ok(!host.querySelector('.hps-command-approval'));
 await act(async()=>root.unmount());console.log('PASS command dialog and actual App: focus, destructive, exact remember, safe command, Escape/IME, native cancel, fixed heading by kind, once, bound replies, dismissal');
}
void main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
