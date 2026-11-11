// CGP-SHELL-R-024 / CGP-SHELL-D-023 (ADM-11): a classroom seat is told, once, what the instructor changed in its lesson
// settings, before its next turn. Drives the real ChatPanelProvider (postConfig, handleMessage, the U3 preflight adoption)
// bundled with esbuild against a fake vscode, with one globalState shared by "windows" so a reload can be replayed.
// The assertions read only the posted panel config and the persisted state, so they fail on a build without the feature.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const built = await build({ stdin: { contents: "export { ChatPanelProvider } from './src/chatPanelProvider';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const settings = { coachRuntime: 'agent-sdk', requireApprovalFor: [] };
const vscode = { env: { appName: 'HypeProof Studio' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }, commands: { executeCommand: async () => {} }, window: { showWarningMessage: async () => undefined } };
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require: id => id === 'vscode' ? vscode : require(id), console, process, Buffer, URL, setTimeout, clearTimeout });

const TOKEN = 'header.payload-for-seat-1.sig';
const ACTIVITY = 'a'.repeat(64);
// One globalState for the whole "machine": every window of the app shares it.
const memento = new Map();
const globalState = { get: (k, fallback) => (memento.has(k) ? memento.get(k) : fallback), update: async (k, v) => { memento.set(k, JSON.parse(JSON.stringify(v))); }, keys: () => [...memento.keys()] };
let history = [];
let profile;

/** One window: a fresh provider on the shared globalState (a reload is a new one). */
function openWindow() {
  const h = Object.create(module.exports.ChatPanelProvider.prototype);
  const posts = [];
  Object.assign(h, {
    preview: { setAskAboutFileEnabled() {} },
    context: { secrets: { get: async k => (k === 'hypeproofChat.workshopToken' ? TOKEN : undefined) }, workspaceState: { get: (key, fallback) => (key.startsWith('hps.history') || key.startsWith('hypeproofChat.history') ? history : fallback) }, globalState },
    // As in production, the profile postConfig reads is also the cached one (approval asks follow its preset).
    loadAccess: async () => {}, ensureProfile: async () => (h.cachedProfile = profile), refreshCrDirectorContext: async () => {},
    _instructorMode: { checkInstructorMode: async () => false, reset() {} },
    prepareTaskWorkspace: async () => {}, currentTaskStore: () => null, getHistory: () => history,
    getCoach: () => ({ name: 'HypeProof' }), sitePublisher: () => ({ available: () => false }),
    activeStreams: new Map(), pendingSends: 0, view: { visible: true },
    post: async m => posts.push(JSON.parse(JSON.stringify(m))),
  });
  const publish = async () => { await h.postConfig(); return posts.filter(p => p.type === 'config').at(-1).config; };
  return { h, posts, publish };
}

// CGP-AGENT-R-019: preset labels come from the one catalog copy, never an inline string.
const CATALOG = JSON.parse(readFileSync(new URL('../../../chalk/test/fixtures/approval-preset-catalog.json', import.meta.url), 'utf8'));
const L = Object.fromEntries(CATALOG.map(p => [p.id, p.label]));
const preset = (id) => ({ ...CATALOG.find(p => p.id === id) });
const classroom = (over = {}) => ({
  profile_id: 'kids-class', activity_kind: 'classroom', activity_id: ACTIVITY,
  sdk_tools: { read: true, write: true },
  approval_preset: preset('important_only'),
  voice: { dictation: true, read_aloud: true, policy_version: 'hps-voice-policy/1' },
  starters: ['그림을 그려 줘', '게임을 만들고 싶어'],
  ...over,
});

// 1. First load is a silent baseline, persisted without the credential.
let w = openWindow();
profile = classroom();
let c = await w.publish();
assert.equal(c.lessonSettingsChanges, undefined, 'first load: no line');
const stored = JSON.stringify([...memento.entries()]);
assert.ok(memento.has('hps.lessonSettings.baseline'), 'baseline persisted in globalState');
assert.ok(!stored.includes(TOKEN) && !stored.includes(ACTIVITY), 'no credential or raw activity id is stored');
assert.ok(!stored.includes('그림을 그려 줘'), 'starter text is not stored, only a fingerprint');
c = await w.publish();
assert.equal(c.lessonSettingsChanges, undefined, 'same profile again: still nothing');

