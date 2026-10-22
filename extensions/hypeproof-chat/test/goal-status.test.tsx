import { mountPoint, click } from './fixtures/mini-dom.mjs';
import React from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { GoalStatusBar, lessonBudget } from '../webview-ui/src/GoalStatusBar';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import lessonContent from './fixtures/session-design/week-3.json';
import * as G from '../src/studentGoal';
const noop = () => {};

/** The minimum subset of the shape `/v1/profile` actually returns. */
function resolvedProfile(week = 3, over = {}) {
  const content = lessonContent;
  return {
    profile_id: "sx-fixture",
    display_name: content.title,
    language: "ko",
    series_index: week,
    series_total: 6,
    welcome: { greeting_md: `오늘 수업: ${content.title}`, example_prompts: [] },
    ux: {
      coach: { naming_mode: "fixed", fallback_name: "코치", naming_prompt_md: "", personality_prompt_md: "" },
      suggestions: { initial: [], follow_up: [] },
      hints: {
        short_input: { enabled: false, min_chars: 0, message_md: "" },
        roll_input_button: { enabled: false, label: "", probe_md: "" },
      },
      retry_button: { enabled: true, show_counter: false },
    },
    lesson: { course_id: "globalbuddy", version: "m2026.09.20-1", sha256: "f".repeat(64), content },
    ...over,
  };
}

function chatConfig(week = 3, over = {}) {
  return {
    proxyUrl: "http://localhost:8787/v1",
    model: "claude-sonnet-5",
    hasToken: true,
    coach: { name: "코치", personality: "", configured: true },
    activity: { id: "a1", name: "GlobalBuddy", kind: "classroom", workspace: "/w", verified: true },
    profile: resolvedProfile(week),
    ...over,
  };
}

/** All of `ChatPanel`'s 25 props that rendering needs. Every callback is a no-op. */
function chatPanelProps(over = {}) {
  return {
    config: chatConfig(),
    incomingImage: null,
    messages: [],
    pageNotice: null,
    aiNotice: null,
    stopNotice: null,
    openWorldId: null,
    publish: null,
    onPublish: noop,
    streaming: false,
    streamingId: null,
    error: null,
    errorRequestId: null,
    errorRunbookUrl: null,
    canRetryLast: false,
    onSend: noop,
    onRetry: noop,
    onRetryLast: noop,
    onDismissError: noop,
    onCancel: noop,
    onClear: noop,
    onSetToken: noop,
    onSettings: noop,
    onRunCode: noop,
    onNamingRitual: noop,
    onSaveCoach: noop,
    onReportProblem: noop,
    onInstallUpdate: noop,
    onDismissUpdate: noop,
    ...over,
  };
}

const act = (React as any).act;
const config: any = chatConfig(3);
const lesson = config.profile.lesson;
let all: any = {};
const save = (status?: any, base = G.goalViewOf(lesson, 'a', all)!.revision) => G.acceptGoalSave(lesson, 'a', {
  lesson: lesson.sha256, goal: '예약 버튼', criteria: ['직접 확인'], base, ...(status === undefined ? {} : {status}),
}, all, 1000);
let result = save(); assert.ok(result.ok); all = result.all;
assert.equal(G.goalViewOf(lesson, 'a', all)!.status, undefined, 'legacy status remains compatible');
for (const status of Object.keys(G.GOAL_STATUSES)) {
  result = save(status); assert.ok(result.ok); all = result.all;
  assert.equal(G.goalViewOf(lesson, 'a', all)!.status, status, 'reload reads saved status');
  const edit = save(); assert.ok(edit.ok); assert.equal(edit.record.status, status, 'text edit preserves status');
}
for (const bad of ['__proto__', 'COMPLETE', '\u202ecomplete', null, 1]) assert.equal(save(bad).ok, false, 'invalid status');
const corrupted = structuredClone(all); Object.values(corrupted).forEach((r:any)=>r.status='forged');
assert.equal(G.goalViewOf(lesson, 'a', corrupted)!.status, undefined, 'corrupt persisted status refused');
assert.equal(save('active', 0).ok, false, 'stale status cannot overwrite');
assert.equal(G.goalViewOf(lesson, 'other', all)!.status, undefined, 'activity isolated');
assert.equal(G.goalViewOf({...lesson,sha256:'a'.repeat(64)}, 'a', all)!.status, undefined, 'lesson isolated');
const old = G.goalViewOf(lesson,'a',all)!;
assert.equal(G.acceptGoalView(old, {...old,revision:0,status:'active'})!.status, old.status, 'stale config');

