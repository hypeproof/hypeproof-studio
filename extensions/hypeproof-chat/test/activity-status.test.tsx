import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { activityFailure, accessFailure, responseEvidence, ACTIVITY_CAUSE_COPY } from '../src/activityAvailability';
import { ActivityStatus } from '../webview-ui/src/ActivityStatus';
for (const [status, code, cause] of [[401,undefined,'auth'],[401,'expired','expired'],[403,'session_window','ended'],[403,'cohort_paused','paused'],[429,'budget_exhausted','exhausted'],[403,undefined,'forbidden'],[503,undefined,'outage'],[429,undefined,'limited']] as const) {
  const evidence = responseEvidence(status, JSON.stringify({error:{code}}));
  assert.equal(activityFailure(evidence,'classroom')?.cause,cause);
  for (const audience of ['classroom','solo'] as const) {
    const view = activityFailure(evidence,audience)!;
    const noop = () => {};
    const html = renderToStaticMarkup(<ActivityStatus status={view} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop}/>);
    assert.match(html,/내 파일 열기/); assert.match(html,/내 파일 내보내기/);
    assert.doesNotMatch(html,/disabled|결제|구매/);
    assert.match(html, audience === 'classroom' ? /강사/ : /HypeProof 지원팀/);
  }
}
assert.equal(activityFailure(responseEvidence(401,'{"error":{"code":"expired\\u202e"}}'),'solo')?.cause,'auth');
assert.equal(activityFailure(responseEvidence(500,'bad JSON'),'solo')?.cause,'outage');
assert.equal(activityFailure({status:413},'solo'),null);
for (const state of ['ended','paused','exhausted']) assert.equal(accessFailure(state,'classroom')?.cause,state);
assert.equal(accessFailure('external_unknown','solo'),null);
console.log('activity-status: exact causes, negative controls, enabled file actions and seat contacts PASS');

// Exercise the real HTTP boundary, not only constructed errors.
import {proxyChat, verifyActivity} from '../src/proxyClient';
import {activityLocalFile} from '../src/activityLocalFiles';
async function transportAndFiles() {
 const fetchBefore=globalThis.fetch;
 try {
  for (const [status,code,cause] of [[401,'expired','expired'],[403,'cohort_paused','paused'],[429,'budget_exhausted','exhausted'],[503,undefined,'outage']] as const) {
   globalThis.fetch=async()=>new Response(JSON.stringify({error:{code}}),{status,headers:{'x-request-id':'synthetic-request'}});
   for (const run of [()=>proxyChat({proxyUrl:'https://example.invalid/v1',model:'none',token:undefined,history:[],userText:'fixture',signal:new AbortController().signal,onDelta:()=>{}}),()=>verifyActivity({proxyUrl:'https://example.invalid/v1',token:'fixture'},'fixture')]) {
    await assert.rejects(run(),(e: unknown)=>{
     const error=e as {evidence?: {status?:number;code?:string}; requestId?:string};
     assert.equal(activityFailure(error.evidence ?? {},'classroom')?.cause,cause);
     assert.equal(error.requestId,'synthetic-request');return true;
    });
   }
  }
 } finally {globalThis.fetch=fetchBefore;}
 const effects:string[]=[];
 const ports={choose:async()=> 'mine',destination:async()=> 'copy',open:async(p:string)=>{effects.push(p);},copy:async(a:string,b:string)=>{effects.push(`${a}:${b}`);},current:()=>true};
 await activityLocalFile('open',ports);await activityLocalFile('export',ports);assert.deepEqual(effects,['mine','mine:copy']);
 await activityLocalFile('export',{...ports,current:()=>false});assert.equal(effects.length,2);
 console.log('activity-status transport and local-only file controls PASS');
}
transportAndFiles().catch(e=>{console.error(e);process.exitCode=1;});

import {classifyProfileFailure} from '../src/proxyClientHelpers';
for (const [type,cause] of [['cohort_paused','paused'],['session_window','ended'],['session_inactive','not_started']] as const) assert.equal(activityFailure(classifyProfileFailure(403,JSON.stringify({error:{type}})),'classroom')?.cause,cause);

assert.doesNotMatch(renderToStaticMarkup(<ActivityStatus status={{cause:'exhausted',audience:'classroom'}} onOpen={()=>{}} onExport={()=>{}} onRecover={()=>{}} onSupport={()=>{}}><button>결제</button></ActivityStatus>),/결제/);