// 2. The instructor changes the preset and switches 계획 먼저 off: ONE line lists both, before → after, served labels.
history = [{ id: 'u1', role: 'user', content: '안녕', createdAt: 1 }, { id: 'a1', role: 'assistant', content: '안녕하세요', createdAt: 2 }];
profile = classroom({ approval_preset: preset('before_changes'), plan_first: { available: false } });
c = await w.publish();
assert.equal(c.lessonSettingsChanges?.length, 1, 'one line for one change set');
let line = c.lessonSettingsChanges[0];
assert.equal(line.text, `선생님이 도움 방식을 바꿨어요: 승인 방식 ${L.important_only} → ${L.before_changes} · 계획 먼저 켜짐 → 꺼짐`);
assert.deepEqual(line.items.map(i => i.key), ['approval_preset', 'plan_first']);
assert.equal(line.afterMessageId, 'a1', 'placed after the last saved message, i.e. before the next turn');
assert.equal(line.seen, false);
const firstId = line.id;
c = await w.publish();
assert.equal(c.lessonSettingsChanges.length, 1, 're-posting the same profile keeps one line');
assert.equal(c.lessonSettingsChanges[0].id, firstId, 'same line, same id (not announced again)');

// 3. Not yet on screen: a reload tells it again (the learner never saw it).
w = openWindow();
c = await w.publish();
assert.equal(c.lessonSettingsChanges?.length, 1, 'unseen line survives a reload');
assert.ok(c.lessonSettingsChanges[0].text.includes(`승인 방식 ${L.important_only} → ${L.before_changes}`));
line = c.lessonSettingsChanges[0];

// 4a. Drawn while the sidebar is collapsed (the webview still renders): not seen yet; a reload still tells it.
w.h.view.visible = false;
await w.h.handleMessage({ type: 'lessonSettingsChangeSeen', id: line.id });
assert.equal((await w.publish()).lessonSettingsChanges[0].seen, false, 'drawn while hidden: not seen');
assert.equal((await openWindow().publish()).lessonSettingsChanges?.length, 1, 'drawn while hidden: a reload tells it again');
// 4b. The chat is shown (what the view's visibility hook calls): now it counts; this window keeps drawing it as seen.
w.h.view.visible = true;
await w.h.flushLessonLinesShown();
c = await w.publish();
assert.equal(c.lessonSettingsChanges?.length, 1, 'the seen line stays in this window');
assert.equal(c.lessonSettingsChanges[0].seen, true, 'drawn as seen (no live region)');
await w.h.handleMessage({ type: 'lessonSettingsChangeSeen', id: 'lsc-999' });

// 5. Reload after it was seen: no repeat.
w = openWindow();
c = await w.publish();
assert.equal(c.lessonSettingsChanges, undefined, 'reload after seen: no repeat');

// 6. Free text: a starter change is named, never quoted. Voice off reads with the voice labels.
profile = classroom({ approval_preset: preset('before_changes'), plan_first: { available: false }, starters: ['새 비밀 문장이에요'], voice: { read_aloud: true, policy_version: 'hps-voice-policy/1' } });
c = await w.publish();
line = c.lessonSettingsChanges[0];
assert.equal(line.text, '선생님이 도움 방식을 바꿨어요: 받아쓰기 켜짐 → 꺼짐 · 시작 문장 바뀜');
assert.ok(!JSON.stringify(c.lessonSettingsChanges).includes('새 비밀 문장이에요'), 'free text is never quoted');
assert.deepEqual(line.items.find(i => i.key === 'starters'), { key: 'starters', label: '시작 문장' }, 'free text has no before/after');

// 7. A change undone before it was seen clears the line.
profile = classroom({ approval_preset: preset('before_changes'), plan_first: { available: false } });
c = await w.publish();
assert.equal(c.lessonSettingsChanges, undefined, 'undone before seen: nothing to tell');

