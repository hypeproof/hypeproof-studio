import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { ChatPreferences } from '../webview-ui/src/ChatPreferences';
import { EffortControl } from '../webview-ui/src/EffortControl';
import type { ChatConfig } from '../src/protocol';
for (const personal of [true, false]) {
  const html = renderToStaticMarkup(<ChatPreferences open={false} onClose={()=>{}}><EffortControl personal={personal} post={()=>{}} config={{effort:{value:'medium',allowed:['low','medium','high']}} as ChatConfig}/></ChatPreferences>);
  for (const label of ['대화 설정','대화 설정 닫기','생각 깊이','가볍게','보통','깊게',personal?'적용 기록':'생각 깊이 설정 확인']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, />[^<]*(?:Effort|Low|Medium|High)[^<]*</);
}
console.log('PASS personal and classroom settings Korean rendered labels');