const funding = () => ({ status: 'ready', selected: 'class', view: { configured: true, as_of: '2026-10-22T00:00:00Z', choices: [{id:'class',active:true,available:true,source_kind:'cohort',state:'ready',resources:[{meter:'requests:count',remaining:12,unresolved:0,shared:true}]}]}});
config.access = funding(); assert.match(lessonBudget(config), /함께 쓰는 12회/);
config.access.view.choices[0].resources[0].remaining=0; assert.match(lessonBudget(config), /^함께 쓰는 0회/,'confirmed zero is real');
for (const mutate of [
 (a:any)=>a.status='unknown', (a:any)=>a.view.choices[0].active=false, (a:any)=>a.view.choices[0].available=false, (a:any)=>a.selected='other', (a:any)=>a.view.configured=false,
 (a:any)=>a.view.as_of='bad', (a:any)=>a.view.choices[0].source_kind='account',
 (a:any)=>a.view.choices[0].state='review_required', (a:any)=>a.view.choices[0].resources=[],
 (a:any)=>a.view.choices[0].resources.push({...a.view.choices[0].resources[0]}),
 (a:any)=>a.view.choices[0].resources[0].remaining=NaN,
 (a:any)=>a.view.choices[0].resources[0].remaining=-1,
 (a:any)=>a.view.choices[0].resources[0].unresolved=1,
 (a:any)=>a.view.choices[0].resources[0].meter='currency:USD',
]) {config.access=funding();mutate(config.access);assert.equal(lessonBudget(config),'확인 안 됨');}
config.access=undefined;assert.equal(lessonBudget(config),'확인 안 됨');

async function run() {
 const host:any=mountPoint(),root=createRoot(host);const saves:any[]=[];
 const render=async(view:any,pending=false,cfg=config)=>act(async()=>root.render(<GoalStatusBar config={cfg} view={view} pending={pending} onSave={r=>saves.push(r)}/>));
 const buttons=()=>host.findAll((e:any)=>e.localName==='button');
 const view={...old,status:'active' as const};
 await render(view);assert.match(host.textContent,/진행 중 · 내가 표시한 상태/);assert.match(host.textContent,/남은 수업 예산 · 확인 안 됨/);
 for(const [status,label] of Object.entries(G.GOAL_STATUSES)) {
  await act(async()=>click(buttons().find((e:any)=>e.textContent===label)));
  assert.equal(saves.at(-1).status,status);assert.equal(saves.at(-1).base,view.revision);
  assert.equal(saves.at(-1).lesson,view.lesson.sha256);assert.equal(saves.at(-1).goal,'예약 버튼');
  assert.match(host.textContent,/진행 중 · 내가 표시한 상태/,'no optimistic state');
  await render({...view,status});assert.ok(host.textContent.includes(`${label} · 내가 표시한 상태`));await render(view);
 }
 config.access=funding();await render(view);assert.match(host.textContent,/남은 수업 예산 · 함께 쓰는 12회/);
 config.access.view.choices[0].resources[0].remaining=0;await render(view);assert.match(host.textContent,/남은 수업 예산 · 함께 쓰는 0회/);
 await render({...view,status:undefined});assert.match(host.textContent,/진행 중 · 상태를 직접 표시해 주세요/);
 await render(view,true);assert.ok(buttons().every((b:any)=>b.hasAttribute("disabled")));
 await render({...view,goal:''});assert.ok(buttons().every((b:any)=>b.hasAttribute("disabled")));
 await render(view,false,{...config,activity:{free:true}});assert.ok(!host.textContent.includes('수업 예산'));
 await render(view,false,{...config,profile:{...config.profile,profile_id:'studio-open-trial'}});assert.ok(!host.textContent.includes('수업 예산'));
 await render(null);assert.equal(host.textContent,'');
 await act(async()=>root.unmount());
 config.access=undefined;
 const panel:any=mountPoint(),pr=createRoot(panel);let sends=0;
 const props:any=chatPanelProps({config:{...config,studentGoal:view},onSend:()=>sends++});
 await act(async()=>pr.render(<ChatPanel {...props}/>));
 const bar=panel.findAll((e:any)=>e.getAttribute('aria-label')==='내 목표 상태')[0];
 assert.ok(bar,'real ChatPanel mounts strip');assert.equal(bar.parentNode.localName,'footer');
 assert.ok(bar.textContent.includes('예약 버튼'));
 const posted=(globalThis as any).__posted;const before=posted.length;
 const complete=bar.findAll((e:any)=>e.localName==='button'&&e.textContent==='이룸')[0];
 await act(async()=>{click(complete);click(complete);});
 const requests=posted.slice(before);assert.equal(requests.length,1,'double press single pending save');
 assert.equal(requests[0].type,'goalSave');assert.equal(requests[0].status,'complete');assert.equal(sends,0,'no runtime send');
 const next={...props,config:{...props.config,activity:{...props.config.activity,id:'a2'},studentGoal:{...view,activity:'a2'}}};
 await act(async()=>pr.render(<ChatPanel {...next}/>));
 const nextBar=panel.findAll((e:any)=>e.getAttribute('aria-label')==='내 목표 상태')[0];
 const nextComplete=nextBar.findAll((e:any)=>e.localName==='button'&&e.textContent==='이룸')[0];
 assert.ok(!nextComplete.hasAttribute('disabled'),'scope switch releases old pending request');
 await act(async()=>click(nextComplete));assert.equal(posted.at(-1).type,'goalSave');
 assert.equal(posted.slice(before).filter((m:any)=>m.type==='goalSave').length,2,'new scope can save');assert.equal(sends,0);
 await act(async()=>pr.render(<ChatPanel {...props} instructor/>));
 assert.equal(panel.findAll((e:any)=>e.getAttribute('aria-label')==='내 목표 상태').length,0);
 await act(async()=>pr.unmount());
 console.log('goal status persistence, budget, learner actions and composer integration PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