// 8. Mid-turn: a change seen while a turn runs is not shown and does not move the baseline; it appears when the turn ends.
w = openWindow();
profile = classroom({ approval_preset: preset('always_ask'), plan_first: { available: false } });
w.h.pendingSends = 1;
c = await w.publish();
assert.equal(c.lessonSettingsChanges, undefined, 'no line while the turn runs');
assert.equal(w.h.lessonChangeDeferred, true, 'the line waits for the turn to end');
// The turn ends: the same release handleSend's finally calls (wiring checked in 10e) posts the config by itself.
w.h.pendingSends = 0;
const before8 = w.posts.length;
w.h.releaseDeferredLessonLine();
await new Promise(r => setTimeout(r, 20));
assert.ok(w.posts.length > before8, 'the turn end posted the config itself');
c = w.posts.filter(p => p.type === 'config').at(-1).config;
assert.equal(c.lessonSettingsChanges?.[0]?.text, `선생님이 도움 방식을 바꿨어요: 승인 방식 ${L.before_changes} → ${L.always_ask}`, 'shown after the turn');
await w.h.handleMessage({ type: 'lessonSettingsChangeSeen', id: c.lessonSettingsChanges[0].id });

// 9. #751 U3: the turn-start preflight adopts a switched setting while that turn is starting. That change applies to
// the starting turn, so its line is posted now (not deferred), placed after the last saved message = before this turn.
history = [...history, { id: 'u2', role: 'user', content: '다음', createdAt: 3 }, { id: 'a2', role: 'assistant', content: '네', createdAt: 4 }];
w.h.pendingSends = 1;
w.h.rememberLinkSafety = async () => {};
w.h.syncPlanFirstWithProfile = () => {};
// The fixture's ensureProfile returns `profile`, so it is set to what the preflight adopts (the real one returns cachedProfile).
// The baseline had write on under 항상 묻기, so the card's word for it was 물어봐요.
profile = classroom({ approval_preset: preset('always_ask'), plan_first: { available: false }, lesson_binding: { key: 'b'.repeat(32), seq: 2, source: 'setting', object_id: 'o', revision: 1, enforced: true }, sdk_tools: { read: true } });
await w.h.adoptPreflightProfile(profile, TOKEN);
c = w.posts.filter(p => p.type === 'config').at(-1).config;
assert.equal(c.lessonSettingsChanges?.at(-1)?.text, '선생님이 도움 방식을 바꿨어요: 작업 폴더의 파일 고치기 물어봐요 → 안 해요', 'U3 switch: told before the starting turn, in the card\'s words');
assert.equal(c.lessonSettingsChanges.at(-1).afterMessageId, 'a2');
assert.equal(w.h.lessonChangeDeferred, false);
w.h.pendingSends = 0;

// 10. Learner-side inputs alone are not the instructor's change: the runtime setting flips, nothing is told.
await w.h.handleMessage({ type: 'lessonSettingsChangeSeen', id: c.lessonSettingsChanges.at(-1).id });
settings.coachRuntime = 'proxy';
c = await w.publish();
assert.ok(!(c.lessonSettingsChanges ?? []).some(l => !l.seen), 'a runtime setting change alone makes no line');
settings.coachRuntime = 'agent-sdk';
c = await w.publish();
assert.ok(!(c.lessonSettingsChanges ?? []).some(l => !l.seen), 'and back: still nothing');

// 10b. Another classroom seat on this machine (another activity) keeps its own baseline.
const seat1 = profile;
profile = classroom({ activity_id: 'e'.repeat(64) });
assert.equal((await openWindow().publish()).lessonSettingsChanges, undefined, 'another classroom seat: its own silent first load');
profile = seat1;
assert.ok(!((await openWindow().publish()).lessonSettingsChanges ?? []).some(l => !l.seen), 'seat 1 is not changed by seat 2');

// 10c. A fallback in one session neither makes a line nor swallows the instructor's next capability change.
{
  profile = classroom({ activity_id: 'f'.repeat(64) });
  const s1 = openWindow(); await s1.publish();
  s1.h.fallbackNoticeShown = true;
  assert.ok(!((await s1.publish()).lessonSettingsChanges ?? []).some(l => !l.seen), 'a fallback alone makes no line');
  profile = classroom({ activity_id: 'f'.repeat(64), sdk_tools: { read: true } });
  const s2 = openWindow();
  assert.equal((await s2.publish()).lessonSettingsChanges?.[0]?.text, '선생님이 도움 방식을 바꿨어요: 작업 폴더의 파일 고치기 해요 → 안 해요', 'capability change after a fallback session');
}

