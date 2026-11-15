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
assert.deepEqual([...base.rows], ['textSize', 'theme', 'reduceMotion', 'notices', 'tips', 'export'], 'the six rows REQ-SHELL-14 names, in its order (theme from CGP-SHELL-R-016, export from #4088, tips from CGP-SHELL-R-019)');
assert.ok(base.rows.length <= 6, 'at most six rows');
assert.ok(base.rows.length <= 6);
assert.deepEqual({ ...base, rows: 0 }, { rows: 0, textSize: 'large', theme: 'dark', reduceMotion: 'on', notices: true, tips: true, tipsWindowOnly: true, advanced: true }, 'no chat state: tips on, window only');
assert.deepEqual([startSettingsView({ textSize: 'base', reduceMotion: 'auto', notices: false, tips: { on: false, seat: 'A' }, profileMinor: false, age: undefined })].map((v) => [v.tips, v.tipsWindowOnly])[0], [false, false], 'a seat that turned tips off');
assert.equal(startSettingsView({ textSize: 'base', reduceMotion: 'auto', notices: false, tips: { on: 'no', seat: 'A' }, profileMinor: false, age: undefined }).tips, true, 'only a real false turns tips off');
const odd = startSettingsView({ textSize: 'huge', reduceMotion: true, notices: 'yes', profileMinor: null, age: undefined });
assert.equal(odd.textSize, 'base'); assert.equal(odd.reduceMotion, 'auto'); assert.equal(odd.notices, false, 'only a real true turns notices on');
assert.equal(advancedSettingsAllowed({ profileMinor: true, age: '14+' }), false, 'minor profile: no 고급 설정');
assert.equal(advancedSettingsAllowed({ profileMinor: null, age: 'under14' }), false, 'under-14 free start: no 고급 설정');
assert.equal(advancedSettingsAllowed({ profileMinor: false, age: undefined }), true);
assert.equal(advancedSettingsAllowed({ profileMinor: null, age: undefined }), true, 'no seat yet: the setup path stays');
for (const bad of [null, 'x', {}, { key: 'textSize', value: 'Large' }, { key: 'textSize', value: 'base‮' }, { key: 'reduceMotion', value: true }, { key: 'notices', value: 'true' }, { key: 'theme', value: 'Dark' }, { key: 'theme', value: 'custom' }, { key: 'theme', value: true }, { key: '__proto__', value: 'on' }, { key: 'model', value: 'x' }])
  assert.equal(parseStartSettingWrite(bad), null, 'refused: ' + JSON.stringify(bad));
assert.deepEqual(J(parseStartSettingWrite({ type: 'startSetting', key: 'textSize', value: 'xlarge' })), { key: 'textSize', value: 'xlarge' });
assert.deepEqual(J(parseStartSettingWrite({ key: 'reduceMotion', value: 'off' })), { key: 'reduceMotion', value: 'off' });
assert.deepEqual(J(parseStartSettingWrite({ key: 'notices', value: false })), { key: 'notices', value: false });
assert.deepEqual(J(parseStartSettingWrite({ key: 'tips', value: false })), { key: 'tips', value: false });
for (const bad of [{ key: 'tips', value: 'false' }, { key: 'tips', value: 0 }, { key: 'tips' }]) assert.equal(parseStartSettingWrite(bad), null, 'refused: ' + JSON.stringify(bad));
const { themeState, themeWrites, HP_DARK_THEME, HP_LIGHT_THEME } = S.exports;
assert.equal(themeState({ colorTheme: HP_DARK_THEME, explicitTheme: undefined, autoDetect: false }), 'dark', 'the shipped default is HP Dark');
assert.equal(themeState({ colorTheme: HP_LIGHT_THEME, explicitTheme: HP_LIGHT_THEME, autoDetect: false }), 'light');
assert.equal(themeState({ colorTheme: HP_LIGHT_THEME, explicitTheme: HP_DARK_THEME, autoDetect: true }), 'system', 'auto-detect wins over a pinned HP theme');
assert.equal(themeState({ colorTheme: 'Solarized Dark', explicitTheme: 'Solarized Dark', autoDetect: true }), 'custom', 'a theme the learner chose in VS Code is theirs');
assert.equal(themeState({ colorTheme: 'Default High Contrast', explicitTheme: 'Default High Contrast', autoDetect: false }), 'custom', 'a high-contrast theme the learner chose is kept');
for (const c of ['dark', 'light', 'system']) assert.ok(J(themeWrites(c)).every((w) => !/HighContrast|highContrast/.test(w.key)), 'no write touches the high-contrast auto switch: ' + c);
assert.deepEqual(J(themeWrites('light')), [{ section: 'window', key: 'autoDetectColorScheme', value: false }, { section: 'workbench', key: 'colorTheme', value: 'HypeProof Studio Light' }]);
assert.deepEqual(J(themeWrites('system')), [{ section: 'window', key: 'autoDetectColorScheme', value: true }], 'system leaves the theme setting alone');
assert.deepEqual(J(parseStartSettingWrite({ key: 'theme', value: 'system' })), { key: 'theme', value: 'system' });
console.log('PASS start settings helper: six named rows, all six available, normalized view, minor gate, hostile writes refused');

