import { click, document as doc, mountPoint } from './fixtures/mini-dom.mjs';
import React from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { ChatPanel } from '../webview-ui/src/ChatPanel';
import { aiCapabilities } from '../src/aiCapabilities';
import type { ChatConfig } from '../src/protocol';
const act = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = (globalThis as unknown as { __posted: {type: string; id?: string}[] }).__posted;
type El = { localName: string; textContent: string; getAttribute(k:string): string|null; findAll(fn:(e:El)=>boolean):El[] };
const all = (fn:(e:El)=>boolean) => (doc as unknown as {documentElement:El}).documentElement.findAll(fn);
const buttons = (label:string) => all(e => e.localName === 'button' && e.textContent === label);
const noop = () => {};
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = (caps?: ReturnType<typeof aiCapabilities>) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  ...(caps ? { aiCapabilities: caps } : {}),
}) as unknown as ChatConfig;

async function main() {
const css = readFileSync('webview-ui/src/styles.css','utf8');
const declarations = (selector:string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(escaped + ' \\{([^}]+)\\}').exec(css)?.[1] ?? '';
  return Object.fromEntries(body.split(';').map(s=>s.trim().split(/:\s*/,2)).filter(p=>p.length===2));
};
assert.ok([...css.matchAll(/@container studio-chat \(width < 688px\) \{([\s\S]*?)\n\}/g)].some(m=>m[1].includes('.hp-capability-reopen')), 'narrow header container breakpoint');
assert.ok(![...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].some(m=>m[1].includes('.hp-capability-reopen')), 'capability header must not answer to the viewport');
assert.equal(declarations('.hps-header .hp-capability-reopen')['font-size'] ?? css.match(/\.hps-header \.hp-capability-reopen \{ font-size: ([^;]+); \}/)?.[1], 'var(--hp-font-caption)');
const nextStyle = declarations('.hp-capability-next');
assert.equal(nextStyle['min-width'],'var(--hp-control-min)');
assert.equal(nextStyle['min-height'],'var(--hp-control-min)');
assert.equal(nextStyle['font-size'],'var(--hp-font-body)');
assert.equal(nextStyle.color,'inherit');
assert.equal(nextStyle.background,'transparent');
assert.equal(nextStyle.border,'var(--ds-c-studio-styles-size-3) solid currentColor');
assert.equal(declarations('.hps-header:has(.hp-capability-reopen)')['flex-wrap'],'wrap');
assert.equal(declarations('.hps-header .hp-capability-reopen')['flex-basis'],'100%');
assert.equal(declarations('.hps-header:has(.hp-capability-reopen) .hps-coach-name')['flex-shrink'],'0');

let root = createRoot(mountPoint() as never);
let cfg = { ...config(aiCapabilities({sdk_tools:{read:true,write:true}}, 'agent-sdk')), lessonCapabilityEntry:{id:'seat-a-v1',seen:false} };
const render = async (instructor=false) => act(async () => { root.render(<ChatPanel {...PROPS} config={cfg} instructor={instructor} />); });
const openCards = () => all(e => e.localName === 'details' && e.getAttribute('open') !== null && (e.getAttribute('class')??'').includes('hp-ai-can-do'));
await render();
assert.equal(openCards().length, 1, 'first entry visibly expanded');
assert.equal(buttons('알겠어요').length, 1, 'next action');
await act(async()=> { assert.equal(click(openCards()[0].findAll(e=>e.localName === 'summary')[0]),false,'first entry cannot collapse before Next'); });
const header = all(e => e.localName === 'header')[0];
assert.equal(header.findAll(e=>e.localName === 'button' && e.textContent === 'AI 안내').length, 1, 'reopen is in header');
assert.equal(all(e => e.getAttribute('data-capability') !== null).length, 6, 'six rows, not a duplicate card');
assert.ok(openCards()[0].textContent.includes('안 해요'));
assert.equal(openCards()[0].findAll(e => ['input','select','textarea'].includes(e.localName)).length, 0, 'no autonomy choice');
assert.deepEqual(openCards()[0].findAll(e=>e.localName === 'button').map(e=>e.textContent), ['알겠어요'], 'only Next, no autonomy button');
posted.length = 0;
(buttons('알겠어요')[0] as unknown as {focus():void}).focus();
await act(async () => { click(buttons('알겠어요')[0]); });
assert.deepEqual(posted, [{ type:'acknowledgeLessonCapabilities', id:'seat-a-v1' }], 'next acknowledges only its own lesson; no send or permission change');
assert.equal(buttons('알겠어요').length, 1, 'pending until host persists');
assert.equal((doc as unknown as {activeElement:{localName:string}}).activeElement.localName, 'button', 'pending receipt keeps focus in sheet');
cfg = { ...cfg, lessonCapabilityEntry:{id:'seat-a-v1',seen:true} };
await render();
assert.equal(openCards().length, 0, 'receipt closes first entry');
assert.equal(buttons('알겠어요').length, 0);
await act(async()=>root.unmount());
root = createRoot(mountPoint() as never);
await render();
assert.equal(openCards().length,0,'reload with receipt stays closed');
await act(async () => { click(buttons('AI 안내')[0]); });
assert.equal(openCards().length, 1, 'header reopens');
await act(async () => { click(buttons('알겠어요')[0]); });
assert.equal(openCards().length, 0, 'reopened card closes');
await act(async () => { click(buttons('AI 안내')[0]); });
cfg = { ...cfg, lessonCapabilityEntry:{id:'already-seen-other',seen:true} };
await render();
assert.equal(openCards().length,0,'other seen lesson stays closed');
cfg = { ...cfg, lessonCapabilityEntry:{id:'seat-a-v1',seen:true} };
await render();
assert.equal(openCards().length,0,'return does not resurrect a previous reopen');

cfg = { ...cfg, lessonCapabilityEntry:{id:'seat-b-v1',seen:false} };
await render();
assert.equal(openCards().length, 1, 'seat switch prompts');
cfg = { ...cfg, lessonCapabilityEntry:{id:'seat-a-v2',seen:false} };
await render();
assert.equal(openCards().length, 1, 'new lesson prompts');
await render(true);
assert.equal(buttons('알겠어요').length, 0, 'instructor excluded');
assert.equal(buttons('AI 안내').length, 0);
cfg = { ...cfg, lessonCapabilityEntry:undefined } as never;
await render();
assert.equal(openCards().length, 0, 'no lesson collapsed');
assert.equal(buttons('AI 안내').length, 0);
await act(async()=>root.unmount());
console.log('lesson-capability-entry UI OK');

}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