// 10d. A change found by the 이미지 편집 refresh (real editImage) is told when that action ends, before the next turn.
{
  profile = classroom({ activity_id: '9'.repeat(64) });
  const e = openWindow(); await e.publish();
  profile = classroom({ activity_id: '9'.repeat(64), approval_preset: preset('always_ask') });
  await e.h.editImage();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(e.h.pendingSends, 0);
  assert.equal(e.posts.filter(p => p.type === 'config').at(-1).config.lessonSettingsChanges?.[0]?.text, `선생님이 도움 방식을 바꿨어요: 승인 방식 ${L.important_only} → ${L.always_ask}`, 'told when image edit ends');
}

// 10e. Wiring the fixture cannot drive: both chat surfaces count hidden-drawn lines when shown; a turn's end releases a held line.
{
  const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
  assert.equal((src.match(/else void this\.flushLessonLinesShown\(\)/g) ?? []).length, 2, 'sidebar and editor visibility hooks flush');
  assert.match(src, /this\.pendingSends--; settle\.settled\(\);[\s\S]{0,400}this\.releaseDeferredLessonLine\(\);/, 'turn end releases a held line');
  assert.match(src, /finally \{ this\.pendingSends--; this\.releaseDeferredLessonLine\(\); \}/, 'image edit end releases a held line');
}

// 10f. A seat switch while the chat is hidden: seat A's hidden-drawn line is not counted for seat A by the next seat.
{
  profile = classroom({ activity_id: '7'.repeat(64) });
  const a = openWindow(); await a.publish();
  profile = classroom({ activity_id: '7'.repeat(64), plan_first: { available: false } });
  const lineA = (await a.publish()).lessonSettingsChanges[0];
  a.h.view.visible = false;
  await a.h.handleMessage({ type: 'lessonSettingsChangeSeen', id: lineA.id });
  Object.assign(a.h, { endTaskCommandAllows() {}, refreshCrBytesContext: async () => {}, refreshSitePublishContext() {}, reconcileSavedLinkSafety: async () => {} });
  a.h.invalidateProfile();
  a.h.view.visible = true;
  await a.h.flushLessonLinesShown();
  assert.equal((await openWindow().publish()).lessonSettingsChanges?.[0]?.text, '선생님이 도움 방식을 바꿨어요: 계획 먼저 켜짐 → 꺼짐', "seat A's unseen line is still told to seat A");
}

// 10g. The narrow race: a post saw the turn running, but the turn had ended (and found nothing to release) before the
// post finished. The post itself releases the line once more instead of leaving it held until some later post.
{
  profile = classroom({ activity_id: '6'.repeat(64) });
  const r = openWindow(); await r.publish();
  profile = classroom({ activity_id: '6'.repeat(64), plan_first: { available: false } });
  let calls = 0;
  r.h.lessonTurnRunning = () => (calls++ === 0); // running when the post looked, ended right after
  const c1 = await r.publish();
  assert.equal(c1.lessonSettingsChanges, undefined, 'held while the turn looked running');
  await new Promise(res => setTimeout(res, 20));
  assert.equal(r.posts.filter(p => p.type === 'config').at(-1).config.lessonSettingsChanges?.[0]?.text, '선생님이 도움 방식을 바꿨어요: 계획 먼저 켜짐 → 꺼짐', 'released by the post itself');
  assert.equal(r.h.lessonChangeDeferred, false);
}

// 11. A personal seat never gets the instructor line (it has no instructor; REQ-STUDIO-CAPABILITY-CHANGE covers it).
// The instructor surface and local mode are covered in lesson-settings-change.test.mjs and the panel render test.
const personal = openWindow();
profile = { profile_id: 'solo', activity_kind: 'personal', activity_id: 'c'.repeat(64), approval_preset: preset('important_only') };
await personal.publish();
profile = { ...profile, approval_preset: preset('always_ask') };
assert.equal((await personal.publish()).lessonSettingsChanges, undefined, 'personal seat: no instructor line');
console.log('lesson-settings-change-host OK');