// ── host: the real StartPage ──
const bundle = await build({ stdin: { contents: "export * from './src/startPage.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const adult = { activity_kind: 'personal', profile_id: 'adult', display_name: 'Adult', game: { template_tier: 'website' }, ux: { coach: { naming_mode: 'fixed', fallback_name: 'Coach' } }, welcome: {}, series_index: 1, series_total: 5 };
const minor = { ...adult, profile_id: 'kid', game: { template_tier: 'kids-web' } };
const flagged = { ...adult, profile_id: 'flagged', minor_cohort: true };
let current = adult, failUpdate = false, refreshes = 0;
const config = new Map([['workbench.reduceMotion', 'auto'], ['hypeproofChat.osTaskNotices', false], ['workbench.colorTheme', 'HypeProof Studio'], ['window.autoDetectColorScheme', false]]);
const explicit = new Map(); // what the learner set in user settings (inspect().globalValue)
const updates = [], commands = [], states = [];
const global = new Map();
const ctx = { globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } }, workspaceState: { keys: () => [], get: (_k, d) => d, update: async () => {} }, secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }, extension: { packageJSON: { version: 'test' } }, subscriptions: [] };
const chat = { exports: 0, exportMyWork: async () => { chat.exports++; return undefined; }, ensureProfile: async () => current, profileFailure: () => null, invalidateProfile() {}, refreshConfig: async () => { refreshes++; }, hasActiveStream: () => false, setConnectionChanging() {}, coachDisplayName: () => 'Coach', coachNameIsChosen: () => true };
const vscode = {
  workspace: { workspaceFolders: [], getConfiguration: (section) => ({
    get: (key) => config.get(`${section}.${key}`),
    inspect: (key) => ({ globalValue: explicit.get(`${section}.${key}`) }),
    update: async (key, value, target) => { if (failUpdate) throw Error('read-only settings'); updates.push([`${section}.${key}`, value, target]); config.set(`${section}.${key}`, value); if (target === true) explicit.set(`${section}.${key}`, value); },
  }) },
  window: {}, commands: { executeCommand: async (id) => { commands.push(id); } },
};
const M = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: M, exports: M.exports, require: (id) => id === 'vscode' ? vscode : require(id), console, Buffer, AbortSignal, URL, process, TextEncoder, fetch: async () => new Response('{}', { status: 404 }) });
// CGP-SHELL-R-014 / R-019 — the chat side of 팁 보기, built from the exact class and calls the provider uses
// (LessonTipsPreference; setLessonTips writes, posts the chat config and fires onLessonTipsChanged; lesson-tips-host pins the
// provider source). Both surfaces share it, so a press on either is seen by the other.
const { LessonTipsPreference, LESSON_TIPS_KEY } = await import('../src/lessonTips.ts');
const tipsPref = new LessonTipsPreference(), tipsListeners = new Set();
let chatTipsPosts = 0;
const tipsChanged = () => { for (const l of tipsListeners) l(); };
chat.lessonTipsState = () => ({ on: tipsPref.on(global.get(LESSON_TIPS_KEY)), seat: tipsPref.currentSeat });
chat.setLessonTips = async (on) => { if (typeof on !== 'boolean') return 'refused'; const next = tipsPref.write(global.get(LESSON_TIPS_KEY), on); if (next) global.set(LESSON_TIPS_KEY, next); chatTipsPosts++; tipsChanged(); return next ? 'stored' : 'memory-only'; };
chat.onLessonTipsChanged = (l) => { tipsListeners.add(l); return () => tipsListeners.delete(l); };
const chatConfigBuild = (seat) => { const changed = tipsPref.currentSeat !== seat; tipsPref.forSeat(seat); if (changed) tipsChanged(); };
const ticks = () => new Promise((r) => setTimeout(r, 20));
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

