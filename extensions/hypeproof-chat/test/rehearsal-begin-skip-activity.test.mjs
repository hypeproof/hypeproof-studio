// #4513 — the real StartPage (src/startPage.ts) beginCourse, bundled with the real ActivityConnections, runs a
// learner code on another device (no seat, no return key, student code only). The Service answers GET /v1/activity
// with 403 subscription_rehearsal for a subscription rehearsal (Service #450), so the start page must not call it.
// The fetch is a counting stub; the call count and the entry reached (the begin callback) are the observations.
// Controls first: an ordinary code and a server-path rehearsal keep calling /v1/activity once, and a 403 there still
// stops the entry. Run: node --experimental-strip-types --test test/rehearsal-begin-skip-activity.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: { contents: "export * from './src/startPage.ts';export * from './src/activityConnections.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'error',
});

const SERVICE = 'https://svc.test/v1';
const ACTIVITY_ID = 'a'.repeat(64);
const CODE = 'synthetic-student-code-' + 'c'.repeat(32);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { profile_id: 'studio-classroom-synthetic', display_name: '수업', activity_kind: 'classroom', activity_id: ACTIVITY_ID, ux: { coach: { naming_mode: 'fixed', fallback_name: '코치' } }, welcome: {} };
const rehearsal = path => ({ ...base, rehearsal: { id: 'rh-synthetic', course_id: 'course-synthetic', version: 'v1', expires_at: Date.now() + 3600e3, judged: false, path } });
const ACTIVITY_OK = { status: 200, body: { activity_id: ACTIVITY_ID } };
const ACTIVITY_403 = { status: 403, body: { error: { type: 'subscription_rehearsal', message: 'subscription rehearsal' } } };

// Any other chat member is inert: reads give another inert value, calls return undefined; never a thenable.
const inert = new Proxy(function () {}, { get: (_t, k) => k === 'then' ? undefined : inert, apply: () => undefined });

function harness({ profile, activity }) {
  const calls = [];
  const fakeFetch = async url => {
    const pathname = new URL(String(url)).pathname;
    calls.push(pathname);
    if (pathname.endsWith('/profile')) return json(200, profile);
    if (pathname.endsWith('/activity')) return json(activity.status, activity.body);
    return json(404, { error: { message: 'not found' } });
  };
  const store = new Map();
  const raw = {
    workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} },
    globalState: { get: (_k, d) => d, update: async () => {} },
    secrets: { keys: async () => [...store.keys()], get: async k => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, onDidChange: () => ({ dispose() {} }) },
    extension: { packageJSON: { version: '0.0.0-test' } }, subscriptions: [], globalStorageUri: { fsPath: '/tmp/hps-4513-unused' }, storageUri: undefined,
  };
  const vscode = {
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => key === 'proxyUrl' ? SERVICE : fallback }) },
    window: {}, commands: { executeCommand: async () => undefined }, Uri: { parse: s => s, file: p => ({ fsPath: p }) }, env: { openExternal: async () => true },
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: id => id === 'vscode' ? vscode : require(id),
    console, Buffer, structuredClone, AbortSignal, URL, process, TextEncoder, fetch: fakeFetch, Response, Headers, Date, JSON,
    setTimeout: () => 0, clearTimeout: () => {},
  });
  const { StartPage, ActivityConnections, activityService } = module.exports;
  const connections = new ActivityConnections(raw, () => SERVICE, () => '/tmp/hps-4513-unused', async () => base);
  connections.initialize?.();
  const scoped = connections.wrap();
  const begun = [];
  const chat = new Proxy({
    openInEditor: async () => undefined, ensureProfile: async () => base, profileFailure: () => undefined, invalidateProfile() {}, refreshConfig: async () => undefined,
    hasActiveStream: () => false, setConnectionChanging: async () => undefined, coachDisplayName: () => '코치', coachNameIsChosen: () => true, funnelEmit() {},
    noteFreeClaim() {}, takeMyWork: async () => true,
  }, { get: (t, k) => k in t ? t[k] : inert });
  const page = new StartPage(scoped, chat, async (p) => { begun.push(p.profile_id); return true; }, undefined, undefined);
  page.panel = { webview: { postMessage: async () => undefined } };
  page.candidate = { token: CODE, proxyUrl: SERVICE, profile: base, previousConnected: false };
  return { page, calls, begun, activityService };
}

const activityCalls = h => h.calls.filter(p => p.endsWith('/activity')).length;

test('positive control: an ordinary code calls GET /v1/activity once and a 403 there stops entry', async () => {
  const ok = harness({ profile: base, activity: ACTIVITY_OK });
  await ok.page.handle({ type: 'beginCourse' });
  assert.equal(activityCalls(ok), 1, 'ordinary code: one /v1/activity call (counter sees the call)');
  assert.equal(ok.begun.length, 1, 'ordinary code: entry reached after a 200');

  const denied = harness({ profile: base, activity: ACTIVITY_403 });
  await denied.page.handle({ type: 'beginCourse' });
  assert.equal(activityCalls(denied), 1);
  assert.equal(denied.begun.length, 0, 'ordinary code: a 403 stops entry');
  assert.ok(denied.page.error, 'ordinary code: the 403 is shown as an error');
});

test('subscription rehearsal on another device: no /v1/activity call, and the entry is reached', async () => {
  const h = harness({ profile: rehearsal('subscription'), activity: ACTIVITY_403 });
  await h.page.handle({ type: 'beginCourse' });
  assert.equal(activityCalls(h), 0, 'no GET /v1/activity for a subscription rehearsal');
  assert.deepEqual(h.begun, [base.profile_id], 'entry (seat) reached');
  assert.equal(h.page.error, undefined, 'no error shown');
});

test('controls: server-path rehearsal keeps the activity check; a 403 there still stops entry', async () => {
  const ok = harness({ profile: rehearsal('server'), activity: ACTIVITY_OK });
  await ok.page.handle({ type: 'beginCourse' });
  assert.equal(activityCalls(ok), 1, 'server path: one /v1/activity call');
  assert.equal(ok.begun.length, 1, 'server path: entry after a 200');

  const denied = harness({ profile: rehearsal('server'), activity: ACTIVITY_403 });
  await denied.page.handle({ type: 'beginCourse' });
  assert.equal(activityCalls(denied), 1);
  assert.equal(denied.begun.length, 0, 'server path: a 403 stops entry');
});
