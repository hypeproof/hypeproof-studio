// CGP-SHELL-D-028: mount the real header and real detail flow, then inspect after actions.
import { click, mountPoint, document as doc } from './fixtures/mini-dom.mjs';
import React from 'react';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { AccessHeader } from '../webview-ui/src/AccessHeader';
import { readFileSync } from 'node:fs';
import { rules } from './fixtures/stylesheet-rules.mjs';
import { TaskWorkspace } from '../webview-ui/src/TaskWorkspace';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import type { ChatConfig, ChatMessage } from '../src/protocol';
const act = (React as any).act;
for (const name of ['Node','Element','HTMLElement']) (globalThis as any)[name] ??= (globalThis.window as any).Element;
const proto = Object.getPrototypeOf(mountPoint());
const query = proto.querySelector;
proto.querySelector = function(selector: string) {
 if (selector === '.hps-access > summary') return this.findAll((e: any) => e.localName === 'summary' && (e.parentNode?.getAttribute('class') ?? '').split(' ').includes('hps-access'))[0] ?? null;
 return query.call(this,selector);
};
if (!('options' in proto)) Object.defineProperty(proto,'options',{get() { return this.findAll((e: any) => e.localName === 'option'); }});
const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
  onEditResend: () => true,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const classroom = (draft?: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(draft ? { activityDraft: draft } : {}),
}) as unknown as ChatConfig;
const personal = {
  ...classroom(), profile: { ...classroom().profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null },
} as unknown as ChatConfig;


const resource = { meter: 'requests:count', remaining: 37, held: 3, unresolved: 2, spent: 10, limit: 50, overrun: 0, shared: false };
const choice = { id: 'pass-1', label: 'Pass', source_kind: 'account', mode: 'included', active: true, available: true, state: 'ready', ends_at: 1, can_request: false, allowed: {models:[],efforts:[],features:[],runtimes:[]}, resources: [resource] };
const base = () => ({ ...structuredClone(personal), activity: {...personal.activity, pass: {request_limit:999,requests_used:1}}, access: { status:'ready', selected:choice.id, view: {schema:'hps-access-view/1',configured:true,as_of:'2026-10-20T06:42:00Z',choices:[structuredClone(choice)]}}}) as unknown as ChatConfig;