// CGP-SHELL-R-016 — 화면 밝기: HP Light, then the device's setting, then back to HP Dark; all in user scope.
assert.equal(last().theme, 'dark');
await page.handle({ type: 'startSetting', key: 'theme', value: 'light' });
assert.deepEqual(updates.slice(-2), [['window.autoDetectColorScheme', false, true], ['workbench.colorTheme', 'HypeProof Studio Light', true]]); assert.equal(last().theme, 'light');
await page.handle({ type: 'startSetting', key: 'theme', value: 'system' });
assert.deepEqual(updates.at(-1), ['window.autoDetectColorScheme', true, true]); assert.equal(config.get('workbench.colorTheme'), 'HypeProof Studio Light', 'system does not touch the theme'); assert.equal(last().theme, 'system');
await page.handle({ type: 'startSetting', key: 'theme', value: 'dark' });
assert.deepEqual(updates.slice(-2), [['window.autoDetectColorScheme', false, true], ['workbench.colorTheme', 'HypeProof Studio', true]]); assert.equal(last().theme, 'dark');
// A theme the learner chose in VS Code is never overwritten, even by a forged message.
explicit.set('workbench.colorTheme', 'Solarized Light'); config.set('workbench.colorTheme', 'Solarized Light');
const n0 = updates.length;
await page.handle({ type: 'startSetting', key: 'theme', value: 'dark' });
assert.equal(updates.length, n0, 'no write over an explicit non-HP theme'); assert.equal(config.get('workbench.colorTheme'), 'Solarized Light'); assert.equal(last().theme, 'custom');
explicit.set('workbench.colorTheme', 'HypeProof Studio'); config.set('workbench.colorTheme', 'HypeProof Studio');

// Hostile writes change nothing.
const before = [updates.length, global.size, states.length];
for (const bad of [{ key: 'textSize', value: 'giant' }, { key: 'theme', value: 'HypeProof Studio' }, { key: 'reduceMotion', value: 1 }, { key: 'notices', value: 'false' }, { key: 'proxyUrl', value: 'http://evil' }])
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
// CGP-SHELL-R-014: 내 작업 내보내기 runs the shipped export once, in the same seats as the chat settings entry (no seat gate there).
for (const p of [adult, minor]) {
  current = p; chat.exports = 0;
  await page.handle({ type: 'startSetting', key: 'textSize', value: 'base' });
  assert.ok(last().rows.includes('export'), `${p.profile_id}: the export row is offered`);
  await page.handle({ type: 'startExportMyWork' });
  assert.equal(chat.exports, 1, `${p.profile_id}: the row runs the shipped export once`);
}
const exportsBefore = chat.exports, commandsBefore = commands.length;
for (const bad of [{ type: 'startExportMyWork ' }, { type: 'exportMyWork' }, { type: 'startSetting', key: 'export', value: true }]) await page.handle(bad);
assert.equal(chat.exports, exportsBefore, 'only the exact message runs the export');
assert.equal(commands.length, commandsBefore, 'and it runs no command');
// CGP-SHELL-R-014 — 팁 보기 and the chat's 팁 그만 보기 / 다시 켜기 are one choice, in both directions, without a reload.
current = adult;
assert.equal(tipsListeners.size, 1, 'the start page listens to the chat\'s tips choice');
await page.handle({ type: 'startSetting', key: 'textSize', value: 'base' });
assert.deepEqual([last().rows.includes('tips'), last().tips, last().tipsWindowOnly], [true, true, true], 'no seat yet: tips on, window only');
await page.handle({ type: 'startSetting', key: 'tips', value: false });
assert.equal(global.get(LESSON_TIPS_KEY), undefined, 'no seat: nothing stored');
assert.deepEqual([chat.lessonTipsState().on, last().tips, chatTipsPosts], [false, false, 1], 'start page → chat: the chat now shows tips off and redrew');
chatConfigBuild('A'); await ticks();
assert.deepEqual([last().tips, last().tipsWindowOnly], [true, false], 'a seat is known: its own choice (on), and an in-memory choice did not carry over');
await page.handle({ type: 'startSetting', key: 'tips', value: false });
assert.deepEqual(global.get(LESSON_TIPS_KEY), { off: ['A'] }, 'seat A: stored for A');
assert.deepEqual([chat.lessonTipsState().on, last().tips], [false, false], 'start page → chat (seat A)');
const statesBefore = states.length;
await chat.setLessonTips(true); await ticks();
assert.ok(states.length > statesBefore, 'chat → start page: the open sheet is redrawn');
assert.deepEqual([last().tips, global.get(LESSON_TIPS_KEY)], [true, { off: [] }], 'chat 다시 켜기 → the sheet shows tips on');
await chat.setLessonTips(false); await ticks();
assert.equal(last().tips, false, 'chat 팁 그만 보기 → the sheet shows tips off');
chatConfigBuild('B'); await ticks();
assert.equal(last().tips, true, 'seat B on the same window starts with tips on');
chatConfigBuild('A'); await ticks();
assert.equal(last().tips, false, 'back to seat A: still off');
const tipsBefore = [chatTipsPosts, JSON.stringify(global.get(LESSON_TIPS_KEY))];
for (const bad of [{ key: 'tips', value: 'true' }, { key: 'tips', value: 1 }]) await page.handle({ type: 'startSetting', ...bad });
assert.deepEqual([chatTipsPosts, JSON.stringify(global.get(LESSON_TIPS_KEY))], tipsBefore, 'a forged tips write changes nothing');
console.log('PASS start settings tips: one choice with the chat in both directions, per seat, window-only with no seat');
console.log('PASS start settings host: no direct editor path, writes land in their stores, hostile writes refused, minor seats never reach 고급 설정');
