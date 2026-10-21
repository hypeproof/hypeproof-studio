import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessHeader } from "../webview-ui/src/AccessHeader";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig, ChatMessage } from "../src/protocol";
(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
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
const render = (config: ChatConfig) => renderToStaticMarkup(<AccessHeader config={config}/>);
function test(name: string, fn: () => void) { fn(); console.log('PASS '+name); }
test('Service count, confirmation timestamp, reserved and unresolved are distinct', () => {
 const html=render(base());
 assert.ok(html.includes('남은 요청 37회'));
 assert.ok(html.includes(new Date(base().access!.view!.as_of).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false})+' 확인'));
 assert.ok(html.includes('예약 3회')); assert.ok(html.includes('미확인 2건')); assert.ok(!html.includes('998'));
});
test('real chat header exposes usage before composer without changing text send', () => {
 const html=renderToStaticMarkup(<ChatPanel {...PROPS} config={base()} instructor={false}/>);
 assert.match(html, /<header[^>]*>[\s\S]*남은 요청 37회[\s\S]*<\/header>/);
 assert.ok(html.includes('<textarea')); assert.ok(html.indexOf('남은 요청 37회')<html.indexOf('<textarea'));
});
test('Service unreachable reads 미확인, never an old view, zero or a checking state', () => {
 const c=base(); c.access!.status='unknown'; const html=render(c);
 assert.ok(html.includes('남은 요청 미확인')); assert.ok(!html.includes('37회')); assert.ok(!html.includes('0회')); assert.ok(!html.includes('확인 중'));
 const d=base(); delete (d.activity as {pass?:unknown}).pass; d.access!.status='unknown'; assert.equal(render(d),'','no pass and no confirmed source: nothing to report');
});
test('no access state, contracts off or no chosen source: no line at all (no unresolvable 확인 중)', () => {
 const none=base(); none.access=undefined; assert.equal(render(none),'');
 const off=base(); off.access={status:'ready',view:{schema:'hps-access-view/1',configured:false,as_of:'2026-10-20T06:42:00Z',choices:[]}} as ChatConfig['access']; assert.equal(render(off),'');
 const offWithChoice=base(); offWithChoice.access!.view!.configured=false; assert.equal(render(offWithChoice),'');
 const noView=base(); noView.access={status:'ready',selected:choice.id} as ChatConfig['access']; assert.equal(render(noView),'');
 const gone=base(); gone.access!.selected='different'; assert.equal(render(gone),'');
});
test('an unselected source is never auto-selected, even with exactly one active choice', () => {
 for (const selected of [undefined, '']) {
  const c=base(); c.access!.selected=selected as string|undefined;
  assert.equal(c.access!.view!.choices.length,1); assert.ok(c.access!.view!.choices[0].active);
  assert.equal(render(c),'',String(selected));
  assert.ok(!renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false}/>).includes('hps-access-header'),String(selected));
 }
});
test('an account source on a seat without the pass flag still shows the Service count', () => {
 const c=base(); delete (c.activity as {pass?:unknown}).pass; delete (c.profile as {pass?:unknown}).pass;
 assert.ok(!c.activity!.pass && !c.profile!.pass);
 assert.ok(render(c).includes('남은 요청 37회'));
 assert.ok(renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false}/>).includes('남은 요청 37회'));
});
test('selection and request-meter provenance are required', () => {
 for(const change of ['meter','duplicate','time','timetype','missing']) {
  const c=base(); const v=c.access!.view!;
  if(change==='meter') v.choices[0].resources[0].meter='currency:USD';
  if(change==='duplicate') v.choices[0].resources.push({...resource});
  if(change==='time') v.as_of='invalid';
  if(change==='timetype') v.as_of=2026 as unknown as string;
  if(change==='missing') v.choices[0].resources=[];
  assert.ok(render(c).includes('남은 요청 미확인'),change); assert.ok(!render(c).includes('37회'),change); assert.ok(!render(c).includes('확인 중'),change);
 }
 const c=base(); c.access!.view!.choices[0].source_kind='unknown'; assert.ok(render(c).includes('남은 요청 미확인'));
 delete (c.activity as {pass?:unknown}).pass; assert.equal(render(c),'','unknown source on a seat without a pass');
});
test('invalid counts, held or unresolved are unconfirmed; confirmed zero stays zero', () => {
 for(const key of ['remaining','held','unresolved'] as const) for(const value of [-1,NaN,Infinity,1.5]) {
  const c=base(); c.access!.view!.choices[0].resources[0][key]=value; assert.ok(render(c).includes('남은 요청 미확인'),key+value); assert.ok(!render(c).includes('37회'),key+value);
 }
 const c=base(); c.access!.view!.choices[0].resources[0].remaining=0; assert.ok(render(c).includes('남은 요청 0회'));
});
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR',{hour:'numeric',minute:'2-digit',hour12:false});
/** Every number the line shows (text and title), after removing the confirmation time. */
const numbers = (html: string, iso: string) => {
 const title = html.match(/title="([^"]*)"/)?.[1] ?? '';
 // The model alias may contain digits; inspect the actual visible ledger as well as its tooltip.
 const visible = html.replace(/<span class="hps-access-model"[^>]*>[\s\S]*?<\/span>/, '').replace(/<[^>]+>/g, '');
 return ((title + ' ' + visible).split(hhmm(iso)).join(' ').match(/\d[\d,]*/g) ?? []);
};
test('class funding shows its own remaining count and no other number (limit, use, reservation, overrun)', () => {
 for(const source of ['cohort','organization']) for (const seat of ['personal','classroom']) {
  const c=base(); const r=c.access!.view!.choices[0].resources[0]; c.access!.view!.choices[0].source_kind=source;
  Object.assign(r,{remaining:37,held:3,unresolved:2,spent:10,limit:50,overrun:4});
  if(seat==='classroom'){c.activity!.kind='classroom'; delete (c.activity as {pass?:unknown}).pass;}
  const html=render(c);
  assert.ok(html.includes('수업·기관 지원'),source+seat); assert.ok(html.includes('남은 요청 37회'),source+seat);
  assert.deepEqual(numbers(html,c.access!.view!.as_of),['37','37'],source+seat+': '+html);
  assert.ok(!html.includes('예약') && !html.includes('미확인 2'),source+seat);
 }
 const shared=base(); shared.access!.view!.choices[0].source_kind='cohort'; shared.access!.view!.choices[0].resources[0].shared=true;
 assert.ok(render(shared).includes('함께 쓰는 남은 요청 37회'),'a shared class pool is not read as a personal count');
});
test('a class source without a valid ledger reads 미확인 and shows no number', () => {
 for(const change of ['meter','duplicate','negative','fraction','time','missing']) {
  const c=base(); c.access!.view!.choices[0].source_kind='cohort'; const v=c.access!.view!;
  if(change==='meter') v.choices[0].resources[0].meter='currency:USD';
  if(change==='duplicate') v.choices[0].resources.push({...resource});
  if(change==='negative') v.choices[0].resources[0].remaining=-1;
  if(change==='fraction') v.choices[0].resources[0].remaining=1.5;
  if(change==='time') v.as_of='bad';
  if(change==='missing') v.choices[0].resources=[];
  const html=render(c);
  assert.ok(html.includes('수업·기관 지원 · 남은 요청 미확인'),change); assert.deepEqual(numbers(html,v.as_of),[],change+': '+html);
 }
});
// DEC-35 (Jay 2026-10-19): the count applies to pass and class seats. Classroom screens show it
// wherever the class funding data supports it, and stay honest (no line, or 미확인) when it does not.
const classAccess = (over: Record<string, unknown> = {}, selected: string|null = choice.id, view: Record<string, unknown> = {}) =>
 ({status:'ready',selected:selected ?? undefined,view:{schema:'hps-access-view/1',configured:true,as_of:'2026-10-20T06:42:00Z',choices:[{...structuredClone(choice),source_kind:'cohort',...over}],...view}}) as unknown as ChatConfig['access'];