const byClass = (host: any, name: string) => host.findAll((e: any) => (e.getAttribute('class') ?? '').split(' ').includes(name));
async function main() {
 const host = mountPoint(); const root = createRoot(host as any);
 try {
  for (const source of ['account','cohort','organization']) {
   for (const [remaining,limit,low] of [[10,100,true],[11,100,false],[0,100,true],[1,0,false],[1,-1,false],[1,NaN,false],[1,Infinity,false],[1,10.5,false],[1,Number.MAX_SAFE_INTEGER + 1,false],[1,undefined,false]] as const) {
    const c=base(); const choice=c.access!.view!.choices[0]; choice.source_kind=source;
    Object.assign(choice.resources[0],{remaining,limit});
    await act(async () => root.render(<AccessHeader config={c} onOpenDetail={noop}/>));
    const chip=byClass(host,'hps-access-chip')[0];
    assert.ok(chip,'actionable remaining-requests chip is present');
    assert.equal(chip.getAttribute('data-low')==='true',low,`${source} ${remaining}/${limit}`);
    assert.equal(byClass(host,'hps-access-warning').length,low?1:0,'low icon');
    assert.ok(chip.textContent.includes(`남은 요청 ${remaining}회`),'count label');
    assert.equal(byClass(host,'hps-access-clock').length,1,'clock');
    assert.ok(chip.textContent.includes(new Date(c.access!.view!.as_of).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false})+' 확인'));
    assert.equal(host.findAll((e:any)=>e.localName==='progress'||e.getAttribute('role')==='progressbar').length,0,'no progress even when total unknown');
   }
  }
  const c=base(); c.profile!.model_selection={choices:[{alias:'other',label:'다른 모델',id:'other'}, {alias:c.model,label:'테스트 모델',id:'m'}]} as any;
  await act(async()=>root.render(<AccessHeader config={c} onOpenDetail={noop}/>));
  assert.equal(byClass(host,'hps-access-model')[0].textContent,'테스트 모델','model display name');
  const modelElement=byClass(host,'hps-access-model')[0];
  const adjacentChip=byClass(host,'hps-access-chip')[0];
  assert.equal(modelElement.parentNode,adjacentChip.parentNode,'model and chip share a header row');
  assert.equal(Array.from(modelElement.parentNode.childNodes).indexOf(adjacentChip),Array.from(modelElement.parentNode.childNodes).indexOf(modelElement)+1,'chip immediately follows model');
  c.profile!.model_selection=null;
  await act(async()=>root.render(<AccessHeader config={c} onOpenDetail={noop}/>));
  assert.equal(byClass(host,'hps-access-model')[0].textContent,c.model,'alias fallback');
  const chip=byClass(host,'hps-access-chip')[0]; chip.focus();
  c.access!.view!.choices[0].resources[0].remaining=2;
  await act(async()=>root.render(<AccessHeader config={structuredClone(c)} onOpenDetail={noop}/>));
  assert.equal(byClass(host,'hps-access-chip')[0],chip,'snapshot updates preserve the focused button');
  assert.ok(chip.textContent.includes('남은 요청 2회'),'fresh snapshot');
  for (const kind of ['personal','classroom']) {
   const c=base(); if(kind==='classroom') { c.taskWorkspace=undefined; c.activity!.kind='classroom'; c.profile!.activity_kind='classroom'; c.access!.view!.choices[0].source_kind='cohort'; c.access!.view!.choices[0].label='수업 지원'; }
   const panel=<ChatPanel {...PROPS} config={c} instructor={false}/>;
   await act(async()=>root.render(kind==='personal' ? <TaskWorkspace view={c.taskWorkspace!} messages={[]} busy={false} error={null} onDismissError={noop}>{panel}</TaskWorkspace> : panel));
   const button=byClass(host,'hps-access-chip')[0];
   assert.equal(button.localName,'button');
   if(kind==='classroom') assert.ok(button.textContent.includes('수업·기관 지원'),'classroom selected funding chip');
   assert.equal(button.matches('.hps-shell .hps-access-chip'),kind!=='personal','real portal ancestry');
   const cssRules=rules(readFileSync('webview-ui/src/styles.css','utf8'));
   for(const [prop,want] of [['font-size','var(--hp-font-caption)'],['min-height','var(--hp-control-min)'],['background','var(--vscode-editor-background)']]) {
    const matched=cssRules.filter((r:any)=>!r.media && r.selectors.some((sel:string)=>sel.includes('.hps-access-chip') && !sel.includes(':') && button.matches(sel)));
    assert.equal(matched.reduce((v:any,r:any)=>r.decls[prop]??v,undefined),want,kind+' matching chip CSS '+prop);
   } assert.equal(button.getAttribute('type'),'button');
   assert.ok(button.getAttribute('aria-label').includes('이용권과 사용량 자세히'));
   button.focus();
   await act(async()=>{click(button);click(button);});
   const dialogs=host.findAll((e:any)=>e.localName==='dialog' && e.open);
   assert.equal(dialogs.length,1,kind+' one dialog after double click');
   const detail=byClass(dialogs[0],'hps-access')[0];
   assert.ok(detail.open || detail.getAttribute('open')!==null,kind+' expanded AB-11 detail');
   assert.equal((doc as any).activeElement.localName,'summary','usage receives focus');
   assert.ok(detail.textContent.includes('요청 수 37 남음'),kind+' selected remaining detail');
   if(kind==='classroom') assert.ok(detail.textContent.includes('수업 지원'),'classroom selected source detail');
   assert.ok(detail.textContent.includes('확인된 내 사용 10'),kind+' actual own-use detail');
   assert.ok(detail.textContent.includes('내 예약 3'),kind+' reservations');
   const close=dialogs[0].findAll((e:any)=>e.getAttribute('aria-label')==='대화 설정 닫기')[0];
   await act(async()=>click(close));
   assert.equal(host.findAll((e:any)=>e.localName==='dialog' && e.open).length,0,'close');
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
   assert.ok((doc as any).activeElement===button,'focus returns to chip: '+(doc as any).activeElement?.localName);
   await act(async()=>root.render(<div/>));
  }
  console.log('PASS access-chip: thresholds, unknown total, model, fresh snapshots, personal/class detail click');
 } finally { await act(async()=>root.unmount()); }
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
