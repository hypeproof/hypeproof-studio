import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ActivityStatus} from '../webview-ui/src/ActivityStatus';
const noop=()=>{};
for(const audience of ['solo','classroom'] as const){
 const props={status:{cause:'ended' as const,audience},onOpen:noop,onExport:noop,onRecover:noop,onSupport:noop};
 assert.doesNotMatch(renderToStaticMarkup(<ActivityStatus {...props}/>),/내 작업 가져가기/);
 const html=renderToStaticMarkup(<ActivityStatus {...props} onTakeaway={noop}/>);
 assert.match(html,/<button type="button">내 작업 가져가기<\/button>/);
 assert.doesNotMatch(html,/disabled/);
}
// Trigger gate: only the class-ended cause offers the takeaway; every other cause stays without it.
for(const cause of ['auth','expired','paused','exhausted','forbidden','not_started','outage','limited','unknown','revoked'] as const){
 for(const audience of ['solo','classroom'] as const){
  const html=renderToStaticMarkup(<ActivityStatus status={{cause,audience}} onOpen={noop} onExport={noop} onRecover={noop} onSupport={noop} onToken={noop} onTakeaway={noop}/>);
  assert.doesNotMatch(html,/내 작업 가져가기/,cause+'/'+audience);
  assert.match(html,/내 파일 열기/,'positive control: the status still renders '+cause);
 }
}