test('DEC-35 class seats: the classroom header shows the class line from Service data', () => {
 for(const marker of ['activity','profile']) for (const instructor of [false,true]) {
  const c=structuredClone(classroom());
  if(marker==='activity') c.profile!.activity_kind='personal'; else (c.activity as {kind:string}).kind='personal';
  c.access=classAccess();
  const want='수업·기관 지원 · 남은 요청 37회 · '+hhmm('2026-10-20T06:42:00Z')+' 확인';
  assert.ok(render(c).includes(`title="${want}"`),marker);
  const html=renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={instructor}/>);
  assert.match(html, /<header[^>]*>[\s\S]*hps-access-header[\s\S]*<\/header>/, marker+instructor);
  assert.ok(html.includes(`title="${want}"`),marker+instructor);
 }
});
test('DEC-35 class seats stay honest when the data does not support a count', () => {
 const seat=(access: ChatConfig['access']) => ({...structuredClone(classroom()), access}) as ChatConfig;
 assert.equal(render(classroom()),'','no access state');
 assert.equal(render(seat(classAccess({}, choice.id, {configured:false,choices:[]}))),'','access contracts off');
 assert.equal(render(seat(classAccess({}, null))),'','no source chosen (never auto-selected)');
 const unknown=seat({status:'unknown',selected:choice.id} as ChatConfig['access']);
 assert.ok(render(unknown).includes('남은 요청 미확인')); assert.ok(!render(unknown).includes('37'));
 // Either classroom marker alone makes it a class seat (no pass flag on these seats).
 for (const marker of ['activity','profile']) {
  const c=structuredClone(unknown);
  if(marker==='activity') c.profile!.activity_kind='personal'; else (c.activity as {kind:string}).kind='personal';
  assert.ok(render(c).includes('남은 요청 미확인'),marker+' marker alone');
  const neither=structuredClone(c); neither.profile!.activity_kind='personal'; (neither.activity as {kind:string}).kind='personal';
  assert.equal(render(neither),'','control: no pass and no classroom marker');
 }
 const odd=seat(classAccess({source_kind:'mystery'}));
 assert.ok(render(odd).includes('남은 요청 미확인')); assert.ok(!render(odd).includes('37'));
 for (const instructor of [false,true]) assert.ok(!renderToStaticMarkup(<ChatPanel {...PROPS} config={classroom()} instructor={instructor}/>).includes('hps-access-header'),'no access: classroom screen unchanged');
});
// The usage panel's state words (AccessControl stateLabels).
const UNUSABLE = { ended:'이용 기간 종료', exhausted:'남은 자원 부족', paused:'일시정지', review_required:'사용량 확인 필요' } as const;
test('an unusable selected pass shows its state word, never 남은 요청 N회', () => {
 for (const [state, word] of Object.entries(UNUSABLE)) for (const available of [false,true]) {
  const c=base(); Object.assign(c.access!.view!.choices[0],{state,available});
  const html=render(c);
  assert.ok(!html.includes('남은 요청'),state+available+': '+html); assert.ok(!html.includes('37'),state);
  assert.ok(html.includes(`title="${word} · ${hhmm(c.access!.view!.as_of)} 확인"`),state+': '+html);
  assert.deepEqual(numbers(html,c.access!.view!.as_of),[],state);
  const panel=renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false}/>);
  const header=panel.slice(0, panel.indexOf('</header>'));
  assert.ok(header.includes(`title="${word} · `) && !header.includes('남은 요청'),state+': chat header');
 }
});
test('an unusable class source names its state and shows no count', () => {
 for (const [state, word] of Object.entries(UNUSABLE)) {
  const c=base(); Object.assign(c.access!.view!.choices[0],{state,available:false,source_kind:'cohort'}); c.activity!.kind='classroom';
  const html=render(c);
  assert.ok(html.includes(`title="수업·기관 지원 · ${word} · ${hhmm(c.access!.view!.as_of)} 확인"`),state+': '+html);
  assert.deepEqual(numbers(html,c.access!.view!.as_of),[],state);
 }
});
test('ready but not available: no line (the panel word 사용 가능 would be false); other states use the panel word', () => {
 const c=base(); c.access!.view!.choices[0].available=false; assert.equal(render(c),'');
 const d=base(); Object.assign(d.access!.view!.choices[0],{state:'not_configured',available:false}); assert.ok(render(d).includes('이용 한도 설정 대기')); assert.ok(!render(d).includes('37'));
 const e=base(); Object.assign(e.access!.view!.choices[0],{state:'something_new',available:false}); assert.ok(render(e).includes('상태 미확인')); assert.ok(!render(e).includes('37'));
 const ok=base(); assert.ok(ok.access!.view!.choices[0].available && render(ok).includes('남은 요청 37회'),'positive control: ready and available');
});
test('both free-seat signals suppress all counts, including stale paid data (DEC-35, unchanged)', () => {
 const c=base(); c.activity!.free=true; assert.equal(render(c),'');
 const d=base(); d.profile!.profile_id='studio-open-trial'; assert.equal(render(d),'');
 // A free seat that is also marked classroom, class funding, Service unreachable, an ended pass: still nothing.
 for (const mark of ['free','open-trial'] as const) for (const variant of ['classroom','cohort','unknown','ended']) {
  const e=base(); if(mark==='free') e.activity!.free=true; else e.profile!.profile_id='studio-open-trial';
  if(variant==='classroom') e.activity!.kind='classroom';
  if(variant==='cohort') e.access!.view!.choices[0].source_kind='cohort';
  if(variant==='unknown') e.access!.status='unknown';
  if(variant==='ended') Object.assign(e.access!.view!.choices[0],{state:'ended',available:false});
  assert.equal(render(e),'',mark+variant);
  assert.ok(!renderToStaticMarkup(<ChatPanel {...PROPS} config={e} instructor={false}/>).includes('hps-access-header'),mark+variant);
 }
});
test('unclassified and trial seats do not gain a pass counter', () => {
 assert.equal(render(personal),''); assert.equal(render({...personal,profile:null,activity:undefined} as unknown as ChatConfig),'');
});
test('new source and reload recompute from current snapshot without optimistic decrement', () => {
 const c=base(); assert.ok(render(c).includes('37회'));
 c.access!.view!.choices.push({...structuredClone(choice),id:'pass-2',resources:[{...resource,remaining:9}]}); c.access!.selected='pass-2';
 assert.ok(render(c).includes('남은 요청 9회')); assert.ok(!render(c).includes('37회'));
 assert.equal(render(structuredClone(c)),render(c));
});
test('a pass flag without any access state shows nothing (not a permanent 확인 중)', () => {
 assert.equal(renderToStaticMarkup(<AccessHeader config={null}/>),'');
 const c=structuredClone(personal); c.profile!.pass={request_limit:5,requests_used:0}; assert.equal(render(c),'');
 const d=structuredClone(personal); d.activity!.pass={request_limit:5,requests_used:0}; assert.equal(render(d),'');
});
test('class timestamp also requires a valid Service confirmation', () => {
 const c=base(); c.access!.view!.choices[0].source_kind='cohort';
 assert.ok(render(c).includes(hhmm(c.access!.view!.as_of)+' 확인'));
 c.access!.view!.as_of='bad'; assert.ok(render(c).includes('수업·기관 지원 · 남은 요청 미확인')); assert.ok(!render(c).includes(' 확인<'));
});
test('the full line is kept in the title and split into whole parts', () => {
 const html=render(base());
 assert.match(html, /title="남은 요청 37회 · [^"]+ 확인 · 예약 3회 · 미확인 2건"/);
 assert.equal((html.match(/class="hps-access-part"/g)||[]).length,4);
});
