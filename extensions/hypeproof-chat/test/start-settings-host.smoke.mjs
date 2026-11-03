// CGP-SHELL-R-014 (REQ-SHELL-14) — host side of the start page learner settings sheet.
// The real StartPage runs in a vm with a stub vscode: "설정" no longer reaches the VS Code settings
// editor; "고급 설정" does only for a non-minor seat (re-checked on the host, whatever the webview
// sent); the sheet's writes are validated and land in the store each row's behaviour reads.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

// ── pure helper: rows, cap, minor gate, hostile writes ──
const pure = await build({ entryPoints: [root + 'src/startSettings.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const S = { exports: {} }; vm.runInNewContext(pure.outputFiles[0].text, { module: S, exports: S.exports });
const { startSettingsView, parseStartSettingWrite, advancedSettingsAllowed, START_SETTING_ROWS, START_SETTINGS_MAX_ROWS } = S.exports;
assert.equal(START_SETTING_ROWS.length, START_SETTINGS_MAX_ROWS, 'REQ-SHELL-14 names six rows');
const J = (x) => JSON.parse(JSON.stringify(x)); // vm realm → this realm
const base = J(startSettingsView({ textSize: 'large', reduceMotion: 'on', notices: true, profileMinor: false, age: undefined }));
assert.deepEqual([...base.rows], ['textSize', 'reduceMotion', 'notices'], 'only rows whose behaviour exists, in the requirement order');
assert.ok(base.rows.length <= 6);
assert.deepEqual({ ...base, rows: 0 }, { rows: 0, textSize: 'large', reduceMotion: 'on', notices: true, advanced: true });
const odd = startSettingsView({ textSize: 'huge', reduceMotion: true, notices: 'yes', profileMinor: null, age: undefined });
assert.equal(odd.textSize, 'base'); assert.equal(odd.reduceMotion, 'auto'); assert.equal(odd.notices, false, 'only a real true turns notices on');
assert.equal(advancedSettingsAllowed({ profileMinor: true, age: '14+' }), false, 'minor profile: no 고급 설정');
assert.equal(advancedSettingsAllowed({ profileMinor: null, age: 'under14' }), false, 'under-14 free start: no 고급 설정');
assert.equal(advancedSettingsAllowed({ profileMinor: false, age: undefined }), true);
assert.equal(advancedSettingsAllowed({ profileMinor: null, age: undefined }), true, 'no seat yet: the setup path stays');
for (const bad of [null, 'x', {}, { key: 'textSize', value: 'Large' }, { key: 'textSize', value: 'base‮' }, { key: 'reduceMotion', value: true }, { key: 'notices', value: 'true' }, { key: 'theme', value: 'dark' }, { key: '__proto__', value: 'on' }, { key: 'model', value: 'x' }])
  assert.equal(parseStartSettingWrite(bad), null, 'refused: ' + JSON.stringify(bad));
assert.deepEqual(J(parseStartSettingWrite({ type: 'startSetting', key: 'textSize', value: 'xlarge' })), { key: 'textSize', value: 'xlarge' });
assert.deepEqual(J(parseStartSettingWrite({ key: 'reduceMotion', value: 'off' })), { key: 'reduceMotion', value: 'off' });
assert.deepEqual(J(parseStartSettingWrite({ key: 'notices', value: false })), { key: 'notices', value: false });
console.log('PASS start settings helper: six named rows, three available, normalized view, minor gate, hostile writes refused');

// ── host: the real StartPage ──
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const adult = { activity_kind: 'personal', profile_id: 'adult', display_name: 'Adult', game: { template_tier: 'website' }, ux: { coach: { naming_mode: 'fixed', fallback_name: 'Coach' } }, welcome: {}, series_index: 1, series_total: 5 };
const minor = { ...adult, profile_id: 'kid', game: { template_tier: 'kids-web' } };
const flagged = { ...adult, profile_id: 'flagged', minor_cohort: true };
let current = adult, failUpdate = false, refreshes = 0;
const config = new Map([['workbench.reduceMotion', 'auto'], ['hypeproofChat.osTaskNotices', false]]);
const updates = [], commands = [], states = [];
const global = new Map();
const ctx = { globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } }, workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
const chat = { ensureProfile: async () => current, profileFailure: () => null, invalidateProfile() {}, refreshConfig: async () => { refreshes++; }, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
const vscode = {
  workspace: { workspaceFolders: [], getConfiguration: (section) => ({
    get: (key) => config.get(`${section}.${key}`),
    update: async (key, value, target) => { if (failUpdate) throw Error('read-only settings'); updates.push([`${section}.${key}`, value, target]); config.set(`${section}.${key}`, value); },
  }) },
  window: {}, commands: { executeCommand: async (id) => { commands.push(id); } },
};
const M = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: M, exports: M.exports, require: (id) => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch: async () => new Response('{}', { status: 404 }) });
const page = new M.exports.StartPage(ctx, chat, async () => false);
page.panel = { webview: { postMessage: async (m) => { states.push(m.state); } } };
const last = () => states.at(-1).settings;

// The old direct path is gone: a stale "openStudioSettings" opens nothing.
await page.handle({ type: 'openStudioSettings' });
assert.deepEqual(commands, [], 'the start page never opens the VS Code settings editor directly');

// Adult seat: the view offers 고급 설정 and it opens the editor.
await page.handle({ type: 'startSetting', key: 'notices', value: true });
assert.deepEqual(updates.at(-1), ['hypeproofChat.osTaskNotices', true, true]);
assert.equal(last().notices, true); assert.equal(last().advanced, true);
await page.handle({ type: 'openAdvancedSettings' });
assert.deepEqual(commands, ['workbench.action.openSettings']);

// The other rows land where their behaviour reads them.
await page.handle({ type: 'startSetting', key: 'textSize', value: 'xlarge' });
assert.equal(global.get('hypeproof.textSize'), 'xlarge'); assert.equal(refreshes, 1, 'an open chat picks the new size up');
assert.equal(last().textSize, 'xlarge');
await page.handle({ type: 'startSetting', key: 'reduceMotion', value: 'on' });
assert.deepEqual(updates.at(-1), ['workbench.reduceMotion', 'on', true]); assert.equal(last().reduceMotion, 'on');

// Hostile writes change nothing.
const before = [updates.length, global.size, states.length];
for (const bad of [{ key: 'textSize', value: 'giant' }, { key: 'reduceMotion', value: 1 }, { key: 'notices', value: 'false' }, { key: 'proxyUrl', value: 'http://evil' }])
  await page.handle({ type: 'startSetting', ...bad });
assert.deepEqual([updates.length, global.size, states.length], before, 'a refused write stores nothing and sends nothing');

// A failed write says so and keeps the shown value.
failUpdate = true; await page.handle({ type: 'startSetting', key: 'notices', value: false }); failUpdate = false;
assert.match(states.at(-1).error, /설정을 저장하지 못했어요/); assert.equal(last().notices, true);

// Minor seats (tier and flag): no 고급 설정 in the view, and a forged request opens nothing.
for (const p of [minor, flagged]) {
  current = p; commands.length = 0;
  await page.handle({ type: 'startSetting', key: 'textSize', value: 'base' });
  assert.equal(last().advanced, false, `${p.profile_id}: 고급 설정 hidden`);
  await page.handle({ type: 'openAdvancedSettings' });
  assert.deepEqual(commands, [], `${p.profile_id}: the host refuses the editor`);
}
// No seat, but an under-14 free start answer: hidden too.
current = null; global.set('hypeproofChat.freeStart.age.v1', 'under14'); commands.length = 0;
await page.handle({ type: 'openAdvancedSettings' });
assert.deepEqual(commands, [], 'under-14 answer: the host refuses the editor');
global.set('hypeproofChat.freeStart.age.v1', '14+');
await page.handle({ type: 'openAdvancedSettings' });
assert.deepEqual(commands, ['workbench.action.openSettings'], 'no seat, 14+: the setup path stays');
console.log('PASS start settings host: no direct editor path, writes land in their stores, hostile writes refused, minor seats never reach 고급 설정');