// ── Fix round 1: evidence codes, the sanitiser and the token button are pinned one by one. ──
{
  const solo = (e: Parameters<typeof activityFailure>[0]) => activityFailure(e, 'solo')?.cause;
  assert.equal(solo({ code: 'trial_exhausted' }), 'exhausted');
  assert.equal(solo({ type: 'trial_exhausted' }), 'exhausted');
  assert.equal(solo({ code: 'trial_cost_exhausted' }), 'exhausted');
  assert.equal(solo({ code: 'open_trial_daily_cap' }), 'exhausted');
  assert.equal(solo({ code: 'trial_revoked_or_reissued' }), 'revoked');
  assert.equal(solo({ status: 401, code: 'trial_revoked_or_reissued' }), 'revoked', 'revoked outranks a bare 401');
  assert.equal(solo({ status: 403, code: 'trial_expired' }), 'expired');
  assert.equal(solo({ status: 429, code: 'trial_exhausted' }), 'exhausted');
  assert.equal(solo({ kind: 'expired' } as never), 'expired');
  assert.equal(solo({ kind: 'missing' } as never), 'auth');
  assert.equal(solo({ kind: 'wrong_role' } as never), 'auth');
  assert.equal(solo({ code: 'session_inactive' }), 'not_started');
  assert.equal(solo({ code: 'not_in_roster' }), 'forbidden');
  assert.equal(activityFailure({ code: 'unheard_of' }, 'solo'), null, 'an unlisted code is not guessed');
  // The sanitiser: only a short lowercase snake_case token survives, nothing else is evidence.
  const code = (c: unknown) => responseEvidence(400, JSON.stringify({ error: { code: c } })).code;
  assert.equal(code('trial_exhausted'), 'trial_exhausted');
  assert.equal(code('a'.repeat(64)), 'a'.repeat(64));
  for (const bad of ['a'.repeat(65), 'Expired', 'trial exhausted', 'expired‮', 'expired ', 'expired\n', 'expired-1', 'expireD', '', 'ｅｘｐｉｒｅｄ', 7, null, { a: 1 }]) assert.equal(code(bad), undefined, JSON.stringify(bad));
  assert.equal(responseEvidence(400, JSON.stringify({ error: { type: 'x'.repeat(65) } })).type, undefined);
  assert.equal(responseEvidence(400, JSON.stringify({ error: { type: 'cohort_paused' } })).type, 'cohort_paused');
  assert.deepEqual(responseEvidence(502, '[]'), { status: 502, code: undefined, type: undefined });
  // The token button belongs to auth and expired only, and only when the host gave it a handler.
  const noop = () => {};
  const causes = ['auth', 'expired', 'ended', 'paused', 'exhausted', 'forbidden', 'not_started', 'outage', 'limited', 'unknown', 'revoked'] as const;
  for (const cause of causes) {
    const withToken = renderToStaticMarkup(<ActivityStatus status={{ cause, audience: 'solo' }} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop} onToken={noop} />);
    assert.equal(/참여 코드 확인/.test(withToken), cause === 'auth' || cause === 'expired', `token button for ${cause}`);
    assert.match(withToken, /상태 다시 확인/); assert.match(withToken, /HypeProof 지원 문의/);
    const without = renderToStaticMarkup(<ActivityStatus status={{ cause, audience: 'solo' }} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop} />);
    assert.doesNotMatch(without, /참여 코드 확인/);
  }
  // Solo seats receive the host's child (the trial card slot); classroom seats never do.
  assert.match(renderToStaticMarkup(<ActivityStatus status={{ cause: 'exhausted', audience: 'solo' }} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop}><b>슬롯</b></ActivityStatus>), /슬롯/);
  assert.doesNotMatch(renderToStaticMarkup(<ActivityStatus status={{ cause: 'exhausted', audience: 'classroom' }} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop}><b>슬롯</b></ActivityStatus>), /슬롯/);
  // Every cause has its own sentence; none of them is the fallback.
  const sentences = new Set(causes.map(c => ACTIVITY_CAUSE_COPY[c]));
  assert.equal(sentences.size, causes.length);
  console.log('activity-status: evidence codes, sanitiser, token button gate PASS');
}
